// src/lib/motor/executor.ts
// ============================================================
// MOTOR — núcleo do executor (compartilhado).
// Usado pelo botão manual (Executor do Motor) E pelo gatilho automático
// (ao avançar de fase). Cria artefatos REAIS num processo conectado a um
// Tipo do motor: tarefa, receita, custo, evento, protocolo.
// Idempotência via MotorArtefato.automaticKey (@unique). Desfazer no route.
// ============================================================

import { prisma } from '@/lib/prisma'
import {
  Prisma, PrioridadeTarefa,
  CategoriaReceita, CategoriaCusto, TipoCusto, Moeda, FxRule, ReceitaStatus, CustoStatus,
  TipoEvento, Consulado,
} from '@prisma/client'
import type { FaseCode } from '@prisma/client'
import { getFase } from '@/src/lib/process-stage/fases-catalog'
import { gerarCodigoReceita, gerarCodigoCusto } from '@/lib/financeiro/codigos'
import { gerarParcelas } from '@/lib/financeiro/parcelas'
import { criarTarefaDeSpec } from '@/src/services/processEngine/taskEngine'

// ---- tipos de saída ----
export interface CreatedItem { kind: string; targetTable: string; targetId: number; name: string; amount?: number; currency?: string; condicional?: boolean }
export interface RunResultado {
  created: CreatedItem[]
  skipped: { name: string; reason: string }[]
  errors: string[]
  totalCriado: number
}

// ---- helpers de leitura de params (Json) ----
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
function toTipoEvento(s: string | null): TipoEvento {
  const up = (s || '').toUpperCase()
  const ok: TipoEvento[] = ['CONSULADO', 'CARTORIO', 'REUNIAO', 'PRAZO', 'AUDIENCIA', 'ENTREGA_DOCUMENTO', 'OUTRO']
  return (ok as string[]).includes(up) ? (up as TipoEvento) : 'OUTRO'
}
const opautoTriggerFor = (ev: string) => (ev === 'entered' ? 'phase_entered' : null)

async function fxParaBRL(moeda: Moeda, cache: Map<string, number>): Promise<number> {
  if (moeda === 'BRL') return 1
  if (cache.has(moeda)) return cache.get(moeda)!
  const cot = await prisma.cotacaoCambio.findFirst({ where: { moedaDe: moeda, moedaPara: 'BRL', ativo: true }, orderBy: { criadoEm: 'desc' } })
  const taxa = cot ? Number(cot.taxa) : 1
  cache.set(moeda, taxa)
  return taxa
}

// ============================================================
// SEAM (E3) — resolve o RESPONSÁVEL de uma regra do motor.
// Hoje: se a regra já trouxer um id numérico de usuário, usa (conferindo que
// existe). Senão, deixa SEM dono — MESMO comportamento de antes, nada de
// adivinhar por nome/papel.
//
// ⚠ QUANDO existir uma config "papel → usuário" (ex.: params.responsibleRole
//    → Usuario.id), é AQUI o único lugar pra ligar. Enquanto não houver, a
//    tarefa automática nasce sem responsável (o operador atribui na tela).
// ============================================================
async function resolverResponsavelDaRegra(params: Prisma.JsonValue | null | undefined): Promise<number | null> {
  const id = pnum(params, 'responsibleId')
  if (id && id > 0) {
    const u = await prisma.usuario.findUnique({ where: { id }, select: { id: true } })
    return u ? u.id : null
  }
  return null
}

