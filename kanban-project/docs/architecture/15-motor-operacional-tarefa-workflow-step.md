# 15 — Motor operacional: Tarefa, Workflow, Step

> Baseline desta consolidação: 10/09/2026 — auditoria completa (26 seções) +
> validação de entendimento (18 partes) + execução das Unidades 1-8. Ver
> [CLAUDE.md](../../CLAUDE.md) (contrato normativo, 34 seções) e
> [09-decisoes-arquiteturais](09-decisoes-arquiteturais.md) (o motor
> **documental** — este arquivo cobre o motor **operacional genérico**, que
> `09` não tinha).

## 1. Hierarquia canônica — DEFINIÇÃO de Workflow ≠ EXECUÇÃO de Workflow

**Workflow é definido/configurado POR FASE — nunca por Tarefa.** A entidade
de definição é `PhaseInternalWorkflow`, identificada por `wfUid =
{tipoProcessoId|'all'}::{phaseKey}`: uma linha por fase (+ tipo de processo,
ou `'all'` = qualquer um). `phaseKey` é coluna própria da definição. Uma
Tarefa NUNCA cria, possui ou configura um Workflow — ela só entra em
execução dentro de uma instância já materializada para a fase em que vive.

```
DEFINIÇÃO (cadastro, por FASE)
  PhaseInternalWorkflow            (id, wfUid = tipoProcesso::phaseKey, phaseKey)
        │
        │ materializado ao entrar na fase (1 por processo+faseMacroKey+ciclo — ADR D1, doc 09)
        ▼
EXECUÇÃO / PROGRESSO (por PROCESSO, dentro daquela fase)
  PhaseWorkflowInstance             (id, workflowDefinitionId → snapshot da definição)
        │
        ├──▶ PhaseWorkflowStepInstance  (Step — progresso por obrigação)
        │
        └──▶ Tarefa (N por instância — cada uma com seu workflowInstanceId
              apontando para a MESMA instância, e opcionalmente seu próprio
              workflowStepInstanceId)
```

Hierarquia de contexto (Família é só agrupamento visual):
`Família → Processo → Fase → PhaseWorkflowInstance (execução) → {Step, Tarefa}`.

**Tarefa é o grain canônico de trabalho.** Step ≠ Tarefa (progresso interno de
execução). Workflow ≠ Tarefa — Tarefa não executa "um Workflow próprio": ela
executa DENTRO da instância de execução materializada para a fase, que é
COMPARTILHADA por todas as Tarefas daquela fase naquele processo/ciclo (ver
prova por IDs abaixo). Documento/Necessidade ≠ Tarefa (podem originar uma,
nunca somam como trabalho adicional).

### Prova por IDs (processo 589, Santin, 10/09/2026)

| entidade | id | o que é |
|---|---|---|
| `PhaseInternalWorkflow` | 11 | DEFINIÇÃO — `wfUid: "all::genealogia"` |
| `PhaseInternalWorkflow` | 12 | DEFINIÇÃO — `wfUid: "all::emissao_documental"` |
| `PhaseWorkflowInstance` | 349 | EXECUÇÃO — `workflowDefinitionId: 11`, processo 589, fase genealogia, ciclo 1 |
| `PhaseWorkflowInstance` | 350 | EXECUÇÃO — `workflowDefinitionId: 12`, processo 589, fase emissão, ciclo 1 |

As **10 Tarefas de Genealogia** (ids 3551-3560) têm TODAS `workflowInstanceId:
349` — a MESMA instância de execução, derivada da MESMA definição (11) —,
com `statusTarefa` e `necessidadeId` independentes entre si (algumas
`CONCLUIDO_RECEBIDO`, outras `CANCELADA`). As **6 Tarefas de Emissão** (ids
3561-3566) têm TODAS `workflowInstanceId: 350`, cada uma com seu próprio
`workflowStepInstanceId` (1969-1973) e `documentoId` distinto. Isto prova, com
dado real: múltiplas Tarefas compartilham a MESMA definição — e até a MESMA
instância — de Workflow, mantendo progresso individual independente. Não
existe "1 Tarefa = 1 Workflow próprio" em nenhum sentido de posse ou
configuração.

## 2. Achado-canário: "16 = 10 + 6" (caso Santin, processo 589)

