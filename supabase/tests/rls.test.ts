// Runs the real migration in PGlite (Postgres in WASM) with a stub of Supabase's auth schema.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, expect, test } from 'vitest'

const sql = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const ALLOWED = '00000000-0000-0000-0000-000000000001'
const db = new PGlite()

const as = (email: string, sub: string) =>
  db.exec(`reset role; set request.jwt.claims = '${JSON.stringify({ email, sub })}'; set role authenticated;`)

beforeAll(async () => {
  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  `)
  await db.exec(sql('0001_init.sql'))
  await db.exec(sql('0003_category_limits.sql'))
  await db.exec(`
    -- no blanket grants here: the migration's own grants must be enough
    -- (same as a project created with "Automatically expose new tables" off)
    grant usage on schema auth to authenticated, anon;
    insert into allowed_emails values ('ok@gmail.com');
  `)
})

test('anon (not signed in) has no table access', async () => {
  await db.exec(`reset role; set role anon;`)
  await expect(db.query('select * from categories')).rejects.toThrow(/permission denied/)
})

test('stranger sees nothing and cannot write', async () => {
  await as('stranger@gmail.com', '00000000-0000-0000-0000-000000000002')
  expect((await db.query('select * from categories')).rows).toHaveLength(0)
  expect((await db.query('select * from allowed_emails')).rows).toHaveLength(0)
  await expect(db.query(`insert into accounts (name, country, kind) values ('x', 'PT', 'bank')`)).rejects.toThrow(
    /row-level security/,
  )
})

test('allowed user (any email case) reads, writes, and is audited', async () => {
  await as('OK@gmail.com', ALLOWED)
  expect((await db.query('select * from categories')).rows).toHaveLength(14)
  expect((await db.query('select * from allowed_emails')).rows).toHaveLength(1)

  const { rows } = await db.query<{ id: string; currency: string }>(
    `insert into accounts (name, country, kind) values ('Conta BR', 'BR', 'bank') returning id, currency`,
  )
  expect(rows[0].currency).toBe('BRL')
  const acc = rows[0].id

  await db.query(`insert into entries (kind, account_id, amount_cents, date) values ('expense', $1, -1000, '2027-01-05')`, [acc])
  await expect(
    db.query(`insert into entries (kind, account_id, amount_cents, date) values ('expense', $1, 1000, '2027-01-05')`, [acc]),
  ).rejects.toThrow(/check constraint/)

  await db.query(`update entries set description = 'mercado' where account_id = $1`, [acc])
  const audit = await db.query<{ action: string; actor: string }>(
    `select action, actor from audit_log where table_name = 'entries' order by id`,
  )
  expect(audit.rows.map(r => r.action)).toEqual(['insert', 'update'])
  expect(audit.rows[1].actor).toBe('ok@gmail.com')
})

test('card account requires closing and due day', async () => {
  await as('ok@gmail.com', ALLOWED)
  await expect(db.query(`insert into accounts (name, country, kind) values ('Cartão', 'PT', 'card')`)).rejects.toThrow(
    /check constraint/,
  )
})

test('category limit: app users can set it, zero or negative is rejected', async () => {
  await as('ok@gmail.com', ALLOWED)
  await db.query(`update categories set monthly_limit_cents = 30000, limit_currency = 'BRL' where name = 'Viagens'`)
  const { rows } = await db.query<{ monthly_limit_cents: number; limit_currency: string }>(`select monthly_limit_cents, limit_currency from categories where name = 'Viagens'`)
  expect(rows[0]).toEqual({ monthly_limit_cents: 30000, limit_currency: 'BRL' })
  await expect(db.query(`update categories set monthly_limit_cents = 0 where name = 'Viagens'`)).rejects.toThrow(/check constraint/)
})