// ---- criadores de artefato (idênticos ao route manual) ----
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
      fxEstimado: fx, fxRule: FxRule.VARIAVEL, nParcelas: 1, data1, periodicidade: 'Mensal', status: ReceitaStatus.ATIVA,
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Receita criada pelo motor: ${descricao}`.slice(0, 500), valor, cambio: fx, valorBrl: valorBrlRef } },
    },
  })
  return rec.id
}
async function criarCusto(pid: number, descricao: string, valor: number, moeda: Moeda, fx: number): Promise<number> {
  const codigo = await gerarCodigoCusto()
  const vencimento = new Date()
  const parcelas = gerarParcelas(valor, 1, vencimento)
  const valorBrlRef = Number((valor * fx).toFixed(2))
  const c = await prisma.custo.create({
    data: {
      codigo, processoId: pid, tipo: TipoCusto.SERVICO, categoria: CategoriaCusto.OUTROS,
      descricao: descricao.slice(0, 300), moeda, valor,
      fxEstimado: fx, fxRule: FxRule.VARIAVEL, nParcelas: 1, vencimento, custoOperacional: false, status: CustoStatus.ATIVA,
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Custo criado pelo motor: ${descricao}`.slice(0, 500), valor, cambio: fx, valorBrl: valorBrlRef } },
    },
  })
  return c.id
}
async function criarEvento(pid: number, titulo: string, descricao: string | null, dataInicio: Date, tipo: TipoEvento): Promise<number> {
  const ev = await prisma.evento.create({ data: { processoId: pid, titulo: titulo.slice(0, 200), descricao: descricao || null, tipo, dataInicio, observacoes: 'Criado pelo motor' } })
  return ev.id
}
async function criarProtocolo(pid: number, nome: string): Promise<number> {
  const p = await prisma.protocolo.create({ data: { processoId: pid, consulado: 'OUTROS' as Consulado, observacoes: `Criado pelo motor: ${nome}` } })
  return p.id
}

// ============================================================
// Converte um FaseCode (enum do kanban, ex. RETIFICACAO_REGISTROS) no
// phaseKey REAL usado pelo motor, lendo as fases do próprio tipo de processo
// (casa pelo nome/label). Robusto: não depende de regra de texto.
// ============================================================
export async function resolvePhaseKey(tipoProcessoId: number, faseCode: FaseCode): Promise<string | null> {
  const mw = await prisma.macroWorkflow.findUnique({ where: { tipoProcessoId }, select: { fases: { select: { phaseKey: true, label: true } } } })
  const fases = mw?.fases ?? []
  const norm = (s: string) => s.trim().toLowerCase()
  let label = ''
  try { label = getFase(faseCode)?.label ?? '' } catch { label = '' }
  if (label) { const f = fases.find(x => norm(x.label) === norm(label)); if (f) return f.phaseKey }
  const lc = String(faseCode).toLowerCase()
  const f2 = fases.find(x => x.phaseKey === lc)
  return f2 ? f2.phaseKey : (fases.length ? null : lc)
}

