# 30 — Catálogo de Fases: publicação e reconciliação retroativa

Mandato de 20/09/2026. REGRA MASTER: publicar uma configuração de fase nunca exige excluir, recriar, clonar ou reconstruir processo. Toda publicação alcança os processos em andamento aplicáveis — incremental, automática, idempotente, auditável, não-destrutiva.

## 1. Diagnóstico

Antes desta entrega, "o que é uma fase" tinha **6 respostas paralelas**:

1. `FASES` — objeto hardcoded em `src/lib/process-stage/fases-catalog.ts`, 51 importadores.
2. `CatalogoFase` — cadastro real, com CRUD (`CatalogoFasesTab.tsx`), já pretendia ser a fonte única (dizia isso no próprio comentário), mas sem versionamento e sem propagar para (3).
3. `MacroWorkflow` → `FaseMacro` — a sequência real, por `TipoProcessoNacionalidade`, que `phase-advance.ts` de fato valida ao mover `Processo.faseAtualKey`. `seedDefaults` copiava (2)→(3) uma vez, na criação; sem sincronização contínua.
4. `PROCESS_PHASES` — array hardcoded de labels em `WorkflowMacroTrilha.tsx`, casado por string em `ProcessoCentralOperacional.tsx` (viola Regra 6 do CLAUDE.md).
5. Duplicata morta de `FASES` em `GerenciamentoScaffolds4.tsx` (tela inatingível).
6. `/api/kanban-config` — o único padrão corretamente construído: DB-driven, por `phaseKey`, via `MacroWorkflow.fases`.

`Processo.faseAtualKey` já era bem guardado — `phase-advance.ts` é o único escritor (CAS + auditoria tripla) — mas validava contra a fonte errada relativamente ao cadastro administrável. `PhaseInternalWorkflow.phaseKey` não tinha nenhuma integridade referencial (por isso o guard `EQUIVALENCIA_LEGADA` existe: detecta deriva, nunca corrige).

**Bug concreto confirmado** (`src/lib/motor/catalogo-de-efeitos.ts`): `COMPETENCIA_PADRAO_DA_FASE` tinha a chave `emissao_retificada` em vez da real `emissao_documental_retificada` — nunca batia. `efeitosDaFase()` devolvia, para chave sem competência declarada, **todos** os efeitos não-`exigeAutorizacaoExplicita` — inclusive `GO_RETIFICATION`, exclusivo da Análise. Confirmado em produção (leitura, 20/09/2026): `emissao_documental_retificada`, `genealogia`, `traducao_juramentada`, `apostilamento`, `aguardando_protocolo`, `protocolado`, `finalizado` tinham `efeitosPermitidos: null` — todas vulneráveis ao mesmo buraco. `emissao_documental`, `analise_documental` e `retificacao_registros` já estavam corretamente declaradas.

**Reconciliação em massa: não existia.** Todos os reconciliadores do projeto (`reconciliar-fase.ts`, `reconciliar-motor-fases.ts`, `reconciliar-requerente-economico.ts`, `reconciliar-tarefas.ts`, `obrigacao-atribuicao.ts`) são por-processo, reativos. Nada fazia "publiquei → varra os processos em andamento do tipo aplicável".

## 2. Decisão de escopo (bloqueio resolvido com o usuário)

O mandato pede um escopo canônico de 3 valores (`PROCESS`/`DOCUMENT`/`RECORD_OR_PERSON`). O motor já tem `Cardinalidade`/`EscopoExecucao` com **4** valores (`PROCESSO`/`PESSOA`/`NECESSIDADE`/`DOCUMENTO`), com lógica de materialização genuinamente distinta para `PESSOA` (1 por pessoa) e `NECESSIDADE` (1 por registro/certidão a localizar, preservando o vínculo pessoa+registro) em `phase-workflow-escopo.ts`. Decisão (confirmada com o usuário): **mantidos os 4 valores reais**; `RECORD_OR_PERSON` é um rótulo de agrupamento de leitura (`PESSOA`+`NECESSIDADE`), nunca um enum substituto. Nenhuma lógica de materialização foi alterada.

## 3. Modelo de dados (aditivo — ver migration)

