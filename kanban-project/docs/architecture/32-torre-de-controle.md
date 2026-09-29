# 32 — Torre de Controle

Mandato "Torre de Controle" (29/09/2026): tela única de Administrador que substitui
`/tarefas` (Tarefas e Projetos) e `/operacao/distribuicao` (Distribuição). Executado em
blocos, na ordem, cada um com implementar → testar → push → deploy confirmado →
evidência real. Este documento cresce um bloco por vez — nunca reescrito, só
apensado.

Referência de tela (protótipo estático, fiel pixel a pixel — não recriar o motor
dele): `docs/torre-controle-prototipo.html`.

## Bloco A — Escopo de equipe na API (29/09/2026)

`GET /api/operacao/tarefas` ganhou `escopo=equipe`, para as 4 visões que já existiam
(`minha_fila`, `sem_responsavel`, `acompanhamento`, `feito`).

- **Quem pode**: `usuario.tipo === 'admin'` OU a permissão `operacao.distribuirTarefas`
  (já existia — "ser responsável por distribuir tarefas sem responsável" já É a
  definição de gestor operacional; reaproveitada, não criada permissão nova).
  Qualquer outro perfil que mande `escopo=equipe`: o parâmetro é ignorado, a resposta
  vem com `escopo:"individual"` — nunca um 403 por um parâmetro de mais.
- **O que muda**: em vez de forçar `responsavelId = usuário do token`, a consulta passa
  `responsavelId = null` (ninguém) por padrão — o que, em `visaoGerencial`/
  `whereGerencial`, significa "todo mundo, com ou sem responsável" (ausência de filtro,
  não `= null` literal). Filtros opcionais, todos NOVOS em `FiltrosGerenciais`:
  `responsavelId` (uma pessoa dentro da equipe), `pais` (`Processo.paisCanonico.
  countryKey`, resolvido no `where.processo`), `faseMacroKey`, `processoId` (já
  existiam), `estadoOperacao` (`LinhaGerencial.estadoOperacao` é DERIVADO — nunca
  coluna do banco — filtra em memória depois de `enriquecerLinhas`, via
  `filtrarPorEstadoOperacao`).
- **Onde**: `lib/operacional/tarefa-projecoes.ts` — `minhaFila`/
  `acompanhamentoDoUsuario`/`concluidasRecentesDoUsuario` aceitam `usuarioId: number |
  null` (`null` = escopo de equipe); `semResponsavel` ganhou os mesmos filtros opcionais
  (reaproveitando `whereGerencial`, nunca uma segunda leitura de query). Nenhuma tabela
  nova, nenhuma migração.
