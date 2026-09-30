// GET /api/torre/terceiros — os cartórios/órgãos com trabalho em aberto (Bloco G3/G4).
// As MESMAS linhas da Operação, agrupadas por `Tarefa.orgaoId`. A coluna "Régua" mostra só o
// que o Gerenciamento cadastrou (Decisão 1: nada de tempo aprendido).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { listarTarefasDaTorre } from '@/src/services/torre-tarefas'
import { listarTerceiros } from '@/src/services/torre-terceiros'

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const { linhas, cobrancasVencidas } = await listarTarefasDaTorre()
  const orgaos = await listarTerceiros(linhas)
  return NextResponse.json({ orgaos, cobrancasVencidas })
}
