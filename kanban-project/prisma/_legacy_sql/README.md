# 📜 SQLs legados — NÃO RODAR NOVAMENTE

Esta pasta contém scripts SQL que **já foram aplicados no banco de produção**
em momentos passados. Eles estão aqui **apenas como referência histórica**,
para entender como o schema evoluiu antes de usarmos `prisma migrate` de forma
disciplinada.

## ⚠️ Atenção

**NÃO execute nenhum destes arquivos novamente.** Se você rodar, vai dar erro
tipo `relation "X" already exists` ou, pior, pode corromper dados existentes.

Se precisar entender o estado atual do schema, consulte:

1. `prisma/schema.prisma` (fonte da verdade)
2. `prisma/migrations/` (migrations oficiais aplicadas)

## 📋 Histórico dos arquivos

| Arquivo | O que fez | Status |
|---|---|---|
| `add_pagamento_fatura.sql` | Tabela PagamentoFatura | ✅ aplicado |
| `migration-blog.sql` | Tabela BlogPost + enum StatusPost | ✅ aplicado |
| `migration-cliente-auth.sql` | Tabela ClienteAuth (login de clientes) | ✅ aplicado |
| `migration-documento-datas.sql` | Campos de data em Documento | ✅ aplicado |
| `migration-fatura-colunas.sql` | Colunas novas em Fatura (moeda, etc) | ✅ aplicado |
| `migration-fatura-destinatario.sql` | Tabela FaturaDestinatario | ✅ aplicado |
| `migration-followup.sql` | Sistema de follow-up em Tarefa | ✅ aplicado |
| `migration-manual.sql` | Ajustes manuais diversos | ✅ aplicado |
| `migration-ordem-custo.sql` | Campo ordemCusto em Pessoa | ✅ aplicado |
| `migration-parcela.sql` | Tabela Parcela (boletos) | ✅ aplicado |
| `migration-outro-custo.sql` | Tabela OutroCusto + PagamentoOutroCusto + enum NaturezaOutroCusto | ✅ aplicado em 24/04/2026 |
| `migration-add-recibo-estorno.sql` | Tabela Recibo + CounterRecibo + colunas de estorno em PagamentoFatura | ✅ aplicado em 24/04/2026 |
| `migrate-etapas.ts` | Script que migrou nomes/ordem das etapas do Kanban por país | ✅ aplicado há ~3 meses |

## 🔮 Próximas mudanças de schema

Devem ser feitas **sempre via Prisma Migrate**:

```bash
# 1. Edita prisma/schema.prisma
# 2. Roda:
npx prisma migrate dev --name descreva_a_mudanca
```

Isso gera uma migration oficial em `prisma/migrations/` que é versionada
e aplicada automaticamente em produção via Vercel.