- `CatalogoFase` ganha `status` (`RASCUNHO`/`PUBLICADA`/`INATIVA`) e `revisaoAtual`. `ativo` (boolean) permanece, mantido em sincronia por quem escreve `status` — nunca uma segunda fonte.
- `CatalogoFaseRevisao` — revisão congelada por fase, mesmo padrão de `PhaseInternalWorkflowVersao`: histórico/auditoria/comparação/rollback, nunca trava um processo em andamento na versão antiga.
- `MacroWorkflowVersao` — revisão congelada da composição (`FaseMacro.*` na íntegra) do Workflow Macro. `MacroWorkflow.versao` (campo já existente, nunca incrementado até esta entrega) passa a ser incrementado a cada publicação estrutural.
- Nenhuma coluna existente foi removida ou teve o tipo alterado.

## 4. Fluxo de publicação

`PUT /api/gerenciamento/workflow-macro/[id]` (Admin, permissão `usuarios.gerenciar`):

1. Rejeita `phaseKey` duplicada na composição recebida (`FASE_CHAVE_DUPLICADA`).
2. Valida cada fase por `avaliarAptidaoDaFase` — agora também recusa `status === INATIVA` (`code: INATIVA`) e `RASCUNHO` (`code: RASCUNHO`), além das recusas já existentes (sem escopo, chave legada, inexistente).
3. Calcula o diff (`antes` vs. composição recebida) **antes** de escrever.
4. Numa única transação: aplica `FaseMacro` (upsert/delete), e — só quando a composição muda de fato (fase adicionada/removida/reordenada) — incrementa `MacroWorkflow.versao` e congela `MacroWorkflowVersao`.
5. **Fora** da transação de composição: se houve fase **nova e obrigatória** (`required && !conditional`), `enqueueReconciliacaoFaseMacro` registra 1 `DomainOutbox` por (processo em andamento × fase nova), com `chaveIdempotencia = fase.macro.reconciliar::{processoId}::{phaseKey}::v{versaoNova}`. Publicar não processa nenhum processo dentro da requisição — só registra o trabalho.
6. O outbox-dispatcher (`processarOutbox`, tipo `fase.macro.reconciliar`) drena, um processo por vez: chama `materializarExecucaoDaFase({ fonte: "RECONCILIACAO" })` — o mesmo materializador canônico único já usado por avanço/reabertura/movimentação manual. Falha num processo propaga (outbox volta a PENDENTE) e não afeta os demais.

Fases **condicionais** novas não geram outbox automático — a aplicabilidade delas é decisão de negócio do materializador no momento em que a fase é alcançada, não desta fila.

## 5. Por que isto não exige mexer em `Processo.faseAtualKey`

`phase-advance.ts::carregarContexto()` já lê `MacroWorkflow.fases` **ao vivo**, a cada chamada — não existe cópia congelada por processo da sequência. Uma fase nova em `FaseMacro` já fica visível a qualquer `advance()`/`movePhaseManual()` daquele tipo de processo assim que a transação de composição comita. O que faltava não era "fazer o processo enxergar a fase nova" — era (a) materializar a obrigação dela nos processos que já passaram por onde ela cairia, e (b) impedir que "já passei daquela posição" fosse confundido com "já cumpri aquela obrigação".

## 6. Obrigação retroativa — "posição atual" ≠ "obrigação cumprida"

`calcularObrigacoesRetroativasPendentes(processoId, fases, faseAtual)` (`src/lib/motor/reconciliar-fase-macro.ts`): entre as fases obrigatórias e não-condicionais em ordem ≤ à posição atual, quais não têm nenhuma `PhaseWorkflowInstance` com status `CONCLUIDO` ou `NAO_APLICAVEL`. Cobre tanto "reconciliação ainda não rodou" quanto "rodou, materializou, ninguém concluiu" — as duas são a mesma pendência do ponto de vista de "pode finalizar?".

Consumida em `phase-advance.ts::advance()`, **especificamente na transição para `finalizado`** (chave canônica, nunca rótulo) — escopo deliberadamente restrito à finalização, não a todo avanço intermediário, para não alterar nenhum comportamento de avanço já em produção. Código de rejeição novo: `OBRIGACAO_RETROATIVA_PENDENTE`.

Generalizar o gate para todo avanço intermediário (não só a entrada em `finalizado`) é um próximo passo natural e de baixo risco, deixado fora desta entrega.

## 7. Catálogo de efeitos — correção

`emissao_retificada` → `emissao_documental_retificada` (a chave real). `efeitosDaFase()` deixa de cair em "sem competência declarada = tudo liberado": **ausência de `efeitosPermitidos` grava `[]`, sempre** — nenhuma fase "pode tudo" por omissão, nem por herança de competência, nem por chave não reconhecida. `COMPETENCIA_PADRAO_DA_FASE` deixa de ser consultada em runtime; vira só a referência documentada de onde vieram os valores do backfill. Nova função `efeitosPorCompetenciaPadrao(phaseKey)` — uso exclusivo de migração/teste, nunca do runtime — para quem precisa computar "o que esta fase canônica deveria poder fazer" fora da execução real.

