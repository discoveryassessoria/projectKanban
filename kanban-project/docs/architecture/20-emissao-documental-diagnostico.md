# 20 — Emissão Documental: diagnóstico contra o motor estabilizado

Consolidado em 13/09/2026. Rodada FORA da numeração de Etapas 1–6 (ver
[19](19-circuito-operacional-completo.md) para o encerramento delas). Este
documento é só DIAGNÓSTICO — nenhuma linha de produto foi alterada nesta
rodada. Pergunta central: *quanto da regra final de Emissão Documental
("Solicitar Certidão", operação-modelo de 4 passos) já é suportado pelo
motor estabilizado, o que falta, e qual é a MENOR alteração canônica?*

## A. Arquitetura atual relevante

- Ownership/passo corrente: `Tarefa.responsavelId` /
  `Tarefa.workflowStepInstanceId` (Etapa 2), motor único de transição em
  `src/services/task-step-sync.ts` (`fronteira-maquina-passo-unica`).
- Temporal/EM_RISCO: `lib/operacional/tempo-operacional.ts` +
  `lib/operacional/proximo-acontecimento.ts` (Etapa 3).
- Eventos/histórico/notificação: `lib/operacional/notificacao-canonica.ts`
  (Etapa 4).
- Projeções: `lib/operacional/tarefa-projecoes.ts` (Etapa 5).
- Necessidade → Documento: `NecessidadeDocumental` (chave de idempotência
  `p{pessoaId}::rd:{regraCode}:v{versao}`, snapshot congelado da regra) é
  materializada SOMENTE por
  `src/services/genealogia/materializar-genealogia.ts`, a partir de
  `MatrizDocumental` (PUBLICADA). `Documento.necessidadeId` liga 1
  necessidade → N documentos/vias.
- Decisão/efeito genérico e já em produção: **`CATALOGO_DE_EFEITOS`**
  (`src/lib/motor/catalogo-de-efeitos.ts`) + executor
  (`src/services/executar-acao-cadastrada.ts` +
  `src/services/efeitos-de-dominio.ts`), acionado pela tela via
  `useConfiguracaoDaEtapa().executarAcao`. Um efeito é código revisado
  (idempotente, com `permissao` e `competencia` próprias); a COMBINAÇÃO de
  efeitos por passo é cadastro, não código. Fase só ganha um efeito que
  ESCREVE em entidade canônica (`REGISTER_PROTOCOL`,
  `REGISTER_RETIFICATION_PLAN`) se declarar `exigeAutorizacaoExplicita`
  nominalmente — nunca por herança de competência.
- **O fluxo "Solicitar Certidão" do mandato JÁ EXISTE, com um passo a mais**:
  `src/components/kanban/workflow/StepEditors.tsx` implementa
  `EditorSolicitarCertidao` (2) → `EditorAguardarRetorno` (3) →
  `EditorReceberCertidao` (4) → `EditorConferirCertidao` (5) →
  `EditorValidarCertidao` (6). O passo 6 é a decisão jurídica
  VALIDADA/NÃO-VALIDADA do mandato (passo 4 dele); o passo 5 é a
  conferência operacional que a precede. Ambos, quando a etapa tem ações
  cadastradas (`usandoCadastro`), decidem SOMENTE via `executarAcao` — o
  comentário do próprio código documenta a migração: *"A TELA NÃO DECIDE
  MAIS O QUE ACONTECE"* (havia um mapa `decisao → status` direto, removido).
  `EditorValidarCertidao` resolve a etapa de conferência anterior por
  **dependência declarada** (`cfgDoPasso.dependeDe`), nunca por
  `stepKey === "conferir_certidao"` hardcoded — com fallback por ordem só
  quando não há dependência declarada (configuração pré-grafo).

## B. Cadeia documental real atual

```
Pessoa → NecessidadeDocumental (snapshot de MatrizDocumental)
       → Documento (necessidadeId; derivadoDeId/derivacaoTipo p/ vias)
       → SolicitacaoDocumento[] (1:N — tentativas/trocas de cartório)
       → DocumentoArquivo[] (tipo REQUERIMENTO_ENVIADO / COMPROVANTE_PROTOCOLO /
         COMPROVANTE_CONTATO / DOCUMENTO_RECEBIDO / OUTRO; hashConteudo;
         vigente/substituiId)
```

