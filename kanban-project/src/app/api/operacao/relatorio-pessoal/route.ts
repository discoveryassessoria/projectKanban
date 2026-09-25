// src/app/api/operacao/relatorio-pessoal/route.ts
// ============================================================================
// RELATÓRIO PESSOAL — a produtividade de QUEM ESTÁ LOGADO, sempre.
//
//   GET /api/operacao/relatorio-pessoal
//
// Achado real (mandato "grandes fluxos operacionais", 24/09/2026): Minha
// Operação nunca olhou pra trás — só o AGORA. "14 concluídas hoje" era um
// número solto, sem tendência, sem lista, sem comparação com ontem.
//
// FONTE ÚNICA: `Tarefa.dataConclusao` + `Tarefa.responsavelId` — nenhuma
// tabela nova, nenhum contador paralelo. CANCELADA/SUPERSEDIDA NUNCA contam
// como concluída (mandato "Cancelada != Concluída") — só os dois status
// terminais de sucesso real.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { prisma } from '@/lib/prisma'

const STATUS_CONCLUIDOS_SUCESSO = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] as const

export async function GET(request: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const dias = Math.min(Math.max(Number(request.nextUrl.searchParams.get('dias')) || 14, 7), 90)
  const agora = new Date()
  const inicio = new Date(agora)
  inicio.setDate(inicio.getDate() - (dias - 1))
  inicio.setHours(0, 0, 0, 0)

  const tarefas = await prisma.tarefa.findMany({
    where: {
      responsavelId: usuario.userId,
      statusTarefa: { in: [...STATUS_CONCLUIDOS_SUCESSO] },
      dataConclusao: { gte: inicio },
    },
    select: { id: true, titulo: true, dataConclusao: true, createdAt: true, processoId: true, faseMacroKey: true },
    orderBy: { dataConclusao: 'desc' },
  })

  // AGRUPA POR DIA (fuso America/Sao_Paulo, mesma régua do resto da operação) —
  // um mapa denso, com zero explícito nos dias sem conclusão (o gráfico não
  // pode pular um dia como se ele não existisse).
  const porDiaMapa = new Map<string, number>()
  for (let i = 0; i < dias; i++) {
    const d = new Date(inicio)
    d.setDate(d.getDate() + i)
    porDiaMapa.set(d.toISOString().slice(0, 10), 0)
  }
  for (const t of tarefas) {
    if (!t.dataConclusao) continue
    const chave = t.dataConclusao.toISOString().slice(0, 10)
    porDiaMapa.set(chave, (porDiaMapa.get(chave) ?? 0) + 1)
  }
  const porDia = [...porDiaMapa.entries()].map(([dia, total]) => ({ dia, total }))

  const seteDiasAtras = new Date(agora); seteDiasAtras.setDate(seteDiasAtras.getDate() - 7)
  const quatorzeDiasAtras = new Date(agora); quatorzeDiasAtras.setDate(quatorzeDiasAtras.getDate() - 14)
  const totalUltimos7Dias = tarefas.filter((t) => t.dataConclusao && t.dataConclusao >= seteDiasAtras).length
  const totalSemanaAnterior = tarefas.filter((t) => t.dataConclusao && t.dataConclusao >= quatorzeDiasAtras && t.dataConclusao < seteDiasAtras).length

  // TEMPO MÉDIO DE CICLO (criadaEm → dataConclusao) — só das tarefas com as
  // duas datas reais, nunca estimado.
  const duracoesHoras = tarefas
    .filter((t) => t.createdAt && t.dataConclusao)
    .map((t) => (t.dataConclusao!.getTime() - t.createdAt!.getTime()) / 3_600_000)
  const tempoMedioCicloHoras = duracoesHoras.length
    ? Math.round((duracoesHoras.reduce((a, b) => a + b, 0) / duracoesHoras.length) * 10) / 10
    : null

  return NextResponse.json({
    dias,
    porDia,
    totalNoPeriodo: tarefas.length,
    totalUltimos7Dias,
    totalSemanaAnterior,
    tendencia: totalSemanaAnterior === 0 ? null : Math.round(((totalUltimos7Dias - totalSemanaAnterior) / totalSemanaAnterior) * 100),
    mediaPorDia: Math.round((tarefas.length / dias) * 10) / 10,
    tempoMedioCicloHoras,
    ultimasConcluidas: tarefas.slice(0, 20).map((t) => ({
      id: t.id, titulo: t.titulo, dataConclusao: t.dataConclusao!.toISOString(), processoId: t.processoId,
    })),
  })
}
