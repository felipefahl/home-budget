import { check, type Data } from './data'
import { supabase } from './supabase'
import type { Entry } from './types'

export type Scope = 'one' | 'next' | 'all'

/** Which rows an edit/delete on `e` touches. Transfers always move as a whole group. */
export function scopeIds(e: Entry, scope: Scope, data: Data): string[] {
  if (!e.group_id) return [e.id]
  const group = data.entries.filter(x => x.group_id === e.group_id && !x.deleted_at)
  if (e.kind === 'transfer' || group.some(x => x.kind === 'transfer') || scope === 'all') return group.map(x => x.id)
  if (scope === 'next') return group.filter(x => (x.installment_no ?? 0) >= (e.installment_no ?? 0)).map(x => x.id)
  return [e.id]
}

export const softDelete = async (ids: string[]) =>
  check(await supabase.from('entries').update({ deleted_at: new Date().toISOString() }).in('id', ids))

export const restore = async (ids: string[]) =>
  check(await supabase.from('entries').update({ deleted_at: null }).in('id', ids))

/** Put rows back exactly as they were (used by "Desfazer" after an edit). */
export async function putBack(rows: Entry[]) {
  for (const { id, ...rest } of rows) check(await supabase.from('entries').update(rest).eq('id', id))
}
