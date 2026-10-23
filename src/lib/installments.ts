const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1-based
const iso = (y: number, m: number, d: number) => {
  const yy = y + Math.floor((m - 1) / 12)
  const mm = ((m - 1) % 12) + 1
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, lastDay(yy, mm))).padStart(2, '0')}`
}

/**
 * Due date of the card bill that holds installment `k` (0 = first) of a purchase.
 * A purchase on or before the closing day goes to the bill closing that month.
 */
export function billDueDate(purchase: string, closingDay: number, dueDay: number, k = 0): string {
  const [y, m, d] = purchase.split('-').map(Number)
  let month = m + k
  if (d > Math.min(closingDay, lastDay(y, m))) month += 1
  if (dueDay <= closingDay) month += 1
  return iso(y, month, dueDay)
}

/** Split a total into n parts that sum exactly; the remainder goes on the first. */
export function splitInstallments(totalCents: number, n: number): number[] {
  const base = Math.trunc(totalCents / n)
  return Array.from({ length: n }, (_, i) => (i === 0 ? totalCents - base * (n - 1) : base))
}

export interface Parcel { id: string; installment_no: number; amount_cents: number; date: string }

/**
 * New total and/or count for a card purchase. Parcels whose bill is already due (date < today) stay;
 * the rest are deleted and the remaining amount is split again over the remaining count.
 */
export function replanInstallments(p: {
  parcels: Parcel[]; purchaseDate: string; closingDay: number; dueDay: number
  newTotal: number; newCount: number; today: string
}): { deleteIds: string[]; create: Omit<Parcel, 'id'>[] } {
  const paid = p.parcels.filter(x => x.date < p.today)
  const left = p.newCount - paid.length
  if (left < 1) throw new Error(`Já foram pagas ${paid.length} parcelas; o novo número precisa ser maior.`)
  const amounts = splitInstallments(p.newTotal - paid.reduce((s, x) => s + x.amount_cents, 0), left)
  return {
    deleteIds: p.parcels.filter(x => x.date >= p.today).map(x => x.id),
    create: amounts.map((amount_cents, i) => {
      const no = paid.length + i + 1
      return { installment_no: no, amount_cents, date: billDueDate(p.purchaseDate, p.closingDay, p.dueDay, no - 1) }
    }),
  }
}
