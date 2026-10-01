// POST /api/torre/processos/certidoes — o "a de b" das CERTIDÕES de cada linha da página (aba Processos).
//   body: { processoIds: number[] }   (no máximo 50: são as linhas da página)
//   →     { certidoes: Array<{ processoId, aplicavel, recebidas, requeridas, percentual }> }
// A conta é a FONTE ÚNICA `documentacaoRequeridaDoProcesso` (a mesma do Geral, Documentos, Central e Foco) — pesada por processo, por isso
// só se pede a das linhas que a tela mostra.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { certidoesDosProcessos } from '@/lib/operacional/torre-processos'

export async function POST(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const ids: number[] = Array.isArray(b?.processoIds) ? b.processoIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (ids.length === 0) return NextResponse.json({ error: 'processoIds é obrigatório' }, { status: 400 })
  if (ids.length > 50) return NextResponse.json({ error: 'no máximo 50 processos por pedido' }, { status: 400 })
  return NextResponse.json({ certidoes: await certidoesDosProcessos(ids) })
}
