# Pacote de deploy — Financeiro: preço fonte única + Financeiro Geral canônico

**NÃO executar em produção sem janela coordenada.** Todas as migrations são ADITIVAS
(sem DROP). Valide antes em **preview/teste** (nunca no banco de prod).

## Migrations envolvidas (aditivas, idempotentes)
1. `20260718120000_preco_fonte_unica_aditivo` — enum NaturezaFinanceira, VENDA,
   naturezaFin, migradoDeCampoLegado, congelamento/rastreabilidade em Receita/Custo,
   model PendenciaFinanceira.
2. `20260718130000_fin_geral_cancel_estorno_origem` — origem/competência/cancelamento/
   estorno em Receita/Custo, origem/custoOrigemId em ContaPagar, resolucao em Pendencia.

## Backfills (dry-run padrão; execução só em preview/teste)
- `backfill-precos-legado-tabelavalor.ts` — valorCusto/ReceitaPadrao → TabelaValor (CUSTO/VENDA).
- `backfill-origem-financeiro.ts` — classifica ContaPagar CORPORATIVA/ORIGEM_DESCONHECIDA + relatório §3.

## Validação segura em PREVIEW/TESTE (antes de prod)
```bash
# 1) Aponte para um banco de TESTE/PREVIEW (NUNCA prod). Preencha .env.test:
cp .env.test.example .env.test      # editar PRISMA_DATABASE_URL/DIRECT + PROD_DB_HOST

# 2) Guard + migrations no banco de teste
DB_ENV=test PROD_DB_HOST=<host-prod> \
  dotenv -e .env.test -- npm run migrate:test        # guard:db && prisma migrate deploy

# 3) prisma generate + typecheck + testes unitários
npx prisma generate
npx tsc --noEmit
npm run test:financeiro                               # 95 testes puros

# 4) Backfills — dry-run primeiro, depois execução no banco de TESTE
dotenv -e .env.test -- npm run backfill:precos-legado:dry
dotenv -e .env.test -- npm run backfill:precos-legado
dotenv -e .env.test -- npm run backfill:origem-financeiro:dry
dotenv -e .env.test -- npm run backfill:origem-financeiro

# 5) Build seguro (NÃO conecta em prod: guard + env de teste)
DB_ENV=test PROD_DB_HOST=<host-prod> dotenv -e .env.test -- npm run build:safe

# 6) Validação manual das telas em preview: A Receber, A Pagar, Fluxo, DRE,
#    Tesouraria, Dashboard, Financeiro do Processo — conferir origem/link/status,
#    cancelar/estornar, pendências, totais.
```

## SEQUÊNCIA EXATA PARA PRODUÇÃO (executar na janela, com a credencial de prod)
> Fonte da credencial: `~/.discovery-prod-rollout.env`. Deploy Vercel `--prod` do diretório pai.

1. **Commit do código** (branch `feat/preco-fonte-unica`), push.
2. **Aplicar migrations** em prod: `prisma migrate deploy` (endpoint pooled). As duas migrations acima.
3. **Prisma generate** (o `build` do projeto já roda `prisma generate && next build`).
4. **Backfill de preços — dry-run**: `npm run backfill:precos-legado:dry` (confirmar nº de configs/preços/pulados).
5. **Backfill de preços — execução**: `npm run backfill:precos-legado`.
6. **Backfill de origem — dry-run**: `npm run backfill:origem-financeiro:dry` (confirmar CORPORATIVA/ORIGEM_DESCONHECIDA + relatório de regras incompatíveis).
7. **Backfill de origem — execução**: `npm run backfill:origem-financeiro`.
8. **Deploy do código**: `vercel --prod` (do diretório pai), alias `app.discovery.com.br`.
9. **Smoke tests**: `/` = 200; `GET /api/financas/projecao` = 200; `GET /api/financas/receber`/`pagar` = 200; `GET /api/financas/pendencias` = 200.
10. **Validação dos totais**: comparar A Receber/A Pagar/Fluxo/DRE antes×depois; conferir que custo de processo aparece 1x em A Pagar (sem duplicar ContaPagar); estorno reflete como inverso; cancelados fora dos totais ativos.
11. **Rollback NÃO destrutivo** (abaixo).

## Plano de rollback (não destrutivo)
- **Código**: `vercel rollback` / redeploy do deployment anterior (READY) — reverte a UI e a lógica sem tocar dados.
- **Migrations**: são ADITIVAS — as colunas/tabelas novas ficam no banco sem uso pelo código antigo (default seguro `origem='PROCESSO'/'CORPORATIVA'`, nullable). **Não é preciso desfazer** para o app antigo funcionar. Enum values novos (VENDA, NaturezaFinanceira) NÃO são removíveis trivialmente — deixe-os.
- **Backfills**: os preços migrados em TabelaValor têm `migradoDeCampoLegado=true` (filtráveis); as origens classificadas em ContaPagar podem ser revertidas para default. Os campos legado de valor da config foram PRESERVADOS — nenhuma perda.
- **Estornos/cancelamentos**: são operações registradas (não apagam nada); um redeploy antigo apenas para de exibir os botões.
```
```
