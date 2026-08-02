// lib/saude/persistencia.ts
//
// Grava a rodada e dá VIDA aos achados: um problema tem primeira detecção,
// última detecção, recorrências e resolução. É isso que distingue "problema
// novo" de "problema que voltou" e permite medir tempo de correção.
//
// O histórico nunca é apagado.

import { prisma } from '@/lib/prisma'
import { verificacaoPorCodigo } from './catalogo'
import type { ResultadoDiagnostico } from './tipos'

export interface ResumoPersistencia {
  execucaoId: number
  novos: number
  reincidentes: number
  persistentes: number
  resolvidos: number
}

/** Identidade estável do problema entre execuções. */
const chaveGlobal = (codigo: string, chaveLocal: string) => `${codigo}::${chaveLocal}`.slice(0, 300)

export async function persistirDiagnostico(
  r: ResultadoDiagnostico,
  opts: { disparadoPorId?: number | null } = {},
): Promise<ResumoPersistencia> {
  const execucao = await prisma.saudeExecucao.create({
    data: {
      modo: r.modo, estado: r.estado, motivoEstado: r.motivoEstado, versaoCatalogo: r.versaoCatalogo,
      iniciadoEm: new Date(r.iniciadoEm), concluidoEm: new Date(r.concluidoEm), duracaoMs: r.duracaoMs,
      totalCatalogo: r.totalCatalogo, totalElegiveis: r.totalElegiveis, executadas: r.executadas,
      aprovadas: r.aprovadas, comAchados: r.comAchados, falhasTecnicas: r.falhasTecnicas,
      naoExecutadas: r.naoExecutadas, coberturaPercentual: r.coberturaPercentual,
      criticos: r.criticos, erros: r.erros, alertas: r.alertas, informativos: r.informativos,
      dominiosSemCobertura: r.dominiosSemCobertura,
      disparadoPorId: opts.disparadoPorId ?? null,
      // o JSON guarda o resultado por verificação SEM os achados (que viram linha)
      execucoes: r.execucoes.map((e) => ({
        codigo: e.codigo, status: e.status, duracaoMs: e.duracaoMs,
        achados: e.achados.length, metricas: e.metricas ?? null, resumo: e.resumo ?? null, erro: e.erro ?? null,
      })),
    },
    select: { id: true },
  })

  const agora = new Date()
  let novos = 0, reincidentes = 0, persistentes = 0

  // Códigos que REALMENTE rodaram — só eles podem "resolver" um achado. Se a
  // verificação falhou, o problema dela continua aberto (ausência de resultado
  // não é ausência de problema).
  const codigosConclusivos = new Set(
    r.execucoes.filter((e) => e.status === 'APROVADA' || e.status === 'COM_ACHADOS').map((e) => e.codigo),
  )

  const chavesVistas = new Set<string>()
  for (const exec of r.execucoes) {
    const meta = verificacaoPorCodigo(exec.codigo)
    for (const a of exec.achados) {
      const chave = chaveGlobal(exec.codigo, a.chave)
      chavesVistas.add(chave)
      const anterior = await prisma.saudeAchado.findUnique({ where: { chave }, select: { id: true, status: true, recorrencias: true } })

      const comum = {
        codigo: exec.codigo,
        dominio: meta?.dominio ?? 'BANCO',
        modulo: meta?.modulo ?? '—',
        severidade: a.severidade,
        titulo: a.titulo.slice(0, 300),
        descricao: a.descricao,
        explicacao: a.explicacao ?? null,
        impacto: a.impacto ?? null,
        entidade: a.entidade ?? null,
        registroId: a.registroId ?? null,
        registroNome: a.registroNome?.slice(0, 300) ?? null,
        quantidade: a.quantidade ?? 1,
        link: a.link ?? meta?.rotaCorrecao ?? null,
        recomendacao: a.recomendacao ?? meta?.orientacao ?? null,
        correcaoAutomatica: a.correcaoAutomatica ?? meta?.correcaoAutomatica ?? null,
        evidencia: (a.evidencia ?? undefined) as never,
        versaoCatalogo: r.versaoCatalogo,
        execucaoId: execucao.id,
        ultimaDeteccao: agora,
      }

      if (!anterior) {
        await prisma.saudeAchado.create({ data: { chave, ...comum, status: 'ABERTO', primeiraDeteccao: agora } })
        novos++
      } else if (anterior.status === 'RESOLVIDO') {
        // voltou depois de resolvido: é REINCIDENTE, e isso fica registrado
        await prisma.saudeAchado.update({
          where: { chave },
          data: { ...comum, status: 'REINCIDENTE', recorrencias: anterior.recorrencias + 1, resolvidoEm: null },
        })
        reincidentes++
      } else {
        await prisma.saudeAchado.update({
          where: { chave },
          data: { ...comum, recorrencias: anterior.recorrencias + 1 },
        })
        persistentes++
      }
    }
  }

  // Resolução: só marca quem a verificação conclusiva DEIXOU de encontrar.
  const abertos = await prisma.saudeAchado.findMany({
    where: { status: { notIn: ['RESOLVIDO'] }, codigo: { in: [...codigosConclusivos] } },
    select: { id: true, chave: true },
  })
  const paraResolver = abertos.filter((x) => !chavesVistas.has(x.chave)).map((x) => x.id)
  if (paraResolver.length) {
    await prisma.saudeAchado.updateMany({
      where: { id: { in: paraResolver } },
      data: { status: 'RESOLVIDO', resolvidoEm: agora },
    })
  }

  return { execucaoId: execucao.id, novos, reincidentes, persistentes, resolvidos: paraResolver.length }
}

/** Última execução persistida (para a tela abrir com o retrato mais recente). */
export async function ultimaExecucao() {
  return prisma.saudeExecucao.findFirst({ orderBy: { criadoEm: 'desc' } })
}

/** Achados vivos, do pior para o menos grave. */
export async function achadosAbertos(limite = 500) {
  const ordem = { CRITICO: 0, ERRO: 1, ALERTA: 2, INFORMATIVO: 3 } as Record<string, number>
  const lista = await prisma.saudeAchado.findMany({
    where: { status: { notIn: ['RESOLVIDO'] } },
    orderBy: { ultimaDeteccao: 'desc' },
    take: limite,
  })
  return lista.sort((a, b) => (ordem[a.severidade] ?? 9) - (ordem[b.severidade] ?? 9))
}
