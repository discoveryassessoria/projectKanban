// src/lib/cambio/servico-cambio.ts
// ============================================================================
// SERVIÇO DE DOMÍNIO do câmbio automático Confidence. UM único serviço usado tanto
// pelo JOB diário (cron) quanto pelo botão "Atualizar agora" (contingência) — nunca
// fluxos paralelos. Idempotente, com trava de concorrência (advisory lock), retries
// com backoff, timeout (no provider), persistência histórica com revisão auditável,
// espelho no campo legado (ativo/taxa) que o FinanceRuleEngine já consome, e
// reprocessamento das pendências financeiras SEM_CAMBIO após uma cotação EUR válida.
// NUNCA apaga histórico, nunca grava zero, nunca troca de fonte silenciosamente.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { PESSOA_ATIVA } from '@/src/lib/genealogia/vinculo-ativo'
import { Moeda } from '@prisma/client'
import { providerOficial, ORIGEM_AUTOMATICA, MODALIDADE_OFICIAL, FONTE_NOME, type MoedaEstrangeira, type CotacaoProviderResult } from '@/lib/cambio/confidence-provider'
import { reprocessarPendenciasFinanceiras, processarRequerenteAdicionado } from '@/src/lib/motor/executor'

const LOCK_KEY = 918273645 // chave fixa do advisory lock do câmbio
const MOEDAS: MoedaEstrangeira[] = ['EUR', 'USD']

export type EstadoIntegracao = 'ATUALIZADO' | 'SEM_NOVA_PUBLICACAO' | 'DESATUALIZADO' | 'INDISPONIVEL' | 'CONFIGURACAO_PENDENTE'

export interface ResultadoMoeda {
  moeda: MoedaEstrangeira
  status: EstadoIntegracao
  valor: number | null
  dataReferencia: string | null
  modalidade: string
  cotacaoId: number | null
  revisao: boolean
  semNovaPublicacao: boolean
  alertas: string[]
}
export interface ResumoAtualizacao {
  gatilho: string
  executadoEm: string
  bloqueadoPorConcorrencia: boolean
  moedas: ResultadoMoeda[]
  reprocessamento: { processos: number; receitasCriadas: number } | null
  alertas: string[]
}

const nowISO = () => new Date().toISOString()
const hoje = () => new Date().toISOString().slice(0, 10)
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** provider com retries + backoff (uma falha de EUR não impede USD — isolado por moeda). */
async function buscarComRetry(moeda: MoedaEstrangeira, tentativas = 3): Promise<CotacaoProviderResult> {
  const prov = providerOficial()
  let ultimo: CotacaoProviderResult | null = null
  for (let i = 0; i < tentativas; i++) {
    ultimo = await prov.buscar(moeda, nowISO())
    if (ultimo.status === 'OK' || ultimo.status === 'CONFIGURACAO_PENDENTE') return ultimo
    if (i < tentativas - 1) await dorme(400 * Math.pow(2, i)) // backoff 400/800ms
  }
  return ultimo!
}

/** Persiste uma cotação OK: idempotente + revisão + vigente + espelho legado. */
async function persistir(r: CotacaoProviderResult): Promise<{ cotacaoId: number; revisao: boolean; semNovaPublicacao: boolean }> {
  const de = r.moedaOrigem as unknown as Moeda
  const para = Moeda.BRL
  const dataRef = r.dataReferencia ? new Date(r.dataReferencia + 'T12:00:00Z') : null // meio-dia UTC: evita "voltar 1 dia" em BRT

  // idempotência: mesmo (moeda,destino,dataRef,modalidade,origem,payloadHash) → não duplica.
  const igual = await prisma.cotacaoCambio.findFirst({
    where: { moedaDe: de, moedaPara: para, dataReferencia: dataRef, modalidade: r.modalidade, origem: ORIGEM_AUTOMATICA, payloadHash: r.payloadHash },
    select: { id: true },
  })
  if (igual) {
    // já registrada hoje: garante que é a vigente (idempotente), sem criar duplicata.
    await marcarVigente(de, para, r.modalidade, igual.id)
    return { cotacaoId: igual.id, revisao: false, semNovaPublicacao: false }
  }

  // REVISÃO: mesma dataRef/modalidade/origem, hash diferente → conteúdo novo (não apaga o anterior).
  const anterior = await prisma.cotacaoCambio.findFirst({
    where: { moedaDe: de, moedaPara: para, dataReferencia: dataRef, modalidade: r.modalidade, origem: ORIGEM_AUTOMATICA },
    orderBy: { criadoEm: 'desc' }, select: { id: true, taxa: true },
  })
  const revisao = !!anterior

  // "sem nova publicação": a última vigente já é desta mesma dataRef (fonte não publicou hoje).
  const ultimaVigente = await prisma.cotacaoCambio.findFirst({
    where: { moedaDe: de, moedaPara: para, modalidade: r.modalidade, origem: ORIGEM_AUTOMATICA, vigente: true }, select: { dataReferencia: true },
  })
  const semNovaPublicacao = !!(ultimaVigente?.dataReferencia && dataRef && ultimaVigente.dataReferencia.getTime() === dataRef.getTime() && !revisao)

  const nova = await prisma.cotacaoCambio.create({
    data: {
      moedaDe: de, moedaPara: para, taxa: r.valor!, data: dataRef, fonte: (r.detalhe ? `${FONTE_NOME}: ${r.detalhe}` : `${FONTE_NOME} (auto)`).slice(0, 100),
      ativo: true, dataReferencia: dataRef, consultadoEm: new Date(r.consultadoEm), origem: ORIGEM_AUTOMATICA,
      modalidade: r.modalidade, statusIntegracao: 'ATUALIZADO', payloadHash: r.payloadHash, urlFonte: r.urlFonte,
      vigente: false, semNovaPublicacao, substituiId: anterior?.id ?? null,
    },
    select: { id: true },
  })
  await marcarVigente(de, para, r.modalidade, nova.id)
  return { cotacaoId: nova.id, revisao, semNovaPublicacao }
}

