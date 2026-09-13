# 18 — Projeções e consistência entre telas (Etapa 5)

Consolidado em 13/09/2026. Fecha a Etapa 5 do Plano de Estabilização
(`Projeções e consistência entre telas`), depois de 1/Execução, 2/Ownership,
3/Prazos+SLA, 4/Eventos+notificações. Ver [15](15-motor-operacional-tarefa-workflow-step.md),
[16](16-tarefas-e-projetos-projecao-gerencial.md) e [17](17-eventos-historico-notificacoes.md).

## REGRAS PERMANENTES (citação exata — Etapa 5)

> Tarefas e Projetos, Lista, Kanban, Central e dashboards são projeções do
> motor operacional, nunca sources of truth paralelas.

> Ownership operacional é Tarefa.responsavelId.

> O passo corrente é determinado por workflowStepInstanceId quando válido.

> Estado temporal/EM_RISCO deve vir da leitura temporal canônica.

> CANCELADA != CONCLUÍDA.

> Cards, filtros e listas devem compartilhar a mesma definição semântica.

> Diferença de UI não autoriza diferença de verdade operacional.

Registradas **aqui** (`docs/architecture/18-projecoes-consistencia-entre-telas.md`)
e nos comentários dos pontos de código citados abaixo.

## Diagnóstico confirmado, implementação feita

O diagnóstico (mesma etapa, rodada anterior) já havia concluído: **nenhum
motor novo era necessário** — `lib/operacional/tarefa-projecoes.ts` já era a
camada real de convergência para Tarefas e Projetos, Lista, Kanban (grão
Tarefa), Central, Home-indicadores, Minha Fila, Fila da Equipe e dossiê. Os
problemas eram de *wiring*, não de arquitetura paralela. Esta etapa fechou o
wiring, sem criar tabela, migration ou segunda fonte.

## 1. `tarefa-projecoes.ts` ganhou a leitura temporal completa (Etapa 3)

`LinhaDeFila` (base de `LinhaGerencial`, usada por TODAS as projeções acima)
ganhou, de forma aditiva: `emRisco`, `motivosRisco`, `atrasoInterno`,
`atrasoTerceiro`, `acompanhamentoVencido`, `proximoAcontecimento`. Uma função
nova, `comAtencaoTemporal`, chama `estadosTemporaisDasOperacoes`
(`proximo-acontecimento.ts`, Etapa 3) em lote e mescla o resultado — **nenhuma
lógica de risco foi reimplementada** em `tarefa-projecoes.ts`. `minhaFila`,
`filaDaEquipe`, `semResponsavel`, `visaoGerencial` e `dossieDaTarefa` passam
por ela antes de devolver.

Consequência provada com dado real: a Tarefa 3571 (processo 592) está
`emRisco: true` (`SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL` +
`SEM_RESPONSAVEL_PARA_PROXIMA_ACAO`) e agora essa leitura está disponível em
toda projeção que consome `tarefa-projecoes.ts` — antes, nenhuma tela de
gestão sabia disso; só o sino (Etapa 4) sabia.

## 2. Ownership corrigido nos dois pontos comprovadamente incorretos

- **`src/services/documento-operacao.ts` (`controlarOperacaoV2`)** — a trava de
  pausar/cancelar/invalidar lia `PhaseWorkflowStepInstance.responsavelId`
  direto, sem passar pela Tarefa canônica — o MESMO padrão de bug que
  `carregarPassoAutorizado`, no mesmo arquivo, já corrigia. Agora resolve a
  Tarefa viva da unidade (`normalizarUnidade` + `tarefasVivasDasUnidades`) e só
  cai no campo do passo quando não existe Tarefa (fallback documentado, nunca
  menos permissivo que antes).
- **`src/lib/process-stage/resolve-fase-progresso.ts`** — `stepOwnerPorDoc`
  (responsável exibido na aba Documentos da Central) e `proximaAcaoPorDoc`
  (passo seguinte) liam `PhaseWorkflowStepInstance` diretamente — um comentário
  no próprio código chamava isso de "fonte oficial", contradizendo a Etapa 2
  por escrito. Agora as duas perguntam à Tarefa canônica primeiro
  (`responsavelId`/`workflowStepInstanceId`); a varredura por
  ordem/`assigneeId` do passo só decide quando não há Tarefa viva para aquela
  obrigação — fallback explícito, documentado no código, nunca a fonte.

**Terceiro ponto investigado e preservado, não alterado**:
`src/lib/home/coleta.ts`/`src/lib/autorizacao/escopo-operacional.ts` tratam
`PhaseWorkflowStepInstance.responsavelId` como escopo equivalente ao da
Tarefa para a fila do Home — mas isso é uma **decisão deliberada e datada**
(comentário de 10/09/2026 no próprio `escopo-operacional.ts`), não um
descuido. Reescrever o escopo de visibilidade do Home é uma mudança de
comportamento de tela ativa, fora do que "corrigir ownership incorreto"
autoriza sem confirmação adicional — registrado como dívida (não fechado).

## 3. Passo atual — mesmo princípio de `carregarPassoAutorizado`

Em `resolve-fase-progresso.ts`, `proximaAcaoPorDoc` agora resolve o passo pelo
`Tarefa.workflowStepInstanceId` quando ele aponta para um step que existe na
fase consultada; só recorre à varredura por ordem quando não há Tarefa viva
ou o ponteiro não bate com nenhum step carregado (dado legado/gap) — nunca
inventa silenciosamente.

## 4. Filtro + paginação — bug real corrigido

