import { useEffect, useMemo, useState } from 'react'
import type { PageProps } from '../App'
import { addMonths, catLabel, check, monthOf, today } from '../data'
import { COUNTRY, fmtMonth } from '../labels'
import { convert, fetchRates, rateOn, type Rates } from '../lib/fx'
import { formatCents } from '../lib/money'
import { monthSummary, type Summary } from '../lib/summary'
import { supabase } from '../supabase'
import type { Country, Currency, Entry } from '../types'

const pct = (x: number) => `${Math.round(x * 100)}%`

export default function Dashboard({ data, reload }: PageProps) {
  const [month, setMonth] = useState(monthOf(today()))
  const [currency, setCurrency] = useState<Currency>('EUR')
  const [withInvest, setWithInvest] = useState(true)
  const [sim, setSim] = useState(20)
  const [rates, setRates] = useState<Rates>({})
  const [fxError, setFxError] = useState('')

  useEffect(() => {
    const end = [`${addMonths(month, 1)}-01`, today()].sort()[0]
    fetchRates(`${addMonths(month, -11)}-01`, end).then(setRates, e => setFxError(e.message))
  }, [month])

  const accCur = (id: string) => data.accounts.find(a => a.id === id)?.currency ?? 'EUR'
  const catType = (id: string | null) => data.categories.find(c => c.id === id)?.type ?? null
  const inMonth = (m: string, country?: Country) =>
    data.entries.filter(e => monthOf(e.date) === m && (!country || data.accounts.find(a => a.id === e.account_id)?.country === country))
  const sum = (list: Entry[], cur: Currency, invest = withInvest): Summary =>
    monthSummary(list, { currency: cur, rates, accountCurrency: accCur, categoryType: catType, includeInvestments: invest })

  const total = sum(inMonth(month), currency)
  const lines: [string, Currency, Summary][] = [
    [COUNTRY.PT, 'EUR', sum(inMonth(month, 'PT'), 'EUR')],
    [COUNTRY.BR, 'BRL', sum(inMonth(month, 'BR'), 'BRL')],
    [`Total em ${currency}`, currency, total],
  ]
  const money = (v: number) => (Number.isNaN(v) ? '—' : formatCents(v, currency))
  const last3 = [1, 2, 3].map(i => addMonths(month, -i))

  // spend per category in the chosen currency
  const byCategory = (m: string) => {
    const out = new Map<string | null, number>()
    for (const e of inMonth(m)) {
      if (e.kind !== 'expense' || e.deleted_at || e.status === 'pending') continue
      out.set(e.category_id, (out.get(e.category_id) ?? 0) - convert(e.amount_cents, accCur(e.account_id), currency, rateOn(rates, e.date)))
    }
    return out
  }
  const cats = useMemo(() => byCategory(month), [data, month, currency, rates]) // eslint-disable-line react-hooks/exhaustive-deps
  const top = [...cats].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const catName = (id: string | null) => catLabel(id, data.categories) || 'Sem categoria'

  // essentials more than 20% above their 3-month mean
  const history = last3.map(byCategory)
  // mean over the months that had spending in it, so months before the app existed don't count as zero
  const meanOf = (id: string | null) => {
    const vals = history.map(h => h.get(id) ?? 0).filter(v => v > 0)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }
  const alerts = [...cats]
    .filter(([id, v]) => catType(id) !== 'adjustable' && meanOf(id) > 0 && v > meanOf(id) * 1.2)
    .map(([id, v]) => ({ name: catName(id), v, mean: meanOf(id), up: v / meanOf(id) - 1 }))

  const twelve = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)).map(m => ({ m, s: sum(inMonth(m), currency) }))
  const avg = (k: 'essential' | 'adjustable') => {
    const vals = last3.map(m => sum(inMonth(m), currency)[k]).filter(v => v > 0)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }

  // forecast: recurring income − max(mean essentials, essentials already booked) − adjustables already booked (installments)
  const latest = rateOn(rates, today())
  const forecast = [1, 2, 3].map(i => {
    const m = addMonths(month, i)
    const income = data.recurrences
      .filter(r => r.kind === 'income' && r.start_month.slice(0, 7) <= m && (!r.end_month || r.end_month.slice(0, 7) >= m))
      .reduce((s, r) => s + convert(r.amount_cents, accCur(r.account_id), currency, latest), 0)
    const booked = sum(inMonth(m), currency, false)
    const essential = Math.max(avg('essential'), booked.essential)
    return { m, income, essential, adjustable: booked.adjustable, left: income - essential - booked.adjustable }
  })

  const goal = data.goalPct / 100
  async function saveGoal(v: number) {
    if (!(v >= 0 && v <= 100)) return
    check(await supabase.from('settings').upsert({ key: 'savings_goal_pct', value: v }))
    await reload()
  }

  const max = Math.max(1, ...twelve.flatMap(({ s }) => [s.income, s.essential + s.adjustable]).filter(Number.isFinite))
  const W = 720, H = 180, bw = W / 12
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Painel</h1>
        <div className="row">
          <label>Mês<input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
          <label>Ver total em<select value={currency} onChange={e => setCurrency(e.target.value as Currency)}><option>EUR</option><option>BRL</option></select></label>
          <label className="inline"><input type="checkbox" checked={withInvest} onChange={e => setWithInvest(e.target.checked)} /> Descontar investimentos</label>
        </div>
      </div>
      {fxError && <p className="warn small">Sem cotação agora ({fxError}); o total junto pode aparecer como —.</p>}

      <div className="card table-wrap">
        <table className="stack-sm">
          <thead><tr><th></th><th className="num">Entradas</th><th className="num">Essenciais</th><th className="num">Ajustáveis</th><th className="num">Investido</th><th className="num">Sobrou</th><th className="num">% da renda</th></tr></thead>
          <tbody>
            {lines.map(([name, cur, s]) => {
              const f = (v: number) => (Number.isNaN(v) ? '—' : formatCents(v, cur))
              return (
                <tr key={name} style={name.startsWith('Total') ? { fontWeight: 600 } : undefined}>
                  <td className="full">{name}</td><td className="num" data-label="Entradas">{f(s.income)}</td>
                  <td className="num" data-label="Essenciais">{f(s.essential)}</td><td className="num" data-label="Ajustáveis">{f(s.adjustable)}</td>
                  <td className="num" data-label="Investido">{f(s.investment)}</td>
                  <td className={`num ${s.result < 0 ? 'neg' : 'pos'}`} data-label="Sobrou">{f(s.result)}</td>
                  <td className={`num ${s.savingsPct >= goal ? 'pos' : 'warn'}`} data-label="% da renda">{pct(s.savingsPct)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Meta: poupar <input type="number" min={0} max={100} defaultValue={data.goalPct} style={{ width: 60 }} aria-label="Meta em %" onBlur={e => Number(e.target.value) !== data.goalPct && saveGoal(Number(e.target.value))} />% da renda.{' '}
          {total.income > 0 && (total.savingsPct >= goal ? 'Meta atingida neste mês.' : `Faltam ${money(Math.round(total.income * goal - total.result))} para a meta.`)}
          {' '}Transferências e ajustes de saldo não entram na conta.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Para onde foi o dinheiro</h2>
          <p>Essenciais <b>{money(total.essential)}</b> · Ajustáveis <b>{money(total.adjustable)}</b></p>
          <table><tbody>{top.map(([id, v]) => <tr key={id ?? 'none'}><td>{catName(id)}</td><td className="num">{money(v)}</td></tr>)}</tbody></table>
          {alerts.map(a => <p key={a.name} className="warn small">{a.name} está {pct(a.up)} acima da média dos últimos meses: {money(a.v)} contra {money(Math.round(a.mean))}.</p>)}
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>E se cortarmos os ajustáveis?</h2>
          <label>Reduzir ajustáveis em (%)<input type="number" min={0} max={100} value={sim} onChange={e => setSim(Number(e.target.value))} /></label>
          <p>Média dos ajustáveis nos últimos 3 meses: {money(Math.round(avg('adjustable')))}.<br />
            Poupariam <b>{money(Math.round(avg('adjustable') * sim / 100))}</b> a mais por mês.</p>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Últimos 12 meses</h2>
        <svg viewBox={`0 0 ${W} ${H + 36}`} role="img" aria-label="Entradas e saídas por mês" style={{ width: '100%', height: 'auto' }}>
          {twelve.map(({ m, s }, i) => {
            const out = s.essential + s.adjustable
            const hIn = Number.isFinite(s.income) ? (s.income / max) * H : 0
            const hOut = Number.isFinite(out) ? (out / max) * H : 0
            return (
              <g key={m}>
                <title>{`${fmtMonth(m)}: entradas ${money(s.income)}, saídas ${money(out)}, sobrou ${money(s.result)}`}</title>
                <rect x={i * bw + 8} y={H - hIn} width={bw / 2 - 10} height={hIn} rx={2} fill="var(--good)" />
                <rect x={i * bw + bw / 2} y={H - hOut} width={bw / 2 - 10} height={hOut} rx={2} fill="var(--bad)" opacity={0.8} />
                <text x={i * bw + bw / 2} y={H + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmtMonth(m)}</text>
                <text x={i * bw + bw / 2} y={H + 31} textAnchor="middle" fontSize="10" fill={s.result < 0 ? 'var(--bad)' : 'var(--muted)'}>{Number.isFinite(s.result) ? pct(s.savingsPct) : ''}</text>
              </g>
            )
          })}
        </svg>
        <p className="small muted" style={{ margin: 0 }}><span className="pos">■</span> entradas <span className="neg">■</span> saídas · embaixo, % poupado da renda</p>
      </div>

      <div className="card table-wrap">
        <h2 style={{ marginTop: 0 }}>Próximos 3 meses (estimativa)</h2>
        <table className="stack-sm">
          <thead><tr><th></th><th className="num">Renda que se repete</th><th className="num">Essenciais (média)</th><th className="num">Parcelas e ajustáveis já lançados</th><th className="num">Deve sobrar</th></tr></thead>
          <tbody>{forecast.map(f => (
            <tr key={f.m}><td className="full">{fmtMonth(f.m)}</td><td className="num" data-label="Renda">{money(f.income)}</td>
              <td className="num" data-label="Essenciais">{money(Math.round(f.essential))}</td><td className="num" data-label="Parcelas e ajustáveis">{money(f.adjustable)}</td>
              <td className={`num ${f.left < 0 ? 'neg' : 'pos'}`} data-label="Deve sobrar">{money(Math.round(f.left))}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}
