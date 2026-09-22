// src/services/prazo-sla/varredura-prazo-sla.ts
// ============================================================================
// VARREDURA — classifica risco/vencimento/acompanhamento vencido das tarefas
// vinculadas a uma Política de Prazo/SLA e emite os eventos correspondentes,
// UM POR MARCO (idempotente: rodar de novo no mesmo dia não duplica). Nunca
// conclui/cancela/move fase — só registra o fato e, quando a política pedir,
// o escalonamento.
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { StatusTarefa } from "@prisma/client"
import { classificarRisco, acompanhamentoVencido, diaOperacional } from "@/lib/operacional/motor-prazo-sla"

const STATUS_TERMINAIS: StatusTarefa[] = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"]

export interface RelatorioVarreduraPrazoSla {
  avaliadas: number
  proximoDoVencimento: number
  vencido: number
  retornoAAtencao: number
  escalonamentosGerados: number
}

/**
 * Cria o evento SE ele ainda não existir para esta chave — devolve `true`
 * quando de fato criou agora (nunca confia em timestamp pra decidir isso: um
 * relógio controlado de teste pode estar longe do "agora" real do banco).
 */
async function registrarSeNovo(chave: string, dados: {
  tipo: string; tarefaId: number; processoId: number | null; politicaId: number | null; politicaVersaoId: number | null
  valorNovo: unknown; criadoEm: Date
}): Promise<boolean> {
  const existente = await prisma.eventoPrazoSla.findUnique({ where: { chaveIdempotencia: chave }, select: { id: true } })
  if (existente) return false
  await prisma.eventoPrazoSla.create({
    data: {
      tipo: dados.tipo, tarefaId: dados.tarefaId, processoId: dados.processoId,
      politicaId: dados.politicaId, politicaVersaoId: dados.politicaVersaoId,
      valorNovo: dados.valorNovo as never, chaveIdempotencia: chave, criadoEm: dados.criadoEm,
    },
  }).catch((e) => {
    // Corrida entre duas execuções concorrentes na MESMA chave — a
    // constraint única do banco já garantiu que só uma vingou; a outra não é
    // erro, é a mesma idempotência funcionando por baixo.
    if (e?.code !== "P2002") throw e
  })
  return true
}

export async function varrerPrazosEAcompanhamentosSla(opts: { agora?: Date } = {}): Promise<RelatorioVarreduraPrazoSla> {
  const agora = opts.agora ?? new Date()
  const dia = diaOperacional(agora)

  const tarefas = await prisma.tarefa.findMany({
    where: { politicaPrazoSlaVersaoId: { not: null }, concluida: false, statusTarefa: { notIn: STATUS_TERMINAIS } },
    select: { id: true, processoId: true, dataPrazo: true, proximoAcompanhamentoEm: true, politicaPrazoSlaId: true, politicaPrazoSlaVersaoId: true },
  })

  const r: RelatorioVarreduraPrazoSla = { avaliadas: tarefas.length, proximoDoVencimento: 0, vencido: 0, retornoAAtencao: 0, escalonamentosGerados: 0 }

  for (const t of tarefas) {
    const versao = t.politicaPrazoSlaVersaoId ? await prisma.politicaPrazoSlaVersao.findUnique({ where: { id: t.politicaPrazoSlaVersaoId } }) : null
    if (!versao) continue

    const risco = classificarRisco(agora, t.dataPrazo, versao.riscoAntecedenciaDias)
    if (risco === "PROXIMO_DO_VENCIMENTO") {
      const novo = await registrarSeNovo(`PRAZO_PROXIMO_VENCIMENTO::${t.id}::${dia}`, {
        tipo: "PRAZO_PROXIMO_VENCIMENTO", tarefaId: t.id, processoId: t.processoId,
        politicaId: t.politicaPrazoSlaId, politicaVersaoId: t.politicaPrazoSlaVersaoId,
        valorNovo: { dataPrazo: t.dataPrazo }, criadoEm: agora,
      })
      if (novo) r.proximoDoVencimento++
    } else if (risco === "VENCIDO") {
      const novo = await registrarSeNovo(`PRAZO_VENCIDO::${t.id}::${dia}`, {
        tipo: "PRAZO_VENCIDO", tarefaId: t.id, processoId: t.processoId,
        politicaId: t.politicaPrazoSlaId, politicaVersaoId: t.politicaPrazoSlaVersaoId,
        valorNovo: { dataPrazo: t.dataPrazo }, criadoEm: agora,
      })
      if (novo) r.vencido++

      // ESCALONAMENTO — só se a política pedir, e só na cadência configurada
      // (nunca todo dia, a menos que lembreteAtrasoRecorrenciaDias === 1).
      if (versao.escalonamentoAtivo) {
        const recorrencia = versao.lembreteAtrasoRecorrenciaDias ?? 1
        const ultimo = await prisma.eventoPrazoSla.findFirst({
          where: { tarefaId: t.id, tipo: "ESCALONAMENTO_GERADO" }, orderBy: { criadoEm: "desc" }, select: { criadoEm: true },
        })
        const diasDesdeUltimo = ultimo ? Math.floor((agora.getTime() - ultimo.criadoEm.getTime()) / 86400000) : Infinity
        if (diasDesdeUltimo >= recorrencia) {
          await prisma.eventoPrazoSla.create({
            data: {
              tipo: "ESCALONAMENTO_GERADO", tarefaId: t.id, processoId: t.processoId, politicaId: t.politicaPrazoSlaId, politicaVersaoId: t.politicaPrazoSlaVersaoId,
              valorNovo: { papel: versao.escalonamentoPapel, destinatarioId: versao.escalonamentoDestinatarioId },
              chaveIdempotencia: `ESCALONAMENTO_GERADO::${t.id}::${agora.toISOString()}`,
              criadoEm: agora,
            },
          })
          r.escalonamentosGerados++
        }
      }
    }

    if (acompanhamentoVencido(agora, t.proximoAcompanhamentoEm)) {
      const novo = await registrarSeNovo(`RETORNO_A_ATENCAO::${t.id}::${dia}`, {
        tipo: "RETORNO_A_ATENCAO", tarefaId: t.id, processoId: t.processoId,
        politicaId: t.politicaPrazoSlaId, politicaVersaoId: t.politicaPrazoSlaVersaoId,
        valorNovo: { proximoAcompanhamentoEm: t.proximoAcompanhamentoEm }, criadoEm: agora,
      })
      if (novo) r.retornoAAtencao++
    }
  }

  return r
}
