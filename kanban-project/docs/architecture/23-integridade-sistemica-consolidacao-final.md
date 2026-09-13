# 23 — Integridade sistêmica: consolidação final executiva

Consolidado em 13/09/2026. Fecha a auditoria iniciada em
[21](21-integridade-sistemica-grafo-dependencias.md)/[22](22-integridade-sistemica-auditoria.md)
com 4 frentes de aprofundamento adicionais (grafo completo de Processo,
todas as portas de exclusão, diferenciação financeira, Fornecedor×OrgaoProtocolo).
**Só diagnóstico. Nada foi alterado — nenhum código, nenhum schema, nenhum
dado, nenhuma migration, nenhuma reconciliação.**

---

## 1. Todos os gaps consolidados (18 achados, classificados)

Detalhamento completo (todos os 17 campos pedidos) para os 4 achados
CRÍTICO/ALTO de maior impacto. Os demais 14 (MÉDIO/BAIXO/INFORMATIVO) têm
os campos essenciais na tabela consolidada da seção 10 — repetir os 17
campos para todos tornaria o documento ilegível sem ganho de informação.

### G1 — CRÍTICO — `DELETE /api/processos/[processoId]` destrói financeiro materializado

- **Entidade-raiz**: Processo.
- **Comportamento atual**: `prisma.processo.delete()` cru (sem `$transaction` própria, sem análise de impacto), seguido de `prisma.arvore.delete()` **escrito à mão na própria rota** (não é cascade de banco) se era o último processo da árvore.
- **Comportamento correto**: checar `ObrigacaoEconomica.processoId` por estado avançado (`estadoCusto∈{PAGO,CONCILIADO,CONTRATADO,EXECUTADO}` ou `status=LIQUIDADO`) e bloquear/exigir estorno antes; delegar a fatia Árvore/Pessoa ao MESMO fluxo de `analisarExclusaoArvore`/`removerPessoaDaArvore`, nunca chamar `arvore.delete()` direto.
- **Causa-raiz**: a rota foi escrita antes (ou à parte) do mecanismo de análise de impacto que `pessoa-ciclo-vida.ts`/`DELETE /api/arvore/[arvoreid]` já construíram — reimplementa, sem os guards, algo que já existe guardado em outro lugar.
- **Arquivos/funções**: `src/app/api/processos/[processoId]/route.ts:230-309`.
- **Dependências diretas** (confirmadas por linha do schema, independente de haver árvore): Tarefa (Cascade), NecessidadeDocumental (Cascade), **ObrigacaoEconomica direto** (Cascade, :5702), SolicitacaoDocumento (Cascade), PhaseWorkflowStepInstance (Cascade), WorkflowEvento (Cascade), PhaseAdvanceLog (Cascade), AnexoProcesso (Cascade), ~15 tabelas financeiras (ContaPagar/Transacao/Fatura/Recibo/Cobranca/Custo/Receita/TabelaValor/PendenciaFinanceira/CreditoMovimento, todas Cascade), ProcessoContratante/ProcessoRequerente (Cascade só do vínculo — Contratante/Requerente sobrevivem), MRG (LoteRegistral/PropostaReconciliacao/ConflitoRegistral, Cascade), DocumentoGerado (**SetNull**, correto), NotificacaoOperacional (Cascade, correto — é projeção acionável).
- **Dependências indiretas** (só se era o último processo da árvore): Arvore→Pessoa (Cascade)→Documento (Cascade)→**ObrigacaoEconomica** (Cascade, 2ª via, redundante com a direta)→DocumentoArquivo/SolicitacaoDocumento/Uniao; Arvore→NecessidadeDocumental (Cascade, redundante); Arvore→**VersaoGenealogica** (Cascade — **contradição confirmada**: o próprio comentário do modelo diz "nunca apagado por exclusão comum").
- **Blast radius**: CRÍTICO.
- **Risco para dados existentes**: ALTO — qualquer Processo com Ledger, histórico de eventos, ou (se última árvore) genealogia registrada é destruído fisicamente sem preview.
- **Risco financeiro**: MÁXIMO — obrigações `PAGO`/`LIQUIDADO` são apagadas fisicamente, não estornadas; **não depende de ser o último processo da árvore** (correção à hipótese inicial — a via direta Processo→ObrigacaoEconomica já basta).
- **Risco operacional**: ALTO — Tarefas/Workflows/StepInstances em andamento são apagados sem aviso a quem os executava.
- **Risco de órfãos**: BAIXO (a cascata é consistente — não deixa FK pendurada; o problema é o que ela apaga, não o que ela deixa quebrado).
- **Risco de efeitos zumbis**: BAIXO (nada recria o que foi apagado).
- **Menor correção canônica**: guard de serviço em 2 camadas (financeiro direto do Processo + delegação ao fluxo de Árvore já existente) antes do delete — sem tocar `onDelete` do schema.
- **Migration necessária?** NÃO.
- **Reconciliação necessária?** NÃO para código novo; **SIM, investigar** se algum Processo já foi excluído fisicamente no passado com Ledger pago perdido (auditoria de `LogAuditoria`/backup, fora do escopo desta rodada).
- **Dados existentes afetados**: nenhum HOJE por este código (é preventivo) — mas histórico de exclusões passadas não foi auditado nesta rodada.

### G2 — ALTO — `Pessoa.arvoreId = Cascade` inverte a direção real de ownership

