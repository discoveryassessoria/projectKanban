# Arquitetura Financeira V2 — Orientada a Contrato Financeiro

> **Status:** proposta para validação. **Nada será implementado antes do aceite.**
> **Regra inegociável:** evolução 100% aditiva — nenhuma migration destrutiva, nenhum dado removido, nenhuma funcionalidade quebrada, snapshots históricos imutáveis.

---

## 0. Princípio mestre

O sistema deixa de ser orientado a **Receita** e passa a ser orientado a **Contrato Financeiro**.

- Uma **Receita** é apenas *um tipo* de contrato financeiro.
- Todos os tipos (Receita, Receita Extra, Lançamento Extra, Desconto, Reembolso, Multa, Juros, Crédito, Estorno, Renegociação, e Custo) usam **o mesmo motor financeiro** (o atual `ChargeCalculationService`, generalizado).
- O operador **informa fatos** (ocorrências). O **motor decide** (cálculo, cronograma, saldo, conciliação).

Três camadas, nunca misturadas:

| Camada | O que é | Mutabilidade |
|---|---|---|
| **Contrato Financeiro** | A obrigação econômica (o "quanto" e "de quem/para quem") | Versionável (nova versão, nunca reescreve) |
| **Obrigações** | Cobranças, Parcelas, Vencimentos (o "quando/como cobrar") | Derivadas do contrato; canceláveis, nunca apagadas |
| **Ocorrências** | Pagamento, estorno, desconto, renegociação, baixa… (o "o que aconteceu") | **Append-only** — nunca alteram histórico; geram novos eventos |

---

## 1. Modelo conceitual

```
ContratoFinanceiro (1) ──< Obrigacao/Cobranca (N) ──< Parcela (N)
        │                          │
        │                          └──< OcorrenciaFinanceira (N)  [ledger append-only]
        │
        ├──< DistribuicaoEconomica (N)   (beneficiários e participação)
        ├──── SnapshotContrato (regra/câmbio/condição congelados na criação)
        └──< VersaoContrato (renegociação = nova versão)

OcorrenciaFinanceira ──> Pagador (1)         (quem pagou; pode ser externo)
                    ──> SnapshotCambial (1)   (moeda/cotação/diferença congelados)
                    ──> aplicações (N)        (a quais parcelas o valor foi imputado)
```

**Event-sourcing leve:** o **saldo** e o **status** do contrato/obrigações são *projeções* recalculadas a partir do ledger de ocorrências. O ledger é a fonte da verdade histórica; as tabelas de saldo/status são cache materializado (reconstruível). Isso garante "uma ocorrência nunca altera o histórico — gera novos eventos".

---

## 2. Entidades

### 2.1. Novas (aditivas)

**`ContratoFinanceiro`** — abstração unificadora.
- `id`, `codigo` (CTR-n), `tipo` (RECEITA | RECEITA_EXTRA | LANCAMENTO_EXTRA | DESCONTO | REEMBOLSO | MULTA | JUROS | CREDITO | ESTORNO | RENEGOCIACAO | CUSTO)
- `processoId?`, `clienteId?`, `regraFinanceiraId?`
- `moedaContratual`, `moedaContabil` (default BRL)
- `valorContratado`, `politicaCambial` (FIXO | VARIAVEL | SNAPSHOT), `politicaDivisao`
- `status` (RASCUNHO | ATIVO | LIQUIDADO | CANCELADO)
- `versao`, `substituiId?` (renegociação/versionamento)
- `origemTipo` (`Receita` | `Custo` | `nativo`), `origemId?` — **ponte para os dados atuais**
- `criadoEm`, `atualizadoEm`, `criadoPorId?`, `observacoes?`

**`DistribuicaoEconomica`** — participação por beneficiário (independe de quem paga).
- `contratoId`, `pessoaId` (requerente/beneficiário), `tipo` (IGUAL | PERCENTUAL | VALOR | EXCLUIDO), `percentual?`, `valor?`, `ordem`

**`OcorrenciaFinanceira`** — ledger append-only (generaliza `EventoFinanceiro` + pagamentos).
- `id`, `contratoId`, `cobrancaId?`, `tipo` (PAGAMENTO | PAGAMENTO_PARCIAL | DESCONTO | ESTORNO | RENEGOCIACAO | CANCELAMENTO | JUROS | MULTA | CREDITO | REEMBOLSO | BAIXA | EMISSAO_NF | RECIBO)
- `valor`, `moeda`, `data`, `formaPagamentoId?`, `comprovanteUrl?`, `observacao?`
- `pagadorId?` (→ `Pagador`), `snapshotCambialId?`
- `politicaAplicacao` (FIFO | PARCELA_ESPECIFICA | MANUAL | PROPORCIONAL)
- `status` (PENDENTE | PROCESSADA | CONCILIADA | ESTORNADA)
- `estornaId?` (uma ocorrência de estorno aponta a original), `criadoPorId?`, `criadoEm`

