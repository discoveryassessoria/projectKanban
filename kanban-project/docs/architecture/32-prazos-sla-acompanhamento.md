# 32 — Módulo de Prazos, SLA e Políticas de Acompanhamento

**Status: FUNDAÇÃO, 22/09/2026.** Mandato "Módulo de Prazos, SLA e Políticas
de Acompanhamento" — constrói exclusivamente a fundação universal. Emissão
Documental e Genealogia serão conectadas a ela **só na próxima entrega**.
Ainda não está "congelado" no sentido dos módulos de Fases/Hierarquia
(nenhum consumidor real depende dela ainda) — mas o contrato aqui descrito é
a base que a próxima entrega vai construir em cima, então mudá-lo depois
exige entender o que se rompe.

## 1. Fronteira — o que este módulo NÃO é

Não substitui os "dois relógios" já existentes em `StepSubtaskDefinition`/
`SubtaskExecution` (SLA de ação interna + regra temporal + acompanhamento
por passo/subtarefa, mandato "correção definitiva do modelo temporal",
19-20/09/2026, motor em `lib/operacional/tempo-operacional.ts`). Aquele
motor continua intocado, governando a execução materializada de um Workflow
Interno publicado.

Este módulo é uma **camada paralela**: uma Política de Prazo/SLA cadastrada
em Gerenciamento pode ser vinculada diretamente a uma `Tarefa`, produzindo
`Tarefa.dataPrazo` (o prazoDaTarefa único — já existia, nunca duplicado) +
`Tarefa.proximoAcompanhamentoEm` por um motor de cálculo independente,
configurável, versionado e reconciliável.

## 2. Regra fundamental — um prazo por tarefa

`Tarefa.dataPrazo` é o único prazo. Este módulo nunca cria prazo por passo,
SLA por passo, prazo por subtarefa, ou uma segunda tarefa por passo. Uma
Tarefa vinculada a uma Política de Prazo/SLA tem, no máximo:

- `dataPrazo` — prazo geral (campo já existente).
- `proximoAcompanhamentoEm` — próxima data de retorno à atenção. NUNCA é
  prazo/SLA — só diz quando a tarefa volta a pedir atenção operacional.
- `aguardandoDesde` / `origemDaEspera` (`INTERNA`|`TERCEIRO`) /
  `terceiroResponsavelId` — estado da espera atual.
- `politicaPrazoSlaId` / `politicaPrazoSlaVersaoId` / `prazoBaseCalculoEm` —
  qual política, qual versão, e a partir de que instante o prazo foi
  calculado (explicabilidade).

## 3. Modelo de dados

- `PoliticaPrazoSla` — identidade (chave imutável, nome, status
  RASCUNHO/PUBLICADA/INATIVA, versaoAtual).
- `PoliticaPrazoSlaVersao` — os parâmetros CONGELADOS por publicação (mesmo
  padrão de `CatalogoFaseRevisao`/`MacroWorkflowVersao`): prazo geral
  (quantidade/unidade/evento inicial/calendário/tratamento de fim de
  semana e feriado/horário-limite/política de data não útil), indicadores de
  risco (antecedência/escalonamento), acompanhamento (intervalos/unidade/
  exigência de motivo/limite sem resposta), espera de terceiro padrão, e a
  **estratégia de retroação** escolhida na publicação.
- `CalendarioOficial` + `FeriadoCalendario` — calendário nomeado e opcional
  (ausência = calendário nacional brasileiro, `src/lib/diasUteis.ts`).
- `EventoPrazoSla` — ledger append-only, idempotente por `chaveIdempotencia`,
  domínio próprio (não sobrecarrega `WorkflowEvento`, que é escopado a
  transições de passo).

## 4. Motor de cálculo — `lib/operacional/motor-prazo-sla.ts`

Puro (zero Prisma), determinístico, testável com relógio controlado (todo
"agora"/"base" é parâmetro explícito). Reaproveita o mesmo fuso operacional
(`America/Sao_Paulo`) e a mesma classificação de dia útil/feriado nacional
de `tempo-operacional.ts`/`diasUteis.ts` — nunca uma segunda régua.

`diaContaParaPrazo` combina unidade (DIAS_CORRIDOS/DIAS_UTEIS) × tratamento
de fim de semana/feriado (PULA/CONTA) como dois eixos INDEPENDENTES — a
política decide a combinação, o motor nunca recusa uma combinação incomum
(ex.: DIAS_UTEIS com feriado CONTA).

## 5. Ciclo de vida da política — `src/services/prazo-sla/politica-prazo-sla.ts`

