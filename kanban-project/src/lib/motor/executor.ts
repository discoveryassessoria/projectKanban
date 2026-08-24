// src/lib/motor/executor.ts
// ============================================================
// MOTOR — núcleo do executor (compartilhado).
// Usado pelo botão manual (Executor do Motor) E pelo gatilho automático
// (ao avançar de fase). Cria artefatos REAIS num processo conectado a um
// Tipo do motor: tarefa, receita, custo, evento, protocolo.
// Idempotência via MotorArtefato.automaticKey (@unique). Desfazer no route.
// ============================================================

import { prisma } from '@/lib/prisma'
import { PESSOA_ATIVA, requerentesAtivosDaArvore } from '@/src/lib/genealogia/vinculo-ativo'
import {
  Prisma, PrioridadeTarefa,
  CategoriaReceita, CategoriaCusto, TipoCusto, Moeda, FxRule, ReceitaStatus, CustoStatus,
  TipoEvento, Consulado,
} from '@prisma/client'
import type { FaseCode } from '@prisma/client'
import { getFase, faseCodeToPhaseKey, phaseKeyToFaseCode } from '@/src/lib/process-stage/fases-catalog'
import { gerarCodigoReceita, gerarCodigoCusto } from '@/lib/financeiro/codigos'
import { calcularPreco } from '@/lib/financeiro/calculo-preco'
import { MODOS_PRIMEIRO_ADICIONAL, estrategiaDoModo } from '@/lib/financeiro/modo-calculo'
import { ehRequerente, REQUERENTE_VALORES } from '@/lib/genealogia/requerente-flag'
import { ordenarRequerentes, classificarRequerente, valorDoRequerente, chaveIdempotenciaRequerente } from '@/lib/financeiro/classificacao-requerente'
// Cronograma OFICIAL: a Condição de Pagamento decide entrada, quantidade,
// periodicidade e vencimentos. O motor consome o plano pronto.
import { aplicarCondicaoPagamento } from '@/lib/financeiro/aplicar-condicao'
import { criarObrigacaoEconomicaComLedgerTx, removerObrigacaoOrfaTx } from '@/lib/financeiro/ledger/ledger-service'
import { criarTarefaDeSpec } from '@/src/services/processEngine/taskEngine'
// ✅ E8 (fatia Emissão) — motor econômico por ELEGIBILIDADE. Roda AO LADO do
// executor clássico, atrás da MESMA trava (autoExecutarAoAvancar). Import
// relativo porque os dois arquivos vivem em src/lib/motor/.
import { gerarEconomicoDaMatriz } from './matriz-economica'
import { resolverPrecoPorConfigDB } from './resolver-preco-financeiro.prisma'
 import { espelharReceitaComoObrigacao } from '@/lib/financeiro/dual-write'
