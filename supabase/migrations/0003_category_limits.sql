-- Optional monthly spending limit per category (meant for adjustable ones). Run once in the SQL editor.
-- A subcategory's spend counts toward its parent's limit.
alter table categories
  add column monthly_limit_cents bigint check (monthly_limit_cents > 0),
  add column limit_currency text not null default 'EUR' check (limit_currency in ('EUR', 'BRL'));
