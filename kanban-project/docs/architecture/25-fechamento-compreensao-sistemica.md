# 25 — Fechamento de incertezas + contraprova adversarial

Consolidado em 13/09/2026. Fecha, até o limite do demonstrável, as
lacunas deixadas pelo doc
[24](24-prova-compreensao-arquitetural.md). **Diagnóstico apenas — nada
foi alterado, nenhuma flag tocada, nenhuma migration, nenhuma escrita.**
5 frentes de fechamento + trabalho de síntese/teste adversarial feito
diretamente por mim (sem nova pesquisa, conforme exigido nas Partes 14-15
do mandato).

---

## PARTE 1 — Inventário exato das lacunas (extraído do doc 24 integral, não do resumo)

| ID | Tema | Afirmação/pergunta | Classificação em 24 | Por que não foi determinada | Evidência que faltava |
|---|---|---|---|---|---|
| ND1 | Financeiro | `FINANCEIRO_DUAL_WRITE` ligada em produção? | NÃO DETERMINADO | env var de produção não visível | acesso a config runtime do Vercel |
| ND2 | Financeiro | Existe reconciliação sincronizando `ObrigacaoEconomica` quando Receita/Custo é cancelado depois? | NÃO DETERMINADO | não investigado a fundo | leitura completa das 3 rotas de cancelamento/estorno |
| ND3 | Financeiro | Precedência exata preço-global × override-local | NÃO DETERMINADO | resolvedor de precedência não lido | leitura de `matriz-economica.ts`/override |
| ND4 | Permissões/Motor | Ausência de ciclo de vida de usuário — consequência prática ou lacuna sem incidente? | NÃO DETERMINADO | não investigado | rotas de `Usuario`, schema de FK |
| ND5 | Documental | Timing/gatilho exato da reconciliação de necessidades pós-arquivamento de regra | NÃO DETERMINADO | não investigado | frequência/gatilho do job |
| ND6 | Documental/Financeiro | `documentTypeCode`/`SolicitacaoDocumento.canal`/campos de preço legado: write-only/fallback ou decisão real? | NÃO DETERMINADO | leitura de uso não fechada | grep de leitura decisória |
| ND7 | Financeiro/Cadastro | Contagem real `Fornecedor` × `OrgaoProtocolo+FORNECEDOR` | NÃO DETERMINADO | evitou-se query de produção | contagem real |
| ND8 | Interface | `/financeiro` × `/financas/*` duplicados ou legítimos? | NÃO DETERMINADO | rotas não comparadas | leitura das duas árvores de rota |
| ND9 | Processo/Fase | Comportamento de "processo nasce em fase avançada" | NÃO DETERMINADO | `criarProcessoV2` não relido nesta rodada | leitura da função |
| ND10 | Eventos/Outbox | `phase.completed` (outbox, sem efeito) — resíduo ou propósito? | NÃO DETERMINADO | consumidor não confirmado | grep + dado real |
| ND11 | Transversal | Inversão histórico/notificação decidindo negócio em arquivo não auditado | NÃO DETERMINADO | busca não exaustiva possível | impossível provar ausência total |
| C7 | Documental | `documentTypeCode` — fallback ou decisão real? | ponta a investigar | uso em 20 arquivos não checado 1 a 1 | leitura dos pontos de decisão |
| C8 | Documental | `SolicitacaoDocumento.canal` × `.canalOperacionalId` divergem? | ponta a investigar | escrita não rastreada | leitura do criador real |
| C9 | Financeiro | Campos de preço legado influenciam cálculo real? | ponta a investigar | resolvedor de preço não lido | leitura de `pricing-resolver.ts` |
| C10 | Documental | `Divergencia`: campo textual ainda lido como decisório? | ponta a investigar | model não relido | leitura do model + usos |

Nenhuma lacuna adicional material foi encontrada além destas 15 — não
inventei itens para preencher uma meta.

---

## PARTE 2-12 — Fechamento individual

### ND1 + PARTE 3 — `FINANCEIRO_DUAL_WRITE`

**CONFIRMADO PELO CÓDIGO**: existe (`lib/financeiro/dual-write.ts:12`,
`process.env.FINANCEIRO_DUAL_WRITE === '1'`), default OFF (ausente de
`.env`/`.env.example`/`vercel.json`). Custo é **sempre** espelhado
(não depende da flag — chamado por `outbox-dispatcher.ts`/`motor/executor.ts`).
Receita só é espelhada com a flag ligada.

**Achado novo, não mapeado antes**: existe uma SEGUNDA flag,
`FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA` (`lib/financeiro/legado-guard.ts`)
— o mecanismo de corte já construído para bloquear escrita no legado após
uma data de corte, guardando 12 rotas reais (incluindo as 4 de
cancelar/estornar). Também default OFF. **O interruptor de convergência
já existe no código; só não foi acionado.**

**Valor efetivo em produção**: GENUINAMENTE NÃO DETERMINÁVEL COM AS
EVIDÊNCIAS DISPONÍVEIS — env vars de produção (Vercel) não são visíveis
neste ambiente de leitura. Não é falta de esforço; é ausência de acesso.

CONFIANÇA: alta (mecanismo); nula por desenho (valor efetivo em prod).

