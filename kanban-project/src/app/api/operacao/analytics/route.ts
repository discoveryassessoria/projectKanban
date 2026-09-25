// src/app/api/operacao/analytics/route.ts
// ============================================================================
// A CAMADA DE ANALYTICS OPERACIONAL — a primeira vez que o sistema olha pra
// trás e pra frente, não só pro AGORA (mandato "grandes fluxos operacionais",
// 24/09/2026). Até aqui, toda tela (Minha Operação, Distribuição, Tarefas e
// Projetos) era fotografia do instante — nenhuma mostrava tendência, gargalo
// por etapa, performance de terceiro ou projeção de capacidade.
//
//   GET /api/operacao/analytics
//
// FONTE ÚNICA: `Tarefa.createdAt`/`.dataConclusao`/`.faseMacroKey` e
// `Documento.orgao` — os MESMOS campos que toda projeção já usa. Nenhuma
// tabela nova, nenhum número estimado: se não há dado suficiente pra uma
// métrica, ela volta `null`, nunca um valor inventado.
//
// Gestão de TODA a operação — mesma régua de admin que Distribuição/Tarefas
// e Projetos.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { prisma } from '@/lib/prisma'

const STATUS_CONCLUIDOS_SUCESSO = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] as const
const STATUS_ABERTOS = ['NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_CLIENTE', 'AGUARDANDO_TERCEIRO', 'BLOQUEADA'] as const

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  // Mesma hierarquia de Distribuição/visão global: ver a operação inteira é gestão.
  if (usuario.tipo !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores veem os analytics da operação inteira.' }, { status: 403 })
  }

  const agora = new Date()
  const semanasNoPeriodo = 8
  const inicioPeriodo = new Date(agora)
  inicioPeriodo.setDate(inicioPeriodo.getDate() - semanasNoPeriodo * 7)

  const [concluidasNoPeriodo, abertasAgora, criadasNoPeriodo] = await Promise.all([
    prisma.tarefa.findMany({
      where: { statusTarefa: { in: [...STATUS_CONCLUIDOS_SUCESSO] }, dataConclusao: { gte: inicioPeriodo } },
      select: { id: true, dataConclusao: true, createdAt: true, faseMacroKey: true, documento: { select: { orgao: { select: { name: true } } } } },
    }),
    prisma.tarefa.count({ where: { statusTarefa: { in: [...STATUS_ABERTOS] } } }),
    prisma.tarefa.findMany({
      where: { createdAt: { gte: inicioPeriodo } },
      select: { createdAt: true },
    }),
  ])

  // ── D1: THROUGHPUT POR SEMANA — quantas Tarefas a operação INTEIRA fecha
  // por semana, últimas 8 semanas. Semana ISO (segunda a domingo), fuso do
  // servidor (mesma régua de `tempo-operacional.ts`).
  const inicioDaSemana = (d: Date) => {
    const x = new Date(d)
    const dia = (x.getDay() + 6) % 7 // 0 = segunda
    x.setDate(x.getDate() - dia)
    x.setHours(0, 0, 0, 0)
    return x
  }
  const throughputMapa = new Map<string, number>()
  for (let i = 0; i < semanasNoPeriodo; i++) {
    const s = new Date(inicioDaSemana(agora))
    s.setDate(s.getDate() - i * 7)
    throughputMapa.set(s.toISOString().slice(0, 10), 0)
  }
  for (const t of concluidasNoPeriodo) {
    if (!t.dataConclusao) continue
    const chave = inicioDaSemana(t.dataConclusao).toISOString().slice(0, 10)
    if (throughputMapa.has(chave)) throughputMapa.set(chave, (throughputMapa.get(chave) ?? 0) + 1)
  }
  const throughputPorSemana = [...throughputMapa.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, concluidas]) => ({ semana, concluidas }))

  // ── D2: GARGALO POR FASE — tempo médio de ciclo (criação → conclusão),
  // agrupado por `faseMacroKey`. A fase com maior média é onde o processo
  // trava, não onde alguém trabalha devagar — é o desenho do fluxo, não a pessoa.
  const porFase = new Map<string, { somaHoras: number; quantidade: number }>()
  for (const t of concluidasNoPeriodo) {
    if (!t.dataConclusao || !t.faseMacroKey) continue
    const horas = (t.dataConclusao.getTime() - t.createdAt.getTime()) / 3_600_000
    const atual = porFase.get(t.faseMacroKey) ?? { somaHoras: 0, quantidade: 0 }
    porFase.set(t.faseMacroKey, { somaHoras: atual.somaHoras + horas, quantidade: atual.quantidade + 1 })
  }
  const gargaloPorFase = [...porFase.entries()]
    .map(([faseMacroKey, v]) => ({ faseMacroKey, tempoMedioDias: Math.round((v.somaHoras / v.quantidade / 24) * 10) / 10, quantidade: v.quantidade }))
    .sort((a, b) => b.tempoMedioDias - a.tempoMedioDias)

  // ── D3: PERFORMANCE DE TERCEIRO — mesma régua (tempo médio de ciclo),
  // agrupada por `Documento.orgao.name`. Só entra quem tem terceiro
  // identificado — sem terceiro não é "terceiro rápido", é "sem terceiro".
  const porTerceiro = new Map<string, { somaHoras: number; quantidade: number }>()
  for (const t of concluidasNoPeriodo) {
    const nome = t.documento?.orgao?.name
    if (!t.dataConclusao || !nome) continue
    const horas = (t.dataConclusao.getTime() - t.createdAt.getTime()) / 3_600_000
    const atual = porTerceiro.get(nome) ?? { somaHoras: 0, quantidade: 0 }
    porTerceiro.set(nome, { somaHoras: atual.somaHoras + horas, quantidade: atual.quantidade + 1 })
  }
  const performanceTerceiro = [...porTerceiro.entries()]
    .map(([terceiro, v]) => ({ terceiro, tempoMedioDias: Math.round((v.somaHoras / v.quantidade / 24) * 10) / 10, quantidade: v.quantidade }))
    .sort((a, b) => b.tempoMedioDias - a.tempoMedioDias)
    .slice(0, 15)

  // ── D4: CAPACIDADE — ritmo de entrada vs. ritmo de saída, projetado sobre
  // o backlog ATUAL. `null` quando a saída é zero (projeção não faz sentido
  // — sem dado suficiente, nunca um número inventado).
  const semanas = semanasNoPeriodo
  const mediaCriadasPorSemana = Math.round((criadasNoPeriodo.length / semanas) * 10) / 10
  const mediaConcluidasPorSemana = Math.round((concluidasNoPeriodo.length / semanas) * 10) / 10
  const semanasParaZerarBacklog = mediaConcluidasPorSemana > mediaCriadasPorSemana
    ? Math.round((abertasAgora / (mediaConcluidasPorSemana - mediaCriadasPorSemana)) * 10) / 10
    : null

  return NextResponse.json({
    periodoSemanas: semanasNoPeriodo,
    throughputPorSemana,
    gargaloPorFase,
    performanceTerceiro,
    capacidade: {
      backlogAtual: abertasAgora,
      mediaCriadasPorSemana,
      mediaConcluidasPorSemana,
      semanasParaZerarBacklog,
      tendenciaSaudavel: mediaConcluidasPorSemana >= mediaCriadasPorSemana,
    },
  })
}