- **Entidade-raiz**: Pessoa.
- **Comportamento atual**: Pessoa é tecnicamente dependente-Cascade de Árvore no schema.
- **Comportamento correto**: Pessoa é raiz semântica (identidade humana); Árvore deveria ser o agrupador que se desfaz, nunca a causa de apagar pessoas sem análise.
- **Causa-raiz**: modelagem original tratou Árvore como "container" quando deveria ser "visão" sobre Pessoas que têm existência própria.
- **Arquivos/funções**: `prisma/schema.prisma` (relação `Pessoa.arvore`).
- **Dependências diretas**: todas as de Pessoa (Documento, Uniao, Necessidade).
- **Dependências indiretas**: todo o financeiro/documental de cada Pessoa da árvore.
- **Blast radius**: ALTO (mitigado hoje pelo portão único `removerPessoaDaArvore`/`DELETE /api/arvore/[arvoreid]`, guardado).
- **Risco para dados existentes**: MÉDIO (só se acionado fora do portão canônico — ex.: G1, G6a).
- **Risco financeiro**: MÉDIO (mesma via).
- **Risco operacional**: BAIXO.
- **Risco de órfãos**: BAIXO.
- **Risco de efeitos zumbis**: NENHUM confirmado.
- **Menor correção canônica**: não é uma correção isolada — é a causa estrutural de G1/G6a; resolvida indiretamente ao garantir que TODA porta que possa apagar Árvore passe pelo fluxo canônico.
- **Migration necessária?** NÃO (mudar o `onDelete` exigiria reavaliar todo o resto do sistema que assume Cascade aqui — não recomendado nesta rodada; a correção é de portão de acesso, não de schema).
- **Reconciliação necessária?** NÃO.
- **Dados existentes afetados**: nenhum diretamente.

### G3 — ALTO — `pessoa-ciclo-vida.ts` é insuficiente por desenho para Processo

- **Entidade-raiz**: Processo (via tentativa de reaproveitar mecanismo de Pessoa).
- **Comportamento atual**: `levantarFatosProtegidos` calcula `obrigacaoIds` só a partir de `{personId}` OU `{documentoId: {in:...}}` — nunca olha `ObrigacaoEconomica.processoId` isolado (obrigação lançada no nível do processo, sem pessoa/documento — ex.: custo administrativo, contrato).
- **Comportamento correto**: uma checagem PRÓPRIA no nível de Processo, adicional a (não substituta de) `pessoa-ciclo-vida.ts`.
- **Causa-raiz**: o mecanismo foi desenhado para o caso de uso "remover pessoa", nunca precisou (até agora) cobrir obrigação sem pessoa.
- **Arquivos/funções**: `src/services/pessoa-ciclo-vida.ts` (`levantarFatosProtegidos`, linhas 240-360 conforme fork).
- **Dependências diretas**: `ObrigacaoEconomica.processoId` sem `personId`/`documentoId`.
- **Dependências indiretas**: nenhuma nova além do já mapeado em G1.
- **Blast radius**: faz parte do blast radius de G1 — não é um problema isolado, é a prova de que reaproveitar só este mecanismo NÃO fecha G1.
- **Risco para dados existentes**: incorporado a G1.
- **Risco financeiro**: incorporado a G1.
- **Risco operacional**: nenhum adicional.
- **Risco de órfãos**: nenhum.
- **Risco de efeitos zumbis**: nenhum.
- **Menor correção canônica**: nova função (pequena) `levantarFatosProtegidosDoProcesso` que verifica `ObrigacaoEconomica.processoId` diretamente, chamada ANTES de delegar a fatia Pessoa a `pessoa-ciclo-vida.ts`.
- **Migration necessária?** NÃO.
- **Reconciliação necessária?** NÃO.
- **Dados existentes afetados**: nenhum.

### G4 — ALTO — `Fornecedor` × `OrgaoProtocolo`: duplicação indevida confirmada

- **Entidade-raiz**: nenhuma raiz única — dois cadastros paralelos do mesmo conceito de negócio ("a quem eu pago").
- **Comportamento atual**: `Fornecedor` (Financeiro/Ledger: `ContaPagar`, 2×`ProdutoFinanceiro`, `ObrigacaoEconomica`) e `OrgaoProtocolo+FuncaoOrganizacao=FORNECEDOR` (Operacional: protocolo, canal, `SubtaskExecution`, e JÁ carrega campos financeiros inline — `formaPagamento`/`chavePix`/`banco`/`prazoPagamentoDias`/`statusFinanceiro`) nunca convergem. **Prova direta, não interpretação**: o próprio comentário de `DOMINIO_FORNECEDORES` (`src/lib/relatorios/motor/dominios/fornecedores.ts:1-6`) declara *"não existe cadastro separado de fornecedor: é a mesma organização de Órgãos"* — a doutrina pretendida já contradiz a tabela `Fornecedor` existir e ser usada pelo Ledger real.
- **Comportamento correto**: uma identidade financeira única por terceiro real (cartório/despachante que cobra), sem exigir cadastro duplicado.
- **Causa-raiz**: o Financeiro V3 (Ledger) nasceu como módulo próprio e reusou/recriou um cadastro de fornecedor genérico em vez de apontar para o cadastro mestre de Órgãos e Organizações já existente.
- **Arquivos/funções**: `src/services/fornecedor.ts`, `src/app/api/gerenciamento/orgaos-protocolo/**`, `lib/financeiro/**` (4 FKs: `ContaPagar.fornecedorId`, `ProdutoFinanceiro.fornecedorPadraoId`, `ProdutoFinanceiro.fornecedorId`, `ObrigacaoEconomica.fornecedorId`).
- **Dependências diretas**: as 4 FKs acima (para `Fornecedor`) + 7 relações operacionais reais (para `OrgaoProtocolo`).
- **Dependências indiretas**: qualquer relatório/indicador que cruze "quanto pagamos a fornecedores" com "quais órgãos usamos" hoje não bate, porque são dois universos de IDs.
- **Blast radius**: ALTO se um mesmo cartório tiver dados bancários DIFERENTES cadastrados nos dois lugares (pagamento pode ir para conta errada) — não confirmado como incidente ativo, é risco estrutural.
- **Risco para dados existentes**: MÉDIO-ALTO (divergência silenciosa de dados cadastrais, não perda).
- **Risco financeiro**: ALTO (pagamento para dados bancários desatualizados/divergentes).
- **Risco operacional**: BAIXO.
- **Risco de órfãos**: NENHUM (zero vínculo estrutural entre os dois — não há FK para quebrar).
- **Risco de efeitos zumbis**: NENHUM.
- **Menor correção canônica**: NÃO decidida nesta rodada (é decisão de negócio) — 3 opções reais levantadas: (a) vínculo opcional `Fornecedor.orgaoProtocoloId`; (b) convergir para `OrgaoProtocolo` como fonte única (bate com a doutrina já escrita no código, mas exige migrar as 4 FKs e resolver o caso "fornecedor corporativo puro" não-protocolar); (c) manter os dois com semântica restrita (Fornecedor só não-protocolar) + Ledger apontando para qualquer um dos dois.
- **Migration necessária?** SIM, se a opção (b) ou (c) for escolhida — NÃO se for só (a).
- **Reconciliação necessária?** SIM, em qualquer opção — dados bancários dos dois cadastros precisam ser comparados/unificados.
- **Dados existentes afetados**: todos os `Fornecedor` e `OrgaoProtocolo+FORNECEDOR` reais — contagem exata não obtida nesta rodada (evitou-se nova query de produção); fica pendente para uma rodada de leitura dedicada.

