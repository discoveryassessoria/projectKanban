// lib/saude/verificacoes/emissao-documental.ts
//
// EMISSÃO DOCUMENTAL — "Solicitar Certidão" (1 Tarefa canônica, 5 Steps reais):
// solicitar_certidao → aguardar_retorno_do_cartorio → receber_certidao →
// conferir_certidao → validar_certidao.
//
// Estas 20 verificações vigiam especificamente a integridade do par
// Tarefa↔Step↔Necessidade↔Documento neste fluxo — read-only, como todo o
// resto do motor de Saúde do Sistema. Nenhuma delas escreve nada; nenhuma
// corrige nada. O que cada uma prova está descrito no comentário de cada
// `registrar()`.
//
// Por que um arquivo novo em vez de espalhar nos existentes: as 20
// verificações compartilham o mesmo vocabulário (a fase `emissao_documental`,
// os 5 stepKeys publicados, o motor temporal canônico) — agrupá-las aqui é
// mais fácil de auditar como conjunto do que distribuí-las entre
// `cadastro-execucao.ts`/`documentos.ts`/`acesso.ts` por semelhança de
// domínio. O CATÁLOGO continua sendo um só (`registrar()` é a mesma função).

import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao } from '../tipos'
import { lerAndamento } from '@/src/lib/process-stage/andamento-etapa'
import type { StatusTarefa } from '@prisma/client'

const PHASE_KEY = 'emissao_documental'
const ROTA_CENTRAL = '/operacao'
const ROTA_KANBAN = '/kanban'
const ROTA_RUNTIME = '/administrator?screen=runtimediag'

/** Terminal para a TAREFA — a mesma régua de `proximo-acontecimento.ts`. */
const STATUS_TAREFA_TERMINAL: StatusTarefa[] = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA']
/** Espera de terceiro OU cliente — a mesma régua de `tarefa-projecoes.ts`. */
const STATUS_TAREFA_AGUARDANDO: StatusTarefa[] = ['AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE']
/**
 * "ATIVO/CONCORRENTE" de verdade — em disputa pela mesma cadeia agora.
 *
 * `PENDENTE` NÃO entra aqui: numa cadeia SEQUENCIAL os 5 `PhaseWorkflowStepInstance`
 * de um documento nascem todos de uma vez (ordem 1..5) e os passos futuros ficam
 * `PENDENTE` até a vez deles — isso é o desenho normal, não concorrência real.
 * Confirmado com dado de produção (Tarefa #3562/documento #2130: `receber_certidao`
 * `EM_ANDAMENTO` + `conferir_certidao`/`validar_certidao` `PENDENTE` — 1 passo em
 * curso, 2 na fila; contar os `PENDENTE` como "ativos" gerava falso-positivo).
 */
const STEP_STATUS_ATIVO = ['DISPONIVEL', 'EM_ANDAMENTO', 'AGUARDANDO', 'BLOQUEADO', 'EXECUTADO', 'AGUARDANDO_APROVACAO']
/** Documento que não serve mais como via vigente da necessidade. */
const DOC_STATUS_INVALIDO = ['INVALIDO', 'CANCELADO']

const vazio = (metricas: Record<string, number>, resumo: string): ResultadoVerificacao => ({ achados: [], metricas, resumo })

