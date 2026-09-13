# 24 — Prova de compreensão arquitetural do Discovery

Consolidado em 13/09/2026. Reconstrução INDEPENDENTE do modelo mental do
Discovery a partir de código/schema/dados reais — 9 frentes paralelas,
cada uma reconstruindo sua fatia sem partir da documentação existente,
confrontadas e consolidadas aqui pelo agente principal. Onde duas frentes
tocaram o mesmo ponto, isso está registrado explicitamente (convergência
ou contradição). **Diagnóstico apenas — nada foi alterado.**

Nota metodológica honesta: as 9 frentes herdam o contexto integral desta
conversa (inclusive as 3 rodadas de auditoria anteriores). Foram
instruídas a tratar essas conclusões como hipótese a reconfirmar e a
procurar ativamente contradição, não repeti-las. Em todos os pontos de
sobreposição encontrados, as frentes CONVERGIRAM (chegaram à mesma
conclusão por leitura independente) ou REFINARAM (acrescentaram detalhe
sem contradizer) — nenhuma contradição direta entre frentes desta rodada
precisou de arbitragem. As contradições reais encontradas são internas ao
próprio sistema (código vs comentário, ou duas implementações do mesmo
conceito), não entre as frentes de investigação.

---

## PARTE 1-2 — O Discovery como sistema, e seu grafo real

O Discovery não é organizado por tela — é organizado por **10 domínios
reais** identificáveis pela estrutura do schema (~230 models) e dos
serviços: Identidade/Cadastro, Motor Operacional (o maior cluster
contíguo do schema), Documental, Financeiro (o maior em volume de
arquivo — ~80 arquivos, com 2 gerações de modelo convivendo), Registral/
Genealógico (MRG, sub-motor autocontido), Repositório de Modelos
Documentais, Saúde do Sistema, Camada Operacional do Funcionário,
Notificação/Comunicação, Catálogo/Preço.

**Entidades-raiz reais** (por direção de FK, não por suposição): Processo,
Familia, Serviço/TipoServico, MatrizDocumental. **Pessoa deveria ser raiz
semântica mas tecnicamente não é** — `Pessoa.arvoreId` é `onDelete: Cascade`,
tratando identidade humana como dependente técnica de Árvore. Esta é a
causa estrutural do achado crítico G1 das auditorias anteriores.

**Classificação de entidades** (config/fato/projeção/histórico/financeiro/
documento/execução/macro): confirmada com exemplos concretos — configuração
sempre desacoplada de runtime por snapshot sem FK viva (`PhaseInternalWorkflowStep`↔
`PhaseWorkflowStepInstance`, `MatrizDocumental`↔`NecessidadeDocumental` via
`matrizSnapshot`); projeções nunca têm tabela própria (progresso de fase,
fila, kanban são todos computados na leitura); histórico é sempre append-only
exceto onde cascateia com o pai (tensão registrada abaixo).

**Grafo real** — ~16 relações estruturais classificadas (OWNER/DEPENDENT/
REFERENCE/SHARED RESOURCE/CONFIGURATION/PROJECTION/HISTORY/FINANCIAL FACT/
DERIVED STATE), com 3 casos onde a FK **não representa** a relação de
negócio real: `Pessoa.arvoreId` (identidade tratada como dependente),
`ObrigacaoEconomica.documentoId`/`.processoId` (fato financeiro tratado
como dependente técnico do que o originou), e o comentário desatualizado
de `fornecedorId`. Duas relações sem FK nenhuma, estabelecidas só por
convenção de escrita: `LogAuditoria.entidade`/`.entidadeId` (histórico
polimórfico, correto por desenho) e `DomainOutbox.aggregateId`.

---

## PARTE 3-5 — Proveniência e ciclos de vida

Para as ~10 entidades operacionais centrais, a proveniência foi
reconstruída com criador(es) real(is) confirmado(s) por grep exaustivo.
**Achado mais importante desta parte, confirmado por DUAS frentes
independentes que chegaram à mesma conclusão por caminhos diferentes**:

