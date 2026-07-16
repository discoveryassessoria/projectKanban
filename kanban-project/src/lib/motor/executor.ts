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
import { getFase, faseCodeToPhaseKey, phaseKeyToFaseCode } from '@/src/lib/process-stage/fases-catalog'
import { gerarCodigoReceita, gerarCodigoCusto } from '@/lib/financeiro/codigos'
import { gerarParcelas } from '@/lib/financeiro/parcelas'
import { criarTarefaDeSpec } from '@/src/services/processEngine/taskEngine'
// ✅ E8 (fatia Emissão) — motor econômico por ELEGIBILIDADE. Roda AO LADO do
// executor clássico, atrás da MESMA trava (autoExecutarAoAvancar). Import
// relativo porque os dois arquivos vivem em src/lib/motor/.
import { gerarEconomicoDaMatriz } from './matriz-economica'
import { processoEmRuntimeV2 } from './runtime-guard' // CP-4H

// ---- tipos de saída ----
export interface CreatedItem { kind: string; targetTable: string; targetId: number; name: string; amount?: number; currency?: string; condicional?: boolean; condicaoNaoVerificada?: boolean }
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
// existe). Senão, deixa SEM dono. É AQUI o lugar do mapa papel→usuário no
// futuro.
// ============================================================
async function resolverResponsavelDaRegra(params: Prisma.JsonValue | null | undefined): Promise<number | null> {
  const id = pnum(params, 'responsibleId')
  if (id && id > 0) {
    const u = await prisma.usuario.findUnique({ where: { id }, select: { id: true } })
    return u ? u.id : null
  }
  return null
}

// ============================================================
// ✅ E5 PARTE 2 — AVALIAÇÃO DE CONDIÇÕES
// ------------------------------------------------------------
// Uma automação pode ter conditions = [{ field, op, value }], op = "eq"|"neq".
// Antes o executor IGNORAVA isso (criava sempre). Agora avalia de verdade.
//
// CAMPOS_CONHECIDOS = registro dos campos que o motor SABE ler/checar. Está
// VAZIO de propósito: hoje não existe condição real no sistema (só de teste,
// com "AAAA"). Quando existir uma condição real (ex.: "contrato assinado"),
// adicione o campo AQUI com a função que lê o valor atual do processo — e aí
// ela passa a ser CHECADA de verdade, não só marcada.
//
// Enquanto o campo não estiver aqui, a condição é "não verificada".
// ============================================================
type CampoResolver = (processoId: number) => Promise<string | null>

const CAMPOS_CONHECIDOS: Record<string, CampoResolver> = {
  // Exemplos (DESLIGADOS) — descomente/implemente quando a condição for real:
  // contrato_assinado: async (pid) => { ... return "true" | "false" },
  // proposta_aprovada: async (pid) => { ... return "true" | "false" },
}

type DecisaoCondicao = 'passa' | 'bloqueia' | 'nao_verificada'

async function avaliarCondicoes(
  conditions: Prisma.JsonValue | null | undefined,
  processoId: number,
): Promise<{ decisao: DecisaoCondicao; motivo: string | null }> {
  // sem condição → passa
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return { decisao: 'passa', motivo: null }
  }

  let algumaNaoVerificada = false

  for (const raw of conditions) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { algumaNaoVerificada = true; continue }
    const cond = raw as Record<string, unknown>
    const field = typeof cond.field === 'string' ? cond.field : null
    const op = typeof cond.op === 'string' ? cond.op : null
    const value = cond.value == null ? null : String(cond.value)

    if (!field || !op) { algumaNaoVerificada = true; continue }

    const resolver = CAMPOS_CONHECIDOS[field]
    if (!resolver) { algumaNaoVerificada = true; continue }   // campo desconhecido

    const atual = await resolver(processoId)
    const bate = op === 'eq' ? atual === value : op === 'neq' ? atual !== value : null
    if (bate === null) { algumaNaoVerificada = true; continue }   // operador desconhecido

    if (!bate) {
      // condição REAL e FALSA → não cria
      return { decisao: 'bloqueia', motivo: `condição não satisfeita: ${field} ${op} ${value} (atual: ${atual ?? '—'})` }
    }
    // condição real e verdadeira → segue avaliando as outras
  }

  if (algumaNaoVerificada) {
    // política ESCOLHIDA (opção B): cria mesmo assim, mas MARCADO p/ revisão.
    return { decisao: 'nao_verificada', motivo: 'condição com campo/operador que o motor ainda não sabe avaliar' }
  }

  return { decisao: 'passa', motivo: null }
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
// Converte um FaseCode no phaseKey REAL do tipo de processo (casa pelo
// nome/label). Robusto: não depende de regra de texto.
// ============================================================
export async function resolvePhaseKey(tipoProcessoId: number, faseCode: FaseCode): Promise<string | null> {
  const mw = await prisma.macroWorkflow.findUnique({ where: { tipoProcessoId }, select: { fases: { select: { phaseKey: true, label: true } } } })
  const fases = mw?.fases ?? []
  const norm = (s: string) => s.trim().toLowerCase()
  let label = ''
  try { label = getFase(faseCode)?.label ?? '' } catch { label = '' }
  if (label) { const f = fases.find(x => norm(x.label) === norm(label)); if (f) return f.phaseKey }
  const lc = faseCodeToPhaseKey(faseCode) as string
  const f2 = fases.find(x => x.phaseKey === lc)
  return f2 ? f2.phaseKey : (fases.length ? null : lc)
}

