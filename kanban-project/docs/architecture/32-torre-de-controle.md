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

## Bloco C — Órgão como cadastro (29/09/2026)

Decisão do usuário: `OrgaoProtocolo` é o cadastro (não criar `Orgao` novo, não
estender campos — `type` já cobre CARTORIO/CONSULADO/JUIZO/OUTRO como texto
livre). Adiciona só `Tarefa.orgaoId` + `/estatisticas`; migração dos dados
existentes por nome, mostrada antes de aplicar.

- **`Tarefa.orgaoId`** (`Int?`, `onDelete: SetNull`, migração
  `20260929150000_tarefa_orgao_id`) — espelha `Documento.orgaoId` (mesmo
  cadastro, mesma FK), mas é campo PRÓPRIO da Tarefa: existe mesmo quando não
  há documento. `vincular-orgao-lote` (a porta operacional que já existia)
  passa a gravar os dois campos na MESMA chamada — `Documento.orgaoId`
  continua o dono para o motor de subtarefas (`fornecedorId`); `Tarefa.orgaoId`
  é o que a Torre e `/estatisticas` leem. `whereGerencial` ganha o filtro
  `orgaoId` (por ID, canônico) — separado do `terceiro` (texto, legado,
  intocado).
- **`GET /api/gerenciamento/orgaos-protocolo/[id]/estatisticas`** — reaproveita
  `visaoGerencial({ orgaoId })` (tarefas por `estadoOperacao`/atrasadas/
  escaladas/status) e `ContatoTerceiro.groupBy({ by: ['resultado'], where:
  { orgaoId } })` (cobranças por resultado) — nenhum contador novo, nenhuma
  tabela nova. `incluirEncerradas:true` de propósito: canceladas/supersedidas
  também são fato sobre o órgão.
