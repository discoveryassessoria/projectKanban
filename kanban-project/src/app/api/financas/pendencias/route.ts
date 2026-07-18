// §11 — GET /api/financas/pendencias — PendenciasFinanceiras (preço ausente,
// conflito, natureza incompatível, contexto incompleto, falha de projeção/estorno).
// Read-only; a correção é reprocessamento (não editar valor para contornar).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const abertas = searchParams.get('todas') !== '1'
    const processoId = searchParams.get('processoId')
    const pend = await prisma.pendenciaFinanceira.findMany({
      where: {
        ...(abertas ? { resolvida: false } : {}),
        ...(processoId ? { processoId: Number(processoId) } : {}),
      },
      orderBy: { criadoEm: 'desc' },
      take: 200,
      select: {
        id: true, processoId: true, phaseKey: true, phaseCycle: true, configFinanceiraId: true, regraFinanceiraId: true,
        natureza: true, motivo: true, detalhe: true, resolvida: true, resolvidaEm: true, resolucao: true, criadoEm: true,
        processo: { select: { nome: true } },
      },
    })
    const itens = pend.map((p) => ({
      id: p.id, processoId: p.processoId, processoNome: p.processo?.nome ?? null,
      phaseKey: p.phaseKey, phaseCycle: p.phaseCycle, configFinanceiraId: p.configFinanceiraId, regraFinanceiraId: p.regraFinanceiraId,
      natureza: p.natureza, motivo: p.motivo, detalhe: p.detalhe, resolvida: p.resolvida, resolvidaEm: p.resolvidaEm, resolucao: p.resolucao, criadoEm: p.criadoEm,
      // ação sugerida — nunca "editar valor" (é config): corrigir preço/regra e reprocessar a fase.
      acaoSugerida: p.motivo === 'CONFLITO_PRECO' ? 'Resolver conflito na Tabela de Preços e reprocessar a fase'
        : p.motivo.startsWith('SEM_PRECO') || p.motivo === 'NENHUMA_LINHA' ? 'Cadastrar preço válido na Tabela de Preços e reprocessar a fase'
        : 'Revisar configuração e reprocessar',
    }))
    return NextResponse.json({ itens, abertas: itens.filter((i) => !i.resolvida).length })
  } catch (e) {
    console.error('GET financas/pendencias', e)
    return NextResponse.json({ error: 'Erro ao carregar pendências' }, { status: 500 })
  }
}
