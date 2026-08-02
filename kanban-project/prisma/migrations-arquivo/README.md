# Migrations históricas — arquivadas em 02/08/2026

As **112 migrations** deste diretório são o histórico real do Discovery entre
13/10/2025 e 04/09/2026. Elas **não estão mais no caminho do Prisma** e **não
serão reaplicadas** — nem aqui, nem em produção.

## Por que saíram de `prisma/migrations`

Elas nunca reconstruíram o banco. Testado em 02/08/2026 num Postgres virgem, o
replay morre na sétima:

```
Applying migration `20260113180000_add_tipo_registro_custo`
Error: P3018 · 42P01 · relation "CustoPessoa" does not exist
```

A migration faz `ALTER TABLE "CustoPessoa"` e **nenhuma migration do repositório
cria essa tabela**. Não é caso isolado: 81 das 165 tabelas de produção nunca
tiveram `CREATE TABLE` versionado. O histórico é um log incremental escrito
sobre um banco que já existia — nunca foi um build a partir do zero.

Com o ledger de produção consolidado em `0000_baseline`, manter as 112 no
caminho do Prisma seria uma armadilha: o próximo `prisma migrate deploy` tentaria
aplicar todas de novo, sobre um banco que já tem o schema final, e quebraria na
sétima — em produção.

## Por que não foram apagadas

São o registro de **como o schema chegou onde chegou**. Servem para arqueologia
(por que esta coluna existe? quando esta constraint nasceu?), para auditoria e
para entender decisões antigas. O que elas não são, e nunca foram, é um caminho
de reconstrução.

## Regras

- **Nada aqui é executado.** Nem por `migrate deploy`, nem por script, nem à mão.
- **Não devolva arquivo para `prisma/migrations`.** O guard
  (`npm run test:baseline`, que roda no build) reprova se aparecer qualquer
  migration além de `0000_baseline`.
- Migration **nova** não vem para cá: nasce em `prisma/migrations`, a partir do
  baseline. Ver `prisma/baseline/README.md`.
