import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// ============================================================
// FASE 4.1 — Simulação de Fase (PREVIEW, sem efeitos)
// Mesma lógica que vira o executor real na 4.2, mas SÓ LÊ.
// Reproduz o simulador do mockup: Receitas, Custos, Operacional,
// Alertas, Ignoradas, Duplicidades — a partir das nossas tabelas:
//   • PhaseAutomationRule (opauto)  → financeiro + operacional + alertas
//   • PhaseTriggerRule    (phasemap)→ financeiro (disparos por fase)
// ============================================================

// eventos da fase (iguais ao mockup)
const EVENTS = ['entered', 'completed', 'reopened', 'blocked'] as const
// opauto usa "phase_entered"; só mapeia p/ "entered"
const opautoTriggerFor = (ev: string) => (ev === 'entered' ? 'phase_entered' : null)

function pnum(p: Prisma.JsonValue | null, key: string): number | null {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const v = (p as Record<string, unknown>)[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  }
  return null
}
function pstr(p: Prisma.JsonValue | null, key: string): string | null {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const v = (p as Record<string, unknown>)[key]
    if (typeof v === 'string' && v) return v
  }
  return null
}
function condCount(p: Prisma.JsonValue | null): number {
  if (Array.isArray(p)) return p.length
  return 0
}

// GET — seletores (processos + suas fases)
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const tipos = await prisma.tipoProcessoNacionalidade.findMany({
      where: { ativo: true, arquivado: false },
      select: { id: true, name: true, macroWorkflow: { select: { fases: { select: { phaseKey: true, label: true, ordem: true }, orderBy: { ordem: 'asc' } } } } },
      orderBy: { name: 'asc' },
    })
    const tiposProcesso = tipos.map(t => ({ id: t.id, name: t.name, fases: t.macroWorkflow?.fases ?? [] }))
    return NextResponse.json({ tiposProcesso, events: EVENTS })
  } catch (e) {
    console.error('GET simulacao-fase', e)
    return NextResponse.json({ error: 'Erro ao carregar a simulação.' }, { status: 500 })
  }
}

// POST — roda a simulação (sem gravar nada)
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const tipoProcessoId = Number(b.tipoProcessoId)
    const phaseKey = String(b.phaseKey || '')
    const event = String(b.event || 'entered')
    if (!tipoProcessoId || !phaseKey) return NextResponse.json({ error: 'Escolha o processo e a fase.' }, { status: 400 })

    const [autoRules, triggerRules, produtos] = await Promise.all([
      prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey } }),
      prisma.phaseTriggerRule.findMany({ where: { phaseKey, arquivado: false } }),
      prisma.produtoFinanceiro.findMany({ where: { ativo: true }, select: { codigo: true, nome: true, valorPadrao: true, moedaPadrao: true } }),
    ])
    const prodByCode = new Map(produtos.map(p => [p.codigo, p]))

    const receitas: any[] = []
    const custos: any[] = []
    const operacional: any[] = []
    const alertas: any[] = []
    const ignoradas: any[] = []
    const duplicidades: any[] = [] // sempre vazio na simulação (sem processo real)

    // ---- 1. DISPAROS FINANCEIROS por fase (phasemap) — globais por fase+evento
    for (const t of triggerRules) {
      if (t.phaseEvent !== event) { ignoradas.push({ name: t.name, reason: `gatilho não corresponde (dispara em "${t.phaseEvent}")` }); continue }
      if (!t.active) { ignoradas.push({ name: t.name, reason: 'inativa' }); continue }
      const prod = prodByCode.get(t.itemCode)
      const amount = prod?.valorPadrao != null ? Number(prod.valorPadrao) : null
      const currency = prod?.moedaPadrao || 'EUR'
      const nome = prod?.nome || t.itemCode
      if (amount == null) { ignoradas.push({ name: nome, reason: 'sem valor configurado (defina no Catálogo Financeiro / Tabela de Valores)' }); continue }
      const cond: string[] = []
      if (t.requiresContractSigned) cond.push('exige contrato assinado')
      if (t.requiresProposalApproved) cond.push('exige proposta aprovada')
      const row = { name: nome, amount, currency, source: 'catálogo', condicional: cond.length > 0, condicaoNota: cond.join(' · ') || null, origem: 'disparo' }
      if (t.entryType === 'cost') custos.push(row); else receitas.push(row)
    }

    // ---- 2. AUTOMAÇÕES POR FASE (opauto) — por processo+fase
    const wantTrigger = opautoTriggerFor(event)
    for (const r of autoRules) {
      if (!r.active || r.arquivado) { ignoradas.push({ name: r.name, reason: r.arquivado ? 'arquivada' : 'inativa' }); continue }
      if (wantTrigger == null || r.trigger !== wantTrigger) { ignoradas.push({ name: r.name, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
      const condicional = condCount(r.conditions) > 0
      const condicaoNota = condicional ? `${condCount(r.conditions)} condição(ões) — avaliadas na execução` : null

      if (r.kind === 'financial') {
        const amount = pnum(r.params, 'amount') ?? (r.financialType && prodByCode.get(pstr(r.params, 'financialItemCode') || '')?.valorPadrao != null ? Number(prodByCode.get(pstr(r.params, 'financialItemCode') || '')!.valorPadrao) : 0)
        const currency = pstr(r.params, 'currency') || 'EUR'
        const row = { name: r.name, amount, currency, source: 'automação', condicional, condicaoNota, origem: 'automacao' }
        if (r.financialType === 'revenue' || r.financialType === 'honorarium') receitas.push(row); else custos.push(row)
      } else if (r.kind === 'alert') {
        alertas.push({ name: r.name, condicional, condicaoNota })
      } else {
        // task | document | event | protocol | phase_advance
        operacional.push({ name: r.name, kind: r.kind, acao: r.action || null, condicional, condicaoNota })
      }
    }

    const totalCriaria = receitas.length + custos.length + operacional.length + alertas.length
    return NextResponse.json({
      context: { tipoProcessoId, phaseKey, event },
      receitas, custos, operacional, alertas, ignoradas, duplicidades,
      totalCriaria,
    })
  } catch (e) {
    console.error('POST simulacao-fase', e)
    return NextResponse.json({ error: 'Erro ao rodar a simulação.' }, { status: 500 })
  }
}