# Decisions

Assumptions and judgement calls made during the build that the scope of work
did not cover, or covered in a way that turned out not to work. Recorded here
rather than chosen silently, per §11 of the scope.

Architecture decisions listed in §2 of the scope are settled and are not
re-litigated here.

---

## Phase 0

### D1. CI triggers on `master`, not `main`

§7 specifies "GitHub Actions on push to `main`". This repository's default
branch is `master`. The workflow triggers on `master`; renaming the default
branch was not in scope and would break the existing site's deployment.

### D2. The app is mounted at `/likith-1/networth/`, not at the site root

The repository already publishes a Jekyll site to GitHub Pages containing
`index.md`, `prototype/` and `tracker/`. Two workflows cannot both deploy to
Pages — they share a concurrency group and the second overwrites the first.

`.github/workflows/jekyll-gh-pages.yml` has been replaced by
`.github/workflows/deploy.yml`, which builds both and publishes one artifact:

```
/likith-1/            existing Jekyll site
/likith-1/networth/   this app
```

`vite.config.ts` sets `base` to `/likith-1/networth/` accordingly, and
`_config.yml` excludes `app/` and `supabase/` so Jekyll does not try to process
the app's sources or `node_modules`.

### D3. HashRouter, not a 404.html fallback

*Resolves the open item in §10.*

GitHub Pages has no SPA fallback. The two options were `HashRouter` and copying
`index.html` to `404.html` at build time.

Chose **HashRouter**. The 404.html trick works, but it serves a genuine HTTP 404
for every deep link — which pollutes the network log, confuses monitoring, and
behaves inconsistently across browsers on back-navigation. The cost is uglier
URLs (`/networth/#/accounts`), which for a private single-user app nobody links
to is not worth trading correctness for.

### D4. PKCE auth flow, because the implicit flow collides with HashRouter

Not anticipated by the scope. Supabase's default implicit flow returns the
session in the URL **fragment** (`#access_token=…`), which is exactly where
HashRouter keeps the route. The two cannot coexist.

The client sets `flowType: 'pkce'`, which returns `?code=…` as a query
parameter instead. This is why D3 does not create a problem.

### D5. Per-user uniqueness on `price_points` and `fx_rates`

§3.3 specifies `unique (ticker, as_at)` and §3.7 specifies
`unique (base_currency, quote_currency, as_at)`. Both are global, but §3 also
requires every table to carry `user_id`. A global constraint would mean one
user's manually entered price silently blocks another user's insert for the
same ticker and date — a cross-user leak of write availability, and a bug the
second user could never diagnose.

Both constraints are scoped with `user_id` as the leading column. Same
intent — one price per ticker per day — without the cross-user collision.

### D6. Explicit grants in the migration

Supabase's default privileges already grant `authenticated` access to new
tables in `public`. The migration states the grants anyway so it applies
correctly to a plain Postgres (which is how the RLS tests run) and does not
depend on project-level configuration that is invisible in this repository.
`anon` is granted nothing.

### D7. RLS policies are generated from a table list

`0001_initial_schema.sql` creates the four policies per table in a loop over an
explicit array, then asserts that no table in `public` escaped. "No exceptions"
in §3 is enforced mechanically rather than by review. `01_rls.test.sql`
re-checks both properties against a real database.

### D8. Database tests run against a throwaway local Postgres

§8 requires an RLS test proving user A cannot read user B's rows. Doing that
against the live Supabase project would need service-role credentials in CI,
which §2 forbids anywhere in the repo.

`supabase/tests/run_tests.sh` spins up a temporary PostgreSQL cluster, applies
`supabase/tests/00_supabase_stubs.sql` (which recreates `auth.users`,
`auth.uid()` and the `anon`/`authenticated`/`service_role` roles), applies every
migration in order, and runs the assertions. No cloud project and no secrets
required, and it verifies the migrations actually apply.

### D9. Money crosses the PostgREST boundary as a string

PostgREST serialises `numeric` as a JSON **number**, so an amount arrives in the
browser as a binary double. `lib/money.ts` parses via `String(value)` — the
shortest round-trip representation — which recovers the intended decimal
(`1234.56`, not `1234.5600000000000023`). Writes always send a fixed-scale
string so Postgres parses them exactly. No amount is ever the result of float
arithmetic.

### D10. A single dark theme

