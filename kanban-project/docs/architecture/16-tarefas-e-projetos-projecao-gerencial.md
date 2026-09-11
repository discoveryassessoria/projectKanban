# 16 — Tarefas e Projetos: projeção administrativa do motor operacional

> Consolidado em 11/09/2026, junto com a implementação que transformou
> "Tarefas e Projetos" numa CENTRAL GERENCIAL (Visão Geral com marco
> gerencial, filtros combináveis com "data" desambiguada, expansão do
> processo com histórico/documentos/observações). Ver [CLAUDE.md](../../CLAUDE.md)
> (contrato normativo) e [15-motor-operacional-tarefa-workflow-step.md](15-motor-operacional-tarefa-workflow-step.md)
> (o motor operacional genérico que este documento projeta, nunca substitui).

## Regras permanentes desta consolidação

**Regra 1.** Tarefas e Projetos é uma projeção administrativa do motor
operacional canônico do Discovery, nunca uma source of truth paralela.

**Regra 2.** Toda funcionalidade nova deve se conectar às entidades, estados,
eventos, permissões e sources of truth canônicas existentes. Não duplicar
regra de negócio para atender uma interface.

**Regra 3.** Eventos operacionais granulares pertencem ao histórico.
Notificações/realces administrativos devem priorizar marcos gerenciais e
situações que exigem atenção ou decisão.

**Regra 4.** A mudança canônica de fase é um dos principais marcos
gerenciais do Discovery.

**Regra 5.** Uma transição canônica deve produzir no máximo um marco
gerencial daquela transição; retry, refresh ou reconciliação não podem
duplicá-lo.

**Regra 6.** Uma correção não está concluída apenas porque novos registros
funcionam. Toda alteração deve verificar e, quando necessário, reconciliar
os registros existentes.

**Regra 7.** UI não é source of truth e não decide conclusão de fase.

**Regra 8.** Uma tarefa possui uma única identidade e um único estado
canônico em todo o Discovery.

**Regra 9.** Responsabilidade/ownership não deve ser duplicada por tela.
Toda atribuição deve atingir a entidade canônica.

**Regra 10.** Permissão administrativa exige enforcement server-side;
esconder botão não constitui segurança.

**Regra 11.** CANCELADA é semanticamente distinta de CONCLUÍDA — em todo
indicador, novo ou antigo.

**Regra 12.** faseVisualizada é semanticamente distinta de faseAtiva.

**Regra 13.** Movimentar processo entre fases não apaga, recria, reseta,
invalida ou conclui automaticamente tarefas existentes.

## Como esta implementação cumpre as regras acima

### Marco gerencial = leitura de `PhaseAdvanceLog`, não uma tabela nova

`PhaseAdvanceLog` já era o registro canônico, único e deduplicado
(`chaveIdempotencia @unique`, `resultado: AVANCADO|FORCADO|REABERTO|
RETORNADO|MOVIDO|IDEMPOTENTE|CONFLITO|BLOQUEADO`) de toda tentativa de
transição de fase, escrito exclusivamente por `PhaseAdvanceService`
(`src/lib/motor/phase-advance.ts`). "Marco gerencial" (spec-de-produto:
"Tarefas e Projetos", 11/09/2026) **não criou uma segunda tabela de
notificação de fase** — `marcosGerenciaisPorProcesso`
(`lib/operacional/tarefa-projecoes.ts`) lê esse mesmo log, filtrando
`resultado IN (AVANCADO, FORCADO, REABERTO, RETORNADO, MOVIDO)` (nunca
`IDEMPOTENTE`/`CONFLITO`/`BLOQUEADO` — não são transição real) e pega a mais
recente por processo. A Regra 5 (idempotência) vem de graça: um retry do
mesmo pedido já produz `resultado: IDEMPOTENTE` no log, nunca uma segunda
linha `AVANCADO` — provado por dado real em
`scripts/tarefas-projetos-marco-gerencial.test.ts` (seção 4).

