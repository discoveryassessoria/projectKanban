import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET — regras de disparo (LEGADO, somente leitura para histórico) + catálogo
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const [triggers, produtos] = await Promise.all([
      prisma.phaseTriggerRule.findMany({ where: { arquivado: false }, orderBy: { criadoEm: 'asc' } }),
      prisma.produtoFinanceiro.findMany({
        where: { ativo: true },
        select: { id: true, codigo: true, nome: true, naturezaFinanceira: true },
        orderBy: { nome: 'asc' },
      }),
    ])
    return NextResponse.json({ triggers, produtos })
  } catch (e) {
    console.error('GET disparo-fase', e)
    return NextResponse.json({ error: 'Erro ao carregar regras de disparo.' }, { status: 500 })
  }
}

// POST — DESCONTINUADO. Regras de Disparo (item por CÓDIGO) foram substituídas por
// automações financeiras (PhaseAutomationRule) com vínculo estrutural (configItemId) e
// preço da Tabela de Preços. Não se cria mais nesse formato.
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  return NextResponse.json({ error: 'Regras de Disparo (formato legado por código) foram descontinuadas. Crie uma automação financeira em "Automações por Fase → Financeiro" selecionando a Configuração Financeira — o preço vem da Tabela de Preços.', code: 'DISPARO_LEGADO_DESCONTINUADO' }, { status: 410 })
}