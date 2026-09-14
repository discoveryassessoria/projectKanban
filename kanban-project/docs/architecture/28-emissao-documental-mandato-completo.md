# 28 — Emissão Documental + 4 Subtarefas + Gerenciamento + Minha Operação: fechamento do mandato

Consolidado em 13/09/2026. Fecha o mandato "AUTORIZAÇÃO EXECUTIVA TOTAL —
IMPLEMENTAÇÃO PONTA A PONTA: EMISSÃO DOCUMENTAL + 4 SUBTAREFAS +
GERENCIAMENTO + MINHA OPERAÇÃO" com evidência real de produção e de teste.
Continua diretamente [20](20-emissao-documental-diagnostico.md),
[27](27-emissao-documental-estado-real-e-minha-operacao.md) — que já haviam
provado que o motor central (workflow real, publicado, uma Tarefa/N passos)
já existia — e resolve os itens que aquela rodada deixou explicitamente
pendentes: suíte literal dos 110 testes, 20 cenários adversariais A-T,
preview de impacto, calendário operacional, handoff dedicado, cadeia
downstream de invalidação, e uma segunda auditoria completa (Blocos 1-6) que
encontrou e corrigiu bugs reais de produção fora do escopo da primeira
rodada.

## 1. O que já existia (confirmado, não reconstruído)

- `PhaseInternalWorkflow` id=12 "Solicitar Certidão", 5 `PhaseInternalWorkflowStep`
  reais: `solicitar_certidao → aguardar_retorno_do_cartorio → receber_certidao
  → conferir_certidao → validar_certidao`. v4, publicado, global.
- Uma Tarefa canônica por obrigação — nunca uma por passo (provado com dado
  real de produção, Tarefa 3570, doc 27; reconfirmado nesta rodada nos itens
  01-03/06/108-109 da suíte de 110).
- `garantirTarefaDePasso` como único caminho de materialização;
  `task-step-sync.ts` como única máquina de transição de passo.
- Handoff = `atribuirTarefa`/`transferirTarefa` (sem mecanismo dedicado
  separado — confirmado correto, não uma lacuna).
- Minha Operação = `/operacao` → `CentralTarefas` + `tarefa-projecoes.ts`.

## 2. Bugs reais de produção encontrados e corrigidos nesta rodada

Todos com evidência de teste real (banco de teste local) e, quando
aplicável, confirmação read-only contra dado real de produção.

### 2.1 `ExigenciaEvidenciaEtapa` ignorada pelo portão real de execução
`executarAcaoCadastrada` (a porta que `POST /api/workflow-step-instances/[id]/execucao`
usa — confirmado o único caminho real da UI) só consultava
`requisitosPendentes`/`StepRequirement`, nunca `ExigenciaEvidenciaEtapa`.
Confirmado em produção: o passo real `solicitar_certidao` tem 3
`ExigenciaEvidenciaEtapa` reais (doc 27) e **zero** `StepRequirement` — a
exigência cadastrada nunca era cobrada na execução real. Corrigido em
`src/services/requisitos-da-etapa.ts`: `requisitosPendentes` agora resolve
também `ExigenciaEvidenciaEtapa` por stepKey × tipo documental × canal,
convergindo num único portão. Prova isolada:
`scripts/fix-exigencia-evidencia-bridge.test.ts` (6/6) — recusa sem a
evidência, aceita com ela, replicando a config real de produção.
Reconciliação de dado legado: 7 passos `solicitar_certidao` já concluídos em
produção, **0** sem a evidência exigida — nada a corrigir retroativamente.

### 2.2 `workflowStepInstanceId` não zerado ao concluir pela porta real
`aplicarTarefa` (`task-step-sync.ts`, usada por `concluirPasso`/
`executarAcaoCadastrada`) só mudava `statusTarefa`/`lockVersion` ao concluir
— nunca zerava o ponteiro do passo, diferente de `concluirEtapa`
(`tarefa-etapa.ts`) e `sincronizarTarefaComWorkflow` (`tarefa-canonica.ts`),
que sempre escrevem `corrente?.id ?? null`. Uma Tarefa concluída por esse
caminho ficava apontando para um passo já histórico. Também estendido de
`CONCLUIDO_RECEBIDO` para `CONCLUIDO_NAO_POSSUI` (antes só o primeiro setava
`concluida`/`dataConclusao`). Prova: `mandato-e2e-38-passos.test.ts` item 31,
assertiva antes frouxa (aceitava ponteiro não-nulo) agora estrita.

