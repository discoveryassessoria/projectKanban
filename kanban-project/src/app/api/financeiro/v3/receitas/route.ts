// /api/financeiro/v3/receitas — aba Receitas (KPIs + tabela) do Financeiro V3.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { listarReceitas } from '@/lib/financeiro/leitura/receitas-lista'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  return NextResponse.json({ disponivel: true, ...(await listarReceitas()) })
}