A MESMA obrigação (necessidade/documento) gera **Tarefas separadas por FASE**
— Genealogia's `localizar_registro` produz uma Tarefa; Emissão Documental's 5
passos produzem outra. Isso é **desenho deliberado**
(`lib/operacional/tarefa-canonica.ts` — `escopoDaUnidade`), não bug: 10
Tarefas de Genealogia + 6 de Emissão = 16 Tarefas canônicas reais. Nenhuma
projeção pode reduzir ou inflar esse número sem mudar o grain (CLAUDE.md §28).

## 3. Identidade e idempotência

`lib/operacional/identidade-da-tarefa.ts` (`normalizarUnidade`/
`chaveDaUnidade`) é a ÚNICA fonte de identidade de Tarefa. Nasceu de um
incidente real: processo 523, pessoa "Ademir", documento 2111 — dois formatos
de chave de idempotência diferentes geraram 2 tarefas vivas para a mesma
obrigação.

Formato: `unidade|proc{id}|{nec{X}|doc{X}|stepinst{X}}|pes{id}|c{ciclo}` — usa
o ciclo da OBRIGAÇÃO, nunca o ciclo da fase (segunda classe de bug, já
corrigida aqui).

## 4. Ownership (quem escreve o quê)

| Entidade | Owner de escrita | Arquivo |
|---|---|---|
| Tarefa (criação canônica) | materializador | `lib/operacional/tarefa-canonica.ts` |
| Tarefa (manual) | `criarTarefaManual` | `lib/operacional/tarefa-ciclo.ts` |
| Tarefa (reconciliação/órfãos) | `reconciliarTarefas` | `lib/operacional/reconciliar-tarefas.ts` |
| Step (transições de status) | `task-step-sync.ts` | `src/services/task-step-sync.ts` |
| Necessidade Documental | motor documental | `src/services/necessidade-documental.ts` |
| Fase (posição do processo) | serviço canônico de fase | ver 09 |

**Unidade 5 (10/09/2026) fechou um segundo owner**: `src/lib/motor/
matriz-economica.ts` criava Tarefa via `taskEngine.ts`/`criarTarefaDeSpec`
(identidade PARALELA — `MotorArtefato.automaticKey`, nunca
`identidade-da-tarefa.ts`), sem `necessidadeId`/`documentoId`. Removido por
inteiro (arquivo deletado, coluna `MatrizDocumental.createsTask` derrubada do
schema). A Matriz continua decidindo custo/receita — nunca Tarefa.

**Unidade 6 (10/09/2026) fechou outro**: `POST /api/tarefas` tinha
`prisma.tarefa.create` próprio. Passou a delegar para `criarTarefaManual`,
preservando compatibilidade externa (ver ADR abaixo).

## 5. Grain × contador (regra permanente)

Contadores de Tarefa devem ser `COUNT(DISTINCT tarefa.id)` sob o mesmo
filtro/scope da lista correspondente. Duas famílias de contador coexistem **de
propósito** no mesmo `lib/operacional/tarefa-projecoes.ts`:

- **"Abertas"** (`indicadoresGerenciais.total`) — só `STATUS_ATIVOS`. É o KPI
  de Central Operacional/Home.
- **"Quadro"** (`visaoGerencial`/`agregacaoPorFamilia`) — `STATUS_ATIVOS +
  STATUS_CONCLUIDOS`. É Tarefas e Projetos (Lista/Kanban — a coluna
  "Concluída" existe por desenho).

Não são a mesma pergunta e não devem convergir — ver a prova em
`scripts/projecoes-fecham-por-ids.test.ts` (Unidade 8).

## 6. Home: métrica composta ≠ grain único

`src/lib/home/coleta.ts` monta filas por VERBO (Step) e por ESTADO
(Step+Tarefa+Processo+Pendência), deliberadamente não-exclusivas — um Step
executável com prazo cai em duas filas ao mesmo tempo. O antigo `totalAcoes =
Σ fila.quantidade` contava esse item duas vezes ("35 ações pendentes",
achado real da auditoria). Corrigido na Unidade 2:
`contarTrabalhoPendenteDistinto` deduplica por identidade real
(`passo:{id}`/`tarefa:{id}`/`processo:{id}`/`pendencia:{id}`) antes de contar
— nunca chamar o resultado de "tarefas": é métrica composta, documentada como
tal (CLAUDE.md §18).

