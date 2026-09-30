// GET /api/torre/integridade — a aba INTEGRIDADE (Bloco I1): os achados do MESMO motor do painel de Saúde
// (`SaudeAchado`), com gravidade, achado, efeito e a ação de correção. Mesma permissão do Saúde (`usuarios.gerenciar`).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirGerenciamento } from '@/src/lib/torre-acesso'
import { quadroDeIntegridade } from '@/lib/operacional/torre-integridade'

export async function GET(request: NextRequest) {
  const { erro } = await exigirGerenciamento(request, 'usuarios.gerenciar')
  if (erro) return erro
  return NextResponse.json(await quadroDeIntegridade())
}
