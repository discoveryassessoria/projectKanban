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

`GET /api/processos/[processoId]/documentos` (consumida pela aba
Documentos da expansão) não tinha NENHUMA checagem de permissão antes desta
consolidação — lacuna pré-existente, fechada ao conectar a rota (agora
exige `processos.ver`); único chamador confirmado no código é o próprio
`processo-expandido.tsx`, então a mudança não quebra nenhum consumidor
existente.

### "Minhas visões" / "Salvar visão" reaproveita `RelatorioVisao`

Existe uma tabela genérica de visão salva (`RelatorioVisao`:
`dominio`/`nome`/`spec: Json`/`usuarioId`/`favorita`), já usada pelo motor
de Relatórios via `/api/relatorios/visoes`. Em vez de criar uma segunda
tabela (`VisaoSalva`, chegou a ser esboçada e revertida), "Tarefas e
Projetos" grava na MESMA tabela com `dominio: "tarefas-e-projetos"`, por
uma rota PRÓPRIA (`/api/operacao/visao-global/visoes`) — a rota é nova
porque o contrato de `spec` é diferente (`{ filtros: FiltrosGerenciais,
modo }`, não o `QuerySpec` do motor de Relatórios) e a permissão exigida é
`tarefas.editar`, não `relatorios.ver`. Mesma tabela, dois contratos de
`spec` coexistindo por `dominio` — não duas tabelas para o mesmo conceito.

### Regra permanente adicional — separação de responsabilidades

**Regra 14.** "Tarefas e Projetos concentra consulta e gestão operacional.
O redirecionamento para o processo ocorre quando o usuário inicia uma
tarefa ou executa ação que depende do contexto operacional completo. O
botão Iniciar deve abrir diretamente o contexto canônico da tarefa, sem
exigir nova procura manual."

Implementação: a aba Tarefas da expansão (`AcaoExecucao` em
`processo-expandido.tsx`) mostra "Aguardando atribuição" (sem
responsável), "Atribuída a X" (responsável ≠ usuário logado) ou
"Iniciar"/"Continuar" (responsável = usuário logado, executável, e
`tarefas.iniciar_concluir`) — e mesmo "Iniciar" só NAVEGA, via
`urlOperacionalDaTarefa` (`lib/operacional/navegacao.ts`), o MESMO
deep-link canônico que Minha Fila e a Central já usam
(`/kanban?processoId=X&tab=central&taskId=Y`, resolvido no servidor por
`resolverAlvoDaTarefa`, e lido no cliente por `kanban-content.tsx` via
`searchParams.get("taskId")`). A execução em si acontece na Central
Operacional; Tarefas e Projetos nunca chama `acao: 'iniciar'` diretamente.
Testado por clique real (WebKit): expandir → aba Tarefas → "Iniciar" →
navegação confirmada para `/kanban?processoId=592&tab=central&taskId=3571`.

## Correção sistêmica de 11/09/2026 — duas causas-raiz reais, não patches de tela

Uma rodada de correção pedida explicitamente como "sistêmica, não 7
patches" encontrou e corrigiu DUAS causas-raiz que explicavam vários
sintomas reportados de uma vez só — nenhuma delas era um bug de CSS ou de
um botão isolado.

### Causa-raiz 1 — "indicadores ≠ lista" era um bug de fuso horário, não de query divergente

O card "Concluídas (hoje)" mostrava um número (ex.: 2), mas aplicar o
filtro de período equivalente (`dataTipo=concluida&dataInicio=dataFim=hoje`)
devolvia ZERO processos. A causa não era duas regras de negócio diferentes
— era `new Date("2026-09-11")` aplicado nos DOIS extremos do intervalo:
em JS isso vira meia-noite UTC nos dois lados, ou seja, um `gte`/`lte`
apontando para o MESMO instante — uma janela de largura zero que não casa
com nada que aconteceu durante o dia real (quase tudo, no fuso de São
Paulo). É a MESMA classe de bug que `lib/operacional/tempo-operacional.ts`
já existia para eliminar (ver o cabeçalho do arquivo — Minha Fila x
Central discordando por fuso, incidente antigo), só que reintroduzida em
código novo que não passou por aquele módulo.

Corrigido exportando `janelaDoDiaOperacionalDe(dataYMD)` — a mesma conta
de `janelaDoDiaOperacional`, para uma data ESCOLHIDA NUM FILTRO em vez do
relógio — e aplicando-a nos três pontos de `tarefa-projecoes.ts` que
faziam `new Date(string)` cru: o filtro de período de `whereGerencial`, o
filtro de "última atividade" (`idsComAtividadeNoPeriodo`) e o filtro de
marco gerencial por período (`processosComMudancaDeFase`). Verificado por
script direto contra produção: `agregacaoPorFamilia` com o filtro do tile
passou a devolver exatamente os mesmos registros que o indicador conta.

**Regra 15.** "Data" em qualquer filtro novo passa por
`lib/operacional/tempo-operacional.ts` (`janelaDoDiaOperacionalDe` para
uma data escolhida, `janelaDoDiaOperacional` para "agora") — nunca
`new Date(string)` cru. Um `gte`/`lte` do mesmo dia em UTC vira um
instante, não um dia.

