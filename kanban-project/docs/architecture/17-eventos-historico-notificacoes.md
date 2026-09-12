# 17 — Eventos, Histórico e Notificações (Etapa 4)

Consolidado em 12/09/2026. Fecha a Etapa 4 do Plano de Estabilização
(`Eventos + histórico + notificações`), depois de 1/Execução, 2/Ownership e
3/Prazos+SLA+Acompanhamentos.

## A cadeia canônica

```
EVENTO DO MOTOR → HISTÓRICO → ATENÇÃO OPERACIONAL → POLÍTICA DE NOTIFICAÇÃO
```

Os quatro conceitos são estruturalmente separados e nunca se substituem:

- **Evento do motor** — `WorkflowEvento` (append-only), emitido pelo motor
  operacional (`task-step-sync.ts`, `phase-advance.ts`). É o fato bruto.
- **Histórico** — `LogAuditoria` (quem/quando/ação/entidade/antes-depois/
  motivo/correlação). Continua sendo a fonte de auditoria; notificação nunca
  a substitui nem a resume.
- **Atenção operacional** — a leitura canônica de "o que precisa de ação
  agora" (`lib/operacional/proximo-acontecimento.ts`, Etapa 3). Independe de
  notificação: existe e funciona mesmo que nenhuma notificação jamais tenha
  sido criada.
- **Política de notificação** — decide, a partir de um acontecimento já
  ocorrido, se ALGUÉM precisa ser avisado. Implementada em
  `lib/operacional/notificacao-canonica.ts`.

## REGRAS PERMANENTES (citação exata — Etapa 4)

> Notificação é consequência de um acontecimento canônico. Nunca é source of
> truth da operação.

> Fila/atenção operacional independe de notificação.

> Próximo passo automático não é nova atribuição.

> Histórico granular não implica notificação granular.

> Retry e reconciliação não podem gerar notificações duplicadas.

> Eventos individuais podem permanecer granulares enquanto a notificação é
> consolidada.

> Ler/arquivar notificação nunca altera estado operacional.

Estas sete regras estão registradas **aqui** (`docs/architecture/17-eventos-historico-notificacoes.md`) e no cabeçalho de `lib/operacional/notificacao-canonica.ts`.

## A porta canônica

`lib/operacional/notificacao-canonica.ts` exporta duas funções — e são as
ÚNICAS que tocam `NotificacaoOperacional`:

- `notificarAcontecimento(db, e)` — cria uma notificação se a
  `chaveIdempotencia` ainda não existir; devolve a existente (idempotente por
  leitura prévia + `P2002` como caminho de corrida) quando já existir.
- `marcarNotificacaoComoLida(db, {notificacaoId, usuarioId})` — a ÚNICA
  escrita que "ler uma notificação" pode fazer (`lidaEm`). RBAC embutido: só
  o próprio destinatário marca a sua notificação.

Nenhum endpoint/tela decide notificação por conta própria. Os chamadores
atuais:

- `lib/operacional/tarefa-comandos.ts` — `atribuirTarefa` (ATRIBUICAO/
  TRANSFERENCIA), `avisarPrazosEAtrasos` (PRAZO/HOJE/ATRASO),
  `redistribuirTarefas` (ATRIBUICAO_LOTE), `avisarAcontecimentosOperacionais`
  (RETORNO_TERCEIRO/ACOMPANHAMENTO_VENCIDO/EM_RISCO).
- `src/lib/motor/phase-advance.ts` — `executarPlano` (FASE_CONCLUIDA), só no
  ramo `encerramento === "CONCLUIR"`.

## Modelo — mudança mínima e aditiva

`NotificacaoOperacional.tarefaId` passou de obrigatório para `Int?`, e ganhou
`processoId Int?` (+ `Processo.notificacoesOperacionais`). Motivo: uma
notificação de FASE CONCLUÍDA é do grão PROCESSO, não TAREFA — forçá-la a
apontar para uma Tarefa fabricada repetiria o erro que "Tarefas e Projetos"
(doc 16) já havia evitado para marco gerencial ("grão errado").

