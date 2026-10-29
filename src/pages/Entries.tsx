import { useMemo, useState } from 'react'
import type { PageProps } from '../App'
import { restore, scopeIds, softDelete, type Scope } from '../actions'
import { addMonths, byLabel, catLabel, check, monthOf, today } from '../data'
import { COUNTRY, fmtDate, KIND, TYPE } from '../labels'
import { formatCents } from '../lib/money'
import { supabase } from '../supabase'
import type { CategoryType, Country, Entry, EntryKind } from '../types'
import EntryForm from './EntryForm'

const monthEnd = (m: string) => `${addMonths(m, 1)}-01` // exclusive

export default function Entries({ data, reload, notify }: PageProps) {
  const month = monthOf(today())
  const [from, setFrom] = useState(`${month}-01`)
  const [to, setTo] = useState(new Date(Date.parse(monthEnd(month)) - 864e5).toISOString().slice(0, 10))
  const [country, setCountry] = useState<Country | ''>('')
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [type, setType] = useState<CategoryType | ''>('')
  const [kind, setKind] = useState<EntryKind | ''>('')
  const [tag, setTag] = useState('')
  const [who, setWho] = useState('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Entry | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Entry | null>(null)

  const acc = (id: string) => data.accounts.find(a => a.id === id)
  const cat = (id: string | null) => data.categories.find(c => c.id === id)
  const tags = [...new Set(data.entries.flatMap(e => e.tags))].sort()
  const people = [...new Set(data.entries.map(e => e.created_by).filter(Boolean))] as string[]

  const rows = useMemo(() => data.entries.filter(e =>
    !e.deleted_at && e.date >= from && e.date <= to &&
    (!country || acc(e.account_id)?.country === country) &&
    (!accountId || e.account_id === accountId) &&
    (!categoryId || e.category_id === categoryId || cat(e.category_id)?.parent_id === categoryId) &&
    (!type || (e.kind === 'expense' && (cat(e.category_id)?.type ?? 'essential') === type)) &&
    (!kind || e.kind === kind) &&
    (!tag || e.tags.includes(tag)) &&
    (!who || e.created_by === who) &&
    (!q || e.description.toLowerCase().includes(q.toLowerCase())),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [data, from, to, country, accountId, categoryId, type, kind, tag, who, q])

  const setMonth = (m: string) => { setFrom(`${m}-01`); setTo(new Date(Date.parse(monthEnd(m)) - 864e5).toISOString().slice(0, 10)) }

  async function doDelete(e: Entry, scope: Scope) {
    const ids = scopeIds(e, scope, data)
    await softDelete(ids)
    setDeleting(null)
    notify({ msg: ids.length > 1 ? `${ids.length} lançamentos na lixeira.` : 'Lançamento na lixeira.', undo: () => restore(ids) })
    await reload()
  }

  function askDelete(e: Entry) {
    if (e.installment_count) return setDeleting(e)
    const n = scopeIds(e, 'all', data).length
    if (confirm(n > 1 ? `Apagar a transferência inteira (${n} lançamentos ligados)?` : `Apagar "${e.description || KIND[e.kind]}"?`)) doDelete(e, 'all')
  }

  async function bulkCategory(id: string) {
    const ids = [...selected]
    const before = data.entries.filter(e => ids.includes(e.id)).map(e => ({ id: e.id, category_id: e.category_id }))
    check(await supabase.from('entries').update({ category_id: id || null }).in('id', ids))
    setSelected(new Set())
    notify({
      msg: `Categoria alterada em ${ids.length} lançamentos.`,
      undo: async () => { for (const b of before) await supabase.from('entries').update({ category_id: b.category_id }).eq('id', b.id) },
    })
    await reload()
  }

  function exportCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    const lines = [['Data', 'Tipo', 'Conta', 'Moeda', 'Valor', 'Categoria', 'Tipo de categoria', 'Descrição', 'Etiquetas', 'Parcela', 'Status', 'Quem'].join(';')]
    for (const e of rows) {
      const a = acc(e.account_id), c = cat(e.category_id)
      lines.push([
        e.date, KIND[e.kind], a?.name ?? '', a?.currency ?? '', (e.amount_cents / 100).toFixed(2).replace('.', ','),
        catLabel(e.category_id, data.categories), e.kind === 'expense' ? TYPE[c?.type ?? 'essential'] : '', e.description, e.tags.join(', '),
        e.installment_count ? `${e.installment_no}/${e.installment_count}` : '', e.status === 'pending' ? 'a confirmar' : '', e.created_by ?? '',
      ].map(v => esc(String(v))).join(';'))
    }
    // BOM + ';' so Excel in pt/br opens it with accents and columns right
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    Object.assign(document.createElement('a'), { href: url, download: `lancamentos_${from}_${to}.csv` }).click()
    URL.revokeObjectURL(url)
  }

  // one account: its real movement; all accounts: same rule as the dashboard (no transfers, adjustments or investment landing legs)
  const counts = (e: Entry) => !!accountId || (e.kind !== 'transfer' && e.kind !== 'adjustment' && !(e.kind === 'investment' && e.amount_cents > 0))
  const totals = (['EUR', 'BRL'] as const).map(cur => [cur, rows.filter(e => acc(e.account_id)?.currency === cur && counts(e)).reduce((s, e) => s + e.amount_cents, 0)] as const)
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Lançamentos</h1>
        <div className="row">
          <button onClick={exportCsv}>Exportar Excel</button>
          <button className="primary" onClick={() => setEditing('new')} disabled={!data.accounts.length}>Novo lançamento</button>
        </div>
      </div>
      {!data.accounts.length && <p className="card">Cadastre uma conta primeiro, na aba Contas.</p>}
      <div className="card grid">
        <label>Mês<input type="month" value={from.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <label>De<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>Até<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label>Busca<input value={q} onChange={e => setQ(e.target.value)} placeholder="Pingo Doce, Uber…" /></label>
        <label>País<select value={country} onChange={e => setCountry(e.target.value as Country | '')}><option value="">Todos</option>
          {Object.entries(COUNTRY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Conta<select value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Todas</option>
          {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Movimento<select value={kind} onChange={e => setKind(e.target.value as EntryKind | '')}><option value="">Todos</option>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Categoria<select value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Todas</option>
          {byLabel(data.categories).map(c => <option key={c.id} value={c.id}>{catLabel(c.id, data.categories)}</option>)}</select></label>
        <label>Tipo<select value={type} onChange={e => setType(e.target.value as CategoryType | '')}><option value="">Todos</option>
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Etiqueta<select value={tag} onChange={e => setTag(e.target.value)}><option value="">Todas</option>
          {tags.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Quem lançou<select value={who} onChange={e => setWho(e.target.value)}><option value="">Todos</option>
          {people.map(p => <option key={p}>{p}</option>)}</select></label>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="muted small">{rows.length} lançamentos · saldo do período {totals.map(([c, v]) => formatCents(v, c)).join(' · ')} {accountId ? '(movimento da conta)' : '(sem transferências e ajustes)'}</span>
        {selected.size > 0 && (
          <label className="inline">Mudar categoria de {selected.size}:
            <select value="" onChange={e => bulkCategory(e.target.value)}><option value="" disabled>Escolha…</option>
              {byLabel(data.categories.filter(c => !c.archived_at)).map(c => <option key={c.id} value={c.id}>{catLabel(c.id, data.categories)}</option>)}</select></label>
        )}
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="stack-sm">
          <thead><tr><th><input type="checkbox" aria-label="Selecionar todos" checked={rows.length > 0 && selected.size === rows.length} onChange={e => setSelected(new Set(e.target.checked ? rows.map(r => r.id) : []))} /></th>
            <th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th className="num">Valor</th><th></th></tr></thead>
          <tbody>
            {rows.map(e => {
              const a = acc(e.account_id)
              return (
                <tr key={e.id}>
                  <td><input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label="Selecionar" /></td>
                  <td>{fmtDate(e.date)}</td>
                  <td className="full">{e.description || <span className="muted">{KIND[e.kind]}</span>}
                    {e.installment_count && <span className="badge">{e.installment_no}/{e.installment_count}</span>}
                    {e.kind !== 'expense' && e.kind !== 'income' && <span className="badge">{KIND[e.kind]}</span>}
                    {e.status === 'pending' && <span className="badge warn">a confirmar</span>}
                    {e.tags.map(t => <span key={t} className="badge">#{t}</span>)}
                    <div className="small muted">{e.created_by}</div>
                  </td>
                  <td>{catLabel(e.category_id, data.categories)}</td>
                  <td>{a?.name}</td>
                  <td className={`num end ${e.amount_cents < 0 ? 'neg' : 'pos'}`}>{a && formatCents(e.amount_cents, a.currency)}</td>
                  <td className="num">
                    <button className="link" onClick={() => setEditing(e)}>{e.status === 'pending' ? 'Confirmar' : 'Editar'}</button>
                    <button className="link danger" onClick={() => askDelete(e)}>Apagar</button>
                  </td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={7} className="muted">Nada neste período com esses filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && (
        <EntryForm data={data} entry={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)}
          onDone={async t => { setEditing(null); notify(t); await reload() }} />
      )}
      {deleting && (
        <dialog open>
          <div className="stack">
            <h2 style={{ marginTop: 0 }}>Apagar parcela {deleting.installment_no}/{deleting.installment_count}</h2>
            <button onClick={() => doDelete(deleting, 'one')}>Só esta parcela</button>
            <button onClick={() => doDelete(deleting, 'next')}>Esta e as próximas</button>
            <button className="danger" onClick={() => doDelete(deleting, 'all')}>A compra inteira</button>
            <button onClick={() => setDeleting(null)}>Cancelar</button>
          </div>
        </dialog>
      )}
    </>
  )
}
