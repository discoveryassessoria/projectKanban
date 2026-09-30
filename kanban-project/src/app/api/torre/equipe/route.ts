// GET /api/torre/equipe — a aba EQUIPE + a previsão de carga de 4 semanas (Bloco H1/H2).
// Números das MESMAS linhas da Operação, pela conta única `cargaPorPessoa`. Exige `usuarios.gerenciar`
// (a mesma permissão de `/api/operacao/capacidade`, de onde vêm limite, aptidões e ausência).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { quadroDaEquipe } from '@/lib/operacional/torre-equipe'

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'usuarios.gerenciar')
  if (erro) return erro
  return NextResponse.json(await quadroDaEquipe())
}
