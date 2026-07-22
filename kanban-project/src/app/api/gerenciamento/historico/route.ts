// src/app/api/gerenciamento/historico/route.ts
// GET /api/gerenciamento/historico?entidade=ItemCatalogo[&id=5][&limite=50]
//
// Histórico de alterações REUTILIZÁVEL por qualquer Cadastro Mestre. Lê a tabela
// LogAuditoria existente (via lib/gerenciamento/auditoria) — nenhum modelo novo.
// Mesma permissão dos cadastros (usuarios.gerenciar).

import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { historicoDe } from '@/lib/gerenciamento/auditoria'

const ENTIDADES = new Set([
  'ItemCatalogo', 'TipoDocumentoCadastro', 'TabelaValor', 'ProdutoFinanceiro',
  'CondicaoPagamento', 'FormaPagamentoCadastro', 'TaxaPagamento', 'PhaseEconomicRule',
])

export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const sp = new URL(request.url).searchParams
    const entidade = (sp.get('entidade') || '').trim()
    if (!ENTIDADES.has(entidade)) {
      return NextResponse.json({ error: 'Entidade inválida ou não auditada.', entidadesValidas: [...ENTIDADES] }, { status: 400 })
    }
    const idRaw = Number(sp.get('id'))
    const entidadeId = Number.isFinite(idRaw) && idRaw > 0 ? Math.trunc(idRaw) : null
    const limite = Math.min(200, Math.max(1, Number(sp.get('limite')) || 50))

    const historico = await historicoDe(entidade, entidadeId, limite)
    return NextResponse.json({ historico, entidade, entidadeId })
  } catch (e) {
    console.error('GET historico', e)
    return NextResponse.json({ error: 'Erro ao carregar histórico.' }, { status: 500 })
  }
}