- **Verificado ao vivo em produção** (processo 651/Cibils): chamada como Marco
  (admin) com `escopo=equipe&processoId=651` devolve as 19 tarefas do processo,
  incluindo as 5 de Daniela (#3853/#3861/#3863/#3865/#3867, `responsavelNome:"Daniela
  Brait"`) e as 3 sem responsável (#3827/#3845/#3906). `responsavelId=12` (Daniela)
  dentro do escopo de equipe recorta para as 15 dela. Chamada como Daniela (operador
  comum, sem `operacao.distribuirTarefas`) com o MESMO `escopo=equipe`: devolve
  `escopo:"individual"` e só as 15 tarefas dela — o parâmetro foi corretamente
  ignorado.

## Bloco B — Registrar contato completo (29/09/2026)

`ContatoTerceiro` ganha `resultado` (vocabulário fechado: `SEM_RESPOSTA |
CONFIRMOU_PEDIDO | PEDIU_DOCUMENTO | EM_BUSCA | NAO_LOCALIZOU | ENVIOU`) — migração
`20260929120000_contato_terceiro_resultado`, backfill `SEM_RESPOSTA` (era o único
fluxo que existia até aqui: "cobrar" sem saber o resultado).

- **Cobrança sem resposta, de verdade**: nova função pura `contarCobrancasSemResposta`
  (`src/services/subtarefas-da-etapa.ts`) conta só os `SEM_RESPOSTA` a partir do
  último contato com resultado DIFERENTE (ou todos, se nunca houve um) — nunca o
  total bruto de contatos. `escalada` passa a ligar quando essa contagem
  (`cobrancasSemResposta`) atinge `escalarApos` do cadastro do passo, não mais o
  total. `resultado: "ENVIOU"` nunca conclui nada sozinho — só "Receber certidão"
  recebe a certidão de fato.
- **`registrarCobranca()`** (a porta única, já reaproveitada pelas 3 rotas que
  existiam) agora exige `canal` E `resultado` válidos contra o vocabulário fechado
  — `CANAL_INVALIDO`/`RESULTADO_INVALIDO`, nunca gravação com valor livre. Fim do
  canal fixo em `EMAIL`.
- **`cobrancasSemResposta` exposto** em `LinhaGerencial` e em
  `ResumoSubtarefasDoPasso.atual` (`lib/operacional/tarefa-projecoes.ts`), ao lado de
  `totalCobrancas`/`escalada` — mesmo cálculo em lote (`progressoPorSubtarefa`) e por
  tarefa.
- **Achado corrigido no caminho**: `dossieDaTarefa` (o dossiê de UMA tarefa,
  `GET /api/operacao/tarefas/[tarefaId]`) chamava `projetar()` sem o parâmetro
  `progressoSubtarefa` — só a fila em lote (`enriquecerLinhas`) passava esse mapa.
  Resultado: a tela de uma tarefa individual sempre mostrava
  `escalada:false`/`totalCobrancas:0`/`cobrancasSemResposta:0`, mesmo com cobranças
  reais registradas. Corrigido no mesmo bloco — achado testando a evidência abaixo.
- **UI — um mini-formulário, três portas** (`canal`, `resultado`, `observação`
  opcional, `data` opcional — `src/components/operacao/RegistrarContatoModal.tsx`):
  1. Botão "Cobrar" da aba Acompanhamento da Operação (`operacao-v3.tsx`);
  2. "Cobrar todos os vencidos" (mesmo formulário, aplicado em lote — uma
     gravação por tarefa vencida, via `registrarCobranca()`, nunca uma segunda
     implementação);
  3. Bloco novo "Contato com o cartório" dentro de `WorkflowTab.tsx`
     (`DocumentoOperationalDrawer`), na subtarefa corrente em espera de terceiro —
     lista o histórico (data · canal · resultado · quem) e abre o mesmo modal.
  As três chamam a mesma porta (`registrarCobranca`) — nunca uma segunda gravação.
- **"Adiar" sem `window.prompt`**: modal `AdiarAcompanhamentoModal.tsx` (dias 1–15,
  motivo 10–300 caracteres, validado também no servidor). `adiarAcompanhamento`
  passou a gravar o motivo em `TarefaHistorico` (além do `LogAuditoria` que já
  escrevia, escopado por `SubtaskExecution` — histórico que "Andamento" nunca lia).
  `montarAndamentoDaOperacao` (`src/services/andamento-operacional.ts`) passou a
  consultar `TarefaHistorico` por `tarefaId` além de `LogAuditoria` — o motivo do
  adiamento agora aparece na timeline de Andamento, onde antes não aparecia (gap
  real: a subtarefa é escopo de execução, não de tarefa, e "Andamento" só lia por
  `tarefaId`).
- **Evidência ao vivo, tarefa #3853** (processo 651/Cibils, subtarefa
  `receber_confirmacao_pedido` do passo instância 2827):
  - Antes de qualquer contato: `escalada:false, totalCobrancas:0,
    cobrancasSemResposta:0`.
  - 1º contato `SEM_RESPOSTA`: `cobrancasSemResposta:1, escalada:false`.
  - 2º contato `SEM_RESPOSTA`: `cobrancasSemResposta:2, escalada:true` (escalarApos
    do passo = 2).
  - 3º contato `EM_BUSCA`: `cobrancasSemResposta:0, escalada:false` — o `EM_BUSCA`
    quebra a sequência de `SEM_RESPOSTA` e desliga a escalada, exatamente a regra.

## Bloco B — ajuste pós-conferência ao vivo (29/09/2026): `acompanhamentoVencido` e `esperandoHaDias`

Conferência ao vivo das tarefas #3861/#3863/#3865/#3867 (processo 651/Cibils, subtarefa
`receber_confirmacao_pedido`, enviadas 26/09) achou dois bugs REAIS, pré-existentes ao
Bloco B (não introduzidos por ele, mas expostos pela primeira leitura de
`cobrancasSemResposta`/histórico de contato ao vivo):