### 2.3 `PAUSE_FOR_EXTERNAL_WAIT` nunca pausava o relógio do prazo (Bloco 1)
O efeito que "Solicitar Certidão" de fato usa chamava
`task-step-sync.ts::bloquearTarefa`, implementação diferente de
`tarefa-ciclo.ts::aguardarTerceiro` que nunca pausava o SLA nem registrava
autor. `lib/operacional/sla-pausa.ts` (novo) resolve; `task-step-sync.ts`
agora pausa/retoma pela política do workflow e registra autor.
`proximo-acontecimento.ts::ehEsperaExterna` reconhece `BLOQUEADA+motivoCodigo`.
Prova: `mandato-pausa-relogios.test.ts` (33/33).

### 2.4 Rascunho não publicado vazava para materialização nova (Bloco 3 + contraprova)
`resolverWorkflowAplicavel` lia os passos da tabela viva/editável
(`PhaseInternalWorkflowStep`), não da última versão publicada. Entre "Salvar
rascunho" e "Publicar", uma Tarefa nova herdava `slaDays` do rascunho nunca
revisado. Corrigido em `phase-workflow.ts::ancorarNaVersaoPublicada`: com
rascunho pendente, ancora `slaDays`/`workflowVersion` na última versão
REALMENTE publicada. Confirmado com dado real: o workflow id=12 tem um
rascunho não publicado desde 21/08/2026 (achado pré-existente, sinalizado
pelo próprio motor de Saúde do Sistema como `CAD-011`, severidade
informativa — não é uma falha introduzida nesta rodada).

**Contraprova independente (14/09/2026) fechou o gap estrutural residual**:
o CONJUNTO de passos (não só `slaDays`) também vazava — um passo novo
criado no rascunho, sem publicar, aparecia numa Tarefa materializada nesse
intervalo. Investigação mostrou que o conteúdo de cada passo (ações/campos/
canais/checklist/requisitos) já era protegido em EXECUÇÃO via
`definicaoHistoricaDoPasso` (par workflowVersion×key — e `workflowVersion`
já vinha ancorado pela correção original); só faltava proteger o CONJUNTO na
materialização. `ancorarNaVersaoPublicada` agora reconstrói a lista inteira
de passos a partir da versão congelada (`PassoCongelado` já carrega tudo que
`DefStep` precisa). Não há mais limitação residual conhecida neste ponto.
Prova: `mandato-rascunho-publicacao.test.ts` (20/20, seções 7-8 novas).

### 2.5 `GET /api/processos/[id]` sem nenhuma checagem de permissão (Bloco 4)
Achado crítico da auditoria de RBAC: a rota devolvia o processo inteiro para
qualquer chamada autenticada, sem checar `processos.ver`. Corrigido.
Matriz completa das 16 ações do mandato documentada com citação de
arquivo:linha em `mandato-rbac-matriz.test.ts` (24/24).

## 3. Investigado e confirmado seguro/fora de escopo (documentado, não silenciado)

- **Financeiro/pagamento (Bloco 5)**: `custoPago` é só campo de UI, sem
  caminho para `ObrigacaoEconomica`; o gerador real de custo recusa
  explicitamente os dois passos do cartório (`PASSO_NAO_REGISTRAL`) —
  isolamento genuíno, sem risco de duplicidade. Decisão de negócio (criar ou
  não uma obrigação financeira real) permanece em aberto, isolada, conforme
  mandato ("não resolver todo o financeiro incidentalmente"). Prova:
  `mandato-financeiro-cartorio-isolado.test.ts` (10/10).
- **Clonagem de workflow (Bloco 6)**: existe `dupStep` (duplica um passo
  dentro do mesmo workflow); não existe clonagem de workflow inteiro. O
  mandato usa linguagem condicional ("quando suportado") e não há
  necessidade de negócio confirmada — não implementado.
- **Auto-disparo de `PAUSE_FOR_EXTERNAL_WAIT`** ao concluir o passo 1 (doc
  27): decisão de produto, não bug.

