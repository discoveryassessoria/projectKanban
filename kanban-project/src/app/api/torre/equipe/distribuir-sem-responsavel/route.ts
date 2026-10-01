// POST /api/torre/equipe/distribuir-sem-responsavel — "Distribuir as N por aptidão e carga" (Torre nova, aba Equipe).
// Atribui as abertas SEM DONO a quem a regra escolhe (apto por unidade E país → menor carga → ausente vai ao sucessor), sem
// passar do limite de carga do cadastro. NUNCA atribui a quem não tem aptidão comprovada: sem apto, a tarefa continua sem dono
// (e no "Precisa de você"). Item a item pela porta de redistribuição (auditada), com resumo no histórico e `desfazer` para o toast.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { distribuirSemResponsavel } from '@/lib/operacional/torre-equipe-distribuicao'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'usuarios.gerenciar', 'tarefas.editar')
  if (erro) return erro
  const r = await distribuirSemResponsavel({ autorId: usuario.userId })
  return NextResponse.json({
    ok: true, ...r,
    desfazer: r.tarefaIds.length > 0 ? { tipo: 'ATRIBUICAO', tarefaIds: r.tarefaIds } : null,
  }, { status: r.falhas > 0 ? 207 : 200 })
}