> **CONTRADIÇÃO CONFIRMADA — duplicação de lógica de criação de Tarefa.**
> `lib/operacional/tarefa-canonica.ts::materializarTarefaOperacional` se
> autodeclara em comentário como *"a única porta por onde uma tarefa
> operacional nasce"*. Mas `src/services/passo-tarefa.ts::garantirTarefaDePasso`
> tem seu próprio `tx.tarefa.create()` — não chama a função que se declara
> única. São duas implementações do mesmo conceito de negócio ("materializar
> Tarefa a partir de um passo"), com a mesma chave de idempotência
> (protegidas contra duplicidade de DADO por constraint única), mas **não
> protegidas contra divergência de LÓGICA** — uma correção num caminho não
> propaga automaticamente para o outro. `materializarTarefaOperacional` é
> hoje usada só pelo job de reconciliação; `garantirTarefaDePasso` é o
> caminho síncrono real.

Documento tem **6 vias de criação legítimas** (upload direto, necessidade
materializada, nova via, adapter legado, análise documental, operação-
necessidade) — não é anomalia (são fatos de negócio distintos), mas
significa que não há "um dono de escrita" único, ponto de atenção para
qualquer auditoria futura de integridade.

Ciclos de vida confirmados respeitando as distinções exigidas pelo
mandato (nenhuma confusão nova encontrada além das já registradas):
CANCEL≠DELETE, REOPEN≠RECREATE (Tarefa preserva ID; Necessidade cria nova
linha versionada com `supersedePorId`, não reescreve a antiga),
INVALIDATE≠CONCLUIR (documento invalidado mantém a obrigação aberta).

---

## PARTE 6 — Motor operacional

Reconstruído linha a linha a partir do código (`task-step-sync.ts`,
`tarefa-ciclo.ts`, `phase-advance.ts`), confirmando e refinando os docs
15-19:

- **Ownership**: `Tarefa.responsavelId`, único, sem concorrente.
- **Conclusão**: `concluirPasso` (dentro de uma `$transaction`) aplica o
  passo, libera o próximo da MESMA obrigação (nunca da instância inteira
  — evita vazamento entre unidades de trabalho diferentes), deriva o
  status da Tarefa do CONJUNTO de passos obrigatórios (nunca decide
  diretamente), e roda uma trava de coerência final antes do commit.
- **Prazos — achado que refina o modelo**: existem **DUAS fontes de prazo
  preservadas deliberadamente lado a lado** (`Tarefa.dataPrazo` e
  `PhaseWorkflowStepInstance.prazo`) — quando divergem, o sistema gera
  `CONFLITO_PRAZO_TAREFA_PASSO` como motivo de risco em vez de escolher
  uma silenciosamente. Isto é honestidade arquitetural deliberada, não
  ausência de fonte única por descuido.
- **Bloqueio × espera × cancelamento**: 3 estados distintos, mesma
  estrutura técnica (`blockedPreviousStatus`), nunca tratados como
  equivalentes.
- **Reabertura**: preserva identidade (`taskId`), reabre passos pela
  porta própria (nunca `updateMany` direto).

**QUAL É A UNIDADE CANÔNICA DE EXECUÇÃO?** Tarefa — confirmado por
ownership real, por ser a chave de leitura de toda fila/dossiê/EM_RISCO,
e por princípio de desenho explícito no próprio código: *"UMA obrigação
real = UMA Tarefa = UM workflow interno = N etapas"*, com
`workflowInstanceId @unique` citado como trava estrutural contra o
desenho antigo (cada passo virando uma Tarefa própria). O Passo é estado
interno do trabalho, não a unidade que alguém possui/vê na fila.

---

## PARTE 7 — Domínio documental

**5 conceitos reais, nenhum colapsando no outro**: Necessidade
(`NecessidadeDocumental`, requisito) ≠ Documento (`Documento`, o
registro) ≠ Versão (não é model — é atributo do Documento via
`derivadoDeId`/`substituidoEm`/`chaveDerivacao`) ≠ Solicitação
(`SolicitacaoDocumento`, tentativa de obter de terceiro) ≠ Arquivo
(`DocumentoArquivo`, o binário). Anexo é um conceito DIFERENTE de Arquivo
— 3 models próprios (`AnexoProcesso`/`AnexoContratante`/`AnexoRequerente`),
do lado do Processo/pessoa jurídica, não do Documento. Evidência é
config (`ExigenciaEvidenciaEtapa`), não fato. Validação não é model — é
efeito (`COMPLETE_DOCUMENT`/`INVALIDATE_DOCUMENT`) que grava em
`Documento.status` + observação append-only.

**Achado que refina a auditoria anterior**: `Documento` **não tem
`processoId` próprio** — só chega ao Processo indiretamente, via
`NecessidadeDocumental.processoId` ou via `Pessoa→Arvore`. A cascata
descrita nos docs 22/23 está correta na prática, mas não existe o atalho
direto Processo→Documento como FK.

Necessidade é satisfeita (`status=ATENDIDA`) por um predicado DERIVADO DO
STEP operacional concluído — nunca inferido de "documento existe". Guard
explícito nunca sobrescreve estado terminal (`ATENDIDA`/`DISPENSADA`).

---

## PARTE 8 — Domínio financeiro

**Achado mais importante desta prova inteira, não mapeado nas 3 rodadas
anteriores**:

> **Existe um SEGUNDO motor financeiro completo e ativo.** `Receita`/`Custo`
> (legado, ligados direto a `Processo`, com seus próprios campos de
> congelamento de preço, cancelamento e estorno) coexistem, ATIVAMENTE
> ESCRITOS HOJE (confirmado por grep de `.receita.create`/`.custo.create`
> reais em `matriz-economica.ts`, `criar-receita-manual.ts`,
> `redistribuir-service.ts`), com `ObrigacaoEconomica` (V3/Ledger). A
> ponte entre os dois é `lib/financeiro/dual-write.ts` — deliberada e
> documentada, mas **parcial e best-effort**: custo é sempre espelhado
> para o V3; receita só é espelhada se a flag `FINANCEIRO_DUAL_WRITE`
> estiver ligada (não confirmado se está, em produção, nesta rodada). O
> próprio código do dual-write **cita um incidente real já ocorrido**:
> "processo 513: obrigações 16 e 18, R$ 4.800 fantasmas" — o espelho
> ficou órfão e ativo depois que a origem mudou.
>
> **Gap ainda pior, novo nesta rodada**: `cancelarLancamento`/
> `estornarLancamento` (o mecanismo de cancelamento/estorno do lado
> legado) **não propagam para `ObrigacaoEconomica`** — cancelar ou
> estornar um Custo/Receita no legado não atualiza o espelho V3. É o
> mesmo padrão do incidente de R$4.800, agora acionável por
> cancelamento normal, não só por exclusão.

Isto **substitui e amplia** a moldura de risco financeiro dos docs 22/23:
não é só Fornecedor×OrgaoProtocolo — é a coexistência estrutural de dois
motores de obrigação, com uma ponte que já vazou dado uma vez e continua
com um buraco confirmado (cancelamento não sincroniza).

As guardas diretas contra apagar fato financeiro pago (`removerObrigacaoOrfaTx`,
`pessoa-ciclo-vida.ts::executarHard`) continuam corretas e reconfirmadas
— o problema nunca foi a proteção direta, é a superfície fora dela
(cascata de pai, e agora também dual-write não sincronizado).

---

## PARTE 9-10 — Processo/Fase/Progresso e o sistema transversal de eventos

`Processo.faseAtualKey` é o único ponteiro de estado macro, e
`phase-advance.ts` é o único serviço autorizado a escrevê-lo (regra
supremacia citada no próprio comentário do arquivo). Uma transição de
fase roda numa única `$transaction` que **fotografa as obrigações antes e
depois e reverte se qualquer obrigação de OUTRA fase mudou** — prova
direta e forte de "avançar fase não destrói obrigação alheia" (memória
do projeto `invariante-obrigacoes-movimentacao.md`, agora confirmada
linha a linha, não só por título de memória).

5 estados, 5 fontes: macro (`Processo.faseAtualKey`), operacional
(`Tarefa.statusTarefa`+passo corrente), documental
(`NecessidadeDocumental`/`Documento.status`, só lido por
`blocking-engine.ts`, nunca escrito por ele), financeiro
(`ObrigacaoEconomica`, nunca tocado por `phase-advance.ts` diretamente —
reage de fora via outbox), projetado (`computeGate`, a MESMA função-base
que tanto decide se a fase pode avançar quanto alimenta a projeção da
interface — "fonte única, várias leituras" provado, não inferido).

EVENTO (`WorkflowEvento`, append-only, dentro da transação) → HISTÓRICO
(`PhaseAdvanceLog`/`LogAuditoria`, também dentro da transação) →
NOTIFICAÇÃO (sempre consequência, nunca decide) — ordem rígida confirmada
em `executarPlano`, sem inversão encontrada nos arquivos auditados
(ressalva: só nestes arquivos — não é generalizável ao sistema inteiro
sem mais leitura). OUTBOX (`DomainOutbox`) tem uma lista real de "tipos
sem efeito" nascida de um incidente documentado (110 eventos acumulados
sem consumidor por 12 dias) — prova de maturidade operacional, não gap.
Achado a esclarecer: `phase.completed` está hoje nessa lista de "sem
efeito" — a notificação de FASE_CONCLUIDA sai por outro caminho direto, o
que é consistente, mas não foi confirmado se o evento outbox tem
propósito futuro ou é resíduo.

