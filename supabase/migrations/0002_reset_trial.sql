-- Ends the trial period: everything dated before `cutoff` goes, the account balances carry over.
-- Run this file once in the SQL editor. Later, when you decide:
--   select * from preview_reset('2027-01-01');   -- read-only: what would change
--   select reset_trial('2027-01-01');             -- does it
-- Only the SQL editor (postgres) can call these; the app's users can't.

-- What each account looks like after a reset: opening balance absorbs the confirmed history before cutoff.
create function preview_reset(cutoff date)
returns table (account text, currency text, opening_now numeric, opening_after numeric, entries_removed bigint)
language sql stable as $$
  select a.name, a.currency,
         a.opening_balance_cents / 100.0,
         (a.opening_balance_cents + coalesce(sum(e.amount_cents) filter (
            where e.date < cutoff and e.deleted_at is null and e.status = 'confirmed'), 0)) / 100.0,
         count(e.id) filter (where e.date < cutoff)
  from accounts a left join entries e on e.account_id = a.id
  group by a.id order by a.name
$$;

create function reset_trial(cutoff date) returns text
language plpgsql as $$
declare removed bigint;
begin
  update accounts a set opening_balance_cents = opening_balance_cents + coalesce((
    select sum(e.amount_cents) from entries e
    where e.account_id = a.id and e.date < cutoff and e.deleted_at is null and e.status = 'confirmed'), 0);
  delete from entries where date < cutoff;
  get diagnostics removed = row_count;
  -- history of rows that no longer exist (including this delete)
  delete from audit_log l where l.table_name = 'entries' and not exists (select 1 from entries e where e.id = l.row_id);
  return format('%s lançamentos antes de %s apagados; saldos iniciais ajustados.', removed, cutoff);
end $$;

revoke all on function preview_reset(date), reset_trial(date) from public, anon, authenticated;
