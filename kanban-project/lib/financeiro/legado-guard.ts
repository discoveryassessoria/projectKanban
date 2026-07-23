// lib/financeiro/legado-guard.ts
// ============================================================================
// BLOQUEIO DE ESCRITA NO FINANCEIRO LEGADO (Motor Financeiro V3 · Fase 3).
// Após a DATA DE CORTE, o legado vira SÓ-LEITURA (fallback). Este guard, ativável
// pela flag de ambiente FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA=1, faz as rotas de
// ESCRITA do financeiro antigo recusarem novas gravações (HTTP 423). Leitura e
// histórico seguem intactos. Desligado por padrão (nada muda até o corte).
// ============================================================================
import { NextResponse } from 'next/server'

export function legadoEscritaBloqueada(): boolean {
  return process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA === '1'
}

/** Se o legado estiver bloqueado, devolve a resposta 423; senão null (segue). */
export function guardLegadoEscrita(): NextResponse | null {
  if (!legadoEscritaBloqueada()) return null
  return NextResponse.json({
    error: 'Financeiro legado em modo somente-leitura após a data de corte. Use o Financeiro V3.',
    codigo: 'LEGADO_BLOQUEADO',
  }, { status: 423 })
}
