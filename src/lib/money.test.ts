import { expect, test } from 'vitest'
import { formatCents, parseAmount, toInput } from './money'
import { billDueDate, replanInstallments, simulatePurchase, splitInstallments } from './installments'

test('parseAmount reads pt-BR input as cents', () => {
  expect(parseAmount('1.234,56')).toBe(123456)
  expect(parseAmount('1234,5')).toBe(123450)
  expect(parseAmount('12')).toBe(1200)
  expect(parseAmount(' 0,07 ')).toBe(7)
  expect(Number.isNaN(parseAmount('abc'))).toBe(true)
})

test('toInput round-trips', () => {
  expect(toInput(120000)).toBe('1.200,00')
  expect(toInput(-550)).toBe('-5,50')
  expect(parseAmount(toInput(123456))).toBe(123456)
})

test('formatCents', () => {
  expect(formatCents(123456, 'EUR')).toBe('€ 1.234,56')
  expect(formatCents(-500, 'BRL')).toBe('-R$ 5,00')
})

test('billDueDate: purchase on or before closing day goes to that bill', () => {
  expect(billDueDate('2027-03-10', 10, 20)).toBe('2027-03-20')
  expect(billDueDate('2027-03-11', 10, 20)).toBe('2027-04-20')
})

test('billDueDate: due day before closing day falls next month', () => {
  expect(billDueDate('2027-03-05', 25, 5)).toBe('2027-04-05')
  expect(billDueDate('2027-12-26', 25, 5)).toBe('2028-02-05')
})

test('billDueDate clamps to short months', () => {
  expect(billDueDate('2027-02-15', 31, 10)).toBe('2027-03-10') // closes 28 Feb
  expect(billDueDate('2027-01-31', 30, 31)).toBe('2027-02-28') // Jan closes 30th, due clamps
})

test('billDueDate: installment k is k months after the first', () => {
  expect(billDueDate('2027-11-20', 10, 20, 2)).toBe('2028-02-20')
})

test('splitInstallments sums exactly, remainder on the first', () => {
  expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333])
  expect(splitInstallments(120000, 6)).toEqual(Array(6).fill(20000))
  expect(splitInstallments(-10000, 3)).toEqual([-3334, -3333, -3333])
})

test('replanInstallments keeps paid parcels and re-splits the rest', () => {
  const parcels = [1, 2, 3, 4, 5, 6].map(no => ({
    id: `p${no}`, installment_no: no, amount_cents: -10000, date: billDueDate('2027-01-05', 10, 20, no - 1),
  }))
  // parcels 1 and 2 (Jan 20, Feb 20) are already due on 2027-03-01
  const plan = replanInstallments({ parcels, purchaseDate: '2027-01-05', closingDay: 10, dueDay: 20, newTotal: -60000, newCount: 4, today: '2027-03-01' })
  expect(plan.deleteIds).toEqual(['p3', 'p4', 'p5', 'p6'])
  expect(plan.create).toEqual([
    { installment_no: 3, amount_cents: -20000, date: '2027-03-20' },
    { installment_no: 4, amount_cents: -20000, date: '2027-04-20' },
  ])
  expect(() => replanInstallments({ parcels, purchaseDate: '2027-01-05', closingDay: 10, dueDay: 20, newTotal: -60000, newCount: 2, today: '2027-03-01' })).toThrow()
})

test('simulatePurchase adds the new parcels on top of what each bill already has', () => {
  const existing = [
    { date: '2027-03-20', amount_cents: -20000 },
    { date: '2027-04-20', amount_cents: -20000 },
    { date: '2027-04-20', amount_cents: 5000 }, // a refund on the card doesn't count as committed
  ]
  // bought 2027-03-15, after closing on the 10th: first bill is April
  expect(simulatePurchase({ purchaseDate: '2027-03-15', closingDay: 10, dueDay: 20, totalCents: 30000, count: 3, existing })).toEqual([
    { month: '2027-04', existing: 20000, added: 10000, total: 30000 },
    { month: '2027-05', existing: 0, added: 10000, total: 10000 },
    { month: '2027-06', existing: 0, added: 10000, total: 10000 },
  ])
})