`scripts/backfill-catalogo-fase-revisao.mjs` grava `efeitosPermitidos` explícito nas 7 fases que estavam `null`, com os valores derivados de `COMPETENCIA_PADRAO_DA_FASE` (dry-run por padrão; nunca aplicado a produção sem `--aplicar --prod` + `EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1`).

## 8. Legado/teste — inativação, nunca exclusão

O mesmo script marca `status = INATIVA` (+ `ativo = false`) em `teste_fase`, `TESTEVIS_fase` e `transcricoes` — sem apagar a linha, sem tocar em nenhuma referência histórica. Achado real em produção: 6 processos de teste visual (`[TESTE VISUAL] ...`, criados por `scripts/dados-controlados-teste-visual.ts`, `tipoProcessoMotorId: null`) têm hoje `faseAtualKey = 'TESTEVIS_fase'`. Nenhum `MacroWorkflow` real referencia essas 3 chaves — inativar o cadastro não afeta a operação deles, e `avaliarAptidaoDaFase` agora recusa (`INATIVA`) que voltem a ser ofertadas numa composição nova.

## 9. Catálogo de escopos e efeitos

Escopo: `EscopoExecucao` (`PROCESSO`/`PESSOA`/`NECESSIDADE`/`DOCUMENTO`), inalterado — ver §2. Efeitos: `CATALOGO_DE_EFEITOS` (13 chaves), inalterado em conteúdo; a mudança foi só na regra de resolução (§7).

## 10. Testes

`scripts/catalogo-fases-reconciliacao.test.ts` (26 verificações, contra o banco de teste local): correção do catálogo de efeitos isolada; publicação registra outbox idempotente só para processos em andamento; reconciliação materializa a fase nova sem tocar `faseAtualKey` nem as tarefas/instâncias já existentes; reconciliar duas vezes não duplica; obrigação retroativa bloqueia `advance()` para `finalizado` com o código correto; concluir a obrigação libera a finalização; o processo termina com o **mesmo id** do início ao fim, com fase_a/fase_b/fase_x preservadas. `scripts/sete-passos-operacionais.test.ts` e `scripts/cadastro-canonico.test.ts` foram ajustados (uso de `efeitosPorCompetenciaPadrao` em vez de depender do fallback antigo de `efeitosDaFase`) e voltam a passar nos pontos relativos a efeitos/competência.

## 10.1 Continuação (mesmo dia) — alteração, inativação, reconciliação geral

Extraído `src/lib/motor/catalogo-fase-revisao.ts` (`publicarRevisaoCatalogoFase`), usado tanto pela rota `PUT /api/gerenciamento/catalogo-fases/[id]` quanto pelos testes — a mesma lógica de diff/snapshot, nunca uma segunda cópia. `CatalogoFase.status` passa a ser mantido em sincronia com `ativo` em toda escrita (criação e edição); `status` é a fonte, `ativo` é compatibilidade de leitura. Editar/inativar uma fase agora congela `CatalogoFaseRevisao` sempre que um campo relevante muda de verdade (nunca em save-sem-mudança). Criação também semeia a revisão 1.

`phaseKey` informado manualmente na criação passa pelo mesmo `slug()` do caminho automático — fecha a brecha concreta que deixou `TESTEVIS_fase` nascer com maiúsculas inconsistentes.

**Reconciliação generalizada**: o gatilho de publicação do Workflow Macro (`PUT /workflow-macro/[id]`) agora detecta não só fase **adicionada**, mas também fase **já presente que se torna `required && !conditional`** (antes condicional ou opcional) — mesma fila, mesma idempotência, mesmo materializador. Empiricamente comprovado (teste §3 de `catalogo-fases-alteracao-inativacao.test.ts`): publicar essa mudança com o processo ainda em andamento enfileira e materializa a obrigação sem mover `faseAtualKey`.

**Fase removida da composição**: não precisou de código novo — o desenho já é correto por construção. `FaseMacro` é lido AO VIVO (nunca copiado por processo), e nada no reconciliador ou no materializador jamais deleta uma `PhaseWorkflowInstance`. Remover uma fase da composição faz duas coisas, automaticamente: (a) instâncias já materializadas continuam existindo, intactas; (b) `calcularObrigacoesRetroativasPendentes` para de cobrá-la, porque ela não está mais na lista viva de fases. Provado em teste.

