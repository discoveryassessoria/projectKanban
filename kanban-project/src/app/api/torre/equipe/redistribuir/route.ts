// POST /api/torre/equipe/redistribuir — o botão "Redistribuir" do rodapé da aba Equipe (Torre nova).
// (1) passa o EXCESSO de quem está acima do limite ao sucessor sugerido (só o que ele é apto a executar e até o limite dele) e
// (2) distribui as sem dono por aptidão e carga. Reavalia na hora; tudo pela porta de redistribuição (auditada), com `desfazer`.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { executarRedistribuicao } from '@/lib/operacional/torre-equipe-distribuicao'
import { previaDeRedistribuir } from '@/lib/operacional/torre-equipe-previas'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'usuarios.gerenciar', 'tarefas.editar')
  if (erro) return erro
  // PROPOSTA: sem `confirmado` + assinatura da prévia só devolve a prévia (428) e não grava nada.
  const previa = await previaDeRedistribuir()
  if (previa) {
    const { confirmado, assinatura } = confirmacaoDoCorpo(await request.json().catch(() => ({})))
    if (!confirmado || assinatura == null) return pedirConfirmacao(previa)
    if (assinatura !== previa.assinatura) return NextResponse.json({ ok: false, mensagem: 'A situação da equipe mudou desde que você confirmou. Revise e confirme de novo.', code: 'SUGESTAO_MUDOU', confirmacao: previa }, { status: 409 })
  }
  const r = await executarRedistribuicao({ autorId: usuario.userId })
  return NextResponse.json({
    ok: true, ...r,
    desfazer: r.tarefaIds.length > 0 ? { tipo: 'ATRIBUICAO', tarefaIds: r.tarefaIds } : null,
  })
}