import { NaturezaPreco } from '@prisma/client'
import { aplicacaoValida, naturezasDaAplicacao, aplicacaoPermitida } from '@/lib/financeiro/aplicacao-financeira'
import { tituloAutomacaoFinanceira, descricaoLancamentoDaConfig } from '@/lib/financeiro/automacao-financeira-identidade'
import { processoEmRuntimeV2 } from './runtime-guard' // CP-4H
import { artefatoEstaSuprimido } from '@/lib/financeiro/supressao-motor'

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
  const dataBase = new Date()
  // ARQUITETURA (base ÚNICA): a Receita é SÓ o CONTRATO gerado pelo motor. NÃO nasce
  // com parcelas, vencimento, forma nem condição de pagamento — isso pertence à COBRANÇA.
  // As Parcelas nascem apenas quando uma Cobrança é criada (a partir da sua Condição).
  // Legado intacto (receitas antigas mantêm suas parcelas). `data1` (obrigatório no schema)
  // recebe a data de criação como valor neutro — não é mais cronograma.
  const valorBrlRef = Number((valor * fx).toFixed(2))
  const rec = await db.receita.create({
    data: {
      codigo, processoId: pid,
      categoria: honorario ? CategoriaReceita.HONORARIOS : CategoriaReceita.OUTROS,
      descricao: descricao.slice(0, 300), moeda, valor,
      fxEstimado: fx, fxRule: FxRule.VARIAVEL, nParcelas: 1, data1: dataBase, periodicidade: 'Mensal', status: ReceitaStatus.ATIVA,
      origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
      pricingRuleId: fz.tabelaValorId ?? null, valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor,
      modoCalculoAplicado: fz.tabelaValorId != null ? 'fixed' : 'manual', naturezaPreco: fz.naturezaPreco ?? 'VENDA',
      configFinanceiraId: fz.configId ?? null, regraFinanceiraId: fz.regraId ?? null, contextoAplicado: fz.contexto ?? undefined, dataReferencia: dataBase,
      phaseKey: fz.phaseKey ?? null, phaseCycle: fz.phaseCycle ?? null, chaveIdempotencia: fz.chaveIdempotencia ?? null,
      eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Receita (contrato) criada pelo motor: ${descricao}`.slice(0, 500), valor, cambio: fx, valorBrl: valorBrlRef } },
    },
  })
  return rec.id
}
async function criarCusto(db: DbLancamento, pid: number, descricao: string, valor: number, moeda: Moeda, fx: number, fz: FreezeExec = {}): Promise<number> {
  const codigo = await gerarCodigoCusto()
  const dataBase = new Date()
  // A condição de pagamento define o VENCIMENTO (data1). A quebra em parcelas é do modelo
  // legado; no V3-native o Custo é UMA obrigação (A_PAGAR) e pagamentos parciais vivem no
  // Ledger. O resumo da condição fica em observacoes (auditoria).
  const ap = await aplicarCondicaoPagamento({ configId: fz.configId ?? null, natureza: 'CUSTO', moeda: String(moeda), valor, dataBase })
  const observacoes = `Custo do motor: ${descricao}${ap.resumo}`.slice(0, 300)
  // V3-native: nasce DIRETO como ObrigacaoEconomica + Ledger, na MESMA transação do
  // MotorArtefato (idempotência/rollback atômicos). NÃO grava mais no model Custo legado.
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedgerTx(db as Prisma.TransactionClient, {
    natureza: 'CUSTO', valorContratado: valor, moedaContratual: String(moeda), codigoOperacional: codigo,
    processoId: pid, regraFinanceiraId: fz.regraId ?? null, itemCatalogoId: null, vencimento: ap.data1,
    observacoes, origemTipo: 'nativo', origemId: null, criadoPorId: null,
  })
  return obrigacaoId
}
async function criarEvento(db: DbLancamento, pid: number, titulo: string, descricao: string | null, dataInicio: Date, tipo: TipoEvento): Promise<number> {
  const ev = await db.evento.create({ data: { processoId: pid, titulo: titulo.slice(0, 200), descricao: descricao || null, tipo, dataInicio, observacoes: 'Criado pelo motor' } })
  return ev.id
}
// A AUTOMAÇÃO DE PROTOCOLO FICA NEUTRALIZADA, junto das de tarefa.
//
// Ela criava uma linha em `Protocolo` sem número, sem data e sem órgão — `consulado:
// OUTROS`, observação "Criado pelo motor". Isso não é o fato "protocolo": é um
// marcador de automação ocupando a entidade que passou a ser a fonte única do
// protocolo. Um protocolo em branco no meio dos protocolos reais é pior que nenhum,
// porque quem lê não tem como saber que aquilo nunca foi protocolado.
//
// Quem registra protocolo agora é `registrarProtocoloTx` — número, data e órgão
// obrigatórios —, chamada pela solicitação de certidão, pela protocolização do
// dossiê e pelo efeito `REGISTER_PROTOCOL` da etapa.
//
// As regras `kind=protocol` continuam sendo LIDAS e reportadas como neutralizadas,
// exatamente como as de `kind=task`: some da execução, não do histórico.

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
        if (!preco) {
          await registrarPendencia({ processoId, tipoProcessoId, phaseKey, configItemId: r.configItemId, regraId: r.id, natureza: natPreco, motivo: 'SEM_PRECO', detalhe: `${titulo}: Configuração Financeira sem preço cadastrado` })
          skipped.push({ name: titulo, reason: 'Sem preço → pendência financeira registrada (reprocessável)' }); continue
        }
        if ('erro' in preco) {
          await registrarPendencia({ processoId, tipoProcessoId, phaseKey, configItemId: r.configItemId, regraId: r.id, natureza: natPreco, motivo: 'SEM_PRECO_VALIDO', detalhe: `${titulo}: ${preco.erro}` })
          skipped.push({ name: titulo, reason: 'Preço ausente/conflitante → pendência registrada (reprocessável)' }); continue
        }
        const fx = await fxParaBRL(preco.moeda, fxCache)
        if (fx == null) {
          await registrarPendencia({ processoId, tipoProcessoId, phaseKey, configItemId: r.configItemId, regraId: r.id, natureza: natPreco, motivo: 'SEM_CAMBIO', detalhe: `${titulo}: Sem cotação de câmbio ${preco.moeda}→BRL` })
          skipped.push({ name: titulo, reason: `Sem câmbio ${preco.moeda}→BRL → pendência registrada (reprocessável)` }); continue
        }
        // Idempotência estrutural: processo + fase + automação + natureza (config/aplicação fixos na regra).
        const akey = `${processoId}::${phaseKey}::automation::${r.id}::${isRec ? 'VENDA' : 'CUSTO'}`
        const fz: FreezeExec = { tabelaValorId: preco.tabelaValorId, configId: r.configItemId, regraId: r.id, naturezaPreco: isRec ? 'VENDA' : 'CUSTO', phaseKey, chaveIdempotencia: akey, contexto: { fonte: 'automation', ruleId: r.id, phaseKey, configItemId: r.configItemId, aplicacao: ap, mestre: mestreNome } }
        await fazer(akey, isRec ? 'Receita' : 'ObrigacaoEconomica', 'financial', 'automation', r.id, titulo,
          { configItemId: r.configItemId, mestre: mestreNome, aplicacao: ap, natureza: isRec ? 'VENDA' : 'CUSTO', valor: preco.valor, moeda: preco.moeda, tabelaValorId: preco.tabelaValorId, ...(naoVerificada ? { condicaoNaoVerificada: true, condicaoMotivo: cond.motivo } : {}) },
          async (tx) => (isRec ? criarReceita(tx, processoId, descricaoLanc, preco.valor, preco.moeda, fx, false, fz) : criarCusto(tx, processoId, descricaoLanc, preco.valor, preco.moeda, fx, fz)),
          (id) => created.push({ kind: 'financial', targetTable: isRec ? 'Receita' : 'ObrigacaoEconomica', targetId: id, name: titulo, amount: preco.valor, currency: preco.moeda, condicaoNaoVerificada: naoVerificada || undefined }))
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

  // PROTOCOLO — NEUTRALIZADO (ver o comentário em `criarProtocolo`).
  for (const r of protocolRules) {
    const nome = r.name ?? `automação #${r.id}`
    skipped.push({
      name: nome,
      reason: 'automação de protocolo neutralizada — protocolo tem fonte única (Protocolo), ' +
        'escrita por registrarProtocoloTx com número, data e órgão. A regra continua cadastrada e não executa.',
    })
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
// P4 — PENDÊNCIA FINANCEIRA REPROCESSÁVEL: quando uma regra APLICÁVEL não pode lançar por
// falta de preço/config/câmbio, NÃO ignora em silêncio — registra (idempotente) uma
// PendenciaFinanceira reprocessável (nunca lançamento zero, nunca descarta o evento).
async function registrarPendencia(o: {
  processoId: number; tipoProcessoId: number | null; phaseKey: string; configItemId: number | null;
  regraId: number; natureza: NaturezaPreco | null; motivo: string; detalhe: string;
}): Promise<void> {
  const chave = `pend::${o.processoId}::${o.phaseKey}::${o.regraId}::${o.natureza ?? 'NA'}`
  const detalhe = o.detalhe.slice(0, 500)
  await prisma.pendenciaFinanceira.upsert({
    where: { chaveIdempotencia: chave },
    create: { processoId: o.processoId, tipoProcessoId: o.tipoProcessoId, phaseKey: o.phaseKey, phaseCycle: 1, configFinanceiraId: o.configItemId, regraFinanceiraId: o.regraId, natureza: o.natureza, motivo: o.motivo.slice(0, 40), detalhe, chaveIdempotencia: chave, resolvida: false, tentativas: 1, ultimaTentativaEm: new Date(), ultimaFalha: detalhe },
    update: { resolvida: false, resolvidaEm: null, tentativas: { increment: 1 }, ultimaTentativaEm: new Date(), ultimaFalha: detalhe },
  }).catch((e) => console.error('[pendencia financeira] falha ao registrar:', e))
}

/** Marca como resolvida a pendência daquela (processo, fase, regra, natureza) — após um
 *  lançamento bem-sucedido. Idempotente. */
async function resolverPendencia(processoId: number, phaseKey: string, regraId: number, natureza: NaturezaPreco): Promise<void> {
  const chave = `pend::${processoId}::${phaseKey}::${regraId}::${natureza}`
  await prisma.pendenciaFinanceira.updateMany({ where: { chaveIdempotencia: chave, resolvida: false }, data: { resolvida: true, resolvidaEm: new Date(), resolucao: 'Lançamento criado (preço/config resolvidos)' } }).catch(() => {})
}

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
      if (!preco) {
        await registrarPendencia({ processoId, tipoProcessoId, phaseKey, configItemId: r.configItemId, regraId: r.id, natureza: natPreco, motivo: 'SEM_PRECO', detalhe: `${titulo}: Configuração Financeira sem preço cadastrado na Tabela de Preços` })
        skipped.push({ name: titulo, reason: 'Sem preço → pendência financeira registrada (reprocessável)' }); continue
      }
      if ('erro' in preco) {
        await registrarPendencia({ processoId, tipoProcessoId, phaseKey, configItemId: r.configItemId, regraId: r.id, natureza: natPreco, motivo: 'SEM_PRECO_VALIDO', detalhe: `${titulo}: ${preco.erro}` })
        skipped.push({ name: titulo, reason: 'Preço ausente/conflitante → pendência registrada (reprocessável)' }); continue
      }

      // CÂMBIO obrigatório em moeda estrangeira: sem cotação, NÃO lança (evita valor sem
      // conversão). Registra pendência reprocessável (nunca lança 1:1, nunca descarta).
      const fx = await fxParaBRL(preco.moeda, fxCache)
      if (fx == null) {
        await registrarPendencia({ processoId, tipoProcessoId, phaseKey, configItemId: r.configItemId, regraId: r.id, natureza: natPreco, motivo: 'SEM_CAMBIO', detalhe: `${titulo}: Sem cotação de câmbio ${preco.moeda}→BRL` })
        skipped.push({ name: titulo, reason: `Sem câmbio ${preco.moeda}→BRL → pendência registrada (reprocessável)` }); continue
      }

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
              automaticKey: akey, targetTable: isRec ? 'Receita' : 'ObrigacaoEconomica', targetId: id, status: 'active', descricao: titulo.slice(0, 300),
              detalhes: { configItemId: r.configItemId, mestre: mestreNome, aplicacao: ap, natureza: isRec ? 'VENDA' : 'CUSTO', valor: preco.valor, moeda: preco.moeda, tabelaValorId: preco.tabelaValorId },
            },
          })
        }, { timeout: 30000, maxWait: 10000 })
        criadas++
        await resolverPendencia(processoId, phaseKey, r.id, natPreco) // fecha pendência, se havia
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          await resolverPendencia(processoId, phaseKey, r.id, natPreco)
          skipped.push({ name: titulo, reason: 'já lançado (idempotência)' }); continue
        }
        erros.push(`${titulo}: ${(e as Error)?.message ?? 'erro'}`)
      }
    }
  }
  return { criadas, skipped, erros }
}