Not specified. A personal finance dashboard is read at a glance, often on a
phone at night. One well-tuned theme is better than two half-tuned ones, and it
halves the styling surface across six phases.

---

## Cross-cutting model decisions

These affect correctness of the primary number, so they are stated explicitly.

### D11. Liability balances are positive magnitudes

Not specified. A liability account's balance means **the amount owed**, entered
as a positive number. Net worth = assets − liabilities.

A credit card in credit is entered as a *negative* liability balance and
correctly increases net worth. Forms label the field "Amount owed" for
liability accounts so the convention is visible at the point of entry.

### D12. An account contributes nothing before its first snapshot

Not specified. Without this, an account created today would appear to have held
today's balance for all of history, and the trend line would be a fabrication.
An account with no snapshot at or before the valuation date contributes zero
and is reported as `hasData: false`.

### D13. `include_in_net_worth` governs inclusion; `is_active` governs the UI

Deactivating an account keeps its history but removes it from the "update
balances" screen. It does **not** retroactively remove it from net worth,
because its historical balances were real. To stop a closed account
contributing going forward, record a final zero balance — the deactivation flow
offers to do this.

### D14. Unlinked obligations count toward net worth

§3.5 says payables linked to a loan or credit-card account must not be
double-counted, which implies unlinked ones *do* count. Implemented as: an
outstanding payable adds to liabilities, an outstanding receivable adds to
assets, unless excluded by D15.

### D15. The double-counting guard checks that the linked account is actually counted

§3.5 says an obligation linked to a liability account is display-only. Taken
literally, an obligation linked to an account that is excluded from net worth
(or has since been deleted) would vanish from the total entirely — understating
debt, which is the more dangerous error.

The guard therefore excludes an obligation only when the linked account exists
**and** has `include_in_net_worth = true`. There is nothing to double-count
otherwise. Both cases are covered by tests in `networth.test.ts`.

### D16. Holdings are authoritative for a brokerage account that has them

§3.3 defines a brokerage balance as derived from holdings. If such an account
*also* had a manual balance snapshot there would be two competing sources of
truth for the same figure. Holdings win when present; a brokerage account with
no holdings falls back to its snapshots.

### D17. `dedupe_hash` carries an occurrence index

The hash specified in §3.4 treats two genuinely distinct transactions with the
same date, amount and description — two $4.50 coffees at the same cafe on the
same day — as duplicates, and would silently drop the second. That is data
loss, not de-duplication, and it is invisible to the user.

The stored hash is the specified SHA-256 followed by `:<n>`, where `n` counts
prior rows sharing that base hash. Re-importing the same statement reproduces
the same indices and every row is correctly detected as a duplicate; an
overlapping statement containing one extra repeat imports exactly that one row.
`dedupe.test.ts` covers both directions.

### D18. FX falls back to a future rate when no prior rate exists, and flags it

§5.2 says to use the most recent prior rate when none exists for a date. It does
not say what to do when there is no prior rate at all — which is the normal
state on day one, when the user enters today's rate and has balances going back
years.

Refusing to convert would leave the trend line broken. Instead the earliest
known later rate is used, flagged stale with a *negative* `staleDays` so the UI
can distinguish "this rate is old" from "this rate is from after the date it is
being applied to". When no rate exists in either direction the amount is passed
through unconverted with `missing: true` and the dashboard says so.

### D19. Net worth is computed in TypeScript, not in a Postgres function

§3.2 requires recomputation to be "a single idempotent function". It does not
say where it lives.

The calculation spans balance snapshots, holdings, prices, FX and the
obligation guard. Implementing it twice — once in SQL for the materialised
table and once in TypeScript for the dashboard — guarantees the two drift, and
a drifting net worth figure is the worst possible bug in this product.

So `lib/networth.ts` is the single implementation. The client recomputes and
upserts `net_worth_snapshots` after any mutation that affects it; the unique
constraint on `(user_id, as_at)` makes re-running any date range idempotent.
The chart still reads from the materialised table, satisfying §8's performance
requirement. Settings offers a manual "recompute all" for the case where a
client died mid-write.

Trade-off: a stale or offline client can leave the materialised table behind
the source data. It cannot corrupt anyone else's data (RLS), and the recompute
is cheap and repeatable.

---

## Phase 1

### D20. The composition chart shows at most three asset types plus "Other"