---

## PARTE 11-12 — Projeções/interface e permissões

Telas mapeadas leem projeção (`tarefa-projecoes.ts`, `computeGate`) e
disparam execução só por portas canônicas — a doutrina *"a tela não
decide o que acontece"* está inscrita como comentário em 5 arquivos
reais, não é só um princípio de documentação. Achado não resolvido: `/financeiro`
e `/financas/*` são dois prefixos de rota para aparentemente o mesmo
domínio — não determinado se são duplicação real ou dois módulos legítimos
(V2/V3).

**Achado novo mais importante desta parte**:

> **CONTRADIÇÃO — permissão desproporcional ao blast radius.**
> `DELETE /api/processos/[processoId]` exige só `processos.excluir`, uma
> permissão NORMAL (Administrador e Gerente por padrão, mesma classe de
> "excluir tarefa"). O próprio sistema de permissões já sabe diferenciar
> risco por classe — `processos.moverFaseManual` (reposiciona fase, sem
> apagar nada) é EXCLUSIVA (nem admin ganha automaticamente);
> `sistema.exclusaoDefinitiva` (hard-delete de config/catálogo, escopo
> bem menor que um Processo inteiro) é OPT-IN. Mas a ação de MAIOR blast
> radius confirmado do sistema inteiro (G1, cascateia até o Ledger pago)
> usa a permissão MAIS comum das três classes. O modelo de permissões não
> foi aplicado com a mesma disciplina à sua própria ação mais perigosa.