// P4 — REPROCESSAMENTO: ao cadastrar o preço/config, reexecuta as automações das (processo,
// fase) com pendência ABERTA. executarFinanceirasNaFaseV2 é idempotente (automaticKey) e
// fecha a pendência ao lançar. Executar 2x NÃO duplica lançamento (transação + unique).
export async function reprocessarPendenciasFinanceiras(opts?: { processoId?: number; configItemId?: number }): Promise<{ reprocessados: number; resolvidos: number }> {
  const pend = await prisma.pendenciaFinanceira.findMany({
    where: { resolvida: false, ...(opts?.processoId ? { processoId: opts.processoId } : {}), ...(opts?.configItemId ? { configFinanceiraId: opts.configItemId } : {}) },
    select: { processoId: true, phaseKey: true },
  })
  const alvos = new Map<string, { processoId: number; phaseKey: string }>()
  for (const p of pend) alvos.set(`${p.processoId}::${p.phaseKey}`, { processoId: p.processoId, phaseKey: p.phaseKey })
  let resolvidos = 0
  for (const a of alvos.values()) {
    const antes = await prisma.pendenciaFinanceira.count({ where: { processoId: a.processoId, phaseKey: a.phaseKey, resolvida: false } })
    try { await executarFinanceirasNaFaseV2(a.processoId, a.phaseKey) } catch (e) { console.error('[reprocesso pendência]', e) }
    const depois = await prisma.pendenciaFinanceira.count({ where: { processoId: a.processoId, phaseKey: a.phaseKey, resolvida: false } })
    resolvidos += Math.max(0, antes - depois)
  }
  return { reprocessados: alvos.size, resolvidos }
}

