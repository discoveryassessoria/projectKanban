// src/app/api/operacao/visao-global/familias/route.ts
// ============================================================================
// A LEITURA AGRUPADA POR FAMÍLIA — o mesmo universo da visão global, resumido.
//
//   GET /api/operacao/visao-global/familias?fase=EMISSAO&responsavel=7
//
// Existe para não rolar uma lista de centenas de tarefas quando a pergunta é
// "como está a família Medina Olivares": cada linha é uma família, expansível
// até a fase. Mesmo escopo de gestão da visão global — mesmo gate de admin —
// e ACEITA OS MESMOS FILTROS: a barra de filtros de "Tarefas e Projetos" é
// uma só para Visão Geral/Lista/Kanban/Calendário, não uma por aba.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { agregacaoPorFamilia, indicadoresGerenciais } from '@/lib/operacional/tarefa-projecoes'
import { parseFiltrosGerenciais } from '@/lib/operacional/parse-filtros-gerenciais'

export async function GET(request: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  // Mesma hierarquia da visão global: ver a operação inteira, agrupada ou não,
  // é ato de gestão — `tarefas.editar` sozinho não prova isso.
  if (usuario.tipo !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores veem a operação inteira. Use a Minha Fila.' }, { status: 403 })
  }

  const filtros = parseFiltrosGerenciais(request)
  const agora = new Date()
  const [familias, indicadoresCanonicos] = await Promise.all([
    agregacaoPorFamilia(agora, filtros),
    // "Tarefas abertas"/"Concluídas hoje" usam a MESMA semântica canônica de
    // indicadoresGerenciais (Central/Home) — nunca um número derivado só desta
    // agregação (doc 15 §5: "Abertas" e "Quadro" são perguntas diferentes de
    // propósito; o tile do topo faz a pergunta de "Abertas").
    indicadoresGerenciais(filtros, agora),
  ])
  const processos = new Set(familias.flatMap((f) => f.processos.map((p) => p.processoId)))
  return NextResponse.json({
    familias,
    total: familias.length,
    indicadores: {
      tarefasAbertas: indicadoresCanonicos.total,
      atrasadas: indicadoresCanonicos.atrasadas,
      venceEm7Dias: familias.reduce((n, f) => n + f.venceEm7Dias, 0),
      concluidasHoje: indicadoresCanonicos.concluidasHoje,
      familias: familias.length,
      processos: processos.size,
      // Mantidos por compatibilidade com quem já lia estes dois campos.
      tarefas: familias.reduce((n, f) => n + f.total, 0),
      aFazer: familias.reduce((n, f) => n + f.aFazer, 0),
    },
  })
}