Confirma com mais força o achado de `DELETE /api/anexos`: não só sem
RBAC — sem NENHUMA checagem de posse (não verifica se o anexo pertence a
um processo que o usuário tem acesso). Qualquer usuário autenticado,
incluindo Estagiário, apaga qualquer anexo de qualquer processo por ID.

---

## PARTE 13 — Teste de causalidade (20 cenários)

Todos os 20 traçados com evidência de código (arquivo:função), 17 com
prova direta nesta própria frente ou herdada de fork já executado nesta
rodada. 3 declarados **NÃO DETERMINADO** em vez de inventados:

- **P** (preço global vs override local pós-mudança): não li o resolvedor
  de precedência para confirmar qual vence numa obrigação nova após a
  mudança de preço.
- **Q** (inativar usuário responsável por operações abertas) — **achado
  de gap real, não apenas lacuna de prova**: não existe nenhum serviço de
  ciclo de vida de usuário equivalente a `pessoa-ciclo-vida.ts`, nem
  reatribuição automática de Tarefas. Não confirmado se isso quebra algo
  hoje (pode ser que `Tarefa.responsavelId` simplesmente aponte para um
  usuário inativo sem consequência prática), mas é uma lacuna real de
  cobertura, não investigada antes desta prova.
- **H** (timing do job de reconciliação pós-arquivamento de regra
  documental): mecanismo confirmado, frequência/gatilho exato não
  confirmado.

Todos os outros 17 (Pessoa, Requerente, Processo, Árvore, Tarefa,
Documento×3, Regra Documental×2, responsável, cancelar/reabrir Tarefa,
avançar/retroceder fase, Serviço, retorno antecipado, cron, concorrência)
têm cadeia completa provada por código, a maioria já reconfirmando
achados de rodadas anteriores com leitura linha a linha nova (não só
citação).