// ============================================================================
// RECONCILE — convergência definitiva do FinanceRuleEngine.
//
// A única origem de lançamento é o motor. Reconciliar uma (processo, fase):
//   1) CRIA os que faltam (executarFinanceirasNaFaseV2 — idempotente).
//   2) REMOVE os órfãos: lançamentos que o motor criou (MotorArtefato ativo) mas
//      cuja regra/config deixou de existir/aplicar (automaticKey fora do conjunto
//      esperado atual). Remoção SEGURA: se o lançamento tiver dependência (ex.:
//      pagamento realizado com FK RESTRICT), a transação falha e ele é PRESERVADO.
// É idempotente: rodar N vezes converge para o conjunto correto e não duplica.
// ============================================================================
export async function reconciliarFinanceiroDaFase(
  processoId: number, phaseKey: string,
): Promise<{ criadas: number; removidas: number; bloqueadas: number; skipped: { name: string; reason: string }[]; erros: string[] }> {
  // 1) cria os que faltam
  const run = await executarFinanceirasNaFaseV2(processoId, phaseKey)

  const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { tipoProcessoMotorId: true } })
  const tipoProcessoId = proc?.tipoProcessoMotorId
  if (!tipoProcessoId) return { ...run, removidas: 0, bloqueadas: 0 }

  // 2) conjunto ESPERADO de chaves (regras financeiras ativas atuais da fase)
  const regras = await prisma.phaseAutomationRule.findMany({
    where: { kind: 'financial', tipoProcessoId, phaseKey, trigger: 'phase_entered', active: true, arquivado: false, configItemId: { not: null } },
  })
  const esperados = new Set<string>()
  for (const r of regras) {
    const ap = r.aplicacaoFinanceira
    if (!aplicacaoValida(ap)) continue
    const cfg = await prisma.produtoFinanceiro.findUnique({ where: { id: r.configItemId! }, select: { possuiCusto: true, possuiReceita: true } })
    if (!cfg || !aplicacaoPermitida(ap, cfg)) continue
    for (const natPreco of naturezasDaAplicacao(ap)) {
      const isRec = natPreco === NaturezaPreco.VENDA
      esperados.add(`${processoId}::${phaseKey}::automation::${r.id}::${isRec ? 'VENDA' : 'CUSTO'}`)
    }
  }

  // 3) remove artefatos ativos que não estão mais no conjunto esperado
  const ativos = await prisma.motorArtefato.findMany({
    where: { processoId, phaseKey, ruleKind: 'financial', ruleSource: 'automation', status: 'active' },
    select: { id: true, automaticKey: true, targetTable: true, targetId: true },
  })
  let removidas = 0, bloqueadas = 0
  for (const a of ativos) {
    if (esperados.has(a.automaticKey)) continue
    try {
      await prisma.$transaction(async (tx) => {
        if (a.targetId) {
          if (a.targetTable === 'Receita') await tx.receita.delete({ where: { id: a.targetId } })
          else if (a.targetTable === 'Custo') await tx.custo.delete({ where: { id: a.targetId } }) // legado histórico
          else if (a.targetTable === 'ObrigacaoEconomica') await removerObrigacaoOrfaTx(tx, a.targetId) // V3-native (guarda-se-paga)
        }
        await tx.motorArtefato.update({ where: { id: a.id }, data: { status: 'removed' } })
      }, { timeout: 30000, maxWait: 10000 })
      removidas++
    } catch {
      // dependência impede a remoção (ex.: pagamento realizado) → preserva o lançamento
      bloqueadas++
    }
  }
  return { ...run, removidas, bloqueadas }
}

/** Reconcilia os processos afetados por uma REGRA financeira (ex.: regra desativada/arquivada
 *  → remove os lançamentos órfãos que ela havia gerado). Idempotente, best-effort. */
export async function reconciliarPorRegra(ruleId: number): Promise<{ processos: number; criadas: number; removidas: number; bloqueadas: number }> {
  const arts = await prisma.motorArtefato.findMany({
    where: { ruleId, ruleKind: 'financial', status: 'active' },
    select: { processoId: true, phaseKey: true }, distinct: ['processoId', 'phaseKey'],
  })
  const procs = new Set<number>()
  let criadas = 0, removidas = 0, bloqueadas = 0
  for (const a of arts) {
    if (!a.phaseKey) continue
    procs.add(a.processoId)
    const r = await reconciliarFinanceiroDaFase(a.processoId, a.phaseKey)
    criadas += r.criadas; removidas += r.removidas; bloqueadas += r.bloqueadas
  }
  return { processos: procs.size, criadas, removidas, bloqueadas }
}

/** Reconcilia TODAS as fases em que o processo já teve lançamentos do motor. */
export async function reconciliarFinanceiroDoProcesso(processoId: number): Promise<{ fases: number; criadas: number; removidas: number; bloqueadas: number }> {
  const arts = await prisma.motorArtefato.findMany({
    where: { processoId, ruleKind: 'financial' }, select: { phaseKey: true }, distinct: ['phaseKey'],
  })
  const proc = await prisma.processo.findUnique({ where: { id: processoId }, select: { faseAtualKey: true } })
  const fases = new Set<string>(arts.map((a) => a.phaseKey).filter((p): p is string => !!p))
  if (proc?.faseAtualKey) fases.add(proc.faseAtualKey)
  let criadas = 0, removidas = 0, bloqueadas = 0
  for (const f of fases) {
    const r = await reconciliarFinanceiroDaFase(processoId, f)
    criadas += r.criadas; removidas += r.removidas; bloqueadas += r.bloqueadas
  }
  return { fases: fases.size, criadas, removidas, bloqueadas }
}
// ============================================================================
// HONORÁRIOS CONTRATUAIS POR REQUERENTE (RECEITA) — GENÉRICO, dirigido por dados.
//
// SEM tratamento por nacionalidade no código. A geração segue a arquitetura:
//   Evento Operacional → Automação → FinanceRuleEngine → ItemCatalogo →
//   ProdutoFinanceiro (do tipo de processo) → TabelaValor (modo POR_REQUERENTE)
//   → Financeiro do Processo.
//
// Regra comercial: total = valorBase + (nRequerentes - 1) × valorAdicional.
// Conta SÓ Pessoa marcada como requerente ('maior' | 'menor'; ambos = 1) na árvore.
// UM ÚNICO lançamento consolidado por processo (idempotente por chave). Valores
// vêm da Tabela de Preços do TIPO DE PROCESSO — nunca hardcoded, nunca por país.
// Recálculo in-place enquanto não houver parcela paga; se houver, PRESERVA.
// ============================================================================
export type ResultadoHonorario = {
  aplicavel: boolean
  motivo?: string
  n?: number
  total?: number
  moeda?: string
  acao?: 'criado' | 'atualizado' | 'inalterado' | 'removido' | 'bloqueado' | 'pendencia' | 'nenhum'
  receitaId?: number
}

