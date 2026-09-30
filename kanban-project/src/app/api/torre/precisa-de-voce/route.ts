// src/app/api/torre/precisa-de-voce/route.ts
// ============================================================================
// TORRE DE CONTROLE — BLOCO F: "PRECISA DE VOCÊ" (endpoint único, 29/09/2026).
//
//   GET /api/torre/precisa-de-voce
//
// Devolve a lista de decisões do Administrador, ordenada por score (maior
// primeiro), e o briefing do dia. Mesma leitura que alimenta "Revisar o dia"
// (Bloco J percorre esta MESMA lista, um item por vez) — nenhum estado novo
// nasce aqui: pular um item é só não chamar a ação dele.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { montarPrecisaDeVoce } from '@/lib/operacional/precisa-de-voce'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  return NextResponse.json(await montarPrecisaDeVoce(new Date()))
}