// ============================================================
// EXECUTOR — roda as automações da fase e cria os artefatos reais.
// Quem chama garante que o processo está conectado (passa tipoProcessoId).
// ============================================================
export async function executarMotorNaFase(processoId: number, tipoProcessoId: number, phaseKey: string, event: string): Promise<RunResultado> {
  // CP-4H — no-op para processos em runtime v2: o motor legado (tarefas/eventos/
  // protocolos + FINANCEIRO por regra de fase) não pode executar sobre processos v2.
  if (await processoEmRuntimeV2(processoId)) {
    return { created: [], skipped: [{ name: "motor-legado", reason: "processo em runtime v2 — motor legado inativo" }], errors: [], totalCriado: 0 }
  }
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

  // TAREFAS
  for (const rule of taskRules) {
    if (wantTrigger == null || rule.trigger !== wantTrigger) { skipped.push({ name: rule.name, reason: `gatilho não corresponde (dispara em "${rule.trigger}")` }); continue }
    const cond = await avaliarCondicoes(rule.conditions, processoId)
    if (cond.decisao === 'bloqueia') { skipped.push({ name: rule.name, reason: cond.motivo || 'condição não satisfeita' }); continue }
    const naoVerificada = cond.decisao === 'nao_verificada'
    const akey = `${processoId}::${phaseKey}::automation::${rule.id}`
    const prio = mapPrio(pstr(rule.params, 'priority'))
    const slaDays = pnum(rule.params, 'slaDays')
    const followUpDias = pnum(rule.params, 'followUpDays')
    const responsavelId = await resolverResponsavelDaRegra(rule.params)
    await fazer(akey, 'Tarefa', 'task', 'automation', rule.id, rule.name,
      { prioridade: prio, ...(naoVerificada ? { condicaoNaoVerificada: true, condicaoMotivo: cond.motivo } : {}) },
      async () => {
        const t = await criarTarefaDeSpec({
          titulo: rule.name,
          descricao: rule.description || null,
          processoId,
          responsavelId,
          prioridade: prio,
          slaDays,
          followUp: followUpDias != null ? { prazoCobranca: followUpDias } : null,
          observacoes: `Criada automaticamente pelo motor · fase "${phaseKey}" · regra "${rule.name}"${naoVerificada ? ' · ⚠ condição não verificada' : ''}`,
        })
        return t.id
      },
      (id) => created.push({ kind: 'task', targetTable: 'Tarefa', targetId: id, name: rule.name, condicaoNaoVerificada: naoVerificada || undefined }))
  }

  // FINANCEIRO — Regras de Disparo (PhaseTriggerRule) — sem conditions Json;
  // usa os flags requiresContractSigned/requiresProposalApproved (marca condicional).
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
    const cond = await avaliarCondicoes(r.conditions, processoId)
    if (cond.decisao === 'bloqueia') { skipped.push({ name: r.name, reason: cond.motivo || 'condição não satisfeita' }); continue }
    const naoVerificada = cond.decisao === 'nao_verificada'
    const code = pstr(r.params, 'financialItemCode')
    const prod = code ? prodByCode.get(code) : undefined
    const valor = pnum(r.params, 'amount') ?? (prod?.valorPadrao != null ? Number(prod.valorPadrao) : null)
    if (valor == null) { skipped.push({ name: r.name, reason: 'sem valor configurado' }); continue }
    const moeda = toMoeda(pstr(r.params, 'currency'), (prod?.moedaPadrao as Moeda) || 'EUR')
    const honorario = r.financialType === 'honorarium'
    const isReceita = r.financialType === 'revenue' || honorario
    const fx = await fxParaBRL(moeda, fxCache)
    const akey = `${processoId}::${phaseKey}::automation::${r.id}`
    await fazer(akey, isReceita ? 'Receita' : 'Custo', 'financial', 'automation', r.id, r.name,
      { valor, moeda, condicional: naoVerificada, ...(naoVerificada ? { condicaoNaoVerificada: true, condicaoMotivo: cond.motivo } : {}) },
      async () => (isReceita ? criarReceita(processoId, r.name, valor, moeda, fx, honorario) : criarCusto(processoId, r.name, valor, moeda, fx)),
      (id) => created.push({ kind: 'financial', targetTable: isReceita ? 'Receita' : 'Custo', targetId: id, name: r.name, amount: valor, currency: moeda, condicional: naoVerificada, condicaoNaoVerificada: naoVerificada || undefined }))
  }

  // EVENTO / AGENDA
  for (const r of eventRules) {
    if (wantTrigger == null || r.trigger !== wantTrigger) { skipped.push({ name: r.name, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
    const cond = await avaliarCondicoes(r.conditions, processoId)
    if (cond.decisao === 'bloqueia') { skipped.push({ name: r.name, reason: cond.motivo || 'condição não satisfeita' }); continue }
    const naoVerificada = cond.decisao === 'nao_verificada'
    const offset = pnum(r.params, 'eventOffsetDays') ?? 0
    const dataInicio = new Date(Date.now() + offset * 86400000)
    const tipo = toTipoEvento(pstr(r.params, 'eventType'))
    const akey = `${processoId}::${phaseKey}::automation::${r.id}`
    await fazer(akey, 'Evento', 'event', 'automation', r.id, r.name,
      { tipo, dataInicio: dataInicio.toISOString(), ...(naoVerificada ? { condicaoNaoVerificada: true, condicaoMotivo: cond.motivo } : {}) },
      async () => criarEvento(processoId, r.name, r.description || null, dataInicio, tipo),
      (id) => created.push({ kind: 'event', targetTable: 'Evento', targetId: id, name: r.name, condicaoNaoVerificada: naoVerificada || undefined }))
  }

  // PROTOCOLO
  for (const r of protocolRules) {
    if (wantTrigger == null || r.trigger !== wantTrigger) { skipped.push({ name: r.name, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
    const cond = await avaliarCondicoes(r.conditions, processoId)
    if (cond.decisao === 'bloqueia') { skipped.push({ name: r.name, reason: cond.motivo || 'condição não satisfeita' }); continue }
    const naoVerificada = cond.decisao === 'nao_verificada'
    const akey = `${processoId}::${phaseKey}::automation::${r.id}`
    await fazer(akey, 'Protocolo', 'protocol', 'automation', r.id, r.name,
      { nota: 'consulado OUTROS (ajustar)', ...(naoVerificada ? { condicaoNaoVerificada: true, condicaoMotivo: cond.motivo } : {}) },
      async () => criarProtocolo(processoId, r.name),
      (id) => created.push({ kind: 'protocol', targetTable: 'Protocolo', targetId: id, name: r.name, condicaoNaoVerificada: naoVerificada || undefined }))
  }

  return { created, skipped, errors, totalCriado: created.length }
}

// ============================================================
// GATILHO AUTOMÁTICO — auto-suficiente.
// Chame com o processoId DEPOIS que a fase já mudou. Best-effort: qualquer
// erro aqui é engolido (não quebra quem chamou). Só roda se
// MotorConfig.autoExecutarAoAvancar estiver LIGADO (OFF por padrão).
// ============================================================
export async function dispararMotorNaFaseAtual(processoId: number): Promise<void> {
  try {
    const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 } })
    if (!cfg?.autoExecutarAoAvancar) return

    // CP-4H — v2 não usa o motor legado (fase é do PhaseAdvanceService; sem financeiro).
    if (await processoEmRuntimeV2(processoId)) return

    const proc = await prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        tipoProcessoMotorId: true,
        faseAtualKey: true,
      },
    })
    if (!proc?.tipoProcessoMotorId) return

    // ✅ E5 — fase REAL = faseAtualKey (fonte de verdade pós-E2).
    const faseAtual = phaseKeyToFaseCode(proc.faseAtualKey) ?? null
    if (!faseAtual) return

    const phaseKey = await resolvePhaseKey(proc.tipoProcessoMotorId, faseAtual)
    if (!phaseKey) return

    // Motor CLÁSSICO (tarefas/eventos/protocolos + financeiro por regra de fase).
    await executarMotorNaFase(processoId, proc.tipoProcessoMotorId, phaseKey, 'entered')

    // ✅ E8 (fatia Emissão) — Motor econômico por ELEGIBILIDADE.
    // Auto-gated DUAS vezes: (1) só chega aqui se a trava global
    // autoExecutarAoAvancar estiver LIGADA; (2) gerarEconomicoDaMatriz só cria
    // algo se existir regra na MatrizDocumental para este tipoProcesso + fase —
    // caso contrário, ele retorna sem criar nada (no-op).
    // Isolado em try/catch próprio: uma falha aqui NÃO derruba o motor clássico
    // acima nem quem chamou este gatilho.
    // phaseCycle = 1 fixo por enquanto (reemissão/ciclo entra numa fatia futura).
    try {
      await gerarEconomicoDaMatriz(processoId, proc.tipoProcessoMotorId, phaseKey, 1)
    } catch (e) {
      console.error('[motor] gerarEconomicoDaMatriz falhou (fluxo seguiu normal):', e)
    }
  } catch (e) {
    console.error('[motor] disparo automático falhou (a fase mudou normalmente):', e)
  }
}