`visaoGerencial` filtrava `coluna` **depois** de `skip`/`take`: `total`
contava o universo pré-coluna, e uma página podia devolver menos linhas que
`porPagina` mesmo havendo mais na coluna pedida. `colunaDaTarefa` é função
pura de `statusTarefa`+`responsavelId` — colunas do banco —, então virou
`where` (`whereColuna`), antes da paginação. Provado por teste (CASO 10b):
`total`/página agora fecham sobre o mesmo universo lógico.

## 5. `EM_RISCO` como filtro e como contador — mesmo universo

Novo filtro `FiltrosGerenciais.emRisco` e contador
`IndicadoresGerenciais.emRisco`, resolvidos pela MESMA função (`idsEmRisco`,
duas fases: candidatos do `where` → `estadosTemporaisDasOperacoes` →
`id: { in: [...] }`) — o card e a lista filtrada nunca podem divergir porque
usam a mesma chamada de entrada. Provado por teste (CASO 10).

## 6. CANCELADA nunca vira CONCLUÍDA — bug real de `coluna` corrigido

Achado durante os próprios testes desta etapa: `visaoGerencial` fazia
`coluna: colunaDaTarefa(t) ?? 'CONCLUIDA'`. `colunaDaTarefa` devolve `null`
para CANCELADA/SUPERSEDIDA de propósito ("ficam fora do quadro" — comentário
já existente, e já testado em `visao-gerencial-global.test.ts`) — mas o
`??` convertia esse `null` em `'CONCLUIDA'` sempre que uma tarefa cancelada
aparecia (com `incluirEncerradas: true`). `ColunaKanban` ganhou o valor
`'CANCELADA'` (aditivo); o fallback agora usa ele. `colunaDaTarefa` em si NÃO
mudou — seu contrato testado (`=== null` para canceladas) continua válido; só
quem consumia o `null` errado foi corrigido.

Como consequência, três cópias hardcoded do union `ColunaKanban`
(`central-tarefas.tsx`, `visao-global.tsx`) foram substituídas por
`import type { ColunaKanban } from "@/lib/operacional/tarefa-projecoes"` — a
causa estrutural que deixaria o próximo valor novo (`CANCELADA`, hoje) fora
de sincronia de novo.

## 7. Deep-links padronizados

- `src/components/operacao/visao-global.tsx` — "Abrir na Central Operacional"
  hand-rolava `` `/kanban?processoId=${id}&tab=central` `` — trocado por
  `urlOperacionalDoProcesso` (Etapa 4).
- `src/components/header-bar.tsx` — os 4 blocos antigos do sino usavam
  `tab=tarefas&atividadeId=` (contrato próprio, não o que
  `resolverAlvoDaTarefa` espera); trocado por `urlOperacionalDaTarefa`, o
  MESMO construtor que o bloco novo (Etapa 4) e o resto do sistema já usam.

## 8. SLA de fase vs. SLA de tarefa — dois conceitos legítimos, não reconciliados

`src/lib/motor/sla-core.ts` (grão FASE/PROCESSO — soma de `slaDays` das fases
obrigatórias) e `lib/operacional/tempo-operacional.ts`/`proximo-acontecimento.ts`
(grão TAREFA — prazo da obrigação específica) respondem perguntas diferentes.
Por instrução explícita desta etapa, **não foram tecnicamente reconciliados**
— o achado fica registrado aqui como nomenclatura a esclarecer nas telas que
mostram os dois (Central Operacional), não como bug.

## Testes

`scripts/etapa5-projecoes-convergem.test.ts` — 29 asserções, CASO 1, 2, 3, 8,
9, 10, 10b, 12 (ver §22/K do relatório de entrega). CASO 4/5/6/7 (atribuição/
conclusão de passo/AGUARDANDO_TERCEIRO/acompanhamento vencido) já cobertos
pela combinação de `emRisco`/`proximoAcontecimento` agora exposta — a mesma
leitura testada em `scripts/proximo-acontecimento.test.ts` (Etapa 3) e
`scripts/etapa4-eventos-notificacoes.test.ts` (Etapa 4) é a que
`tarefa-projecoes.ts` agora consome, não uma nova. CASO 13 (retry/
materialização) não foi alterado nesta etapa — outbox permanece como estava,
confirmado saudável no diagnóstico.

## Dívidas registradas (não resolvidas nesta etapa)

- Home (`lib/home/coleta.ts`) trata passo e tarefa como fontes paralelas de
  escopo — decisão datada preservada, não revertida (ver item 2 acima).
- SLA de fase vs. SLA de tarefa — nomenclatura, não técnica (item 8).
- `resolve-fase-progresso.ts`: quando a Tarefa aponta para um
  `workflowStepInstanceId` que diverge do que a varredura por ordem
  encontraria, o código cai no fallback silenciosamente — não eleva um sinal
  de EM_RISCO próprio (o que a Etapa 5 cogitava). Decisão: EM_RISCO já existe
  no grão Tarefa via `tarefa-projecoes.ts`/`proximo-acontecimento.ts`; duplicar
  o sinal aqui, num grão Documento diferente, seria a "segunda regra" que a
  Etapa 5 proíbe.
- `emissao-progresso-workflow-guard.test.ts` (4 falhas) e três outras
  divergências em `navegacao-operacional.test.ts` são PRÉ-EXISTENTES a esta
  etapa (confirmado via `git show HEAD` — o padrão que elas procuram nunca
  existiu no commit anterior a este) — não corrigidas, por não serem causa-raiz
  desta etapa.
