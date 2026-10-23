import { supabase } from './supabase'
import { suggestedAmount } from './lib/recurrence'
import type { Account, Category, Entry, Recurrence } from './types'

export interface Data {
  accounts: Account[]
  categories: Category[]
  recurrences: Recurrence[]
  entries: Entry[]
  goalPct: number
}

export const today = () => new Date().toISOString().slice(0, 10)
export const monthOf = (date: string) => date.slice(0, 7)
export const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}

/** Throws on a Supabase error so callers can show it. */
export function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

// Supabase caps a select at 1000 rows; page through.
// ponytail: loads every entry into memory, fine for a household (~1-2k/year); filter server-side past ~50k
async function selectAll<T>(table: string, orderBy = 'id'): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const page = check(await supabase.from(table).select('*').order(orderBy).range(from, from + 999)) as T[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}

export async function loadAll(): Promise<Data> {
  const [accounts, categories, recurrences, entries, settings] = await Promise.all([
    selectAll<Account>('accounts'),
    selectAll<Category>('categories'),
    selectAll<Recurrence>('recurrences'),
    selectAll<Entry>('entries'),
    selectAll<{ key: string; value: number }>('settings', 'key'),
  ])
  categories.sort((a, b) => a.name.localeCompare(b.name, 'pt'))
  accounts.sort((a, b) => a.name.localeCompare(b.name, 'pt'))
  entries.sort((a, b) => b.date.localeCompare(a.date))
  const goalPct = settings.find(s => s.key === 'savings_goal_pct')?.value ?? 20
  return { accounts, categories, recurrences, entries, goalPct }
}

/** Creates this month's pending entry for each active recurrence that has none yet. Returns true if it added any. */
export async function materializeRecurrences(d: Data): Promise<boolean> {
  const month = monthOf(today())
  const rows = d.recurrences
    .filter(r => r.start_month.slice(0, 7) <= month && (!r.end_month || r.end_month.slice(0, 7) >= month))
    // any entry this month counts, deleted too: deleting this month's one means "not this month"
    .filter(r => !d.entries.some(e => e.recurrence_id === r.id && monthOf(e.date) === month))
    .map(r => {
      const history = d.entries
        .filter(e => e.recurrence_id === r.id && e.status === 'confirmed' && !e.deleted_at)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(e => e.amount_cents)
      const [y, m] = month.split('-').map(Number)
      const day = Math.min(r.day_of_month, new Date(Date.UTC(y, m, 0)).getUTCDate())
      return {
        kind: r.kind, account_id: r.account_id, category_id: r.category_id, description: r.description,
        amount_cents: suggestedAmount(history) || r.amount_cents,
        date: `${month}-${String(day).padStart(2, '0')}`, recurrence_id: r.id, status: 'pending',
      }
    })
  if (!rows.length) return false
  // the unique index drops the race where both devices insert at once
  await supabase.from('entries').upsert(rows, { onConflict: 'recurrence_id,date', ignoreDuplicates: true })
  return true
}

/** "Viagens › Passagens" for a subcategory, plain name otherwise. */
export function catLabel(id: string | null, categories: Category[]): string {
  const c = categories.find(x => x.id === id)
  if (!c) return ''
  const p = categories.find(x => x.id === c.parent_id)
  return p ? `${p.name} › ${c.name}` : c.name
}

/** Categories sorted by their label, so subcategories sit under their parent. */
export const byLabel = (categories: Category[]) =>
  [...categories].sort((a, b) => catLabel(a.id, categories).localeCompare(catLabel(b.id, categories), 'pt'))
