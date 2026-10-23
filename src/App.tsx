import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { loadAll, materializeRecurrences, type Data } from './data'
import Dashboard from './pages/Dashboard'
import Entries from './pages/Entries'
import Accounts from './pages/Accounts'
import Categories from './pages/Categories'
import Trash from './pages/Trash'

const TABS = { painel: 'Painel', lancamentos: 'Lançamentos', contas: 'Contas', categorias: 'Categorias', lixeira: 'Lixeira' }
type Tab = keyof typeof TABS

export interface Toast { msg: string; undo?: () => Promise<unknown> }
export interface PageProps { data: Data; reload: () => Promise<void>; notify: (t: Toast) => void }

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('painel')
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<number>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const reload = useCallback(async () => {
    try {
      setData(await loadAll())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    // RLS only shows your own row in allowed_emails, and only if you are on the list
    supabase.from('allowed_emails').select('email').then(async ({ data: rows }) => {
      const ok = !!rows?.length
      setAllowed(ok)
      if (!ok) return
      const d = await loadAll().catch(e => { setError(e.message); return null })
      if (d && (await materializeRecurrences(d))) await reload()
      else setData(d)
    })
  }, [session, reload])

  const notify = useCallback((t: Toast) => {
    setToast(t)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 6000)
  }, [])

  if (session === undefined) return null
  if (!session)
    return (
      <main className="center">
        <h1>Finanças da Família</h1>
        <button className="primary" onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } })}>
          Entrar com Google
        </button>
      </main>
    )
  if (allowed === false)
    return (
      <main className="center">
        <h1>Acesso não autorizado</h1>
        <p>{session.user.email} não está na lista de e-mails permitidos.</p>
        <button onClick={() => supabase.auth.signOut()}>Sair</button>
      </main>
    )
  if (error) return <main className="center"><p className="error">Erro: {error}</p><button onClick={() => location.reload()}>Tentar de novo</button></main>
  if (!data) return <main className="center"><p>Carregando…</p></main>

  const props: PageProps = { data, reload, notify }
  return (
    <>
      <header>
        <nav>
          {(Object.keys(TABS) as Tab[]).map(t => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{TABS[t]}</button>
          ))}
        </nav>
        <button className="link" onClick={() => supabase.auth.signOut()} title={session.user.email}>Sair</button>
      </header>
      <main>
        {tab === 'painel' && <Dashboard {...props} />}
        {tab === 'lancamentos' && <Entries {...props} />}
        {tab === 'contas' && <Accounts {...props} />}
        {tab === 'categorias' && <Categories {...props} />}
        {tab === 'lixeira' && <Trash {...props} />}
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast.msg}
          {toast.undo && (
            <button onClick={async () => { const u = toast.undo!; setToast(null); await u(); await reload() }}>Desfazer</button>
          )}
        </div>
      )}
    </>
  )
}