// ═══════════════════════════════════════════════════════════════════════════
// 1 — TAREFA ABERTA SEM STEP ATUAL
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.tarefa-sem-step-atual',
  codigo: 'EMI-001',
  nome: 'Tarefa aberta tem Step atual',
  descricao: 'Tarefa não-terminal do fluxo de Emissão Documental sem `workflowStepInstanceId` não sabe em qual dos 5 passos está.',
  dominio: 'TAREFAS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 15_000,
  orientacao: 'Investigue o histórico de eventos (WorkflowEvento) da Tarefa: o ponteiro deveria ter sido movido para o próximo passo, ou a Tarefa deveria ter sido concluída.',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.tarefa.findMany({
      where: {
        faseMacroKey: PHASE_KEY,
        tipo: 'NORMAL',
        workflowInstanceId: { not: null },
        workflowStepInstanceId: null,
        statusTarefa: { notIn: STATUS_TAREFA_TERMINAL },
      },
      select: { id: true, titulo: true, processoId: true, statusTarefa: true },
      take: 100,
    })
    if (!linhas.length) return vazio({ semStep: 0 }, 'Toda Tarefa aberta da Emissão Documental tem Step atual.')
    return {
      achados: linhas.map((t): Achado => ({
        chave: `emi-tarefa-sem-step:${t.id}`,
        severidade: 'CRITICO',
        titulo: `Tarefa #${t.id} está aberta e sem Step atual`,
        descricao: `"${t.titulo}" está em ${t.statusTarefa} mas \`workflowStepInstanceId\` é nulo.`,
        explicacao: 'A etapa corrente é o ponteiro que diz em qual dos 5 passos a Tarefa está agora. Sem ele, nenhuma tela sabe o que mostrar nem o que concluir.',
        impacto: 'A Tarefa fica presa: a Central não sabe desenhar a etapa e o operador não tem ação a tomar.',
        entidade: 'Tarefa', registroId: String(t.id), registroNome: t.titulo, quantidade: 1,
        link: ROTA_CENTRAL,
        recomendacao: 'Verifique o WorkflowEvento mais recente da Tarefa e reconcilie o ponteiro do passo.',
        evidencia: { tarefaId: t.id, processoId: t.processoId, statusTarefa: t.statusTarefa },
      })),
      metricas: { semStep: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 — TAREFA COM MÚLTIPLOS STEPS ATUAIS
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.tarefa-com-steps-concorrentes',
  codigo: 'EMI-002',
  nome: 'No máximo um Step ativo por Tarefa',
  descricao: 'Dois PhaseWorkflowStepInstance não-terminais na mesma cadeia (documento/necessidade) da mesma Tarefa tornam "qual é o passo atual?" ambíguo.',
  dominio: 'WORKFLOW',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: 'A cadeia de 5 passos é sequencial — só um pode estar em aberto por vez. Supersede o excedente pelo Diagnóstico de Runtime.',
  rotaCorrecao: ROTA_RUNTIME,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ tarefaid: number; ativos: number; ids: string }>>(
      `SELECT t.id AS tarefaid, COUNT(psi.id)::int AS ativos, string_agg(psi.id::text, ', ' ORDER BY psi.id) AS ids
         FROM "Tarefa" t
         JOIN "PhaseWorkflowStepInstance" psi
           ON psi."workflowInstanceId" = t."workflowInstanceId"
          AND (
                (t."documentoId" IS NOT NULL AND psi."documentoId" = t."documentoId")
             OR (t."documentoId" IS NULL AND t."necessidadeId" IS NOT NULL AND psi."necessidadeId" = t."necessidadeId")
              )
        WHERE t."faseMacroKey" = '${PHASE_KEY}'
          AND t.tipo = 'NORMAL'
          AND psi.status IN ('${STEP_STATUS_ATIVO.join("','")}')
        GROUP BY t.id
       HAVING COUNT(psi.id) > 1
        LIMIT 50`,
    )
    if (!linhas.length) return vazio({ concorrentes: 0 }, 'Nenhuma Tarefa da Emissão Documental com mais de um Step ativo simultâneo.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-steps-concorrentes:${l.tarefaid}`,
        severidade: 'CRITICO',
        titulo: `Tarefa #${l.tarefaid} tem ${l.ativos} Steps ativos ao mesmo tempo`,
        descricao: `Os passos #${l.ids} estão todos em status não-terminal na mesma cadeia.`,
        explicacao: 'Os 5 passos de "Solicitar Certidão" são sequenciais. Mais de um ativo ao mesmo tempo significa que o motor perdeu a linearidade da cadeia.',
        impacto: 'A tela não sabe qual passo exibir como "atual", e concluir um pode não liberar o certo.',
        entidade: 'PhaseWorkflowStepInstance', registroId: l.ids, quantidade: l.ativos,
        link: ROTA_RUNTIME,
        recomendacao: 'Supersede o(s) Step(s) excedente(s) pelo Diagnóstico de Runtime — nunca apague.',
        evidencia: { tarefaId: l.tarefaid, stepIds: l.ids, ativos: l.ativos },
      })),
      metricas: { concorrentes: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 — STEP ATUAL DE OUTRA TAREFA/PROCESSO
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.step-atual-de-outra-tarefa',
  codigo: 'EMI-003',
  nome: 'O Step atual pertence à própria Tarefa',
  descricao: '`Tarefa.workflowStepInstanceId` precisa apontar para um Step do MESMO processo e da MESMA obrigação (documento/necessidade) da Tarefa — nunca de outra.',
  dominio: 'WORKFLOW',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 15_000,
  orientacao: 'Reaponte o ponteiro da Tarefa para o Step correto da própria cadeia — nunca edite o Step da outra Tarefa.',
  rotaCorrecao: ROTA_RUNTIME,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ tarefaid: number; stepid: number; motivo: string }>>(
      `SELECT t.id AS tarefaid, psi.id AS stepid,
              CASE
                WHEN psi."processoId" != t."processoId" THEN 'processo diferente'
                WHEN t."documentoId" IS NOT NULL AND psi."documentoId" IS NOT NULL AND psi."documentoId" != t."documentoId" THEN 'documento diferente'
                WHEN t."necessidadeId" IS NOT NULL AND psi."necessidadeId" IS NOT NULL AND psi."necessidadeId" != t."necessidadeId" THEN 'necessidade diferente'
                ELSE 'divergência estrutural'
              END AS motivo
         FROM "Tarefa" t
         JOIN "PhaseWorkflowStepInstance" psi ON psi.id = t."workflowStepInstanceId"
        WHERE t."faseMacroKey" = '${PHASE_KEY}'
          AND (
                psi."processoId" != t."processoId"
             OR (t."documentoId" IS NOT NULL AND psi."documentoId" IS NOT NULL AND psi."documentoId" != t."documentoId")
             OR (t."necessidadeId" IS NOT NULL AND psi."necessidadeId" IS NOT NULL AND psi."necessidadeId" != t."necessidadeId")
              )
        LIMIT 50`,
    )
    if (!linhas.length) return vazio({ divergentes: 0 }, 'Todo Step atual pertence à mesma cadeia da Tarefa que o referencia.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-step-de-outra-tarefa:${l.tarefaid}`,
        severidade: 'CRITICO',
        titulo: `Tarefa #${l.tarefaid} aponta para o Step #${l.stepid} de outra obrigação (${l.motivo})`,
        descricao: `O Step atual da Tarefa #${l.tarefaid} pertence a ${l.motivo}.`,
        explicacao: 'O ponteiro "Step atual" é projeção, não identidade — mas precisa apontar para dentro da própria cadeia de instância de workflow da Tarefa.',
        impacto: 'Concluir esta Tarefa poderia mexer no passo de OUTRA obrigação/processo.',
        entidade: 'Tarefa', registroId: String(l.tarefaid), quantidade: 1,
        link: ROTA_RUNTIME,
        recomendacao: 'Reconcilie o ponteiro para o Step correto da própria cadeia.',
        evidencia: { tarefaId: l.tarefaid, stepInstanceId: l.stepid, motivo: l.motivo },
      })),
      metricas: { divergentes: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 — ESPERA OBRIGATÓRIA SEM FOLLOW-UP
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.espera-sem-followup',
  codigo: 'EMI-004',
  nome: 'Espera de terceiro tem follow-up agendado',
  descricao: 'Tarefa em AGUARDANDO_TERCEIRO/CLIENTE sem nenhuma previsão de retorno (SolicitacaoDocumento) nem próximo acompanhamento (metadata.operacao) fica esperando sem data nenhuma para voltar à atenção.',
  dominio: 'TAREFAS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 25_000,
  orientacao: 'Registre a previsão de retorno do cartório (SolicitacaoDocumento.previsaoRetorno) ou um próximo acompanhamento na etapa.',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const candidatos = await prisma.tarefa.findMany({
      where: { faseMacroKey: PHASE_KEY, statusTarefa: { in: STATUS_TAREFA_AGUARDANDO } },
      select: { id: true, titulo: true, processoId: true, workflowStepInstanceId: true },
      take: 500,
    })
    if (!candidatos.length) return vazio({ aguardando: 0, semFollowup: 0 }, 'Nenhuma Tarefa da Emissão Documental aguardando terceiro no momento.')

    const stepIds = [...new Set(candidatos.map((c) => c.workflowStepInstanceId).filter((id): id is number => id != null))]
    const steps = stepIds.length
      ? await prisma.phaseWorkflowStepInstance.findMany({ where: { id: { in: stepIds } }, select: { id: true, metadata: true } })
      : []
    const stepPorId = new Map(steps.map((s) => [s.id, s]))

    const solicitacoes = await prisma.solicitacaoDocumento.findMany({
      where: { tarefaId: { in: candidatos.map((c) => c.id) }, status: { notIn: ['RESPONDIDA', 'CANCELADA'] } },
      select: { tarefaId: true, previsaoRetorno: true },
    })
    const temPrevisao = new Set(solicitacoes.filter((s) => s.previsaoRetorno != null).map((s) => s.tarefaId))

    const semFollowup = candidatos.filter((c) => {
      if (temPrevisao.has(c.id)) return false
      const step = c.workflowStepInstanceId != null ? stepPorId.get(c.workflowStepInstanceId) : null
      const operacao = (step?.metadata as Record<string, unknown> | null)?.operacao ?? null
      return lerAndamento(operacao).proximoAcompanhamento == null
    })
    if (!semFollowup.length) return vazio({ aguardando: candidatos.length, semFollowup: 0 }, `${candidatos.length} Tarefa(s) aguardando terceiro, todas com follow-up agendado.`)
    return {
      achados: semFollowup.map((t): Achado => ({
        chave: `emi-espera-sem-followup:${t.id}`,
        severidade: 'ERRO',
        titulo: `Tarefa #${t.id} aguarda terceiro sem nenhum follow-up agendado`,
        descricao: `"${t.titulo}" está em espera obrigatória sem previsão de retorno nem próximo acompanhamento registrados.`,
        explicacao: 'Espera sem data de volta não aparece em nenhum filtro de atenção — ninguém é avisado quando ela deveria ser revisitada.',
        impacto: 'A operação fica esquecida indefinidamente enquanto aguarda um terceiro.',
        entidade: 'Tarefa', registroId: String(t.id), registroNome: t.titulo, quantidade: 1,
        link: ROTA_CENTRAL,
        recomendacao: 'Registre a previsão de retorno do cartório ou um próximo acompanhamento.',
        evidencia: { tarefaId: t.id, processoId: t.processoId },
      })),
      metricas: { aguardando: candidatos.length, semFollowup: semFollowup.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 — FOLLOW-UP VENCIDO
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.followup-vencido',
  codigo: 'EMI-005',
  nome: 'Follow-up vencido é sinalizado a tempo',
  descricao: 'Tarefa aguardando terceiro com o próximo acompanhamento (metadata.operacao.proximoAcompanhamento) já vencido deveria estar em ACOMPANHAMENTO_VENCIDO/EM_RISCO — não passar em silêncio.',
  dominio: 'TAREFAS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 25_000,
  orientacao: 'Abra "Acompanhar hoje"/"Em risco" na Central e trate o retorno — ou reagende o próximo acompanhamento.',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const candidatos = await prisma.tarefa.findMany({
      where: { faseMacroKey: PHASE_KEY, statusTarefa: { in: STATUS_TAREFA_AGUARDANDO }, workflowStepInstanceId: { not: null } },
      select: { id: true, titulo: true, processoId: true, workflowStepInstanceId: true },
      take: 500,
    })
    if (!candidatos.length) return vazio({ aguardando: 0, vencidos: 0 }, 'Nenhuma Tarefa da Emissão Documental aguardando terceiro no momento.')

    const stepIds = [...new Set(candidatos.map((c) => c.workflowStepInstanceId).filter((id): id is number => id != null))]
    const steps = await prisma.phaseWorkflowStepInstance.findMany({ where: { id: { in: stepIds } }, select: { id: true, metadata: true } })
    const stepPorId = new Map(steps.map((s) => [s.id, s]))

    const agoraISO = new Date().toISOString().slice(0, 10)
    const vencidos = candidatos.filter((c) => {
      const step = c.workflowStepInstanceId != null ? stepPorId.get(c.workflowStepInstanceId) : null
      const operacao = (step?.metadata as Record<string, unknown> | null)?.operacao ?? null
      const data = lerAndamento(operacao).proximoAcompanhamento
      return data != null && data < agoraISO
    })
    if (!vencidos.length) return vazio({ aguardando: candidatos.length, vencidos: 0 }, `${candidatos.length} Tarefa(s) aguardando terceiro, nenhuma com acompanhamento vencido.`)
    return {
      achados: vencidos.map((t): Achado => ({
        chave: `emi-followup-vencido:${t.id}`,
        severidade: 'ALERTA',
        titulo: `Tarefa #${t.id} tem follow-up vencido`,
        descricao: `"${t.titulo}" tem próximo acompanhamento agendado para uma data já passada.`,
        explicacao: 'Um follow-up vencido é exatamente o gatilho que a leitura temporal canônica (`proximo-acontecimento.ts`) usa para marcar ACOMPANHAMENTO_VENCIDO/EM_RISCO — esta Tarefa precisa aparecer em "Acompanhar hoje"/"Em risco" na Central.',
        impacto: 'O acompanhamento planejado não aconteceu na data prevista; a operação está mais atrasada do que a tela mostra se o filtro não a capturar.',
        entidade: 'Tarefa', registroId: String(t.id), registroNome: t.titulo, quantidade: 1,
        link: ROTA_CENTRAL,
        recomendacao: 'Trate o acompanhamento vencido ou reagende para uma data futura.',
        evidencia: { tarefaId: t.id, processoId: t.processoId },
      })),
      metricas: { aguardando: candidatos.length, vencidos: vencidos.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 — RETORNO RECEBIDO AINDA CLASSIFICADO COMO ESPERA
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.retorno-recebido-ainda-espera',
  codigo: 'EMI-006',
  nome: 'Retorno recebido sai do estado de espera',
  descricao: 'SolicitacaoDocumento com status RESPONDIDA, mas a Tarefa continua em AGUARDANDO_TERCEIRO/CLIENTE — o retorno chegou e ninguém agiu.',
  dominio: 'TAREFAS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 15_000,
  orientacao: 'Use `retomarDeEspera` para tirar a Tarefa da espera — o retorno já está registrado, falta a ação interna.',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ tarefaid: number; titulo: string; solicitacaoid: number }>>(
      `SELECT t.id AS tarefaid, t.titulo, s.id AS solicitacaoid
         FROM "Tarefa" t
         JOIN "SolicitacaoDocumento" s ON s."tarefaId" = t.id
        WHERE t."faseMacroKey" = '${PHASE_KEY}'
          AND t."statusTarefa" IN ('${STATUS_TAREFA_AGUARDANDO.join("','")}')
          AND s.status = 'RESPONDIDA'
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ retornoSemAcao: 0 }, 'Nenhuma Tarefa continua em espera depois do retorno já registrado.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-retorno-sem-acao:${l.tarefaid}`,
        severidade: 'ERRO',
        titulo: `Tarefa #${l.tarefaid} recebeu retorno mas continua em espera`,
        descricao: `"${l.titulo}" tem a SolicitacaoDocumento #${l.solicitacaoid} RESPONDIDA, mas o status da Tarefa ainda é de espera.`,
        explicacao: 'Retorno confiável de terceiro é AÇÃO NECESSÁRIA imediata (Etapa 3, item 8) — a Tarefa não deveria continuar classificada como em espera.',
        impacto: 'O operador não vê que precisa agir; a Tarefa parece corretamente "aguardando" quando já tem o que fazer.',
        entidade: 'Tarefa', registroId: String(l.tarefaid), registroNome: l.titulo, quantidade: 1,
        link: ROTA_CENTRAL,
        recomendacao: 'Tire a Tarefa da espera pela porta canônica (`retomarDeEspera`).',
        evidencia: { tarefaId: l.tarefaid, solicitacaoId: l.solicitacaoid },
      })),
      metricas: { retornoSemAcao: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 — TAREFA DUPLICADA PARA A MESMA OBRIGAÇÃO
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.tarefa-duplicada',
  codigo: 'EMI-007',
  nome: 'Uma Tarefa ativa por obrigação',
  descricao: 'Duas Tarefas NORMAL ativas para a mesma necessidadeId ou documentoId representam a mesma obrigação sendo trabalhada duas vezes.',
  dominio: 'TAREFAS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: 'Identifique qual Tarefa é a legítima (histórico de eventos mais antigo/mais avançado) e supersede a outra — nunca apague.',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const porNecessidade = await prisma.$queryRawUnsafe<Array<{ necessidadeid: number; n: number; ids: string }>>(
      `SELECT "necessidadeId" AS necessidadeid, COUNT(*)::int AS n, string_agg(id::text, ', ' ORDER BY id) AS ids
         FROM "Tarefa"
        WHERE "faseMacroKey" = '${PHASE_KEY}' AND tipo = 'NORMAL' AND "necessidadeId" IS NOT NULL
          AND "statusTarefa" NOT IN ('${STATUS_TAREFA_TERMINAL.join("','")}')
        GROUP BY "necessidadeId" HAVING COUNT(*) > 1 LIMIT 50`,
    )
    const porDocumento = await prisma.$queryRawUnsafe<Array<{ documentoid: number; n: number; ids: string }>>(
      `SELECT "documentoId" AS documentoid, COUNT(*)::int AS n, string_agg(id::text, ', ' ORDER BY id) AS ids
         FROM "Tarefa"
        WHERE "faseMacroKey" = '${PHASE_KEY}' AND tipo = 'NORMAL' AND "documentoId" IS NOT NULL
          AND "statusTarefa" NOT IN ('${STATUS_TAREFA_TERMINAL.join("','")}')
        GROUP BY "documentoId" HAVING COUNT(*) > 1 LIMIT 50`,
    )
    const achados: Achado[] = [
      ...porNecessidade.map((l): Achado => ({
        chave: `emi-tarefa-duplicada-necessidade:${l.necessidadeid}`, severidade: 'CRITICO',
        titulo: `${l.n} Tarefas ativas para a mesma necessidade #${l.necessidadeid}`,
        descricao: `Tarefas #${l.ids} estão todas ativas para \`necessidadeId=${l.necessidadeid}\`.`,
        explicacao: 'Uma obrigação real corresponde a UMA Tarefa canônica (contrato do motor operacional).',
        impacto: 'Trabalho duplicado, contadores inflados, e risco de decisões conflitantes na mesma obrigação.',
        entidade: 'Tarefa', registroId: l.ids, quantidade: l.n,
        link: ROTA_CENTRAL,
        recomendacao: 'Supersede a Tarefa excedente — preserve o histórico da que continua.',
        evidencia: { necessidadeId: l.necessidadeid, tarefaIds: l.ids },
      })),
      ...porDocumento.map((l): Achado => ({
        chave: `emi-tarefa-duplicada-documento:${l.documentoid}`, severidade: 'CRITICO',
        titulo: `${l.n} Tarefas ativas para o mesmo documento #${l.documentoid}`,
        descricao: `Tarefas #${l.ids} estão todas ativas para \`documentoId=${l.documentoid}\`.`,
        explicacao: 'Uma obrigação real corresponde a UMA Tarefa canônica (contrato do motor operacional).',
        impacto: 'Trabalho duplicado, contadores inflados, e risco de decisões conflitantes no mesmo documento.',
        entidade: 'Tarefa', registroId: l.ids, quantidade: l.n,
        link: ROTA_CENTRAL,
        recomendacao: 'Supersede a Tarefa excedente — preserve o histórico da que continua.',
        evidencia: { documentoId: l.documentoid, tarefaIds: l.ids },
      })),
    ]
    if (!achados.length) return vazio({ duplicadas: 0 }, 'Nenhuma obrigação da Emissão Documental com Tarefa duplicada.')
    return { achados, metricas: { duplicadas: achados.length } }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 — NECESSIDADE SATISFEITA SEM DOCUMENTO VÁLIDO
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.necessidade-atendida-sem-documento-valido',
  codigo: 'EMI-008',
  nome: 'Necessidade ATENDIDA tem documento vigente e válido',
  descricao: 'NecessidadeDocumental.status=ATENDIDA sem nenhum Documento vigente (não substituído) e válido (fora de INVALIDO/CANCELADO) afirma uma entrega que não existe.',
  dominio: 'SISTEMA_DOCUMENTAL',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: 'Reabra o atendimento da necessidade (`reabrirAtendimentoNecessidade`) ou vincule o documento vigente correto.',
  rotaCorrecao: ROTA_KANBAN,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT n.id FROM "NecessidadeDocumental" n
        WHERE n.status = 'ATENDIDA'
          AND NOT EXISTS (
            SELECT 1 FROM "Documento" d
             WHERE d."necessidadeId" = n.id
               AND d."substituidoEm" IS NULL
               AND d.status NOT IN ('${DOC_STATUS_INVALIDO.join("','")}')
          )
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ semDocumentoValido: 0 }, 'Toda necessidade ATENDIDA tem documento vigente e válido.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-necessidade-sem-doc-valido:${l.id}`,
        severidade: 'CRITICO',
        titulo: `Necessidade #${l.id} está ATENDIDA sem documento válido`,
        descricao: `Nenhum Documento vigente e válido atende à necessidade #${l.id}.`,
        explicacao: 'ATENDIDA afirma que a obrigação foi cumprida. Sem um documento vigente e válido, a afirmação não se sustenta.',
        impacto: 'O gate da fase considera a necessidade resolvida e o processo avança sem a prova real.',
        entidade: 'NecessidadeDocumental', registroId: String(l.id), quantidade: 1,
        link: ROTA_KANBAN,
        recomendacao: 'Reabra o atendimento da necessidade ou vincule o documento vigente correto.',
        evidencia: { necessidadeId: l.id },
      })),
      metricas: { semDocumentoValido: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 — DOCUMENTO OPERACIONAL SEM NECESSIDADE QUANDO EXIGIDA
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.documento-sem-necessidade-vinculada',
  codigo: 'EMI-009',
  nome: 'Documento da Emissão Documental tem necessidade vinculada',
  descricao: 'Documento referenciado por uma Tarefa do fluxo de Emissão Documental sem `necessidadeId` perdeu o vínculo com a obrigação que o originou.',
  dominio: 'SISTEMA_DOCUMENTAL',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: 'Reconcilie `Documento.necessidadeId` com a NecessidadeDocumental que originou o pedido.',
  rotaCorrecao: ROTA_KANBAN,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ documentoid: number; tarefaid: number }>>(
      `SELECT DISTINCT d.id AS documentoid, t.id AS tarefaid
         FROM "Documento" d
         JOIN "Tarefa" t ON t."documentoId" = d.id
        WHERE t."faseMacroKey" = '${PHASE_KEY}' AND d."necessidadeId" IS NULL
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ semNecessidade: 0 }, 'Todo documento da Emissão Documental tem necessidade vinculada.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-documento-sem-necessidade:${l.documentoid}`,
        severidade: 'ERRO',
        titulo: `Documento #${l.documentoid} da Emissão Documental sem necessidade vinculada`,
        descricao: `A Tarefa #${l.tarefaid} referencia o Documento #${l.documentoid}, que não tem \`necessidadeId\`.`,
        explicacao: 'O motor documental é REGRA → NECESSIDADE → DOCUMENTO → TAREFA. Documento sem necessidade perdeu a origem que justifica sua existência.',
        impacto: 'Não dá para saber qual obrigação real este documento resolve, nem contabilizá-lo na Planilha Documental.',
        entidade: 'Documento', registroId: String(l.documentoid), quantidade: 1,
        link: ROTA_KANBAN,
        recomendacao: 'Vincule o documento à NecessidadeDocumental correta.',
        evidencia: { documentoId: l.documentoid, tarefaId: l.tarefaid },
      })),
      metricas: { semNecessidade: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 10 — DOCUMENTO VALIDADO SEM ARQUIVO/VERSÃO
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.documento-avancado-sem-arquivo',
  codigo: 'EMI-010',
  nome: 'Documento em estágio avançado tem arquivo',
  descricao: 'Documento em RECEBIDO/EM_ANALISE/TRADUZIDO/APOSTILADO/ENTREGUE sem nenhum DocumentoArquivo afirma um estágio que não tem prova física.',
  dominio: 'SISTEMA_DOCUMENTAL',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: 'Anexe o DocumentoArquivo correspondente ou reverta o status do documento para um estágio anterior.',
  rotaCorrecao: ROTA_KANBAN,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ id: number; status: string }>>(
      `SELECT d.id, d.status FROM "Documento" d
        WHERE d.status IN ('RECEBIDO','EM_ANALISE','TRADUZIDO','APOSTILADO','ENTREGUE')
          AND NOT EXISTS (SELECT 1 FROM "DocumentoArquivo" a WHERE a."documentoId" = d.id)
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ semArquivo: 0 }, 'Todo documento em estágio avançado tem DocumentoArquivo correspondente.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-documento-sem-arquivo:${l.id}`,
        severidade: 'ERRO',
        titulo: `Documento #${l.id} está em ${l.status} sem nenhum arquivo`,
        descricao: `O status "${l.status}" afirma um estágio avançado, mas não existe nenhum DocumentoArquivo vinculado.`,
        explicacao: '`DocumentoArquivo` é o modelo real da prova física/versão do documento — status avançado sem ele é afirmação sem lastro.',
        impacto: 'A conferência e a validação (passos 4 e 5) não têm o que examinar de fato.',
        entidade: 'Documento', registroId: String(l.id), quantidade: 1,
        link: ROTA_KANBAN,
        recomendacao: 'Anexe o arquivo correspondente ou reverta o status.',
        evidencia: { documentoId: l.id, status: l.status },
      })),
      metricas: { semArquivo: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 11 — VERSÃO MARCADA ATUAL E REJEITADA SIMULTANEAMENTE
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.documento-vigente-e-invalidado',
  codigo: 'EMI-011',
  nome: 'Documento vigente não está invalidado ao mesmo tempo',
  descricao: 'Documento com `substituidoEm=NULL` (ainda marcado como a via vigente) e `status=INVALIDO`, tendo já uma via derivada dele, deveria ter sido marcado como substituído quando a nova via nasceu.',
  dominio: 'SISTEMA_DOCUMENTAL',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: 'Marque `substituidoEm` na via rejeitada — a via derivada já existe e deveria ser a vigente.',
  rotaCorrecao: ROTA_KANBAN,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ id: number; derivadoid: number }>>(
      `SELECT d.id, d2.id AS derivadoid FROM "Documento" d
         JOIN "Documento" d2 ON d2."derivadoDeId" = d.id
        WHERE d.status = 'INVALIDO' AND d."substituidoEm" IS NULL
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ conflitantes: 0 }, 'Nenhum documento invalidado com via derivada continua marcado como vigente.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-vigente-e-invalidado:${l.id}`,
        severidade: 'ERRO',
        titulo: `Documento #${l.id} está INVALIDO mas ainda marcado como vigente`,
        descricao: `Já existe uma via derivada (#${l.derivadoid}), mas o documento #${l.id} continua com \`substituidoEm=NULL\`.`,
        explicacao: '`novaViaDocumental` deveria marcar `substituidoEm` na via anterior ao criar a nova. As duas flags — "vigente" e "invalidado" — não podem valer ao mesmo tempo para o mesmo documento.',
        impacto: 'Duas respostas para "qual é o documento que vale?" — a leitura pode escolher a via rejeitada.',
        entidade: 'Documento', registroId: String(l.id), quantidade: 1,
        link: ROTA_KANBAN,
        recomendacao: 'Marque `substituidoEm` no documento invalidado.',
        evidencia: { documentoId: l.id, derivadoId: l.derivadoid },
      })),
      metricas: { conflitantes: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 12 — OWNERSHIP DIVERGENTE ENTRE PROJEÇÕES (Tarefa × Step atual)
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.ownership-tarefa-x-step',
  codigo: 'EMI-012',
  nome: 'Responsável da Tarefa é o mesmo do Step atual',
  descricao: '`Tarefa.responsavelId` é a fonte única de ownership operacional. Divergir do `responsavelId` do próprio Step atual é duas respostas para "de quem é este trabalho".',
  dominio: 'TAREFAS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: 'Reatribua pela porta canônica da Tarefa — o Step nunca deve carregar um responsável próprio divergente.',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ tarefaid: number; resptarefa: number; respstep: number }>>(
      `SELECT t.id AS tarefaid, t."responsavelId" AS resptarefa, psi."responsavelId" AS respstep
         FROM "Tarefa" t
         JOIN "PhaseWorkflowStepInstance" psi ON psi.id = t."workflowStepInstanceId"
        WHERE t."faseMacroKey" = '${PHASE_KEY}'
          AND t."responsavelId" IS NOT NULL AND psi."responsavelId" IS NOT NULL
          AND t."responsavelId" != psi."responsavelId"
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ divergentes: 0 }, 'O responsável da Tarefa e do Step atual sempre coincidem.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-ownership-divergente:${l.tarefaid}`,
        severidade: 'ERRO',
        titulo: `Tarefa #${l.tarefaid} tem responsável diferente do seu Step atual`,
        descricao: `\`Tarefa.responsavelId=${l.resptarefa}\` mas o Step atual tem \`responsavelId=${l.respstep}\`.`,
        explicacao: '`responsavelId` da Tarefa é a fonte única de ownership (contrato canônico). O Step não deveria carregar um dono diferente.',
        impacto: 'Uma tela que leia o Step mostra um responsável; a que lê a Tarefa mostra outro.',
        entidade: 'Tarefa', registroId: String(l.tarefaid), quantidade: 1,
        link: ROTA_CENTRAL,
        recomendacao: 'Reconcilie o responsável do Step para o mesmo da Tarefa.',
        evidencia: { tarefaId: l.tarefaid, responsavelTarefa: l.resptarefa, responsavelStep: l.respstep },
      })),
      metricas: { divergentes: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 13 — TAREFA CONCLUÍDA COM STEP FINAL INVÁLIDO
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.concluida-sem-ultimo-passo',
  codigo: 'EMI-013',
  nome: 'Tarefa concluída completou o último passo publicado',
  descricao: 'Tarefa em status terminal de conclusão cujo último passo da cadeia publicada (maior ordem) não está CONCLUIDO não terminou de verdade a obrigação.',
  dominio: 'WORKFLOW',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 25_000,
  orientacao: 'Investigue o histórico de eventos: a Tarefa foi marcada concluída sem passar pelo último passo (ex.: validar_certidao).',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ tarefaid: number; documentoid: number; ultimostepkey: string }>>(
      `WITH ultimo_passo AS (
         SELECT DISTINCT ON (s."workflowId") s."workflowId", s.key AS stepkey
           FROM "PhaseInternalWorkflowStep" s
          ORDER BY s."workflowId", s.ordem DESC
       )
       SELECT t.id AS tarefaid, t."documentoId" AS documentoid, up.stepkey AS ultimostepkey
         FROM "Tarefa" t
         JOIN "PhaseWorkflowInstance" wi ON wi.id = t."workflowInstanceId"
         JOIN ultimo_passo up ON up."workflowId" = wi."workflowDefinitionId"
        WHERE t."faseMacroKey" = '${PHASE_KEY}'
          AND t."statusTarefa" IN ('CONCLUIDO_RECEBIDO','CONCLUIDO_NAO_POSSUI')
          AND t."documentoId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "PhaseWorkflowStepInstance" psi
             WHERE psi."documentoId" = t."documentoId" AND psi."stepKey" = up.stepkey AND psi.status = 'CONCLUIDO'
          )
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ semUltimoPasso: 0 }, 'Toda Tarefa concluída completou o último passo da cadeia publicada.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-concluida-sem-ultimo-passo:${l.tarefaid}`,
        severidade: 'CRITICO',
        titulo: `Tarefa #${l.tarefaid} está concluída sem ter completado "${l.ultimostepkey}"`,
        descricao: `O documento #${l.documentoid} nunca teve o passo "${l.ultimostepkey}" (o último da cadeia publicada) CONCLUIDO.`,
        explicacao: 'Concluir a Tarefa deveria significar que a cadeia inteira, até o último passo publicado, foi cumprida.',
        impacto: 'A obrigação é contada como entregue sem ter passado pela decisão final (ex.: validação jurídica).',
        entidade: 'Tarefa', registroId: String(l.tarefaid), quantidade: 1,
        link: ROTA_CENTRAL,
        recomendacao: 'Investigue o histórico de eventos e reabra a Tarefa se o passo final não foi realmente cumprido.',
        evidencia: { tarefaId: l.tarefaid, documentoId: l.documentoid, ultimoStepKey: l.ultimostepkey },
      })),
      metricas: { semUltimoPasso: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 14 — CANCELADA CONTADA COMO CONCLUÍDA
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.cancelada-nao-e-concluida',
  codigo: 'EMI-014',
  nome: 'Tarefa CANCELADA nunca está marcada como concluída',
  descricao: '`Tarefa.concluida=true` com `statusTarefa=CANCELADA` faria cancelamento contar como sucesso em qualquer projeção que leia só a flag `concluida`.',
  dominio: 'TAREFAS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 15_000,
  orientacao: 'CANCELADA nunca é CONCLUÍDA (regra permanente) — corrija a flag `concluida` para `false`.',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.tarefa.findMany({
      where: { faseMacroKey: PHASE_KEY, statusTarefa: 'CANCELADA', concluida: true },
      select: { id: true, titulo: true, processoId: true },
      take: 100,
    })
    if (!linhas.length) return vazio({ canceladaComoConcluida: 0 }, 'Nenhuma Tarefa CANCELADA está marcada como concluída.')
    return {
      achados: linhas.map((t): Achado => ({
        chave: `emi-cancelada-concluida:${t.id}`,
        severidade: 'CRITICO',
        titulo: `Tarefa #${t.id} está CANCELADA e marcada como concluída`,
        descricao: `"${t.titulo}" tem \`statusTarefa=CANCELADA\` e \`concluida=true\` ao mesmo tempo.`,
        explicacao: 'CANCELADA != CONCLUÍDA é regra permanente do sistema — cancelamento nunca conta como sucesso, em nenhuma tela.',
        impacto: 'Qualquer contagem/relatório que use `concluida` como critério de sucesso conta um cancelamento como entrega.',
        entidade: 'Tarefa', registroId: String(t.id), registroNome: t.titulo, quantidade: 1,
        link: ROTA_CENTRAL,
        recomendacao: 'Corrija `concluida` para `false` nesta Tarefa.',
        evidencia: { tarefaId: t.id, processoId: t.processoId },
      })),
      metricas: { canceladaComoConcluida: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 15 — CONFIGURAÇÃO PUBLICADA INEXISTENTE
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.instancia-sem-workflow-definicao',
  codigo: 'EMI-015',
  nome: 'Instância de workflow aponta para workflow que existe',
  descricao: '`PhaseWorkflowInstance.workflowDefinitionId` apontando para um `PhaseInternalWorkflow` removido deixa a instância sem configuração nenhuma para consultar.',
  dominio: 'WORKFLOW',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 15_000,
  orientacao: 'Um workflow publicado nunca deveria ser fisicamente removido (só arquivado). Restaure o registro ou reconcilie a instância.',
  rotaCorrecao: ROTA_RUNTIME,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ id: number; processoid: number; workflowdefinitionid: number }>>(
      `SELECT wi.id, wi."processoId" AS processoid, wi."workflowDefinitionId" AS workflowdefinitionid
         FROM "PhaseWorkflowInstance" wi
        WHERE wi."faseMacroKey" = '${PHASE_KEY}'
          AND wi."workflowDefinitionId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "PhaseInternalWorkflow" w WHERE w.id = wi."workflowDefinitionId")
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ semDefinicao: 0 }, 'Toda instância de workflow da Emissão Documental aponta para um workflow existente.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-instancia-sem-definicao:${l.id}`,
        severidade: 'CRITICO',
        titulo: `Instância #${l.id} aponta para o workflow #${l.workflowdefinitionid}, que não existe`,
        descricao: `A instância da fase do processo #${l.processoid} referencia um \`PhaseInternalWorkflow\` removido.`,
        explicacao: 'A instância só sabe o que fazer consultando a definição publicada. Sem ela, não há mais como resolver ações, requisitos nem checklist.',
        impacto: 'A fase fica travada sem nenhuma configuração para orientar a execução.',
        entidade: 'PhaseWorkflowInstance', registroId: String(l.id), quantidade: 1,
        link: ROTA_RUNTIME,
        recomendacao: 'Restaure o workflow removido ou reconcilie a instância para uma definição existente.',
        evidencia: { instanciaId: l.id, processoId: l.processoid, workflowDefinitionId: l.workflowdefinitionid },
      })),
      metricas: { semDefinicao: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 16 — OPERAÇÃO APONTANDO PARA CONFIGURAÇÃO REMOVIDA (Step)
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.step-instance-sem-definicao',
  codigo: 'EMI-016',
  nome: 'Step em execução aponta para um passo que existe',
  descricao: '`PhaseWorkflowStepInstance.stepDefinitionId` apontando para um `PhaseInternalWorkflowStep` removido deixa a operação sem cadastro (ações/campos/checklist) para consultar.',
  dominio: 'WORKFLOW',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 15_000,
  orientacao: 'Um passo publicado nunca deveria ser fisicamente removido (só inativado). Restaure o registro com a mesma chave ou reconcilie a execução.',
  rotaCorrecao: ROTA_RUNTIME,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ id: number; stepkey: string; stepdefinitionid: number }>>(
      `SELECT psi.id, psi."stepKey" AS stepkey, psi."stepDefinitionId" AS stepdefinitionid
         FROM "PhaseWorkflowStepInstance" psi
        WHERE psi."faseMacroKey" = '${PHASE_KEY}'
          AND psi."stepDefinitionId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "PhaseInternalWorkflowStep" s WHERE s.id = psi."stepDefinitionId")
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ semDefinicao: 0 }, 'Todo Step em execução da Emissão Documental aponta para um passo existente.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-step-sem-definicao:${l.id}`,
        severidade: 'CRITICO',
        titulo: `Step #${l.id} ("${l.stepkey}") aponta para uma definição removida`,
        descricao: `\`stepDefinitionId=${l.stepdefinitionid}\` não existe mais em \`PhaseInternalWorkflowStep\`.`,
        explicacao: 'A instância do passo consulta a definição para ações, campos, checklist e executor. Sem ela, a etapa não sabe se desenhar.',
        impacto: 'A tela cai no painel genérico ou fica sem nenhuma capacidade — o operador não consegue agir.',
        entidade: 'PhaseWorkflowStepInstance', registroId: String(l.id), registroNome: l.stepkey, quantidade: 1,
        link: ROTA_RUNTIME,
        recomendacao: 'Restaure o passo removido com a mesma chave, inativando-o em vez de apagá-lo.',
        evidencia: { stepInstanceId: l.id, stepKey: l.stepkey, stepDefinitionId: l.stepdefinitionid },
      })),
      metricas: { semDefinicao: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 17 — HANDOFF SEM ATOR VÁLIDO
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.responsavel-inexistente',
  codigo: 'EMI-017',
  nome: 'Responsável da Tarefa existe como usuário',
  descricao: '`Tarefa.responsavelId` apontando para um Usuario inexistente é um handoff para ninguém.',
  dominio: 'USUARIOS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 15_000,
  orientacao: 'Reatribua a Tarefa a um usuário existente pela porta canônica de atribuição.',
  rotaCorrecao: ROTA_CENTRAL,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ id: number; titulo: string; responsavelid: number }>>(
      `SELECT t.id, t.titulo, t."responsavelId" AS responsavelid
         FROM "Tarefa" t
        WHERE t."faseMacroKey" = '${PHASE_KEY}'
          AND t."responsavelId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Usuario" u WHERE u.id = t."responsavelId")
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ semAtor: 0 }, 'Todo responsável de Tarefa da Emissão Documental existe como usuário.')
    return {
      achados: linhas.map((t): Achado => ({
        chave: `emi-responsavel-inexistente:${t.id}`,
        severidade: 'CRITICO',
        titulo: `Tarefa #${t.id} está atribuída a um usuário que não existe`,
        descricao: `\`responsavelId=${t.responsavelid}\` não corresponde a nenhum Usuario.`,
        explicacao: 'Um handoff precisa de um ator real para receber o trabalho.',
        impacto: 'A Tarefa não aparece na fila de ninguém e não pode ser executada.',
        entidade: 'Tarefa', registroId: String(t.id), registroNome: t.titulo, quantidade: 1,
        link: ROTA_CENTRAL,
        recomendacao: 'Reatribua a um usuário existente.',
        evidencia: { tarefaId: t.id, responsavelId: t.responsavelid },
      })),
      metricas: { semAtor: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 18 — HISTÓRICO INCONSISTENTE (WorkflowEvento fora de ordem)
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.historico-fora-de-ordem',
  codigo: 'EMI-018',
  nome: 'Histórico de eventos do Step é internamente consistente',
  descricao: 'PASSO_CONCLUIDO sem um PASSO_INSTANCIADO anterior no mesmo Step, ou mais de um TAREFA_GERADA para a mesma Tarefa, quebram a cadeia de eventos append-only.',
  dominio: 'EVENTOS',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ERRO',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: 'Investigue a origem do evento fora de ordem — WorkflowEvento é append-only e nunca deveria ser escrito fora da sequência real.',
  rotaCorrecao: ROTA_RUNTIME,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    // O predecessor exigido é PASSO_INSTANCIADO, não PASSO_INICIADO: o primeiro
    // passo de uma cadeia SEQUENCIAL nasce DISPONIVEL e pode ser concluído
    // direto (ações como COMPLETE_STEP/REGISTER_ONLY), sem nunca passar por
    // EM_ANDAMENTO — confirmado com dado real de produção (Processo 589,
    // passo `solicitar_certidao`: PASSO_INSTANCIADO → TAREFA_GERADA →
    // PASSO_CONCLUIDO, sem PASSO_INICIADO, 5 ocorrências idênticas — padrão
    // legítimo, não corrupção). O que NUNCA pode faltar é a instanciação.
    const semInstanciacao = await prisma.$queryRawUnsafe<Array<{ id: number; stepinstanceid: number }>>(
      `SELECT e.id, e."stepInstanceId" AS stepinstanceid
         FROM "WorkflowEvento" e
         JOIN "PhaseWorkflowStepInstance" psi ON psi.id = e."stepInstanceId"
        WHERE psi."faseMacroKey" = '${PHASE_KEY}'
          AND e.tipo = 'PASSO_CONCLUIDO' AND e."stepInstanceId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "WorkflowEvento" i
             WHERE i.tipo = 'PASSO_INSTANCIADO' AND i."stepInstanceId" = e."stepInstanceId" AND i.id < e.id
          )
        LIMIT 100`,
    )
    const tarefaGeradaDuplicada = await prisma.$queryRawUnsafe<Array<{ tarefaid: number; n: number }>>(
      `SELECT e."tarefaId" AS tarefaid, COUNT(*)::int AS n
         FROM "WorkflowEvento" e
         JOIN "Tarefa" t ON t.id = e."tarefaId"
        WHERE t."faseMacroKey" = '${PHASE_KEY}' AND e.tipo = 'TAREFA_GERADA' AND e."tarefaId" IS NOT NULL
        GROUP BY e."tarefaId" HAVING COUNT(*) > 1
        LIMIT 100`,
    )
    const achados: Achado[] = [
      ...semInstanciacao.map((l): Achado => ({
        chave: `emi-passo-concluido-sem-inicio:${l.id}`, severidade: 'ERRO',
        titulo: `Evento #${l.id} conclui o Step #${l.stepinstanceid} sem ele ter sido instanciado antes`,
        descricao: `PASSO_CONCLUIDO existe sem nenhum PASSO_INSTANCIADO anterior para o Step #${l.stepinstanceid}.`,
        explicacao: 'A cadeia de eventos append-only só faz sentido em ordem: instanciar vem sempre antes de concluir (mesmo quando o passo é concluído direto, sem passar por PASSO_INICIADO — isso é legítimo para o primeiro passo de uma cadeia SEQUENCIAL).',
        impacto: 'A linha do tempo da etapa fica incoerente; auditoria não confia na sequência.',
        entidade: 'WorkflowEvento', registroId: String(l.id), quantidade: 1,
        link: ROTA_RUNTIME,
        recomendacao: 'Investigue quem gravou o evento fora de ordem.',
        evidencia: { eventoId: l.id, stepInstanceId: l.stepinstanceid },
      })),
      ...tarefaGeradaDuplicada.map((l): Achado => ({
        chave: `emi-tarefa-gerada-duplicada:${l.tarefaid}`, severidade: 'ERRO',
        titulo: `Tarefa #${l.tarefaid} tem ${l.n} eventos TAREFA_GERADA`,
        descricao: `Deveria existir exatamente UM TAREFA_GERADA por Tarefa (uma obrigação, uma Tarefa canônica).`,
        explicacao: 'Mais de um TAREFA_GERADA sugere que o motor tratou a mesma Tarefa como se tivesse nascido duas vezes.',
        impacto: 'Relatórios de origem/criação da Tarefa ficam ambíguos.',
        entidade: 'Tarefa', registroId: String(l.tarefaid), quantidade: l.n,
        link: ROTA_RUNTIME,
        recomendacao: 'Investigue a origem do segundo evento — não deveria existir.',
        evidencia: { tarefaId: l.tarefaid, ocorrencias: l.n },
      })),
    ]
    if (!achados.length) return vazio({ inconsistencias: 0 }, 'O histórico de eventos da Emissão Documental está em ordem.')
    return { achados, metricas: { inconsistencias: achados.length } }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 19 — DOCUMENTO INVALIDADO AINDA SATISFAZENDO NECESSIDADE
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.documento-invalido-ainda-satisfaz',
  codigo: 'EMI-019',
  nome: 'Documento INVALIDO não deixa a necessidade ATENDIDA apontando para ele',
  descricao: 'Necessidade ATENDIDA cujo único documento é o mesmo que está INVALIDO reabre exatamente o bug já corrigido em `efeitos-de-dominio.ts::invalidarDocumento` (que chama `reabrirAtendimentoNecessidade`).',
  dominio: 'SISTEMA_DOCUMENTAL',
  modulo: 'Emissão Documental',
  severidadePadrao: 'CRITICO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 15_000,
  orientacao: 'Chame `reabrirAtendimentoNecessidade` para a necessidade — o documento que a satisfazia foi invalidado.',
  rotaCorrecao: ROTA_KANBAN,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ documentoid: number; necessidadeid: number }>>(
      `SELECT d.id AS documentoid, n.id AS necessidadeid
         FROM "Documento" d
         JOIN "NecessidadeDocumental" n ON n.id = d."necessidadeId"
        WHERE d.status = 'INVALIDO' AND n.status = 'ATENDIDA'
          AND NOT EXISTS (
            SELECT 1 FROM "Documento" d2
             WHERE d2."necessidadeId" = n.id AND d2.id != d.id
               AND d2."substituidoEm" IS NULL AND d2.status NOT IN ('${DOC_STATUS_INVALIDO.join("','")}')
          )
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ necessidadeAindaAtendida: 0 }, 'Nenhum documento invalidado ainda satisfaz uma necessidade ATENDIDA.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-doc-invalido-ainda-satisfaz:${l.documentoid}`,
        severidade: 'CRITICO',
        titulo: `Necessidade #${l.necessidadeid} continua ATENDIDA apontando só para o Documento #${l.documentoid} (INVALIDO)`,
        descricao: `O documento #${l.documentoid} foi invalidado, mas a necessidade #${l.necessidadeid} continua com status ATENDIDA.`,
        explicacao: 'Este é exatamente o bug corrigido em `invalidarDocumento` (chama `reabrirAtendimentoNecessidade` quando o documento invalidado tinha necessidadeId). Se aparecer aqui, o efeito de invalidação não passou por essa porta para este registro.',
        impacto: 'O gate da fase considera a necessidade resolvida por um documento que já não vale mais.',
        entidade: 'NecessidadeDocumental', registroId: String(l.necessidadeid), quantidade: 1,
        link: ROTA_KANBAN,
        recomendacao: 'Reabra o atendimento da necessidade (`reabrirAtendimentoNecessidade`).',
        evidencia: { documentoId: l.documentoid, necessidadeId: l.necessidadeid },
      })),
      metricas: { necessidadeAindaAtendida: linhas.length },
    }
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// 20 — PROJEÇÃO DIVERGENTE (Tarefa × Documento legado)
// ═══════════════════════════════════════════════════════════════════════════
registrar({
  id: 'saude.emissao.responsavel-tarefa-x-documento',
  codigo: 'EMI-020',
  nome: 'Responsável da Tarefa e do Documento (campos legados) coincidem',
  descricao: '`Tarefa.responsavelId` (motor operacional canônico) e `Documento.responsavelId` (campo legado de operação, pré-Tarefa) divergindo faz duas telas mostrarem donos diferentes para a mesma obrigação.',
  dominio: 'SISTEMA_DOCUMENTAL',
  modulo: 'Emissão Documental',
  severidadePadrao: 'ALERTA',
  obrigatoria: false,
  modos: ['COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.8.0',
  timeoutMs: 20_000,
  orientacao: '`Tarefa.responsavelId` é a fonte única (contrato canônico) — reconcilie o campo legado do Documento para o mesmo valor.',
  rotaCorrecao: ROTA_KANBAN,
  responsavel: 'Emissão Documental',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ tarefaid: number; documentoid: number; resptarefa: number; respdocumento: number }>>(
      `SELECT t.id AS tarefaid, d.id AS documentoid, t."responsavelId" AS resptarefa, d."responsavelId" AS respdocumento
         FROM "Tarefa" t
         JOIN "Documento" d ON d.id = t."documentoId"
        WHERE t."faseMacroKey" = '${PHASE_KEY}'
          AND t."responsavelId" IS NOT NULL AND d."responsavelId" IS NOT NULL
          AND t."responsavelId" != d."responsavelId"
        LIMIT 100`,
    )
    if (!linhas.length) return vazio({ divergentes: 0 }, 'O responsável da Tarefa e do Documento (campo legado) sempre coincidem.')
    return {
      achados: linhas.map((l): Achado => ({
        chave: `emi-projecao-divergente:${l.tarefaid}`,
        severidade: 'ALERTA',
        titulo: `Tarefa #${l.tarefaid} e Documento #${l.documentoid} mostram responsáveis diferentes`,
        descricao: `\`Tarefa.responsavelId=${l.resptarefa}\` mas \`Documento.responsavelId=${l.respdocumento}\` (campo legado de operação).`,
        explicacao: 'O motor canônico é a Tarefa; `Documento.responsavelId` é campo de operação anterior ao motor de Tarefa/Workflow/Step. Uma tela que ainda leia do Documento mostraria um dono diferente da Central Operacional.',
        impacto: 'Duas telas discordam sobre quem é o responsável pela mesma obrigação.',
        entidade: 'Tarefa', registroId: String(l.tarefaid), quantidade: 1,
        link: ROTA_KANBAN,
        recomendacao: 'Reconcilie `Documento.responsavelId` para o mesmo valor de `Tarefa.responsavelId`.',
        evidencia: { tarefaId: l.tarefaid, documentoId: l.documentoid, responsavelTarefa: l.resptarefa, responsavelDocumento: l.respdocumento },
      })),
      metricas: { divergentes: linhas.length },
    }
  },
})
