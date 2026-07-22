// POST /api/gerenciamento/cambio/atualizar-agora — CONTINGÊNCIA/teste. Mesmo serviço do
// cron (idempotente, com lock e logs). Não é fluxo paralelo. Requer permissão de gestão.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { atualizarCotacoesConfidence } from '@/src/lib/cambio/servico-cambio'

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'usuarios.gerenciar')
  if (erro) return erro
  const r = await atualizarCotacoesConfidence({ gatilho: 'manual_atualizar_agora' })
  return NextResponse.json(r)
}
