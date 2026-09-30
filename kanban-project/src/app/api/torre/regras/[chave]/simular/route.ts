// POST /api/torre/regras/{chave}/simular — o que a regra faria com os dados de HOJE (Bloco H3).
// Não altera nenhuma tarefa, nem com a regra ligada. Só grava a linha de auditoria de que alguém simulou (01/10/2026).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirGerenciamento } from '@/src/lib/torre-acesso'
import { ehChaveRegra, simularRegra } from '@/lib/operacional/regras-torre'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, ctx: { params: Promise<{ chave: string }> }) {
  const { usuario, erro } = await exigirGerenciamento(request)
  if (erro) return erro
  const chave = (await ctx.params).chave
  if (!ehChaveRegra(chave)) return NextResponse.json({ error: 'regra desconhecida; use r1, r2 ou r3' }, { status: 404 })
  const r = await simularRegra(chave)
  await prisma.logAuditoria.create({
    data: { acao: 'REGRA_TORRE_SIMULADA', entidade: 'RegraTorre', entidadeId: null, usuarioId: usuario.userId, descricao: `Regra ${chave} simulada (nada foi alterado).`, detalhes: { chave } },
  })
  return NextResponse.json(r)
}
