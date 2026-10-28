import { expect, test } from 'vitest'
import { convert, rateOn } from './fx'
import { suggestedAmount } from './recurrence'
import { delta, limitStatus, monthSummary } from './summary'
import type { Entry } from '../types'

const rates = { '2027-01-08': 6, '2027-01-11': 6.5 } // EUR -> BRL, Fri and Mon

test('rateOn falls back to the latest earlier date', () => {
  expect(rateOn(rates, '2027-01-09')).toBe(6) // Saturday
  expect(rateOn(rates, '2027-01-11')).toBe(6.5)
  expect(rateOn(rates, '2027-01-01')).toBe(6) // before range: earliest known
})

test('convert', () => {
  expect(convert(600, 'BRL', 'EUR', 6)).toBe(100)
  expect(convert(100, 'EUR', 'BRL', 6)).toBe(600)
  expect(convert(100, 'EUR', 'EUR', 6)).toBe(100)
})

const e = (p: Partial<Entry>): Entry => ({
  id: crypto.randomUUID(), kind: 'expense', account_id: 'pt', amount_cents: -100, date: '2027-01-08',
  category_id: null, description: '', tags: [], group_id: null, installment_no: null, installment_count: null,
  purchase_date: null, recurrence_id: null, status: 'confirmed', created_by: null, deleted_at: null, ...p,
})

const opts = {
  currency: 'EUR' as const,
  rates,
  accountCurrency: (id: string) => (id === 'br' ? ('BRL' as const) : ('EUR' as const)),
  categoryType: (id: string | null) => (id === 'trip' ? ('adjustable' as const) : ('essential' as const)),
  includeInvestments: true,
}

test('monthSummary buckets, converts, and ignores transfers, adjustments, pending, deleted', () => {
  const s = monthSummary(
    [
      e({ kind: 'income', amount_cents: 300000 }),
      e({ category_id: 'rent', amount_cents: -100000 }),
      e({ account_id: 'br', category_id: 'trip', amount_cents: -60000 }), // R$600 at 6 = €100
      e({ kind: 'transfer', amount_cents: -50000 }),
      e({ kind: 'transfer', account_id: 'br', amount_cents: 300000 }),
      e({ kind: 'adjustment', amount_cents: 999 }),
      e({ amount_cents: -7777, status: 'pending' }),
      e({ amount_cents: -8888, deleted_at: '2027-01-09T00:00:00Z' }),
      e({ kind: 'investment', amount_cents: -50000 }),
      e({ kind: 'investment', account_id: 'br', amount_cents: 300000 }), // landing leg, not counted again
    ],
    opts,
  )
  expect(s).toEqual({
    income: 300000, essential: 100000, adjustable: 10000, investment: 50000,
    result: 140000, savingsPct: 140000 / 300000,
  })
})

test('includeInvestments=false adds the investment back to the result', () => {
  const list = [e({ kind: 'income', amount_cents: 1000 }), e({ kind: 'investment', amount_cents: -400 })]
  expect(monthSummary(list, opts).result).toBe(600)
  expect(monthSummary(list, { ...opts, includeInvestments: false }).result).toBe(1000)
})

test('no income gives 0%, uncategorized expense counts as essential', () => {
  const s = monthSummary([e({ amount_cents: -1000 })], { ...opts, categoryType: () => null })
  expect(s.savingsPct).toBe(0)
  expect(s.essential).toBe(1000)
})

test('suggestedAmount is the mean of the last 3', () => {
  expect(suggestedAmount([100, 200, 300, 400])).toBe(300)
  expect(suggestedAmount([100, 101])).toBe(101)
  expect(suggestedAmount([])).toBe(0)
})

test('limitStatus: warn from 80%, over from 100%', () => {
  expect(limitStatus(7900, 10000)).toEqual({ pct: 0.79, level: 'ok' })
  expect(limitStatus(8000, 10000)).toEqual({ pct: 0.8, level: 'warn' })
  expect(limitStatus(10000, 10000)).toEqual({ pct: 1, level: 'over' })
})

test('delta between months; null when there is nothing to compare', () => {
  expect(delta(15000, 10000)).toBe(0.5)
  expect(delta(5000, 10000)).toBe(-0.5)
  expect(delta(5000, 0)).toBeNull()
})
