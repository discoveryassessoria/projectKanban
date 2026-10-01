// GET /api/torre/equipe — a aba EQUIPE + a previsão de carga de 4 semanas (Bloco H1/H2).
// Números das MESMAS linhas da Operação, pela conta única `cargaPorPessoa`. Exige `usuarios.gerenciar`
// (a mesma permissão de `/api/operacao/capacidade`, de onde vêm limite, aptidões e ausência).
// `?pais=<countryKey>` (Torre nova): o país do cabeçalho recorta as MESMAS linhas antes de somar a carga e a previsão.
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { quadroDaEquipe } from '@/lib/operacional/torre-equipe'
import { listarTarefasDaTorre } from '@/src/services/torre-tarefas'

export async function GET(request: NextRequest) {
  const { erro } = await exigirTorre(request, 'usuarios.gerenciar')
  if (erro) return erro
  const pais = new URL(request.url).searchParams.get('pais')?.trim() || null
  return NextResponse.json(await quadroDaEquipe(pais ? (await listarTarefasDaTorre({ pais })).linhas : undefined))
}