O antigo bloco de filas soltas ("Central de Notificações") deixou de ser o
protagonista da Home em 10/09/2026 — Central Operacional (grain Tarefa puro)
assumiu esse lugar; as filas de `coleta.ts` hoje só alimentam a pílula de
status e as telas de drill-down (`/dashboard/fila/[key]`, Central de Prazos).
Investigado na Unidade 7 e fechado **sem alteração de código**: o risco visual
que a unidade existia para resolver já não existe na UI atual.

## 7. ADR — decisões desta consolidação

| # | decisão | motivo |
|---|---|---|
| **U1** | `reconciliarTarefas` passa a cancelar Tarefa órfã mesmo quando o `PhaseWorkflowInstance` está `CONCLUIDO` (não só `CANCELADO`/`SUPERSEDIDO`), e passa a cobrir Tarefas ligadas por `documentoId` (Emissão) além de `necessidadeId` (Genealogia) | achado real: Genealogia's instância `CONCLUIDO` normal deixava 4 Tarefas do processo 589 (Santin) órfãs sem cancelamento — a condição antiga só cobria cancelamento/supersessão explícitos |
| **U2** | `totalAcoes`/status da Home usa `contarTrabalhoPendenteDistinto` (dedup por identidade), não `Σ fila.quantidade`; `/api/notificacoes`'s `total` usa `tarefas.length` (a query original), não a soma de 4 buckets sobrepostos | os dois eram a mesma classe de bug: somar filas/buckets não-exclusivos duplicava o mesmo item |
| **U4** | Nenhuma consolidação feita — investigado e fechado como falso positivo | os 4 call-sites de `agregacaoPorFamilia`/`indicadoresGerenciais` fora de `home/route.ts` já tinham políticas de escopo deliberadamente distintas (visão minha_fila/sem_responsável/tudo, cada uma já corretamente gateada) — não são duplicidade da mesma obrigação (CLAUDE.md §27) |
| **U5** | `taskEngine.ts`/`criarTarefaDeSpec` removido; `MatrizDocumental.createsTask` derrubado do schema (migration `20260910200000`) | segundo owner de Tarefa, identidade paralela, sem `necessidadeId`/`documentoId`; prova de segurança: 6/6 linhas reais já com `createsTask=false`, 0 Tarefas criadas por esse caminho em produção |
| **U6** | `POST /api/tarefas` delega para `criarTarefaManual`; `motivo` passou a ser aceito no body (opcional) — ausência vira 400 explícito, não texto inventado | segundo `prisma.tarefa.create`, sem motivo obrigatório nem checagem de duplicidade; decisão do usuário fechou a incompatibilidade sem inventar regra |
| **U7** | Nenhuma alteração — investigado e fechado como resolvido por trabalho anterior | a Home já não expõe `data.filas` como bloco competindo com Central Operacional; a faixa de indicadores do topo já lê só de `centralOperacional` |
| **U8** | `scripts/projecoes-fecham-por-ids.test.ts` prova, por IDs reais, que Home/Central/Tarefas-e-Projetos concordam sob o mesmo filtro — a lacuna de cobertura que a auditoria original apontou como zero | CLAUDE.md §29 (Prova por IDs) exige comparação de conjuntos, não só números que coincidem |

## 8. Segundo owner: como reconhecer

Sinais de um segundo owner de Tarefa nascendo (proibido por CLAUDE.md §23/§25):
`prisma.tarefa.create`/`createMany` fora dos 3 owners da tabela da seção 4;
uma chave de idempotência que não passa por `identidade-da-tarefa.ts`; um
campo de cadastro tipo `createsTask`/`geraTarefa` que nenhum código
materializador consome via o owner canônico. `scripts/
guard-maquina-passo-unica.test.ts` mantém a lista nomeada de toda origem de
`prisma.tarefa.create` no repositório — qualquer origem NOVA e não-nomeada
falha o guard.

## 9. Dívida declarada

- `src/lib/motor/executor.ts` mantém `mapPrio`/`resolverResponsavelDaRegra`
  sem uso — helpers do automação-de-tarefa já neutralizado (kind=task), fora
  do escopo desta consolidação; comentário no próprio arquivo documenta a
  decisão de não removê-los ainda (minimizar churn).
