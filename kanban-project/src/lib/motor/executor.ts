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
import { resolverPrecoPorConfigDB } from './resolver-preco-financeiro.prisma'
import { NaturezaPreco } from '@prisma/client'
import { aplicacaoValida, naturezasDaAplicacao, aplicacaoPermitida } from '@/lib/financeiro/aplicacao-financeira'
import { tituloAutomacaoFinanceira, descricaoLancamentoDaConfig } from '@/lib/financeiro/automacao-financeira-identidade'
import { processoEmRuntimeV2 } from './runtime-guard' // CP-4H

// PREÇO-FONTE-ÚNICA (§5): resolve o valor SÓ pela Tabela de Preços de uma
// Configuração Financeira. NÃO usa valorPadrao da config como preço; sem preço
// válido → null (o caller PULA, nunca lança zero). `amount` explícito na automação
// é override manual legítimo e tem prioridade.
async function precoDaConfig(configId: number | null | undefined, natureza: NaturezaPreco, processoId: number, tipoProcessoId: number): Promise<{ valor: number; moeda: Moeda; tabelaValorId: number | null } | { erro: string } | null> {
  if (configId == null) return null
  const r = await resolverPrecoPorConfigDB(configId, { processoId, tipoProcessoId: String(tipoProcessoId), natureza })
  if (!r.ok) return { erro: r.razao }
  if (r.conflito) return { erro: r.conflito.nota }
  return { valor: r.valor, moeda: r.moeda, tabelaValorId: r.tabelaValorId }
}

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
function toTipoEvento(s: string | null): TipoEvento {
  const up = (s || '').toUpperCase()
  const ok: TipoEvento[] = ['CONSULADO', 'CARTORIO', 'REUNIAO', 'PRAZO', 'AUDIENCIA', 'ENTREGA_DOCUMENTO', 'OUTRO']
  return (ok as string[]).includes(up) ? (up as TipoEvento) : 'OUTRO'
}
const opautoTriggerFor = (ev: string) => (ev === 'entered' ? 'phase_entered' : null)

