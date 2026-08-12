# 00 — Inventário geral do Discovery

**Levantado em 06/08/2026**, sobre `main` em `95a2e5fe` e o banco oficial
(`pooled.db.prisma.io/postgres#a8c811cd`, classificado como PRODUÇÃO pelo
`db-guard`).

Todos os números deste documento foram **contados**, não estimados. O comando que
produziu cada bloco está indicado, para que qualquer pessoa possa refazer a
contagem e discordar com evidência.

---

## 1. Tamanho do sistema

| Dimensão | Quantidade |
|---|---:|
| Rotas de API (`route.ts`) | 381 |
| Páginas (`page.tsx`) | 22 |
| Componentes React | 249 |
| Serviços (`src/services`) | 76 |
| Módulos de domínio (`src/lib` + `lib`) | 313 |
| Testes (`scripts/*.test.ts`) | 202 |
| Comandos `npm run test:*` | 126 |
| Guards de arquitetura (`*guard*.test.ts`) | 50 |
| Modelos Prisma | 176 |
| Enums Prisma | 71 |
| Linhas de `schema.prisma` | 6.448 |
| Migrations ativas | 10 (1 baseline + 9 aditivas) |
| Migrations arquivadas | 114 |
| Seeds | 16 |
| Backfills declarados no `package.json` | 29 |

---

## 2. Volume de dados em produção

Contagem direta, leitura pura, 06/08/2026.

| Entidade | Linhas | Leitura |
|---|---:|---|
| `Requerente` | 764 | **base de clientes preservada** |
| `Contratante` | 2 | |
| `Usuario` | 3 | equipe |
| `Perfil` | 5 | |
| `Arvore` | 4 | |
| `Pessoa` | 7 | |
| `Processo` | 2 | operação recomeçando após o reset |
| `Documento` | 1 | |
| `Tarefa` | 26 | |
| `PhaseWorkflowInstance` | 4 | |
| `PhaseWorkflowStepInstance` | 11 | |
| `NecessidadeDocumental` | 1 | |
| `SolicitacaoDocumento` | 1 | |
| `DocumentoArquivo` | 1 | |
| `ProtocoloDocumento` | 0 | |
| `LogAuditoria` | 916 | |
| `WorkflowEvento` | 422 | |

**Cadastro (o que configura o motor)**

| Cadastro | Linhas | Situação |
|---|---:|---|
| `TipoProcessoNacionalidade` | 3 | |
| `PhaseInternalWorkflow` | 12 | |
| `TipoDocumentoCadastro` | 18 | |
| `FamiliaDocumental` | 4 | |
| `PerfilOperacionalDocumento` | 1 | contrato documental recém-criado |
| `ItemCatalogo` | 9 | 4 serviços de nacionalidade + itens documentais |
| `ModeloDocumental` | 2 | procuração judicial e administrativa |
| **`MatrizDocumental`** | **0** | ⚠ nenhuma exigência documental cadastrada |
| **`PhaseEconomicRule`** | **0** | ⚠ nenhum componente econômico cadastrado |

**Financeiro**

| Entidade | Linhas | Situação |
|---|---:|---|
| `ProdutoFinanceiro` (Config. Financeira) | 4 | **todas de VENDA** |
| `TabelaValor` (Tabela de Preços) | 4 | **todas `natureza = VENDA`** |
| `ObrigacaoEconomica` | 5 | 5 receitas de honorários |
| `LedgerFinanceiro` | 5 | 1:1 com as obrigações |
| `Receita` | 2 | |
| `Custo` (model legado) | 0 | sem writer desde 28/07 |
| `CustoPessoa` (planilha manual legada) | 0 | |
| `Cobranca` | 0 | |
| `Fornecedor` | 0 | |
| `PendenciaFinanceira` | 0 | |

> **Conclusão de dados:** não existe **um único cadastro de custo** em produção —
> nem exigência documental (Matriz), nem componente econômico
> (`PhaseEconomicRule`), nem configuração financeira de custo, nem preço de custo.
> Nenhum custo documental pode nascer hoje por ausência de configuração, não por
> ausência de código. Isso é decisão de negócio, e está registrado como tal em
> `01-riscos.md` (R-01).

---

## 3. Eventos e filas

**Emitidos** (`DomainOutbox`): `phase.entered`, `phase.completed`,
`phase-workflow.instanced`, `requerente.adicionado`,
`registral.reconciliar.processo`, `step.<estado>`, `tarefa.<estado>`,
`tarefa.generated`, `financeiro.obrigacao.criada`,
`financeiro.obrigacao.cancelada`, `financeiro.ocorrencia.processada`,
`runtime.v2.activated`, `runtime.v2.activation_denied`, `dualread.fallback`.

**Drenados** pelo dispatcher: `phase.entered`, `phase.completed`,
`phase-workflow.instanced`, `requerente.adicionado`,
`registral.reconciliar.processo`, `step.concluido` *(adicionado em 06/08 — ver
`03-dividas-tecnicas.md`, D-01)*.

**Fila parada hoje** (status `PENDENTE`):

