import type { Account, CategoryType, Country, EntryKind } from './types'

export const KIND: Record<EntryKind, string> = {
  expense: 'Saída', income: 'Entrada', transfer: 'Transferência', investment: 'Investimento', adjustment: 'Ajuste de saldo',
}
export const TYPE: Record<CategoryType, string> = { essential: 'Essencial', adjustable: 'Ajustável' }
export const COUNTRY: Record<Country, string> = { PT: 'Portugal', BR: 'Brasil' }
export const ACCOUNT_KIND: Record<Account['kind'], string> = { bank: 'Banco', card: 'Cartão', cash: 'Dinheiro' }

export const fmtDate = (iso: string) => iso.split('-').reverse().join('/')
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const fmtMonth = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`
