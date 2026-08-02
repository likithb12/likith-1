# Personal Net Worth Tracker

A private personal finance web application: net worth over time, monthly
expenses and budgets, outstanding obligations in both directions, and income.

- **Live app:** https://likithb12.github.io/likith-1/networth/
- **Scope of work:** the specification this was built from
- **Decisions log:** [`DECISIONS.md`](DECISIONS.md) — every assumption made
  where the spec was silent, wrong, or impossible

The repository also still serves its original Jekyll site at
https://likithb12.github.io/likith-1/, including `prototype/` and `tracker/`.
Both are published by one workflow — see [Deployment](#deployment).

---

## Security posture — read this first

**Row Level Security isolates users from each other. It does not protect your
data from Supabase or AWS, who can read the database in plaintext.** Every
amount, account name and transaction description is stored unencrypted. This is
a knowingly accepted trade-off: client-side encryption was considered and
rejected for v1 because key management has no recovery path — lose the key,
lose everything.

**The Supabase anon key is public by design.** It ships in the frontend bundle
and belongs in the repository. It is not a leak, it does not need hiding, and
no proxy should be built to conceal it. Row Level Security is the security
boundary: every table carries `user_id` and every policy is
`user_id = auth.uid()` for all of SELECT/INSERT/UPDATE/DELETE.

**The `service_role` key must never appear in this repository, in the frontend,
or in CI.** It bypasses RLS entirely. Nothing in this project needs it.

Sign-in is a magic link — no passwords are stored and there is no password
reset flow.

---

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, schema, RLS, auth, routing, CI | ✅ Done |
| 1 | Accounts, balance snapshots, net worth, dashboard, JSON export | ✅ Done |
| 2 | Categories, transactions, CSV import, budgets | ✅ Done |
| 3 | Obligations | ✅ Done |
| 4 | Income | ✅ Done |
| 5 | Holdings, prices, FX | ✅ Done |
| 6 | PWA, offline, polish | Not started |

> **The app cannot run until a Supabase project exists and the two environment
> variables below are set.** Creating that project requires an account login and
> could not be done as part of this build — see
> [Backend setup](#1-backend-setup-supabase). Until then the app deploys and
> renders a "Backend not configured" screen rather than failing silently.

---

## Setup

### 1. Backend setup (Supabase)

1. Create a project at [supabase.com](https://supabase.com), **region
   `ap-southeast-2` (Sydney)** for Australian data residency.
2. Apply the migrations in [`supabase/migrations`](supabase/migrations) —
   see [Migrations](#migrations).
3. Under **Authentication → URL Configuration**, add the app URL to
   **Redirect URLs**, or magic links will bounce to the site root:
   ```
   https://likithb12.github.io/likith-1/networth/
   http://localhost:5173/          (for local development)
   ```
4. Copy the project URL and the **anon** key from **Project Settings → API**.

### 2. Local development

```bash
cd app
npm install
cp .env.example .env.local     # then fill in the two values
npm run dev                    # http://localhost:5173
```

### 3. Deployment configuration

In GitHub, under **Settings → Secrets and variables → Actions → Variables**
(the *Variables* tab, **not** Secrets — these values are public):

| Variable | Example |
|---|---|
| `VITE_SUPABASE_URL` | `https://abcdefgh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi…` |

Then under **Settings → Pages**, set **Source** to **GitHub Actions**.

---

## Environment variables

Both are public and both are required. Defined in
[`app/.env.example`](app/.env.example).

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key — public, RLS is the boundary |
| `VITE_BASE_PATH` | Optional. Vite `base`; defaults to `/likith-1/networth/` |

---

## Migrations

Migrations are version controlled in [`supabase/migrations`](supabase/migrations)
and are applied in filename order.

**Using the Supabase CLI** (recommended):

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Or by hand:** paste each file, in order, into the Supabase dashboard's SQL
editor.

### Verifying the schema and RLS locally

You do not need a Supabase project to check that the migrations apply and that
RLS actually isolates users:

```bash
./supabase/tests/run_tests.sh
```

This starts a throwaway PostgreSQL cluster, stubs the few Supabase objects the
migrations depend on (`auth.users`, `auth.uid()`, and the
`anon`/`authenticated`/`service_role` roles), applies every migration, and runs
the isolation tests in `supabase/tests/*.test.sql`. Requires PostgreSQL server
binaries (`sudo apt install postgresql-16`); set `PGBIN` if they are elsewhere.

CI runs this on every push and pull request.

---

## Testing

```bash
cd app
npm test           # unit tests
npm run typecheck
npm run lint
```

Unit tests are mandatory — and present — for the four places silent wrongness
hides:

| Area | File |
|---|---|
| Net worth calculation | `app/src/lib/networth.test.ts` |
| Obligation double-counting guard | `app/src/lib/networth.test.ts` |
| FX conversion | `app/src/lib/fx.test.ts` |
| CSV dedupe hashing | `app/src/lib/dedupe.test.ts` |
| Money parsing and rounding | `app/src/lib/money.test.ts` |
| RLS isolation (user A vs user B) | `supabase/tests/01_rls.test.sql` |

---

## Deployment

`.github/workflows/deploy.yml` runs on push to `master`: typecheck, lint, unit
tests, database tests, build, deploy. Pull requests run everything except the
deploy.

It publishes one Pages artifact containing both sites:

```
/likith-1/            Jekyll site (index.md, prototype/, tracker/)
/likith-1/networth/   this app
```

This replaced the previous `jekyll-gh-pages.yml`. Two workflows cannot both
deploy to Pages — they share a concurrency group and overwrite each other.

### GitHub Pages specifics

- `base` in `vite.config.ts` is `/likith-1/networth/`. Without it every asset
  404s.
- **Routing uses `HashRouter`.** GitHub Pages has no SPA fallback. The
  alternative — copying `index.html` to `404.html` — works but serves a real
  HTTP 404 for every deep link. Rationale in [D3](DECISIONS.md).
- Auth uses the **PKCE** flow. The implicit flow returns the session in the URL
  fragment, which is exactly where `HashRouter` keeps the route; the two cannot
  coexist. Rationale in [D4](DECISIONS.md).
- CI writes `.nojekyll` into the artifact root, or Pages silently drops paths
  beginning with an underscore.

---

## Supabase free tier: your project will be paused

Supabase pauses Free plan projects after **7 days without database activity**.
Restoring is a button in the dashboard and the data is intact, but a project
left paused for an extended period is eventually deleted.

**This matters more than it sounds for this particular app.** A net worth
tracker is used once a month. Seven days of inactivity is the normal state
between sessions, so on the Free plan the project will be paused almost every
time you sit down to update your balances.

The app detects this and shows a clear "Cannot reach the backend — the project
may be paused" message instead of an opaque network error, because a paused
project otherwise fails as an unexplained `TypeError: Failed to fetch`.

Options, in order of how well they fit the use case:

1. **Upgrade to Pro.** Paid plans do not pause. This is the only option that
   actually removes the problem.
2. **Keep it alive.** Any scheduled request to the database every few days —
   a GitHub Actions cron hitting a trivial endpoint — resets the timer.
3. **Live with it.** Resume the project from the dashboard when you see the
   message. Free, but it is a manual step before every session, and you must
   not leave it paused for months.

Export your data periodically regardless: **Settings → Export to JSON**.

---

## Prices and exchange rates

Both are behind an adapter with a manual fallback, and **manual entry is the
default**. The app is fully functional with every external integration
disabled.

An Alpha Vantage adapter is included but ships **disabled and unverified**.
The scope asked for the licence and availability to be checked before writing
code; that check could not be completed during the build, because the build
environment blocks outbound requests to third-party hosts. Before enabling it,
confirm two things:

1. **CORS.** This app is a static site with no backend, so your browser calls
   the API directly. The provider must send a permissive
   `Access-Control-Allow-Origin` header or the request is blocked — it will
   appear as "Failed to fetch". Working around this needs a server, which the
   hosting decision rules out.
2. **Coverage and licence.** ASX symbol coverage and the free tier's rate
   limits and permitted use are worth confirming for your case.

Your API key is stored in your browser, never in the database, and is not
included in the JSON export.

Prices are cached in `price_points`, fetched only when you press the button,
and at most once per ticker per day. A failed fetch is a non-blocking warning
and the last known price is used, flagged as stale.

---

## Data model notes

Two conventions matter for reading the numbers correctly:

- **Balances are never overwritten.** Current balance is derived as the most
  recent `balance_snapshots` row at or before a date, which is what makes the
  trend chart real history rather than a guess.
- **Liability balances are positive magnitudes meaning "amount owed."** Net
  worth is assets − liabilities. A credit card in credit is a negative
  liability balance and correctly increases net worth.

All money is `numeric(18,2)` in Postgres and `decimal.js` in the frontend.
There is no floating point anywhere in the money path.

---

## Project layout

```
app/                      Vite + React + TypeScript frontend
  src/lib/                Pure calculation modules — the tested core
  src/data/               TanStack Query hooks over Supabase
  src/pages/              One file per screen
  src/ui/                 Shared primitives
supabase/migrations/      Schema, version controlled, applied in order
supabase/tests/           RLS and migration tests against local Postgres
.github/workflows/        CI
index.md, prototype/, tracker/   Pre-existing Jekyll site
```