---

## PARTE 14 — Contradições encontradas

**6 confirmadas com prova sólida** (não inventadas para completar 10):

1. `VersaoGenealogica`: comentário diz "nunca apagado por exclusão comum"; FK real é `onDelete: Cascade`.
2. `ObrigacaoEconomica.fornecedorId`: comentário diz "sem FK forte"; a `@relation` real existe 67 linhas abaixo.
3. Mesmo nome de coluna (`fornecedorId`), dois alvos diferentes em dois models (`Fornecedor` vs `OrgaoProtocolo`).
4. `StepRequirement`: cadastro ainda escreve; a execução real (`concluirEtapa`) nunca lê — lê `ExigenciaEvidenciaEtapa` em vez disso.
5. `Fornecedor` × `OrgaoProtocolo+FUNCAO=FORNECEDOR`: mesmo conceito, dois cadastros, o próprio código do sistema admite que não deveria existir separação.
6. 3 implementações paralelas de cancelamento/estorno financeiro, rigor desigual.

**4 achados reais com uma ponta NÃO DETERMINADA** (investigação
dedicada necessária antes de classificar definitivamente):
7. `documentTypeCode` marcado legado mas lido em pelo menos 20 arquivos, incluindo o motor de elegibilidade em produção — não confirmado se é fallback ou decisão real.
8. `SolicitacaoDocumento.canal` marcado "espelho derivado" mas escrito como valor de entrada direto — divergência possível não confirmada.
9. Campos de preço legado (`valorPadrao`/`valorCustoPadrao`/`valorReceitaPadrao`) ainda escritos ativamente em CRUD de produto — não confirmado se influenciam cálculo real (contradiria "Tabela de Preços = fonte única" se sim).
10. `Divergencia`: dois comentários no mesmo model sobre "preservado" com ambiguidade sobre se ainda é lido como decisório.

Um 11º candidato (`TabelaPreco.perfil`/`.canal`) foi verificado e
DESCARTADO como contradição — comentário e código concordam (raro e
citado como contraexemplo positivo).

---

## PARTE 15 — Travessia por dados reais

Reaproveitando IDs já estabelecidos nesta conversa (evita nova leitura de
produção desnecessária): Processo 592/Tarefa 3570 (fluxo normal, **1
divergência conhecida**: `Tarefa.necessidadeId=null` apesar de
`documentoId` resolver a necessidade), Pessoa 2795/4 Necessidades
(múltiplas pessoas, dentro do esperado), Tarefas 3571/3562/3564
(EM_RISCO, confirmado idêntico entre indicador/lista/projeção, provado ao
vivo em produção com Playwright na Etapa 6), Documento 2136 (status
RECEBIDO sem arquivo tipado correspondente — divergência de app-layer,
sem FK quebrada). **Não obtidos nesta frente**: ID real de obrigação
financeira específica e de operação "em espera" para fechar a tabela por
completo — declarado NÃO DETERMINADO, não inferido.

---

## PARTE 16 — O que ainda não está determinado (consolidado)

- Se `FINANCEIRO_DUAL_WRITE` está ligada em produção hoje.
- Se existe reconciliação periódica sincronizando `ObrigacaoEconomica` espelhada quando `Receita`/`Custo` de origem é cancelado depois.
- Precedência exata preço-global vs override-local após mudança de preço.
- Se a ausência de ciclo de vida de usuário (inativação) tem consequência prática hoje ou é lacuna sem incidente.
- Timing/gatilho exato da reconciliação de necessidades pós-arquivamento de regra documental.
- Se `documentTypeCode`, `SolicitacaoDocumento.canal` e os campos de preço "legado" são write-only/fallback ou ainda influenciam decisão real.
- Contagem real de registros `Fornecedor` vs `OrgaoProtocolo+FORNECEDOR` (evitou-se nova query de produção).
- Se `/financeiro` e `/financas/*` são módulos duplicados ou legítimos.
- Comportamento de "processo nasce em fase avançada" (não relido nesta rodada especificamente).
- Se `phase.completed` (outbox, hoje sem efeito) tem consumidor futuro planejado ou é resíduo.
- Se existe inversão de "histórico/notificação decidindo negócio" em algum arquivo NÃO auditado nesta prova (só se confirma a ausência nos arquivos efetivamente lidos).