`NotificacaoOperacional` (a tabela de notificação existente) foi
deliberadamente **não estendida**: seu `tarefaId` é obrigatório (a tabela é
por-TAREFA), um marco de fase é por-PROCESSO, e forçar um `tarefaId`
representativo teria sido a "segunda fonte" que a Regra 2 proíbe. Além
disso, `NotificacaoOperacional` não tem hoje nenhuma superfície de leitura
(`/api/notificacoes`, o sino do HeaderBar, calcula direto de `Tarefa` — a
tabela só é escrita, nunca lida por uma tela). O marco gerencial aparece
onde a spec pede: na própria "Tarefas e Projetos" (coluna "Última
atividade" da Visão Geral, priorizado sobre a última tarefa concluída) e no
"Histórico de Atividades" da expansão do processo.

### "Aguardando atribuição" — nunca presumido

Não existe, e não foi criada, nenhuma regra de atribuição automática entre
fases. `ProcessoAgrupado.aguardandoAtribuicao` (`agregacaoPorFamilia`) só é
`true` quando a fase atual do processo (`Processo.faseAtualKey`) tem
QUALQUER tarefa `StatusTarefa` ativa materializada e NENHUMA tem
`responsavelId` — nunca por a fase ser "nova". Ver `statusDaFaseAtual` em
`tarefa-projecoes.ts` e a prova por dado real na seção 5/6 do teste.

### "Status do processo" — derivado, não um enum novo

O enum de status do processo foi removido como legado (ver
[remocao-status-legado-processo, memória do projeto]). Em vez de recriá-lo,
`statusProcesso` (`FiltrosGerenciais`) deriva de `Processo.dataConclusao`
(`CONCLUIDO` = preenchida, `ATIVO` = nula) — zero coluna nova.

### "Data" nunca é um conceito único

`FiltrosGerenciais.dataTipo` (`criada|concluida|vencimento|
ultimaAtividade|mudancaFase`) recorta colunas diferentes por desenho:
`createdAt`, `dataConclusao`, `dataPrazo`, a última linha de
`LogAuditoria` real (não `updatedAt`), e `PhaseAdvanceLog.criadoEm`
respectivamente. Perguntas como "o que a Daniela concluiu hoje" e "quais
processos concluíram Genealogia este mês" (`marcoFaseConcluida` +
`faseMacroKey` como fase de ORIGEM + período) são compostas a partir desses
mesmos filtros — nenhuma pergunta ganhou um endpoint próprio.

### CANCELADA ≠ CONCLUÍDA no indicador novo também

`indicadoresGerenciais.concluidasHoje` (novo) filtra
`statusTarefa: { in: STATUS_CONCLUIDOS }` — a MESMA constante que já
exclui `CANCELADA`/`SUPERSEDIDA` para todo o resto do sistema — nunca uma
lista de status redeclarada. Provado por dado real na seção 7 do teste.

### Histórico de Atividades do processo — leitura, não uma 5ª tabela

`atividadesDoProcesso` intercala `LogAuditoria` (por tarefa),
`PhaseAdvanceLog` (marco), `WorkflowEvento` (etapa) e
`DocumentoObservacao`/`DocumentoArquivo` (via os `documentoId` das tarefas
do processo) — o mesmo padrão que `montarTimeline` já usava por tarefa,
elevado ao grain do processo. Nenhuma tabela nova.

### RBAC

A rota nova (`GET /api/processos/[processoId]/atividades`) usa
`verificarPermissao(request, 'processos.ver')` — a mesma chave que as
demais rotas de leitura por processo já usam. A reatribuição em massa da
fase atual (botão "Atribuir fase atual" na expansão) chama
`POST /api/tarefas/redistribuir`, que já exige `tarefas.editar` e faz
enforcement server-side independente da UI. Nenhuma permissão nova foi
criada; nenhum atalho client-side substitui a checagem do backend.