// Retorna a taxa moeda→BRL, ou NULL quando não há cotação ativa para moeda estrangeira.
// NUNCA cai para 1 em moeda != BRL — isso gravaria o lançamento sem conversão (valor errado).
async function fxParaBRL(moeda: Moeda, cache: Map<string, number>): Promise<number | null> {
  if (moeda === 'BRL') return 1
  if (cache.has(moeda)) return cache.get(moeda)!
  const cot = await prisma.cotacaoCambio.findFirst({ where: { moedaDe: moeda, moedaPara: 'BRL', ativo: true }, orderBy: { criadoEm: 'desc' } })
  if (!cot) return null
  const taxa = Number(cot.taxa)
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
// §4 — congelamento também no path de automação/gatilho. tabelaValorId vem do
// resolvedor central (precoDaConfig); manual (amount) não tem regra de preço.
type FreezeExec = { tabelaValorId?: number | null; configId?: number | null; regraId?: number | null; naturezaPreco?: 'CUSTO' | 'VENDA' | null; contexto?: Prisma.InputJsonValue; phaseKey?: string | null; phaseCycle?: number | null; chaveIdempotencia?: string | null }
// Client de escrita: prisma global OU um client de transação (para tornar o lançamento
// atômico com o MotorArtefato de idempotência). gerarCodigo* usa o global de propósito
// (código nunca reusa — um rollback só deixa um gap, comportamento desejado).
type DbLancamento = Prisma.TransactionClient | typeof prisma

async function criarReceita(db: DbLancamento, pid: number, descricao: string, valor: number, moeda: Moeda, fx: number, honorario: boolean, fz: FreezeExec = {}): Promise<number> {
  const codigo = await gerarCodigoReceita()
  const data1 = new Date()
  const parcelas = gerarParcelas(valor, 1, data1)
  const valorBrlRef = Number((valor * fx).toFixed(2))
  const rec = await db.receita.create({
    data: {
      codigo, processoId: pid,
      categoria: honorario ? CategoriaReceita.HONORARIOS : CategoriaReceita.OUTROS,
      descricao: descricao.slice(0, 300), moeda, valor,
      fxEstimado: fx, fxRule: FxRule.VARIAVEL, nParcelas: 1, data1, periodicidade: 'Mensal', status: ReceitaStatus.ATIVA,
      origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
      pricingRuleId: fz.tabelaValorId ?? null, valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor,
      modoCalculoAplicado: fz.tabelaValorId != null ? 'fixed' : 'manual', naturezaPreco: fz.naturezaPreco ?? 'VENDA',
      configFinanceiraId: fz.configId ?? null, regraFinanceiraId: fz.regraId ?? null, contextoAplicado: fz.contexto ?? undefined, dataReferencia: data1,
      phaseKey: fz.phaseKey ?? null, phaseCycle: fz.phaseCycle ?? null, chaveIdempotencia: fz.chaveIdempotencia ?? null,
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Receita criada pelo motor: ${descricao}`.slice(0, 500), valor, cambio: fx, valorBrl: valorBrlRef } },
    },
  })
  return rec.id
}
async function criarCusto(db: DbLancamento, pid: number, descricao: string, valor: number, moeda: Moeda, fx: number, fz: FreezeExec = {}): Promise<number> {
  const codigo = await gerarCodigoCusto()
  const vencimento = new Date()
  const parcelas = gerarParcelas(valor, 1, vencimento)
  const valorBrlRef = Number((valor * fx).toFixed(2))
  const c = await db.custo.create({
    data: {
      codigo, processoId: pid, tipo: TipoCusto.SERVICO, categoria: CategoriaCusto.OUTROS,
      descricao: descricao.slice(0, 300), moeda, valor,
      fxEstimado: fx, fxRule: FxRule.VARIAVEL, nParcelas: 1, vencimento, custoOperacional: false, status: CustoStatus.ATIVA,
      origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'CUSTO',
      pricingRuleId: fz.tabelaValorId ?? null, valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor,
      modoCalculoAplicado: fz.tabelaValorId != null ? 'fixed' : 'manual', naturezaPreco: fz.naturezaPreco ?? 'CUSTO',
      configFinanceiraId: fz.configId ?? null, regraFinanceiraId: fz.regraId ?? null, contextoAplicado: fz.contexto ?? undefined, dataReferencia: vencimento,
      phaseKey: fz.phaseKey ?? null, phaseCycle: fz.phaseCycle ?? null, chaveIdempotencia: fz.chaveIdempotencia ?? null,
      parcelas: { create: parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, status: 'PENDENTE' as const })) },
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Custo criado pelo motor: ${descricao}`.slice(0, 500), valor, cambio: fx, valorBrl: valorBrlRef } },
    },
  })
  return c.id
}
async function criarEvento(db: DbLancamento, pid: number, titulo: string, descricao: string | null, dataInicio: Date, tipo: TipoEvento): Promise<number> {
  const ev = await db.evento.create({ data: { processoId: pid, titulo: titulo.slice(0, 200), descricao: descricao || null, tipo, dataInicio, observacoes: 'Criado pelo motor' } })
  return ev.id
}
async function criarProtocolo(db: DbLancamento, pid: number, nome: string): Promise<number> {
  const p = await db.protocolo.create({ data: { processoId: pid, consulado: 'OUTROS' as Consulado, observacoes: `Criado pelo motor: ${nome}` } })
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
  // ARQUITETURA NOVA (neutralização das automações antigas): automações NÃO criam
  // mais tarefas obrigatórias da fase. Tarefas passam a ser responsabilidade
  // EXCLUSIVA do Workflow Interno de cada Fase Macro. Ainda LEMOS as regras
  // kind=task existentes só para REPORTá-las como neutralizadas (transparência na
  // simulação/histórico) — mas nenhuma Tarefa é criada aqui. Efeitos adicionais
  // (financeiro/evento/protocolo/trigger) seguem funcionando.
  const [taskRules, finAutoRules, eventRules, protocolRules] = await Promise.all([
    prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'task', active: true, arquivado: false } }),
    prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'financial', active: true, arquivado: false } }),
    prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'event', active: true, arquivado: false } }),
    prisma.phaseAutomationRule.findMany({ where: { tipoProcessoId, phaseKey, kind: 'protocol', active: true, arquivado: false } }),
  ])
  const fxCache = new Map<string, number>()

  const created: CreatedItem[] = []
  const skipped: { name: string; reason: string }[] = []
  const errors: string[] = []

  // ATÔMICO + IDEMPOTENTE: o efeito (criar) e o MotorArtefato (marcador único por
  // automaticKey, já com targetId) são criados na MESMA transação. P2002 no artefato
  // (retry/concorrência) faz ROLLBACK do efeito junto → nunca duplica nem deixa órfão.
  async function fazer(akey: string, targetTable: string, ruleKind: string, ruleSource: string, ruleId: number, descricao: string, detalhes: Prisma.InputJsonValue, criar: (tx: Prisma.TransactionClient) => Promise<number>, onCreated: (id: number) => void) {
    try {
      const id = await prisma.$transaction(async (tx) => {
        const novoId = await criar(tx)
        await tx.motorArtefato.create({
          data: { processoId, tipoProcessoId, phaseKey, event, ruleKind, ruleSource, ruleId, automaticKey: akey, targetTable, targetId: novoId, status: 'active', descricao: descricao.slice(0, 300), detalhes },
        })
        return novoId
      }, { timeout: 30000, maxWait: 10000 })
      onCreated(id)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        skipped.push({ name: descricao, reason: 'já criado antes (idempotência)' }); return
      }
      errors.push(`${descricao}: ${(e as Error)?.message || 'erro'}`)
    }
  }

  // TAREFAS — NEUTRALIZADO (arquitetura nova).
  // Automações não criam mais tarefas obrigatórias da fase: isso é exclusivo do
  // Workflow Interno. Regras kind=task existentes são apenas REPORTADAS como
  // neutralizadas; nenhuma Tarefa é criada aqui. (Os helpers de criação de tarefa
  // — criarTarefaDeSpec/mapPrio/resolverResponsavelDaRegra — ficaram sem uso de
  // propósito; mantidos para minimizar churn até a nova arquitetura.)
  for (const rule of taskRules) {
    skipped.push({ name: rule.name ?? `automação #${rule.id}`, reason: 'automação de tarefa NEUTRALIZADA — tarefas obrigatórias da fase são exclusivas do Workflow Interno' })
  }

  // FINANCEIRO — Automações kind=financial
  for (const r of finAutoRules) {
    if (wantTrigger == null || r.trigger !== wantTrigger) { skipped.push({ name: r.name ?? `automação #${r.id}`, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
    const cond = await avaliarCondicoes(r.conditions, processoId)
    if (cond.decisao === 'bloqueia') { skipped.push({ name: r.name ?? `automação #${r.id}`, reason: cond.motivo || 'condição não satisfeita' }); continue }
    const naoVerificada = cond.decisao === 'nao_verificada'

    // ── FLUXO NOVO — vínculo ESTRUTURAL à Configuração Financeira. IDENTIDADE DERIVADA
    // (título/descrição da Config, nunca r.name). Preço da Tabela; AMBOS → dois lançamentos.
    if (r.configItemId != null) {
      const ap = r.aplicacaoFinanceira
      const rotulo = `automação #${r.id}`
      if (!aplicacaoValida(ap)) { skipped.push({ name: rotulo, reason: 'Aplicação financeira ausente/inválida (RECEITA, CUSTO ou AMBOS)' }); continue }
      const cfg = await prisma.produtoFinanceiro.findUnique({ where: { id: r.configItemId }, select: {
        possuiCusto: true, possuiReceita: true,
        tipoDocumento: { select: { name: true } }, honorario: { select: { name: true } },
        tipoProcesso: { select: { name: true } }, itemCatalogo: { select: { name: true } },
      } })
      if (!cfg) { skipped.push({ name: rotulo, reason: 'Configuração Financeira vinculada não encontrada' }); continue }
      const mestreNome = cfg.tipoDocumento?.name ?? cfg.honorario?.name ?? cfg.tipoProcesso?.name ?? cfg.itemCatalogo?.name ?? 'Configuração Financeira'
      const titulo = tituloAutomacaoFinanceira(ap, mestreNome)
      const descricaoLanc = descricaoLancamentoDaConfig(mestreNome)
      if (!aplicacaoPermitida(ap, cfg)) { skipped.push({ name: titulo, reason: `Aplicação "${ap}" não é permitida pela Configuração Financeira (custo=${cfg.possuiCusto}, receita=${cfg.possuiReceita})` }); continue }
      for (const natPreco of naturezasDaAplicacao(ap)) {
        const isRec = natPreco === NaturezaPreco.VENDA
        const preco = await precoDaConfig(r.configItemId, natPreco, processoId, tipoProcessoId)
        if (!preco) { skipped.push({ name: titulo, reason: 'Configuração Financeira sem preço cadastrado' }); continue }
        if ('erro' in preco) { skipped.push({ name: titulo, reason: `Nenhum preço vigente encontrado para a Configuração Financeira selecionada — ${preco.erro}` }); continue }
        const fx = await fxParaBRL(preco.moeda, fxCache)
        if (fx == null) { skipped.push({ name: titulo, reason: `Sem cotação de câmbio ${preco.moeda}→BRL. Cadastre a cotação para lançar.` }); continue }
        // Idempotência estrutural: processo + fase + automação + natureza (config/aplicação fixos na regra).
        const akey = `${processoId}::${phaseKey}::automation::${r.id}::${isRec ? 'VENDA' : 'CUSTO'}`
        const fz: FreezeExec = { tabelaValorId: preco.tabelaValorId, configId: r.configItemId, regraId: r.id, naturezaPreco: isRec ? 'VENDA' : 'CUSTO', phaseKey, chaveIdempotencia: akey, contexto: { fonte: 'automation', ruleId: r.id, phaseKey, configItemId: r.configItemId, aplicacao: ap, mestre: mestreNome } }
        await fazer(akey, isRec ? 'Receita' : 'Custo', 'financial', 'automation', r.id, titulo,
          { configItemId: r.configItemId, mestre: mestreNome, aplicacao: ap, natureza: isRec ? 'VENDA' : 'CUSTO', valor: preco.valor, moeda: preco.moeda, tabelaValorId: preco.tabelaValorId, ...(naoVerificada ? { condicaoNaoVerificada: true, condicaoMotivo: cond.motivo } : {}) },
          async (tx) => (isRec ? criarReceita(tx, processoId, descricaoLanc, preco.valor, preco.moeda, fx, false, fz) : criarCusto(tx, processoId, descricaoLanc, preco.valor, preco.moeda, fx, fz)),
          (id) => created.push({ kind: 'financial', targetTable: isRec ? 'Receita' : 'Custo', targetId: id, name: titulo, amount: preco.valor, currency: preco.moeda, condicaoNaoVerificada: naoVerificada || undefined }))
      }
      continue
    }

    // SEM configItemId = regra LEGADA (valor/moeda/código manual). O formato legado foi
    // DESCONTINUADO: não executa mais (nada de valor manual). Migre-a para uma
    // Configuração Financeira (o preço passa a vir da Tabela de Preços).
    skipped.push({ name: r.name ?? `automação #${r.id}`, reason: 'Regra financeira LEGADA (valor/moeda manual) — descontinuada. Migre para uma Configuração Financeira; o preço vem da Tabela de Preços.' })
  }

  // EVENTO / AGENDA
  for (const r of eventRules) {
    const nome = r.name ?? `automação #${r.id}`
    if (wantTrigger == null || r.trigger !== wantTrigger) { skipped.push({ name: nome, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
    const cond = await avaliarCondicoes(r.conditions, processoId)
    if (cond.decisao === 'bloqueia') { skipped.push({ name: nome, reason: cond.motivo || 'condição não satisfeita' }); continue }
    const naoVerificada = cond.decisao === 'nao_verificada'
    const offset = pnum(r.params, 'eventOffsetDays') ?? 0
    const dataInicio = new Date(Date.now() + offset * 86400000)
    const tipo = toTipoEvento(pstr(r.params, 'eventType'))
    const akey = `${processoId}::${phaseKey}::automation::${r.id}`
    await fazer(akey, 'Evento', 'event', 'automation', r.id, nome,
      { tipo, dataInicio: dataInicio.toISOString(), ...(naoVerificada ? { condicaoNaoVerificada: true, condicaoMotivo: cond.motivo } : {}) },
      async (tx) => criarEvento(tx, processoId, nome, r.description || null, dataInicio, tipo),
      (id) => created.push({ kind: 'event', targetTable: 'Evento', targetId: id, name: nome, condicaoNaoVerificada: naoVerificada || undefined }))
  }

  // PROTOCOLO
  for (const r of protocolRules) {
    const nome = r.name ?? `automação #${r.id}`
    if (wantTrigger == null || r.trigger !== wantTrigger) { skipped.push({ name: nome, reason: `gatilho não corresponde (dispara em "${r.trigger}")` }); continue }
    const cond = await avaliarCondicoes(r.conditions, processoId)
    if (cond.decisao === 'bloqueia') { skipped.push({ name: nome, reason: cond.motivo || 'condição não satisfeita' }); continue }
    const naoVerificada = cond.decisao === 'nao_verificada'
    const akey = `${processoId}::${phaseKey}::automation::${r.id}`
    await fazer(akey, 'Protocolo', 'protocol', 'automation', r.id, nome,
      { nota: 'consulado OUTROS (ajustar)', ...(naoVerificada ? { condicaoNaoVerificada: true, condicaoMotivo: cond.motivo } : {}) },
      async (tx) => criarProtocolo(tx, processoId, nome),
      (id) => created.push({ kind: 'protocol', targetTable: 'Protocolo', targetId: id, name: nome, condicaoNaoVerificada: naoVerificada || undefined }))
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

// ============================================================
// V2 — automações FINANCEIRAS na entrada da fase (chamado pela outbox phase.entered).
// Processos V2 não passam pelo motor clássico; este é o ponto de execução das
// automações financeiras (fluxo NOVO: configItemId + aplicacaoFinanceira). Roda SÓ
// financeiro (tarefas são do Workflow Interno). Preço vem da Tabela de Preços;
// idempotência via MotorArtefato (automaticKey @unique). Reprocessável (não duplica).
// ============================================================
export async function executarFinanceirasNaFaseV2(
  processoId: number, phaseKey: string,
): Promise<{ criadas: number; skipped: { name: string; reason: string }[]; erros: string[] }> {
  const skipped: { name: string; reason: string }[] = []
  const erros: string[] = []
  let criadas = 0

  const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { tipoProcessoMotorId: true } })
  const tipoProcessoId = proc?.tipoProcessoMotorId
  if (!tipoProcessoId) return { criadas, skipped, erros }

  const regras = await prisma.phaseAutomationRule.findMany({
    where: { kind: 'financial', tipoProcessoId, phaseKey, trigger: 'phase_entered', active: true, arquivado: false, configItemId: { not: null } },
  })
  const fxCache = new Map<string, number>()

  for (const r of regras) {
    const ap = r.aplicacaoFinanceira
    const rotulo = `automação #${r.id}`
    if (!aplicacaoValida(ap)) { skipped.push({ name: rotulo, reason: 'Aplicação financeira inválida' }); continue }
    // IDENTIDADE ESTRUTURADA: nome/descrição derivam da Config (nunca de r.name).
    const cfg = await prisma.produtoFinanceiro.findUnique({ where: { id: r.configItemId! }, select: {
      possuiCusto: true, possuiReceita: true,
      tipoDocumento: { select: { name: true } }, honorario: { select: { name: true } },
      tipoProcesso: { select: { name: true } }, itemCatalogo: { select: { name: true } },
    } })
    if (!cfg) { skipped.push({ name: rotulo, reason: 'Configuração Financeira não encontrada' }); continue }
    const mestreNome = cfg.tipoDocumento?.name ?? cfg.honorario?.name ?? cfg.tipoProcesso?.name ?? cfg.itemCatalogo?.name ?? 'Configuração Financeira'
    const titulo = tituloAutomacaoFinanceira(ap, mestreNome) // "Receita • <mestre>"
    const descricaoLanc = descricaoLancamentoDaConfig(mestreNome) // descrição do lançamento = mestre
    if (!aplicacaoPermitida(ap, cfg)) { skipped.push({ name: titulo, reason: `Aplicação "${ap}" não permitida pela Configuração Financeira` }); continue }

    for (const natPreco of naturezasDaAplicacao(ap)) {
      const isRec = natPreco === NaturezaPreco.VENDA
      const preco = await precoDaConfig(r.configItemId!, natPreco, processoId, tipoProcessoId)
      if (!preco) { skipped.push({ name: titulo, reason: 'Configuração Financeira sem preço cadastrado' }); continue }
      if ('erro' in preco) { skipped.push({ name: titulo, reason: `Nenhum preço vigente encontrado para a Configuração Financeira selecionada — ${preco.erro}` }); continue }

      // CÂMBIO obrigatório em moeda estrangeira: sem cotação, NÃO lança (evita valor sem
      // conversão). Checado ANTES de criar o marcador de idempotência (não deixa órfão).
      const fx = await fxParaBRL(preco.moeda, fxCache)
      if (fx == null) { skipped.push({ name: titulo, reason: `Sem cotação de câmbio ${preco.moeda}→BRL. Cadastre a cotação para lançar (não foi lançado com conversão 1:1).` }); continue }

      const akey = `${processoId}::${phaseKey}::automation::${r.id}::${isRec ? 'VENDA' : 'CUSTO'}`
      // ATOMICIDADE + IDEMPOTÊNCIA (correção de duplicidade): o LANÇAMENTO e o MotorArtefato
      // (marcador único por automaticKey, já com targetId) são criados na MESMA transação.
      // Se o artefato colidir (P2002 — já lançado, por retry/concorrência), a transação faz
      // ROLLBACK do lançamento junto → nunca sobra Receita/Custo órfão nem duplicata. Sem o
      // antigo create-null→update→delete (que duplicava quando o update falhava pós-lançamento).
      try {
        const fz: FreezeExec = { tabelaValorId: preco.tabelaValorId, configId: r.configItemId!, regraId: r.id, naturezaPreco: isRec ? 'VENDA' : 'CUSTO', phaseKey, chaveIdempotencia: akey, contexto: { fonte: 'automation_v2', ruleId: r.id, phaseKey, configItemId: r.configItemId, aplicacao: ap, mestre: mestreNome } }
        await prisma.$transaction(async (tx) => {
          const id = isRec
            ? await criarReceita(tx, processoId, descricaoLanc, preco.valor, preco.moeda, fx, false, fz)
            : await criarCusto(tx, processoId, descricaoLanc, preco.valor, preco.moeda, fx, fz)
          await tx.motorArtefato.create({
            data: {
              processoId, tipoProcessoId, phaseKey, event: 'entered', ruleKind: 'financial', ruleSource: 'automation', ruleId: r.id,
              automaticKey: akey, targetTable: isRec ? 'Receita' : 'Custo', targetId: id, status: 'active', descricao: titulo.slice(0, 300),
              detalhes: { configItemId: r.configItemId, mestre: mestreNome, aplicacao: ap, natureza: isRec ? 'VENDA' : 'CUSTO', valor: preco.valor, moeda: preco.moeda, tabelaValorId: preco.tabelaValorId },
            },
          })
        }, { timeout: 30000, maxWait: 10000 })
        criadas++
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          skipped.push({ name: titulo, reason: 'já lançado (idempotência)' }); continue
        }
        erros.push(`${titulo}: ${(e as Error)?.message ?? 'erro'}`)
      }
    }
  }
  return { criadas, skipped, erros }
}