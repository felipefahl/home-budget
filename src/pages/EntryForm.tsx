import { useEffect, useState } from 'react'
import type { Toast } from '../App'
import { putBack, scopeIds, softDelete, type Scope } from '../actions'
import { byLabel, catLabel, check, monthOf, today, type Data } from '../data'
import { fmtDate, fmtMonth, KIND } from '../labels'
import { billDueDate, replanInstallments, simulatePurchase, splitInstallments } from '../lib/installments'
import { formatCents, parseAmount, toInput } from '../lib/money'
import { supabase } from '../supabase'
import type { Entry, EntryKind } from '../types'

interface Props { data: Data; entry?: Entry; onDone: (t: Toast) => void; onCancel: () => void }
interface Audit { at: string; actor: string | null; action: string }

const cents = (n: number) => toInput(Math.abs(n))

export default function EntryForm({ data, entry, onDone, onCancel }: Props) {
  const accounts = data.accounts.filter(a => !a.archived_at || a.id === entry?.account_id)
  const cats = byLabel(data.categories.filter(c => !c.archived_at || c.id === entry?.category_id))
  const group = entry?.group_id ? data.entries.filter(x => x.group_id === entry.group_id && !x.deleted_at) : []
  const isInstallment = !!entry?.installment_count
  const recurrence = data.recurrences.find(r => r.id === entry?.recurrence_id)

  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? 'expense')
  const [date, setDate] = useState(entry?.purchase_date ?? entry?.date ?? today())
  const [accountId, setAccountId] = useState(entry?.account_id ?? accounts[0]?.id ?? '')
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? '')
  const [amount, setAmount] = useState(entry ? (entry.kind === 'adjustment' ? toInput(entry.amount_cents) : cents(entry.amount_cents)) : '')
  const [amountIn, setAmountIn] = useState('')
  const [fee, setFee] = useState('')
  const [categoryId, setCategoryId] = useState(entry?.category_id ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [tags, setTags] = useState(entry?.tags.join(', ') ?? '')
  const [count, setCount] = useState(String(entry?.installment_count ?? 1))
  const [total, setTotal] = useState(isInstallment ? cents(group.reduce((s, x) => s + x.amount_cents, 0)) : '')
  const [repeat, setRepeat] = useState(false)
  const [scope, setScope] = useState<Scope>('one')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<Audit[]>([])

  useEffect(() => {
    if (!entry) return
    supabase.from('audit_log').select('at, actor, action').eq('row_id', entry.id).order('at', { ascending: false })
      .then(({ data }) => setHistory(data ?? []))
  }, [entry])

  const account = data.accounts.find(a => a.id === accountId)
  const toAccount = data.accounts.find(a => a.id === toAccountId)
  const isCard = account?.kind === 'card'
  const tagList = tags.split(',').map(t => t.trim()).filter(Boolean)

  async function create(): Promise<Toast> {
    const value = parseAmount(amount)
    if (!account || Number.isNaN(value) || value === 0) throw new Error('Informe conta e valor.')
    const base = { account_id: account.id, description: description.trim(), tags: tagList, category_id: categoryId || null }
    let rows: Record<string, unknown>[] = []

    if (kind === 'transfer') {
      const valueIn = amountIn ? parseAmount(amountIn) : account.currency === toAccount?.currency ? value : NaN
      if (!toAccount || toAccount.id === account.id || Number.isNaN(valueIn)) throw new Error('Escolha a conta de destino e quanto chegou.')
      const group_id = crypto.randomUUID()
      const text = description.trim() || `${account.name} → ${toAccount.name}`
      rows = [
        { ...base, category_id: null, kind, group_id, date, amount_cents: -Math.abs(value), description: text },
        { ...base, category_id: null, kind, group_id, date, account_id: toAccount.id, amount_cents: Math.abs(valueIn), description: text },
      ]
      const feeValue = fee ? parseAmount(fee) : 0
      if (Number.isNaN(feeValue)) throw new Error('Taxa inválida.')
      if (feeValue) rows.push({
        ...base, kind: 'expense', group_id, date, amount_cents: -Math.abs(feeValue), description: `Taxa: ${text}`,
        category_id: data.categories.find(c => c.name === 'Taxas e câmbio')?.id ?? null,
      })
    } else if (kind === 'expense' && isCard) {
      const n = Math.max(1, Number(count) || 1)
      const group_id = n > 1 ? crypto.randomUUID() : null
      rows = splitInstallments(-Math.abs(value), n).map((amount_cents, k) => ({
        ...base, kind, amount_cents, purchase_date: date, group_id,
        date: billDueDate(date, account.closing_day!, account.due_day!, k),
        installment_no: n > 1 ? k + 1 : null, installment_count: n > 1 ? n : null,
      }))
    } else {
      const amount_cents = kind === 'income' ? Math.abs(value) : kind === 'adjustment' ? value : -Math.abs(value)
      let recurrence_id = null
      if (repeat && (kind === 'income' || kind === 'expense')) {
        const [r] = check(await supabase.from('recurrences').insert({
          kind, account_id: account.id, category_id: base.category_id, description: base.description, amount_cents,
          day_of_month: Number(date.slice(8)), start_month: `${monthOf(date)}-01`,
        }).select('id'))
        recurrence_id = r.id
      }
      rows = [{ ...base, category_id: kind === 'income' || kind === 'expense' ? base.category_id : null, kind, date, amount_cents, recurrence_id }]
    }
    const ids = check(await supabase.from('entries').insert(rows).select('id')).map((r: { id: string }) => r.id)
    return { msg: rows.length > 1 ? `${rows.length} lançamentos criados.` : 'Lançamento criado.', undo: () => softDelete(ids) }
  }

  async function edit(e: Entry): Promise<Toast> {
    const value = parseAmount(amount)
    if (Number.isNaN(value) || value === 0) throw new Error('Valor inválido.')
    const signed = e.kind === 'adjustment' ? value : Math.sign(e.amount_cents) * Math.abs(value)
    const shared = { description: description.trim(), tags: tagList, category_id: categoryId || null }

    // new total or count on a card purchase: re-plan the parcels not yet due
    if (isInstallment && account?.closing_day && (parseAmount(total) !== Math.abs(group.reduce((s, x) => s + x.amount_cents, 0)) || Number(count) !== e.installment_count)) {
      const plan = replanInstallments({
        parcels: group.map(x => ({ id: x.id, installment_no: x.installment_no!, amount_cents: x.amount_cents, date: x.date })),
        purchaseDate: e.purchase_date!, closingDay: account.closing_day, dueDay: account.due_day!,
        newTotal: -Math.abs(parseAmount(total)), newCount: Number(count), today: today(),
      })
      await softDelete(plan.deleteIds)
      const before = group.filter(x => !plan.deleteIds.includes(x.id))
      check(await supabase.from('entries').update({ installment_count: Number(count), ...shared }).in('id', before.map(x => x.id)))
      const created = check(await supabase.from('entries').insert(plan.create.map(p => ({
        ...shared, ...p, kind: 'expense', account_id: e.account_id, purchase_date: e.purchase_date, group_id: e.group_id,
        installment_count: Number(count),
      }))).select('id')).map((r: { id: string }) => r.id)
      return {
        msg: `Parcelas refeitas: ${plan.create.length} novas.`,
        undo: async () => { await softDelete(created); await putBack(group); await supabase.from('entries').update({ deleted_at: null }).in('id', plan.deleteIds) },
      }
    }

    const ids = scopeIds(e, e.kind === 'transfer' ? 'one' : scope, data).filter(id => e.kind !== 'transfer' || id === e.id)
    const before = data.entries.filter(x => ids.includes(x.id))
    // amount, date and account only change on this row; text fields follow the scope
    check(await supabase.from('entries').update(e.kind === 'transfer' ? { description: shared.description, tags: shared.tags } : shared).in('id', ids))
    check(await supabase.from('entries').update({
      amount_cents: signed, account_id: accountId,
      ...(isInstallment ? {} : { date }), status: 'confirmed',
    }).eq('id', e.id))
    if (recurrence && scope === 'next') {
      check(await supabase.from('recurrences').update({ description: shared.description, category_id: shared.category_id, amount_cents: signed, account_id: accountId }).eq('id', recurrence.id))
    }
    return { msg: 'Alterações salvas.', undo: () => putBack(before) }
  }

  async function endRecurrence() {
    if (!recurrence || !entry) return
    check(await supabase.from('recurrences').update({ end_month: `${monthOf(entry.date)}-01` }).eq('id', recurrence.id))
    onDone({ msg: `Repetição encerrada em ${monthOf(entry.date)}. Os meses anteriores ficam.` })
  }

  async function submit() {
    setBusy(true); setErr('')
    try { onDone(entry ? await edit(entry) : await create()) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const showCategory = kind === 'income' || kind === 'expense'
  return (
    <dialog open>
      <div className="stack">
        <h2 style={{ marginTop: 0 }}>{entry ? `Editar ${KIND[entry.kind].toLowerCase()}` : 'Novo lançamento'}
          {entry?.status === 'pending' && <span className="badge">a confirmar</span>}</h2>
        {!entry && (
          <div className="row">{(Object.keys(KIND) as EntryKind[]).map(k => (
            <button key={k} className={k === kind ? 'primary' : ''} onClick={() => setKind(k)}>{KIND[k]}</button>
          ))}</div>
        )}
        <div className="row">
          <label>{isCard && kind === 'expense' ? 'Data da compra' : 'Data'}<input type="date" value={date} disabled={isInstallment} onChange={e => setDate(e.target.value)} /></label>
          <label>{kind === 'transfer' ? 'De' : 'Conta'}<select value={accountId} disabled={entry?.kind === 'transfer'} onChange={e => setAccountId(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></label>
          {kind === 'transfer' && !entry && (
            <label>Para<select value={toAccountId} onChange={e => setToAccountId(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></label>
          )}
        </div>
        <div className="row">
          <label>{kind === 'transfer' && !entry ? `Saiu (${account?.currency ?? ''})` : isInstallment ? 'Valor desta parcela' : kind === 'adjustment' ? 'Diferença (use - para diminuir)' : 'Valor'}
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" autoFocus /></label>
          {kind === 'transfer' && !entry && (
            <>
              <label>Chegou ({toAccount?.currency ?? ''})<input inputMode="decimal" value={amountIn} onChange={e => setAmountIn(e.target.value)} placeholder={account?.currency === toAccount?.currency ? 'igual' : '0,00'} /></label>
              <label>Taxa ({account?.currency ?? ''})<input inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} placeholder="0,00" /></label>
            </>
          )}
          {kind === 'expense' && isCard && !entry && (
            <label>Parcelas<input type="number" min={1} max={48} value={count} onChange={e => setCount(e.target.value)} /></label>
          )}
          {isInstallment && (
            <>
              <label>Total da compra<input inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></label>
              <label>Parcelas<input type="number" min={1} max={48} value={count} onChange={e => setCount(e.target.value)} /></label>
            </>
          )}
        </div>
        {kind === 'expense' && isCard && !entry && Number(count) > 1 && parseAmount(amount) > 0 && account && (
          <div className="small">
            <p className="muted" style={{ margin: '0 0 4px' }}>
              {Number(count)}x de {formatCents(Math.ceil(parseAmount(amount) / Number(count)), account.currency)}, a primeira na fatura de {fmtDate(billDueDate(date, account.closing_day!, account.due_day!))}. Como ficam as faturas:
            </p>
            <table>
              <thead><tr><th>Fatura</th><th className="num">Já tem</th><th className="num">Esta compra</th><th className="num">Total</th></tr></thead>
              <tbody>{simulatePurchase({
                purchaseDate: date, closingDay: account.closing_day!, dueDay: account.due_day!,
                totalCents: parseAmount(amount), count: Math.min(48, Number(count)),
                existing: data.entries.filter(e => e.account_id === account.id && !e.deleted_at),
              }).map(r => (
                <tr key={r.month}><td>{fmtMonth(r.month)}</td><td className="num">{formatCents(r.existing, account.currency)}</td>
                  <td className="num">{formatCents(r.added, account.currency)}</td><td className="num"><b>{formatCents(r.total, account.currency)}</b></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {showCategory && (
          <label>Categoria<select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">Sem categoria</option>
            {cats.map(c => <option key={c.id} value={c.id}>{catLabel(c.id, data.categories)}</option>)}</select></label>
        )}
        <label>Descrição<input value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label>Etiquetas (separadas por vírgula)<input value={tags} onChange={e => setTags(e.target.value)} placeholder="Viagem Brasil Dez/26" /></label>
        {!entry && !isCard && (kind === 'income' || kind === 'expense') && (
          <label className="inline"><input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /> Repete todo mês</label>
        )}
        {entry && isInstallment && (
          <label>Aplicar categoria, descrição e etiquetas a<select value={scope} onChange={e => setScope(e.target.value as Scope)}>
            <option value="one">Só esta parcela</option><option value="next">Esta e as próximas</option><option value="all">Todas as parcelas</option></select></label>
        )}
        {entry && recurrence && (
          <div className="row">
            <label>Aplicar a<select value={scope} onChange={e => setScope(e.target.value as Scope)}>
              <option value="one">Só este mês</option><option value="next">Daqui para frente</option></select></label>
            {!recurrence.end_month && <button onClick={endRecurrence}>Encerrar repetição</button>}
          </div>
        )}
        {entry?.kind === 'transfer' && <p className="small muted">Alterar o valor muda só este lado; os dois lados continuam ligados.</p>}
        {err && <p className="error">{err}</p>}
        <div className="row">
          <button className="primary" disabled={busy} onClick={submit}>{entry?.status === 'pending' ? 'Confirmar' : 'Salvar'}</button>
          <button onClick={onCancel}>Cancelar</button>
        </div>
        {history.length > 0 && (
          <details className="small muted"><summary>Histórico</summary>
            {history.map((h, i) => <div key={i}>{new Date(h.at).toLocaleString('pt-BR')}: {h.action === 'insert' ? 'criado' : h.action === 'update' ? 'alterado' : 'apagado'} por {h.actor ?? '?'}</div>)}
          </details>
        )}
      </div>
    </dialog>
  )
}
