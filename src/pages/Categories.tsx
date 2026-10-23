import { useState } from 'react'
import type { PageProps } from '../App'
import { catLabel, check } from '../data'
import { TYPE } from '../labels'
import { parseAmount, toInput } from '../lib/money'
import { supabase } from '../supabase'
import type { Category, CategoryType } from '../types'

export default function Categories({ data, reload, notify }: PageProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<CategoryType>('adjustable')
  const [parent, setParent] = useState('')
  const [removing, setRemoving] = useState<Category | null>(null)
  const [target, setTarget] = useState('')
  const active = data.categories.filter(c => !c.archived_at)
  const fullName = (c: Category) => catLabel(c.id, data.categories)
  const update = async (c: Category, patch: Partial<Category>) => {
    check(await supabase.from('categories').update(patch).eq('id', c.id))
    await reload()
  }

  async function add() {
    if (!name.trim()) return
    check(await supabase.from('categories').insert({ name: name.trim(), type, parent_id: parent || null }))
    setName(''); setParent('')
    await reload()
  }

  async function remove(c: Category) {
    const used = data.entries.some(e => e.category_id === c.id) || data.recurrences.some(r => r.category_id === c.id)
    if (used && !target) return
    if (used) {
      check(await supabase.from('entries').update({ category_id: target }).eq('category_id', c.id))
      check(await supabase.from('recurrences').update({ category_id: target }).eq('category_id', c.id))
    }
    // archived, not deleted: the audit log and old exports still point at it
    check(await supabase.from('categories').update({ archived_at: new Date().toISOString() }).eq('id', c.id))
    setRemoving(null); setTarget('')
    notify({ msg: used ? `Categoria apagada; lançamentos movidos.` : 'Categoria apagada.' })
    await reload()
  }

  const inUse = removing && (data.entries.some(e => e.category_id === removing.id) || data.recurrences.some(r => r.category_id === removing.id))
  return (
    <>
      <h1>Categorias</h1>
      <div className="card row">
        <label>Nova categoria<input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} /></label>
        <label>Tipo<select value={type} onChange={e => setType(e.target.value as CategoryType)}>
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Dentro de (opcional)<select value={parent} onChange={e => setParent(e.target.value)}>
          <option value="">—</option>{active.filter(c => !c.parent_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="primary" onClick={add}>Adicionar</button>
      </div>
      {(Object.keys(TYPE) as CategoryType[]).map(t => (
        <div className="card" key={t}>
          <h2 style={{ marginTop: 0 }}>{TYPE[t]}</h2>
          <table><tbody>
            {active.filter(c => c.type === t).sort((a, b) => fullName(a).localeCompare(fullName(b), 'pt')).map(c => (
              <tr key={c.id}>
                <td>
                  {c.parent_id && <span className="muted">{data.categories.find(x => x.id === c.parent_id)?.name} › </span>}
                  <input defaultValue={c.name} aria-label="Nome" onBlur={e => e.target.value.trim() && e.target.value !== c.name && update(c, { name: e.target.value.trim() })} />
                </td>
                <td>
                  {/* limits live on top-level adjustable categories; subcategory spend counts toward the parent */}
                  {t === 'adjustable' && !c.parent_id && (
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      <input inputMode="decimal" placeholder="Limite/mês" aria-label={`Limite mensal de ${c.name}`} style={{ width: 110 }}
                        defaultValue={c.monthly_limit_cents ? toInput(c.monthly_limit_cents) : ''}
                        onBlur={e => {
                          const v = e.target.value.trim() ? parseAmount(e.target.value) : null
                          if (v !== null && !(v > 0)) return notify({ msg: 'Limite inválido: use um valor maior que zero, ou deixe vazio.' })
                          if (v !== c.monthly_limit_cents) update(c, { monthly_limit_cents: v })
                        }} />
                      <select value={c.limit_currency} aria-label="Moeda do limite" onChange={e => update(c, { limit_currency: e.target.value as Category['limit_currency'] })}>
                        <option>EUR</option><option>BRL</option>
                      </select>
                    </span>
                  )}
                </td>
                <td className="num">
                  <button className="link" onClick={() => update(c, { type: t === 'essential' ? 'adjustable' : 'essential' })}>
                    Mudar para {TYPE[t === 'essential' ? 'adjustable' : 'essential']}
                  </button>
                  <button className="link danger" onClick={() => setRemoving(c)}>Apagar</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ))}
      {removing && (
        <dialog open>
          <div className="stack">
            <h2 style={{ marginTop: 0 }}>Apagar "{removing.name}"?</h2>
            {inUse && (
              <label>Essa categoria tem lançamentos. Mover para:
                <select value={target} onChange={e => setTarget(e.target.value)}>
                  <option value="">Escolha…</option>
                  {active.filter(c => c.id !== removing.id).map(c => <option key={c.id} value={c.id}>{fullName(c)}</option>)}
                </select>
              </label>
            )}
            <div className="row">
              <button className="primary" disabled={!!inUse && !target} onClick={() => remove(removing)}>Apagar</button>
              <button onClick={() => { setRemoving(null); setTarget('') }}>Cancelar</button>
            </div>
          </div>
        </dialog>
      )}
    </>
  )
}