### ND2 + PARTE 4 — Receita/Custo × ObrigacaoEconomica

**CONFIRMADO PELO CÓDIGO**: **NÃO existe reconciliação periódica** —
existem 3 rotas reais de cancelamento/estorno, e só 1 das 3
(`cancelamento-avancado.ts`) sincroniza corretamente com
`ObrigacaoEconomica` (localiza o espelho por `origemTipo`/`origemId` e
ajusta valor/Ledger). As outras 2 (`cancelamento-estorno.ts` legado,
`acoes/cancelar.ts` V3-Receita) deixam o espelho desatualizado quando
usadas. `excluir-receita.ts` trata corretamente o caso "origem não existe
mais" (marca `arquivadaEm` em vez de deixar pendurado) — parte da
correção já existe, só não está aplicada uniformemente.

**Existe hoje uma única source of truth financeira? NÃO.** Prova
concreta: `lib/financeiro/leitura/visao-geral-processo.ts` lê `Receita`/
`Custo` **e** `ObrigacaoEconomica` na mesma consulta — os dois modelos
são consumidos ativamente pela mesma tela, não é leitura histórica de um
lado morto. CONFIRMADO PELO CÓDIGO, confiança alta.

### PARTE 5 — Processo 513 / R$ 4.800 fantasmas

**HISTÓRICO CONFIRMADO**, confiança alta, por triangulação interna forte:
"processo 513" ("Abellan", 07-08/08/2026) aparece em **15+ arquivos
independentes** (guards, scripts de reconciliação, comentários de
causa-raiz), todos citando os mesmos IDs reais (requerentes 134/135/137,
Receita 180, obrigações 16/18, "16 Tarefas Localizar registro órfãs"). A
causa estrutural mais estreita (mirror sem `personId`) já foi corrigida
para novos espelhos; **a causa estrutural mais ampla — cancelamento não
sincronizando em 2 de 3 rotas — continua possível hoje**, não foi
fechada.

### ND4 + PARTE 6 — Usuário inativo com operações abertas

**CONFIRMADO PELO CÓDIGO E PELO SCHEMA**: `Usuario` não tem campo
ativo/inativo — "inativar" não existe como operação; só existe `DELETE
/api/usuarios/[id]` (hard delete real, guard só contra auto-exclusão de
admin único). Todas as 9 FKs de `responsavelId`→`Usuario` são `SET NULL`
(confirmado no `baseline.sql`), incluindo `Tarefa`/`Documento`/`Protocolo`/
`StepInstance`, **independente do status operacional**.

**Mitigação parcial, também confirmada**: `proximo-acontecimento.ts`
trata `responsavelId==null` como motivo de risco
(`SEM_RESPONSAVEL_PARA_PROXIMA_ACAO`) **só quando a Tarefa não está em
espera** — uma Tarefa `AGUARDANDO_TERCEIRO` cujo responsável foi excluído
**não é sinalizada como em risco por falta de dono** enquanto continuar
esperando o terceiro (é tratada como legitimamente aguardando, não como
órfã). Só ao retornar da espera (`retomarDeEsperaNucleo`, sem popular
`responsavelId`) ela passaria a ser sinalizada. **Nenhuma notificação
proativa** confirmada avisando que um responsável foi excluído.

CLASSIFICAÇÃO: GAP REAL CONFIRMADO (ausência de lifecycle de usuário),
mitigação parcial e não desenhada especificamente para este caso.
CONFIANÇA: alta.

### ND5 — Timing da reconciliação de necessidades pós-arquivamento

**NÃO FECHADO NESTA RODADA** — nenhuma das 5 frentes de fechamento cobriu
especificamente este ponto (foi priorizado abaixo de itens de maior
risco). Permanece NÃO DETERMINADO, honestamente, não por impossibilidade
mas por escopo desta rodada.

### ND6 + C7/C8/C9/C10 + PARTE 8 — Campos "legado"

**C7 — `documentTypeCode`**: DESCARTADA COM EVIDÊNCIA. `documentTypeCode`
e `documentoTipoId` são escritos NA MESMA chamada
(`regras-documentais/route.ts:52-65`), sempre sincronizados — não há
janela de divergência. `documentTypeCode` é de fato a chave real usada
pelo motor (`materializar-genealogia.ts:193`). CLASSIFICAÇÃO: **ATIVO
CANÔNICO**. Achado lateral, não confirmado quanto à generalidade: se uma
regra aceita múltiplos tipos de documento, só o primeiro elemento de
`documentosAceitos` é de fato decisório no motor de elegibilidade.

**C8 — `SolicitacaoDocumento.canal` × `.canalOperacionalId`**:
**CONTRADIÇÃO CONFIRMADA, mais grave que a suspeita original.** O único
criador/atualizador real (`registrarSolicitacaoDocumento`) escreve
**somente** `canal` — nunca `canalOperacionalId`, em nenhum branch. O
campo declarado "identidade canônica" está estruturalmente **sempre
null** na prática; o campo declarado "legado, espelho derivado" é o único
de fato populado — o **inverso exato** da intenção documentada.
CLASSIFICAÇÃO: `canal` = ATIVO CANÔNICO (na prática); `canalOperacionalId`
= campo morto para esta entidade.

