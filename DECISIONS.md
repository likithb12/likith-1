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