**`OcorrenciaAplicacao`** — a quais parcelas uma ocorrência foi imputada (nunca implícito).
- `ocorrenciaId`, `parcelaId`, `valorAplicado`

**`Pagador`** — quem efetivamente pagou (pode não ser requerente).
- `id`, `tipo` (REQUERENTE | EMPRESA | TERCEIRO | EXTERNO), `pessoaId?` (quando requerente), `nome?`, `documento?`, `observacao?`

**`SnapshotCambial`** — congelamento cambial por ocorrência (imutável).
- `moedaOrigem`, `moedaDestino`, `cotacao`, `fonte`, `tipo` (AUTOMATICA | MANUAL | ESTIMADA | MESMA), `data`, `usuarioId?`, `justificativa?`, `precisao`, `valorOriginal`, `valorRecebido`, `diferencaCambial`, `motivoDiferenca?`

### 2.2. Reuso das existentes (sem quebrar)

| Entidade atual | Papel na V2 |
|---|---|
| `Receita`, `Custo` | Permanecem. Passam a ser **projetadas** como `ContratoFinanceiro` (origem). Backfill cria 1 ContratoFinanceiro por Receita/Custo. |
| `Cobranca`, `ParcelaFinanceira` | Viram as **Obrigações**. Já têm snapshot (câmbio/condição/idempotência). |
| `EventoFinanceiro` | Fonte legada do ledger; migra/espelha em `OcorrenciaFinanceira`. |
| `CondicaoPagamento`, `TaxaPagamento`, `FormaPagamentoCadastro`, `CotacaoCambio` | Inalterados — continuam sendo o cadastro consumido pelo motor. |
| `charge-calculation-service` / `charge-runtime` / `gerarCronograma` | **O motor.** Reusado por todos os tipos de contrato. |

> **Compatibilidade:** `ContratoFinanceiro.origemTipo/origemId` mantém a ponte 1:1 com Receita/Custo. Telas e rotas atuais continuam funcionando durante toda a transição.

---

## 3. Estados (máquinas de estado)

**Contrato:** `RASCUNHO → ATIVO → (LIQUIDADO | CANCELADO)`
- Nasce `ATIVO` já com obrigações (não há mais rascunho manual de cobrança).
- `LIQUIDADO` quando saldo = 0. `CANCELADO` por ocorrência de cancelamento (obrigações futuras canceladas, liquidado preservado).

**Obrigação (Cobrança/Parcela):** `ABERTA → (PARCIAL → QUITADA | VENCIDA)`
- `PARCIAL` com pagamento < saldo da parcela. `VENCIDA` quando passa do vencimento sem quitação. `QUITADA` ao zerar.

**Ocorrência:** `PENDENTE → PROCESSADA → CONCILIADA` (ou `→ ESTORNADA`)
- `PENDENTE` (registrada, aguardando processamento) → `PROCESSADA` (saldo/parcelas atualizados) → `CONCILIADA` (batida com extrato/banco). `ESTORNADA` via ocorrência de estorno (nunca deleção).

Transições são **funções puras testáveis**; toda transição gera auditoria.

---

## 4. Eventos (catálogo)

Cada tipo de ocorrência abre **apenas os campos necessários** e dispara efeitos determinísticos:

| Ocorrência | Campos próprios | Efeito no saldo/obrigações |
|---|---|---|
| PAGAMENTO / PAGAMENTO_PARCIAL | valor, moeda, cotação, pagador, data, forma, comprovante, **aplicação** | reduz saldo das parcelas conforme política de aplicação |
| DESCONTO | valor/%, motivo | reduz saldo sem entrada de recurso |
| JUROS / MULTA | %/valor, base, dias atraso | aumenta saldo (encargo por atraso real) |
| ESTORNO | ocorrência original, valor | reverte efeitos da original (append, não delete) |
| RENEGOCIACAO | novo cronograma | cria nova **versão** do contrato; cancela obrigações futuras |
| CANCELAMENTO | motivo | cancela obrigações abertas; preserva liquidado |
| CREDITO | destino (adiantamento/quitar outro/devolução) | registra saldo credor; decisão **sempre explícita** |
| REEMBOLSO | valor, destinatário | saída de recurso vinculada |
| BAIXA | motivo | encerra obrigação sem recebimento (write-off) |
| EMISSAO_NF / RECIBO | referência/documento | evento documental na timeline |