---

## PARTE 17 — Mapa canônico do Discovery (reconstruído, não copiado)

```
CONFIGURAÇÃO (MatrizDocumental, PhaseInternalWorkflow*, TabelaValor, ExigenciaEvidenciaEtapa)
        │  (snapshot congelado no momento do uso — nunca FK viva para a execução)
        ▼
CRIAÇÃO DE OBRIGAÇÃO (NecessidadeDocumental via garantirNecessidade;
                       Tarefa via garantirTarefaDePasso/materializarTarefaOperacional — DUPLICADO)
        │
        ▼
MATERIALIZAÇÃO (materializarGenealogia, materializarExecucaoDaFase — best-effort, idempotente)
        │
        ▼
EXECUÇÃO (task-step-sync.ts — única máquina de passo; Tarefa = unidade canônica)
        │
        ├──▶ DOCUMENTAÇÃO/EVIDÊNCIA (Documento, DocumentoArquivo, catalogo-de-efeitos.ts)
        │
        ├──▶ EVENTOS/HISTÓRICO (WorkflowEvento, LogAuditoria, PhaseAdvanceLog — dentro da mesma
        │                        transação, nunca decidindo, sempre consequência)
        │         │
        │         ▼
        │    NOTIFICAÇÃO (sempre depois do evento/histórico)
        │
        ├──▶ FINANCEIRO ("DEVERIA" ser um só — hoje são DOIS motores coexistindo
        │                 via dual-write parcial: Receita/Custo legado × ObrigacaoEconomica V3)
        │
        ▼
PROJEÇÕES (tarefa-projecoes.ts, computeGate — fonte única, várias leituras, sem tabela própria)
        │
        ▼
ESTADO MACRO (Processo.faseAtualKey, escrito só por phase-advance.ts, com invariante de
              obrigações comparando antes/depois de cada transição)
```

Adaptação ao que o código realmente mostrou (o desenho pedido pelo
mandato precisou de 2 ajustes): a seta FINANCEIRO deveria ser uma linha
única e é, na prática, duas linhas paralelas malemparelhadas — o maior
desvio entre a arquitetura pretendida e a real encontrado nesta prova. E
"CRIAÇÃO DAS OBRIGAÇÕES" tem uma bifurcação de código (não de dado) no
caminho de Tarefa que o desenho ideal não previa.

---

## PARTE 18 — Prova final (20 respostas)

