// Local-only: creates two test users on `supabase start` and allowlists one of them.
// Usage: node supabase/seed-local.mjs <SERVICE_ROLE_KEY>   (from `npx supabase status`)
import { createClient } from '@supabase/supabase-js'

const admin = createClient('http://127.0.0.1:54321', process.argv[2])
const password = 'local-test-only-123' // ponytail: local stack only, never a real account
for (const email of ['casal1@example.test', 'intruso@example.test']) {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error && !/already/.test(error.message)) throw error
}
const { error } = await admin.from('allowed_emails').upsert({ email: 'casal1@example.test' })
if (error) throw error
console.log('seeded: casal1@example.test (allowed), intruso@example.test (not allowed)')
