// GET  /api/processos/{processoId}/historico  — o Histórico do processo (aba "Histórico"): UM registro por FATO REAL.
// GET  …?formato=csv&<filtros>                — CSV do que está filtrado (neutraliza fórmulas; auditado).
// POST …  { formato: 'pdf', filtros, linhas }  — registra a exportação em PDF (desenhado no navegador).
// Permissão: `processos.ver`, conferida aqui (esconder botão não é controle de acesso). Escopo: o processo da URL.
// A fonte é a MESMA do Foco da família na Torre (`src/services/historico-processo.ts`).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirPermissao } from '@/src/lib/verificar-permissao'
import { getHistorico, postHistorico, idDoProcesso } from '@/src/lib/historico-rota'

export async function GET(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirPermissao(request, 'processos.ver')
  if (erro) return erro
  const id = idDoProcesso((await ctx.params).processoId)
  if (id == null) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  return getHistorico(request, id, usuario)
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ processoId: string }> }) {
  const { usuario, erro } = await exigirPermissao(request, 'processos.ver')
  if (erro) return erro
  const id = idDoProcesso((await ctx.params).processoId)
  if (id == null) return NextResponse.json({ error: 'processo inválido' }, { status: 400 })
  return postHistorico(request, id, usuario)
}
