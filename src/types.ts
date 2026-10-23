// Rows as Supabase returns them (snake_case), see supabase/migrations/0001_init.sql
export type Currency = 'EUR' | 'BRL'
export type Country = 'PT' | 'BR'
export type CategoryType = 'essential' | 'adjustable'
export type EntryKind = 'income' | 'expense' | 'transfer' | 'investment' | 'adjustment'

export interface Account {
  id: string
  name: string
  country: Country
  currency: Currency
  kind: 'bank' | 'card' | 'cash'
  opening_balance_cents: number
  closing_day: number | null
  due_day: number | null
  archived_at: string | null
}

export interface Category {
  id: string
  name: string
  type: CategoryType
  parent_id: string | null
  archived_at: string | null
  monthly_limit_cents: number | null
  limit_currency: Currency
}

export interface Recurrence {
  id: string
  kind: 'income' | 'expense'
  account_id: string
  category_id: string | null
  description: string
  amount_cents: number
  day_of_month: number
  start_month: string
  end_month: string | null
}

export interface Entry {
  id: string
  kind: EntryKind
  account_id: string
  amount_cents: number // negative = money leaving the account
  date: string
  category_id: string | null
  description: string
  tags: string[]
  group_id: string | null
  installment_no: number | null
  installment_count: number | null
  purchase_date: string | null
  recurrence_id: string | null
  status: 'confirmed' | 'pending'
  created_by: string | null
  deleted_at: string | null
}