### Demais 14 gaps (campos essenciais — ver tabela completa na seção 10)

| ID | Severidade | Achado | Causa-raiz | Menor correção | Migration | Reconciliação |
|---|---|---|---|---|---|---|
| G5 | ALTO | `DELETE /api/requerentes/[id]` só checa `_count.processos` | guard nunca estendida para financeiro/protocolo | reusar a régua de `pessoa-ciclo-vida.ts` | NÃO | NÃO |
| G6a | MÉDIO | `limpar-arvores-orfas` (admin) cascateia sem `fatosProtegidos` | ferramenta de limpeza criada antes do guard existir | chamar `analisarExclusaoArvore` antes de apagar | NÃO | NÃO |
| G6b | MÉDIO | `DELETE processos/[id]/servicos/[servicoId]` cascateia custo sem checar `estadoCusto` | mesmo padrão de G1, escopo menor | checagem financeira antes do delete | NÃO | NÃO |
| G7 | MÉDIO (categoria distinta) | `DELETE /api/anexos` sem RBAC nenhum | função `DELETE` nunca chamou `verificarPermissao` | adicionar checagem de permissão | NÃO | NÃO |
| G8 | MÉDIO | `removerFornecedor`/`DELETE orgaos-protocolo`: guarda cobre 1 relação de uso, não todas | guard escrita para o caso mais óbvio, não revisitada | estender para checar `ObrigacaoEconomica.fornecedorId`/`SubtaskExecution.fornecedorId` ativo | NÃO | NÃO |
| G9 | MÉDIO | `executor-motor` "undo" engole falha de FK, não checa estado da Tarefa | `try/catch` genérico tratando qualquer erro como "já removido" | checagem explícita + logar falha real | NÃO | NÃO |
| G10 | MÉDIO | 3 implementações paralelas de cancelamento/estorno com rigor desigual | evolução em 3 momentos (legado, V3-Receita, V3-Obrigação) sem consolidar | decisão de qual vira a única porta para `ObrigacaoEconomica` | NÃO | possível, a decidir |
| G11 | MÉDIO | Saúde do Sistema não audita risco financeiro pré-exclusão nem source-of-truth concorrente | motor construído para orfandade referencial, não para estes casos | estender o motor existente (não criar novo) | NÃO | NÃO |
| G12 | BAIXO-MÉDIO | Excluir Documento origem de via derivada apaga proveniência sem guard | `SetNull` silencioso em `derivadoDeId` | checar `derivados.length>0` antes de permitir exclusão | NÃO | NÃO |
| G13 | BAIXO-MÉDIO | `NecessidadeDocumentalEvento` cascateia com a Necessidade | histórico modelado como dependência exclusiva | avaliar se deveria sobreviver (decisão de negócio) | NÃO | NÃO |
| G14 | BAIXO | Comentário desatualizado `schema.prisma:5712` | FK foi adicionada depois do comentário ser escrito | corrigir o texto do comentário | NÃO | NÃO |
| G15 | BAIXO | Notificação com deep-link sem guard de existência | leitura de `link` como texto opaco | tela de destino trata ID inexistente com "não encontrado" | NÃO | NÃO |
| G16 | BAIXO | Lacunas de PROVA (não de comportamento) para reentrada de fase | testes da Etapa 6 não cobriram financeiro/concorrência deste caso específico | escrever teste adicional | NÃO | NÃO |
| G17 | INFORMATIVO | `SubtaskExecution.fornecedorId`→OrgaoProtocolo vs `ObrigacaoEconomica.fornecedorId`→Fornecedor (mesmo nome, alvos diferentes) | dois domínios usando o mesmo nome de campo por coincidência | nenhuma ação obrigatória; nomear diferente numa refatoração futura | NÃO | NÃO |
| G18 | INFORMATIVO | `DomainOutbox.aggregateId` solto, não limpo na exclusão de Processo | desenho intencional (idempotência cobre reprocessamento) | nenhuma ação necessária | NÃO | NÃO |

---

## 2. DELETE de Processo — grafo completo provado