- **`acompanhamentoVencido` (booleano) divergia de `acompanhamentoPasso.rotulo`
  (texto)** — as 4 tarefas mostravam rótulo "Atrasada há 2 dias" com
  `acompanhamentoVencido:false`. Causa: `computarProximoAcontecimento`
  (`lib/operacional/proximo-acontecimento.ts`) calculava a DIMENSÃO D (próximo
  acompanhamento) a partir de `PhaseWorkflowStepInstance.metadata.operacao.
  proximoAcompanhamento` — um campo JSON informal do motor ANTERIOR ao de
  subtarefas, nunca escrito por `registrarCobranca`/`adiarAcompanhamento`/
  `aplicarEsperaExternaDaSubtarefaSeConfigurado` (sempre `undefined` nos dados
  reais). O rótulo, correto, já lia `SubtaskExecution.proximoAcompanhamentoEm`
  (`estadoTemporalSubtarefa`, em `tarefa-projecoes.ts`) — a mesma dimensão, duas
  fontes. Corrigido: `computarProximoAcontecimento` agora lê
  `SubtaskExecution.proximoAcompanhamentoEm` da subtarefa vigente em
  `AGUARDANDO_EXTERNO` primeiro (dias CORRIDOS, via `diasEntreDiasOperacionais`,
  inalterado); o campo `metadata.operacao...` vira fallback só para passos sem
  motor de subtarefas. Rótulo, booleano e o KPI "Acomp. vencidos" (que só soma o
  booleano) agora sempre concordam — mesma fonte, uma leitura.
- **`esperandoHaDias`/`esperandoDesde` sempre `null`** para tarefas postas em
  espera pelo motor automático. Causa: `contextoDeParada` (`tarefa-projecoes.ts`)
  só lia `LogAuditoria` (`acao IN ('TAREFA_AGUARDANDO_TERCEIRO','TAREFA_BLOQUEADA')`)
  — mas `bloquearTarefa` (`task-step-sync.ts`, a porta que
  `aplicarEsperaExternaDaSubtarefaSeConfigurado` chama, o caminho automático real)
  NUNCA grava `LogAuditoria`, só `WorkflowEvento` (`entityType:"tarefa",
  tipo:"TAREFA_BLOQUEADA", dados.motivoCodigo`). `LogAuditoria` continua sendo a
  fonte de `aguardarTerceiro` (`tarefa-ciclo.ts`, comando manual ainda vivo em
  `/api/tarefas/[id]/comando`) — as duas fontes agora são mescladas em
  `contextoDeParada`, em ordem cronológica real (nunca "uma fonte inteira antes
  da outra"), o sinal mais recente de cada tarefa decide `esperandoDesde`.
- **Achado à parte, não corrigido (decisão de cadastro, não bug de código)**: a
  hipótese inicial era "acompanhamento cadastrado 7 dias → 03/10" — mas os 7 dias
  pertencem à subtarefa SEGUINTE ("Receber certidão", `acompanhamentoPrimeiroDias:
  7`), não à corrente ("Receber confirmação do pedido", cadastrada com
  `acompanhamentoPrimeiroDias: 1`). Com o cadastro real (1 dia, enviado 26/09), o
  vencimento correto É 27/09 — as 4 tarefas estão genuinamente atrasadas há 2 dias,
  não "a vencer em 03/10". Nenhum código foi ajustado para produzir o número
  esperado originalmente; o cadastro de 1 dia para "Receber confirmação do
  pedido" fica como decisão a confirmar (ou corrigir, se for engano) em
  Gerenciamento — fora do escopo desta correção.
- **Evidência ao vivo, #3861/#3863/#3865/#3867** (via `visaoGerencial` e
  `dossieDaTarefa`, as duas rotas de leitura reais): `acompanhamentoVencido:true`,
  `acompanhamentoPasso.rotulo:"Atrasada há 2 dias"`, `esperandoDe:"terceiro"`,
  `esperandoDesde:"2026-09-26T16:3x..."`, `esperandoHaDias:2` — as quatro
  concordando entre si e com a data real (`SubtaskExecution.
  proximoAcompanhamentoEm` = 27/09), nas duas rotas de leitura (fila em lote e
  dossiê de uma tarefa).
