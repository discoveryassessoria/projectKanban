# 22 — Integridade sistêmica: auditoria do grafo de dependências real

Consolidado em 13/09/2026. Executa a auditoria pedida pelas seções 38-62 do
mandato registrado em [21](21-integridade-sistemica-grafo-dependencias.md).
**Só diagnóstico — nenhuma linha de produto foi alterada, nenhuma migration,
nenhuma escrita em produção.** 6 frentes de investigação independentes,
cada achado com prova em arquivo/linha/função real.

## Resumo executivo (leia isto primeiro)

Existe **um achado CRÍTICO real e confirmado por 3 fontes independentes**
(2 frentes + minha própria leitura direta do schema):

> **`DELETE /api/processos/[processoId]`** (`src/app/api/processos/[processoId]/route.ts:230-309`)
> apaga o Processo com `prisma.processo.delete()` cru — sem `$transaction`
> explícita, sem qualquer chamada a `pessoa-ciclo-vida.ts` — e, se for o
> último processo da Árvore, chama `prisma.arvore.delete()` **diretamente**
> (linha 281-284), **contornando** o mecanismo que `DELETE /api/arvore/[arvoreid]`
> já paga o preço de ter (frase de confirmação, `fatosProtegidos`, remoção
> pessoa-por-pessoa). O próprio código da rota de árvore documenta, em
> comentário, que essa classe de bug **já aconteceu uma vez e foi corrigida
> ali** — esta rota reabre o mesmo defeito por outra porta.
>
> A cascata real do banco (`onDelete: Cascade`, verificado linha a linha)
> é: **Processo → Arvore → Pessoa → Documento → `ObrigacaoEconomica`**
> (`schema.prisma:5741`, comentário do próprio autor: *"Protegido pelo
> banco: ON DELETE CASCADE"*) — ou seja, apagar esse Processo apaga
> fisicamente, em cascata, **obrigações financeiras já `PAGO`/`LIQUIDADO`
> no Ledger**, exatamente o cenário que o mandato proíbe explicitamente
> na seção 16 ("excluir a tarefa não pode transformar pagamento ocorrido
> em nunca existiu").

Todo o resto do sistema auditado (motor operacional, cadeia documental,
eventos/notificações/crons, Serviço/exclusão administrativa) está em
condição **BOA a EXEMPLAR** — vários mecanismos já implementam a doutrina
corretamente (citados como referência positiva abaixo). O sistema não tem
um problema de arquitetura geral; tem uma porta específica que não usa a
arquitetura que o resto do sistema já construiu.

## A. Mapa de entidades-raiz

Determinado pela direção real das FKs no schema (não por suposição):

| Entidade | É raiz real? | Evidência |
|---|---|---|
| **Processo** | SIM | recebe FK de ~44 tabelas; não depende de nenhuma via FK obrigatória |
| **Familia** | SIM | sem FK de saída obrigatória; agrupador administrativo puro |
| **Serviço** (catálogo) | SIM | cadastro, sem dependência de instância operacional |
| **Regra Documental** (MatrizDocumental) | SIM | cadastro, sobrevive à Necessidade que gera (snapshot congelado) |
| **Pessoa** | Deveria ser raiz (identidade humana), mas **tecnicamente não é** | `Pessoa.arvoreId` é `onDelete: Cascade` — o schema trata Pessoa como dependente técnica de Árvore. Este descompasso entre "dono real do negócio" e "quem cascata de quem no banco" é a **causa raiz** do achado crítico acima. |
| **Requerente** | Dependente | Cascade a partir de Processo/Pessoa |

## B. Grafo de dependências (consolidado das 6 frentes + verificação direta)

```
Processo ──Cascade──▶ Arvore (condicional: só se era o único processo dela)
Arvore   ──Cascade──▶ Pessoa
Arvore   ──Cascade──▶ NecessidadeDocumental
Pessoa   ──Cascade──▶ Documento, Uniao(pessoa1/pessoa2)
Pessoa   ──NoAction─▶ filhos (self-relation)
Documento──Cascade──▶ ObrigacaoEconomica  ⚠ CONFIRMADO schema:5741 (Cascade real, não "solto")
Processo ──Cascade──▶ ObrigacaoEconomica  ⚠ CONFIRMADO schema:5702 (Cascade real)
Processo ──Cascade──▶ ~40 outras tabelas (financeiro, motor, MRG) sem Restrict/NoAction
NecessidadeDocumental ──Cascade──▶ NecessidadeDocumentalEvento (histórico tratado como exclusivo)
Tarefa   ──Cascade──▶ TarefaHistorico, WorkflowEvento, NotificacaoOperacional(tarefaId),
                       SolicitacaoDocumento(tarefaId), TarefaDependencia
Tarefa.workflowStepInstanceId/.necessidadeId/.documentoId/.pessoaId/.previousTarefaId
         ──SetNull──▶ (Tarefa nunca é travada pelo que ela referencia)
PhaseWorkflowStepInstance ──Cascade──▶ StepExecution, SubtaskExecution
PhaseInternalWorkflowStep (definição/cadastro) ──Cascade──▶ StepAction/Field/Checklist —
         mas NÃO toca runtime (stepDefinitionId é snapshot sem FK — desacoplado por desenho, correto)
ObrigacaoEconomica ──Cascade──▶ Ledger, LedgerEntry, Ocorrencia, Distribuicao, Parcela, Repasse
ObrigacaoEconomica.fornecedorId ──SetNull──▶ Fornecedor (FK real, comentário do schema desatualizado)
Documento.derivadoDeId ──SetNull──▶ (perde proveniência da via nova, sem guard)
NotificacaoOperacional.tarefaId/.processoId ──Cascade── ("não deixa aviso apontando pro vazio")
LogAuditoria: entidade/entidadeId sem FK — sobrevive a qualquer exclusão (correto para histórico)
```

## C. Ownership real (por frente)

- **Pessoa** owns: Documento, Uniões, Necessidades (via pessoaId), filhos. Único portão de saída real: `removerPessoaDaArvore(modo:"HARD")` — 1 chamador confirmado por grep.
- **Necessidade** owns: Documento (enquanto vazio); vira dependência-com-fato-histórico assim que ganha solicitação/arquivo/pagamento.
- **Tarefa**: dono do próprio histórico (TarefaHistorico/WorkflowEvento), nunca dona do que referencia (Documento/Necessidade sobrevivem a ela via SetNull).
- **`ObrigacaoEconomica.fornecedorId`** aponta para `Fornecedor.id` (Financeiro/Ledger). **`SubtaskExecution.fornecedorId`** (mesmo nome de campo!) aponta para `OrgaoProtocolo.id` (Emissão/terceiro). Confusão semântica real entre dois domínios usando o mesmo nome de coluna para alvos diferentes — não é bug de tipo, mas é risco de leitura para quem for mexer nesse código sem saber disso.
- **Fornecedor × OrgaoProtocolo (achado maior desta rodada)**: ambos ATIVOS e escritos em produção — não é legado morto como presumido na rodada de Emissão Documental. `Fornecedor` é a fonte real do Ledger (`ContaPagar`, `TabelaValor`, `pricing-resolver.ts`); `OrgaoProtocolo`+`FuncaoOrganizacao=FORNECEDOR` é a fonte operacional (campos financeiros próprios: `prazoPagamentoDias`/`contatoFinanceiro`/`statusFinanceiro`). **Um mesmo cartório pode ter dados bancários divergentes nos dois cadastros, nunca reconciliados** — classe 5 (source of truth concorrente).

## D. Contratos de ciclo de vida (o que existe de fato, por entidade)

| Entidade | CREATE | UPDATE | CANCEL | INVALIDATE | REOPEN | REPLACE | DELETE | RECONCILE |
|---|---|---|---|---|---|---|---|---|
| Pessoa | árvore | ficha | — | — | reativar (soft) | — | `removerPessoaDaArvore` (guardado por `fatosProtegidos`) | `analisarExclusaoArvore` |
| NecessidadeDocumental | `garantirNecessidade` (único) | status only-forward | `dispensarNecessidade` (sticky se manual) | — | `reabrir` cria NOVO ciclo (nunca reescreve) / `reabrirAtendimentoNecessidade` regride na mesma linha | — | `removerNecessidadesDoSujeito` (guardado) | `reconciliarNecessidadesPorPassos` |
| Documento | (múltiplos criadores, não mapeado 100% nesta rodada) | efeitos de domínio | `dispensarNecessidade` cancela em cascata | `INVALIDATE_DOCUMENT` (não conclui passo) | `reativarNecessidade` (só o que o próprio serviço cancelou) | `novaViaDocumental` (preserva anterior) | `removerDocumentosPorId` (guardado) | — |
| Tarefa | motor de passo | `task-step-sync.ts` | cancelamento (preserva tudo) | — | `reabrirTarefaNucleo` (preserva taskId, 68 invariantes) | — | só 2 pontos: `pessoa-ciclo-vida.ts` e `executor-motor` admin "undo" | `reconciliarTarefas` |
| ObrigacaoEconomica | `congelar()`/`criarCusto()` | — | `estadoCusto=CANCELADO` (vocabulário existe) | — | — | — | **nenhuma rota de hard-delete em uso** (soft via `arquivadaEm`) | — |
| Processo | `criarProcessoV2` (transacional) | várias | arquivamento (não mapeado a fundo) | — | — | — | **`DELETE /api/processos/[id]` — SEM guard equivalente ao de Pessoa/Árvore** | — |
| Requerente | cadastro | ficha | — | — | — | — | **`DELETE /api/requerentes/[id]` — só checa `_count.processos`, não financeiro/protocolo** | — |
| Fornecedor | `fornecedor.ts` CRUD | idem | — | — | — | — | `removerFornecedor` — **guarda só por `contasPagar`, não por `ObrigacaoEconomica` direta** | — |
| OrgaoProtocolo | Base Órgãos | idem | inativação | — | — | — | **guarda só por `Protocolo.count`, não por `SubtaskExecution` ativo** | — |
| Serviço | Catálogo Mestre | idem | — | — | — | — | `exclusao-definitiva.ts::deleteService` — **referência positiva**: análise prévia + `SELECT FOR UPDATE` + re-análise sob trava + ordem de dependência + desvincula cadastro compartilhado | — |

## E/F/G/H. Cascatas — existentes, ausentes e perigosas

**Existentes e corretas** (referência positiva, citar como padrão a seguir):
- `PhaseInternalWorkflowStep` (definição) desacoplado de instância de execução via snapshot sem FK — editar/apagar cadastro nunca cascateia para runtime.
- `TarefaHistorico`/`WorkflowEvento`/`NotificacaoOperacional`/`SolicitacaoDocumento`/`TarefaDependencia` cascateiam com a Tarefa — documentado nominalmente no schema, intencional.
- `dispensarNecessidade`: cascata multi-fase real e testada (cancela passos da própria fase E de outras fases que materializaram sobre o mesmo Documento) — corrigida de um bug real de produção (comentário cita o caso "Edithe, processo Teste").
- `exclusao-definitiva.ts::deleteService`: trava a linha, reanalisa sob a trava, ordem de dependência respeitada, desvincula em vez de apagar o que é compartilhado.

**Ausentes (gap, não crítico)**:
- Nenhuma verificação impede excluir um `Documento` que é origem de uma via derivada (`derivadoDeId`) — a via nova perde a proveniência (`SetNull` silencioso), sem guard nem aviso.
- `removerFornecedor`/`DELETE orgaos-protocolo`: guardam por **uma única relação de uso** (contasPagar / Protocolo.count), não pela união de todas as relações reais (`ObrigacaoEconomica.fornecedorId`, `SubtaskExecution.fornecedorId` respectivamente).

**Perigosas (confirmadas)**:
1. **CRÍTICA** — `Processo`/`Documento` → `ObrigacaoEconomica` = `Cascade` no schema, acionável hoje pela rota de Processo sem qualquer guard (ver resumo executivo).
2. **ALTA (latente)** — a mesma cascata `Cascade` em `ObrigacaoEconomica.documentoId`/`.processoId` é "correta" hoje só porque (fora da rota de Processo) não existe OUTRA rota de hard-delete de Documento fora do serviço guardado. Se uma nova rota de exclusão de Documento nascer sem passar por `removerDocumentosPorId`, o mesmo problema se repete por essa porta.

## I. Órfãos referenciais

Nenhum órfão referencial ativo confirmado nos dados reais já auditados (Processo 592: zero FK pendente). O risco é estrutural/futuro, não um incidente ativo hoje.

## J. Órfãos semânticos

- **Confirmado, menor**: Tarefa 3570 com `necessidadeId=null` apesar do `documentoId` resolver a necessidade — divergência de escrita em operação normal, não causada por exclusão.
- **Confirmado, menor**: Documento `status=RECEBIDO` sem `DocumentoArquivo` do tipo `DOCUMENTO_RECEBIDO` correspondente.
- **Descartados por desenho correto** (não são órfãos, são comportamento intencional): StepInstance `CONCLUIDO` cuja Tarefa foi reatribuída depois (histórico vive em `StepExecution`, amarrado à obrigação, não ao executor); Tarefa apontando para uma versão de workflow não-vigente (snapshot congelado, `PhaseWorkflowInstance.workflowVersion`).
- **Em aberto, não confirmado**: se uma Pessoa é desativada (soft) em vez de hard-deletada, falta confirmar se `materializarGenealogia` filtra `removidaEm: null` antes de decidir que uma regra ainda se aplica — não investigado a fundo nesta rodada.

## K. Efeitos zumbis

| Candidato | Veredito | Prova |
|---|---|---|
| Cron recriando necessidade/tarefa removida | **DESCARTADO** | idempotência por chave + gate por status atual do passo (`garantirTarefaDePasso`) |
| Outbox reprocessando origem removida | **DESCARTADO** | claim atômico + `MAX_TENTATIVAS` + lista `TIPOS_SEM_EFEITO` (dead-letter) |
| `materializarGenealogia` reabrindo dispensa manual | **DESCARTADO** | `dispensaManual` é checado e nunca sobrescrito pelo materializador |
| `reativarNecessidade` reabrindo invalidação humana | **DESCARTADO** | só reabre o que o próprio serviço cancelou (`motivoBloqueio` checado) |
| `executor-motor` "undo" sem checar estado operacional | **CONFIRMADO** | `route.ts:69-79`, `try/catch` engole falha de FK real como "já removido" — falso sucesso possível |
| "3 crons bloqueados no middleware" (memória antiga) | **JÁ CORRIGIDO** | os 6 crons reais estão nominalmente em `API_PUBLICA`, guardados por `guard-crons-alcancaveis.test.ts` — memória desatualizada, corrigir |
| Notificação com deep-link para entidade excluída | **CONFIRMADO, risco baixo hoje** | `GET /api/notificacoes` lê `link` como texto opaco, sem checar existência — risco estrutural, não incidente ativo (Tarefa/Processo raramente são hard-deletados fora das rotas já mapeadas) |

## L. Invariantes globais — confirmadas vs violadas

| Invariante | Status | Prova |
|---|---|---|
| Notificação nunca aponta para Tarefa/Processo removido | ✅ verdadeira | Cascade estrutural no schema |
| Histórico (LogAuditoria) sobrevive a qualquer exclusão | ✅ verdadeira | sem FK, por desenho |
| Criação de Processo e avanço de fase são atômicos | ✅ verdadeira | `$transaction` confirmado em `criar-processo.ts:153`, `phase-advance.ts:264` |
| Config (cadastro) nunca cascata para runtime (instância) | ✅ verdadeira | `stepDefinitionId`/`workflowDefinitionId` são snapshot sem FK |
| Reabrir preserva identidade (não recria) | ✅ verdadeira | `reabrirTarefaNucleo`, 68 invariantes travados em build |
| **Nenhum registro financeiro ativo/pago é destruído por exclusão que não é dele** | ❌ **FALSA — contraexemplo concreto** | cascata Processo→Arvore→Pessoa→Documento→`ObrigacaoEconomica` |
| Um terceiro (cartório/fornecedor) tem identidade financeira única | ❌ **FALSA** | `Fornecedor` × `OrgaoProtocolo` concorrentes, nunca reconciliados |

**Materialização best-effort documentada** (não é violação, é política de falha explícita): `materializarExecucaoDaFase` roda `materializarGenealogia()` e `instanciarWorkflowDaFase()` como 2 passos sequenciais fora de uma `$transaction` externa — o próprio comentário do código diz que é intencional ("falha aqui não derruba a materialização da fase"), apoiado na idempotência interna. Registrar como exceção deliberada, não como bug.

## M. Verificador de integridade já existente — Saúde do Sistema (§48)

`lib/saude/verificacoes/` já cobre orfandade referencial em 5+ domínios reais
(família/árvore órfã, workflow interno órfão/ambíguo, subtarefa órfã,
executor órfão, referência genérica órfã). **NÃO cobre ainda** (gap a
estender neste motor já existente, não criar plataforma nova):
- notificação acionável para entidade inexistente (pós-fato, hoje mitigado só estruturalmente pelo Cascade);
- projeção exibindo entidade removida;
- source of truth concorrente (ex.: `Fornecedor`×`OrgaoProtocolo`, `SolicitacaoDocumento.custoPago`×`ObrigacaoEconomica`);
- **alerta pré-exclusão quando uma `ObrigacaoEconomica` com `estadoCusto=PAGO`/`status=LIQUIDADO` está no blast radius de uma exclusão em curso** — o gap mais grave e mais barato de instrumentar (bastaria checar antes do delete, não depois).

## N. Blast radius das operações destrutivas mapeadas

| Ação | Blast radius | Reversibilidade | Protegida hoje? |
|---|---|---|---|
| Excluir Pessoa (via serviço canônico) | ALTO | Irreversível(hard)/Reversível(soft) | SIM |
| Excluir Árvore (via rota canônica) | CRÍTICO | Irreversível | SIM |
| **Excluir Processo (último da árvore)** | **CRÍTICO** | **Irreversível** | **NÃO** |
| Excluir Requerente | ALTO (financeiro) | Irreversível | PARCIAL |
| Excluir Fornecedor/OrgaoProtocolo com custo pendente | MÉDIO (hoje) / ALTO (por desenho) | Irreversível | PARCIAL (guarda 1 de N relações) |
| Excluir Tarefa (só via 2 portas conhecidas) | MÉDIO | Irreversível | PARCIAL (undo não checa estado operacional) |
| Excluir Documento origem de via derivada | MÉDIO | Irreversível (perde proveniência) | NÃO |
| Excluir Serviço | BAIXO | Reversível (desvincula) | SIM — exemplar |

## O. Gaps consolidados por severidade

**CRÍTICO**
1. `DELETE /api/processos/[processoId]`: sem análise de impacto, sem `fatosProtegidos`, sem confirmação, bypassa o guard de Árvore, cascateia até o Ledger pago. **Prioridade máxima de correção**, sujeita a autorização.

**ALTO**
2. `Pessoa.arvoreId` = `Cascade` inverte a direção real de ownership (identidade humana tratada como dependente técnica) — é a causa estrutural do item 1.
3. `Fornecedor` × `OrgaoProtocolo`: source of truth concorrente para o mesmo terceiro financeiro/operacional.
4. `DELETE /api/requerentes/[id]`: guarda incompleta (só `_count.processos`), não replica a régua financeira que `pessoa-ciclo-vida.ts` já sabe calcular.

**MÉDIO**
5. `executor-motor` "undo": engole falha de FK real como sucesso; não checa estado operacional da Tarefa antes de excluir.
6. `removerFornecedor`/`DELETE orgaos-protocolo`: guardas de exclusão cobrem 1 relação de uso, não a união real.
7. Saúde do Sistema não audita risco financeiro pré-exclusão nem source-of-truth concorrente.
8. Excluir Documento origem de via derivada apaga proveniência sem guard.
9. `NecessidadeDocumentalEvento` (histórico) cascateia com a Necessidade — funciona hoje só porque o hard-delete só roda com necessidade vazia.

**BAIXO**
10. Comentário desatualizado em `schema.prisma:5712` ("fornecedorId sem FK forte" — a FK existe).
11. Notificação com deep-link para entidade excluída — sem guard de leitura, risco estrutural sem incidente ativo.
12. Lacunas de PROVA (não de comportamento) em concorrência/financeiro para reentrada de fase.

## P. Plano mínimo de correção em ordem de dependência (NÃO EXECUTAR sem autorização)

1. **`DELETE /api/processos/[processoId]`**: antes de tocar na Árvore, chamar `analisarExclusaoArvore`/passar pela mesma régua de `pessoa-ciclo-vida.ts`; antes do delete do próprio Processo, checar (ou pelo menos alertar sobre) `ObrigacaoEconomica` com `estadoCusto` avançado no blast radius. É correção de WIRING (reusar mecanismo existente), não motor novo.
2. Estender `DELETE /api/requerentes/[id]` para reusar a mesma checagem financeira/protocolo que `pessoa-ciclo-vida.ts` já calcula (não duplicar lógica).
3. Estender `removerFornecedor`/`DELETE orgaos-protocolo` para checar a união real de relações (`ObrigacaoEconomica.fornecedorId` / `SubtaskExecution.fornecedorId` ativo), não só uma.
4. `executor-motor` "undo": trocar o `try/catch` silencioso por checagem explícita de estado operacional antes do delete, e reportar falha real em vez de assumir "já removido".
5. Adicionar ao motor de Saúde do Sistema (não criar novo): verificação de risco financeiro pré-existente sobre entidades no caminho de exclusões conhecidas, e um check de source-of-truth-concorrente (começando por Fornecedor×OrgaoProtocolo).
6. Decisão de negócio (fora de escopo técnico): reconciliar `Fornecedor` × `OrgaoProtocolo` — qual é a fonte de verdade financeira de um cartório-fornecedor daqui pra frente.
7. Guard leve em `novaViaDocumental`/exclusão de Documento para impedir apagar um Documento que é origem de via derivada sem primeiro resolver a proveniência.

Nenhum item exige migration de schema — todos são wiring/guard/reuso de mecanismo já existente, exceto o item 6, que é decisão de negócio (a implementação técnica dela, se houver, é discutida à parte).

---

# AUDITORIA DE INTEGRIDADE SISTÊMICA — CONCLUÍDA

Achado central: o Discovery já tem, na maior parte do domínio, exatamente
os mecanismos que o mandato pede (`pessoa-ciclo-vida.ts`,
`exclusao-definitiva.ts`, desacoplamento config/runtime, reabertura por
68 invariantes). O problema real encontrado não é falta de arquitetura —
é uma porta (`DELETE /api/processos/[processoId]`) que não usa a
arquitetura que o resto do sistema já provou funcionar, mais dois cadastros
financeiros/operacionais de terceiro que nunca convergiram para um só.

NÃO IMPLEMENTADO NADA NESTA RODADA — nenhuma correção, migration, remoção
de dado, cascata, ou reconciliação foi executada. Aguardando autorização
para o plano da seção P.
