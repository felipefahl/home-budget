# Home Budget v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private web app where two Google accounts track income, expenses, transfers, card installments and investments across Portugal (EUR) and Brazil (BRL), and see how much they save each month.

**Architecture:** Static React SPA on Netlify talks straight to Supabase (Postgres + Google Auth). Security lives in the database: Row Level Security lets only emails in `allowed_emails` read or write anything. All money math (installments, monthly summary, FX conversion, recurring averages) is pure TypeScript in `src/lib/`, unit-tested with Vitest; screens stay thin.

**Tech Stack:** Vite + React 19 + TypeScript, `@supabase/supabase-js` v2, Vitest, Supabase (free tier), Netlify, Frankfurter API (ECB rates) for EUR/BRL.

**Spec:** Requirements doc (pt-BR), validated 2026-10-23: https://claude.ai/artifact/DL6tzABuzUxHcGYLqy4VAh

## Global Constraints

- Only 2 emails may access data; enforced by RLS, never only in the UI.
- All data is shared between both users (no private entries).
- Money stored as integer cents (`bigint`), always with the account's currency. Signed: negative = money leaving the account.
- Countries/currencies: `PT`/`EUR` and `BR`/`BRL` only.
- Category types: `essential` | `adjustable` (pt-BR labels "Essencial" / "Ajustável").
- Installments count in the month of each bill, not the purchase month.
- Transfers and balance adjustments never count as income or expense.
- Investment ("retirada para investimento") is its own kind; a toggle excludes it from the month result.
- Savings goal default: 20% of income.
- Deletes are soft (`deleted_at`); trash restorable for 30 days.
- Every change is recorded in `audit_log` (who, when, old/new).
- App start date: 2027-01-01, with an opening balance per account.
- UI language: pt-BR. Totals viewable in EUR or BRL, switchable on screen.
- Free tiers only.

## Review Focus

1. Purchase on the card's closing day — must go to the bill closing that day, not the next one (`billDueDate` test).
2. Installment amount not divisible by N (e.g. 100,00 in 3x) — cents must sum exactly to the total; remainder goes on the first installment.
3. Closing day 31 in a 30-day month / February — clamp to the month's last day.
4. A day with no FX rate (weekend/holiday) — use the most recent previous rate.
5. Editing one side of a transfer — the pair stays linked (shared `group_id`); deleting deletes both.

---

## File Structure

```
supabase/migrations/0001_init.sql   schema, RLS, audit trigger, seed categories
src/lib/money.ts                    cents <-> display, parse pt-BR input
src/lib/installments.ts             billDueDate, splitInstallments
src/lib/summary.ts                  monthSummary
src/lib/fx.ts                       rateOn, convert, fetchRates
src/lib/recurrence.ts               suggestedAmount
src/lib/*.test.ts                   Vitest specs, one per lib file
src/types.ts                        row types shared by lib + UI
src/supabase.ts                     client
src/App.tsx                         auth gate + tab nav
src/pages/{Dashboard,Entries,EntryForm,Accounts,Categories,Trash}.tsx
netlify.toml, .env.example
```

## Data model (`0001_init.sql`)

- `allowed_emails(email text pk)`
- `accounts(id uuid pk, name, country 'PT'|'BR', currency 'EUR'|'BRL', kind 'bank'|'card'|'cash', opening_balance_cents bigint default 0, closing_day int null, due_day int null, archived_at timestamptz null, created_at)`
- `categories(id uuid pk, name, type 'essential'|'adjustable', parent_id uuid null, archived_at)`
- `recurrences(id uuid pk, kind, account_id, category_id, description, amount_cents, day_of_month, start_month date, end_month date null)`
- `entries(id uuid pk, kind 'income'|'expense'|'transfer'|'investment'|'adjustment', account_id, amount_cents bigint signed, date, category_id null, description, tags text[] default '{}', group_id uuid null, installment_no int null, installment_count int null, purchase_date date null, recurrence_id null, status 'confirmed'|'pending' default 'confirmed', created_by uuid default auth.uid(), deleted_at null, created_at, updated_at)`
- `audit_log(id bigserial, table_name, row_id, action, old jsonb, new jsonb, actor uuid default auth.uid(), at timestamptz default now())` filled by one generic trigger on accounts/categories/recurrences/entries.
- `is_allowed()`: `select exists(select 1 from allowed_emails where email = auth.jwt()->>'email')`, `security definer`. Every table: RLS on, one policy `for all using (is_allowed()) with check (is_allowed())`. `allowed_emails` and `audit_log`: select only.

