# Roadmap

**Status (23/10/2026):** v1 no ar em https://home-budget-felipe-fahl-dev.netlify.app. Outubro a dezembro de 2026 é o período de teste com dados reais; em dezembro decidimos se mantemos o histórico ou zeramos (ver [README](README.md#período-de-teste-e-reset)).

A ordem abaixo é uma sugestão. A prioridade de verdade sai do uso real nesses meses: anote o que incomoda ou falta.

## 1. Combinado nos requisitos

Os três itens validados no [documento de requisitos](https://claude.ai/artifact/DL6tzABuzUxHcGYLqy4VAh) que tinham ficado de fora da v1 entraram em 23/10/2026 (precisa rodar `0003_category_limits.sql` no Supabase):

- [x] **Limite por categoria ajustável:** definido na aba Categorias (em EUR ou BRL); o painel mostra a barra do mês e avisa a partir de 80%. Gastos das subcategorias contam no limite da categoria mãe.
- [x] **Comparar meses:** card no painel com o mês atual, o anterior e o mesmo mês do ano passado, nos totais e nas 8 categorias com mais gasto.
- [x] **Simular uma compra parcelada:** ao lançar uma compra parcelada no cartão, o formulário mostra cada fatura futura com o que ela já tem, o que esta compra soma e o total.

## 2. Limitações conhecidas da v1

| O quê | Efeito | Saída |
|---|---|---|
| Recorrentes só são criados para o mês atual, quando alguém abre o app | Se ninguém abrir o app num mês inteiro, aquele mês fica sem o lançamento "a confirmar" | Criar os meses que faltam ao abrir, ou um job no banco (`pg_cron`) |
| Recorrência só mensal | IMI, seguros anuais e outras contas anuais ou trimestrais viram lançamento avulso | Frequência (mensal, trimestral, anual) na recorrência |
| "Restaurar grupo" na lixeira depois de refazer parcelas | Traz de volta as parcelas antigas junto com as novas | Marcar as parcelas substituídas e não oferecer restaurá-las |
| Lixeira com mais de 30 dias | Itens antigos só ficam escondidos, não são apagados | `pg_cron` apagando de vez, se o espaço importar |
| Cotação guardada só no navegador | Sem internet ou se o Frankfurter cair, o total junto (EUR+BRL) aparece como "—" | Guardar as cotações numa tabela no Supabase |
| Subcategoria tem tipo próprio | "Viagens › Passagens" pode ser essencial enquanto "Viagens" é ajustável | Herdar o tipo do pai |
| Todos os lançamentos carregados de uma vez | Sem problema até dezenas de milhares de lançamentos | Filtrar no servidor quando crescer |
| Supabase grátis pausa após ~1 semana sem uso | O app fica fora até reativar no painel | Uso diário evita; backup periódico (item 3) |
| Sem testes automáticos de interface | Só a lógica de dinheiro e as regras do banco têm testes (26) | Testes de ponta a ponta com Playwright |

## 3. Próximas evoluções

**Curto prazo** (pouco esforço, muito uso)

- [ ] **Importar extrato em CSV/Excel** do banco e do cartão, com categoria sugerida por descrição ("Pingo Doce" → Mercado).
- [ ] **App instalável (PWA):** ícone na tela inicial, abre em tela cheia e lança gasto mais rápido.
- [ ] **Backup automático:** exportação periódica de todas as tabelas, por exemplo um CSV por mês no Google Drive.
- [ ] **Lembretes:** fatura vencendo, recorrentes a confirmar, meta do mês em risco (e-mail ou notificação).

**Médio prazo**

- [ ] **Metas de objetivo:** "viagem de dezembro: € 2.000 até 10/12", com quanto falta por mês.
- [ ] **Relatório anual:** quanto entrou, saiu e foi poupado por ano, por país e por categoria.
- [ ] **Divisão por pessoa** (opcional): quem gastou o quê, sem deixar de ser tudo compartilhado.

**Longo prazo** (fora da v1 por custo)

- [ ] Ligação direta com os bancos (open banking) para puxar o extrato sozinho.
- [ ] Ler a fatura do cartão em PDF.
- [ ] Acompanhar investimentos (saldo, rendimento).
- [ ] App nas lojas (Play Store, App Store).
