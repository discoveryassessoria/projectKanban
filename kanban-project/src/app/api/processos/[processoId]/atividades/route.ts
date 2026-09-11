// src/app/api/processos/[processoId]/atividades/route.ts
// ============================================================================
// O HISTÓRICO DE ATIVIDADES DE UM PROCESSO — granularidade completa +
// marcos gerenciais, na mesma linha do tempo (spec Tarefas e Projetos §10-12).
//
//   GET /api/processos/123/atividades?limite=200
//
// Rota de LEITURA pura: intercala `LogAuditoria` (por tarefa), `PhaseAdvanceLog`
// (marco de fase — a MESMA fonte que decide se um avanço aconteceu),
// `WorkflowEvento` (etapa) e `DocumentoObservacao`/`DocumentoArquivo`. Nenhuma
// tabela nova, nenhum recálculo: ver `atividadesDoProcesso`.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { atividadesDoProcesso } from '@/lib/operacional/tarefa-projecoes'

export async function GET(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, 'processos.ver')
  if (erro) return erro

  const { processoId: raw } = await params
  const processoId = Number(raw)
  if (!Number.isInteger(processoId) || processoId <= 0) {
    return NextResponse.json({ error: 'processoId inválido' }, { status: 400 })
  }

  const limite = Number(request.nextUrl.searchParams.get('limite'))
  const atividades = await atividadesDoProcesso(processoId, {
    limite: Number.isInteger(limite) && limite > 0 ? limite : undefined,
  })
  return NextResponse.json({ atividades })
}
