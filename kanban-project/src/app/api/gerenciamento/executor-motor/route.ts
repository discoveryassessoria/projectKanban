import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  Prisma, PrioridadeTarefa,
  CategoriaReceita, CategoriaCusto, TipoCusto, Moeda, FxRule, ReceitaStatus, CustoStatus,
} from '@prisma/client'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { gerarCodigoReceita, gerarCodigoCusto } from '@/lib/financeiro/codigos'
import { gerarParcelas } from '@/lib/financeiro/parcelas'

// ============================================================
// FASE 4.2 — EXECUTOR REAL (manual, por botão)
// Cria artefatos de verdade num processo conectado a um Tipo do motor.
//   • TAREFA    (PhaseAutomationRule kind=task)
//   • RECEITA / CUSTO (PhaseTriggerRule  +  PhaseAutomationRule kind=financial)
// Valor financeiro: valor padrao do produto no Catalogo (igual ao mockup).
// Sem valor -> pula. Idempotencia via MotorArtefato.automaticKey (@unique).
// Desfazer via targetTable+targetId (apaga o registro; parcelas/eventos caem em cascata).
// ============================================================

function pstr(p: Prisma.JsonValue | null | undefined, key: string): string | null {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const v = (p as Record<string, unknown>)[key]
    if (typeof v === 'string' && v) return v
  }
  return null
}
function pnum(p: Prisma.JsonValue | null | undefined, key: string): number | null {
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const v = (p as Record<string, unknown>)[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  }
  return null
}
function mapPrio(v: string | null): PrioridadeTarefa {
  switch ((v || '').toLowerCase()) {
    case 'low': return 'BAIXA'
    case 'high': return 'ALTA'
    case 'urgent': return 'URGENTE'
    default: return 'MEDIA'
  }
}
function toMoeda(s: string | null, fallback: Moeda): Moeda {
  if (s === 'BRL' || s === 'EUR' || s === 'USD') return s
  return fallback
}
const opautoTriggerFor = (ev: string) => (ev === 'entered' ? 'phase_entered' : null)

// câmbio p/ BRL (usa CotacaoCambio se existir; senão 1). Memoizado por request.
async function fxParaBRL(moeda: Moeda, cache: Map<string, number>): Promise<number> {
  if (moeda === 'BRL') return 1
  if (cache.has(moeda)) return cache.get(moeda)!
  const cot = await prisma.cotacaoCambio.findFirst({
    where: { moedaDe: moeda, moedaPara: 'BRL', ativo: true },
    orderBy: { criadoEm: 'desc' },
  })
  const taxa = cot ? Number(cot.taxa) : 1
  cache.set(moeda, taxa)
  return taxa
}

// cria Receita real (código + parcelas + evento — igual ao route manual)
async function criarReceita(pid: number, descricao: string, valor: number, moeda: Moeda, fx: number, honorario: boolean): Promise<number> {
  const codigo = await gerarCodigoReceita()
  const data1 = new Date()
  const parcelas = gerarParcelas(valor, 1, data1)
  const valorBrlRef = Number((valor * fx).toFixed(2))
  const rec = await prisma.receita.create({
    data: {
      codigo, processoId: pid,
      categoria: honorario ? CategoriaReceita.HONORARIOS : CategoriaReceita.OUTROS,
      descricao: descricao.slice(0, 300), moeda, valor,
      fxEstimado: fx, fxRule: FxRule.VARIAVEL, nParcelas: 1, data1,
      periodicidade: 'Mensal', status: ReceitaStatus.ATIVA,
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Receita criada pelo motor: ${descricao}`.slice(0, 500), valor, cambio: fx, valorBrl: valorBrlRef } },
    },
  })
  return rec.id
}

// cria Custo real
async function criarCusto(pid: number, descricao: string, valor: number, moeda: Moeda, fx: number): Promise<number> {
  const codigo = await gerarCodigoCusto()
  const vencimento = new Date()
  const parcelas = gerarParcelas(valor, 1, vencimento)
  const valorBrlRef = Number((valor * fx).toFixed(2))
  const c = await prisma.custo.create({
    data: {
      codigo, processoId: pid, tipo: TipoCusto.SERVICO, categoria: CategoriaCusto.OUTROS,
      descricao: descricao.slice(0, 300), moeda, valor,
      fxEstimado: fx, fxRule: FxRule.VARIAVEL, nParcelas: 1, vencimento,
      custoOperacional: false, status: CustoStatus.ATIVA,
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Custo criado pelo motor: ${descricao}`.slice(0, 500), valor, cambio: fx, valorBrl: valorBrlRef } },
    },
  })
  return c.id
}