**Processo já `finalizado` fica FORA da reconciliação automática** — decisão deliberada, não lacuna. `enqueueReconciliacaoFaseMacro` só alcança processos com `faseAtualKey ≠ 'finalizado'`. Reabrir uma obrigação num processo já fechado é decisão de reabertura explícita (mecanismo já existente, `reopenPhase`), não pode ser efeito colateral automático de uma publicação não relacionada — isso seria exatamente o tipo de mutação "invisível" que a REGRA MASTER proíbe, na direção oposta.

**Alterar o cadastro depois de uma fase já concluída não reescreve nada**: provado em teste — mudar `label`/`efeitosPermitidos` de uma `CatalogoFase` cujo `phaseKey` já tem `PhaseWorkflowInstance` `CONCLUIDO` em algum processo não altera essa instância (id, status, ciclo idênticos antes/depois).

**`movePhaseManual` continua fora do gate de obrigação retroativa** — decisão deliberada, mesma família do `forceAdvance` (bypass documentado, permissão exclusiva `processos.moverFaseManual`, exige justificativa+motivo, auditoria tripla). O gate protege o fluxo `advance()` normal; a movimentação manual do Admin é o escape hatch já existente e continua sendo.

## 11. Riscos remanescentes / próximos passos

- ~~Reconciliação hoje cobre fase obrigatória nova~~ — RESOLVIDO nesta continuação (§10.1): alteração/inativação de `CatalogoFase` tem revisão própria; fase existente que se torna obrigatória entra no mesmo caminho de reconciliação de fase nova; remoção da composição preserva instância e para de cobrar obrigação futura, sem código extra (efeito do design já ser live-read).
- O gate de BLOQUEIO de obrigação retroativa continua restrito à entrada em `finalizado` — decisão deliberada, não lacuna: achado empírico em produção (leitura, 20/09/2026) mostra o único processo v2 real hoje (`Grisotto`, id 621) com uma instância de `genealogia` ainda `ATIVO` mesmo já estando em `emissao_documental` — plausivelmente trabalho paralelo legítimo (genealogia é cardinalidade NECESSIDADE, várias obrigações concorrentes), não um bug. Generalizar o bloqueio para todo `advance()` intermediário, sem primeiro auditar caso a caso o que já está "em aberto" em produção, arriscaria bloquear progresso legítimo. Fica como próximo passo, condicionado a essa auditoria.
- `movePhaseManual` (movimentação manual do Admin) não passa pelo gate de obrigação retroativa — mesma família de exceção documentada que `forceAdvance` já tinha para `calcularPendencias`: bypass deliberado, com justificativa+motivo+auditoria tripla obrigatórios, não uma lacuna.
- Validadores de publicação da lista completa de 12 bloqueios do mandato (dependência circular, fase obrigatória inalcançável, cardinalidade incompatível com escopo, ausência de estratégia segura de reconciliação) não foram todos implementados — os já existentes (chave duplicada, sem escopo, chave legada/inativa/rascunho, efeito inexistente/fora de competência) continuam ativos e cobrem o núcleo de segurança.
- Nenhuma tela (Gerenciamento, Workflow Macro visual, Central Operacional, indicadores) foi alterada nesta entrega. Identificada a violação concreta da Regra 6 (`WorkflowMacroTrilha.tsx`'s `PROCESS_PHASES` hardcoded + casamento por label em `ProcessoCentralOperacional.tsx`), mas NÃO corrigida: é um componente visual já estilizado e em produção, sem verificação em navegador disponível nesta sessão para provar ausência de regressão — risco de regressão visual silenciosa maior que o benefício de uma correção não verificada. Fica como próximo passo explícito, com verificação visual real como pré-requisito.
- Dois achados incidentais, fora do escopo desta entrega, não corrigidos: `lib/operacional/obrigacao-atribuicao.ts::reconciliarObrigacaoDeAtribuicao` não está declarado no inventário de `scripts/reconciliadores-idempotentes.test.ts`; 5 `PhaseInternalWorkflow` órfãos em produção (`pae_ret`, `pju_ret`, `ci_fase_inventada`, `retificacao`, `spo_retificacao`) sem `FaseMacro` correspondente.

## 12. O que NÃO foi feito

Nenhuma migration foi aplicada em produção. Nenhum backfill foi aplicado em produção. Nenhuma configuração foi publicada em produção. Tudo foi implementado e testado contra `discovery_test` (banco local).
