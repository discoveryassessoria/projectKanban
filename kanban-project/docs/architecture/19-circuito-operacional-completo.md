# 19 — Circuito operacional completo (Etapa 6)

Consolidado em 13/09/2026. Fecha o Plano de Estabilização de 6 etapas
(Execução → Ownership → Prazos/SLA → Eventos/Notificações → Projeções →
Circuito completo). Ver [15](15-motor-operacional-tarefa-workflow-step.md),
[16](16-tarefas-e-projetos-projecao-gerencial.md),
[17](17-eventos-historico-notificacoes.md),
[18](18-projecoes-consistencia-entre-telas.md).

## O que esta etapa provou (e não mudou)

Etapa 6 é validação de ponta a ponta, não implementação. **Nenhum arquivo de
produto foi alterado** — os 96 casos exigidos pelo mandato (circuito completo
de uma Tarefa + circuito completo de fase) passaram contra o código já
existente das Etapas 1–5. Duas suposições erradas do PRÓPRIO teste foram
corrigidas durante a escrita (não do produto):

1. Uma primeira versão do teste de fase escrevia o status do passo por
   `UPDATE` direto em vez da porta canônica (`concluirEtapa`) — o mandato
   proíbe isso explicitamente, e o próprio teste comprovou por quê: o
   `UPDATE` direto deixa a Tarefa (`NAO_INICIADA`) e o Passo (`CONCLUIDO`)
   discordando, um estado que o motor nunca produz sozinho.
2. O teste assumia que "retornar a uma fase" sempre cria uma Tarefa nova. O
   comportamento real — e correto — é a **REENTRADA**
   (`src/services/phase-workflow.ts`, bloco "REENTRADA NA FASE", já
   documentado e testado antes desta etapa): a mesma obrigação já concluída
   numa visita anterior à fase **herda** o estado terminal positivo
   (`CONCLUIDO`/`DISPENSADO`) no novo ciclo, em vez de reabrir do zero.
   "Voltar a 0 de 5" seria o defeito; herdar o que já foi feito é a regra.

## Regras permanentes reafirmadas nesta etapa

> Uma operação pode nascer, ser atribuída, executada, avançar por vários
> passos, aguardar terceiro, retornar por follow-up, ser reativada por
> retorno externo, ser reatribuída, concluir, reagir corretamente à fase e
> permanecer coerente em banco, histórico, eventos, notificações, RBAC e
> todas as projeções — provado com IDs reais (Tarefa 3571/3562/3564,
> Processo 592/589) e com um circuito completo em banco de teste
> (`scripts/etapa6-circuito-completo.test.ts`, 77 asserções).

> Avançar/retroceder fase não destrói obrigações — provado com comparação de
> IDs antes/depois em avançar→reabrir→retornar
> (`scripts/etapa6-fase-circuito.test.ts`, 19 asserções) e com um processo
> nascido em fase avançada cuja obrigação anterior continua completável.

> Notificação não controla fila — reafirmado da Etapa 4: a fila recupera a
> operação pela leitura temporal canônica (`estadoTemporalDaOperacao`), nunca
> por notificação existir.

> Retry não duplica — reafirmado nas Etapas 1, 4 e nesta: reatribuir ao mesmo
> responsável é recusado (não silencioso), reconcluir a mesma etapa é
> idempotente (`jaEstavaConcluida`), reprocessar EM_RISCO/retorno de terceiro
> não gera segunda notificação.

> Cancelada não é concluída — reafirmado da Etapa 5.

> Dados legados continuam operáveis — uma Tarefa sem `workflowStepInstanceId`
> (trabalho manual/administrativo) passa por `estadoTemporalDaOperacao`,
> `visaoGerencial` e `dossieDaTarefa` sem quebrar (CASO 18).

## O circuito canônico (referência única)

```
EVENTO DO MOTOR (WorkflowEvento/task-step-sync)
  → HISTÓRICO (LogAuditoria)
  → ATENÇÃO OPERACIONAL (proximo-acontecimento.ts, Etapa 3)
  → POLÍTICA DE NOTIFICAÇÃO (notificacao-canonica.ts, Etapa 4)
  → PROJEÇÃO (tarefa-projecoes.ts, Etapa 5)
```

Ownership = `Tarefa.responsavelId` (Etapa 2). Passo corrente =
`Tarefa.workflowStepInstanceId` (Etapa 2/5). Execução SOMENTE em Processo →
Workflow Interno (`concluirEtapa`/`task-step-sync.ts`/`phase-advance.ts`) —
nenhuma tela de gestão (Tarefas e Projetos/Lista/Kanban/Central) escreve
motor; todas chamam a mesma porta.

## Evidência real (produção, sem escrita nova)

`visaoGerencial`/`indicadoresGerenciais` lidos ao vivo contra
`pooled.db.prisma.io` (mesmo mecanismo de verificação das Etapas 4/5):
Tarefa 3571 (`emRisco: true`, sem responsável, passo "Classificar
criticidade"), Tarefas 3562/3564 (`emRisco: true`,
`CONFLITO_PRAZO_TAREFA_PASSO`, nomeando as duas datas), `indicadoresGerenciais
.emRisco === 3 === visaoGerencial({emRisco:true}).total`, com os mesmos 3 IDs
em ambos. Playwright autenticado confirmou `/tarefas` e `/operacao/central`
renderizando os mesmos números, sem erro de console/rede.

## Testes

- `scripts/etapa6-circuito-completo.test.ts` — 77 asserções, grão Tarefa:
  atribuição, RBAC/auditoria do autor real, execução de passo, avanço
  automático ≠ nova atribuição, aguardando terceiro, follow-up
  futuro/hoje/atrasado, retorno do terceiro, atraso interno × terceiro ×
  acompanhamento × risco como campos independentes, EM_RISCO
  entrada/contagem/filtro/notificação/saída, reatribuição preservando
  histórico e prazo, legado sem passo, retry/idempotência, concorrência de
  transferência, erro/recuperação.
- `scripts/etapa6-fase-circuito.test.ts` — 19 asserções, grão Fase/Processo:
  avançar→reabrir→retornar com IDs preservados e reentrada correta; processo
  iniciado em fase avançada com obrigação anterior completável depois.
- Conclusão de fase (FASE_CONCLUIDA, notificação consolidada 1x por admin,
  retry e concorrência real sem duplicar, movimentação manual não finge
  concluir) já provada em `scripts/etapa4-fase-concluida.test.ts` — não
  duplicada nesta etapa.

## Dívidas já registradas nas Etapas 4/5 (não reabertas aqui)

Ver documentos 17 e 18 — escopo de Home (`lib/home/coleta.ts`), nomenclatura
SLA fase-vs-tarefa, retorno via `SolicitacaoDocumento` sem teste dedicado
(caminho via contato é o testado; mesmo código), e as falhas pré-existentes
de `emissao-progresso-workflow-guard.test.ts`/`navegacao-operacional.test.ts`
não causadas por nenhuma das Etapas 4–6.

## Autorização para a próxima rodada

A estabilização do motor operacional em 6 etapas está encerrada. Só a partir
daqui está autorizado abrir uma nova rodada para confrontar a regra final de
Emissão Documental com o motor estabilizado — não incluída neste documento
nem nesta etapa.