### Causa-raiz 2 — z-index fora da régua do projeto

O projeto já tem um SSOT de camadas (`src/lib/ui/layers.ts`), criado
depois de um incidente documentado com a MESMA assinatura do relato desta
rodada ("menu abre, ação não funciona"). Os componentes novos
(`Select`/`Popover`/`DropdownMenu` de `components/ui/*`) chegam com
`z-50` de fábrica do shadcn — fora da régua (`LAYER.popover = 10060`).
Modais próprios do kit operacional (`SeletorResponsavel`, o prompt de
motivo do Kanban) usavam `z-[60]` cravado, também fora da régua.

Corrigido aplicando `z-[10060]` (`LAYER.popover`) em todo `SelectContent`/
`PopoverContent`/`DropdownMenuContent` de Tarefas e Projetos, e
`z-[10000]` (`LAYER.aboveProcess`) nos dois modais do kit operacional.

**Regra 16.** Nenhum overlay novo (`Select`/`Popover`/`DropdownMenu`/
modal próprio) usa o z-index de fábrica da biblioteca. Sempre
`src/lib/ui/layers.ts` — `LAYER.popover` para menus/popovers efêmeros,
`LAYER.aboveProcess`/`aboveProcessDrawer`/`aboveProcessCritical` para
modais e drawers.

### Atribuição individual por tarefa (aba Tarefas do processo expandido)

Adicionado botão "Atribuir"/"Transferir" por linha (coluna "Atribuição"),
visível só para quem tem `tarefas.editar`, chamando o MESMO
`POST /api/tarefas/{id}/comando` que Lista/Kanban/lote já usam — nenhum
endpoint novo, nenhum ownership paralelo. Testado por clique real contra
produção (processo "Teste", tarefa 3571 "Preparar pacote de análise"):
atribuída a Daniela Brait via UI, verificado no banco
(`Tarefa.responsavelId`, `LogAuditoria.TAREFA_ATRIBUIDA`,
`NotificacaoOperacional.ATRIBUICAO` — os três escreveram, nenhum
paralelo), e revertido ao estado original (`devolver_a_fila`) ao final do
teste para não deixar rastro em produção.

## Diagnóstico de ownership — mapa tela-a-tela (12/09/2026)

Consolida a Regra 9 com evidência de código, uma tela por vez. Fonte
canônica: `lib/operacional/tarefa-projecoes.ts` (`Tarefa.responsavelId`).
Regra completa e divergências não corrigidas: `docs/architecture/
15-motor-operacional-tarefa-workflow-step.md` §10.

| Tela | Fonte | Pode divergir de `Tarefa.responsavelId`? |
|---|---|---|
| Operação / Minha Fila | `minhaFila`/`semResponsavel` → `visaoGerencial` | Não |
| Tarefas e Projetos (Lista/Kanban/Calendário) | `visaoGerencial` (linha) | Não |
| Tarefas e Projetos — rollup por família | `agregacaoPorFamilia.responsavelPrincipal` | **Sim, por desenho** — é o voto majoritário da família, não o dono de nenhuma tarefa individual |
| Kanban (coluna) | `colunaDaTarefa` | Não |
| Processo expandido → aba Tarefas | `visaoGerencial` (escopado por processo) | Não |
| Painel da fase (índice por documento, dentro do processo) | `estadoNaFase`/`tarefasVivasDasUnidades` | Não (bug histórico já corrigido — ver comentário em `estrutura-operacional-core.ts`) |
| Indicadores gerenciais | `indicadoresGerenciais` (`COUNT` direto) | Não |
| Sino de notificações (HeaderBar) | query própria em `Tarefa` (`/api/notificacoes`) | Não diverge do campo, mas **não lê `NotificacaoOperacional`** — são dois sistemas de aviso que nunca se cruzam |
| Workflow Interno — cabeçalho/gate de Iniciar | `tarefasVivasDasUnidades` | Não |
| Workflow Interno — rótulo "quem executa" por passo | `PhaseWorkflowStepInstance.responsavelId` ("Alterar Executor") | **Sim, por desenho** — é o executor do passo, não o dono da operação; nunca usado para permissão (ver `documento-operacao.ts:627-641`) |
| Home — fila de pendências tipo "passo" | `PhaseWorkflowStepInstance.responsavelId` | **Sim — divergência real, não corrigida** (mesmo rótulo "responsável" que os itens tipo "tarefa" da mesma fila, que leem `Tarefa.responsavelId`) |
| `ProcessoCentralOperacional` — sub-rota Genealogia ("docs") | `Documento.responsavelId ?? stepOwner` | **Sim — divergência real, não corrigida**, nunca olha `Tarefa` |

**Regra 17.** Toda tela nova que precisar mostrar "responsável" de uma
operação lê `Tarefa.responsavelId` via `tarefa-projecoes.ts`/
`tarefasVivasDasUnidades` — nunca computa por conta própria, nunca lê
`PhaseWorkflowStepInstance.responsavelId`/`Documento.responsavelId` como se
fossem o dono da operação. As duas exceções da tabela acima (Home e a
sub-rota de Genealogia) são dívida conhecida, não modelo a seguir.