`Documento.status` (enum de 15 valores) é **legado confirmado** — já
registrado como tal na memória do projeto ("Documento.status é legado":
enum de 15 valores = workflow escrito 2ª vez). Os efeitos ainda o escrevem
(`status()` em `efeitos-de-dominio.ts`) por compatibilidade de leitura em
telas antigas, mas a decisão de negócio não depende mais dele — depende do
`effectKey` executado.

## C. Processo real auditado (Processo 592 "Teste")

Pessoa 2795 → 4 `NecessidadeDocumental` (419–422) → 1 `Documento` (2136,
`status=RECEBIDO`) → Tarefa 3570 (`CONCLUIDO_RECEBIDO`, `responsavelId=12`).
Duas divergências de app-layer, **não impeditivas** (nada quebra, apenas não
são guardadas):

1. `Tarefa.necessidadeId = null` apesar do `documentoId` resolver a
   necessidade — o vínculo existe via Documento, mas não é espelhado na
   Tarefa.
2. Nenhum `DocumentoArquivo` do tipo `DOCUMENTO_RECEBIDO` apesar de
   `status="RECEBIDO"` — o status avançou sem o arquivo correspondente
   estar tipado como tal.

`LogAuditoria` mostra atribuição/transferência reais e consistentes.
Contagens de produção (sem escrita): Documento=7 (100% ligado a
necessidade); NecessidadeDocumental=17 (7 materializadas, 10 ainda não —
normal); SolicitacaoDocumento=7 (5 PROTOCOLADA, 2 AGUARDANDO_PROTOCOLO);
DocumentoArquivo=13; **zero órfãos, zero FK pendente**.

## D/G. Matriz de gaps