---

## 5. Papéis e distribuição

**Separação definitiva (nunca misturar):**
1. **Beneficiário econômico** — quem participa financeiramente (via `DistribuicaoEconomica`).
2. **Responsável contratual** — quem responde pela obrigação (no contrato).
3. **Pagador** — quem efetivamente pagou (por ocorrência; pode ser externo).
4. **Origem do recurso** — Conta | PIX | Cartão | Terceiro | Empresa | Outro (na ocorrência).

**Distribuição econômica** (independe de quem paga): SEM_DIVISAO | IGUAL | PERCENTUAL | VALOR, com seleção/exclusão de requerentes e participação personalizada.

**Pagadores:** um, vários, externo, empresa, terceiro. **Cada pagamento tem seu próprio pagador.** Pagador externo não exige cadastro como requerente (nome/documento/tipo/observação).

---

## 6. Moeda e câmbio

Quatro moedas **separadas** e nunca sobrescritas:
- **Moeda do contrato** (contratual)
- **Moeda do pagamento** (por ocorrência)
- **Moeda da baixa** (liquidação)
- **Moeda contábil** (BRL, para relatórios)

**Regra de validação (correção definitiva):** a **forma de pagamento é validada contra a moeda de RECEBIMENTO**, nunca contra a moeda da receita. Receita em EUR recebida em BRL por PIX é **permitida** — a conversão é resolvida pela cotação (EUR→BRL). "Internacional" = recebimento em moeda estrangeira (≠ BRL).

**Política cambial** persistida: FIXO | VARIÁVEL | SNAPSHOT + data + fonte + permissão de override + histórico. **`SnapshotCambial`** congela cotação por ocorrência e guarda **diferença cambial separada** (valor original × valor recebido × cotação × motivo). Cobranças antigas nunca mudam quando a cotação muda.

---

## 7. Pagamentos parciais, aplicação, créditos, renegociação

- **Parciais:** múltiplos pagamentos por contrato; cada um com valor/moeda/cotação/pagador/data/forma/comprovante/aplicação.
- **Aplicação** (nunca implícita): FIFO | PARCELA_ESPECIFICA | MANUAL | PROPORCIONAL, registrada em `OcorrenciaAplicacao`.
- **Créditos** (pagamento > saldo): CREDITO | ADIANTAMENTO | QUITAR_OUTRO | DEVOLUCAO — decisão **sempre explícita**, nunca automática.
- **Renegociação:** nunca altera histórico; cria **nova versão** do contrato, cancela obrigações futuras, preserva tudo já liquidado.

---

## 8. Fluxo operacional

### 8.1. Nascimento do contrato (sem "Gerar Cobrança")
Quando um contrato nasce (motor de processo ou lançamento manual), o motor **automaticamente**: aplica regra financeira → política cambial → política de divisão → cria cobrança → parcelas → vencimentos → cronograma → saldo inicial. **O operador nunca clica em "Gerar cobrança".** Só ADMIN pode *regenerar* excepcionalmente (ação protegida + auditada).

### 8.2. Operação diária = registrar fatos
"Registrar Pagamento" deixa de existir. Existe **"Registrar Ocorrência Financeira"**, que pergunta apenas:
> O que aconteceu? · Quanto? · Quando? · Como? · Comprovante? · Observação?

Todo o resto vem do motor.

---

## 9. Telas e componentes

### 9.1. "Dossiê da Receita" → **Posição Financeira**
Deixa de ser cadastro; é **operação** (estado financeiro atual).

**Cabeçalho:** Contrato · Cliente · Requerentes · Moeda contratual · Valor contratado · Equivalente em BRL · Recebido · Saldo · Status · **Próxima ação recomendada**.

**Corpo — 5 áreas:**
1. **Resumo Financeiro** — contratado, recebido, saldo, moeda, cotação, situação.
2. **Obrigações** — parcelas, cronograma, próximo vencimento, atrasos.
3. **Timeline Financeira** — contrato criado → cobrança criada → enviada → pagamento → baixa → recibo → NF → renegociação → estorno (ordem cronológica).
4. **Histórico Financeiro** — todos os lançamentos.
5. **Próxima ação** — **UMA** ação só (ex.: *Aguardando pagamento → Registrar ocorrência financeira*). Nunca lista enorme de botões.

