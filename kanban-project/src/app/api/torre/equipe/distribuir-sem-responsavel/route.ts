// POST /api/torre/equipe/distribuir-sem-responsavel — "Distribuir as N por aptidão e carga" (Torre nova, aba Equipe).
// Atribui as abertas SEM DONO a quem a regra escolhe (apto por unidade E país → menor carga → ausente vai ao sucessor), sem
// passar do limite de carga do cadastro. NUNCA atribui a quem não tem aptidão comprovada: sem apto, a tarefa continua sem dono
// (e no "Precisa de você"). Item a item pela porta de redistribuição (auditada), com resumo no histórico e `desfazer` para o toast.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { distribuirSemResponsavel, previaDeDistribuirSemResponsavel } from '@/lib/operacional/torre-equipe-distribuicao'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'usuarios.gerenciar', 'tarefas.editar')
  if (erro) return erro
  // SUGESTÃO NUNCA ATRIBUI SOZINHA: sem `confirmado` + assinatura da prévia, só devolve "Atribuir … a …?" (428).
  const { confirmado, assinatura } = confirmacaoDoCorpo(await request.json().catch(() => ({})))
  const previa = await previaDeDistribuirSemResponsavel()
  if (previa && (!confirmado || assinatura == null)) return pedirConfirmacao(previa)
  if (previa && assinatura !== previa.assinatura) return NextResponse.json({ ok: false, erro: 'A sugestão mudou desde que você confirmou. Revise e confirme de novo.', confirmacao: previa, code: 'SUGESTAO_MUDOU' }, { status: 409 })
  const r = await distribuirSemResponsavel({ autorId: usuario.userId })
  return NextResponse.json({
    ok: true, ...r,
    desfazer: r.tarefaIds.length > 0 ? { tipo: 'ATRIBUICAO', tarefaIds: r.tarefaIds } : null,
  }, { status: r.falhas > 0 ? 207 : 200 })
}