/** Marca `id` como vigente/ativo e as demais da mesma (moeda,destino) como não-vigentes/inativas
 *  — a fonte oficial vence; NÃO apaga nada (só alterna flags). O motor lê ativo=true. */
async function marcarVigente(de: Moeda, para: Moeda, modalidade: string, id: number): Promise<void> {
  await prisma.$transaction([
    prisma.cotacaoCambio.updateMany({ where: { moedaDe: de, moedaPara: para, id: { not: id } }, data: { vigente: false, ativo: false } }),
    prisma.cotacaoCambio.update({ where: { id }, data: { vigente: true, ativo: true, statusIntegracao: 'ATUALIZADO', modalidade } }),
  ])
}

/** Reprocessa pendências SEM_CAMBIO após uma cotação EUR válida (mecanismos oficiais, idempotente). */
async function reprocessarSemCambio(): Promise<{ processos: number; receitasCriadas: number }> {
  // 1) caminho por fase (executarFinanceirasNaFaseV2) — idempotente (MotorArtefato).
  await reprocessarPendenciasFinanceiras({}).catch(() => {})
  // 2) caminho POR REQUERENTE (person_added): processos c/ pendência SEM_CAMBIO aberta + regra ativa.
  const pend = await prisma.pendenciaFinanceira.findMany({ where: { motivo: 'SEM_CAMBIO', resolvida: false }, select: { processoId: true } })
  const procIds = [...new Set(pend.map((p) => p.processoId))]
  let receitasCriadas = 0
  for (const pid of procIds) {
    const proc = await prisma.processo.findUnique({ where: { id: pid }, select: { tipoProcessoMotorId: true, arvoreId: true, faseAtualKey: true } })
    if (!proc?.tipoProcessoMotorId || !proc.arvoreId) continue
    const rule = await prisma.phaseAutomationRule.findFirst({ where: { kind: 'financial', trigger: 'person_added', active: true, arquivado: false, tipoProcessoId: proc.tipoProcessoMotorId, ...(proc.faseAtualKey ? { phaseKey: proc.faseAtualKey } : {}) }, select: { id: true } })
    if (!rule) continue
    const reqs = await prisma.pessoa.findMany({ where: { arvoreId: proc.arvoreId, requerente: { in: ['sim', 'maior', 'menor'] }, ...PESSOA_ATIVA }, select: { id: true } })
    for (const rq of reqs) { const res = await processarRequerenteAdicionado({ processoId: pid, pessoaId: rq.id }); receitasCriadas += res.criados }
  }
  return { processos: procIds.length, receitasCriadas }
}

/**
 * Entrada ÚNICA (cron + "Atualizar agora"). Atualiza EUR e USD (independentes), persiste
 * histórico idempotente, e reprocessa SEM_CAMBIO se houver EUR válido novo.
 */