```
Processo (id=X)
│
├─Cascade─▶ Tarefa ──Cascade──▶ TarefaHistorico[HISTÓRICA], WorkflowEvento[HISTÓRICA],
│                                 NotificacaoOperacional[PROJEÇÃO,correto apagar],
│                                 SolicitacaoDocumento[EXCLUSIVA], TarefaDependencia[EXCLUSIVA]
├─Cascade─▶ NecessidadeDocumental ──Cascade──▶ NecessidadeDocumentalEvento[HISTÓRICA]
├─Cascade─▶ ObrigacaoEconomica [FINANCEIRA MATERIALIZADA] ──Cascade──▶ Ledger, LedgerEntry,
│                                 OcorrenciaFinanceira, DistribuicaoEconomica, ParcelaPagavel,
│                                 RepasseCusto  [todos FINANCEIRA MATERIALIZADA — inclui PAGO/LIQUIDADO]
├─Cascade─▶ SolicitacaoDocumento [EXCLUSIVA]
├─Cascade─▶ PhaseWorkflowStepInstance [EXCLUSIVA] ──Cascade──▶ StepExecution, SubtaskExecution
├─Cascade─▶ WorkflowEvento [HISTÓRICA]           (direto do Processo, não só via Tarefa)
├─Cascade─▶ PhaseAdvanceLog [HISTÓRICA]
├─Cascade─▶ AnexoProcesso [EXCLUSIVA]
├─Cascade─▶ NotificacaoOperacional [PROJEÇÃO, correto]
├─Cascade─▶ ~15 tabelas financeiras: ContaPagar, Transacao, Fatura, Recibo, Cobranca, Custo,
│                                 Receita, TabelaValor, PendenciaFinanceira, CreditoMovimento
│                                 [todas FINANCEIRA MATERIALIZADA]
├─Cascade(só o vínculo)─▶ ProcessoContratante, ProcessoRequerente [REFERÊNCIA —
│                                 Contratante/Requerente sobrevivem]
├─Cascade─▶ LoteRegistral, PropostaReconciliacao, ConflitoRegistral [EXCLUSIVA, domínio MRG]
├─SetNull─▶ DocumentoGerado [REFERÊNCIA, correto — preservado]
├─(sem FK)─ DomainOutbox.aggregateId [REFERÊNCIA solta, não limpa nem reprocessa indevidamente]
├─(nenhuma tabela) Fase/Progresso [PROJEÇÃO — computada na leitura, desaparece sozinha]
├─(sem FK direta) "Ocorrências" só existem via Processo→ObrigacaoEconomica→OcorrenciaFinanceira
│                                 (2 saltos, ambos Cascade) [FINANCEIRA MATERIALIZADA]
│
└─(SE era o último processo da Árvore — CÓDIGO EXPLÍCITO na rota, NÃO cascade de banco)
     Arvore ──Cascade──▶ Pessoa ──Cascade──▶ Documento ──Cascade──▶ ObrigacaoEconomica
                          │                                         [2ª via, FINANCEIRA MATERIALIZADA,
                          │                                          redundante com a direta acima]
                          └─Cascade─▶ Uniao[EXCLUSIVA]
     Arvore ──Cascade──▶ NecessidadeDocumental (via arvoreId, redundante com a direta)
     Arvore ──Cascade──▶ VersaoGenealogica [HISTÓRICA — ⚠ CONTRADIÇÃO: o comentário do
                          próprio modelo diz "nunca apagado por exclusão comum", mas o
                          `onDelete` real é Cascade]
     Arvore ──SetNull──▶ LoteRegistral/PropostaReconciliacao/ConflitoRegistral (via arvoreId)
```

**Correção à hipótese inicial da auditoria 22**: o risco financeiro **não depende de o
Processo ser o último da Árvore** — a via direta `Processo→ObrigacaoEconomica` (Cascade)
já é suficiente para destruir o Ledger, com ou sem árvore envolvida. A branch da Árvore é
um risco **adicional e independente** (genealogia + 2ª via financeira redundante), não uma
pré-condição.

**Ação por nó** (o que deve acontecer numa exclusão legítima de Processo):

| Classe | Nós | Ação |
|---|---|---|
| EXCLUSIVA | Tarefa, NecessidadeDocumental, SolicitacaoDocumento, StepInstance, AnexoProcesso, MRG | REMOVER |
| FINANCEIRA MATERIALIZADA, ainda não paga | ObrigacaoEconomica `PREVISTO`/`RASCUNHO` | pode REMOVER |
| FINANCEIRA MATERIALIZADA, já paga | ObrigacaoEconomica `PAGO`/`CONCILIADO`/`LIQUIDADO` | **ESTORNAR/CANCELAR — nunca remover fisicamente** |
| HISTÓRICA | WorkflowEvento, PhaseAdvanceLog, TarefaHistorico, VersaoGenealogica | **PRESERVAR** (hoje são removidos — é gap, incorporado a G1) |
| REFERÊNCIA | DocumentoGerado, ProcessoContratante/Requerente (vínculo), DomainOutbox | DESVINCULAR (já correto, exceto o vínculo que soma ao ownership real de Requerente/Contratante) |
| PROJEÇÃO | NotificacaoOperacional, Fase/Progresso | REMOVER/RECALCULAR (já correto) |

---

## 3. Todas as portas de exclusão (consolidado)

