// GET /api/gerenciamento/saude/historico
//
// Evolução da saúde ao longo do tempo: execuções, estado por rodada, problemas
// novos × resolvidos × recorrentes, tempo médio de resolução e módulos com mais
// falhas. O histórico nunca é apagado — é ele que mostra regressão após deploy.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const limite = Math.min(Number(new URL(request.url).searchParams.get('limite')) || 30, 200)

    const [execucoes, achados] = await Promise.all([
      prisma.saudeExecucao.findMany({
        orderBy: { criadoEm: 'desc' }, take: limite,
        select: {
          id: true, modo: true, estado: true, criadoEm: true, duracaoMs: true,
          coberturaPercentual: true, executadas: true, totalElegiveis: true,
          criticos: true, erros: true, alertas: true, informativos: true, falhasTecnicas: true,
        },
      }),
      prisma.saudeAchado.findMany({
        select: {
          id: true, codigo: true, dominio: true, severidade: true, status: true, titulo: true,
          primeiraDeteccao: true, ultimaDeteccao: true, resolvidoEm: true, recorrencias: true,
        },
        orderBy: { ultimaDeteccao: 'desc' }, take: 1000,
      }),
    ])

    const resolvidos = achados.filter((a) => a.status === 'RESOLVIDO' && a.resolvidoEm)
    const tempoMedioResolucaoHoras = resolvidos.length
      ? Math.round(
          resolvidos.reduce((soma, a) => soma + (a.resolvidoEm!.getTime() - a.primeiraDeteccao.getTime()), 0)
            / resolvidos.length / 3_600_000,
        )
      : null

    // módulos que mais falham — onde vale investir esforço
    const porDominio = new Map<string, { total: number; abertos: number; criticos: number }>()
    for (const a of achados) {
      const atual = porDominio.get(a.dominio) ?? { total: 0, abertos: 0, criticos: 0 }
      atual.total++
      if (a.status !== 'RESOLVIDO') atual.abertos++
      if (a.severidade === 'CRITICO') atual.criticos++
      porDominio.set(a.dominio, atual)
    }

    return NextResponse.json({
      execucoes: execucoes.reverse(), // ordem cronológica para o gráfico
      tendencia: {
        totalAchados: achados.length,
        abertos: achados.filter((a) => a.status !== 'RESOLVIDO').length,
        resolvidos: resolvidos.length,
        recorrentes: achados.filter((a) => a.recorrencias > 1).length,
        reincidentes: achados.filter((a) => a.status === 'REINCIDENTE').length,
        tempoMedioResolucaoHoras,
      },
      porDominio: [...porDominio.entries()]
        .map(([dominio, v]) => ({ dominio, ...v }))
        .sort((a, b) => b.abertos - a.abertos || b.total - a.total),
    })
  } catch (e) {
    console.error('GET saude/historico', e)
    return NextResponse.json({ error: 'Erro ao carregar o histórico de saúde.' }, { status: 500 })
  }
}
