// src/app/api/torre/precisa-de-voce/route.ts
// ============================================================================
// TORRE DE CONTROLE — "PRECISA DE VOCÊ" (endpoint único; Bloco F de 29/09/2026, refeito na Torre nova em 01/10/2026).
//
//   GET /api/torre/precisa-de-voce
//
// Devolve as DECISÕES do Administrador (6 tipos; "Sem responsável" e "Fase deixada" por processo), ordenadas por score (maior risco
// primeiro), o resumo por tipo e o texto do Briefing do dia. A mesma lista alimenta a aba, a seção embutida na Visão geral e o
// "Revisar o dia" (que percorre esta lista, um item por vez) — nenhum estado novo nasce aqui: pular um item é só não chamar a ação.
//
// ACESSO: a guarda da Torre (`exigirTorre`): administrador ou gerência operacional — a MESMA das demais rotas /api/torre/*.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { montarPrecisaDeVoce } from '@/lib/operacional/precisa-de-voce'

export async function GET(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro

  return NextResponse.json(await montarPrecisaDeVoce(new Date(), undefined, { nomeDoUsuario: usuario.nome }))
}
