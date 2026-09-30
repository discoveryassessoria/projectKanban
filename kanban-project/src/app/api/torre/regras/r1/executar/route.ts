// POST /api/torre/regras/r1/executar — "aplicar agora" (Bloco H3). Só executa com r1 LIGADA: desligada,
// `executarR1` devolve `REGRA_DESLIGADA` sem tocar em nenhuma tarefa.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { executarR1 } from '@/lib/operacional/regras-torre'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'usuarios.gerenciar', 'tarefas.editar')
  if (erro) return erro
  const r = await executarR1(usuario.userId)
  return NextResponse.json(r, { status: r.executou ? 200 : 409 })
}
