// src/app/api/operacao/visao-global/familias/route.ts
// ============================================================================
// A LEITURA AGRUPADA POR FAMÍLIA — o mesmo universo da visão global, resumido.
//
//   GET /api/operacao/visao-global/familias
//
// Existe para não rolar uma lista de centenas de tarefas quando a pergunta é
// "como está a família Medina Olivares": cada linha é uma família, expansível
// até a fase. Mesmo escopo de gestão da visão global — mesmo gate de admin.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { agregacaoPorFamilia } from '@/lib/operacional/tarefa-projecoes'

export async function GET(_request: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(_request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  // Mesma hierarquia da visão global: ver a operação inteira, agrupada ou não,
  // é ato de gestão — `tarefas.editar` sozinho não prova isso.
  if (usuario.tipo !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores veem a operação inteira. Use a Minha Fila.' }, { status: 403 })
  }

  const familias = await agregacaoPorFamilia(new Date())
  const processos = new Set(familias.flatMap((f) => f.processos.map((p) => p.processoId)))
  return NextResponse.json({
    familias,
    total: familias.length,
    indicadores: {
      tarefas: familias.reduce((n, f) => n + f.total, 0),
      aFazer: familias.reduce((n, f) => n + f.aFazer, 0),
      atrasadas: familias.reduce((n, f) => n + f.atrasadas, 0),
      venceEm7Dias: familias.reduce((n, f) => n + f.venceEm7Dias, 0),
      familias: familias.length,
      processos: processos.size,
    },
  })
}