// ============================================================
// EXECUTOR — roda as automações da fase e cria os artefatos reais.
// Quem chama garante que o processo está conectado (passa tipoProcessoId).
// ============================================================
export async function executarMotorNaFase(processoId: number, tipoProcessoId: number, phaseKey: string, event: string): Promise<RunResultado> {
  const wantTrigger = opautoTriggerFor(event)
  const [taskRules, finAutoRules, eventRules, protocolRules, triggerRules, produtos] = await Promise.all([
    prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'task', active: true, arquivado: false } }),
    prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'financial', active: true, arquivado: false } }),
    prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'event', active: true, arquivado: false } }),
    prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'protocol', active: true, arquivado: false } }),
    prisma.phaseTriggerRule.findMany({ where: { phaseKey, arquivado: false } }),
    prisma.produtoFinanceiro.findMany({ where: { ativo: true }, select: { codigo: true, nome: true, valorPadrao: true, moedaPadrao: true } }),
  ])
  const prodByCode = new Map(produtos.map(p => [p.codigo, p]))
  const fxCache = new Map<string, number>()

  const created: CreatedItem[] = []
  const skipped: { name: string; reason: string }[] = []
  const errors: string[] = []

  async function fazer(akey: string, targetTable: string, ruleKind: string, ruleSource: string, ruleId: number, descricao: string, detalhes: Prisma.InputJsonValue, criar: () => Promise<number>, onCreated: (id: number) => void) {
    let art
    try {
      art = await prisma.motorArtefato.create({ data: { processoId, tipoProcessoId, phaseKey, event, ruleKind, ruleSource, ruleId, automaticKey: akey, targetTable, targetId: null, status: 'active', descricao: descricao.slice(0, 300), detalhes } })
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

  // TAREFAS — agora via Task Engine (título/responsável/prioridade/prazo/SLA/
  // ordem/follow-up/auditoria num lugar só). A idempotência continua no fazer().
  for (const rule of taskRules) {
    if (wantTrigger == null || rule.trigger !== wantTrigger) { skipped.push({ name: rule.name, reason: `gatilho não corresponde (dispara em "${rule.trigger}")` }); continue }
    const akey = `${processoId}::${phaseKey}::automation::${rule.id}`
    const prio = mapPrio(pstr(rule.params, 'priority'))
    const slaDays = pnum(rule.params, 'slaDays')
    const followUpDias = pnum(rule.params, 'followUpDays')
    const responsavelId = await resolverResponsavelDaRegra(rule.params)
    await fazer(akey, 'Tarefa', 'task', 'automation', rule.id, rule.name, { prioridade: prio },
      async () => {
        const t = await criarTarefaDeSpec({
          titulo: rule.name,
          descricao: rule.description || null,
          processoId,
          responsavelId,
          prioridade: prio,
          slaDays,
          followUp: followUpDias != null ? { prazoCobranca: followUpDias } : null,
          observacoes: `Criada automaticamente pelo motor · fase "${phaseKey}" · regra "${rule.name}"`,
        })
        return t.id
      },
      (id) => created.push({ kind: 'task', targetTable: 'Tarefa', targetId: id, name: rule.name }))
  }

  // FINANCEIRO — Regras de Disparo (PhaseTriggerRule)
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
      (id) => created.push({ kind: 'financial', targetTable: isReceita ? 'Receita' : 'Custo', targetId: id, name: nome, amount: valor, currency: moeda, condicional }))
  }

  // FINANCEIRO — Automações kind=financial
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
      (id) => created.push({ kind: 'financial', targetTable: isReceita ? 'Receita' : 'Custo', targetId: id, name: r.name, amount: valor, currency: moeda, condicional }))
  }

  // EVENTO / AGENDA
  for (const r of eventRules) {
    if (wantTrigger == null || r.trigger !== wantTrigger) { skipped.push({ name: r.name, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
    const offset = pnum(r.params, 'eventOffsetDays') ?? 0
    const dataInicio = new Date(Date.now() + offset * 86400000)
    const tipo = toTipoEvento(pstr(r.params, 'eventType'))
    const akey = `${processoId}::${phaseKey}::automation::${r.id}`
    await fazer(akey, 'Evento', 'event', 'automation', r.id, r.name, { tipo, dataInicio: dataInicio.toISOString() },
      async () => criarEvento(processoId, r.name, r.description || null, dataInicio, tipo),
      (id) => created.push({ kind: 'event', targetTable: 'Evento', targetId: id, name: r.name }))
  }

  // PROTOCOLO
  for (const r of protocolRules) {
    if (wantTrigger == null || r.trigger !== wantTrigger) { skipped.push({ name: r.name, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
    const akey = `${processoId}::${phaseKey}::automation::${r.id}`
    await fazer(akey, 'Protocolo', 'protocol', 'automation', r.id, r.name, { nota: 'consulado OUTROS (ajustar)' },
      async () => criarProtocolo(processoId, r.name),
      (id) => created.push({ kind: 'protocol', targetTable: 'Protocolo', targetId: id, name: r.name }))
  }

  return { created, skipped, errors, totalCriado: created.length }
}

// ============================================================
// GATILHO AUTOMÁTICO — auto-suficiente.
// Chame esta função com o processoId DEPOIS que a fase já mudou.
// Ela sozinha: confere a chave, vê se o processo está conectado,
// descobre a fase atual, e dispara o motor (evento "entrar na fase").
// Best-effort: qualquer erro aqui é engolido (não quebra quem chamou).
// ============================================================
export async function dispararMotorNaFaseAtual(processoId: number): Promise<void> {
  try {
    const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 } })
    if (!cfg?.autoExecutarAoAvancar) return

    const proc = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { tipoProcessoMotorId: true, status: { select: { faseCode: true } } },
    })
    if (!proc?.tipoProcessoMotorId || !proc.status?.faseCode) return

    const phaseKey = await resolvePhaseKey(proc.tipoProcessoMotorId, proc.status.faseCode)
    if (!phaseKey) return

    await executarMotorNaFase(processoId, proc.tipoProcessoMotorId, phaseKey, 'entered')
  } catch (e) {
    console.error('[motor] disparo automático falhou (a fase mudou normalmente):', e)
  }
}