# Motor Financeiro V3 — Fase 1 (implementação)

> Infraestrutura **aditiva** do novo motor. **Não altera comportamento atual.** Escrita dupla **desligada por padrão** (`FINANCEIRO_DUAL_WRITE`).

## O que foi entregue

### Schema (aditivo) — `prisma/schema.prisma`
16 models novos + `Cobranca.obrigacaoId` (coluna solta):
`ObrigacaoEconomica` (aggregate root, `version` p/ optimistic lock, `@@unique([origemTipo,origemId])` p/ idempotência do espelho) · `LedgerFinanceiro` · `LedgerEntry` (double-entry: `transacaoId`/`contaContabil`/`direcao`/`valorContabil`/`sequencia`/`idempotencyKey @unique`) · `PlanoContaFinanceira` · `LedgerOpeningBalance` · `OcorrenciaFinanceira` · `AplicacaoFinanceira` · `DistribuicaoEconomica` · `ParticipacaoEconomica` · `Pagador` · `ParteExterna` · `PoliticaCambial` · `SnapshotCambial` · `CreditoFinanceiro` · `SaldoProjecao` (cache) · `SaldoSnapshot` (cache).

### Migration reversível — `20260808000000_motor_financeiro_v3_fase1`
Idempotente (`CREATE TABLE IF NOT EXISTS` ×16 + índices + `ADD COLUMN IF NOT EXISTS "obrigacaoId"`). **Reversão:** `DROP TABLE` das 16 novas + `DROP COLUMN Cobranca.obrigacaoId` (nenhuma toca o legado). Registrada no aplicador de build (`prod-apply-cadastros-aditivas.mjs`) + sentinelas.

### Núcleo PURO (testável sem banco)
- `lib/financeiro/ledger/plano-contas.ts` — plano de contas mínimo + seed.
- `lib/financeiro/ledger/lancamentos.ts` — builders **double-entry balanceados** (Σd=Σc), `montarLancamento` rejeita desbalanceado; ocorrências: obrigação criada, abertura, pagamento (com tarifa/diferença cambial), desconto, encargo, estorno, baixa.
- `lib/financeiro/ledger/projecao.ts` — **replay**: saldo/recebido derivados do Ledger (fonte única); `statusPorSaldo`.
- `lib/financeiro/dominio/obrigacao-economica.ts` — natureza→direção, máquina de estados, **resolverDistribuicao** (IGUAL/PERCENTUAL/VALOR/PERSONALIZADA, centavos na última cota, exclusão manual).
- `lib/financeiro/dominio/eventos.ts` — domain events + chave de idempotência.

### Orquestração SERVER (transacional + idempotente)
- `lib/financeiro/ledger/ledger-service.ts`:
  - `registrarLancamento(tx, …)` — grava as pernas balanceadas (sequência por ledger, idempotência por `transacaoId`) e **recalcula a projeção por replay**.
  - `criarObrigacaoEconomicaComLedger(…)` — cria a obrigação (idempotente por origem), o Ledger, a ocorrência `OBRIGACAO_CRIADA`, o lançamento balanceado e **emite domain event no Outbox** (`DomainOutbox`, dedup por chave). Tudo em `$transaction`.
  - `recomputarProjecao(tx, obrigacaoId)` — upsert de `SaldoProjecao` a partir do replay.

### Escrita dupla (flag OFF) — `lib/financeiro/dual-write.ts`
`espelharReceitaComoObrigacao(...)` — best-effort, **no-op se `FINANCEIRO_DUAL_WRITE !== '1'`**; nunca lança (legado é autoridade). Chamada na criação de cobrança (`receitas/[id]/cobrancas` POST). Idempotente por origem; vincula `Cobranca.obrigacaoId`.

### Seed de build — `prod-seed-plano-contas.mjs`
Idempotente (só PRODUCAO; INSERT do ausente por código). Na cadeia de build.

## Princípios de implementação aplicados (§0 da spec)
Aggregate Root (`ObrigacaoEconomica`) · Domain Events + **Outbox** · **Idempotency Key** (ocorrência/entry/evento) · **Optimistic Locking** (`version`) · histórico **imutável** (append-only, sem update/delete de efeito) · escrita **transacional** · projeção **reconstruível** (replay) · double-entry **balanceado**.

## Testes
- `motor-financeiro-fase1.test.ts` — **33/33** (double-entry balanceado, replay de saldo, agregado, distribuição).
- `motor-financeiro-fase1-guard.test.ts` — **31/31** (schema aditivo, migration idempotente, serviço transacional, flag off, Outbox).
- Suíte financeira completa **verde**; `tsc` limpo; build compila.

## Próximos passos
Fase 2 (conciliação) · Fase 3 (ativação por data de corte + `LedgerOpeningBalance`) · Fase 4 (leitura nova + fallback) · Fase 5 (consolidação: nascimento automático, ocorrências ricas, Posição Financeira).
