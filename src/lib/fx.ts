import type { Currency } from '../types'

/** EUR -> BRL rate keyed by ISO date. */
export type Rates = Record<string, number>

/** Rate on `date`, or the latest earlier one (weekends, holidays); earliest known if before the range. */
export function rateOn(rates: Rates, date: string): number {
  const days = Object.keys(rates).sort()
  let pick = days[0]
  for (const d of days) if (d <= date) pick = d
  return pick ? rates[pick] : NaN
}

export function convert(cents: number, from: Currency, to: Currency, eurBrl: number): number {
  if (from === to) return cents
  return Math.round(from === 'EUR' ? cents * eurBrl : cents / eurBrl)
}

// ponytail: localStorage cache per range, a table in Supabase if both devices need the same rates offline
export async function fetchRates(from: string, to: string): Promise<Rates> {
  const key = `fx:${from}:${to}`
  try {
    const hit = localStorage.getItem(key)
    if (hit) return JSON.parse(hit)
  } catch { /* storage blocked */ }
  const res = await fetch(`https://api.frankfurter.dev/v1/${from}..${to}?from=EUR&to=BRL`)
  if (!res.ok) throw new Error(`Cotação indisponível (${res.status})`)
  const json: { rates: Record<string, { BRL: number }> } = await res.json()
  const rates = Object.fromEntries(Object.entries(json.rates).map(([d, r]) => [d, r.BRL]))
  try {
    if (to < new Date().toISOString().slice(0, 10)) localStorage.setItem(key, JSON.stringify(rates)) // past ranges never change
  } catch { /* storage blocked */ }
  return rates
}