| Requisito do mandato | Já existe | Parcial | Não existe | Componente canônico atual | Menor alteração |
|---|---|---|---|---|---|
| Passo 1 (enviar requerimento, evidência obrigatória) | ✅ | | | `EditorSolicitarCertidao` + `ExigenciaEvidenciaEtapa`/`evidenciasFaltando` (`tarefa-etapa.ts`) | nenhuma |
| Passo 2 (auto-entra AGUARDANDO_TERCEIRO sem nova Tarefa) | | ✅ | | `PAUSE_FOR_EXTERNAL_WAIT`/`aguardarTerceiro` (Etapa 6, `tarefa-ciclo.ts`) — mecanismo genérico existe e é testado | **wiring**: garantir que o efeito do passo 2 desta etapa específica chama `aguardarTerceiro` automaticamente, não como ação manual do operador |
| Política temporal por passo (prazo/1º follow-up/recorrência/escalonamento) | | ✅ | | `PhaseInternalWorkflowStep.slaDays` + `lib/operacional/tempo-operacional.ts`/`proximo-acontecimento.ts` (Etapa 3) | **configuração**: nenhum campo de "1º follow-up" distinto do prazo em si — hoje é um único `slaDays`/`prazoEsperadoDias`; se o negócio exigir marco distinto, é campo novo em `SolicitacaoDocumento`, não motor novo |
| Precedência temporal terceiro>passo>default>override-auditado | | ✅ | | `previsaoRetorno` (SolicitacaoDocumento) > `slaDays` (passo) > default do workflow — cadeia já lida por `estadoTemporalDaOperacao`; override-por-ocorrência-auditado **não confirmado** como distinto de edição direta | investigar se `alterarPrazo` (`tarefa-ciclo.ts`) já audita a troca (histórico) — parece que sim via LogAuditoria padrão; não é gap novo |
| Comprovante/protocolo/valor/situação-pagamento/previsão na 2ª espera | ✅ | | | `SolicitacaoDocumento` (canal, protocolo via `Protocolo`+`DocumentoArquivo.protocoloId`, `custoPago`, `formaPagamento`, `previsaoRetorno`) | nenhuma |
| Passo 3 (2ª espera, reage a retorno antecipado, volta p/ AÇÃO NECESSÁRIA) | ✅ | | | `retomarDeEspera` (Etapa 6, testado com CASO de retorno antecipado) | nenhuma |
| Certidão anexada ao DOCUMENTO OPERACIONAL (não só à Tarefa) | ✅ | | | `DocumentoArquivo` já pendura em `Documento`, não em Tarefa | nenhuma |
| Passo 4 (conferir/validar, checklist por tipo, decisão VALIDADA/NÃO-VALIDADA) | ✅ | | | `EditorConferirCertidao`+`EditorValidarCertidao`+`CATALOGO_DE_EFEITOS` (`COMPLETE_DOCUMENT`/`REGISTER_DIVERGENCE`/`GO_RETIFICATION`/`REQUEST_NEW_COPY`/`INVALIDATE_DOCUMENT`) — decisão já sai do código para o cadastro | **configuração**: cadastrar esta combinação de ações para o stepKey de "Solicitar Certidão" especificamente (hoje comprovadamente usada por outro fluxo documental — Registro Civil/MRG) |
| NÃO VALIDADA nunca conta como concluída | ✅ | | | `INVALIDATE_DOCUMENT`: `concluiPasso: false` — a obrigação continua aberta por desenho | nenhuma |
| Preservação do documento rejeitado (nunca sobrescreve) | ✅ | | | `novaViaDocumental()` confirmado (lido linha a linha): cria `Documento` novo com `derivadoDeId`, marca origem com `substituidoEm` (não apaga, não reduz status), mesma `necessidadeId`, idempotente por `chaveDerivacao` | nenhuma |
| Tratamento configurado após NÃO VALIDADA (não hardcode) | ✅ | | | O cadastro escolhe entre `REGISTER_DIVERGENCE`/`GO_RETIFICATION`/`REQUEST_NEW_COPY`/`INVALIDATE_DOCUMENT` por AÇÃO cadastrada — zero `if` de domínio no componente | nenhuma |
| Aprovação/rejeição genérica de passo (`AGUARDANDO_APROVACAO`) | ✅ | ⚠️ | | `aprovarPasso` (`task-step-sync.ts`) tem `PASSO_APROVADO` mas **nenhum `reprovarPasso` simétrico** | gap real, mas **não bloqueia Solicitar Certidão** — este fluxo decide por `CATALOGO_DE_EFEITOS`, não por `AGUARDANDO_APROVACAO`. Ver F. |
| Financeiro da solicitação ao cartório | | ⚠️ | | `SolicitacaoDocumento.custoPago`/`.formaPagamento` (escrito, lido só em relatório ad-hoc) **desconectado** de `ObrigacaoEconomica` (Ledger real, disparado por `projetarCustosDocumentaisDoPasso` no passo REGISTRAL, não no fluxo de solicitação a cartório) | **gap real, o mais sério do lote** — duas fontes de "custo" para o mesmo fato. Menor correção: ou (a) o efeito que registra pagamento da solicitação passa a criar `ObrigacaoEconomica` via o mesmo `congelar()/criarCusto()` já usado pelo passo REGISTRAL, ou (b) `custoPago` vira só evidência/anotação e o Ledger nasce de uma regra de preço específica para custo-de-cartório. Decisão de negócio, não só técnica — não decidir aqui. |
| Cartório como terceiro/fornecedor | ✅ | | | `OrgaoProtocolo` (`type="cartorio"`) + `FuncaoOrganizacao=FORNECEDOR` — `Fornecedor` standalone é o pré-consolidação | nenhuma (não criar cadastro novo) |
| RBAC por passo | ✅ | | | permissão por efeito (`documentos.editar`/`processos.editar`/`tarefas.editar`) + `negarSeNaoForDonoDaTarefa` | nenhuma |
| Idempotência (8 cenários) | ✅ | | | todo efeito é `idempotente: true`; `chaveDerivacao`/`chaveIdempotencia` cobrem via único, notificação, protocolo | nenhuma |
| Histórico/eventos/notificação por passo | ✅ | | | cadeia canônica da Etapa 4/6 já classifica cada passo | nenhuma |

## E. Capacidades já existentes (resumo)

Motor de passo único; catálogo de efeitos genérico e testado; versionamento
de documento por derivação (`derivadoDeId`/`substituidoEm`/`chaveDerivacao`);
snapshot de regra congelado em `NecessidadeDocumental`; motor temporal/risco
canônico; notificação canônica; projeções canônicas; RBAC por
competência+permissão+ownership; reconciliação de pessoa
(`pessoa-ciclo-vida.ts`) já trata "configuração ≠ fato histórico"
corretamente.

## F. Componentes reutilizáveis (nenhum novo motor necessário)

`CATALOGO_DE_EFEITOS`, `executar-acao-cadastrada.ts`, `StepEditors.tsx`
(genéricos por `stepKey`+cadastro), `aguardarTerceiro`/`retomarDeEspera`,
`tempo-operacional.ts`/`proximo-acontecimento.ts`, `notificacao-canonica.ts`,
`tarefa-projecoes.ts`, `OrgaoProtocolo`+`FuncaoOrganizacao`,
`pessoa-ciclo-vida.ts`.