- A auditoria original (26 seções, entregue em texto de sessão) não foi
  persistida como arquivo — este documento é o resumo durável dela, não uma
  transcrição integral.

## 10. Responsabilidade operacional (ownership de negócio) — consolidação de 12/09/2026

Diagnóstico + correção completos: `docs/architecture/16-tarefas-e-projetos-projecao-gerencial.md`
("Diagnóstico de ownership — mapa tela-a-tela", Regra 17) tem o mapa
tela-a-tela; aqui fica a REGRA, para qualquer código futuro que toque
`responsavelId`.

**Fonte canônica: `Tarefa.responsavelId`.** É o único campo que Operação,
Tarefas e Projetos, Lista, Kanban e processo expandido leem para "quem é
dono desta operação" — todas passam pela mesma função (`lib/operacional/
tarefa-projecoes.ts`). Escrito só por `atribuirTarefa`/`transferirTarefa`
(`lib/operacional/tarefa-comandos.ts`), `devolverAFila`/`criarTarefaManual`
(`tarefa-ciclo.ts`), e pelo materializador no NASCIMENTO da tarefa
(`garantirTarefaDePasso`/`tarefa-canonica.ts`).

**Regras permanentes:**

1. **`Tarefa.responsavelId` é a fonte canônica do ownership efetivo da
   operação.** Nenhuma tela decide "responsável" por conta própria — decidir
   fora desta leitura é o defeito, não uma otimização.
2. **Responsável configurado/executor de um PASSO não é ownership da
   operação.** `PhaseWorkflowStepInstance.responsavelId` (escrito hoje só por
   "Alterar Executor", `src/services/documento-operacao.ts:800`) e
   `StepExecution.executadoPorId` (quem executou uma tentativa, fato passado)
   são conceitos DIFERENTES e não substituem `Tarefa.responsavelId` em
   nenhuma decisão de permissão ou em nenhuma tela — incidente real e já
   corrigido documentado em `documento-operacao.ts:627-641` ("já divergiu em
   produção para uma tarefa da própria Daniela").
3. **Liberar o próximo passo automaticamente NÃO constitui nova atribuição.**
   `ativarProximoPassoTx`/`concluirEtapa` nunca escrevem `responsavelId`,
   `dataAtribuicao` nem `atribuidoPorId` — só o ponteiro `workflowStepInstanceId`
   muda. Só `atribuirTarefa`/`transferirTarefa` produzem uma atribuição real
   (e só eles notificam).
4. **Avanço de passo preserva a identidade da Tarefa quando a unidade é a
   mesma.** `reancorarTarefaNaUnidade`/`garantirTarefaDePasso` reancoram a
   Tarefa existente da unidade ao novo passo corrente — nunca criam uma
   segunda Tarefa para o mesmo trabalho.
5. **`workflowStepInstanceId` deve ficar deterministicamente ancorado ao
   passo corrente executável.** Bug real e corrigido em 12/09/2026: `escopoDaUnidade()`
   (`lib/operacional/tarefa-canonica.ts`) tinha um parâmetro que, em fases
   PROCESSO/GLOBAL (sem necessidade/documento), estreitava a leitura para "só
   o passo concluído" — a Tarefa perdia o ponteiro (ou, num caso real,
   `estadoDerivado` declarava a tarefa concluída com passo obrigatório aberto
   — Tarefa 3571/processo 592, reconciliada pela porta canônica `reabrirTarefa`).
   Removido; regressão permanente em `scripts/escopo-processo-reancoragem.test.ts`.
6. **Reatribuir não reinicia prazo/SLA sem regra explícita.**
   `atribuirTarefa`/`transferirTarefa` nunca tocam `dataPrazo` — só
   `alterarPrazo` (`tarefa-ciclo.ts`), que exige motivo. Verificado por código
   e por histórico real (Tarefa 3570, 2 transferências, prazo idêntico do
   início ao fim).
7. **Retry/reconciliação não pode duplicar Tarefa, ownership, histórico ou
   notificação.** `atribuirTarefa` é idempotente por `chaveIdempotencia` de
   notificação (carrega o `lockVersion` do momento do ato); `concluirEtapa`
   é idempotente por `jaEstavaConcluida`; `reabrirTarefa` recusa (`NAO_TERMINAL`)
   se a tarefa já não está encerrada. Auditoria de produção (12/09/2026):
   14/14 `NotificacaoOperacional.chaveIdempotencia` únicas, 0 Tarefas vivas
   duplicadas para a mesma unidade, 0 tarefa concluída com passo obrigatório
   aberto após a reconciliação de 3571.
8. **Projeções não podem inventar ownership próprio.** Qualquer tela que
   compute "responsável" fora de `tarefa-projecoes.ts`/`tarefasVivasDasUnidades`
   é uma segunda fonte (CLAUDE.md §23/§25). Divergência real conhecida e
   **não corrigida** (fora do escopo desta consolidação): `src/lib/home/
   coleta.ts` mistura, na mesma fila de pendências, itens tipo "passo" (lê
   `PhaseWorkflowStepInstance.responsavelId`) e itens tipo "tarefa" (lê
   `Tarefa.responsavelId`) sob o mesmo rótulo "responsável"; e a sub-rota de
   Genealogia de `ProcessoCentralOperacional`/`src/app/api/processos/
   [processoId]/central-operacional/route.ts` (seção "docs") ainda calcula
   `Documento.responsavelId ?? stepOwner`, nunca `Tarefa`.
9. **Registros legados devem ser considerados em qualquer alteração do
   motor.** Antes de mudar `escopoDaUnidade`/materialização, audite o banco
   real (não só o código) pelos 3 padrões: tarefa concluída com obrigatório
   aberto, ponteiro obsoleto (aponta pra passo concluído havendo executável),
   e tarefa não-terminal sem ponteiro havendo passo vivo.
10. **`step.disponivel` não deve virar um segundo motor de materialização
    ingenuamente.** O outbox dispatcher hoje trata `step.disponivel` como
    no-op (`src/services/outbox-dispatcher.ts`, comentário "tipo conhecido
    sem efeito conectado ainda"). Ligá-lo a `garantirTarefaDePasso` sem antes
    resolver a divergência abaixo criaria uma SEGUNDA Tarefa por passo em
    fases PROCESSO com múltiplos passos encadeados — dívida técnica registrada,
    não corrigida.
11. **Divergência de identidade ainda aberta (raiz do item 10):**
    `chaveDaUnidade()` (`lib/operacional/identidade-da-tarefa.ts`) usa
    `stepinst{id}` como identidade de fallback para GLOBAL sem
    necessidade/documento — ou seja, KEYA CADA PASSO como sua própria unidade —
    enquanto `escopoDaUnidade()` (pós-correção) trata TODOS os passos GLOBAL
    da mesma instância como uma unidade só. As duas funções respondem "qual é
    a unidade" de formas diferentes para a MESMA cardinalidade; o motor hoje
    só funciona porque nada re-materializa os passos 2+ de uma cadeia GLOBAL.
    Resolver isso é pré-requisito para o item 10.
12. **`Documento.responsavelId` permanece legado/paralelo.** Não é lido por
    nenhuma tela operacional principal (Operação, Tarefas e Projetos, Lista,
    Kanban, processo expandido, indicadores) — só pela seção "docs" citada no
    item 8. Não é a fonte canônica e não deve ser tratado como tal em nenhum
    código novo.

**Fora do escopo desta consolidação (regras já vigentes, não descobertas
hoje, mas reafirmadas por não terem sido violadas):** `CANCELADA != CONCLUÍDA`
em nenhuma tela (`cancelada-diferente-de-concluida`); `faseVisualizada !=
faseAtiva` — tarefa de fase não-atual nunca vaza para a consulta da fase
atual; movimentação de fase (`Processo.faseAtualKey`) nunca apaga, recria,
reseta ou conclui Tarefa automaticamente (CLAUDE.md §9/§10).

**Evidência:** commits `7a8eec5e` (correção de escopo), `52105515` (guard de
teste), reconciliação da Tarefa 3571 via `reabrirTarefa` (12/09/2026,
`lockVersion` 9→10, `LogAuditoria` 8368-8374 preservados + 8392 novo).
Regressão: `scripts/escopo-processo-reancoragem.test.ts` (37/37) +
suíte completa do motor (561 casos, 0 falhas) — ver commit para lista.