| Entidade | Porta | Guardada? | Mesmo padrão do bug crítico? |
|---|---|---|---|
| Processo | `DELETE /api/processos/[processoId]` | **NÃO** | **SIM — é o G1** |
| Processo/serviço | `DELETE processos/[id]/servicos/[servicoId]` | PARCIAL | SIM, escopo menor (G6b) |
| Árvore | `DELETE /api/arvore/[arvoreid]` | SIM (`fatosProtegidos`+frase) | Não |
| Árvore (em massa) | `admin/limpar-arvores-orfas` | PARCIAL (RBAC+frase, sem `fatosProtegidos`) | SIM, mitigado por raridade (G6a) |
| Pessoa | `removerPessoaDaArvore` (único portão) | SIM | Não |
| Família | `DELETE /api/familias/[id]` | SIM (`_count` de processos+árvores) | Não |
| Família (residual) | `removerFamiliaSeOrfa` | SIM (rechecagem) | Não |
| Requerente | `DELETE /api/requerentes/[id]` | PARCIAL (só `_count.processos`) | Sim, escopo financeiro (G5) |
| Necessidade | `removerNecessidadesDoSujeito` | SIM | Não |
| Documento | `removerDocumentosPorId`/`removerDocumentosDoSujeito` | SIM | Não |
| Anexo (Requerente/Contratante) | `DELETE /api/anexos` | **NÃO (RBAC ausente)** | Categoria diferente (G7) |
| Tarefa | `pessoa-ciclo-vida.ts` (dentro do fluxo guardado) | SIM | Não |
| Tarefa | `executor-motor` admin "undo" | PARCIAL (não checa estado operacional) | Sim, escopo restrito a admin (G9) |
| Serviço/ServicoProduto | `exclusao-definitiva.ts::deleteService` | SIM (exemplar — trava+reanálise+ordem) | Não |
| Fornecedor | `removerFornecedor` | PARCIAL (1 de N relações) | Sim, escopo financeiro (G8) |
| OrgaoProtocolo | `DELETE orgaos-protocolo/[id]` | PARCIAL (1 de N relações) | Sim (G8) |
| ObrigacaoEconomica | `removerObrigacaoOrfaTx` / `pessoa-ciclo-vida.ts::executarHard` | SIM (2 de 2 pontos auditados) | Não — **mas é acionável indiretamente via cascade de Documento/Processo (G1)** |
| Protocolo (vínculos) | `DELETE /api/protocolos/[id]` | não avaliado a fundo | não avaliado |

**Resposta direta à pergunta do usuário**: sim, o mesmo padrão do bug crítico (exclusão
operacional cascateando sobre financeiro/histórico sem análise de impacto) é acessível
por **pelo menos 3 outras portas** (G6a, G6b, e indiretamente qualquer exclusão de
Documento fora do serviço guardado, hipótese não descartada por nenhuma frente).

---

## 4. Por que não é "adicionar/remover onDelete: Cascade"

Nenhuma correção recomendada nesta consolidação toca uma anotação `onDelete` no schema.
Em todos os 4 achados críticos/altos (G1-G4), a correção é de **nível de serviço**: uma
checagem que roda ANTES da operação de banco, delegando para mecanismos que já existem e
já são corretos (`pessoa-ciclo-vida.ts`, `analisarExclusaoArvore`, a régua financeira de
`removerObrigacaoOrfaTx`). Trocar o `Cascade` por `Restrict` quebraria o caso legítimo (uma
Pessoa/Documento/Processo SEM fato protegido, que deve poder ser excluído fisicamente sem
fricção) — o problema nunca foi a anotação do Prisma, foi a ausência de uma pergunta ao
domínio antes de chegar nela.

---

## 5. `pessoa-ciclo-vida.ts` como referência — o que prova, o que não cobre

**Invariantes que protege** (`fatosProtegidos`, todos com código real por trás):
`PROTOCOLO_ENVIADO`, `PROTOCOLO_DE_DOCUMENTO`, `ARQUIVO_OFICIAL` (FK `Restrict` —
impossível apagar por construção), `SOLICITACAO_ENVIADA`, `DOCUMENTO_GERADO`,
`ANEXO_DO_REQUERENTE`, `PAGAMENTO_OU_MOVIMENTO`, `LANCAMENTO_CONTABIL`,
`FATURA_EMITIDA`, `PAGAMENTO_RECEBIDO`, `RECIBO_EMITIDO`. Deliberadamente NÃO trata
`OBRIGACAO_CRIADA` (só nascimento, sem liquidação) como protegida — removida junto no
hard delete, e isso é correto por desenho.

**O que NÃO trata** (confirmado por leitura direta de `levantarFatosProtegidos`):
`ObrigacaoEconomica.processoId` sem `personId`/`documentoId` — uma obrigação lançada
no nível do Processo (contrato, custo administrativo) é **invisível** para este
mecanismo, porque ele só constrói `obrigacaoIds` a partir da Pessoa ou dos Documentos
dela.

**Pode ser reaproveitado para Processo?** SIM, mas **não sozinho** — cobre corretamente
a fatia Pessoa/Árvore/Documento; falta uma checagem PRÓPRIA e adicional no nível
Processo (G3). Forçar reaproveitamento sem essa checagem adicional daria falsa sensação
de segurança — exatamente o que o usuário pediu para não fazer.

---

## 6. Financeiro — diferenciação provada

| Conceito pedido | Nome real | Campo/mecanismo |
|---|---|---|
| Previsão | `estadoCusto = PREVISTO` | inicial, `estado-custo.ts` |
| Obrigação | `ObrigacaoEconomica` criada | `ledger-service.ts` |
| Lançamento | `LedgerEntry` | `registrarLancamento` |
| Pagamento | `estadoCusto = PAGO` / `SaldoProjecao.recebidoBruto>0` | `estado-custo.ts` |
| Liquidação | `status = LIQUIDADO` | `obrigacao-economica.ts` |
| Cancelamento | `status → CANCELADO` (antes de pago) | 3 implementações (G10) |
| Estorno | `OcorrenciaFinanceira.tipo='ESTORNO'` + reversão dos entries | `cancelar-lancamento.ts` |
| Histórico | `LedgerEntry`/`OcorrenciaFinanceira` — nunca reescritos | consistente |

**Onde a cascata é perigosa — provado, não hipotético**: as 2 rotas financeiras diretas
que apagam `ObrigacaoEconomica` (`pessoa-ciclo-vida.ts::executarHard`,
`removerObrigacaoOrfaTx`) **já bloqueiam corretamente** se há pagamento real
(`recebidoBruto>0.005` lança erro; `fatosProtegidos` inclui `PAGAMENTO_OU_MOVIMENTO`).
O único caminho real de perda é que `ObrigacaoEconomica.documentoId`/`.processoId` são
`onDelete: Cascade` — apagar o Documento ou o Processo PAI ignora as duas guardas
acima por completo, porque a exclusão acontece no banco, não em código de aplicação.
Isto é exatamente G1, agora confirmado também pelo lado financeiro.