A reconciliação **B vs E** ficou clara: `AGUARDANDO_APROVACAO`/`aprovarPasso`
é um gate de aprovação genérico e SEPARADO (sem `reprovarPasso` simétrico —
gap real, mas de escopo geral de workflow interno, não específico da
Emissão). O mecanismo que a Emissão Documental efetivamente usa para a
decisão VALIDADA/NÃO-VALIDADA é o `CATALOGO_DE_EFEITOS`, que já cobre os 4
desfechos do mandato sem hardcode e sem depender de `aprovarPasso`.

## H. Problemas de legado

1. `Documento.status` (15 valores) continua sendo escrito pelos efeitos por
   compatibilidade de leitura, mas não decide mais nada — **campo legado
   somente informativo** (classe 2, ver §94), não arquitetura ativa.
2. Os 2 pontos do item C (Tarefa.necessidadeId não espelhado;
   status sem arquivo tipado correspondente) são divergências de dados que
   NÃO quebram o motor hoje, mas não são guardadas — candidatos a guard, não
   a migration.
3. `Fornecedor` standalone: legado pré-consolidação de `OrgaoProtocolo`.
   `ObrigacaoEconomica.fornecedorId` é referência fraca (sem FK forte) —
   **não confirmado** para qual tabela aponta na prática; precisa
   verificação antes de qualquer desenho novo de custo de cartório.
4. `AGUARDANDO_APROVACAO` sem `reprovarPasso` — arquitetura ativa
   incompleta, não específica da Emissão.

## I. Riscos

- **Financeiro (alto)**: duas fontes de custo não reconciliadas é o único
  candidato real a "source of truth concorrente" encontrado nesta rodada.
- **Baixo** para o resto: o restante do fluxo já converge para os mecanismos
  canônicos (Etapas 1–6); gaps são de configuração/wiring, não de modelo.

## J. Menor plano de implementação (para autorização futura — não executar agora)

1. Cadastrar, para o workflow "Solicitar Certidão", os `stepKey`s e ações
   reaproveitando os editores/efeitos já existentes (2→6 do
   `StepEditors.tsx`) — **configuração**, zero código.
2. Confirmar/ajustar o efeito do passo 2 para chamar `aguardarTerceiro`
   automaticamente ao concluir o requerimento (**wiring**, pequena mudança
   de código se o efeito hoje exigir clique manual).
3. Decidir e implementar a reconciliação financeira (item D linha
   "Financeiro") — única peça que pode exigir schema novo (um `origemId`/
   `chave` em `ObrigacaoEconomica` distinguindo tentativa-de-cartório de
   custo-registral), a confirmar com o usuário antes.
4. Guard leve para os 2 pontos do item C (necessidadeId espelhado,
   arquivo-tipado-consistente-com-status) — validação, não migration.
5. `reprovarPasso` simétrico a `aprovarPasso`, se o negócio decidir usar
   `AGUARDANDO_APROVACAO` em algum passo desta operação (não obrigatório —
   a decisão VALIDADA/NÃO-VALIDADA já tem caminho próprio).

## K. Migrations potencialmente necessárias

Só uma, condicional à decisão de negócio do item 3 acima (reconciliação
financeira) — **nenhuma outra parte do plano exige schema change.**

## L. O que NÃO deve ser alterado

Motor de passo único, `CATALOGO_DE_EFEITOS` (estrutura), `NecessidadeDocumental`,
`Documento`/`DocumentoArquivo` (modelo de versionamento), `OrgaoProtocolo`,
Tabela de Preços, `pessoa-ciclo-vida.ts`, qualquer Etapa 1–6.

## M. Ordem recomendada de implementação

Configuração (1) → wiring do passo 2 (2) → guards leves (4) → decisão de
negócio + implementação financeira (3) → `reprovarPasso` só se necessário (5).

## N. Critérios de aceite

Circuito completo de "Solicitar Certidão" (4 passos do mandato) provado
ponta a ponta com IDs reais, nos mesmos moldes do
[19](19-circuito-operacional-completo.md): banco+estado+histórico+eventos+
notificações+projeções+filtros+RBAC+interface real, sem nova fonte de
verdade, sem `if (stepKey===...)` novo, com `novaViaDocumental` provado em
cenário de rejeição real, e com o Ledger (se implementado) batendo com
`SolicitacaoDocumento.custoPago` por reconciliação, não por dupla contagem.

