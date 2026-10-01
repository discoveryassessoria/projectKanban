// POST /api/torre/processos/fases — o resumo por fase da aba PROCESSOS (cartão "Saúde da fase" e botões de fase).
//   body: { processoIds: number[] }   (os processos que a tela está vendo — já recortados por país/busca do cabeçalho)
//   →     { colunas, tempos, metaPadrao, fluxo }  (ver `torre-fase-dados.ts`). Só leitura; sem N+1.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { colunasVisiveisDaTorre } from '@/lib/operacional/torre-processos'
import { resumoDasFases } from '@/lib/operacional/torre-fase-dados'

const LIMITE = 20000

export async function POST(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const ids: number[] = Array.isArray(b?.processoIds) ? b.processoIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : []
  if (ids.length > LIMITE) return NextResponse.json({ error: `mais de ${LIMITE} processos` }, { status: 400 })
  const colunas = await colunasVisiveisDaTorre()
  const resumo = await resumoDasFases(ids, colunas.map((c) => c.key))
  return NextResponse.json({ colunas, ...resumo })
}
