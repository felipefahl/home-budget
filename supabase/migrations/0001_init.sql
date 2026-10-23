-- Home budget v1. Run once in the Supabase SQL editor, then:
--   insert into allowed_emails values ('you@gmail.com'), ('wife@gmail.com');

create table allowed_emails (email text primary key check (email = lower(email)));

-- Every policy goes through this: only the two allowed Google accounts see anything.
create function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from allowed_emails where email = lower(auth.jwt() ->> 'email'))
$$;

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text not null check (country in ('PT', 'BR')),
  currency text generated always as (case country when 'PT' then 'EUR' else 'BRL' end) stored,
  kind text not null check (kind in ('bank', 'card', 'cash')),
  opening_balance_cents bigint not null default 0,
  closing_day int check (closing_day between 1 and 31),
  due_day int check (due_day between 1 and 31),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'card' or (closing_day is not null and due_day is not null))
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('essential', 'adjustable')),
  parent_id uuid references categories,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recurrences (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('income', 'expense')),
  account_id uuid not null references accounts,
  category_id uuid references categories,
  description text not null default '',
  amount_cents bigint not null,
  day_of_month int not null check (day_of_month between 1 and 31),
  start_month date not null,
  end_month date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('income', 'expense', 'transfer', 'investment', 'adjustment')),
  account_id uuid not null references accounts,
  -- signed: negative = money leaving the account
  amount_cents bigint not null check (amount_cents <> 0),
  date date not null,
  category_id uuid references categories,
  description text not null default '',
  tags text[] not null default '{}',
  group_id uuid,            -- links a transfer pair (+ fee), an installment set
  installment_no int,
  installment_count int,
  purchase_date date,
  recurrence_id uuid references recurrences,
  status text not null default 'confirmed' check (status in ('confirmed', 'pending')),
  created_by text default lower(auth.jwt() ->> 'email'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (case kind
    when 'income' then amount_cents > 0
    when 'expense' then amount_cents < 0
    when 'investment' then amount_cents < 0
    else true end)
);
create index on entries (date) where deleted_at is null;
create index on entries (group_id);
-- one entry per recurrence per date, so two devices opening the app at once don't duplicate it.
-- Not partial on purpose: upsert's ON CONFLICT needs a plain index; NULL recurrence_ids never collide.
create unique index entries_recurrence_once on entries (recurrence_id, date);

create table settings (key text primary key, value jsonb not null);

create table audit_log (
  id bigserial primary key,
  table_name text not null,
  row_id uuid not null,
  action text not null,
  old jsonb,
  new jsonb,
  actor text default lower(auth.jwt() ->> 'email'),
  at timestamptz not null default now()
);

create function touch_and_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  insert into audit_log (table_name, row_id, action, old, new)
  values (tg_table_name, coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id')::uuid,
          lower(tg_op), to_jsonb(old), to_jsonb(new));
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['accounts', 'categories', 'recurrences', 'entries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy allowed on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t);
    execute format('create trigger audit before insert or update or delete on %I for each row execute function touch_and_audit()', t);
  end loop;
end $$;

-- Read-only for the app: lets the UI tell "not authorized" apart from "no data".
alter table allowed_emails enable row level security;
create policy self on allowed_emails for select to authenticated using (email = lower(auth.jwt() ->> 'email'));
alter table audit_log enable row level security;
create policy allowed on audit_log for select to authenticated using (is_allowed());
alter table settings enable row level security;
create policy allowed on settings for all to authenticated using (is_allowed()) with check (is_allowed());
insert into settings values ('savings_goal_pct', '20');

-- Explicit grants, so the project can run with "Automatically expose new tables" off.
-- Only signed-in users get table access, and RLS above still decides which rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on accounts, categories, recurrences, entries, settings to authenticated;
grant select on allowed_emails, audit_log to authenticated;
revoke all on all tables in schema public from anon;

insert into categories (name, type) values
  ('Moradia', 'essential'), ('Financiamentos', 'essential'), ('Contas da casa', 'essential'),
  ('Seguros', 'essential'), ('Educação', 'essential'), ('Mercado', 'essential'),
  ('Saúde', 'essential'), ('Transporte', 'essential'), ('Taxas e câmbio', 'essential'),
  ('Viagens', 'adjustable'), ('Passeios e lazer', 'adjustable'), ('Restaurantes', 'adjustable'),
  ('Compras', 'adjustable'), ('Assinaturas', 'adjustable');