---

## 7. `Fornecedor` × `OrgaoProtocolo` — veredito

**Duplicação indevida confirmada**, não dois domínios legítimos sem vínculo — ver G4 para
o detalhamento completo e as 3 opções reais de convergência levantadas (nenhuma decidida
nesta rodada). Contagem exata de registros reais não obtida (evitou-se nova query de
produção); fica pendente de uma leitura dedicada antes de qualquer decisão de convergência.

---

## 8. Orfandade e efeitos zumbis — consolidado final

| Categoria | Casos encontrados | Status |
|---|---|---|
| Órfão referencial | nenhum ativo nos dados já auditados (Processo 592: zero FK pendente) | sem incidente ativo |
| Órfão semântico | Tarefa 3570 (`necessidadeId=null` com `documentoId` resolvendo); Documento `RECEBIDO` sem `DocumentoArquivo` tipado | confirmados, menores, não causados por exclusão |
| Tarefa sem origem legítima | não encontrada | descartado |
| Documento sem necessidade | existe por desenho (`necessidadeId` nullable) — não investigado se todo caso é legítimo | em aberto, não confirmado como bug |
| Necessidade sem pessoa válida | não encontrado (Cascade garante consistência) | descartado |
| Follow-up de operação removida | Tarefa cancelada aguardando terceiro: `SolicitacaoDocumento` associada não confirmada como fechada em conjunto | **gap a investigar, não confirmado** |
| Notificação acionável de objeto inexistente | mecanismo sem guard de leitura (G15) | confirmado, risco baixo hoje |
| Cron capaz de recriar entidade removida | nenhum confirmado (idempotência + gate por status atual em todos os pontos auditados) | descartado |
| Custo sem origem | não encontrado | descartado |
| Obrigação inexistente bloqueando fase | não investigado nesta rodada | não avaliado |
| Projeção exibindo objeto removido | não coberto pelo motor de Saúde do Sistema (G11) | gap de cobertura, não incidente confirmado |

---

## 9. Invariantes globais — lista final

| Invariante | Status | Onde |
|---|---|---|
| Notificação nunca aponta para Tarefa/Processo removido | ✅ GARANTIDA | Cascade estrutural |
| Histórico (LogAuditoria) sobrevive a qualquer exclusão | ✅ GARANTIDA | sem FK, por desenho |
| Config nunca cascata para runtime | ✅ GARANTIDA | snapshot sem FK |
| Reabrir preserva identidade (nunca recria) | ✅ GARANTIDA | 68 invariantes travados em build |
| Criação de Processo / avanço de fase são atômicos | ✅ GARANTIDA | `$transaction` confirmado |
| Nenhum fato financeiro pago é apagado por ação financeira direta | ✅ GARANTIDA | `removerObrigacaoOrfaTx`/`executarHard` |
| **Nenhum fato financeiro pago é apagado por exclusão de PAI (Documento/Processo)** | ❌ **NÃO GARANTIDA** | G1 |
| Um terceiro tem identidade financeira única | ❌ **NÃO GARANTIDA** | G4 |
| Toda exclusão relevante passa por análise de impacto | ⚠️ **PARCIALMENTE GARANTIDA** | forte em Pessoa/Árvore/Documento/Necessidade/Serviço; ausente em Processo/parcial em Requerente/Fornecedor/OrgaoProtocolo |
| Toda porta de exclusão tem RBAC | ⚠️ **PARCIALMENTE GARANTIDA** | ausente em `/api/anexos` (G7) |
| Cancelamento/estorno tem rigor único e consistente | ❌ **NÃO GARANTIDA** | G10 (3 implementações) |
| Motor de integridade (Saúde do Sistema) cobre todas as classes de risco deste mandato | ⚠️ **PARCIALMENTE GARANTIDA** | cobre orfandade referencial; não cobre financeiro-pré-exclusão nem source-of-truth-concorrente (G11) |

---

## 10. Matriz final de decisão

