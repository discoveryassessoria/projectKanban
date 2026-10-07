// POST /api/torre/equipe/aplicar-saida { usuarioId, dias?, motivo? } (Bloco H1)
// O "Aplicar" da simulação — DEPOIS de o gestor ver o impacto: (1) REGISTRA a ausência (com o
// sucessor sugerido) e (2) move a carteira ao sucessor, o que ele é apto a executar. É um clique
// deliberado sobre um impacto já mostrado — nunca automático. Cada passo é auditado.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { abrirIndisponibilidade } from '@/lib/operacional/organizacao'
import { sugerirSucessor } from '@/lib/operacional/elegibilidade'
import { moverCarteira } from '@/lib/operacional/torre-equipe'
import { previaDeMoverCarteira } from '@/lib/operacional/torre-equipe-previas'
import { confirmacaoDoCorpo, pedirConfirmacao } from '@/src/lib/torre-confirmacao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'usuarios.gerenciar', 'tarefas.editar')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const usuarioId = Number(b?.usuarioId)
  const dias = b?.dias == null ? 10 : Number(b.dias)
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) return NextResponse.json({ error: 'usuarioId é obrigatório' }, { status: 400 })
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) return NextResponse.json({ error: 'dias deve ser de 1 a 365' }, { status: 400 })
  const pessoa = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } })
  if (!pessoa) return NextResponse.json({ error: 'pessoa não encontrada' }, { status: 404 })

  // PROPOSTA: a ausência e a carteira só mudam depois da confirmação explícita (a prévia mostra o que vai para o sucessor).
  const sugerido = await sugerirSucessor(usuarioId)
  const mover = await previaDeMoverCarteira({ deUsuarioId: usuarioId, paraUsuarioId: sugerido?.usuarioId ?? null })
  const previa = {
    pergunta: `Marcar ${pessoa.nome} ausente por ${dias} dias${mover ? ` e ${mover.pergunta.charAt(0).toLowerCase()}${mover.pergunta.slice(1)}` : ' (a carteira não tem para quem ir)'}`,
    itens: mover?.itens ?? [{ pessoa: pessoa.nome, quantidade: 0, tarefas: [] }],
    assinatura: `aus:${usuarioId}:${dias}|${mover?.assinatura ?? 'sem-carteira'}`,
  }
  { const { confirmado, assinatura } = confirmacaoDoCorpo(b)
    if (!confirmado || assinatura == null) return pedirConfirmacao(previa)
    if (assinatura !== previa.assinatura) return NextResponse.json({ ok: false, mensagem: 'A carteira mudou desde que você confirmou. Revise e confirme de novo.', code: 'SUGESTAO_MUDOU', confirmacao: previa }, { status: 409 }) }
  const inicio = new Date()
  const fim = new Date(inicio.getTime() + dias * 86_400_000)
  const motivo = typeof b?.motivo === 'string' && b.motivo.trim() ? b.motivo.trim().slice(0, 300) : `saída simulada · ${dias} dias`
  const sucessor = await sugerirSucessor(usuarioId)
  const aus = await abrirIndisponibilidade({ usuarioId, tipo: 'AUSENCIA', inicio, fim, motivo, autorId: usuario.userId, sucessorSugeridoId: sucessor?.usuarioId ?? null })
  if (!aus.ok) return NextResponse.json({ ok: false, mensagem: aus.erro }, { status: 422 })
  await registrarAuditoria(request, {
    acao: 'CRIAR', entidade: 'CapacidadeOperacional', entidadeId: usuarioId,
    descricao: `${pessoa.nome} indisponível por ausência desde ${inicio.toISOString().slice(0, 10)} até ${fim.toISOString().slice(0, 10)} — ${motivo}` +
      `${sucessor ? ` · sucessor sugerido: ${sucessor.nome}` : ''} (aplicado pela simulação de saída da Torre)`,
    detalhes: { indisponibilidadeId: aus.id, tipo: 'AUSENCIA', inicio: inicio.toISOString(), fim: fim.toISOString(), sucessorSugeridoId: sucessor?.usuarioId ?? null, origem: 'torre-simular-saida' },
  })

  // A carteira só se move se há para quem — a ausência já ficou registrada de qualquer forma.
  const mov = await moverCarteira({ deUsuarioId: usuarioId, paraUsuarioId: sucessor?.usuarioId ?? null, autorId: usuario.userId })
  return NextResponse.json({
    ok: true, ausenciaId: aus.id, sucessor: sucessor ? { usuarioId: sucessor.usuarioId, nome: sucessor.nome } : null,
    carteira: mov.ok ? mov.resultado : { movidas: 0, motivo: mov.erro },
    // O Desfazer encerra a ausência junto — sem isso a carteira não volta para quem está ausente.
    desfazer: mov.ok && mov.resultado.movidas > 0 ? { tipo: 'ATRIBUICAO', tarefaIds: mov.resultado.tarefaIds, ausenciaId: aus.id } : null,
  })
}