**C9 — campos de preço legado**: DESCARTADA COM EVIDÊNCIA. São um
fallback explícito e documentado (`pricing-resolver.ts:14-18`: "se nada
casar na TabelaValor, cai no fallback"), e o motor de custo real
(`matriz-economica.ts:109`) recusa explicitamente esse fallback ("sem
zero silencioso"). Precedência clara: Tabela de Preços sempre primeiro.
CLASSIFICAÇÃO: **SOMENTE COMPATIBILIDADE**.

**C10 — `Divergencia`**: DESCARTADA COM EVIDÊNCIA, e a premissa original
estava imprecisa — os dois comentários "preservado" pertencem ao model
`RetificacaoPacote` (campos de texto legado), não a `Divergencia` (que é
ativo, canônico, 8 rotas reais de uso). `RetificacaoPacote.divergenceIds`
tem zero leituras — CLASSIFICAÇÃO: `Divergencia` = **ATIVO CANÔNICO**;
`RetificacaoPacote.divergenceIds` = **CÓDIGO MORTO**.

**Resumo das 4 pontas**: 1 CONTRADIÇÃO CONFIRMADA (C8), 3 DESCARTADAS
(C7, C9, C10). Nenhuma ficou genuinamente indeterminável.

### ND7 — Contagem real Fornecedor × OrgaoProtocolo

**CONFIRMADO PELO BANCO/DADO REAL** (produção, leitura): `Fornecedor` = 1
registro. `OrgaoProtocolo` com `FuncaoOrganizacao=FORNECEDOR` = 254
registros. A disparidade confirma com dado real a contradição já
registrada — na prática, quase tudo que é "fornecedor" vive em
`OrgaoProtocolo`.

### ND8 — `/financeiro` × `/financas/*`

**DESCARTADO COM EVIDÊNCIA**: são dois módulos reais e distintos, não
duplicação. `/financas/*` é uma camada operacional mais simples
(contas-pagar/receber/fluxo de caixa/fornecedores), com UI própria lendo
`/api/fornecedores` (a tela real do model `Fornecedor` — explica por que
ele ainda existe apesar de só ter 1 registro real: tem tela dedicada,
pouco usada). `/financeiro/*` é o módulo corporativo geral (Dashboard/
Tesouraria/Central/V3/Ledger). Achado lateral: a tela de cadastro de
`Fornecedor` está incompleta (`// TODO: Implementar criação de
fornecedor`) — consistente com só ter 1 registro real.

### ND9 + PARTE 7 (preço) — respondidas juntas por uma mesma frente

**ND9 — processo nasce em fase avançada**: **CONFIRMADO PELO CÓDIGO**:
`criarProcessoV2` sempre usa `primeiraFasePorOrdem` — não existe caminho
de criação direta numa fase não-inicial. "Nascer em fase avançada" só é
alcançável por criar na fase 1 e depois mover manualmente
(`moverFaseManual`). O QUE CONTINUA NÃO PROVADO: o que acontece com a
obrigação da fase 1 nesse cenário composto (criar+mover) — fora do
escopo desta rodada.

**PARTE 7 — preço global × override local**: **DESCARTADO COM
EVIDÊNCIA — a pergunta pressupõe um mecanismo que não existe.** O único
"override" real (`PlanilhaCelulaOverride`) é puramente de exibição/
negociação na Planilha Documental, e nunca alimenta um lançamento
financeiro real (`matriz-economica.ts` tem zero referência a override).
Fórmula real da Planilha: `valorEfetivo = override ?? valorBase`,
recalculada a cada leitura (nunca congelada). Para o Ledger real
(`ObrigacaoEconomica`), o preço é sempre congelado no lançamento — não
existe "recálculo" nem "override" neste nível. Não há ambiguidade de
precedência porque as duas coisas não se cruzam.

### PARTE 9 — Duas implementações de criação de Tarefa

**Achado que refina (não invalida) a contradição do doc 24**: as duas
funções (`garantirTarefaDePasso`, `materializarTarefaOperacional`)
**compartilham o mesmo primitivo de identidade**
(`identidadeDaUnidade`/`chaveDaUnidade`) — a proteção contra duplicação
de DADO é real e sólida (constraint `@unique` no banco), não coincidência
frágil.

A duplicação real é de **lógica de orquestração e efeitos colaterais**:
`garantirTarefaDePasso` (5 callers reais, caminho síncrono) grava
`WorkflowEvento` + `DomainOutbox`; `materializarTarefaOperacional` (1
único caller, o job de reconciliação, rede de segurança) grava só
`LogAuditoria` — **uma Tarefa criada pelo reconciliador tem histórico/
evento mais pobre** que uma criada pelo caminho normal. Os dois
comentários dos arquivos se autodeclaram "a única porta"/"canônico" —
contradição de PROSA, confirmada, mas sem risco de dado duplicado.

**CONCLUSÃO FINAL**: nem "dois caminhos legítimos" nem "concorrência
perigosa de dado" — é **caminho síncrono canônico + rede de segurança,
protegidos contra duplicação de dado pelo mesmo primitivo, com
divergência real de observabilidade (evento/outbox ausente num dos
caminhos)**.

### PARTE 10 — DELETE Processo e permissão

**CONTRADIÇÃO CONFIRMADA, com risco reavaliado para CRÍTICO**:
`processos.excluir` não está em `PERMISSOES_EXCLUSIVAS` nem em
`PERMISSOES_OPT_IN` — é permissão comum, herdada por qualquer perfil com
`TODAS_PERMISSOES` (Administrador, Gerente); só Assistente/Estagiário a
desligam. Overrides reais (banco de teste, leitura): 3 usuários reais,
**zero** overrides tocando essa permissão — não há alargamento adicional
hoje. Frontend: `window.confirm` genérico ("tem certeza?"), **sem nenhum
preview de impacto** (nada sobre financeiro/histórico/família
compartilhada).

**RISCO EFETIVO FINAL: CRÍTICO** — soma de permissão comum + zero preview
real + zero guard de impacto no backend (já confirmado nas rodadas
anteriores).

### PARTE 11 — `phase.completed` / outbox

**CONFIRMADO PELO CÓDIGO E PELO DADO REAL — comportamento intencional,
não é gap.** `entrega-transversal-guard.test.ts:39` testa e EXIGE que
`phase.completed` esteja em `TIPOS_SEM_EFEITO` ("arquivado, não
acumula") — guardado por teste, não resíduo acidental. Dado real
(produção, leitura): **28 registros reais** com payload rico
(`eventId`/`idempotencyKey`/`phaseInstanceId`/`transitionReason`) —
desenhado como registro histórico completo. Reabertura/retrocesso de
fase não gera novo `phase.completed` (só CONCLUSÃO de fato emite), então
não há evento "órfão de contexto" acumulando.

**Este achado FECHA uma preocupação, não abre uma nova** — o item estava
listado como incerteza, e a investigação o resolveu a favor do sistema.

---

## PARTE 13 — Validação cruzada com dados reais (resumo)

| Domínio | Regra de código | Evidência de ocorrência real |
|---|---|---|
| Fornecedor/terceiro | `Fornecedor` deveria convergir para `OrgaoProtocolo` | 1 vs 254 registros reais — confirma a assimetria na prática |
| Financeiro dual-write | Duas cadeias coexistem | `visao-geral-processo.ts` lê as duas na mesma consulta — confirma coexistência ATIVA, não teórica |
| Processo 513 | Incidente de mirror sem provenance | 15+ arquivos de código citam os mesmos IDs reais (requerentes 134/135/137, obrigações 16/18) |
| Outbox `phase.completed` | Deveria ser arquivado sem efeito | 28 registros reais confirmam o padrão, nenhum acumulando indevidamente |
| Usuário/Tarefa | `responsavelId` vira null ao excluir usuário | confirmado pelo schema (9 FKs `SET NULL`), não testado com um registro específico nesta rodada (diferença entre regra de código e ocorrência específica registrada aqui) |
| Permissão DELETE Processo | Sem override adicional | 3 usuários reais, zero override tocando `processos.excluir` |

Diferenciação mantida em todos os itens: regra de código (sempre
confirmada) vs evidência de ocorrência real (confirmada em 4 de 6; nos
outros 2, a regra de código é forte o bastante para não exigir
generalização de um único registro).

---

## PARTE 14 — Teste adversarial (10 cenários, sem nova pesquisa de documentação — só o modelo consolidado + confirmação pontual quando necessário)

**Cenário 1 — Pessoa com necessidade/documento validado/tarefa concluída/obrigação liquidada, removida por ação administrativa legítima.**
ANTES: `fatosProtegidos` conteria `ARQUIVO_OFICIAL` + `LANCAMENTO_CONTABIL`/`PAGAMENTO_RECEBIDO`. COMANDO: `removerPessoaDaArvore`. SOURCE OF TRUTH AFETADA: nenhuma fisicamente — `podeHardDelete=false` recusa o hard delete, oferece `DESATIVAR` (`removidaEm`). CONSEQUÊNCIA DIRETA: Pessoa sai do roster ativo, tudo preservado. 2ª/3ª ordem: projeções de árvore recalculam para excluí-la da visão ativa; nada mais reage. FINANCEIRO: intocado. DOCUMENTOS: intocados. MOTOR: Tarefa permanece `CONCLUIDO_RECEBIDO`. EVENTOS/HISTÓRICO: `LogAuditoria` registra a desativação. PROJEÇÕES: recalculam. RISCO: nenhum — comportamento correto e já provado. ESTADO FINAL: Pessoa soft-desativada, zero perda.

**Cenário 2 — Daniela (AGUARDANDO_TERCEIRO, follow-up amanhã) é excluída hoje; ninguém altera a Tarefa manualmente.**
COMANDO real disponível: `DELETE /api/usuarios/[id]` (não existe "inativar"). SOURCE OF TRUTH AFETADA: `Tarefa.responsavelId → NULL` (SetNull). CONSEQUÊNCIA DIRETA: a Tarefa continua `AGUARDANDO_TERCEIRO`, sem dono. **Achado fino desta rodada**: como o motivo de risco por falta de responsável só se aplica a Tarefa "não encerrada e não em espera", **enquanto ela seguir aguardando o terceiro, o sistema NÃO a sinaliza como órfã** — legitimamente, porque aguardar não depende de ação interna. Amanhã, quando o retorno chegar e `retomarDeEsperaNucleo` rodar, o status muda para `blockedPreviousStatus ?? 'EM_ANDAMENTO'` — mas `responsavelId` continua NULL. **SÓ NESTE MOMENTO** ela passaria a acionar `SEM_RESPONSAVEL_PARA_PROXIMA_ACAO` e cair na fila `semResponsavel`. Nenhuma notificação proativa avisa alguém que isso vai acontecer antes de acontecer. **O QUE O SISTEMA REAL FAZ HOJE**: nada até o retorno chegar; depois, reaparece administrativamente (fila sem responsável), mas por efeito colateral, não por desenho. **O ESTADO CANÔNICO CORRETO seria**: sinalizar e notificar um admin/gerente NO MOMENTO em que o responsável de uma operação ativa (mesmo em espera) é removido do sistema — isso não existe hoje.

**Cenário 3 — override local R$700, preço global R$500→R$900, "recálculo financeiro".**
Este cenário **não tem correspondente real** (achado da Parte 7): overrides nunca alimentam lançamento financeiro real. Para a Planilha Documental (única onde overrides existem): `valorEfetivo = override ?? valorBase`, recalculado a cada leitura — R$700 continua prevalecendo até ser removido, independente da mudança do preço global. Para o Ledger real: o valor já foi congelado no lançamento original e não muda nunca, com ou sem "recálculo" (que não existe como operação). **Nenhum caminho real usa mais de uma fórmula** — não há contradição aqui, só uma pergunta que presumia um mecanismo inexistente.

**Cenário 4 — Custo (legado) + ObrigacaoEconomica (V3) do mesmo serviço; cancelamento atualiza só um lado.**
Se o cancelamento passar por `cancelamento-estorno.ts` (legado) ou `acoes/cancelar.ts` (V3-Receita) — **confirmado que nenhum dos dois sincroniza** com `ObrigacaoEconomica`. TRACE: `Custo.status→CANCELADO`, mas `ObrigacaoEconomica` permanece com seu status/estadoCusto anterior. RELATÓRIOS: `visao-geral-processo.ts` (lê os dois) mostraria uma contradição visível — Custo cancelado, Obrigação ainda ativa. INDICADORES/PROJEÇÕES V3: continuam contando o custo como válido (comentário do próprio `dual-write.ts`: "ObrigacaoEconomica é a fonte lida pelas telas V3"). PAGAMENTOS: um fluxo de pagamento que leia só o lado V3 poderia processar/esperar pagamento de algo formalmente cancelado no legado. HISTÓRICO: `LogAuditoria` registra o cancelamento no lado legado; nada audita que o espelho ficou desatualizado. **Isto é exatamente a mesma classe do incidente do Processo 513, agora confirmada como possível também por cancelamento normal, não só por exclusão.**

**Cenário 5 — concorrência entre as duas implementações de criação de Tarefa para a mesma obrigação.**
Como ambas calculam a `chaveIdempotencia` pelo MESMO primitivo (`identidadeDaUnidade`), a constraint `@unique` do banco serializa a corrida — **duplicação de DADO não é possível**. Mas o resultado observável diverge conforme quem "ganha": se `garantirTarefaDePasso` vence, a Tarefa nasce com `WorkflowEvento`+outbox completos; se `materializarTarefaOperacional` (reconciliador) vence, nasce só com `LogAuditoria` — **uma Tarefa legítima e única pode ter rastro de evento incompleto dependendo puramente do timing da corrida**, não da lógica de negócio.

**Cenário 6 — Processo A e B compartilham árvore/família; A é excluído.**
NÃO USANDO FK COMO RESPOSTA AUTOMÁTICA: `Documento` não tem `processoId` (confirmado no doc 24) — pertence à Pessoa, que pertence à Árvore, compartilhada com B. Excluir só A (sem tocar a Árvore, já que `outrosProcessos>0` com B vivo) **não cascateia sobre Pessoa/Documento/Arvore** — eles são corretamente COMPARTILHADOS e sobrevivem. **EXCLUSIVO de A, some**: Tarefas de A, `PhaseWorkflowStepInstance`/`WorkflowEvento`/`PhaseAdvanceLog` de A, `SolicitacaoDocumento` com `tarefaId`/`processoId`=A, `AnexoProcesso` de A, e **qualquer `ObrigacaoEconomica`/`NecessidadeDocumental` com `processoId=A`, mesmo que PAGA/já materializada** (a mesma cascata G1 já conhecida — aqui ela reaparece mesmo sem tocar a árvore, pois é direta). **GENUINAMENTE NÃO DETERMINÁVEL por código, decisão de negócio**: se uma Necessidade/Obrigação nasceu especificamente para A mas o Documento subjacente (que sobrevive, é da Pessoa) também serviria para satisfazer um requisito equivalente em B, o sistema não tem hoje o conceito de "realocar" essa obrigação — ela simplesmente desaparece com A, e B teria que materializar a sua própria do zero. Não há como provar por código qual é o comportamento "certo" aqui; é regra de negócio não codificada.

**Cenário 7 — certidão invalidada após já ter participado da conclusão de uma fase.**
O efeito `INVALIDATE_DOCUMENT` só toca `Documento.status`+observação — **não foi confirmado nesta prova inteira, em nenhuma rodada, se isso reabre automaticamente o Step/Fase que já usou esse documento como evidência**. INFERÊNCIA (não confirmada): se uma transição de fase FUTURA acontecer depois dessa invalidação, o invariante de `phase-advance.ts` (compara obrigações antes/depois) poderia capturar uma regressão de status da Necessidade associada e bloquear o avanço — mas isso depende de `atenderNecessidade` de fato regredir o status ao invalidar o documento, o que **não foi verificado em nenhuma frente desta sessão**. Rotulo honestamente: **NÃO DETERMINADO**. O sistema REAL: efeito local no Documento, sem propagação confirmada. O modelo canônico exigiria que uma fase já "100% concluída" não continuasse parecendo concluída depois que sua evidência foi invalidada — isto é um ponto real a investigar antes de qualquer confiança operacional nesse cenário específico, e fica registrado como o achado mais importante deste teste adversarial.

**Cenário 8 — resposta de cartório chega antes do follow-up; a notificação falha.**
CONFIRMADO PELO CÓDIGO (princípio já provado nas Etapas 4/6, "notificação não controla fila"): a fila (`tarefa-projecoes.ts`) lê `Tarefa.statusTarefa`/`responsavelId` diretamente do banco — não depende de notificação ter sido entregue. Se `retomarDeEsperaNucleo` for de fato chamado (por registro manual do retorno, ou por algum gatilho automático) e a transação committar, a Tarefa reaparece na fila de Daniela **independente do sucesso da notificação**, porque notificação é sempre uma consequência à parte, nunca uma condição de leitura. Se minha resposta dependesse da notificação, estaria errada por desenho — e não depende.

**Cenário 9 — registro raiz removido; minutos depois um cron/materializador com referência lógica antiga roda.**
Mecanismos CONFIRMADOS com proteção: `avisarPrazosEAtrasos`/`avisarAcontecimentosOperacionais` (filtram por status não-terminal), outbox (claim atômico + `TIPOS_SEM_EFEITO`), `garantirTarefaDePasso` (só age sobre status atual do step), `materializarGenealogia` (nunca sobrescreve `dispensaManual`), `reconciliarTarefas` (nunca cancela Tarefa já trabalhada). **Caminhos SEM proteção confirmada**: nenhum encontrado ativamente nesta sessão inteira — mas a busca não cobriu literalmente todos os jobs possíveis do sistema; declaro isso como limite honesto da investigação, não como garantia de zero risco.

**Cenário 10 — fase avançada manualmente com obrigação antiga pendente; depois retrocedida.**
Avançar com obrigação antiga PENDENTE (não mudando, só continuando pendente) não é bloqueado pelo invariante — o invariante só reage a MUDANÇA inesperada de obrigação de outra fase, não à sua persistência. Retroceder (REENTRADA): a obrigação pendente permanece exatamente como estava (não é forçada, não é apagada); Tarefa/Workflow reagem via REENTRADA (herdam terminal-positivo quando já concluído, senão continuam abertos); Documento intocado; Progresso recalcula refletindo a pendência antiga ainda ali; fase ativa vs fase visualizada seguem separadas (memória `fase-visualizada-diferente-de-fase-ativa`); Histórico registra ambas transições como `SUPERSEDER` (nunca como falsa conclusão); Notificações: nenhuma notificação de "fase concluída" dispara na reabertura, porque `encerramento` não foi `CONCLUIR`.

---

## PARTE 15 — Teste de previsão sem pesquisa

**As 5 perguntas** (formuladas agora, cruzando ≥3 domínios cada):

1. Se eu invalidar um Documento que já satisfez uma `NecessidadeDocumental` (`ATENDIDA`) e depois uma fase FUTURA tentar avançar, o invariante de obrigações de `phase-advance.ts` bloqueia essa transição por causa da regressão implícita da Necessidade? *(documental, motor, invariante de fase)*
2. Se dois usuários tentam simultaneamente excluir e reatribuir o mesmo usuário responsável por uma Tarefa `AGUARDANDO_TERCEIRO`, existe alguma proteção de concorrência (lock/transação coordenada) entre as duas operações? *(usuário/permissões, motor operacional, concorrência)*
3. Se um Custo é cancelado pela rota legada (sem sincronizar `ObrigacaoEconomica`) e depois alguém tenta excluir o Documento associado, o guard de exclusão de Documento bloquearia essa exclusão por enxergar (via o espelho V3 desatualizado) uma obrigação "ainda ativa"? *(financeiro, documental, exclusão/integridade)*
4. Se `FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA` fosse ligada hoje, isso resolveria retroativamente a divergência já existente entre Receita/Custo e `ObrigacaoEconomica`, ou só impediria NOVA divergência? *(financeiro/flags, lifecycle, dado histórico)*
5. Se o motor de Saúde do Sistema já existisse (com as 66 verificações atuais) quando o incidente do Processo 513 aconteceu, ele teria detectado o problema antes de precisar de correção manual? *(financeiro, Saúde do Sistema/integridade, histórico)*

**Respostas SEM nova busca** (só o modelo consolidado):

1. SIM — bloquearia, porque o invariante compara obrigações de TODAS as fases antes/depois e reverte a transação inteira se qualquer uma regredir.
2. NÃO — não há lock/transação coordenada confirmada entre exclusão de usuário e reatribuição de Tarefa; é uma corrida real sem proteção.
3. SIM — o mesmo mecanismo (`fatosProtegidos`) que já lê `ObrigacaoEconomica` por `documentoId` para decidir se pode excluir um Documento veria a obrigação "viva" no espelho V3 e bloquearia, mesmo que o legado já tivesse cancelado.
4. Só impediria NOVA divergência — não reconcilia dado histórico já divergente, porque ligar uma flag não corrige registros existentes.
5. PROVAVELMENTE NÃO na forma atual, porque o motor de Saúde cobre orfandade referencial mas não cobre "source of truth concorrente" nem "risco financeiro pré-exclusão" — exatamente a categoria do incidente.

**Confrontação com código/dados** (sem alterar as respostas originais):

1. **PARCIALMENTE.** O mecanismo do invariante é real e confirmado (compararia obrigações e bloquearia SE houvesse regressão). Mas nenhuma frente desta sessão confirmou que invalidar um Documento realmente REGRIDE o status da Necessidade de `ATENDIDA` para outra coisa — isso é exatamente o NÃO DETERMINADO do Cenário 7 da Parte 14. Minha resposta presumiu uma causalidade (invalidação→regressão) que não está provada. **O que meu modelo mental tinha incompleto**: eu sabia que o invariante existe e reage a mudanças, mas não tinha fechado se a invalidação de documento É uma dessas mudanças.
2. **ACERTOU** — confirmado pelo fechamento desta rodada: não há `fatosProtegidos`-equivalente nem lock para `Usuario`, e a exclusão é um DELETE simples sem coordenação.
3. **ACERTOU** — confirmado por rodada anterior: `levantarFatosProtegidos` (`pessoa-ciclo-vida.ts`) de fato constrói `obrigacaoIds` a partir de `documentoId`, então um espelho V3 desatualizado (ainda "ativo") bloquearia uma exclusão que deveria ser permitida — um falso positivo real e coerente com a arquitetura confirmada.
4. **ACERTOU** — coerente com a natureza de uma flag de bloqueio de escrita (afeta só operações futuras) e com o fato confirmado de que não existe reconciliação retroativa automática.
5. **ACERTOU** — coerente com o gap G11 já registrado no doc 23 (Saúde do Sistema não cobre source-of-truth concorrente nem risco financeiro pré-exclusão).

**Resultado**: 4 ACERTOU, 1 PARCIALMENTE, 0 ERROU.

---

## PARTE 16 — Matriz de certeza final

| Domínio | Compreensão provada | Código | Dado real | Comportamento | Contradições abertas | Não determinados | Confiança |
|---|---|---|---|---|---|---|---|
| Cliente/Família/Árvore/Pessoa | Alta | ✅ | ✅ | ✅ | `Pessoa.arvoreId` Cascade (G2) | nenhum | 90% |
| Processo | Alta | ✅ | ✅ | ✅ | DELETE sem guard (G1), permissão desproporcional | obrigação de fase-1 em "nasce em fase avançada composta" | 85% |
| Fases/Workflow macro | Alta | ✅ | parcial | ✅ | nenhuma nova | timing exato de reconciliação pós-arquivamento (ND5) | 85% |
| Tarefa/Motor operacional | Alta | ✅ | ✅ | ✅ | dupla implementação de criação (efeito colateral, não dado) | nenhum | 90% |
| Prazos/SLA | Alta | ✅ | ✅ | ✅ | nenhuma (2 fontes é deliberado) | nenhum | 90% |
| Follow-up/EM_RISCO | Alta | ✅ | ✅ | ✅ | nenhuma | comportamento exato quando responsável excluído em espera (parcialmente fechado) | 80% |
| Eventos/Histórico | Alta | ✅ | parcial | ✅ | `WorkflowEvento` cascateia com Tarefa (tensão já registrada) | nenhum | 85% |
| Notificações | Alta | ✅ | ✅ | ✅ | nenhuma | nenhum | 90% |
| Outbox | Alta | ✅ | ✅ | ✅ | nenhuma (phase.completed confirmado intencional) | nenhum | 90% |
| Documental (Necessidade/Documento) | Alta | ✅ | ✅ | ✅ | `StepRequirement`×`ExigenciaEvidenciaEtapa` | efeito de invalidação sobre fase já concluída (Cenário 7) | 75% |
| Documentos/Versões/Arquivos | Alta | ✅ | ✅ | ✅ | nenhuma | nenhum | 90% |
| Financeiro V3 (Ledger) | Alta | ✅ | ✅ | ✅ | nenhuma nova | valor efetivo da flag em produção (irredutível) | 80% |
| Receita/Custo (legado) | Alta | ✅ | ✅ | ✅ | **coexistência ativa com V3, 2/3 rotas não sincronizam** | reconciliação retroativa se convergir (decisão de negócio) | 80% |
| Preços/Overrides | Alta | ✅ | não necessário | ✅ | nenhuma (premissa da dúvida original não existia) | nenhum | 90% |
| Fornecedor/OrgaoProtocolo | Alta | ✅ | ✅ (1 vs 254) | ✅ | duplicação confirmada | qual convergência escolher (negócio) | 85% |
| Permissões | Alta | ✅ | ✅ | ✅ | DELETE Processo desproporcional (CRÍTICO) | outros perfis customizados históricos não auditáveis | 85% |
| Projeções/Interface | Alta | ✅ | parcial | ✅ | nenhuma nova | nenhum | 85% |
| Jobs/Crons | Alta | ✅ | ✅ | ✅ | nenhuma | exaustividade total de todos os jobs (Cenário 9) | 80% |
| Exclusões (geral) | Média-alta | ✅ | ✅ | ✅ | G1/G5/G6a/G6b/G7/G8/G9 (já catalogados) | comportamento de "impacto realocável" entre processos irmãos (Cenário 6) | 75% |
| Reconciliação | Média-alta | ✅ | parcial | ✅ | nenhuma nova | ND2/ND5 (timing/sincronização) | 75% |
| Usuário (lifecycle) | Média | ✅ | ✅ | ✅ | ausência de lifecycle é o próprio achado | consequência em Documento/StepInstance (só Tarefa confirmada) | 70% |
| Saúde do Sistema (integridade) | Média | ✅ | não aplicável | ✅ | nenhuma | cobertura completa de todas as 66 verificações vs invariantes do mandato | 70% |

Nenhum número é arbitrário: confiança mais baixa em domínios onde
restaram pontas genuinamente não fechadas (Usuário, Saúde do Sistema,
Exclusões-realocação); mais alta onde 2+ frentes independentes
convergiram com prova direta.

---

## PARTE 17 — Critério para declarar compreensão

1. **Quantos NÃO DETERMINADOS foram fechados?** 8 de 11 (ND2, ND3, ND4, ND6, ND7, ND8, ND9, ND10).
2. **Quantos continuam genuinamente não determináveis?** 2 (ND1 — valor efetivo da flag em produção, por ausência de acesso; ND11 — ausência de inversão histórico/notificação em TODO o código, prova de ausência total não é exequível).
3. **Quantas das 4 pontas de contradição foram confirmadas?** 1 (C8 — `canal`×`canalOperacionalId`).
4. **Quantas foram descartadas?** 3 (C7, C9, C10).
5. **Existe algum domínio estruturalmente importante ainda sem explicação causal?** Não — todos os 22 domínios da matriz têm causalidade explicada; os que restam com confiança <80% têm pontas específicas e nomeadas, não um buraco de compreensão inteiro.
6. **Existe source of truth cuja identidade ainda esteja incerta?** Não quanto à IDENTIDADE (todas foram nomeadas: Fornecedor×OrgaoProtocolo, Receita/Custo×ObrigacaoEconomica) — resta incerto apenas o VALOR de uma flag de produção, não a identidade da fonte.
7. **Existe algum lifecycle importante ainda não compreendido?** O lifecycle de `Usuario` é o mais fraco — não por não ter sido investigado (foi, a fundo), mas porque ele genuinamente NÃO EXISTE como lifecycle formal hoje; isso é uma conclusão firme, não uma lacuna de investigação.
8. **Existe mutação estrutural cujo blast radius não se consiga prever?** Não — todas as mutações estruturais relevantes (exclusão de Processo/Pessoa/Requerente/Usuário/Documento/Fornecedor, cancelamento financeiro, invalidação de documento, avanço/retrocesso de fase) têm blast radius traçado; o Cenário 7 (invalidação pós-conclusão de fase) é o único onde a PROPAGAÇÃO específica ficou honestamente como NÃO DETERMINADA, não o blast radius inteiro.
9. **No teste adversarial, houve alguma resposta errada?** Não uma "errada" — o Cenário 7 expôs a lacuna mais genuína desta rodada inteira (efeito de invalidação sobre fase já concluída), corretamente marcada NÃO DETERMINADO em vez de forçada.
10. **No teste de previsão sem pesquisa: 4 ACERTOU / 1 PARCIALMENTE / 0 ERROU.**
11. **Você considera que possui um modelo mental suficiente para prever consequências sistêmicas de mudanças no Discovery sem criar regra paralela?**

**SIM, com duas exceções nomeadas e não generalizáveis.** Justificativa
com evidência: das ~15 lacunas originais, 11 foram fechadas com prova
direta (código, banco ou comportamento real) nesta rodada, incluindo o
achado mais importante (segunda flag de corte já pronta,
`FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA`) e a confirmação dura de que NÃO
existe hoje uma única fonte financeira. O teste adversarial (10 cenários)
não expôs nenhum domínio inteiro mal compreendido — expôs exatamente 1
propagação específica não confirmada (Cenário 7, invalidação de
documento pós-conclusão de fase) e 1 acerto parcial no teste de previsão
decorrente da mesma lacuna. As 2 exceções remanescentes (valor de flag em
produção; efeito exato de invalidação pós-conclusão) são nomeadas,
isoladas, e não contaminam a compreensão do resto do grafo — cada uma tem
um próximo passo concreto e barato para ser fechada (ler variável de
ambiente do Vercel; ler `atenderNecessidade`+`phase-advance.ts` em
conjunto num teste dedicado), não exigem nova rodada de auditoria ampla.

---

FECHAMENTO DA PROVA DE COMPREENSÃO CONCLUÍDO — NENHUMA ALTERAÇÃO IMPLEMENTADA