| ID | Severidade | Entidade-raiz | Problema | Causa-raiz | Blast radius | Dados existentes em risco | Financeiro em risco | Correção canônica | Migration? | Reconciliação? | Ordem |
|---|---|---|---|---|---|---|---|---|---|---|---|
| G1 | CRÍTICO | Processo | Delete cru cascateia até Ledger pago + bypassa guard de Árvore | rota não usa mecanismo já existente | CRÍTICO | SIM | SIM (máximo) | guard de serviço em 2 camadas | NÃO | investigar histórico (não bloqueante) | 1 |
| G3 | ALTO | Processo | `pessoa-ciclo-vida.ts` não cobre obrigação sem pessoa/documento | mecanismo desenhado só p/ Pessoa | incorporado a G1 | incorporado | incorporado | nova função de checagem no nível Processo | NÃO | NÃO | 1 (junto com G1) |
| G2 | ALTO | Pessoa | `Pessoa.arvoreId=Cascade` inverte ownership | modelagem trata Árvore como container | ALTO (mitigado hoje) | MÉDIO | MÉDIO | garantir todo acesso via portão canônico | NÃO | NÃO | 2 |
| G5 | ALTO | Requerente | guarda de delete incompleta | nunca estendida p/ financeiro | ALTO | SIM | SIM | reusar régua de `pessoa-ciclo-vida.ts` | NÃO | NÃO | 3 |
| G4 | ALTO | (transversal) | Fornecedor×OrgaoProtocolo concorrentes | dois módulos nunca convergiram | ALTO (latente) | MÉDIO-ALTO | ALTO | decisão de negócio + convergência | SIM (se convergir) | SIM | 4 (decisão antes de código) |
| G6a | MÉDIO | Árvore | limpeza em massa sem `fatosProtegidos` | ferramenta pré-guard | MÉDIO | MÉDIO (raro) | MÉDIO (raro) | chamar `analisarExclusaoArvore` | NÃO | NÃO | 5 |
| G6b | MÉDIO | Processo/Serviço | delete de TipoServico cascateia custo | mesmo padrão G1, escopo menor | MÉDIO | MÉDIO | MÉDIO | checagem financeira antes | NÃO | NÃO | 5 |
| G7 | MÉDIO | Requerente/Anexo | DELETE sem RBAC | checagem esquecida | MÉDIO | BAIXO | NENHUM | adicionar `verificarPermissao` | NÃO | NÃO | 6 |
| G8 | MÉDIO | Fornecedor/OrgaoProtocolo | guarda cobre 1 de N relações | guard não revisitada | MÉDIO | MÉDIO | MÉDIO | estender checagem | NÃO | NÃO | 6 |
| G9 | MÉDIO | Tarefa | undo engole falha, não checa estado | try/catch genérico | MÉDIO | BAIXO | NENHUM | checagem explícita + log | NÃO | NÃO | 6 |
| G10 | MÉDIO | (transversal financeiro) | 3 implementações de cancelar/estornar | evolução em 3 momentos | MÉDIO | BAIXO | MÉDIO | unificar porta canônica | NÃO | possível | 7 |
| G11 | MÉDIO | (transversal) | Saúde do Sistema não cobre financeiro/concorrência | motor não estendido | MÉDIO | — | — | estender motor existente | NÃO | NÃO | 8 |
| G12 | BAIXO-MÉDIO | Documento | exclusão de origem apaga proveniência | SetNull silencioso | BAIXO | BAIXO | NENHUM | guard antes do delete | NÃO | NÃO | 9 |
| G13 | BAIXO-MÉDIO | NecessidadeDocumental | histórico cascateia | modelagem | BAIXO | BAIXO | NENHUM | decisão de negócio | NÃO | possível | 9 |
| G14 | BAIXO | ObrigacaoEconomica | comentário desatualizado | doc não atualizada | NENHUM | NENHUM | NENHUM | corrigir texto | NÃO | NÃO | 10 |
| G15 | BAIXO | NotificacaoOperacional | deep-link sem guard | leitura de texto opaco | BAIXO | NENHUM | NENHUM | tela trata "não encontrado" | NÃO | NÃO | 10 |
| G16 | BAIXO | Fase/Tarefa | lacuna de prova (não de comportamento) | teste não escrito | NENHUM | NENHUM | NENHUM | escrever teste | NÃO | NÃO | 10 |
| G17 | INFORMATIVO | (transversal) | mesmo nome de campo, alvos diferentes | coincidência de nomenclatura | NENHUM | NENHUM | NENHUM | nenhuma ação obrigatória | NÃO | NÃO | — |
| G18 | INFORMATIVO | Processo | `DomainOutbox` solto | desenho intencional | NENHUM | NENHUM | NENHUM | nenhuma ação | NÃO | NÃO | — |

---

## 11. Plano de correção em ordem de dependência (NÃO EXECUTAR sem autorização)

**Etapa 1 — Fechar G1+G3 (a mais urgente; sem isso, nada mais importa)**
- Objetivo: `DELETE /api/processos/[processoId]` nunca destrói financeiro materializado nem bypassa o guard de Árvore.
- Arquivos: `src/app/api/processos/[processoId]/route.ts`; nova função em `src/services/pessoa-ciclo-vida.ts` ou módulo próprio (`processo-ciclo-vida.ts`) para a checagem de `ObrigacaoEconomica.processoId`.
- Antes: delete cru + `arvore.delete()` manual. Depois: (1) checar `ObrigacaoEconomica.processoId` por estado avançado → bloquear com mensagem clara; (2) delegar fatia Árvore/Pessoa a `analisarExclusaoArvore`/`removerPessoaDaArvore`; (3) só então `processo.delete()`.
- Invariantes protegidas: "nenhum fato financeiro pago é apagado por exclusão de PAI"; "toda exclusão de Árvore passa pelo guard canônico".
- Testes necessários: ver seção 12 (todos os cenários de Processo).
- Dados existentes afetados: nenhum (mudança preventiva) — mas recomendo, como tarefa separada e não bloqueante, auditar se algum Processo já foi excluído no passado com Ledger pago perdido.
- Dry-run necessário: SIM, antes de habilitar o bloqueio em produção — rodar a nova checagem em modo "log apenas" contra processos candidatos a exclusão conhecidos, para calibrar falsos positivos.
- Autorização adicional necessária: SIM, antes de tocar a rota.

**Etapa 2 — G2 (estrutural, decorre da 1)**
- Objetivo: garantir que nenhuma outra porta possa apagar Árvore sem o guard.
- Arquivos: auditoria de todo `prisma.arvore.delete()`/`prisma.pessoa.delete()` no repo (grep de vigilância, não mudança de schema).
- Testes: grep automatizado em CI (como já existe para outros invariantes do projeto) proibindo chamada direta fora dos 2 arquivos aprovados.

**Etapa 3 — G5, G6a, G6b, G7, G8, G9 (guards independentes entre si, podem paralelizar)**
- Cada um é uma correção pontual e isolada — sem dependência entre eles.

**Etapa 4 — G4 (decisão de negócio primeiro, código depois)**
- Objetivo: decidir a identidade canônica de "a quem se paga" ANTES de qualquer código.
- Não iniciar implementação sem essa decisão explícita do usuário.