export async function aplicarHonorariosPorRequerente(processoId: number): Promise<ResultadoHonorario> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { pais: true, arvoreId: true, tipoProcessoMotorId: true,
      tipoProcessoMotor: { select: { nationalityLabel: true, name: true } } },
  })
  if (!proc) return { aplicavel: false, motivo: 'processo não encontrado' }

  // GUARD ANTI-DUPLA-COBRANÇA (aditivo, GENÉRICO — sem condicional por país): se existe uma
  // automação financeira POR REQUERENTE (person_added) ATIVA para este tipo de processo, ela
  // é a dona da cobrança e itemiza por requerente. O honorário AGREGADO legado NÃO deve gerar
  // (evita agregado + por-requerente simultâneos). Aditivo e seguro: só DEIXA DE CRIAR o
  // agregado; NÃO remove/altera lançamentos históricos. Seleção pelos metadados oficiais da
  // PhaseAutomationRule (tipoProcessoId + trigger).
  if (proc.tipoProcessoMotorId) {
    const superseder = await prisma.phaseAutomationRule.findFirst({
      where: { kind: 'financial', trigger: 'person_added', active: true, arquivado: false, tipoProcessoId: proc.tipoProcessoMotorId },
      select: { id: true },
    })
    if (superseder) return { aplicavel: false, motivo: `honorário agregado legado desativado p/ este tipo de processo: automação por requerente #${superseder.id} é a fonte da cobrança` }
  }

  // Conta requerentes ATIVOS da árvore pela FONTE ÚNICA do recorte (vinculo-ativo).
  // A régua local anterior — `requerente in ('maior','menor')`, sem filtrar removidos —
  // ignorava todo requerente a partir do segundo (vincularRequerente grava 'sim' neles)
  // e ainda contava quem já havia saído. Medido no 513: régua local 0, canônica 1.
  const n = proc.arvoreId
    ? await prisma.pessoa.count({ where: requerentesAtivosDaArvore(proc.arvoreId) })
    : 0

  const akey = `${processoId}::honorario_por_requerente::VENDA`
  // Compat: artefato pode ter sido criado com a chave legada (cidadania_italiana).
  const akeyLegado = `${processoId}::honorario_cidadania_italiana::VENDA`
  const artefato = await prisma.motorArtefato.findFirst({ where: { automaticKey: { in: [akey, akeyLegado] } } })

  // SUPRESSÃO RASTREÁVEL — o operador cancelou o lançamento e registrou uma
  // supressão autorizada. A reconciliação NÃO recria enquanto ela estiver ativa
  // (quebra o ciclo cancela→recria). Revogar a supressão reabre a aplicação.
  if (artefatoEstaSuprimido(artefato)) {
    return { aplicavel: true, n, acao: 'nenhum', motivo: 'lançamento suprimido por decisão registrada — reconciliação não recria', receitaId: artefato?.targetId ?? undefined }
  }

  // helper: a receita tem pagamento/dependência que impede alteração destrutiva?
  const receitaBloqueada = async (receitaId: number): Promise<boolean> => {
    const pagas = await prisma.parcelaFinanceira.count({ where: { receitaId, status: { in: ['PAGA', 'RECEBIDA'] } } }).catch(() => 0)
    return pagas > 0
  }

  // Sem requerentes → não deve existir lançamento. Remove se ativo e sem pagamento.
  if (n < 1) {
    if (artefato?.status === 'active' && artefato.targetId) {
      if (await receitaBloqueada(artefato.targetId)) return { aplicavel: true, n: 0, acao: 'bloqueado', receitaId: artefato.targetId }
      try {
        await prisma.$transaction(async (tx) => {
          await tx.receita.delete({ where: { id: artefato.targetId! } })
          await tx.motorArtefato.update({ where: { id: artefato.id }, data: { status: 'removed' } })
        })
        return { aplicavel: true, n: 0, acao: 'removido' }
      } catch { return { aplicavel: true, n: 0, acao: 'bloqueado', receitaId: artefato.targetId } }
    }
    return { aplicavel: true, n: 0, acao: 'nenhum' }
  }

  // Preço OFICIAL — Tabela de Preços do TIPO DE PROCESSO (estratégia primeiro + adicional).
  // Cadeia: ProdutoFinanceiro(tipoProcessoId) → TabelaValor(estratégia PRIMEIRO_ADICIONAL).
  // Esta rota conta REQUERENTES: restringe à unidade REQUERENTE (ou legado sem unidade).
  // Aceita o código canônico novo (first_additional) e os legados (per_applicant/alias).
  const MODOS_REQUERENTE = MODOS_PRIMEIRO_ADICIONAL
  const UNIDADE_REQUERENTE = { OR: [{ unidade: { in: ['REQUERENTE', 'requerente'] } }, { unidade: null }] }
  let preco = proc.tipoProcessoMotorId
    ? await prisma.tabelaValor.findFirst({
        where: {
          modoCalculo: { in: MODOS_REQUERENTE }, natureza: NaturezaPreco.VENDA, arquivado: false,
          configuracaoFinanceiraItem: { tipoProcessoId: proc.tipoProcessoMotorId },
          ...UNIDADE_REQUERENTE,
        },
        orderBy: { prioridade: 'desc' },
      })
    : null
  // Fallback de compatibilidade: preço global sem vínculo de tipo (dados legados).
  if (!preco) {
    preco = await prisma.tabelaValor.findFirst({
      where: { modoCalculo: { in: MODOS_REQUERENTE }, natureza: NaturezaPreco.VENDA, arquivado: false, ...UNIDADE_REQUERENTE },
      orderBy: { prioridade: 'desc' },
    })
  }
  // Sem preço de honorário por requerente configurado p/ este tipo de processo:
  // a regra simplesmente não se aplica (não é erro — nem todo processo tem).
  if (!preco) return { aplicavel: false, n, motivo: 'sem honorário por requerente configurado para este tipo de processo' }
  if (preco.valorBase == null || preco.valorAdicional == null) {
    await registrarPendencia({ processoId, tipoProcessoId: proc.tipoProcessoMotorId ?? null, phaseKey: 'genealogia', configItemId: preco?.configuracaoFinanceiraItemId ?? null, regraId: 0, natureza: NaturezaPreco.VENDA, motivo: 'SEM_PRECO', detalhe: 'Honorários por requerente: Tabela de Preços sem valorBase/valorAdicional cadastrado' })
    return { aplicavel: true, n, acao: 'pendencia', motivo: 'sem preço base/adicional cadastrado (pendência registrada)' }
  }
  // ALGORITMO ÚNICO — mesma função de todos os fluxos (lib/financeiro/calculo-preco).
  // Nenhuma fórmula local: base+adicional vem da Tabela de Preços via calcularPreco.
  const base = Number(preco.valorBase)
  const adic = Number(preco.valorAdicional)
  const total = calcularPreco({ modoCalculo: preco.modoCalculo, valor: preco.valor == null ? base : Number(preco.valor), valorBase: base, valorAdicional: adic, quantidade: n }).total

  const config = preco.configuracaoFinanceiraItemId
    ? await prisma.produtoFinanceiro.findUnique({ where: { id: preco.configuracaoFinanceiraItemId }, select: { id: true, moedaPadrao: true } })
    : null
  const moeda = ((config?.moedaPadrao as Moeda) ?? Moeda.EUR)
  const fx = await fxParaBRL(moeda, new Map())
  if (fx == null) {
    await registrarPendencia({ processoId, tipoProcessoId: proc.tipoProcessoMotorId ?? null, phaseKey: 'genealogia', configItemId: config?.id ?? null, regraId: 0, natureza: NaturezaPreco.VENDA, motivo: 'SEM_CAMBIO', detalhe: `Honorários por requerente: sem cotação ${moeda}→BRL` })
    return { aplicavel: true, n, total, moeda, acao: 'pendencia', motivo: `sem câmbio ${moeda}→BRL (pendência registrada)` }
  }

  const nacionalidade = proc.tipoProcessoMotor?.nationalityLabel || proc.tipoProcessoMotor?.name || null
  const desc = nacionalidade ? `Honorários Contratuais — ${nacionalidade}` : 'Honorários Contratuais por Requerente'
  const contexto = { fonte: 'honorario_por_requerente', requerentes: n, incluidoNaBase: 1, adicionais: n - 1, valorBase: base, valorAdicional: adic, tabelaValorId: preco.id, evento: 'REQUERENTES_DO_PROCESSO_DEFINIDOS' } as Prisma.InputJsonValue
  const fz: FreezeExec = { tabelaValorId: preco.id, configId: config?.id ?? null, regraId: null, naturezaPreco: 'VENDA', phaseKey: 'genealogia', chaveIdempotencia: akey, contexto }

  // Já existe lançamento ativo → recálculo IN-PLACE (mesmo lançamento) ou BLOQUEIO se pago.
  if (artefato?.status === 'active' && artefato.targetId) {
    const rec = await prisma.receita.findUnique({ where: { id: artefato.targetId }, select: { id: true, valor: true, parcelas: { select: { id: true } } } })
    if (rec) {
      if (await receitaBloqueada(rec.id)) {
        await registrarPendencia({ processoId, tipoProcessoId: proc.tipoProcessoMotorId ?? null, phaseKey: 'genealogia', configItemId: config?.id ?? null, regraId: 0, natureza: NaturezaPreco.VENDA, motivo: 'LANCAMENTO_PAGO', detalhe: `Honorários com pagamento — recálculo para ${n} requerentes (€${total}) bloqueado; tratar por aditivo` })
        return { aplicavel: true, n, total, moeda, acao: 'bloqueado', receitaId: rec.id }
      }
      if (Number(rec.valor) === total) return { aplicavel: true, n, total, moeda, acao: 'inalterado', receitaId: rec.id }
      // ATUALIZA o MESMO lançamento (valor + parcela única + contexto) — sem duplicar.
      await prisma.$transaction(async (tx) => {
        await tx.receita.update({ where: { id: rec.id }, data: {
          valor: total, valorUnitario: base, quantidade: n, valorTotalCongelado: total,
          contextoAplicado: contexto, descricao: desc,
          eventos: { create: { tipo: 'EDICAO', descricao: `Recalculado: ${n} requerente(s) → €${total}`.slice(0, 500), valor: total, cambio: fx, valorBrl: Number((total * fx).toFixed(2)) } },
        } })
        // Base ÚNICA: a Receita é contrato (sem parcelas). Só re-emite a parcela quando
        // for LEGADO (receita antiga que já tinha parcelas direto). Novas receitas não
        // ganham parcela aqui — o parcelamento vive na Cobrança.
        if (rec.parcelas.length > 0) {
          await tx.parcelaFinanceira.deleteMany({ where: { receitaId: rec.id, cobrancaId: null } })
          await tx.parcelaFinanceira.create({ data: { receitaId: rec.id, numero: 1, vencimento: new Date(), valor: total, status: 'PENDENTE' } })
        }
      }, { timeout: 30000, maxWait: 10000 })
      return { aplicavel: true, n, total, moeda, acao: 'atualizado', receitaId: rec.id }
    }
    // artefato aponta p/ receita inexistente → recria abaixo
  }

  // CRIA um único lançamento consolidado + artefato (idempotente por akey).
  try {
    let receitaId = 0
    await prisma.$transaction(async (tx) => {
      receitaId = await criarReceita(tx, processoId, desc, total, moeda, fx, true, fz)
      await tx.motorArtefato.create({ data: {
        processoId, tipoProcessoId: proc.tipoProcessoMotorId ?? 0, phaseKey: 'genealogia', event: 'req_definidos',
        ruleKind: 'financial', ruleSource: 'honorario', ruleId: null, automaticKey: akey,
        targetTable: 'Receita', targetId: receitaId, status: 'active', descricao: desc.slice(0, 300),
        detalhes: { requerentes: n, valorBase: base, valorAdicional: adic, total, moeda, tabelaValorId: preco.id },
      } })
    }, { timeout: 30000, maxWait: 10000 })
    return { aplicavel: true, n, total, moeda, acao: 'criado', receitaId }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // corrida: outro processo criou o mesmo akey → idempotente, não duplica
      return { aplicavel: true, n, total, moeda, acao: 'inalterado' }
    }
    throw e
  }
}