export async function atualizarCotacoesConfidence(opts?: { gatilho?: string }): Promise<ResumoAtualizacao> {
  const gatilho = opts?.gatilho ?? 'cron'
  const resumo: ResumoAtualizacao = { gatilho, executadoEm: nowISO(), bloqueadoPorConcorrencia: false, moedas: [], reprocessamento: null, alertas: [] }

  // TRAVA DE CONCORRÊNCIA (advisory lock): impede execução simultânea (cron + botão).
  const lock: any = await prisma.$queryRawUnsafe(`SELECT pg_try_advisory_lock(${LOCK_KEY}) as ok`)
  if (!lock?.[0]?.ok) { resumo.bloqueadoPorConcorrencia = true; resumo.alertas.push('execução simultânea evitada (lock)'); return resumo }

  try {
    let euroValido = false
    for (const moeda of MOEDAS) {
      const alertas: string[] = []
      let out: ResultadoMoeda = { moeda, status: 'INDISPONIVEL', valor: null, dataReferencia: null, modalidade: MODALIDADE_OFICIAL, cotacaoId: null, revisao: false, semNovaPublicacao: false, alertas }
      try {
        const r = await buscarComRetry(moeda)
        if (r.status === 'CONFIGURACAO_PENDENTE') {
          out = { ...out, status: 'CONFIGURACAO_PENDENTE' }
          alertas.push(r.detalhe ?? 'provider CONFIGURACAO_PENDENTE')
        } else if (r.status === 'OK' && r.valor != null) {
          const pers = await persistir(r)
          out = { ...out, status: pers.semNovaPublicacao ? 'SEM_NOVA_PUBLICACAO' : 'ATUALIZADO', valor: r.valor, dataReferencia: r.dataReferencia, modalidade: r.modalidade, cotacaoId: pers.cotacaoId, revisao: pers.revisao, semNovaPublicacao: pers.semNovaPublicacao }
          if (moeda === 'EUR') euroValido = true
          if (pers.revisao) alertas.push('revisão de cotação para a mesma data (auditável)')
        } else {
          out = { ...out, status: 'INDISPONIVEL' }
          alertas.push(`fonte ${r.status}: ${r.detalhe ?? ''}`.trim())
        }
      } catch (e) {
        alertas.push('falha: ' + (e instanceof Error ? e.message : String(e)).slice(0, 120))
      }
      if (out.status === 'INDISPONIVEL' || out.status === 'CONFIGURACAO_PENDENTE') resumo.alertas.push(`${moeda}: ${out.status}`)
      resumo.moedas.push(out)
    }

    // Após EUR válido → reprocessa pendências SEM_CAMBIO (idempotente). USD não gera lançamento sozinho.
    if (euroValido) {
      try { resumo.reprocessamento = await reprocessarSemCambio() }
      catch (e) { resumo.alertas.push('reprocessamento SEM_CAMBIO falhou: ' + (e instanceof Error ? e.message : String(e)).slice(0, 120)) }
    }
  } finally {
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {})
  }
  return resumo
}

/** Snapshot para a Home e a tela admin — LÊ SÓ O BANCO (nunca consulta a Confidence). */
export async function snapshotCotacoes(): Promise<{
  moedas: { moeda: MoedaEstrangeira; valor: number | null; dataReferencia: string | null; consultadoEm: string | null; modalidade: string | null; origem: string | null; estado: EstadoIntegracao; variacaoAbs: number | null; variacaoPct: number | null }[]
  fonte: string
}> {
  const out: any[] = []
  for (const moeda of MOEDAS) {
    const de = moeda as unknown as Moeda
    const [vig, ant] = await prisma.cotacaoCambio.findMany({
      where: { moedaDe: de, moedaPara: Moeda.BRL, origem: ORIGEM_AUTOMATICA }, orderBy: [{ vigente: 'desc' }, { criadoEm: 'desc' }], take: 2,
      select: { taxa: true, dataReferencia: true, consultadoEm: true, modalidade: true, origem: true, semNovaPublicacao: true },
    }) as any[]
    if (!vig) {
      // fallback: qualquer cotação (inclui MANUAL legada) só p/ não esconder defasagem
      const qualquer = await prisma.cotacaoCambio.findFirst({ where: { moedaDe: de, moedaPara: Moeda.BRL, ativo: true }, orderBy: { criadoEm: 'desc' }, select: { taxa: true, data: true, fonte: true } })
      out.push({ moeda, valor: qualquer ? Number(qualquer.taxa) : null, dataReferencia: qualquer?.data ? new Date(qualquer.data).toISOString().slice(0, 10) : null, consultadoEm: null, modalidade: null, origem: qualquer ? 'MANUAL' : null, estado: qualquer ? 'DESATUALIZADO' : 'INDISPONIVEL', variacaoAbs: null, variacaoPct: null })
      continue
    }
    const valor = Number(vig.taxa)
    const valorAnt = ant ? Number(ant.taxa) : null
    const variacaoAbs = valorAnt != null ? Number((valor - valorAnt).toFixed(4)) : null
    const variacaoPct = valorAnt ? Number((((valor - valorAnt) / valorAnt) * 100).toFixed(2)) : null
    // estado por defasagem da dataReferencia
    const ref = vig.dataReferencia ? new Date(vig.dataReferencia).toISOString().slice(0, 10) : null
    const diasDefasagem = ref ? Math.floor((Date.parse(hoje()) - Date.parse(ref)) / 86400000) : 999
    const estado: EstadoIntegracao = vig.semNovaPublicacao ? 'SEM_NOVA_PUBLICACAO' : diasDefasagem >= 3 ? 'DESATUALIZADO' : 'ATUALIZADO'
    out.push({ moeda, valor, dataReferencia: ref, consultadoEm: vig.consultadoEm ? new Date(vig.consultadoEm).toISOString() : null, modalidade: vig.modalidade, origem: vig.origem, estado, variacaoAbs, variacaoPct })
  }
  return { moedas: out, fonte: FONTE_NOME }
}