## Manual setup (Felipe, once — Claude cannot enter credentials)

1. Create a Supabase project (free), run `0001_init.sql` in the SQL editor, then `insert into allowed_emails values ('<you>'), ('<wife>');`.
2. Google Cloud: OAuth client (Web), redirect URI = `https://<project>.supabase.co/auth/v1/callback`. Paste client id/secret in Supabase → Auth → Providers → Google.
3. Supabase → Auth → URL config: site URL = Netlify URL (+ `http://localhost:5173`).
4. Netlify: new site from repo, env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Custom domain: CNAME in Squarespace DNS to the Netlify site.

---

### Task 1: Scaffold

**Files:** Create: Vite React-TS project at repo root, `netlify.toml`, `.env.example`, `.gitignore`, `src/supabase.ts`

- [ ] `npm create vite@latest . -- --template react-ts`, `npm i @supabase/supabase-js`, `npm i -D vitest`; add script `"test": "vitest run"`.
- [ ] `netlify.toml`: build `npm run build`, publish `dist`, SPA redirect `/* /index.html 200`.
- [ ] `src/supabase.ts`: `export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`.
- [ ] Verify: `npm run build` succeeds. `git init`, commit.

### Task 2: Schema + RLS

**Files:** Create `supabase/migrations/0001_init.sql`

- [ ] Write the schema in "Data model" above, plus seed categories from the spec table (Moradia, Financiamentos, Contas da casa, Seguros, Educação, Mercado, Saúde, Transporte, Taxas e câmbio → essential; Viagens, Passeios e lazer, Restaurantes, Compras, Assinaturas → adjustable; plus "Investimentos" not needed — investment is an entry kind).
- [ ] Verify with local Supabase (`npx supabase start`, `npx supabase db reset`): as an authenticated user whose email is not in `allowed_emails`, `select * from entries` returns 0 rows and an insert fails; after inserting the email, both work.
- [ ] Commit.

### Task 3: money + installments

**Files:** `src/lib/money.ts`, `src/lib/installments.ts`, tests beside them

**Produces:**
- `formatCents(cents: number, currency: 'EUR'|'BRL'): string` → `"€ 1.234,56"` / `"R$ 1.234,56"`
- `parseAmount(input: string): number` → cents; accepts `"1.234,56"`, `"1234,5"`, `"12"`
- `billDueDate(purchase: string, closingDay: number, dueDay: number): string` (ISO dates). Purchase day ≤ closing day → bill closing that month; otherwise next month. Due date = `dueDay` of the closing month if `dueDay > closingDay`, else of the following month. Days clamp to month end.
- `splitInstallments(totalCents: number, n: number): number[]` — sums exactly; remainder on the first.

- [ ] Tests: `parseAmount('1.234,56') === 123456`; `formatCents(123456,'EUR') === '€ 1.234,56'`; `billDueDate('2027-03-10', 10, 20) === '2027-03-20'`; `billDueDate('2027-03-11', 10, 20) === '2027-04-20'`; `billDueDate('2027-03-05', 25, 5) === '2027-04-05'`; `billDueDate('2027-02-15', 31, 10) === '2027-03-10'` (closing clamps to 28 Feb); `splitInstallments(10000, 3)` → `[3334, 3333, 3333]`.
- [ ] Run fail → implement → run pass → commit.

### Task 4: summary, fx, recurrence

**Files:** `src/lib/summary.ts`, `src/lib/fx.ts`, `src/lib/recurrence.ts`, tests, `src/types.ts`

