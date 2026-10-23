// reset_trial against the real migrations in PGlite (runs as postgres, like the SQL editor).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'

const sql = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const db = new PGlite()
let acc = ''

beforeAll(async () => {
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth to authenticated, anon;
  `)
  await db.exec(sql('0001_init.sql'))
  await db.exec(sql('0002_reset_trial.sql'))
  acc = (await db.query<{ id: string }>(`insert into accounts (name, country, kind, opening_balance_cents) values ('Conta PT', 'PT', 'bank', 100000) returning id`)).rows[0].id
  await db.query(`
    insert into entries (kind, account_id, amount_cents, date, status, deleted_at) values
      ('expense', $1, -30000, '2026-11-10', 'confirmed', null),   -- real history: folds into the balance
      ('expense', $1,  -5000, '2026-12-31', 'pending',   null),   -- never confirmed: just goes
      ('expense', $1,  -2000, '2026-12-01', 'confirmed', now()),  -- in the trash: just goes
      ('expense', $1, -10000, '2027-01-20', 'confirmed', null)    -- installment in 2027: stays
  `, [acc])
})

test('preview shows the new opening balance and changes nothing', async () => {
  const { rows } = await db.query<{ opening_now: string; opening_after: string; entries_removed: number }>(`select * from preview_reset('2027-01-01')`)
  expect(rows[0]).toMatchObject({ opening_now: '1000.0000000000000000', opening_after: '700.0000000000000000' })
  expect(Number(rows[0].entries_removed)).toBe(3)
  expect((await db.query('select * from entries')).rows).toHaveLength(4)
})

test('app users cannot call the reset', async () => {
  await db.exec(`set role authenticated`)
  await expect(db.query(`select reset_trial('2027-01-01')`)).rejects.toThrow(/permission denied/)
  await db.exec(`reset role`)
})

test('reset keeps 2027, carries the balance over, and drops the old history', async () => {
  const { rows: [r] } = await db.query<{ reset_trial: string }>(`select reset_trial('2027-01-01')`)
  expect(r.reset_trial).toMatch(/^3 lançamentos/)
  const left = await db.query<{ date: string; amount_cents: string }>(`select date::text, amount_cents from entries`)
  expect(left.rows).toEqual([{ date: '2027-01-20', amount_cents: -10000 }])
  const opening = await db.query<{ opening_balance_cents: number }>(`select opening_balance_cents from accounts where id = $1`, [acc])
  expect(Number(opening.rows[0].opening_balance_cents)).toBe(70000) // 1000 − 300: same balance as before the reset
  const orphans = await db.query(`select 1 from audit_log l where table_name = 'entries' and not exists (select 1 from entries e where e.id = l.row_id)`)
  expect(orphans.rows).toHaveLength(0)
})
