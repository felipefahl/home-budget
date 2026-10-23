import type { Currency } from '../types'

const SYMBOL: Record<Currency, string> = { EUR: '€', BRL: 'R$' }
const NUM = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatCents = (cents: number, currency: Currency) =>
  `${cents < 0 ? '-' : ''}${SYMBOL[currency]} ${NUM.format(Math.abs(cents) / 100)}`

/** "1.234,56" -> 123456. NaN when it is not a number. */
export function parseAmount(input: string): number {
  const s = input.trim().replace(/\./g, '').replace(',', '.')
  return /^-?\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN
}

/** Cents as an editable field value: 120000 -> "1.200,00" (round-trips through parseAmount). */
export const toInput = (cents: number) => NUM.format(cents / 100)
