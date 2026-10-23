import type { PageProps } from '../App'
import { restore } from '../actions'
import { fmtDate, KIND } from '../labels'
import { formatCents } from '../lib/money'

const DAYS = 30

export default function Trash({ data, reload, notify }: PageProps) {
  const since = new Date(Date.now() - DAYS * 864e5).toISOString()
  // ponytail: older rows are only hidden; add a pg_cron purge if storage ever matters
  const rows = data.entries.filter(e => e.deleted_at && e.deleted_at >= since).sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!))
  const acc = (id: string) => data.accounts.find(a => a.id === id)

  async function back(ids: string[]) {
    await restore(ids)
    notify({ msg: ids.length > 1 ? `${ids.length} lançamentos restaurados.` : 'Lançamento restaurado.' })
    await reload()
  }

  return (
    <>
      <h1>Lixeira</h1>
      <p className="muted">Lançamentos apagados nos últimos {DAYS} dias. Restaurar devolve o lançamento como estava.</p>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Apagado em</th><th>Data</th><th>Descrição</th><th className="num">Valor</th><th></th></tr></thead>
          <tbody>
            {rows.map(e => {
              const group = e.group_id ? rows.filter(x => x.group_id === e.group_id).map(x => x.id) : []
              return (
                <tr key={e.id}>
                  <td className="small">{new Date(e.deleted_at!).toLocaleString('pt-BR')}</td>
                  <td>{fmtDate(e.date)}</td>
                  <td>{e.description || KIND[e.kind]}{e.installment_count && <span className="badge">{e.installment_no}/{e.installment_count}</span>}</td>
                  <td className="num">{formatCents(e.amount_cents, acc(e.account_id)?.currency ?? 'EUR')}</td>
                  <td className="num">
                    <button className="link" onClick={() => back([e.id])}>Restaurar</button>
                    {group.length > 1 && <button className="link" onClick={() => back(group)}>Restaurar grupo ({group.length})</button>}
                  </td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={5} className="muted">A lixeira está vazia.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
