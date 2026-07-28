// /api/financeiro/v3/permissoes-custo — GET · permissões EFETIVAS de custo do usuário.
// A UI CONSOME este endpoint para habilitar/ocultar ações; NENHUMA decisão de segurança
// nasce no frontend — o enforcement real está em cada rota (verificarPermissaoCusto*).
// Reflete o modo (retrocompat via financeiro.ver ou ESTRITO por FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS=1).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { permissoesCustoDoUsuario, segregacaoEstrita } from '@/lib/financeiro/permissoes-custo'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const permissoes = await permissoesCustoDoUsuario(req)
  return NextResponse.json({ ok: true, estrita: segregacaoEstrita(), permissoes })
}
