# 02 — Fontes da verdade

Para cada conceito: **quem manda**, **quem só projeta** e **onde ainda há dúvida**.
Uma projeção pode ser apagada e reconstruída sem perda; uma fonte, não.

---

## Documental

| Conceito | Fonte única | Projeções | Situação |
|---|---|---|---|
| Definição do documento | `TipoDocumentoCadastro` (por `id`/`publicCode`) | listas de UI, filtros | 🟢 |
| Classificação administrativa | `CategoriaDocumental` | — | 🟢 |
| Contrato operacional | `FamiliaDocumental` · `NaturezaOperacionalDocumento` · `PerfilOperacionalDocumento` | — | 🟡 1 perfil cadastrado |
| **O que o processo exige** | `MatrizDocumental` | Central, gate de fase | 🔴 **0 linhas** |
| Necessidade | `NecessidadeDocumental` | — | 🟢 |
| Documento operacional | `Documento` | Central, planilha, árvore | 🟢 |
| "Registro localizado" | `Documento` (cartório + livro/folha/termo) | gate do passo, planilha, projeção financeira | 🟢 régua única em `stepCompletionResolver` |
| Arquivo físico | `DocumentoArquivo` | abas de anexo | 🟡 sem guard de unicidade (R-06) |
| Solicitação de certidão | `SolicitacaoDocumento` + `ProtocoloDocumento` | timeline | 🟡 |
| Texto jurídico gerável | `ModeloDocumental` (DOCX versionado) | PDF derivado | 🟢 congelado |

**Regra que sustenta a coluna "situação":** nenhum módulo mantém a própria lista
de tipos documentais; todos apontam por `documentTypeId`. O ponto ainda aberto é
a ponte legada `Documento.tipo` (enum) que convive com `documentTypeId` — a
planilha já lê os dois, preferindo o vínculo canônico.

---

## Execução

| Conceito | Fonte única | Projeções |
|---|---|---|
| Instância da fase | `PhaseWorkflowInstance` (processo + fase + ciclo) | Kanban, Central |
| Passo | `PhaseWorkflowStepInstance` | tarefa, progresso |
| Tarefa | `Tarefa` — **projeção do passo**, não fonte | listas, Home |
| Progresso / gate | `resolveOperationalProjection` + `computeGate` | barra do Kanban, Central |
| SLA | `sla-core` (puro) + `sla-projection` | 4 cards, listagem, detalhe |
| Evento de domínio | `WorkflowEvento` + `DomainOutbox` | timeline, histórico |

> **Passo é o estado; tarefa é projeção.** A trava de coerência roda na mesma
> transação e faz rollback se as duas divergirem (`test:passo-tarefa`, 70/70).

---

## Financeiro

| Conceito | Fonte única | Projeções |
|---|---|---|
| Movimento e saldo | **`LedgerFinanceiro`** (append-only) | `SaldoProjecao`, extrato, KPIs |
| Obrigação (o contrato) | `ObrigacaoEconomica` | lista de Custos, lista de Receitas |
| Preço | `TabelaValor` (Tabela de Preços) | valor congelado na obrigação |
| Elegibilidade a lançamento | `ItemCatalogo` (Cadastro Mestre) | seletores |
| Comportamento financeiro do item | `ProdutoFinanceiro` (Configuração Financeira) | — |
| Componentes econômicos da fase | `PhaseEconomicRule` | **colunas da planilha** |
| **Vínculo do custo com a operação** | `ObrigacaoEconomica.{personId, documentoId, tipoServicoId}` | Planilha Documental |
| **Planilha documental** | — (é **projeção pura**) | — |

**O que mudou em 06/08.** Entre 28/07 e 06/08 o vínculo documental do custo vivia
como **texto** em `observacoes` (`"· doc#2080"`). Texto não é fonte: não dá para
agrupar, somar nem conferir por ele. As colunas foram restauradas por migration
aditiva e o motor voltou a gravá-las. O Ledger continua sendo a única verdade do
dinheiro; as colunas dizem apenas **a que fato operacional** a obrigação pertence
— exatamente o papel que os campos homônimos já cumprem na `Receita`.

**Origem do lançamento.** `origemLancamento` é **declarado** por quem cria
(`AUTOMATICO_DOCUMENTAL` / `BACKFILL_DOCUMENTAL` / `MANUAL`), nunca inferido.
Linhas anteriores à declaração ficam `NULL` e a reconciliação as **relata** como
não classificadas — a UI tem o filtro "Não classificados" por isso.

---

## Pessoas e cadastro

| Conceito | Fonte única | Observação |
|---|---|---|
| Pessoa | `Pessoa` (uma entidade, consumida por árvore/processo/Central) | dedup é **visual** por `personId`; duplicidade real vira pendência, nunca merge automático |
| Cliente | `Requerente` (764) | preservado no reset |
| Serviço | `ItemCatalogo` | face única (Catálogo de Serviços) |
| Organização / fornecedor | `Organizacao` — fornecedor é **função**, não cadastro próprio | |
| País | `CatalogoPais` | Brasil e Irlanda ainda ausentes |
| Código público | `CodeGeneratorService` | só para cadastro operacional real |

---

## Onde ainda existe dúvida

1. **`Documento.tipo` (enum) × `documentTypeId`** — dual-read vivo. A ponte é
   determinística, mas enquanto os dois existirem alguém vai escrever regra nova
   contra o enum.
2. **`Custo` / `CustoPessoa`** — models sem writer e sem linha. Ainda existem no
   schema e têm endpoints (`POST/PUT/PATCH /processos/[id]/custos`). São legado
   inativo; a remoção exige decisão explícita porque envolve DROP.
3. **`Tarefa.statusId` + tabela `Status`** — preservados quando o `Status` legado
   do Processo foi removido. Convivem com `statusTarefa`.
4. **Notificações** — não há entidade canônica; o conceito está espalhado.