`RASCUNHO` → validação (`validarParametrosVersao`, nunca publica
configuração incompleta) → `publicarPoliticaPrazoSla` congela
`PoliticaPrazoSlaVersao`, avança `versaoAtual`/`status`, e **ENFILEIRA**
(nunca executa inline) a reconciliação via `DomainOutbox`
(`prazo.sla.reconciliar`), processada pelo `outbox-dispatcher` uma Tarefa
por vez — mesmo padrão de `reconciliar-fase-macro.ts`.

**Estratégia de retroação** — escolhida EXPLICITAMENTE na publicação, nunca
inferida:
- `SOMENTE_NOVAS` — não enfileira nada; só tarefas futuras usam a versão nova.
- `RECALCULAR_DA_ORIGEM` — recalcula a partir de `prazoBaseCalculoEm` original.
- `APLICAR_DA_PUBLICACAO` — recalcula a partir do instante da publicação.
- `MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO` — `dataPrazo` intacto, só
  `proximoAcompanhamentoEm` muda.

`preverImpactoPublicacao` — chamado ANTES de publicar, devolve quantas
tarefas em andamento serão atingidas. A UI deve mostrar isto e exigir
confirmação explícita antes de publicar com retroação.

O EFEITO (`processarReconciliacaoPrazoSla`,
`src/services/prazo-sla/reconciliar-prazo-sla.ts`) nunca toca tarefa
concluída/cancelada (dupla proteção: filtro no enqueue + checagem no
processamento), nunca exclui/recria/duplica — só atualiza campos temporais
da MESMA linha, e registra `EventoPrazoSla` idempotente.

## 6. Ações sobre a Tarefa — `src/services/prazo-sla/tarefa-prazo-sla.ts`

`vincularPoliticaATarefa`, `iniciarEsperaTerceiro`/`encerrarEsperaTerceiro`
(usa `Tarefa.statusTarefa = AGUARDANDO_TERCEIRO`, já existente — nunca um
status novo), `reprogramarAcompanhamento` (exige motivo conforme a
política), `reprogramarPrazoGeral` (RESTRITO — permissão administrativa).
Toda ação grava `EventoPrazoSla`.

## 7. Varredura — `src/services/prazo-sla/varredura-prazo-sla.ts`

Classifica risco (`classificarRisco`) e acompanhamento vencido
(`acompanhamentoVencido`) das tarefas vinculadas, emitindo eventos UM POR
MARCO (idempotente por dia operacional). Escalonamento respeita a cadência
configurada (`lembreteAtrasoRecorrenciaDias`), nunca dispara a cada
varredura. Rota `GET/POST /api/cron/prazo-sla` — agendada de hora em hora em
`vercel.json` (mesma cadência de `/api/cron/avisos-prazo`), listada no
allowlist do middleware.

## 8. Permissões

- `usuarios.gerenciar` — cadastro/edição/publicação de política, vincular
  política a uma tarefa, reprogramar o prazo geral.
- `tarefas.iniciar_concluir` — iniciar/encerrar espera de terceiro (mesma
  permissão já usada pelo comando canônico `aguardar_terceiro`/
  `retomar_espera`).
- `tarefas.editar` — reprogramar o próximo acompanhamento (Daniela pode).

## 9. API

- `GET/POST /api/gerenciamento/politicas-prazo-sla`
- `GET/PUT/DELETE /api/gerenciamento/politicas-prazo-sla/[id]`
- `POST /api/gerenciamento/politicas-prazo-sla/[id]/publicar`
- `GET /api/gerenciamento/politicas-prazo-sla/[id]/previa-impacto`
- `POST /api/gerenciamento/politicas-prazo-sla/[id]/previa-calculo`
- `GET/POST /api/gerenciamento/calendarios-oficiais`
- `GET/POST /api/gerenciamento/calendarios-oficiais/[id]/feriados`
- `POST /api/tarefas/[tarefaId]/prazo-sla/vincular`
- `POST /api/tarefas/[tarefaId]/prazo-sla/espera-terceiro/iniciar`
- `POST /api/tarefas/[tarefaId]/prazo-sla/espera-terceiro/encerrar`
- `POST /api/tarefas/[tarefaId]/prazo-sla/acompanhamento/reprogramar`
- `POST /api/tarefas/[tarefaId]/prazo-sla/prazo-geral/reprogramar`

## 10. Prova

`scripts/prova-e2e-prazo-sla.ts` — 39 verificações, cenário sintético
`[TESTE PRAZO]` completo (política → publicação → vínculo → espera →
retorno → cobrança → reprogramação → risco → vencimento → escalonamento →
nova versão → reconciliação 2x → zero duplicação → tarefa concluída
intocada → rollback de publicação inválida → limpeza), rodado 2x
consecutivas, idêntico nas duas.