- **Migração dos dados existentes** (`scripts/backfill-tarefa-orgao-id.ts`,
  `--dry` por padrão, mesma trava de `backfill-orgao-cartorio-brasileiro.ts`
  para `--aplicar --prod`): duas fontes, nunca um chute —
  1. Cópia direta de `Documento.orgaoId` já resolvido (sem ambiguidade).
  2. Casar por nome (`chaveDeNome`/`similaridade`,
     `src/services/organizacao-identidade.ts` — o mesmo motor anti-duplicidade
     do cadastro de Órgãos) contra `Documento.cartorio` livre, só quando o
     melhor candidato tem score ≥ 0.5 e margem ≥ 0.15 sobre o segundo; o resto
     fica gap documentado, nunca gravado sem confiança.
  - **Lista mostrada antes de aplicar** (57 tarefas com documento,
    produção): 39 vinculadas por cópia direta; 16 tarefas / 3 nomes de texto
    livre distintos ("Sarandí del Yi, 9 Durazno", "Bage", "Santa Clara do
    Sul" — nomes de CIDADE, não de instituição) sem candidato confiável — 0
    aplicadas, todas viraram gap documentado; 2 tarefas sem `orgaoId` nem
    `cartorio` — inalteradas. Aplicado: 39 tarefas vinculadas, 18 gaps reais
    (confirmado em produção: `COUNT(Tarefa.orgaoId IS NOT NULL) = 39`).
  - Órgãos com gap ficam disponíveis para vínculo manual pela porta que já
    existia (`vincular-orgao-lote`) — nenhuma tela nova para isso neste bloco.
- **Evidência ao vivo**: `GET .../orgaos-protocolo/292/estatisticas`
  (#3853/Porto Alegre - 6ª Zona) → `tarefas.total:1,
  porEstadoOperacao.AGUARDANDO:1`; `GET .../orgaos-protocolo/290/estatisticas`
  (Porto Alegre - 4ª Zona, 10 tarefas históricas) →
  `porStatusTarefa:{AGUARDANDO_TERCEIRO:1,SUPERSEDIDA:6,CANCELADA:2,
  NAO_INICIADA:1}` — números batendo com o histórico real do processo 651.

## Bloco D — Repactuar prazo com histórico (29/09/2026)

Nenhuma gravação nova. A porta já existia inteira: `POST /api/tarefas/[id]/
comando` com `acao:"alterar_prazo"` → `alterarPrazo` (`lib/operacional/
tarefa-ciclo.ts:480`) — motivo obrigatório, tarefa terminal recusa, e grava
`LogAuditoria` (`TAREFA_PRAZO_ALTERADO`) com `de`/`para`/`motivo`/autor. O
gap real era só a INTERFACE: não havia botão em lugar nenhum, e a Andamento
mostrava a data crua do log (`"2026-10-06T16:34:07.918Z"`) em vez de
formatada.

- **`RepactuarPrazoModal.tsx`** — mesmo mini-formulário canônico da família
  (dias/motivo, `AdiarAcompanhamentoModal`/`RegistrarContatoModal` do Bloco
  B): prazo atual (leitura), novo prazo (`<input type="date">`), motivo
  obrigatório (≥5 caracteres), desabilitado se a data não mudou. Chama
  `POST /api/tarefas/{id}/comando` (`acao:"alterar_prazo"`) — nenhuma porta
  nova no backend.
- **Botão "Repactuar"** ao lado de "Prazo da tarefa" no cabeçalho do
  `DocumentoOperationalDrawer`, visível só para quem tem `tarefas.editar`
  (mudar o prazo OFICIAL é decisão de gestão, não do executor — mesma régua
  que já separa "Delegar" no mesmo cabeçalho; confirmado ao vivo: some para
  Daniela — perfil "Assistente", `tarefas.editar:false` — e aparece para
  Marco/admin).
- **Fix no Andamento**: `montarAndamentoDaOperacao` formata `de`/`para` de
  `TAREFA_PRAZO_ALTERADO` como `dd/mm/aaaa` (`rotuloDeData`, meio-dia UTC
  como qualquer outra data-calendário do sistema) — antes mostrava o ISO
  cru. Coberto por assert novo (`4c`/`4d`) em
  `andamento-operacional.test.ts`.
- **Evidência ao vivo, #3853** (documento 2267, via drawer real como
  Marco/admin, Central Operacional → Itiberê Barreto Cibils → Ver etapa →
  Repactuar): prazo 06/10/2026 → 08/10/2026, motivo "Teste Bloco D ao vivo -
  adiando 2 dias por atraso do cartorio". Confirmado em produção:
  `Tarefa.dataPrazo = 2026-10-08`, `LogAuditoria.detalhes = {de:
  "2026-10-06T16:34:07.918Z", para: "2026-10-08T12:00:00.000Z", motivo:
  "..."}`, e Andamento devolve `{de:"06/10/2026", para:"08/10/2026",
  autor:"Marco Rovatti", motivo:"..."}` — a mudança fica visível, legível e
  atribuída.
- **Nota operacional**: este bloco foi retomado de uma sessão concorrente
  que já tinha o modal e o fix de formatação escritos (não commitados) —
  revisados, testados (tsc/lint/suíte + prova ao vivo) e completados aqui,
  sem duplicar trabalho.

## Bloco D — correção pós-conferência ao vivo (29/09/2026): coluna errada + projeção + CERT-001

Conferência ao vivo achou o bug real: `alterarPrazo` (versão inicial do
Bloco D) só escrevia `Tarefa.dataPrazo` — para uma Tarefa de Emissão
Documental (a maioria), as telas que leem a certidão (Central, Relatório,
e o check de saúde CERT-001) leem `SolicitacaoDocumento.previsaoRetorno`
(Parte 1, "fonte única de status e prazo de certidão"), não
`Tarefa.dataPrazo`. #3853: repactuado para 08/10 no drawer, mas
`previsaoRetorno` continuava 06/10 — a mudança só existia numa coluna que
nenhuma das 3 telas mostra.

- **Fonte + espelho, não só fonte**: `alterarPrazo` (`lib/operacional/
  tarefa-ciclo.ts`) agora, quando a Tarefa é de certidão (`tipo==='NORMAL'
  && faseMacroKey==='emissao_documental' && necessidadeId!=null`) E já
  existe `SolicitacaoDocumento` para o documento dela: escreve
  `previsaoRetorno` (a fonte que a projeção lê) E `Tarefa.dataPrazo`
  (espelhado, mesmo valor) — nunca só um dos dois. Por quê espelhar: o
  próprio CERT-001 audita que os dois batem, E — achado ao investigar —
  PRZ-001 (`lib/saude/verificacoes/agendados.ts`) lê `Tarefa.dataPrazo`
  BRUTO como fonte primária para decidir "tarefa vencida"; Kanban e
  notificações também (migração da Parte 1 foi parcial: só Central/
  Relatório/CERT-001 foram migrados para ler a projeção). Só escrever
  `previsaoRetorno` teria corrigido 2 telas e quebrado PRZ-001/Kanban/
  notificações silenciosamente.
- **Sem `SolicitacaoDocumento` ainda → cai no caminho antigo** (só
  `Tarefa.dataPrazo`, sem espelho): `alterarPrazo` é primitiva
  COMPARTILHADA, não só a porta do drawer — `resolverPoliticaTemporal`
  (mandato "SLA por cartório", 24-25/09/2026) já a reaproveita para um
  override pontual ANTES de qualquer solicitação existir (achado ao rodar
  a suíte: exigir solicitação aqui quebrava
  `mandato-sla-cartorio-override.test.ts`, seção 4 — 6 asserts que hoje
  provam exatamente esse caminho).
- **Dado de #3853 reconciliado**: `SolicitacaoDocumento(id:62).
  previsaoRetorno = 08/10/2026` e `Tarefa.dataPrazo = 08/10/2026`
  (mirrorados) — coerente com o histórico já gravado em `LogAuditoria`
  (`de: 06/10 → para: 08/10`, que não foi tocado).
- **`repactuacoes`/`ultimaRepactuacao` em `LinhaGerencial`**
  (`lib/operacional/tarefa-projecoes.ts`): nova função batched
  `repactuacoesDePrazo` lê `LogAuditoria` (`TAREFA_PRAZO_ALTERADO`), conta
  por tarefa e resolve o nome do autor em lote — nenhuma consulta N+1,
  mesmo padrão de `contextoDeParada`. Ligada em `enriquecerLinhas` (o
  caminho de `/api/operacao/tarefas`, `visaoGerencial`, `minhaFila`,
  `semResponsavel`) E em `dossieDaTarefa` (`/api/operacao/tarefas/
  [tarefaId]`) — as duas rotas de leitura, nunca só uma.
- **Achado extra, corrigido no caminho**: `repactuarPrazo`
  (`DocumentoOperationalDrawer.tsx`) checava `j.ok`/`j.mensagem` — mas o
  contrato real de `POST /api/tarefas/[id]/comando` é `{tarefaId, acao}`
  no sucesso (sem `ok`) e `{error, codigo}` no erro (sem `mensagem`), com o
  HTTP status decidindo. Sucesso E erro caíam no mesmo ramo (`!j.ok` é
  sempre `true` nessa resposta), calados — a UI nunca soube dizer se a
  repactuação deu certo. Corrigido para `r.ok` (do `Response`) + `j.error`,
  o mesmo padrão que `visao-global.tsx` já usa para a mesma porta.
- **CERT-001, antes e depois** (reconstruindo o estado real do bug em
  produção, rodando, corrigindo, rodando de novo):
  - **Antes** (`Tarefa.dataPrazo=08/10` / `previsaoRetorno=06/10`,
    exatamente o estado que o bug deixou): `status: "COM_ACHADOS"`, 1
    achado — `cert-divergencia:3853` (`Tarefa grava dataPrazo=2026-10-08`;
    `projeção calculada daria dataPrazo=2026-10-06`).
  - **Depois** (os dois em 08/10): `status: "APROVADA"`, 0 achados.
- **Evidência ao vivo, as 4 superfícies, #3853** (via API real, produção):
  Tarefa (`dossieDaTarefa`/`/api/operacao/tarefas`): `dataPrazo:
  "2026-10-08T12:00:00.000Z"`, `repactuacoes:1`,
  `ultimaRepactuacao:{de:"2026-10-06T16:34:07.918Z",
  para:"2026-10-08T12:00:00.000Z", quando:"2026-09-29T15:47:38.775Z",
  quem:"Marco Rovatti"}`; Central Operacional
  (`/api/processos/651/central-operacional?faseCode=EMISSAO_DOCUMENTAL`):
  `taskId:3853, prazo:"2026-10-08T12:00:00.000Z"`; Relatório de Certidões
  (`POST /api/relatorios/consultar`, domínio `certidoes`, necessidade 605):
  `previsao:"08/10/2026", situacao_prazo:"No prazo"`; CERT-001/Dashboard: 0
  achados (acima).
- **Teste novo**: seção 5 de `scripts/mandato-sla-cartorio-override.test.ts`
  (9 asserts) — registra uma solicitação real, repactua, prova fonte +
  espelho + LogAuditoria + a MESMA verificação que CERT-001 roda
  (`statusEPrazoEfetivos` batendo). Fixture `palco()` ganhou
  `Documento.necessidadeId` (faltava — gap do fixture, não do código sob
  teste; sem ele a seção 5 não achava o documento pela relação que
  `projecoesDeCertidaoPorNecessidade` usa).

## E — disciplina de sessão única (29/09/2026)

O usuário encontrou, ao vivo, uma sessão concorrente do Claude Code editando
este mesmo repositório sem coordenação (trabalho do Bloco D em progresso,
não commitado). Regra now em vigor: **detectar sessão concorrente → PARAR e
avisar o usuário**, nunca decidir sozinho revisar/completar o trabalho
alheio. `ListAgents` deve ser checado antes de iniciar qualquer bloco novo.


## Bloco G — Ações sobre tarefas (30/09/2026)

**Nada de regra nova**: toda ação é a porta individual repetida, item a item, com a **sua** linha de `LogAuditoria` por tarefa.

| Ação | Porta reaproveitada | Permissão (a da porta individual) |
|---|---|---|
| Atribuir a {pessoa} (lote) | `redistribuirTarefas` (`tarefa-comandos.ts`) | `tarefas.editar` |
| Prioridade alta (lote) | `redistribuirPrioridade` — pula quem já é ALTA/URGENTE (nunca rebaixa) | `tarefas.editar` |
| Repactuar prazo (lote, UMA justificativa) | `alterarPrazo` (`tarefa-ciclo.ts`) — mesma validação da individual (motivo obrigatório; encerrada recusada; certidão com solicitação grava `previsaoRetorno` **e** espelha `dataPrazo`). O lote exige uma data (não remove prazo em massa). | `tarefas.editar` |
| Cobrar cartório (lote) / por linha | `registrarCobranca` via `src/services/cobranca-terceiros.ts` | `tarefas.ver` (não-admin só as próprias) |
| Iniciar (ação rápida) | `src/services/iniciar-envio.ts` → `concluirSubtarefaCorrentePeloPasso` (pelo motor) | `tarefas.iniciar_concluir` |
| Cobrar todos os vencidos (N) | rota existente `cobrar-todos-vencidos` (refatorada para o serviço; canal ausente = canal cadastrado) | `tarefas.ver` |
| Cobrar por cartório / Contatos | `POST/GET /api/torre/terceiros/{orgaoId}/cobrar|contatos` | `tarefas.ver` |

Além da permissão de cada ação, **toda** rota `/api/torre/*` exige ser gestor da Torre (`src/lib/torre-acesso.ts`: `tipo admin` ou `operacao.distribuirTarefas`). A tela só mostra o botão que a API aceitaria; a API confere sempre.

**Desfazer (6 s no toast, 30 s no servidor).** Lê o **próprio** `LogAuditoria` da ação (`de`/`para` por tarefa — nenhuma tabela paralela), restaura o estado anterior real e audita a reversão (`TAREFA_ATRIBUICAO_DESFEITA`, `TAREFA_PRIORIDADE_DESFEITA`, `TAREFA_PRAZO_REPACTUACAO_DESFEITA`). Só desfaz a ação **recente, do próprio autor**, e só se a tarefa ainda está como a ação a deixou (mexida depois = recusa). **Cobrar não tem Desfazer**: `ContatoTerceiro` é fato histórico append-only.

**"Iniciar" só para quem realmente pode** (`motivoDeNaoPoderIniciar`, mesmo predicado na lista e na API): status `NAO_INICIADA`, ponto de entrada não tocado, **fase atual do processo** (fase deixada/futura não), sem dependência aberta (`podeExecutar`) e com órgão vinculado. Bloqueada não inicia.

**"Cobrar todos os vencidos (N)"**: `ehCobravelVencido` (`lib/operacional/torre-predicados.ts`) é o predicado do botão da Operação (`acompanhamentoVencido`, fora da Genealogia, sem encerrada) e é o **mesmo** do filtro "Cobranças vencidas" — o N do botão é a contagem da lista.

**G5 — ligar ao histórico sem duplicar.** Um `ContatoTerceiro` (agora **sempre** com `orgaoId`/`documentoId` da tarefa, por todas as portas de cobrança e pela ligação) aparece no Andamento da tarefa (`andamento-operacional.ts` passou a ler `ContatoTerceiro`) **e** em "Contatos" do órgão — um registro, duas projeções. `Trocar canal` grava na `SolicitacaoDocumento` e **uma** linha `SOLICITACAO_CANAL_ALTERADO` sob a **Tarefa** (com `solicitacaoId`/`orgaoId`), lida pelo Andamento e pelos Contatos do órgão.

**Canal cadastrado** (`canaisCadastrados`): canal da solicitação mais recente (com equivalente de contato) → e-mail/telefone do órgão → e-mail (padrão histórico). O formulário de cobrança em lote/por órgão oferece "Canal cadastrado de cada pedido".

**G6 — painel espelhado**: `DocumentoOperationalDrawer` real, com o painel da Torre injetado por `barraSuperiorExtra` (bola com, prazo, próximo acompanhamento, responsável, passos X/N, **Atribuir a {sugerido}** — o nome vem de `GET /api/torre/tarefas/{id}/sugestao` —, Repactuar, Bloquear com motivo, Reabrir passo, Registrar ligação, Trocar canal). Nenhum botão novo grava por fora: cada um chama a porta existente.

## Bloco H — Equipe e Regras (30/09/2026)

**Equipe (`lib/operacional/torre-equipe.ts`).** Os números vêm das **mesmas linhas da Operação** (`listarTarefasDaTorre` → `cargaPorPessoa`, conta única também usada pela regra r3). Carga = **executáveis** (fora as que esperam terceiro/cliente e as bloqueadas) ÷ `limiteExecutaveis` do cadastro; verde < 70 %, âmbar ≥ 70 %, vermelha ≥ 100 %; sem limite cadastrado não há barra ("sem limite"). Fila em semanas = executáveis ÷ capacidade medida (E1); ≥ 2 vermelho, ≥ 1 âmbar, senão "livre"; sem conclusão medida e com trabalho = "sem base" (nunca "livre" inventado). Bate com `/api/operacao/capacidade` (provado em teste).

**Ausência não move nada.** Marcar/Cancelar ausência reusa `PATCH /api/operacao/capacidade` (só registro + sucessor sugerido, E2). **Mover carteira** é ação manual (`redistribuirTarefas`), só o que o destino é apto a executar (mesma regra opt-in de aptidão da sugestão). **Simular saída** só lê (provado: tarefas, auditoria e ausências idênticas antes e depois); "Aplicar" registra a ausência com o sucessor sugerido **e** move a carteira — um clique deliberado sobre um impacto já mostrado; o Desfazer dele encerra a ausência junto (senão o motor recusa devolver trabalho a quem está ausente).

**Previsão de 4 semanas**: vencimentos (prazo da linha) por pessoa por semana, semanas calculadas de hoje no fuso operacional; a linha "Sem responsável" fecha a soma com a Operação.

**Regras — só r1, r2, r3** (`lib/operacional/regras-torre.ts`, estado em `ConfiguracaoSistema` grupo `torre`, **sem migration**; ausência de linha = padrão). Não existem r4, r5 nem "tempo aprendido".

| Regra | Nasce | Onde executa | Desligada |
|---|---|---|---|
| r1 Atribuição automática | **desligada** | `executarR1` (cron horário `/api/cron/torre-regras` e "Aplicar agora") — para cada SEM_DONO do "Precisa de você", atribui à sugestão, balanceando o que o próprio plano já distribuiu | devolve `REGRA_DESLIGADA` sem calcular nem escrever |
| r2 Régua de cobrança | **ativa** | `registrarCobranca` (reagenda o acompanhamento e liga a escalada) — texto lido do cadastro publicado (`diasAposCobranca`/`escalarApos`/esperas), nunca números fixos | o contato continua **registrado** (fato histórico), mas a régua não reagenda nem escala |
| r3 Limite de carga | **desligada** | dentro de `executarR1`: quem está no limite (executáveis ≥ limite) não recebe atribuição automática; a tarefa fica sem dono para decisão em "Precisa de você" | limite ignorado |

Simular usa os dados de hoje e **nunca grava** (nem com a regra ligada). Ativar/Desativar é auditado (`REGRA_TORRE_ATIVADA/DESATIVADA`, `de`/`para`, autor) e idempotente. Esta unidade **não altera** o item "Carga" do "Precisa de você" (Bloco F), que segue lendo `Tarefa` cru — ver a nota do relatório sobre a divergência possível com a aba Equipe para certidões.

**Interface provisória**: `/torre` (sem item de menu — Decisão 3) com Tarefas · Terceiros · Equipe · Regras. As demais abas e o shell final são dos Blocos I e J, que reaproveitam estes componentes (`src/components/torre/`).

**Testes** (na suíte crítica): `torre-bloco-g-lote-e-desfazer`, `torre-bloco-g-terceiros-acoes-e-permissoes`, `torre-bloco-h-equipe`, `torre-bloco-h-regras`.

## Bloco I — Integridade, Auditoria, Foco e Relatório de controle (30/09/2026)

**Antes de montar, o Saúde foi verificado** (leitura em produção). Não reproduzidos: "diagnóstico profundo que não fica salvo" (51 execuções PROFUNDAS persistidas, botão e cron gravam) e "achados antigos que não somem" (0 de 50 abertos sem ser visto na última rodada; 0 com código fora do catálogo). **Reproduzidos e corrigidos (autorização explícita):** as cascas de Modelo da Biblioteca (`PhaseInternalWorkflow.origemBiblioteca = true`, fase `biblioteca`) geravam ~30 ERROS falsos — CAD-002 (28, "fora da competência de biblioteca"), WF-006 e WFI-002 (7 workflows "ativos para a mesma fase"). As três verificações agora ignoram `origemBiblioteca`; workflows de fase reais continuam verificados (teste `saude-biblioteca-nao-e-fase`, que falha sem o fix). A **chave do CAD-002** deixou de usar o id da ação (que muda a cada republicação, reabrindo o achado com outro id): agora é `wfUid:passo:subtarefa:ação`. **Mantidos como estão, por decisão:** CAD-012 (2 passos reais sem meio de execução — corrigir o cadastro é do Gerenciamento) e CAD-011 (INFORMATIVO, visível, depois dos erros/alertas). **Só registrado, não corrigido:** as rodadas RÁPIDAS (a cada hora) não resolvem achados que só as COMPLETAS/PROFUNDAS detectam (CAD-002, WF-006…), então a limpeza pode levar até 24 h.

**Integridade** (`lib/operacional/torre-integridade.ts`, `GET /api/torre/integridade`, `usuarios.gerenciar`): lê `SaudeAchado`/`SaudeExecucao` — o mesmo motor do painel de Saúde; nenhuma verificação nova. Cada achado traz gravidade, achado, efeito (`impacto`), e a ação de correção ao lado (link do Gerenciamento, recomendação e, se existir no catálogo de correções seguras, o botão "Corrigir"). Ordem CRÍTICO → ERRO → ALERTA → INFORMATIVO. **Ignorar 7 d** (`POST /api/torre/integridade/ignorar`, justificativa obrigatória): `ignoradoPorId`, `ignoradoAte`, `justificativa` no achado + `SAUDE_ACHADO_IGNORADO` na auditoria; o achado segue visível no Saúde. Vencido o prazo o achado **volta à lista**, conferido **na leitura** — a rotina de gravação do Saúde não foi alterada. "Rodar diagnóstico agora" chama o `POST /api/gerenciamento/saude` (modo COMPLETO).

**Auditoria** (`lib/operacional/torre-auditoria.ts`): `LogAuditoria` de entidade `Tarefa` e `Processo`; filtros período/autor/processo/ação, paginação no servidor (50, máx. 200). `justificativa` = o `motivo`/`justificativa` gravado no detalhe (nulo quando a ação não tinha — nada inventado). **CSV** gerado no servidor com o mesmo filtro (`;`, BOM, células que começam com `= + - @` neutralizadas, teto de 20.000 linhas com aviso). **Só administrador**; cada exportação é registrada (`AUDITORIA_EXPORTADA`).

**Foco da família** (`lib/operacional/torre-foco.ts`, `GET /api/torre/foco/{processoId}`): cabeçalho família · país · código; fase atual e "X de Y certidões recebidas" (progresso real E9); **4 números** (abertas, vencidas, com o cartório, sem responsável) calculados sobre as **mesmas linhas da aba Tarefas** (`numerosDoFoco`, provado igual); tabela com as linhas da Operação; **linha do tempo** com o que o banco registrou (LogAuditoria do processo e das tarefas, `PhaseAdvanceLog`, `ContatoTerceiro`); comentários com @menção via `/api/comentarios?familiaId` (E4). Abre pelo nome da família no grupo da aba Tarefas (Radar e Processos entram no J).

**Relatório de controle**: não é relatório novo — é o domínio **Certidões** do motor de Relatórios (`/api/relatorios/consultar|exportar`) filtrado pela família (ou pelo processo, se sem família), versão interna, exportável em CSV/Excel/PDF, com as permissões do módulo (`relatorios.ver` + `processos.ver`).

**Testes**: `saude-biblioteca-nao-e-fase`, `torre-bloco-i-integridade-auditoria-foco` (na suíte crítica).

## Bloco J — A tela final (30/09/2026)

**J.0 (antes de qualquer troca)**: snapshot SÓ LEITURA das tarefas abertas (atribuições e estados) em `snapshots/torre-j0-2026-09-30.json` — 33 linhas, fora do git (`/snapshots/` no `.gitignore`) e portanto fora do deploy. O Bloco J **não reatribui nada**: nenhuma reatribuição foi necessária.

**Rota e menu**: `/torre` deixou de ser provisória. Item "Torre de Controle" no menu entre Operação e Calendário, `soAdmin`. **Absorção (J5)**: `/tarefas` (Tarefas e Projetos) e `/operacao/distribuicao` (Distribuição) levam à Torre **só o administrador** (`src/lib/torre-absorcao.ts` — função pura, provada em teste): `/tarefas` → aba Tarefas; `/operacao/distribuicao` → aba Tarefas filtrada por "Sem responsável" (onde estão Atribuir, lote e sugestão; a capacidade é a aba Equipe, a um clique). Quem não é admin (a Daniela) continua na tela de hoje, com o mesmo código. Nada foi apagado; os dois itens seguem no menu.

**KPIs (J3)** — `lib/operacional/torre-kpis.ts` (puro): UMA definição serve ao número do cartão, à lista que o clique filtra (`linhasDoKpi`) e à foto diária E10 (`kpisDasLinhas`). O cron `torre-indicadores` passou a usar essa função (antes usava `indicadoresGerenciais`, com definições um pouco diferentes da lista): a primeira foto após esta entrega substitui a de hoje. Definições: *Atrasadas* = `atrasada`; *Vencem em 7 dias* = não atrasada e 0–7 dias; *Sem responsável*; *Com o cartório* = `estadoOperacao: AGUARDANDO`; *Cobranças vencidas* = `ehCobravelVencido` (o botão "Cobrar todos os vencidos"); *Escaladas pra mim* = `escalada`; *Processos em risco* = nº de PROCESSOS de risco **crítico** no score do "Precisa de você" (F) — a MESMA palavra "risco" do Radar e da aba Processos (`processosCriticos`; a rota anota cada linha com `processoEmRisco`); o clique filtra as tarefas desses processos. (No Bloco E10 esse cartão contava processos com tarefa `emRisco` temporal; foi unificado para o cartão, a foto e o Radar não discordarem.); *Backlog* abre/fecha na semana — agregado, **não filtra** (Decisão 5). **Tendência REAL**: hoje × a foto de 7 a 10 dias atrás (`fotoDeReferencia`); sem foto → "sem histórico"; com um país selecionado não há delta (a série é global — nunca se compara número filtrado com foto global).

**Radar e Processos (J4)** — `lib/operacional/torre-processos.ts`: colunas do Radar = as fases ATIVAS do cadastro (`CatalogoFase`, hoje **10**: além das 9 do protótipo existe *Tradução Juramentada*, que só os macrofluxos Itália e Alemanha têm — nas demais a coluna é "n/a"); célula da fase atual = bola (Cartório / Cliente / Nossa) + dias na fase, cor = risco; risco = o MESMO score do "Precisa de você" (F): ≥ 6 crítico, ≥ 3 atenção; fase futura com achado aberto CAD-012/WF-004 (não ignorado) = "sem passos". Processos: progresso real, dias na fase e próximo marco (E9), bola, risco, Foco e Relatório (I). **Terceiros**: a coluna é "Régua" (nunca "tempo aprendido"), mais o Tempo médio real por fase (E11) e o backlog.

**Visões salvas** (aba Tarefas): `RelatorioVisao` com `dominio: "torre-tarefas"` — **sem migration** (spec JSON: visão, agrupamento, KPI, país, busca), compartilháveis com a equipe (`compartilhada`, E7), só o dono altera/remove, tudo auditado (`VISAO_TORRE_SALVA/COMPARTILHADA/REMOVIDA`).

**Países (J2)**: `GET /api/torre/paises` = países com Tipo de Processo ativo (a mesma lista dos Relatórios). **Briefing** e **Revisar o dia** reaproveitam `GET /api/torre/precisa-de-voce` e o dispatcher de ações do F; a revisão não tem estado no servidor.

**Testes**: `torre-bloco-j-kpis-radar-visoes-absorcao` (e o E10, ajustado à definição única), na suíte crítica.

### Correção pós-conferência do Bloco J — "há quanto tempo na fase" (30/09/2026)

Radar e Foco mostravam "0 d" nas três famílias. Os zeros eram reais (entradas há menos de 24 h), mas o texto não dizia isso e a fonte estava errada em dois pontos: só `MOVIDO` era lido como entrada de fase (`AVANCADO`/`FORCADO` eram ignorados) e a abertura do processo (`dataInicio`) valia como entrada em QUALQUER fase.

Fonte única: `diasNaFaseAtual` (`lib/operacional/metricas-processo.ts`), lida pela aba Processos ("Dias na fase"), pela célula do Radar e pelo Foco. Ordem:
1. último `PhaseAdvanceLog` com resultado em `RESULTADOS_QUE_MOVEM_DE_FASE` (`MOVIDO`, `AVANCADO`, `FORCADO`) e `fasePretendida` = fase atual → origem `AVANCO_DE_FASE`;
2. se a fase atual é a PRIMEIRA do macrofluxo: `dataInicio ?? createdAt` do processo → `CADASTRO_DO_PROCESSO`;
3. `PhaseWorkflowInstance` mais recente da fase → `INSTANCIA_DA_FASE`;
4. nada disso: `desde/dias/horas = null` e a tela mostra "—". Nunca "agora", nunca "0 d".

Formatação única (`textoTempoNaFase`, `torre-predicados.ts`): "—" sem data; "N d" a partir de 1 dia; "N h" antes disso; "< 1 h" abaixo de 1 hora. `tempoMedioRealPorFase` (E11) usa o mesmo conjunto de resultados.

Legenda do Radar: "parado 7+ dias" NÃO é regra (o score do Precisa de você não a tem); a legenda descreve a pontuação real (atenção 3–5, crítico ≥ 6 ou fase sem passos). Teste: `scripts/torre-bloco-j-tempo-na-fase.test.ts` (na suíte crítica).

Distribuição: o redirecionamento de quem não tem `tarefas.editar` para `/operacao` já existia antes do Bloco J (`src/app/operacao/distribuicao/page.tsx`); o J não o alterou (o teste acima o trava).