// COMPATIBILIDADE: nome legado mantido como alias do genérico. Callers antigos
// (materializar-genealogia, supressao-motor) seguem funcionando sem alteração.
export const aplicarHonorariosCidadaniaItaliana = aplicarHonorariosPorRequerente

// ============================================================================
// INFRAESTRUTURA GENÉRICA — AUTOMAÇÃO FINANCEIRA POR REQUERENTE (evento person_added)
// ----------------------------------------------------------------------------
// Processa o evento REQUERENTE_ADICIONADO: para CADA PhaseAutomationRule financeira
// com trigger 'person_added' compatível (tipo de processo + fase atual), gera UM
// lançamento INDIVIDUAL para o requerente do evento, itemizado e vinculado.
//
// • Preço SEMPRE pelo RESOLVER OFICIAL (resolverPrecoPorConfigDB) — vigência,
//   conflito e ausência tratados lá; nunca findFirst.
// • Cálculo SEMPRE pelo FinanceRuleEngine (calcularPreco, via valorDoRequerente):
//   1º requerente = valorBase, adicional = valorAdicional. Sem fórmula paralela.
// • Idempotência POR REQUERENTE (MotorArtefato.automaticKey @unique + $transaction).
// • Genérico: nenhuma condicional por país/serviço. Dormant enquanto não houver
//   uma automação cadastrada (retrocompatível — não altera o fluxo agregado legado).
// ============================================================================
export interface EventoRequerentePayload {
  processoId: number
  pessoaId: number
  requerenteId?: number | null
  tipoProcessoId?: number | null
  phaseKey?: string | null
  nacionalidade?: string | null
  actorId?: number | null
  occurredAt?: string | null
}
export interface ResultadoAutomacaoRequerente {
  processoId: number
  pessoaId: number
  regrasAvaliadas: number
  criados: number
  pendencias: number
  ignorados: string[]
  detalhes: { ruleId: number; acao: string; receitaId?: number; classificacao?: string; valor?: number; motivo?: string }[]
}