// ---- GET: bootstrap ----
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [processos, tipos] = await Promise.all([
      prisma.processo.findMany({ select: { id: true, nome: true, tipoProcessoMotorId: true }, orderBy: { createdAt: 'desc' }, take: 300 }),
      prisma.tipoProcessoNacionalidade.findMany({
        where: { ativo: true, arquivado: false },
        select: { id: true, name: true, macroWorkflow: { select: { fases: { select: { phaseKey: true, label: true, ordem: true }, orderBy: { ordem: 'asc' } } } } },
        orderBy: { name: 'asc' },
      }),
    ])
    return NextResponse.json({ processos, tipos: tipos.map(t => ({ id: t.id, name: t.name, fases: t.macroWorkflow?.fases ?? [] })) })
  } catch (e) {
    console.error('GET executor-motor', e)
    return NextResponse.json({ error: 'Erro ao carregar o executor.' }, { status: 500 })
  }
}

// ---- POST: ações ----
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const action = String(b.action || '')

    if (action === 'assign') {
      const processoId = Number(b.processoId)
      const tipoProcessoId = b.tipoProcessoId == null ? null : Number(b.tipoProcessoId)
      if (!processoId) return NextResponse.json({ error: 'Processo inválido.' }, { status: 400 })
      await prisma.processo.update({ where: { id: processoId }, data: { tipoProcessoMotorId: tipoProcessoId } })
      return NextResponse.json({ ok: true })
    }

    if (action === 'list') {
      const processoId = Number(b.processoId)
      if (!processoId) return NextResponse.json({ error: 'Processo inválido.' }, { status: 400 })
      const artefatos = await prisma.motorArtefato.findMany({ where: { processoId }, orderBy: { criadoEm: 'desc' } })
      return NextResponse.json({ artefatos })
    }

    if (action === 'undo') {
      const artefatoId = Number(b.artefatoId)
      if (!artefatoId) return NextResponse.json({ error: 'Artefato inválido.' }, { status: 400 })
      const art = await prisma.motorArtefato.findUnique({ where: { id: artefatoId } })
      if (!art) return NextResponse.json({ error: 'Artefato não encontrado.' }, { status: 404 })
      if (art.status !== 'active') return NextResponse.json({ error: 'Este artefato já foi desfeito.' }, { status: 400 })
      await prisma.$transaction(async (tx) => {
        if (art.targetId) {
          try {
            if (art.targetTable === 'Tarefa') await tx.tarefa.delete({ where: { id: art.targetId } })
            else if (art.targetTable === 'Receita') await tx.receita.delete({ where: { id: art.targetId } })
            else if (art.targetTable === 'Custo') await tx.custo.delete({ where: { id: art.targetId } })
          } catch { /* já removido */ }
        }
        await tx.motorArtefato.update({ where: { id: art.id }, data: { status: 'undone', undoneEm: new Date() } })
      })
      return NextResponse.json({ ok: true })
    }

    if (action === 'run') {
      const processoId = Number(b.processoId)
      const phaseKey = String(b.phaseKey || '')
      const event = String(b.event || 'entered')
      if (!processoId || !phaseKey) return NextResponse.json({ error: 'Escolha o processo e a fase.' }, { status: 400 })

      const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, nome: true, tipoProcessoMotorId: true } })
      if (!processo) return NextResponse.json({ error: 'Processo não encontrado.' }, { status: 404 })
      if (!processo.tipoProcessoMotorId) return NextResponse.json({ error: 'Este processo ainda não está conectado a um Tipo do motor. Conecte primeiro.' }, { status: 400 })
      const tipoProcessoId = processo.tipoProcessoMotorId

      const wantTrigger = opautoTriggerFor(event)
      const [taskRules, finAutoRules, triggerRules, produtos] = await Promise.all([
        prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'task', active: true, arquivado: false } }),
        prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'financial', active: true, arquivado: false } }),
        prisma.phaseTriggerRule.findMany({ where: { phaseKey, arquivado: false } }),
        prisma.produtoFinanceiro.findMany({ where: { ativo: true }, select: { codigo: true, nome: true, valorPadrao: true, moedaPadrao: true } }),
      ])
      const prodByCode = new Map(produtos.map(p => [p.codigo, p]))
      const fxCache = new Map<string, number>()

      type Created = { kind: string; targetTable: string; targetId: number; name: string; amount?: number; currency?: string; condicional?: boolean }
      const created: Created[] = []
      const skipped: { name: string; reason: string }[] = []
      const errors: string[] = []

      // helper: reserva a chave (idempotência atômica), roda o criador, grava o targetId
      async function fazer(akey: string, targetTable: string, ruleKind: string, ruleSource: string, ruleId: number, descricao: string, detalhes: Prisma.InputJsonValue, criar: () => Promise<number>, onCreated: (id: number) => void) {
        let art
        try {
          art = await prisma.motorArtefato.create({
            data: { processoId, tipoProcessoId, phaseKey, event, ruleKind, ruleSource, ruleId, automaticKey: akey, targetTable, targetId: null, status: 'active', descricao: descricao.slice(0, 300), detalhes },
          })
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') { skipped.push({ name: descricao, reason: 'já criado antes (idempotência)' }); return }
          errors.push(`${descricao}: ${(e as Error)?.message || 'erro'}`); return
        }
        try {
          const id = await criar()
          await prisma.motorArtefato.update({ where: { id: art.id }, data: { targetId: id } })
          onCreated(id)
        } catch (e) {
          await prisma.motorArtefato.delete({ where: { id: art.id } }).catch(() => {})
          errors.push(`${descricao}: ${(e as Error)?.message || 'erro'}`)
        }
      }

      // ===== TAREFAS (PhaseAutomationRule kind=task) =====
      for (const rule of taskRules) {
        if (wantTrigger == null || rule.trigger !== wantTrigger) { skipped.push({ name: rule.name, reason: `gatilho não corresponde (dispara em "${rule.trigger}")` }); continue }
        const akey = `${processoId}::${phaseKey}::automation::${rule.id}`
        const prio = mapPrio(pstr(rule.params, 'priority'))
        const slaDays = pnum(rule.params, 'slaDays')
        const dataPrazo = slaDays && slaDays > 0 ? new Date(Date.now() + slaDays * 86400000) : null
        await fazer(akey, 'Tarefa', 'task', 'automation', rule.id, rule.name, { prioridade: prio },
          async () => {
            const t = await prisma.tarefa.create({ data: { titulo: rule.name, descricao: rule.description || null, processoId, prioridade: prio, dataPrazo, observacoes: `Criada automaticamente pelo motor · fase "${phaseKey}" · regra "${rule.name}"` } })
            return t.id
          },
          (id) => created.push({ kind: 'task', targetTable: 'Tarefa', targetId: id, name: rule.name }),
        )
      }

      // ===== FINANCEIRO — Regras de Disparo (PhaseTriggerRule) =====
      for (const t of triggerRules) {
        if (t.phaseEvent !== event) { skipped.push({ name: t.name, reason: `gatilho não corresponde (dispara em "${t.phaseEvent}")` }); continue }
        if (!t.active) { skipped.push({ name: t.name, reason: 'inativa' }); continue }
        const prod = prodByCode.get(t.itemCode)
        const valor = prod?.valorPadrao != null ? Number(prod.valorPadrao) : null
        const nome = prod?.nome || t.itemCode
        if (valor == null) { skipped.push({ name: nome, reason: 'sem valor configurado (defina no Catálogo)' }); continue }
        const moeda = (prod?.moedaPadrao as Moeda) || 'EUR'
        const isReceita = t.entryType !== 'cost'
        const condicional = t.requiresContractSigned || t.requiresProposalApproved
        const fx = await fxParaBRL(moeda, fxCache)
        const akey = `${processoId}::${phaseKey}::trigger::${t.id}`
        await fazer(akey, isReceita ? 'Receita' : 'Custo', 'financial', 'trigger', t.id, nome, { valor, moeda, condicional },
          async () => (isReceita ? criarReceita(processoId, nome, valor, moeda, fx, false) : criarCusto(processoId, nome, valor, moeda, fx)),
          (id) => created.push({ kind: 'financial', targetTable: isReceita ? 'Receita' : 'Custo', targetId: id, name: nome, amount: valor, currency: moeda, condicional }),
        )
      }

      // ===== FINANCEIRO — Automações kind=financial (PhaseAutomationRule) =====
      for (const r of finAutoRules) {
        if (wantTrigger == null || r.trigger !== wantTrigger) { skipped.push({ name: r.name, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
        const code = pstr(r.params, 'financialItemCode')
        const prod = code ? prodByCode.get(code) : undefined
        const valor = pnum(r.params, 'amount') ?? (prod?.valorPadrao != null ? Number(prod.valorPadrao) : null)
        if (valor == null) { skipped.push({ name: r.name, reason: 'sem valor configurado' }); continue }
        const moeda = toMoeda(pstr(r.params, 'currency'), (prod?.moedaPadrao as Moeda) || 'EUR')
        const honorario = r.financialType === 'honorarium'
        const isReceita = r.financialType === 'revenue' || honorario
        const condicional = Array.isArray(r.conditions) && r.conditions.length > 0
        const fx = await fxParaBRL(moeda, fxCache)
        const akey = `${processoId}::${phaseKey}::automation::${r.id}`
        await fazer(akey, isReceita ? 'Receita' : 'Custo', 'financial', 'automation', r.id, r.name, { valor, moeda, condicional },
          async () => (isReceita ? criarReceita(processoId, r.name, valor, moeda, fx, honorario) : criarCusto(processoId, r.name, valor, moeda, fx)),
          (id) => created.push({ kind: 'financial', targetTable: isReceita ? 'Receita' : 'Custo', targetId: id, name: r.name, amount: valor, currency: moeda, condicional }),
        )
      }

      return NextResponse.json({ created, skipped, errors, totalCriado: created.length })
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 })
  } catch (e) {
    console.error('POST executor-motor', e)
    return NextResponse.json({ error: 'Erro no executor.' }, { status: 500 })
  }
}