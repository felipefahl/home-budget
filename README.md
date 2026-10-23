# Finanças da Família

App de finanças pessoais para um casal com contas em **Portugal (EUR)** e no **Brasil (BRL)**: quanto entra, quanto sai, quanto sobra para poupar, com cartões parcelados, transferências entre países e gastos que se repetem.

- **Front:** Vite + React + TypeScript, publicado no Netlify
- **Banco e login:** Supabase (Postgres + login Google), acesso restrito a uma lista de e-mails via RLS
- **Câmbio:** [Frankfurter](https://frankfurter.dev) (taxas do Banco Central Europeu)

Documentos: [requisitos](https://claude.ai/artifact/DL6tzABuzUxHcGYLqy4VAh) (privado) · [plano técnico](docs/superpowers/plans/2026-10-23-home-budget-v1.md) · [roadmap: o que falta e próximos passos](ROADMAP.md)

## O que o app faz

| Tela | Para quê |
|---|---|
| **Painel** | Resultado do mês por país e no total (EUR ou BRL), meta de poupança, para onde foi o dinheiro, limites por categoria, comparação com o mês anterior e o ano passado, alertas de essenciais acima da média, últimos 12 meses, previsão dos próximos 3 e simulação de cortes |
| **Lançamentos** | Entradas, saídas, transferências entre países (com taxa), investimentos e ajustes de saldo; simulação das faturas antes de uma compra parcelada; filtros, alteração em massa e exportação para Excel |
| **Contas** | Saldos por país, faturas dos cartões e quanto já está comprometido em parcelas |
| **Categorias** | Essenciais e ajustáveis, subcategorias, limite mensal, renomear e apagar movendo os lançamentos |
| **Lixeira** | Restaurar o que foi apagado nos últimos 30 dias |

## Comandos

```bash
npm install        # uma vez
npm run dev        # app em http://localhost:5173
npm test           # lógica de dinheiro + regras de acesso do banco (PGlite, sem Docker)
npm run build      # checagem de tipos + build de produção em dist/
```

Precisa de um `.env.local` (copie de `.env.example`) com a URL do projeto e a chave publishable/anon do Supabase.

## Configuração (uma vez)

### 1. Supabase

Novo projeto com:

| Opção | Valor |
|---|---|
| GitHub | pular |
| Database password | "Generate a password", guardar no gerenciador de senhas (o app não usa) |
| Region | Europe (Frankfurt ou Irlanda) |
| Enable Data API | **ligado** |
| Automatically expose new tables | **desligado** (o schema libera só o necessário) |
| Enable automatic RLS | **ligado** |
| Postgres type | padrão |

Depois, no **SQL Editor**:

1. Rodar `supabase/migrations/0001_init.sql` inteiro.
2. Rodar `supabase/migrations/0002_reset_trial.sql` inteiro (só cria os comandos de reset, não apaga nada).
3. Rodar `supabase/migrations/0003_category_limits.sql` (limite mensal nas categorias).
4. Liberar os e-mails, em minúsculas:
   ```sql
   insert into allowed_emails values ('voce@gmail.com'), ('ela@gmail.com');
   ```

Em **Authentication → Sign In / Providers**, desligar **Email** (só o Google fica).

### 2. Google (login)

Um projeto do Google Cloud **só para este app** (a tela de consentimento é uma por projeto).

1. **Google Auth Platform → Branding:** nome "Finanças da Família" e e-mail de suporte.
2. **Público-alvo:** Externo, status **Em teste**, e os dois e-mails em **Usuários de teste**.
3. **Clientes → Criar cliente:** Aplicativo da Web. Em **URIs de redirecionamento autorizados**, a Callback URL que o Supabase mostra em *Authentication → Providers → Google* (`https://<ref>.supabase.co/auth/v1/callback`).
4. Colar o ID do cliente e a chave secreta no Supabase (provedor Google), ativar e salvar.

### 3. Netlify

1. **Add new project → Import an existing project → GitHub →** este repositório. Build e pasta vêm do `netlify.toml`.
2. **Environment variables:** `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (os mesmos valores do `.env.local`).
3. **Deploy.** A cada push na `main`, o Netlify publica de novo.

Sem git, também dá para rodar `npm run build` e arrastar a pasta `dist` em *Deploy manually*.

### 4. Endereços no Supabase

**Authentication → URL Configuration:**

- **Site URL:** o endereço do Netlify (ex.: `https://financas-familia.netlify.app`)
- **Redirect URLs:** o endereço do Netlify, o domínio próprio (se houver) e `http://localhost:5173`

### 5. Domínio próprio (opcional)

Netlify → **Domain management → Add a domain** (ex.: `financas.seudominio.com`), depois no Squarespace → **DNS** um registro **CNAME** `financas` → `<site>.netlify.app`. Incluir o domínio nas Redirect URLs do Supabase.

## Período de teste e reset

Usar o app antes de 2027 é o período de teste. Se quiserem começar 2027 do zero, no SQL Editor:

```sql
select * from preview_reset('2027-01-01');  -- só mostra: saldo inicial novo por conta e quantos lançamentos saem
select reset_trial('2027-01-01');            -- apaga os lançamentos antes da data
```

O reset mantém contas, categorias, recorrências e as parcelas de 2027 em diante, e passa o saldo para o saldo inicial de cada conta, então os saldos não mudam. **Não tem como desfazer:** exporte para Excel antes, se quiser uma cópia. Só o SQL Editor consegue rodar esses comandos; os usuários do app não.

## Desenvolvimento com banco local (Docker)

```bash
npx supabase start
```

Roda o schema localmente. Depois, com a chave `service_role` local que aparece em `npx supabase status`:

```bash
node supabase/seed-local.mjs <SERVICE_ROLE_KEY>
```

Isso cria `casal1@example.test` (permitido) e `intruso@example.test` (bloqueado). Aponte o `.env.local` para `http://127.0.0.1:54321` com a chave anon local. O login Google não funciona localmente; entre pelo console do navegador:

```js
(await import('/src/supabase.ts')).supabase.auth.signInWithPassword({ email: 'casal1@example.test', password: 'local-test-only-123' })
```

Para desligar: `npx supabase stop`.

## Bom saber

- O plano grátis do Supabase **pausa o projeto após ~1 semana sem uso** e permite 2 projetos ativos. Exporte um backup de vez em quando.
- Valores são guardados em centavos inteiros, sempre na moeda da conta; a conversão EUR ↔ BRL usa a cotação do dia de cada lançamento.
- Todas as mudanças ficam no histórico (`audit_log`): quem mudou o quê e quando.