export async function processarRequerenteAdicionado(evt: EventoRequerentePayload): Promise<ResultadoAutomacaoRequerente> {
  const res: ResultadoAutomacaoRequerente = { processoId: evt.processoId, pessoaId: evt.pessoaId, regrasAvaliadas: 0, criados: 0, pendencias: 0, ignorados: [], detalhes: [] }

  const proc = await prisma.processo.findUnique({
    where: { id: evt.processoId },
    select: { id: true, arvoreId: true, faseAtualKey: true, tipoProcessoMotorId: true,
      tipoProcessoMotor: { select: { nationalityLabel: true, name: true } } },
  })
  if (!proc || !proc.tipoProcessoMotorId) { res.ignorados.push('processo/tipo não encontrado'); return res }
  const tipoProcessoId = proc.tipoProcessoMotorId

  const pessoa = await prisma.pessoa.findUnique({
    where: { id: evt.pessoaId },
    select: { id: true, nome: true, sobrenome: true, requerente: true, arvoreId: true,
      requerentesVinculados: { select: { id: true }, take: 1 } },
  })
  if (!pessoa) { res.ignorados.push('pessoa não encontrada'); return res }
  // Disparo correto (§9): só age se a pessoa É requerente (defensivo contra reprocesso).
  if (!ehRequerente(pessoa.requerente)) { res.ignorados.push('pessoa não é requerente'); return res }

  const arvoreId = pessoa.arvoreId ?? proc.arvoreId
  if (!arvoreId) { res.ignorados.push('sem árvore'); return res }

  // Regras compatíveis — só relações/config, sem condicional por país/serviço.
  const regras = await prisma.phaseAutomationRule.findMany({
    where: {
      kind: 'financial', trigger: 'person_added', active: true, arquivado: false,
      tipoProcessoId, configItemId: { not: null },
      ...(proc.faseAtualKey ? { phaseKey: proc.faseAtualKey } : {}),
    },
  })
  res.regrasAvaliadas = regras.length
  if (regras.length === 0) { res.ignorados.push('nenhuma automação person_added ativa p/ esta fase'); return res }

  // Ordem DETERMINÍSTICA dos requerentes do processo (createdAt, id) — fonte única de flag.
  const reqArvore = await prisma.pessoa.findMany({
    where: { arvoreId, requerente: { in: [...REQUERENTE_VALORES] }, ...PESSOA_ATIVA },
    select: { id: true, createdAt: true },
  })
  const ordenados = ordenarRequerentes(reqArvore.map((p) => ({ pessoaId: p.id, createdAt: p.createdAt })))
  const cls = classificarRequerente(evt.pessoaId, ordenados)
  if (!cls) { res.ignorados.push('pessoa não está entre os requerentes do processo'); return res }

  const nomeCompleto = `${pessoa.nome}${pessoa.sobrenome ? ' ' + pessoa.sobrenome : ''}`.trim()
  const nac = proc.tipoProcessoMotor?.nationalityLabel || proc.tipoProcessoMotor?.name || null
  const billingReqId = pessoa.requerentesVinculados[0]?.id ?? evt.requerenteId ?? null
  const fxCache = new Map<string, number>()

  for (const r of regras) {
    const configId = r.configItemId!
    // RESOLVER OFICIAL — vigência/conflito/ausência. NUNCA findFirst.
    const preco = await resolverPrecoPorConfigDB(configId, { processoId: evt.processoId, tipoProcessoId: String(tipoProcessoId), natureza: NaturezaPreco.VENDA })
    if (!preco.ok) {
      await registrarPendencia({ processoId: evt.processoId, tipoProcessoId, phaseKey: r.phaseKey, configItemId: configId, regraId: r.id, natureza: NaturezaPreco.VENDA, motivo: preco.motivo, detalhe: `Honorário por requerente: ${preco.razao}` })
      res.pendencias++; res.detalhes.push({ ruleId: r.id, acao: 'pendencia', motivo: preco.razao }); continue
    }
    if (preco.conflito) { // §8 — duas tabelas vigentes: aborta, registra, não escolhe
      await registrarPendencia({ processoId: evt.processoId, tipoProcessoId, phaseKey: r.phaseKey, configItemId: configId, regraId: r.id, natureza: NaturezaPreco.VENDA, motivo: 'CONFLITO_PRECO', detalhe: preco.conflito.nota })
      res.pendencias++; res.detalhes.push({ ruleId: r.id, acao: 'conflito', motivo: preco.conflito.nota }); continue
    }
    // Valor individual via MOTOR (marginal): primeiro=valorBase, adicional=valorAdicional.
    const vi = valorDoRequerente(cls.posicao, { modoCalculo: preco.modoCalculo, valor: preco.valor, valorBase: preco.valorBase, valorAdicional: preco.valorAdicional })
    if (vi.total <= 0) { res.ignorados.push(`valor ${vi.total} inválido p/ requerente ${evt.pessoaId}`); continue }
    // A moeda do lançamento é a MOEDA PADRÃO da Config Financeira (define o item);
    // a linha de preço (TabelaValor.moeda) não é a autoridade da moeda aqui.
    const cfgMoeda = await prisma.produtoFinanceiro.findUnique({ where: { id: configId }, select: { moedaPadrao: true } })
    const moeda = cfgMoeda?.moedaPadrao ?? preco.moeda
    const fx = await fxParaBRL(moeda, fxCache)
    if (fx == null) {
      await registrarPendencia({ processoId: evt.processoId, tipoProcessoId, phaseKey: r.phaseKey, configItemId: configId, regraId: r.id, natureza: NaturezaPreco.VENDA, motivo: 'SEM_CAMBIO', detalhe: `Honorário por requerente: sem cotação ${moeda}→BRL` })
      res.pendencias++; res.detalhes.push({ ruleId: r.id, acao: 'pendencia', motivo: `sem câmbio ${moeda}` }); continue
    }

    // Idempotência POR REQUERENTE.
    //
    // O STATUS do artefato é parte da chave de decisão, não decoração. Um artefato
    // ENCERRADO ('removed') significa "este efeito já foi retirado porque a causa
    // sumiu" — e a mesma pessoa pode voltar. Enquanto este teste ignorava o status,
    // reinserir a pessoa (§12) não recriava a receita: o artefato morto respondia
    // "já existe" para sempre, e `automaticKey` é @unique, então nem o create
    // alternativo passava. Efeito perdido em silêncio.
    //
    // Com o status na conta: 'active' → nada a fazer; 'removed' → REAPROVEITA a
    // linha (mesma chave, nova receita). Não nasce um segundo artefato: a
    // proveniência do requerente continua sendo UMA linha.
    const akey = chaveIdempotenciaRequerente({ processoId: evt.processoId, configId, ruleId: r.id, pessoaId: evt.pessoaId })
    const artefatoExistente = await prisma.motorArtefato.findFirst({ where: { automaticKey: akey }, select: { id: true, targetId: true, status: true } })
    if (artefatoExistente?.status === 'active') {
      res.detalhes.push({ ruleId: r.id, acao: 'inalterado', receitaId: artefatoExistente.targetId ?? undefined, classificacao: cls.classificacao }); continue
    }

    const rotuloCls = cls.classificacao === 'primeiro' ? 'Primeiro requerente' : 'Requerente adicional'
    const descricao = ['Honorários', nac, rotuloCls, nomeCompleto].filter(Boolean).join(' — ')
    const contexto = {
      fonte: 'automacao_requerente', estrategia: estrategiaDoModo(preco.modoCalculo), unidade: 'REQUERENTE',
      classificacao: cls.classificacao, posicao: cls.posicao, valorBase: preco.valorBase, valorAdicional: preco.valorAdicional,
      valorRequerente: vi.total, tabelaValorId: preco.tabelaValorId, vigenteEm: (evt.occurredAt ?? new Date().toISOString()).slice(0, 10),
      evento: 'REQUERENTE_ADICIONADO', pessoaId: evt.pessoaId, ruleId: r.id, memoriaCalculo: vi.memoria,
    } as Prisma.InputJsonValue

    try {
      const receitaId = await prisma.$transaction(async (tx) => {
        const rid = await criarReceita(tx, evt.processoId, descricao, vi.total, moeda, fx, true, {
          tabelaValorId: preco.tabelaValorId, configId, regraId: r.id, naturezaPreco: 'VENDA',
          contexto, phaseKey: r.phaseKey, chaveIdempotencia: akey,
        })
        await tx.receita.update({ where: { id: rid }, data: {
          personId: evt.pessoaId,
          requerentes: { create: { idx: 0, nome: nomeCompleto.slice(0, 200) || 'Requerente', requerenteId: billingReqId } },
        } })
        const detalhesArtefato = { classificacao: cls.classificacao, posicao: cls.posicao, pessoaId: evt.pessoaId, tabelaValorId: preco.tabelaValorId } as Prisma.InputJsonValue
        if (artefatoExistente) {
          // Reinserção: a chave é a mesma pessoa, então a linha é a mesma.
          await tx.motorArtefato.update({ where: { id: artefatoExistente.id }, data: {
            targetTable: 'Receita', targetId: rid, status: 'active', descricao: descricao.slice(0, 300), detalhes: detalhesArtefato,
          } })
        } else {
          await tx.motorArtefato.create({ data: {
            processoId: evt.processoId, tipoProcessoId, phaseKey: r.phaseKey, event: 'entered',
            ruleKind: 'financial', ruleSource: 'automation', ruleId: r.id, automaticKey: akey,
            targetTable: 'Receita', targetId: rid, status: 'active', descricao: descricao.slice(0, 300),
            detalhes: detalhesArtefato,
          } })
        }
        return rid
      }, { timeout: 30000, maxWait: 10000 })
      // Espelha a Receita da automação no motor V3 (ObrigacaoEconomica) para
      // aparecer no Financeiro do processo (aba Receitas). Idempotente por origem
      // e best-effort — nunca interrompe a automação. Mesma escrita usada na Cobrança.
      const recEspelho = await prisma.receita.findUnique({ where: { id: receitaId }, select: { id: true, codigo: true, valor: true, moeda: true, processoId: true } })
      if (recEspelho) await espelharReceitaComoObrigacao({ id: recEspelho.id, codigo: recEspelho.codigo, valor: Number(recEspelho.valor), moeda: String(recEspelho.moeda), processoId: recEspelho.processoId }, { criadoPorId: null })
      await resolverPendencia(evt.processoId, r.phaseKey, r.id, NaturezaPreco.VENDA)
      res.criados++; res.detalhes.push({ ruleId: r.id, acao: 'criado', receitaId, classificacao: cls.classificacao, valor: vi.total })
    } catch (e) {
      // Corrida no MESMO requerente → automaticKey @unique dispara P2002: idempotente.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        res.detalhes.push({ ruleId: r.id, acao: 'inalterado', classificacao: cls.classificacao }); continue
      }
      throw e // erro transitório → propaga p/ o Outbox reprocessar (idempotente)
    }
  }
  return res
}