A stacked area normally only needs *adjacent* series to be colourblind-
separable. That guarantee does not hold here: which account types a user owns
is unpredictable, so any two types can end up touching once the types between
them are absent. The chart therefore has to clear the all-pairs standard.

The largest subset of the categorical palette that passes all-pairs on this
app's dark surface is **four**, verified rather than estimated:

```
validate_palette.js "#3987e5,#c98500,#d55181,#008300" \
  --mode dark --surface "#131c31" --pairs all   → ALL CHECKS PASS
```

Eight slots fail badly under this standard (magenta↔aqua reaches ΔE 1.6 for
deuteranopia — indistinguishable). So assets are stacked as at most three
types, with the remainder folded into "Other assets", and liabilities are a
single series — which is what §4.1 asks for anyway ("assets by type vs
liabilities"). Liabilities use a neutral below the zero line rather than a
categorical hue, because they are the opposing quantity rather than another
category.

The chosen four sit in the 6–8 CVD band, legal only with secondary encoding, so
the chart ships a legend, 2px surface gaps between segments, and a data table.

### D21. Colour follows the account type, never its value

Asset types claim colour slots in a fixed order, so changing the chart's date
range never repaints the series. A type keeps its colour whether or not other
types are on screen.

### D22. Import replaces or merges, and says which

Ids are regenerated on import so a restore cannot collide with existing rows,
and every foreign key is remapped to match. That makes a *merge* import create
duplicate accounts, which is rarely what anyone wants, so the import screen
offers "replace all my existing data first" and states plainly what each choice
does rather than guessing.

---

## Phase 2

### D23. The CSV parser is hand-written

The requirement is one RFC 4180 parser plus a date reader. A dependency for
that would be larger than the code it replaces and adds a supply-chain surface
to a finance app. `lib/csv.ts` handles quoted fields, embedded delimiters and
newlines, escaped quotes, CRLF and a UTF-8 BOM, and is covered by 31 tests.

### D24. `skip_rows` counts rows in the file, not rows after blanks are removed

Found by a test. Blank lines were originally discarded before `skip_rows` was
applied, so "skip 2" ate a different two rows than the two the user could see
in their editor. Skipping now happens first, and blank-line removal second.

### D25. Date-format detection ignores the ISO fallback

Also found by a test. `parseDateWithFormat` accepts an unambiguous ISO date
whatever format is declared, which is right for importing but wrong for
*detecting*: every candidate format "reads" an ISO column, so whichever was
tried first won. Detection now runs in a strict mode that skips the fallback.

### D26. Money out of the account is a debit

For a single signed amount column, a negative value is money leaving the
account and is recorded as a `debit` with a positive magnitude. Some card
exports invert this; the mapping UI shows a live preview of the first ten rows
with signs applied, so an inverted file is visible before anything is written.

### D27. Rules never overwrite a category set by hand

"Re-run rules" only touches transactions whose `category_id` is null. A rule
edit silently reclassifying work the user did manually would be worse than the
rule not applying at all.

### D28. Budgets roll subcategory spend up to the parent

A budget on "Transport" covers spending recorded against "Fuel". Without this
the one-level nesting in §3.4 would make budgets unusable for anyone who
actually uses subcategories.

### D29. Import requires an account

Duplicate detection is scoped per account, both because the dedupe hash
includes `account_id` and because it is what makes the "existing hashes" query
bounded. An import with no account selected could not be de-duplicated
reliably, so the wizard requires one.

---

## Phase 3

### D30. `amount_settled` is recalculated from the payment rows, never incremented

Recording or deleting a payment recomputes the total from `obligation_payments`
and derives the status from it. Incrementing a running total would let a
deleted or corrected payment leave `amount_settled` permanently out of step
with the payments that produced it, and nothing would ever notice.

### D31. Settling a recurring obligation creates the next occurrence immediately

§4.4 says recurring obligations generate the next instance on settlement. That
happens inside the same mutation that records the final payment, so a monthly
bill cannot silently disappear the moment it is paid. The new instance copies
the amount, counterparty, link and recurrence, with `due_date` advanced and
nothing settled.

### D32. The obligations list totals everything; only net worth applies the guard

The "I owe" total on the obligations screen includes obligations linked to an
account, because the question that screen answers is "what do I owe, to whom,
and when" — and the debt is real regardless of where it is tracked. The
double-counting guard applies to the **net worth** calculation, which is the
only place counting it twice would produce a wrong number. The screen states
which obligations are excluded from net worth and why, rather than quietly
showing two different totals with no explanation.

---

## Phase 4

### D33. Income is counted from transactions plus *unmatched* income events

Income can arrive twice: as an imported credit transaction, and as a manually
recorded income event. An event matched to a transaction describes the same
money, so counting both would inflate income and flatter the savings rate —
the one number this screen exists to report honestly.

`combinedIncome` therefore sums credit transactions plus only those income
events with no `transaction_id`. The events list labels each row Matched or
Unmatched so the rule is visible rather than implicit, and the record-income
form offers nearby credit transactions to match against.

### D34. A savings rate on zero income is null, not zero

Reporting "0%" for a month with no income implies the money was all spent. The
rate is null and the UI shows "—" with an explanation.

### D35. Recording income rolls the source's next expected date forward

Otherwise `next_expected_date` goes stale the first time you are paid and the
"next expected" column becomes actively misleading.

---

## Phase 5

### D36. The price API adapter could not be verified, and ships disabled

**§10 assigned "verify current availability and licence terms before writing
code" to this build. That verification could not be completed, and this is the
one open item that is not closed.**

The build environment's network policy blocks outbound requests to third-party
hosts, so neither Alpha Vantage's ASX symbol coverage nor — more importantly —
its CORS behaviour could be tested. Research confirms the spec's premise that
no free, officially supported ASX price API exists: the unofficial Yahoo
Finance endpoints are undocumented, break without notice and sit in a terms-of-
service grey area, which rules them out.

There is also a constraint the scope does not mention. Because §2 fixes a
static frontend with no backend, **the browser calls the price API directly**,
so any adapter requires the provider to send a permissive
`Access-Control-Allow-Origin` header. A provider that works perfectly from
curl can be unusable here. Working around it would mean running a proxy
server, which contradicts the hosting decision.

So:

- The **manual adapter is the default** and always works, as §5.1 requires.
- An **Alpha Vantage adapter is implemented behind the same interface**, but is
  opt-in, requires the user's own API key, is labelled "unverified" in the UI,
  and states plainly what has not been confirmed and how to tell whether CORS
  is the problem.
- The application is fully functional with both integrations disabled.

What Likith needs to check before relying on it: that the provider allows
cross-origin browser requests, that ASX symbols are covered, and that the free
tier's licence permits this use.

### D37. The API key is stored in the browser, not the database

It is the user's credential with a third party, it is not needed on another
device in order to read their own data, and keeping it out of Postgres keeps it
out of the JSON export and out of anything the platform can read. It lives in
localStorage alongside the adapter choice.

### D38. Prices are fetched at most once per ticker per day, and never on render

`useRefreshPrices` only runs from an explicit button press, and skips any
ticker that already has a price row for today. §5.1 requires both.

---

## Phase 6

### D39. The service worker is hand-written

The whole requirement is "offline read of cached data". A build-time PWA
plugin would add more dependency surface than the ~120 lines in
`public/sw.js`, which does three things: network-first navigations falling back
to a cached shell, cache-first for content-hashed assets, and network-first
with a cache fallback for Supabase reads.

### D40. Only GET requests are cached, and writes are never queued

A queued write replayed later could silently duplicate a transaction, and the
dedupe hash would not catch it because the row genuinely is new from the
client's point of view. Mutations go straight to the network and fail honestly
when offline; the banner says changes cannot be saved.

### D41. The offline cache holds financial data, and is cleared on sign-out

Making data readable offline means storing it on the device, in Cache Storage.
That is a real privacy consequence of the feature, so: auth endpoints are never
cached, the cache is dropped when the worker updates, and signing out posts
`clear-api-cache` to remove it. Stated in Settings and in the README rather
than left for someone to discover.

### D42. The dashboard loads without the charting library

Recharts is ~113 kB gzipped — more than everything else on the dashboard put
together. It is loaded lazily, so the headline number, the change indicators
and the freshness panel paint first, which is what §8's two-second target is
actually about. This required moving `rangeStart` into its own module: a single
static import from the chart module would have cancelled the split, and Rollup
warned about exactly that.

Critical path is now ~176 kB gzipped (app, React, Supabase, TanStack Query)
with charts, and every route other than the dashboard, deferred.
