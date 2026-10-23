import type { CategoryType, Currency, Entry } from '../types'
import { convert, rateOn, type Rates } from './fx'

export interface SummaryOptions {
  currency: Currency
  rates: Rates
  accountCurrency: (accountId: string) => Currency
  categoryType: (categoryId: string | null) => CategoryType | null
  includeInvestments: boolean
}

export interface Summary {
  income: number
  essential: number
  adjustable: number
  investment: number
  result: number
  savingsPct: number
}

/** Month result: income − essential − adjustable (− investment). Transfers and adjustments never count. */
export function monthSummary(entries: Entry[], o: SummaryOptions): Summary {
  let income = 0, essential = 0, adjustable = 0, investment = 0
  for (const e of entries) {
    if (e.deleted_at || e.status === 'pending') continue
    const v = convert(e.amount_cents, o.accountCurrency(e.account_id), o.currency, rateOn(o.rates, e.date))
    if (e.kind === 'income') income += v
    else if (e.kind === 'investment') investment -= v
    else if (e.kind === 'expense') {
      if (o.categoryType(e.category_id) === 'adjustable') adjustable -= v
      else essential -= v // uncategorized counts as essential
    }
  }
  const result = income - essential - adjustable - (o.includeInvestments ? investment : 0)
  return { income, essential, adjustable, investment, result, savingsPct: income > 0 ? result / income : 0 }
}

/** Spend against a monthly limit: warn from 80%, over from 100%. */
export function limitStatus(spent: number, limit: number): { pct: number; level: 'ok' | 'warn' | 'over' } {
  const pct = spent / limit
  return { pct, level: pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok' }
}

/** Relative change from `before` to `now`; null when `before` is 0 (nothing to compare). */
export const delta = (now: number, before: number): number | null => (before === 0 ? null : (now - before) / before)