Uma notificação usa NO MÁXIMO uma das duas âncoras — nunca as duas (a porta
lança erro se receber ambas). Notificação de LOTE não usa nenhuma das duas: é
sobre um ATO que afetou várias tarefas, não sobre uma tarefa ou um processo
específico.

Nenhuma tabela nova foi criada. `NotificacaoOperacional` já existia,
estruturalmente correta para o caso de tarefa; a mudança foi só tornar as
duas colunas de âncora capazes de representar os dois grãos que a Etapa 4
precisa (decisão tomada com o usuário depois de comparar 3 alternativas —
preferida por ser a menor mudança estrutural sobre o schema existente).

## Matriz evento → notificação

| Fato | Tipo | Destinatário | Chave de idempotência |
|---|---|---|---|
| Atribuição/transferência individual | `ATRIBUICAO` / `TRANSFERENCIA` | responsável novo | `t{id}::u{dest}::v{lockVersion}` |
| Redistribuição em lote (N tarefas → 1 pessoa) | `ATRIBUICAO_LOTE` | destinatário do lote | `u{dest}::{dia}::{ids ordenados}` |
| Prazo próximo/vence hoje/atrasado | `PRAZO`/`HOJE`/`ATRASO` | responsável atual | `t{id}::{dia do prazo}` |
| Retorno de terceiro recebido | `RETORNO_TERCEIRO` | responsável atual | `t{id}::{fato: solicitação ou contato}::u{dest}` |
| Acompanhamento vencido | `ACOMPANHAMENTO_VENCIDO` | responsável atual | `t{id}::{data agendada}::u{dest}` |
| Entrada/mudança real de EM_RISCO | `EM_RISCO` | responsável atual | `t{id}::{motivos ordenados}::u{dest}` |
| Fase concluída (automática ou forçada) | `FASE_CONCLUIDA` | todo `Usuario.tipo=admin` | `{chave da transição}::u{admin}` |