## 4. Regras temporais por cartório + override local (Bloco 2)

`OrgaoProtocolo` não tinha regra temporal própria; `SolicitacaoDocumento.orgaoId`
existia no schema mas nada o escrevia. Implementado `RegraTemporalOrgao`
(mesmo padrão de identidade de `ExigenciaEvidenciaEtapa`: `stepKey` lógico,
não FK forte a uma linha de step que pode ser recriada), com a precedência
exata do mandato (regra do órgão > SLA do passo > sem prazo) em
`lib/operacional/sla-por-orgao.ts::resolverPoliticaTemporal`. Override local
reaproveita `alterarPrazo` (já existia). Migration real
`20260913120000_regra_temporal_orgao` criada e **aplicada em produção** (ver
§7). Prova: `mandato-sla-cartorio-override.test.ts` (26/26).

## 5. Impactos downstream de invalidação — classificação semântica

`identificarImpactoDownstream` (doc 20/27) listava dependentes reais
(apostilamento, tradução, retificação, divergência, obrigação econômica) mas
não classificava a consequência. Adicionado `consequencia` (aditivo,
6 rótulos: `CONTINUA_VALIDO`/`PRECISA_REVISAO`/`BLOQUEADO`/`INVALIDADO`/
`PRECISA_REPROCESSAR`/`APENAS_HISTORICO`) — nunca reverte nada
automaticamente, só orienta decisão humana. Prova:
`invalidacao-downstream.test.ts` §5f (6 novas asserções, todos os 6
rótulos exercitados de verdade).

## 6. Minha Operação — extensões desta rodada

- Filtros novos: "Atraso interno" / "Terceiro atrasado" (dados já existiam
  em `tarefa-projecoes.ts`, não chegavam à tela — mesmo padrão de gap já
  fechado para `emRisco`/`retornoRecebido` na rodada anterior); "Novas
  atribuições" (recorte temporal de 48h sobre `A_FAZER` + `atribuidaEm`).
- Trilha visual dos passos no drawer da Central da Etapa (✓/●/○ por passo,
  mandato "REPRESENTAÇÃO VISUAL DA TAREFA") — antes só existia o contador
  "Etapa X de N".

## 7. Verificador de integridade sistêmica — EMI-001..020

Motor de Saúde do Sistema estendido (catálogo v1.7.0 → v1.8.0) com 20 novas
verificações read-only cobrindo literalmente a lista do mandato: Tarefa sem
Step atual, Steps concorrentes, Step de outra Tarefa, espera sem follow-up,
follow-up vencido fora da atenção, retorno ainda classificado como espera,
Tarefa duplicada, necessidade sem documento válido, documento sem
necessidade, documento avançado sem arquivo, vigente+invalidado simultâneo,
ownership divergente, concluída com Step final inválido, CANCELADA≠CONCLUÍDA,
workflow publicado removido, step removido, handoff sem ator válido,
histórico fora de ordem, documento invalidado ainda satisfazendo necessidade
(a prova viva do fix §2 da rodada anterior), projeção divergente. Prova:
`scripts/verificador-integridade-emissao.test.ts` (62/62) + confirmação
read-only contra produção real: **0 achados, 0 falsos positivos** (2 falsos
positivos de desenho foram encontrados e corrigidos durante a validação
antes do commit final).

## 8. Migration e deploy — `RegraTemporalOrgao`

O Bloco 2 criou o modelo direto no `schema.prisma` sem a migration
incremental correspondente. Corrigido: migration real
`prisma/migrations/20260913120000_regra_temporal_orgao` (CREATE TABLE + 2
índices + 1 FK, aditiva/idempotente). Isso mudou o checksum de
`0000_baseline` (`baseline.sql` foi regenerado para refletir a tabela nova);
reconciliação do ledger de produção feita pelo mecanismo já estabelecido
(`scripts/prod-migrate-guard.mjs`, mesmo procedimento das 7 reconciliações
anteriores documentadas em `baseline-verificar.test.ts`): backup da linha no
log do build, diff conferido como puramente aditivo, UPDATE de uma coluna só
com o checksum anterior no WHERE.

