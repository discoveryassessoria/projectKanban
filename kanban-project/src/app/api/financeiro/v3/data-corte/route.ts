// /api/financeiro/v3/data-corte — ADMINISTRAÇÃO DA DATA DE CORTE (Motor V3 · Fase 3)
//   POST { dataCorte, executar?, confirmacao?, rollback?, obrigacaoIds? }
// Regras: dry-run OBRIGATÓRIO por padrão; execução real exige confirmação explícita;
// permissão exclusiva `financeiro.dataCorte`; flag `dataCorte`; auditoria completa;
// idempotente; NUNCA apaga histórico (rollback = estorno append-only + marcador).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { aplicarDataDeCorte, reverterDataDeCorte, auditarCorte } from '@/lib/financeiro/corte/data-corte-service'
import { usuarioFlag } from '../_flags'

const FRASE_EXECUTAR = 'EXECUTAR CORTE'
const FRASE_REVERTER = 'REVERTER CORTE'

export async function POST(req: NextRequest) {
  // permissão EXCLUSIVA (opt-in) + flag da Fase 3
  const erro = await verificarPermissao(req, 'financeiro.dataCorte'); if (erro) return erro
  if (!flagAtiva('dataCorte', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Data de corte V3 não habilitada neste ambiente/usuário.' }, { status: 409 })
  }
  const actor = await extrairUsuarioComPermissoes(req)
  const b = await req.json().catch(() => ({}))

  // ── ROLLBACK OPERACIONAL (por flag) ──
  if (b?.rollback === true) {
    const dryRun = b.executar !== true
    if (!dryRun && b.confirmacao !== FRASE_REVERTER) {
      return NextResponse.json({ ok: false, erro: `Rollback real exige confirmacao === "${FRASE_REVERTER}".` }, { status: 400 })
    }
    const resumo = await reverterDataDeCorte({ dryRun, obrigacaoIds: Array.isArray(b.obrigacaoIds) ? b.obrigacaoIds.map(Number) : undefined, criadoPorId: actor?.userId ?? null })
    await auditarCorte(actor?.userId ?? null, dryRun ? 'DATA_CORTE_ROLLBACK_DRYRUN' : 'DATA_CORTE_ROLLBACK', { ...resumo, obrigacaoIds: b.obrigacaoIds ?? null })
    return NextResponse.json({ ok: true, modo: dryRun ? 'rollback-dry-run' : 'rollback', resumo })
  }

  // ── APLICAÇÃO DO CORTE ──
  if (!b?.dataCorte) return NextResponse.json({ ok: false, erro: 'dataCorte é obrigatório (ISO).' }, { status: 400 })
  const dataCorte = new Date(b.dataCorte)
  if (isNaN(dataCorte.getTime())) return NextResponse.json({ ok: false, erro: 'dataCorte inválida.' }, { status: 400 })

  const dryRun = b.executar !== true
  if (!dryRun && b.confirmacao !== FRASE_EXECUTAR) {
    return NextResponse.json({ ok: false, erro: `Execução real exige confirmacao === "${FRASE_EXECUTAR}".`, dica: 'Rode primeiro em dry-run (executar omitido) e confira o resumo.' }, { status: 400 })
  }
  try {
    const resumo = await aplicarDataDeCorte({ dataCorte, dryRun, criadoPorId: actor?.userId ?? null })
    await auditarCorte(actor?.userId ?? null, dryRun ? 'DATA_CORTE_DRYRUN' : 'DATA_CORTE_EXECUTAR', {
      dataCorte: resumo.dataCorte, totalObrigacoes: resumo.totalObrigacoes, aplicaveis: resumo.aplicaveis,
      aplicadas: resumo.aplicadas, saldoTotalAbertura: resumo.saldoTotalAbertura, divergencias: resumo.divergencias.length,
    })
    return NextResponse.json({ ok: true, modo: dryRun ? 'dry-run' : 'executado', resumo })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao aplicar a data de corte.' }, { status: 422 })
  }
}