| Tipo | Pendentes | Consumidor |
|---|---:|---|
| `tarefa.generated` | 99 | **nenhum** |
| `phase-workflow.instanced` | 31 | arquivamento |
| `registral.reconciliar.processo` | 10 | existe |
| `phase.completed` | 6 | arquivamento |
| `financeiro.obrigacao.criada` | 5 | **nenhum** |
| `step.concluido` | 5 | existe desde 06/08 |
| `tarefa.concluido_recebido` | 1 | **nenhum** |

**Crons** (`vercel.json`): `/api/cron/cambio` (diário 12h),
`/api/cron/registral` (a cada 10 min), `/api/cron/saude` (horário).

---

## 4. Classificação por módulo

Legenda: 🟢 estável · 🟡 funcional com pendências · 🟠 inconsistente ·
🔴 desconectado/risco crítico · ⚫ legado

| Módulo | Estado | Fonte canônica | Testes | Observação |
|---|---|---|---|---|
| Autenticação / sessão | 🟢 | `Usuario` + JWT | sim (`test:auth`, `test:sessao`) | sessão 15min/8h/multi-aba |
| Permissões | 🟡 | `src/lib/permissoes.ts` (80 chaves) | sim | 87 rotas sem gate — ver R-04 |
| Clientes / Requerentes | 🟢 | `Requerente` (764) | parcial | base preservada no reset |
| Pessoas / Árvore | 🟢 | `Pessoa` + `Arvore` | sim (`test:mdm`, `test:arvore-*`) | layout congelado |
| Linha de transmissão | 🟡 | `Pessoa.linhaReta` | sim | |
| Tipos de processo | 🟢 | `TipoProcessoNacionalidade` | sim (`test:nav`) | |
| Catálogo de serviços | 🟢 | `ItemCatalogo` | sim | face única |
| **Matriz Documental** | 🔴 | `MatrizDocumental` | sim (`test:regras-documentais`) | **0 linhas em produção** |
| Documento Operacional | 🟢 | `Documento` | sim (`test:invariante-doc`) | |
| Contrato documental | 🟡 | Família/Natureza/Perfil | sim (`test:contrato-doc`) | 1 perfil cadastrado |
| Workflow Interno | 🟢 | `PhaseInternalWorkflow` | sim (`test:motor-fases` 69/69) | |
| Passos / Tarefas | 🟢 | Step ↔ Task | sim (`test:passo-tarefa` 70/70) | |
| Ciclos | 🟢 | `ciclo` na instância | sim | |
| Movimentação manual | 🟢 | `moverFaseManual` | sim (`test:mover-fase`) | |
| Operação Antecipada | 🟢 | catálogo + adaptadores | sim | 0 linhas |
| Central Operacional | 🟢 | projeção operacional | sim (`test:central-*`) | |
| DOC21 / Solicitação | 🟡 | `SolicitacaoDocumento` | sim (`test:solicitacao`) | 1 registro; backfill pendente |
| Protocolos | 🟡 | `ProtocoloDocumento` | sim | 0 registros |
| Anexos | 🟡 | `DocumentoArquivo` | parcial | fonte única não provada por guard |
| Observações / Histórico | 🟢 | append-only | sim (`test:abas`) | |
| Auditoria | 🟢 | `LogAuditoria` (916) | sim | |
| Modelos Documentais | 🟢 | `ModeloDocumental` | sim (`test:modelos`) | congelado 05/08 |
| Procurações | 🟢 | gerador único | sim | |
| **Financeiro — Receitas** | 🟢 | `ObrigacaoEconomica` + Ledger | sim (`test:financeiro`) | |
| **Financeiro — Custos** | 🟡 | `ObrigacaoEconomica` | sim (`test:custos` 64/65) | vínculo documental restaurado em 06/08 |
| **Planilha documental** | 🟡 | projeção (06/08) | sim (`test:custo-documental` 30/30) | **sem cadastro para exibir** |
| Tabela de Preços | 🟢 | `TabelaValor` | sim (`test:preco-fonte-unica`) | só preços de VENDA |
| Fornecedores / Organizações | 🟡 | `Organizacao` | sim (`test:orgaos`) | `Fornecedor` = 0 |
| Pagamentos | 🟢 | Ledger + ocorrências | sim | |
| Câmbio | 🟡 | job Confidence | sim (`test:cambio`) | fetch LIVE pendente de credencial |
| SLA | 🟢 | `sla-core` + projeção | sim (`test:sla`) | |
| Saúde do Sistema | 🟢 | 66 verificações | sim (`test:saude`) | |
| Relatórios / Painel gerencial | 🔴 | — | não | **não existe** |
| Portal do cliente | 🔴 | — | não | **não existe** |
| Notificações | 🟠 | disperso | não | sem entidade canônica |
| Automações legado | ⚫ | neutralizado | sim (`test:automacoes-guard`) | só efeitos adicionais |
| `Custo` / `CustoPessoa` | ⚫ | — | — | 0 linhas, sem writer |
| `ProcessoFaturas` / `TabelaCustos` | ⚫ | — | — | **componentes sem nenhum consumidor** |

---

## 5. Como refazer esta contagem

```bash
# tamanho
find src/app/api -name route.ts | wc -l
grep -c '^model ' prisma/schema.prisma
ls scripts/*.test.ts | wc -l

# banco (leitura pura)
node scripts/db-guard.mjs --url-env PRISMA_DATABASE_URL --exigir nao-producao   # retrato

# fila
npm run reconciliar:custo-documental          # relatório, não escreve
```