**Deploy real executado nesta rodada** (`MIGRATE_ON_BUILD=1` +
`EU_CONFIRMO_ESCRITA_EM_PRODUCAO`, env vars removidas logo depois):
```
[migrate-guard] classificação: PRODUCAO
[migrate-guard] 0000_baseline reconciliado: ff688975f397… → c17f5d6287d8…
Applying migration `20260913120000_regra_temporal_orgao`
[migrate-guard] migrations: 63 → 64
[migrate-guard] requerentes após: 767 (antes: 767)
[migrate-guard] OK.
```
Confirmado read-only pós-deploy: `RegraTemporalOrgao` existe e é consultável
em produção (0 linhas — nenhuma regra por cartório cadastrada ainda, estado
esperado de uma feature nova).

## 9. Testes — números finais desta rodada

| Suíte | Asserções |
|---|---|
| `mandato-110-testes.test.ts` (suíte literal dos 110 itens do mandato) | 154 |
| `mandato-20-adversariais.test.ts` (cenários A-T) | 96 |
| `mandato-e2e-38-passos.test.ts` (+ caminho NÃO VALIDADA) | 104 |
| `verificador-integridade-emissao.test.ts` (EMI-001..020) | 62 |
| `mandato-pausa-relogios.test.ts` (Bloco 1) | 33 |
| `mandato-sla-cartorio-override.test.ts` (Bloco 2) | 26 |
| `mandato-rascunho-publicacao.test.ts` (Bloco 3 + contraprova estrutural) | 20 |
| `mandato-rbac-matriz.test.ts` (Bloco 4) | 24 |
| `mandato-financeiro-cartorio-isolado.test.ts` (Bloco 5) | 10 |
| `fix-exigencia-evidencia-bridge.test.ts` | 6 |
| `contraprova-granularidade-multipessoa.test.ts` (independente) | 12 |
| Regressão (handoff/tempo-operacional/preview-impacto/invalidação/etapa5/etapa6/delete-processo) | 239 |
| **Total** | **786** |

Todas rodadas de verdade contra `postgresql://postgres@127.0.0.1:55432/discovery_test`
(banco de teste local, nunca produção). Zero falha na rodada final,
consecutiva, depois de todas as correções e do deploy.

`npm run build` completo (todos os guards de arquitetura + baseline +
`next build --turbopack`) verde, exit code 0.

Playwright autenticado contra produção real (leitura, técnica de servidor
local + banco real já estabelecida): ADMIN e OPERADOR (Daniela Brait,
usuária real) percorrendo Gerenciamento/Workflow Interno, Minha Operação e
Tarefas e Projetos — 7/7 verde, zero 5xx, zero console error, zero 4xx
inesperado.

## 10. Regras permanentes reafirmadas/adicionadas

> Uma configuração salva mas ignorada pelo runtime é defeito. — Provado e
> corrigido duas vezes nesta rodada (`ExigenciaEvidenciaEtapa`, rascunho não
> publicado vazando SLA).

> Toda espera externa configurada precisa ter mecanismo de retorno à
> atenção, e o relógio do prazo deve refletir honestamente que a operação
> está pausada — pausa nunca esconde atraso.

> A validação sempre referencia versão documental exata; invalidar um
> documento validado regride a necessidade e classifica (nunca reverte
> automaticamente) o impacto downstream.

> RBAC é responsabilidade do backend, sempre — uma rota sem checagem de
> permissão é, por definição, um defeito crítico, independentemente do que
> o frontend esconde.

## 11. Limitações reais remanescentes

- Clonagem de workflow inteiro — não implementada. O mandato usa linguagem
  condicional ("quando suportado") e não há necessidade de negócio
  confirmada; `dupStep` (duplicar um passo dentro do mesmo workflow) já
  existe e cobre o caso real de reaproveitamento de configuração sem
  duplicar motor.
- Decisão de negócio sobre se o custo de cartório deve virar uma
  `ObrigacaoEconomica` real — isolada, não decidida (fora do escopo do
  motor financeiro, que este mandato explicitamente não deveria resolver).
  Confirmado sem risco de duplicidade (upsert idempotente por
  documento/step/ciclo).

(A reconciliação da estrutura de passos com a versão publicada durante um
rascunho pendente — listada aqui na primeira rodada — foi fechada pela
contraprova independente; ver §2.4.)