**Produces:**
- `type Entry` mirroring the `entries` row (camelCase not needed — keep snake_case as returned by Supabase).
- `rateOn(rates: Record<string, number>, date: string): number` — EUR→BRL on date, falling back to the latest earlier date.
- `convert(cents: number, from: Currency, to: Currency, rate: number): number` (rounded to cent).
- `fetchRates(from: string, to: string): Promise<Record<string, number>>` — `https://api.frankfurter.dev/v1/{from}..{to}?from=EUR&to=BRL`, cached in localStorage (try/catch).
- `monthSummary(entries: Entry[], opts: { currency: Currency; rates: Record<string,number>; categoryType: (id: string|null) => 'essential'|'adjustable'|null; accountCurrency: (id: string) => Currency; includeInvestments: boolean }): { income: number; essential: number; adjustable: number; investment: number; result: number; savingsPct: number }`. `result = income − essential − adjustable − (includeInvestments ? investment : 0)`. Excludes `transfer`, `adjustment`, `deleted_at != null`, `status = 'pending'`.
- `suggestedAmount(history: number[]): number` — mean of last 3 values, rounded; empty → 0.

- [ ] Tests: transfer of −5000 € / +R$ … contributes 0 to every bucket; pending and deleted ignored; BRL expense converted at that date's rate into EUR view; `rateOn` on a Saturday returns Friday's rate; `includeInvestments` toggles `result` by exactly `investment`; `savingsPct` = 0 when income = 0; `suggestedAmount([100, 200, 300, 400]) === 300`.
- [ ] Run fail → implement → run pass → commit.

### Task 5: Auth gate + Accounts + Categories

**Files:** `src/App.tsx`, `src/pages/Accounts.tsx`, `src/pages/Categories.tsx`

- [ ] `App`: no session → "Entrar com Google" (`supabase.auth.signInWithOAuth({ provider: 'google' })`). Session but `allowed_emails` select returns nothing → "Acesso não autorizado" + sign out. Else tabs: Painel, Lançamentos, Contas, Categorias, Lixeira.
- [ ] Accounts: list grouped by country with balance (opening + sum of non-deleted entries); create/edit (name, country → currency, kind, opening balance, closing/due day for cards); archive.
- [ ] Categories: list by type; create, rename, change type; delete in use → choose target category, move entries, then archive.
- [ ] Verify manually against the Supabase project; commit.

### Task 6: Entries (form, list, filters, edit/delete)

**Files:** `src/pages/EntryForm.tsx`, `src/pages/Entries.tsx`, `src/pages/Trash.tsx`

- [ ] Form kinds: income, expense, transfer (from account, to account, amount out, amount in, optional fee → extra expense in "Taxas e câmbio", all with one `group_id`), investment, adjustment. Card expense with N > 1 → N rows via `splitInstallments` + `billDueDate`, same `group_id`, `installment_no/count`, `purchase_date`.
- [ ] Edit/delete of a grouped row asks scope: installments → "só esta / esta e as próximas / todas"; transfer → always the whole group; recurring → "só este mês / daqui para frente" (updates `recurrences` for the latter).
- [ ] Delete = set `deleted_at`; toast "Desfazer" for 5 s clears it. Trash lists rows with `deleted_at` in last 30 days, restore button.
- [ ] Filters: month/date range, country, account, category, type, tag, created_by, text search. Bulk change category on selected rows. Export filtered rows to CSV (opens in Excel).
- [ ] On app load, materialize current-month `pending` rows for active recurrences missing one, amount = `suggestedAmount` of the last 3 confirmed rows (fallback: recurrence amount). Pending rows show a "Confirmar" button.
- [ ] Verify manually; commit.

### Task 7: Dashboard

**Files:** `src/pages/Dashboard.tsx`

- [ ] Month picker, EUR/BRL switch, "descontar investimentos" toggle.
- [ ] Rows PT / BR / Total: income, outflow, result, % of income vs 20% goal.
- [ ] Essential vs adjustable totals + top 5 categories; flag essentials > 20% above their 3-month mean.
- [ ] Last 12 months income/outflow/result as a simple inline SVG bar chart (no chart lib).
- [ ] Next 3 months forecast: recurring income − mean essentials − installments already booked.
- [ ] Simulation input: "reduzir ajustáveis em X%" → extra savings.
- [ ] Verify manually; commit.

## Out of v1 (from spec)

Bank sync, PDF bill reading, investment tracking, store apps, notifications, multi-family. Trash purge after 30 days: hidden in UI only; add a `pg_cron` delete when storage matters.