### 9.2. Tela de Ocorrência
Modal operacional enxuto: escolhe o **tipo** (pagamento, parcial, desconto, estorno, renegociação, cancelamento, juros, multa, crédito, reembolso) e mostra **só os campos daquele tipo** (as 6 perguntas). Sem wizard, sem tela vazia.

### 9.3. Componentes reutilizáveis
`FinancialPositionHeader` · `FinancialSummaryCards` · `ObligationsPanel` (cronograma/atrasos) · `FinancialTimeline` · `LedgerHistory` · `NextActionCard` · `OccurrenceModal` (adaptativo por tipo) · `PayerSelector` (interno/externo) · `EconomicDistributionEditor` · `CurrencySnapshotBadge`. **Regra de exibição separada da regra de cálculo** (cálculo sempre no backend).

---

## 10. Automações (pós-ocorrência)

Após **qualquer** ocorrência, de forma automática e transacional: atualizar saldo → contrato → parcelas → timeline → dashboards → gerar auditoria → atualizar relatórios → executar conciliação. Implementadas como **projeções** recalculadas do ledger (idempotentes, reconstruíveis).

---

## 11. Regras de negócio (invariantes)

1. Ledger é **append-only**: correção = nova ocorrência (estorno/ajuste), nunca update/delete.
2. **Saldo = projeção** do ledger; nunca editado à mão.
3. Snapshots (câmbio/condição/taxa) **imutáveis** após a criação.
4. Nenhuma aplicação de pagamento **implícita**.
5. Crédito e diferença cambial **sempre explícitos**.
6. Renegociação **versiona**, não reescreve.
7. Forma validada contra **moeda de recebimento**.
8. Papéis (beneficiário/responsável/pagador/origem) **nunca** colapsados num só campo.
9. Toda transição de estado **audita**.
10. O motor de cálculo permanece **autoridade única** (backend recalcula).

---

## 12. Plano de migração sem downtime (aditivo)

**Fase 0 — Fundação (sem efeito visível)**
- Migrations **aditivas** (`ADD COLUMN/CREATE TABLE IF NOT EXISTS`): `ContratoFinanceiro`, `DistribuicaoEconomica`, `OcorrenciaFinanceira`, `OcorrenciaAplicacao`, `Pagador`, `SnapshotCambial`. Zero alteração em tabelas existentes.
- Backfill idempotente: 1 `ContratoFinanceiro` por Receita/Custo (origemTipo/origemId); espelhar `EventoFinanceiro`/pagamentos em `OcorrenciaFinanceira`. Reexecutável, sem perda.

**Fase 1 — Motor unificado (transparente)**
- Generalizar `charge-runtime` para operar por `contratoId` (mantendo `receitaId` como alias). Testes de paridade: resultado idêntico ao atual.

**Fase 2 — Projeções e ledger**
- Serviço puro de projeção de saldo/status a partir do ledger + reconciliação com os valores atuais (guarda: projeção == estado atual para todos os contratos existentes).

**Fase 3 — Nascimento automático**
- Contrato nasce já com obrigações; "Gerar Cobrança" some da UI operacional (vira ação ADMIN protegida). Fluxos antigos seguem válidos.

**Fase 4 — Telas**
- Nova **Posição Financeira** + **OccurrenceModal** por trás de flag, convivendo com o Dossiê atual até o aceite; depois o Dossiê é redirecionado (não apagado).

**Fase 5 — Ocorrências ricas**
- Pagadores múltiplos/externos, distribuição econômica, aplicação explícita, créditos, diferença cambial, renegociação versionada.

Cada fase: **deploy independente, reversível, sem downtime**, com suíte de guardas + reconciliação antes de avançar.

---

## 13. Decisões em aberto (para sua validação)

1. **Custo** entra como `tipo=CUSTO` do ContratoFinanceiro (unifica a/receber e a/pagar) ou fica fora do escopo nesta fase?
2. **Ledger vs. materialização:** confirmar saldo como projeção pura (recomendado) vs. coluna materializada com trigger.
3. **Conciliação bancária:** integra com Extratos existentes agora ou fica para fase posterior?
4. **Pagador externo:** cria `Pessoa` "sombra" ou fica só em `Pagador` (recomendado: só em `Pagador`)?
5. **NF/Recibo:** entram como ocorrências documentais na timeline já nesta arquitetura?
6. **Numeração:** `ContratoFinanceiro.codigo` novo (CTR-n) ou reaproveita o código da Receita?

---

**Próximo passo:** valide (ou ajuste) este documento. **Só após o aceite** inicio a Fase 0 (fundação aditiva), sem tocar em dados nem quebrar o que existe.
