# Auditoria & Refatoração FINANCEIRO — documento de trabalho

> Companion de `auditoria-refatoracao-mdm.md` (que **deferiu** explicitamente a consolidação
> financeiro/serviços — ver seção 2 daquele doc: "Requer auditoria de
> `ProdutoFinanceiro`/`ServicoProduto`/`TipoServico` antes de mexer"). Este arquivo é essa auditoria.
>
> **Fase 1 = SOMENTE LEITURA.** Nenhuma migration aplicada. Nenhum dado tocado. Nenhum script rodado.
> Branch `refactor/arquitetura-mdm`. Execução **incremental por lote**, aditiva, sem parada.
>
> ⚠️ **FREEZE ATIVO:** outra sessão executa migração Legacy→V2 na produção. Nada de
> migration/backfill/seed/deploy/env/worker/escrita-Prisma até autorização expressa.

## Regra máxima (herdada)
Cadastro mestre **define** a entidade; consumidores **configuram o uso** e referenciam por **FK real**.
Mestre nunca contém preço/custo/fornecedor/fase/gatilho/aplicabilidade.

---

## 0. Descoberta central (o mais importante)

**A arquitetura-alvo do brief já está ~70% implementada.** O sistema NÃO precisa de módulos novos:

- **`ItemCatalogo` já é o pivot mestre** ("Catálogo Mestre" — a própria tela se auto-descreve como
  "a FONTE ÚNICA de itens; cada item existe UMA vez aqui; Produtos/Preços/Regras só REFERENCIAM").
  Todas as ilhas apontam para ele por FK: `TipoDocumentoCadastro`, `TipoServico`, `ServicoProduto`,
  `ProdutoFinanceiro`, `TabelaValor`, `NecessidadeDocumental`.
- **`ProdutoFinanceiro` já é ~90% do `ConfiguracaoFinanceiraItem` do brief** — tem `itemCatalogoId` (FK),
  `naturezaFinanceira` (cost/revenue), `categoria`→CategoriaFinanceira, `planoConta`→PlanoConta,
  `moedaPadrao`, `custoInterno`, `repasse`, `reembolsavel`, `cobravelDoCliente`. **Adaptar, não recriar.**
- **`resolverPreco()` já existe** (`src/lib/motor/pricing-resolver.ts`) com precedência
  processo > nacionalidade > região > fornecedor > global. **Endurecer, não construir do zero.**
- **Idempotência já existe** via `MotorArtefato.automaticKey @unique` + `comIdempotencia()`.
  **Reaproveitar, não criar outro mecanismo.**
- **Dual-write mestre já existe** (`src/services/catalogo-sync.ts`).
- **Menu não são rotas** — todo "Gerenciamento" é UMA página SPA (`src/app/administrator/page.tsx`)
  com troca de `?screen=<key>`. Reorganizar menu = editar `managementNavigation.tsx` + mapa `TELAS` +
  `ALIAS_TELAS`. **Nenhuma rota a deletar; transição read-only/redirect é trivial.**

Conclusão: o trabalho é **conectar/normalizar FKs, remover mistura de responsabilidades e higienizar dados**
— não reescrever. Isso cumpre "zero retrabalho / reaproveitar arquitetura".

---

## 1. Matriz canônica financeira (provada por leitura)

Legenda ação: **MANTER** · **ADAPTAR** (evoluir in-place) · **VISÃO** (read-only) · **REDIRECIONAR** · **REMOVER (só no contract)**

| # | Estrutura atual (schema) | Responsabilidade atual | Mestre correto | Consumers reais | Ação |
|---|---|---|---|---|---|
| 1 | `TipoDocumentoCadastro` (2221) | Mestre de **tipos de documento** | **ele mesmo** (spine: `itemCatalogoId`) | `Documento.documentTypeId`, matriz-documental, aplicabilidade-economica, docs API, `document-type-resolver`, necessidade (~11) | **MANTER** (mestre) |
| 2 | `ItemCatalogo` (2416) | Pivot/spine "Catálogo Mestre" | **spine técnico** (join único) | `TipoDocumentoCadastro`, `TipoServico`, `ServicoProduto`, `ProdutoFinanceiro`, `TabelaValor`, `NecessidadeDocumental` | **MANTER como spine + VISÃO** (bloquear criação manual de doc/serviço que já têm mestre) |
| 3 | `ProdutoFinanceiro` (1714) | "Produtos" — item financeiro/cobrável | vira **`ConfiguracaoFinanceiraItem`** (papel financeiro de um `ItemCatalogo`) | PhaseTriggerRule (itemCode/financialItemId, texto), PhaseEconomicRule (custo/receitaProdutoCode, texto), ServicoProduto M2M, executor/matriz | **ADAPTAR** (renomear conceito + FKs reais + reduzir a config) |
| 4 | `TabelaValor` (1745) | "Tabelas de Preços" | **ele mesmo** (preço por config+contexto) | `resolverPreco()`; UI grava campos que o resolver NÃO lê (quebra) | **ADAPTAR** (FK p/ config, tirar faseKey/produtoServicoId/condicao texto, corrigir break) |
| 5 | `PhaseEconomicRule` (2396) | "Aplicabilidade Econômica" | **ele mesmo** (contexto de uso) | `matriz-economica.ts`, seed | **ADAPTAR** (documentTypeCode/custo/receitaProdutoCode texto → FK; `componentName`=coluna planilha auditar) |
| 6 | `Honorario` (1796) | "Honorários" (mistura tudo) | **mestre de honorário** (só code/nome/tipo/desc/status) | HonorariosTab, honorarios API | **ADAPTAR** (extrair valor/moeda→TabelaValor; momentoCobranca→automação; servico texto→FK) — **órfão hoje** |
| 7 | `ServicoProduto` (1836) | "Serviços" (global) | ilha → `ItemCatalogo` (SRV_) | ProdutosServicosTab, receitas/custos (productServiceId solto) | **ADAPTAR** (remover M2M "itens financeiros"; nationality texto→FK) |
| 8 | `TipoServico` (722) | serviço por-processo | ilha → `ItemCatalogo` | Receita/Custo `tipoServicoId` | **MANTER** (instância operacional) |
| 9 | `PhaseTriggerRule` (2174) | "Automações Financeiras" | **ele mesmo** (quando disparar) | executor.ts, disparo-fase API, simulacao | **ADAPTAR** (itemCode/financialItemId texto→FK p/ config; `allowRepeat`/`automatic` mortos) |
| 10 | `PhaseAutomationRule` (2142) | "Regras por Fase" (genérica) | **ele mesmo** | executor.ts, automacoes-fase API | **ADAPTAR** (params.financialItemCode texto→FK) |
| 11 | `ModeloAutomacao` (2053) | "Presets" | **ele mesmo** | modelos-automacao API | **MANTER** |
| 12 | `Receita`/`Custo` (1153/1201) | Lançamentos (fatos) | **eles mesmos** | financeiro API, motor, financas dashboards | **ADAPTAR** (snapshot imutável + idem key na linha + fornecedor FK) |
| 13 | `ParcelaFinanceira` (1254) | parcelas | **ele mesmo** | financas | **MANTER** |
| 14 | `TaxaPagamento` (1873) | "Taxas de Pagamento" | **ele mesmo** (custo de processamento) | TaxasPagamentoTab | **MANTER** (cadastro especializado, não é produto operacional) |
| 15 | `RegraComissao`/`RegraDesconto` (1811/1825) | Comissões / "Regras de Precificação"(label errado) | mestres planos, órfãos | comissao/desconto API | **MANTER** (corrigir label do menu) |
| 16 | Concentradores (estruturafin, precificacao, comercial, pagamentos, fornecedoresconc, integracaofin) | Telas "wrapper" | — | reembrulham leaf tabs (duplicação de navegação; vários sub-tabs `Comp: null`) | **REMOVER do menu** (ou reduzir a atalhos) |
| 17 | Scaffolds `finauto`, `execmatrix` | menu Automações sem backend | — | nenhum (estáticos; `execmatrix` com título errado) | **REDIRECIONAR** p/ telas reais ou remover |

---

## 2. Sobreposições / duplicações confirmadas (com evidência)

1. **Documento triplicado:** enum `TipoDocumento` → `ItemCatalogo` `DOC_<enum>` → `TipoDocumentoCadastro.legacyEnumKey`.
   Além disso `seed-catalogo-mestre.ts` cria `CERT_*_IT` que **sobrepõem** os `DOC_*` (dois codes p/ a mesma certidão → risco de dedup). Fonte: `backfill-cp2-catalogo.ts:26-55`, `seed-catalogo-mestre.ts:13-17`.
2. **Espelho "— Custo/— Receita":**
   - LEGADO: duas linhas `ProdutoFinanceiro` (`CIT_CUSTO` cost 150 BRL / `CIT_RECEITA` revenue 90 EUR), `seed-precos-teste.ts:12-31`, ambas linkadas a UM `CERT_NASCIMENTO_IT`.
   - NOVO (correto): duas linhas `TabelaValor` `natureza` CUSTO/RECEITA sobre UM item, `seed-precos-tabela-valores.ts:29-30`.
   - Seam sobrevivente: `ProdutoFinanceiro.naturezaFinanceira` (string cost/revenue).
3. **Serviço duplo:** `ServicoProduto` (global) + `TipoServico` (por-processo) ambos com `itemCatalogoId`.
4. **`Honorario` órfão:** sem `itemCatalogoId`, `servico` texto livre, sem catalogo-sync. `NaturezaItem.HONORARIO` existe mas nenhum FK usa.
5. **Vínculo por texto (o pior):**
   - `PhaseEconomicRule.documentTypeCode` / `custoProdutoCode` / `receitaProdutoCode` → tudo por código-texto.
   - `PhaseTriggerRule.itemCode` → `ProdutoFinanceiro.codigo` (texto). `ProdutoFinanceiro.codigo` **nem é @unique**.
   - `TabelaValor.processoTipoId`/`faseKey`/`produtoServicoId`/`condicao` → texto solto.
6. **"Itens financeiros vinculados"** no cadastro de Serviço (`ProdutosServicosTab.tsx:263-280`, M2M `ServicoProduto↔ProdutoFinanceiro`) — pertence à Aplicabilidade/Automações.
7. **Duplicação de navegação:** 6 concentradores reembrulham as leaf tabs; `suppliers` aparece em Financeiro **e** Pessoas.

---

## 3. Bugs de arquitetura achados (independentes do brief, mas críticos)

- **B1 — Preço do usuário invisível ao motor:** a tela "Tabela de Valores" (`TabelaValoresTab.tsx` + `tabela-valores/route.ts`) **nunca grava `itemCatalogoId`/`natureza`/`regiao`/`processoId`**, mas `resolverPreco()` exige `itemCatalogoId`+`natureza` no `where`. → qualquer preço criado pela UI **não é encontrado** pelo resolver. Só seeds geram linhas visíveis. **Precificação está desconectada da execução.**
- **B2 — Zero silencioso:** `TabelaValor.valor` default 0 + `seed-precos-tabela-valores.ts` cria linhas `[AJUSTAR]` globais com `valor:0`. O resolver casa no nível `global` e retorna **0 real**, suprimindo o fallback `valorPadrao`. Fase 7 exige "nunca zero silencioso".
- **B3 — V2 sem financeiro (interage com a migração concorrente):** o motor financeiro (`executor.ts`, `matriz-economica.ts`) só roda p/ processos **legacy** (`dispararMotorNaFaseAtual` aborta se `processoEmRuntimeV2`). O caminho V2 (`PhaseAdvanceService`) **não gera Receita/Custo** — só escreve `DomainOutbox`, e **não há worker consumindo o outbox**. → **processos migrados Legacy→V2 param de gerar lançamentos financeiros.**
- **B4 — `pricingRuleId` morto:** coluna existe em Receita/Custo mas **nunca é gravada**.
- **B5 — `Custo.fornecedor` é texto** (não FK `Fornecedor`); Receita não tem fornecedor.
- **B6 — Estorno de ledger inexistente:** enums `ESTORNO_*` existem mas não usados p/ Receita/Custo; estorno real só em `PagamentoFatura`/`PagamentoOutroCusto`. Reversão de Receita/Custo é só soft-delete (`cancelada`).
- **B7 — `allowRepeat`/`automatic` de `PhaseTriggerRule` são campos mortos** (nunca lidos pelo motor).

---

## 4. Mestre canônico de cada entidade (decisão-alvo, alinhada ao doc MDM)

| Entidade | Mestre canônico | Papel do `ItemCatalogo` |
|---|---|---|
| Documento (tipo) | `TipoDocumentoCadastro` | espelho 1:1 auto-derivado (system-owned), não criável à mão |
| Serviço | mestre de Serviço (evoluir `ServicoProduto` puro) no módulo operacional | idem |
| Honorário | mestre `Honorario` enxuto | passa a ter `itemCatalogoId` (natureza HONORARIO) |
| Config. financeira | `ConfiguracaoFinanceiraItem` (= `ProdutoFinanceiro` adaptado) | referencia `ItemCatalogo` por FK |
| Preço | `TabelaValor` (por config + contexto) | via config→ItemCatalogo |
| Nacionalidade/Modalidade | `TipoProcessoNacionalidade`/`CatalogoPais`/`ModalidadePais` (Processos) | nunca recriado no Financeiro |
| Fornecedor | `Fornecedor` | referenciado por FK em todo lugar |
| Taxa de pagamento | `TaxaPagamento` | fora do catálogo (não é entidade operacional) |

**Reconciliação (resolve a tensão "quem é o mestre"):** `ItemCatalogo` permanece como **spine normalizada** (o que já é),
mas os itens de documento/serviço passam a ser **derivados automaticamente** dos cadastros de domínio (1:1, system-owned),
e a **tela Catálogo Mestre deixa de permitir criação manual** desses tipos. Assim: identidade mora no cadastro de domínio
(brief) **e** tudo referencia por FK única (código atual). Cumpre Fase 10 ("visão federada / não-duplicado") sem inverter FKs.

---

## 5. Migrations necessárias (a ESCREVER, não aplicar — todas aditivas)

> Ordem pensada p/ não colidir com a migração Legacy→V2 concorrente. Cada uma = migration revisável + backfill dry-run + validação + rollback lógico, todos idempotentes.

- **M1 — Config canônica:** renomear conceito `ProdutoFinanceiro`→`ConfiguracaoFinanceiraItem` (ou view/alias), `@@unique([itemCatalogoId, papelFinanceiro])`, `codigo @unique`, `papelFinanceiro` enum (CUSTO/RECEITA/REPASSE/REEMBOLSO/DESPESA_INTERNA/HONORARIO). Aditivo: novas colunas/enum, manter antigas.
- **M2 — FKs reais nas automações/aplicabilidade:** add `configItemId Int?` FK em `PhaseTriggerRule`, `PhaseAutomationRule` (via coluna), `PhaseEconomicRule` (custoConfigId/receitaConfigId + `tipoDocumentoId` FK). Dual-read com os campos-texto legados.
- **M3 — Tabela de Preços:** garantir `configItemId` FK gravado pela UI; corrigir B1 (UI passa a setar itemCatalogoId+natureza via config); depreciar `faseKey`/`produtoServicoId`/`condicao`.
- **M4 — Honorário no catálogo:** add `itemCatalogoId` FK + catalogo-sync p/ Honorario; mover valor/moeda→TabelaValor, momentoCobranca→regra.
- **M5 — Snapshot + idempotência no ledger (Fase 8):** add em Receita/Custo: `configItemId` FK, `fornecedorId` FK, `contaContabilId`, `centroCustoId`, `quantidade`, `stepInstanceId`, `automationRuleId`, `chaveIdempotencia @unique` (reusar padrão MotorArtefato). Gravar `pricingRuleId`. Snapshot imutável.
- **M6 — Endurecer resolver (Fase 7):** unificar em `resolverPrecoFinanceiro()`; erro explícito em vez de zero; nunca match por nome/código-texto; retornar {preço, moeda, regra, prioridade, especificidade, razão, descartadas}.
- **M7 — V2 financeiro (corrige B3):** worker de `DomainOutbox` OU efeito financeiro no `PhaseAdvanceService` (decisão a coordenar com a sessão da migração V2). **Alto risco — lote próprio, coordenado.**

Backfill (Fase 13): p/ cada `ProdutoFinanceiro`/`ItemCatalogo`, localizar mestre, criar config referenciando, migrar papel/categoria/conta/moeda/fornecedor/valor→preço, preservar ID legado em mapa. Colapsar espelhos `*_CUSTO`/`*_RECEITA`.

---

## 6. Riscos

| Risco | Sev | Mitigação |
|---|---|---|
| **Migração Legacy→V2 concorrente** grava na mesma DB/branch | 🔴 | FREEZE respeitado; zero DB nesta sessão; aguardar término |
| **Conflito de merge em `schema.prisma`** (outra sessão pode editá-lo) | 🔴 | **Não editar schema.prisma até coordenar** com a sessão V2; alinhar ordem de migrations |
| **B3: processos V2 sem financeiro** — a própria migração amplia o problema | 🔴 | Priorizar M7 coordenado; medir quantos processos já em V2 sem lançamentos (read-only, pós-freeze) |
| Espelhos `*_CUSTO/*_RECEITA` e `CERT_*_IT`/`DOC_*` duplicados | 🟠 | dedup no backfill com mapa de migração; nada deletado sem relatório+backup |
| Registros `[TESTE]`/`[AJUSTAR]`/valor 0 alimentando o motor | 🟠 | saneamento Fase 14 classificado; sem DELETE de item com consumidor |
| Vínculos por texto quebram em silêncio | 🟠 | migrar p/ FK com dual-read antes de cortar o texto |
| UI grava campos que o motor não lê (B1) | 🟠 | corrigir junto com M3 antes de anunciar precificação "pronta" |

---

## 7. Ordem de implementação (lotes seguros, aditivos)

0. **[FEITO] Fase 1 auditoria read-only** (este doc).
1. **Coordenação** com a sessão Legacy→V2: fim da migração + protocolo de edição de `schema.prisma`.
2. **Lote F1 — Config canônica (M1)** + adaptar tela "Produtos"→"Configurações Financeiras" (mesmo backend).
3. **Lote F2 — FKs automações/aplicabilidade (M2)** dual-read; corrigir labels/renames de menu (só `managementNavigation.tsx` + `TELAS`).
4. **Lote F3 — Tabela de Preços (M3) + resolver (M6)**; corrige B1/B2.
5. **Lote F4 — Honorário no catálogo (M4)**; enxugar mestres Serviço/Honorário (remover mistura/M2M).
6. **Lote F5 — Snapshot+idempotência ledger (M5)**; estorno de ledger (B6).
7. **Lote F6 — V2 financeiro (M7)** — coordenado, corrige B3.
8. **Lote F7 — Menu final + concentradores/scaffolds**; Catálogo Mestre → visão read-only.
9. **Saneamento (Fase 14)** + cutover/contract (Fases 15–17) só com zero consumidores legados provado.

Cada lote: migration aditiva (não aplicada aqui) → dry-run → backfill → validação → tsc/build/testes-sem-DB → smoke em staging → só então produção, sob autorização.

---

## 8b. Artefatos preparados nesta sessão (arquivos NOVOS, zero conflito, sem schema/DB)

**Bibliotecas / serviços (runtime, reaproveitáveis):**

| Arquivo | O que é | Estado |
|---|---|---|
| `src/lib/motor/resolver-preco-financeiro.ts` | `resolverPrecoFinanceiro()` endurecido (Fase 7): núcleo PURO + wrapper. Corrige B2 (nunca zero), desempate determinístico, guarda NaN/∞, `dataEvento` opcional, **detecção de conflito** (preços concorrentes no mesmo nível), resultado rico, fallback explícito, **`paraCompat()`** (drop-in do resolver legado). Não substitui `pricing-resolver.ts` ainda. | tsc OK |
| `src/lib/motor/resolver-preco-financeiro.prisma.ts` | Loader com banco (Decimal→number) + `resolverPrecoFinanceiroDB()`/`resolverCustoEReceitaDB()`. **Somente leitura.** Separado p/ manter o núcleo puro. | tsc OK |
| `src/lib/financeiro/configuracao-financeira-view.ts` | Adaptador (view) que projeta `ProdutoFinanceiro` no vocabulário "Configuração Financeira" (Fase 3), agrupando por item mestre (1 entidade, N papéis). Papel derivado conservador (CUSTO/RECEITA); resto como facetas até M1. | tsc OK |
| `prisma/_financeiro-checks.ts` | Checagens de saneamento — **lógica PURA** (fonte única do inventário e do gate). Marca `gate` (bloqueia cutover) vs limpeza. | tsc OK |
| `prisma/_financeiro-coleta.ts` | Coleta **somente leitura** (findMany + normalização) compartilhada. | tsc OK |

**Scripts (somente leitura / testes):**

| Arquivo | O que é | Estado / rodar |
|---|---|---|
| `prisma/inventario-financeiro.ts` | Relatório de saneamento (usa checks+coleta). Nunca escreve. | **NÃO executado** (freeze) · `npx tsx prisma/inventario-financeiro.ts [--json]` |
| `prisma/validacao-financeira.ts` | **Gate de cutover**: sai !=0 se houver violação de invariante (texto quebrado, zero, órfão, código dup). | **NÃO executado** (freeze) · `npx tsx prisma/validacao-financeira.ts [--json]` |
| `prisma/dry-run-config-financeira.ts` | **Dry-run** do backfill F1/M1 sobre o schema ATUAL: mapa mirror→config, papéis por mestre, órfãos, preço default proposto. Nunca escreve. | **NÃO executado** (freeze) · `npx tsx prisma/dry-run-config-financeira.ts [--json]` |
| `scripts/resolver-preco-financeiro.test.ts` | 32 testes unitários puros (precedência, zero, fallback, vigência, per_unit, desempate, **conflito**, compat). | **32/32 ✅** |
| `scripts/resolver-preco-financeiro.integration.test.ts` | Integração com banco (transação + **rollback**, nada persiste). | Pronto, **NÃO executado** (freeze) |
| `scripts/financeiro-checks.test.ts` | 19 testes com fixtures das checagens de saneamento. | **19/19 ✅** |
| `scripts/idempotencia-lancamento.test.ts` | Guarda estrutural do contrato de idempotência (`MotorArtefato.automaticKey`). | **11/11 ✅** |
| `scripts/idempotencia-concorrencia.test.ts` | **Concorrência**: N tentativas paralelas → 1 vencedor; prova por que a garantia é UNIQUE no banco. | **5/5 ✅** |
| `scripts/configuracao-financeira-view.test.ts` | Testes puros do adaptador de configuração. | **11/11 ✅** |

Total no-DB: **78/78 ✅**. tsc do projeto: **0 erros**. Nenhum `npm run` novo adicionado (evita conflito em `package.json`); tudo roda por `npx tsx`.

**Ponto de adoção do resolver (Lote F3, coordenado):** em `src/lib/motor/matriz-economica.ts:163,175` trocar
`resolverPreco(...)` por `paraCompat(await resolverPrecoFinanceiroDB({...ctx, fallbackValorPadrao: Number(prod.valorPadrao)}))`
— ou tratar `ok:false` como "pular com motivo" em vez de contabilizar 0. Elimina B2 sem novo motor.

## 8c. Deltas de schema PREPARADOS (⚠️ NÃO aplicar até confirmar que nenhuma outra sessão altera `schema.prisma`)

> Todos aditivos (colunas/models novos nullable + backfill + dual-read). Constraints `@unique` só
> DEPOIS do saneamento (o inventário acha os duplicados que hoje quebrariam o unique).

```prisma
// M1 — Configuração financeira canônica (EVOLUI ProdutoFinanceiro; não recria)
enum PapelFinanceiro { CUSTO RECEITA REPASSE REEMBOLSO DESPESA_INTERNA HONORARIO }
// em ProdutoFinanceiro:
//   papelFinanceiro PapelFinanceiro?              // backfill a partir de naturezaFinanceira
//   @@unique([itemCatalogoId, papelFinanceiro])   // SÓ após dedup dos espelhos
//   (codigo @unique — SÓ após resolver codigo_produto_duplicado do inventário)

// M2 — FKs reais nas automações/aplicabilidade (dual-read com os campos-texto legados)
// PhaseTriggerRule:  configItemId Int?   configItem ProdutoFinanceiro? @relation(fields:[configItemId], references:[id])   @@index([configItemId])
// PhaseEconomicRule: tipoDocumentoId Int? + relation; custoConfigId Int? + relation; receitaConfigId Int? + relation
//   (mantém documentTypeCode/custoProdutoCode/receitaProdutoCode até o cutover)

// M4 — Honorário no catálogo (fecha o órfão)
// Honorario: itemCatalogoId Int?   itemCatalogo ItemCatalogo? @relation(fields:[itemCatalogoId], references:[id])
//   (valorPadrao/moeda → migrar p/ TabelaValor; momentoCobranca → regra por fase; servico texto → FK Serviço)

// M5 — Snapshot imutável + idempotência no ledger (Fase 8) em Receita E Custo:
//   configItemId Int?  (FK ProdutoFinanceiro)      fornecedorId Int? (FK Fornecedor — hoje Custo.fornecedor é texto)
//   contaContabilId Int? (FK PlanoConta)           centroCustoId Int? (FK CentroCusto)
//   quantidade Decimal? @db.Decimal(12,2)          stepInstanceId Int? (FK PhaseWorkflowStepInstance)
//   automationRuleId Int?                          chaveIdempotencia String? @unique   // reusa padrão MotorArtefato
//   (gravar pricingRuleId — hoje coluna morta)
```

**M6** (resolver) já está PRONTO como código (`resolver-preco-financeiro.ts`) — não precisa de schema.
**M7** (V2 financeiro / worker de `DomainOutbox`) — decisão coordenada com a sessão V2; corrige B3.

## 8d. Checklist de aceite (Fase 16) → testes concretos a criar por lote
- Resolver/preço (B1/B2): ✅ coberto por `scripts/resolver-preco-financeiro.test.ts` (falta o teste de integração com TabelaValor real — Lote F3).
- Idempotência/reprocesso: teste tsx reusando `MotorArtefato.automaticKey` (Lote F5).
- Snapshot imutável: alterar preço não muda histórico (Lote F5).
- FK sem texto/órfãos: `prisma/inventario-financeiro.ts` deve retornar **0** em `*_quebrado`, `*_sem_item`, `preco_invisivel_resolver` após os lotes.

## 8. O que NÃO fazer (confirmado pela auditoria)
- Não criar `ConfiguracaoFinanceiraItem` do zero — **adaptar `ProdutoFinanceiro`**.
- Não criar novo resolver — **endurecer `resolverPreco()`**.
- Não criar novo idempotency — **reusar `MotorArtefato.automaticKey`**.
- Não criar novo Catálogo Mestre — `ItemCatalogo` já é.
- Não criar rotas novas de menu — editar `managementNavigation.tsx`/`TELAS`.
- Não recriar documentos/serviços/honorários/nacionalidades/fornecedores — todos têm mestre.
