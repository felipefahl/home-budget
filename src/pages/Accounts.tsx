import { useState } from 'react'
import type { PageProps } from '../App'
import { addMonths, check, monthOf, today } from '../data'
import { ACCOUNT_KIND, COUNTRY, fmtMonth } from '../labels'
import { billDueDate } from '../lib/installments'
import { formatCents, parseAmount, toInput } from '../lib/money'
import { supabase } from '../supabase'
import type { Account, Country } from '../types'

type Draft = { id?: string; name: string; country: Country; kind: Account['kind']; opening: string; closing_day: string; due_day: string }
const blank: Draft = { name: '', country: 'PT', kind: 'bank', opening: '0', closing_day: '', due_day: '' }

export default function Accounts({ data, reload, notify }: PageProps) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [err, setErr] = useState('')
  const now = today()

  const live = data.entries.filter(e => !e.deleted_at && e.status === 'confirmed')
  const balance = (a: Account) => a.opening_balance_cents + live.filter(e => e.account_id === a.id && e.date <= now).reduce((s, e) => s + e.amount_cents, 0)
  const bill = (a: Account, month: string) => live.filter(e => e.account_id === a.id && monthOf(e.date) === month && e.amount_cents < 0).reduce((s, e) => s - e.amount_cents, 0)
  const committed = (a: Account) => live.filter(e => e.account_id === a.id && e.date > now && e.amount_cents < 0).reduce((s, e) => s - e.amount_cents, 0)

  async function save() {
    if (!draft) return
    const opening = parseAmount(draft.opening || '0')
    if (!draft.name.trim() || Number.isNaN(opening)) return setErr('Preencha o nome e um saldo válido.')
    const row = {
      name: draft.name.trim(), country: draft.country, kind: draft.kind, opening_balance_cents: opening,
      closing_day: draft.kind === 'card' ? Number(draft.closing_day) || null : null,
      due_day: draft.kind === 'card' ? Number(draft.due_day) || null : null,
    }
    if (draft.kind === 'card' && (!row.closing_day || !row.due_day)) return setErr('Cartão precisa do dia de fechamento e de vencimento.')
    try {
      check(draft.id ? await supabase.from('accounts').update(row).eq('id', draft.id) : await supabase.from('accounts').insert(row))
      const old = data.accounts.find(a => a.id === draft.id)
      let moved = 0
      if (old?.kind === 'card' && row.closing_day && row.due_day && (old.closing_day !== row.closing_day || old.due_day !== row.due_day)) {
        // future bills follow the new days; past bills stay as they were
        for (const e of data.entries.filter(e => e.account_id === old.id && e.date > now && e.purchase_date && !e.deleted_at)) {
          const date = billDueDate(e.purchase_date!, row.closing_day, row.due_day, (e.installment_no ?? 1) - 1)
          if (date !== e.date) { check(await supabase.from('entries').update({ date }).eq('id', e.id)); moved++ }
        }
      }
      setDraft(null); setErr('')
      notify({ msg: moved ? `Conta salva. ${moved} lançamentos futuros mudaram de fatura.` : 'Conta salva.' })
      await reload()
    } catch (e) { setErr((e as Error).message) }
  }

  async function archive(a: Account) {
    const archived_at = a.archived_at ? null : new Date().toISOString()
    check(await supabase.from('accounts').update({ archived_at }).eq('id', a.id))
    notify({ msg: archived_at ? 'Conta arquivada.' : 'Conta reativada.', undo: async () => check(await supabase.from('accounts').update({ archived_at: a.archived_at }).eq('id', a.id)) })
    await reload()
  }

  async function remove(a: Account) {
    if (data.entries.some(e => e.account_id === a.id)) return notify({ msg: 'Essa conta tem lançamentos: arquive em vez de apagar.' })
    if (!confirm(`Apagar a conta "${a.name}"?`)) return
    check(await supabase.from('accounts').delete().eq('id', a.id))
    await reload()
  }

  const months = [0, 1, 2, 3, 4, 5].map(i => addMonths(monthOf(now), i))
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Contas</h1>
        <div className="row">
          <label className="inline"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Mostrar arquivadas</label>
          <button className="primary" onClick={() => setDraft(blank)}>Nova conta</button>
        </div>
      </div>
      {(['PT', 'BR'] as Country[]).map(c => {
        const list = data.accounts.filter(a => a.country === c && (showArchived || !a.archived_at))
        const cur = c === 'PT' ? 'EUR' : 'BRL'
        return (
          <div className="card" key={c}>
            <h2 style={{ marginTop: 0 }}>{COUNTRY[c]} <span className="muted small">total {formatCents(list.filter(a => a.kind !== 'card').reduce((s, a) => s + balance(a), 0), cur)} (sem cartões)</span></h2>
            {!list.length && <p className="muted">Nenhuma conta.</p>}
            <div className="table-wrap"><table>
              <tbody>
                {list.map(a => (
                  <tr key={a.id} className={a.archived_at ? 'muted' : ''}>
                    <td>{a.name}<span className="badge">{ACCOUNT_KIND[a.kind]}</span>{a.archived_at && <span className="badge">arquivada</span>}
                      {a.kind === 'card' && (
                        <div className="small muted">
                          Fecha dia {a.closing_day}, vence dia {a.due_day}. Faturas: {months.map(m => `${fmtMonth(m)} ${formatCents(bill(a, m), cur)}`).join(' · ')}
                          <br />Já comprometido em parcelas futuras: {formatCents(committed(a), cur)}
                        </div>
                      )}
                    </td>
                    <td className="num">{formatCents(balance(a), cur)}</td>
                    <td className="num">
                      <button className="link" onClick={() => setDraft({ id: a.id, name: a.name, country: a.country, kind: a.kind, opening: toInput(a.opening_balance_cents), closing_day: String(a.closing_day ?? ''), due_day: String(a.due_day ?? '') })}>Editar</button>
                      <button className="link" onClick={() => archive(a)}>{a.archived_at ? 'Reativar' : 'Arquivar'}</button>
                      <button className="link danger" onClick={() => remove(a)}>Apagar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )
      })}
      {draft && (
        <dialog open>
          <div className="stack">
            <h2 style={{ marginTop: 0 }}>{draft.id ? 'Editar conta' : 'Nova conta'}</h2>
            <label>Nome<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} autoFocus /></label>
            <div className="row">
              <label>País<select value={draft.country} disabled={!!draft.id} onChange={e => setDraft({ ...draft, country: e.target.value as Country })}>
                <option value="PT">Portugal (EUR)</option><option value="BR">Brasil (BRL)</option></select></label>
              <label>Tipo<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Account['kind'] })}>
                {Object.entries(ACCOUNT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Saldo inicial<input inputMode="decimal" value={draft.opening} onChange={e => setDraft({ ...draft, opening: e.target.value })} /></label>
            </div>
            {draft.kind === 'card' && (
              <div className="row">
                <label>Dia de fechamento<input type="number" min={1} max={31} value={draft.closing_day} onChange={e => setDraft({ ...draft, closing_day: e.target.value })} /></label>
                <label>Dia de vencimento<input type="number" min={1} max={31} value={draft.due_day} onChange={e => setDraft({ ...draft, due_day: e.target.value })} /></label>
              </div>
            )}
            {err && <p className="error">{err}</p>}
            <div className="row"><button className="primary" onClick={save}>Salvar</button><button onClick={() => { setDraft(null); setErr('') }}>Cancelar</button></div>
          </div>
        </dialog>
      )}
    </>
  )
}