## §94 — Auditoria de legado (classificação 1–5)

| Achado | Classe | Nota |
|---|---|---|
| `Documento.status` (15 valores) | 2 — campo legado somente informativo | ainda escrito por compatibilidade de leitura; decisão real sai do `effectKey` |
| Mapa `decisao→status` direto em `StepEditors.tsx` (já removido, comentário no código documenta a remoção) | 3 — código legado morto (já não existe mais) | confirmado removido, não achado ativo |
| `Fornecedor` standalone vs `OrgaoProtocolo`+`FUNCAO=FORNECEDOR` | 2/3 — legado pré-consolidação, uso ativo não confirmado nesta rodada | precisa grep de escrita ativa antes de classificar definitivamente |
| `Tarefa.necessidadeId` não espelhado no Processo 592 | 1 — dado histórico de um registro específico, não arquitetura | não é "arquitetura legada ativa": é uma lacuna de escrita num caso, não um mecanismo concorrente |
| `SolicitacaoDocumento.custoPago` vs `ObrigacaoEconomica` | **5 — source of truth concorrente** | único achado desta classe na rodada |
| `AGUARDANDO_APROVACAO` sem `reprovarPasso` | 4 — arquitetura ativa incompleta (não "legada", mas lacunar) | não é duplicidade, é ausência de simetria |

**Existe hoje arquitetura legada ativa determinando comportamento da
Emissão?** NÃO, com uma ressalva: `Documento.status` ainda é escrito (não
lido para decisão) — informativo, não decisório.
**Existe hoje source of truth concorrente?** SIM — apenas no financeiro
(`custoPago` × `ObrigacaoEconomica`).
**Os registros antigos conseguem operar pelo motor canônico atual?**
PARCIALMENTE — os 7 documentos e 7 solicitações reais operam sem quebra,
mas o financeiro desses registros não converge para o Ledger.

## §95 — Configurabilidade e evolução

Comportamentos hoje em CÓDIGO que já são efetivamente CONFIGURAÇÃO: quais
ações cada passo oferece e para onde cada uma leva (`acoesDaEtapa` +
`CATALOGO_DE_EFEITOS`), dependência entre passos (`dependeDe`, lido por
`EditorValidarCertidao` em vez de nome hardcoded), checklist da conferência
(`cfgConferencia.checklist`), SLA (`slaDays`). **Nenhum hardcode indevido
novo foi encontrado no caminho de decisão** — o hardcode que existia
(`decisao→status`) já foi removido, com o comentário do autor original
descrevendo exatamente essa migração.

Teste de evolução (4→7 passos, ex. + apostila/tradução/retificação):
**TOTALMENTE CONFIGURÁVEL** adicionar passos que reusam efeitos existentes
(mais uma conferência, mais uma espera) — é cadastro de `PhaseInternalWorkflowStep`
+ ações. **PARCIALMENTE CONFIGURÁVEL** encaminhar para apostila/tradução
como consequência automática de uma decisão — hoje isso seria uma nova
combinação de efeitos (ex. `GO_RETIFICATION`-like para apostila), que é
código novo SÓ NA PRIMEIRA VEZ (novo efeito no catálogo), reutilizável depois
como configuração. Não há nada **dependente de código** para o caso descrito
no mandato além desse efeito específico (não existe ainda).

**O desenho recomendado permite evoluir sem criar um segundo motor?** SIM.
**Quais comportamentos hoje em código deveriam ser configuração
administrativa?** Nenhum identificado nesta rodada além do que já é
configuração — o único código genuinamente necessário é a reconciliação
financeira (item J.3), que é regra de negócio nova, não um comportamento que
deveria ter sido configuração.

## Resposta à pergunta central

Implementar os gaps listados (configuração dos passos 2 e 4, wiring do
`aguardarTerceiro` automático, guards leves, decisão financeira) SOBRE o
motor estabelecido — nenhum item exige motor paralelo, segunda fonte de
verdade nova (a única concorrência já existe hoje, no financeiro, e a
correção é reconciliar, não criar uma terceira), ou tabela por conveniência.

---

# DIAGNÓSTICO DA EMISSÃO DOCUMENTAL — CONCLUÍDO

**PRONTA PARA CONFIGURAÇÃO**, com um item de decisão de negócio pendente
(reconciliação financeira cartório × Ledger, item J.3/K) antes de qualquer
código novo além de cadastro.

NÃO IMPLEMENTADO NADA NESTA RODADA. Aguardando autorização.