**Etapa 5 — G10, G11 (consolidação transversal)**
- G10: escolher a porta canônica de cancelamento/estorno para `ObrigacaoEconomica`.
- G11: estender Saúde do Sistema com os 2 checks novos (financeiro pré-exclusão, source-of-truth concorrente).

**Etapa 6+ — G12, G13, G14, G15, G16 (baixo risco, sem urgência, podem entrar em qualquer PR de manutenção)**

---

## 12. Testes de aceite futuros (definidos agora, não executados)

Para a correção de G1 (mínimo obrigatório antes de considerar "concluído"):

1. Excluir Pessoa (sem fato protegido) → sucesso, hard-delete, nada além do esperado apagado.
2. Excluir Requerente (sem fato financeiro/protocolo) → sucesso; COM fato → bloqueado (novo, prova G5).
3. Excluir Processo sem Ledger/histórico relevante → sucesso.
4. Excluir Processo com `ObrigacaoEconomica` `PAGO`/`LIQUIDADO` → **bloqueado**, mensagem clara, nada apagado.
5. Excluir Processo que é o último da Árvore, sem fato protegido em nenhuma Pessoa → sucesso, delega corretamente a `analisarExclusaoArvore`.
6. Excluir Processo que é o último da Árvore, com Pessoa tendo documento validado → **bloqueado**.
7. Excluir Processo com documentos (sem financeiro) → sucesso, documentos removidos corretamente.
8. Excluir Processo com Tarefas abertas → sucesso ou bloqueio conforme decisão de negócio (a definir — hoje não há guard nenhum; decidir se Tarefa aberta deve impedir).
9. Excluir Processo com Tarefa aguardando terceiro → idem.
10. Excluir Processo com custos pendentes (não pagos) → sucesso, custos removidos.
11. Tentar excluir Processo com pagamento/liquidação existente → **bloqueado** (mesmo que 4, caso central).
12. Concorrência: duas requisições de exclusão simultâneas do mesmo Processo → uma sucede, outra recebe erro claro (não duplica cascata, não corrompe).
13. Retry da exclusão após falha parcial → idempotente, não deixa estado intermediário.
14. Cron rodando logo após a exclusão → não recria nada do que foi apagado.
15. Reconciliação (`reconciliar-fases`/Saúde do Sistema) após a exclusão → não aponta órfão novo, não tenta "consertar" o que foi legitimamente removido.
16. Projeções (`tarefa-projecoes.ts`, dashboards) após a exclusão → processo some de todas as listagens, sem resíduo.
17. Fase/progresso: nenhuma fase de outro processo é afetada.
18. RBAC: usuário sem `processos.excluir` recebe 403 antes de qualquer checagem de impacto rodar.
19. Histórico: `LogAuditoria` registra a exclusão com ator/motivo/entidades afetadas, mesmo com o Processo já não existindo.
20. Nenhuma entidade fantasma: após qualquer um dos cenários acima, rodar a checagem de integridade (Saúde do Sistema) e confirmar zero achados novos.
21. Nenhum efeito zumbi: nenhuma notificação pendente relacionada ao Processo excluído aparece no sino de nenhum usuário depois.

---

## 13. Veredito

1. **O Discovery possui hoje alguma exclusão capaz de destruir dados que deveriam ser preservados?** SIM — `DELETE /api/processos/[processoId]` (G1), confirmada com prova de schema.
2. **Existem outras portas com o mesmo risco além de DELETE Processo?** SIM — `limpar-arvores-orfas` (G6a) e exclusão de `TipoServico` do processo (G6b), ambas de risco menor por escopo/raridade.
3. **Existe hoje alguma cascata de banco substituindo incorretamente lifecycle de negócio?** SIM — `ObrigacaoEconomica.documentoId`/`.processoId` = `Cascade` faz o papel que deveria ser de uma decisão de aplicação (estornar antes de apagar); e `VersaoGenealogica` tem Cascade que contradiz seu próprio comentário de design.
4. **Existem órfãos reais no banco hoje?** Órfãos REFERENCIAIS: nenhum confirmado nos dados já auditados. Órfãos SEMÂNTICOS: 2 casos menores confirmados (Tarefa 3570; Documento sem arquivo tipado), nenhum causado por exclusão.
5. **Existem efeitos zumbis possíveis hoje?** Confirmados de baixo risco: notificação com deep-link sem guard (G15), `executor-motor` undo engolindo falha (G9). Nenhum cron/reconciliação capaz de recriar entidade removida foi encontrado.
6. **O financeiro pode ser apagado por consequência de exclusão operacional?** SIM — exatamente o mecanismo de G1; as rotas financeiras diretas já se protegem corretamente, o problema é a cascata a partir do PAI (Documento/Processo).
7. **Fornecedor × OrgaoProtocolo é realmente uma source of truth concorrente?** SIM, confirmado — inclusive pelo próprio comentário do código do sistema, que já declara que não deveria haver cadastro separado.
8. **Alguma migration é realmente necessária?** Só condicionalmente: se a convergência de G4 escolher unificar os dois cadastros (opções b/c da seção 7). Nenhuma outra correção desta rodada exige migration.
9. **Alguma reconciliação de dados existentes será necessária?** SIM, para G4 (dados bancários divergentes entre os dois cadastros) e recomendável (não bloqueante) para G1 (auditar se algum Processo já foi excluído no passado com Ledger pago perdido).
10. **Qual é a ordem exata recomendada das correções?** G1+G3 (urgente) → G2 (vigilância estrutural) → G5/G6a/G6b/G7/G8/G9 (guards independentes, paralelizáveis) → G4 (decisão de negócio primeiro) → G10/G11 (consolidação transversal) → G12-G16 (manutenção, sem urgência).

---

# AUDITORIA SISTÊMICA — CONSOLIDAÇÃO FINAL CONCLUÍDA

NÃO IMPLEMENTADO NADA NESTA RODADA. Aguardando autorização.