**Nunca gera notificação**: liberação automática do próximo passo (não é
nova atribuição — o `responsavelId` não muda), reconciliação, retry,
cálculo de SLA, atualização de projeção, gravação de histórico, entrada
comum em `AGUARDANDO_TERCEIRO`, conclusão de etapa isolada ("passo 3
concluído" é detalhe interno da mesma tarefa).

### Por que a chave carrega o destinatário

`RETORNO_TERCEIRO`, `ACOMPANHAMENTO_VENCIDO` e `EM_RISCO` incluem
`u{destinatarioId}` na chave — de propósito. Sem isso, uma transferência de
responsabilidade faria o NOVO responsável nunca ser avisado de um fato que o
ANTIGO já tinha visto: a chave "já existiria" para aquele fato, ainda que
para outra pessoa. A mesma identidade de fato, para duas pessoas diferentes,
são duas notificações — não uma.

### EM_RISCO — a chave carrega a transição

A chave de `EM_RISCO` é `motivosRisco` ORDENADO, sem componente de dia.
Permanecer no MESMO risco nunca renotifica (a chave é igual); o motivo mudar
de verdade (ex.: de "sem próximo acontecimento" para um conflito real de
prazo) produz uma chave diferente — a própria chave carrega a transição, sem
precisar guardar "estava em risco antes?" em lugar nenhum. `EM_RISCO`
continua DERIVADO — nenhum status novo foi adicionado a `Tarefa.statusTarefa`.

### FASE_CONCLUIDA — só conclusão real

O gancho vive em `executarPlano`, no ramo `p.encerramento === "CONCLUIR"` —
exclusivo de avanço normal (`FASE_AVANCADA`) e forçado
(`FASE_AVANCADA_FORCADO`). Reabertura, retorno (`SUPERSEDER`) e movimentação
manual (`moverFaseManual`, que nunca usa `"CONCLUIR"`) nunca passam por ali:
uma fase movida manualmente não gera `FASE_CONCLUIDA` — provado em
`scripts/etapa4-fase-concluida.test.ts` (CASO 14). A chave reaproveita a
MESMA `chave` determinística que já protege `WorkflowEvento` e
`PhaseAdvanceLog` desta transição (inclui `lockVersion`), com `u{adminId}`
anexado — 15 tarefas concluindo a mesma fase geram 1 conclusão de fase, não
15 notificações (grão PROCESSO, sem `tarefaId`).

## Cron — uma varredura, duas leituras canônicas

`src/app/api/cron/avisos-prazo/route.ts` (hora em hora) chama:

1. `avisarPrazosEAtrasos` — prazo/SLA (Etapa 3, inalterado nesta etapa).
2. `avisarAcontecimentosOperacionais` — retorno/acompanhamento/risco,
   lendo `estadosTemporaisDasOperacoes` (Etapa 3). Nenhum cron novo foi
   criado: nenhum job mantém sua própria definição de atrasado/risco/retorno.

Ambas são leitura pura sobre o estado canônico + escrita EXCLUSIVA de
`NotificacaoOperacional` — nunca tocam Tarefa, workflow, prazo, responsável
ou histórico. Uma tarefa que falha ao notificar não derruba a varredura nem
sai da fila: a próxima leitura mostra o mesmo estado, notificado ou não.

## O sino real

`/api/notificacoes` (consumido por `src/components/header-bar.tsx`) agora
também retorna `acontecimentos`: as `NotificacaoOperacional` não lidas do
usuário autenticado (RBAC pela própria query — `destinatarioId: usuario.id`).
Aditivo: os 4 blocos existentes (vencidas/hoje/próximos/novas) e o banner de
Saúde do Sistema continuam exatamente como eram. `POST
/api/notificacoes/[id]/lida` (`marcarNotificacaoComoLida`) é o único jeito de
marcar como lida — nenhuma outra escrita.

## Legado (14 notificações pré-Etapa-4)

Não apagadas, não reconciliadas retroativamente (§18: preferência é legado
permanecer histórico, sem gerar notificação retroativa). Classificação:
6/14 apontam para tarefas hoje terminais (órfãs de trabalho morto), 1/14 tem
destinatário que não é mais o responsável atual, as demais são válidas mas
nunca foram lidas porque nenhum bell as consumia antes desta etapa — agora
consomem o mesmo mecanismo.

## Dívidas registradas (não resolvidas nesta etapa)

- **Escalonamento de EM_RISCO para admin** (item 9, "risco estrutural/crítico
  pode notificar admin"): não implementado — classificar `motivosRisco` como
  "estrutural" vs "operacional" hoje seria a heurística frágil que o item 5
  proíbe por analogia. Fila de Daniela continua sendo a garantia primária.
- **Retorno via `SolicitacaoDocumento`**: o mecanismo (`retornoFatoChave =
  solicitacao:<id>`) está implementado e é simétrico ao caminho via contato,
  mas não tem teste automatizado dedicado nesta etapa (fixture de
  `SolicitacaoDocumento` exige `Documento`+`Pessoa` completos); coberto
  estruturalmente pelo mesmo código que o caminho via contato, que É testado.
- **RBAC do deep-link de destino** (`/kanban?processoId=...`): a página em si
  é client-side; a proteção real é dos endpoints que ela consome
  (`resolverAlvoDaTarefa` e as rotas de processo/tarefa), que já checavam
  permissão antes da Etapa 4 — não uma garantia nova construída aqui.
- **420 linhas do outbox arquivadas sem efeito**: continuam diagnosticadas
  (Etapa 4 não transformou o outbox num segundo motor); aprofundar
  materialização é Etapa 5.

## Testes

- `scripts/etapa4-eventos-notificacoes.test.ts` — CASO 4,5,6,7,8,9,10,11,15,
  16,17,18 (41 asserções).
- `scripts/etapa4-fase-concluida.test.ts` — CASO 12,13,14, incluindo
  concorrência real (`Promise.all` de dois avanços simultâneos) (14 asserções).
- CASO 1,2,3 já cobertos por `scripts/tarefa-atribuicao.test.ts` (bloco E/F,
  G/H/I) e `scripts/portas-tarefa.test.ts` (bloco S) — reaproveitados, não
  duplicados.