1. **Entidades-raiz reais**: Processo, Familia, Serviço/TipoServico, MatrizDocumental. Pessoa deveria ser raiz semântica, é tecnicamente Cascade-dependente de Árvore (gap estrutural já registrado, G2).
2. **Unidade canônica de execução**: Tarefa.
3. **Source of truth de ownership operacional**: `Tarefa.responsavelId`.
4. **Próximo acontecimento esperado**: `computarProximoAcontecimento` (`proximo-acontecimento.ts`), combinando prazo da Tarefa, prazo do passo, previsão de retorno do terceiro e próximo acompanhamento — reporta conflito em vez de escolher.
5. **Conclusão de fase**: `phase-advance.ts::executarPlano`, `encerramento==="CONCLUIR"` dentro de `$transaction` com invariante de obrigações.
6. **Cadeia canônica documental**: Regra (MatrizDocumental) → Necessidade (snapshot congelado) → Documento (pode nascer sem necessidade também) → Solicitação (1:N) → Versão (atributo, via `derivadoDeId`) → Arquivo.
7. **Necessidade satisfeita**: `status=ATENDIDA`, derivado do step operacional concluído, nunca da mera existência de documento; guard nunca sobrescreve estado terminal.
8. **Cadeia financeira real**: DUAS cadeias coexistindo — legado (Receita/Custo/Fatura) e V3 (TabelaValor→congelar()→ObrigacaoEconomica→Ledger), ligadas por dual-write parcial e best-effort.
9. **Fatos financeiros irreversíveis por DELETE simples**: `ObrigacaoEconomica` `PAGO`/`CONCILIADO`/`LIQUIDADO` — protegido nas rotas diretas, vulnerável só via cascata do pai (Documento/Processo) e via dual-write não sincronizado no cancelamento legado.
10. **Projeções administrativas**: `tarefa-projecoes.ts`, `computeGate`, `SaldoProjecao`, relatórios de domínio (`fornecedores.ts`/`orgaos.ts`).
11. **Onde a execução realmente acontece**: `task-step-sync.ts` (passo) + `phase-advance.ts` (fase) — nenhuma tela escreve motor diretamente.
12. **Mecanismos de efeito assíncrono**: 6 crons reais, `DomainOutbox` (claim atômico), `materializarExecucaoDaFase` (best-effort fora de transação).
13. **Fronteiras transacionais principais**: `executarPlano`, `concluirPasso`, `criarProcessoV2`, `deleteService` (todas `$transaction`); `materializarExecucaoDaFase` é deliberadamente FORA de transação (best-effort documentado).
14. **Invariantes globais principais**: notificação nunca aponta pra entidade removida; config nunca cascata pra runtime; reabrir preserva identidade; avanço de fase não altera obrigação de outra fase (comparação antes/depois); CANCELADA≠CONCLUÍDA; concorrência serializada por `SELECT FOR UPDATE`. **Violadas**: nenhum fato financeiro pago apagado por exclusão de pai (FALSA — G1); terceiro tem identidade financeira única (FALSA — G4); permissão proporcional a blast radius (FALSA — achado novo desta prova).
15. **Sources of truth concorrentes**: Fornecedor×OrgaoProtocolo; **Receita/Custo legado×ObrigacaoEconomica V3 (achado maior desta prova)**; StepRequirement (cadastro)×ExigenciaEvidenciaEtapa (execução real).
16. **Partes que contradizem o modelo canônico**: `VersaoGenealogica` Cascade vs comentário; dupla lógica de criação de Tarefa; `DELETE /api/processos` com permissão desproporcional; `DELETE /api/anexos` sem posse; 3 implementações de cancelamento/estorno.
17. **Pontos não determinados**: ver Parte 16 acima (11 itens consolidados).
18. **Ao excluir uma entidade-raiz, como decidir o destino de cada dependência**: classificar cada uma em EXCLUSIVA (remover)/COMPARTILHADA (desvincular)/HISTÓRICA (preservar)/FINANCEIRA MATERIALIZADA (estornar se paga)/PROJEÇÃO (recalcular) — nunca decidir pela FK isolada; `pessoa-ciclo-vida.ts` já prova que isso funciona quando implementado; Processo ainda não tem o equivalente.
19. **Como evoluir sem segundo motor**: reutilizar mecanismos genéricos já existentes (catálogo de efeitos, motor de condições declarativo, config/runtime desacoplado por snapshot); a lição prática mais dura desta prova é que "espelhar para sempre" (dual-write) não é convergência — o Discovery já pagou um incidente real por isso e continua exposto.
20. **Em uma frase**: o Discovery é um motor operacional único e genérico (Tarefa/Passo/Fase, config e execução desacopladas por snapshot) cercado por domínios documentais bem modelados e um domínio financeiro ainda dividido entre duas gerações que nunca convergiram de fato — com uma porta de exclusão crítica (Processo) que ainda não usa a disciplina de análise de impacto que o resto do sistema já sabe fazer.

---

## Conclusão sobre o quanto foi efetivamente provado

Das ~150 afirmações estruturais centrais consolidadas nesta prova, a
esmagadora maioria carrega CONFIRMADO PELO CÓDIGO com arquivo:linha real
citado por pelo menos uma frente (várias com dupla confirmação
independente). Um número pequeno e explicitamente listado (Parte 16)
ficou como NÃO DETERMINADO — nenhuma frente inventou para preencher
lacuna. O achado mais significativo (segundo motor financeiro ativo,
Receita/Custo×ObrigacaoEconomica) não estava mapeado em nenhuma das 3
rodadas anteriores desta sessão e muda a prioridade relativa dos gaps
financeiros já registrados — deve ser tratado como achado de primeira
classe junto com G1 (exclusão de Processo), não como nota de rodapé.

---

PROVA DE COMPREENSÃO ARQUITETURAL CONCLUÍDA — NENHUMA ALTERAÇÃO IMPLEMENTADA
