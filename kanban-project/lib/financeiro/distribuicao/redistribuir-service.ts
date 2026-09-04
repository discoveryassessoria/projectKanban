// lib/financeiro/distribuicao/redistribuir-service.ts
// ============================================================================
// Serviço da tela "Editar Distribuição Financeira" (#85). Redistribui o TOTAL de
// uma Receita consolidada (grupo de Receitas irmãs, uma por participante) entre os
// participantes, mantendo a SOMA (total base) INVARIANTE. Aditivo e seguro:
//   - trabalha em moeda-base (Receita.valor / ObrigacaoEconomica.valorContratado);
//   - NUNCA reduz um participante abaixo do que ele já RECEBEU (replay do Ledger);
//   - Ledger append-only: cada mudança posta um AJUSTE balanceado (Δ) + reprojeta;
//   - DistribuicaoEconomica em NOVA versão (nunca muta); auditoria por EventoFinanceiro.
// Não apaga Receita/pagamento. Ver carregarReceitaConsolidada + lancAjusteContrato.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { carregarReceitaConsolidada } from '@/lib/financeiro/leitura/receita-detalhe'
import { registrarLancamento, criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { lancAjusteContrato } from '@/lib/financeiro/ledger/lancamentos'
import { dedupPorPessoa, registrarPendenciaReconciliacao } from '@/lib/financeiro/identidade/dedup-pessoa'
import { taxaDe } from '@/lib/financeiro/dominio/cambio'
import { aReceber, type Natureza } from '@/lib/financeiro/dominio/obrigacao-economica'
import { gerarCodigoReceita } from '@/lib/financeiro/codigos'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const idadeDe = (dn?: Date | null): number | null => {
  if (!dn) return null
  const hoje = new Date(); let a = hoje.getFullYear() - dn.getFullYear()
  const m = hoje.getMonth() - dn.getMonth(); if (m < 0 || (m === 0 && hoje.getDate() < dn.getDate())) a--
  return a
}

export interface ParticipanteEditavel {
  obrigacaoId: number
  receitaId: number | null
  requerenteId: number | null
  nome: string
  papel: string
  valorBase: number
  valorBrl: number
  pct: number
  recebidoBase: number
  recebidoBrl: number
  saldoBase: number
  valorHerdadoBase: number
  temCobranca: boolean
  temPagamento: boolean
  podeRemover: boolean
  isMenor: boolean
  idade: number | null
  status: string
}
export interface DisponivelProcesso { requerenteId: number; nome: string; idade: number | null; isMenor: boolean; vinculo: string }
export interface DistribuicaoEditavel {
  ref: string
  obrigacaoIdRef: number
  codigo: string | null
  descricao: string | null
  moedaBase: string
  totalBase: number
  totalBrl: number
  cotacao: number | null
  metodoAtual: string
  processoId: number | null
  participantes: ParticipanteEditavel[]
  disponiveis: DisponivelProcesso[]
}

/** Estado editável da distribuição (reusa a consolidada p/ câmbio idêntico à UI). */
export async function carregarDistribuicaoEditavel(ref: string): Promise<DistribuicaoEditavel | null> {
  const cons = await carregarReceitaConsolidada(ref)
  if (!cons) return null
  const obrIds = cons.participantes.map((p) => p.obrigacaoId)

  const [obrs, projs] = await Promise.all([
    prisma.obrigacaoEconomica.findMany({ where: { id: { in: obrIds } }, select: { id: true, origemTipo: true, origemId: true, valorContratado: true, moedaContratual: true, processoId: true } }),
    prisma.saldoProjecao.findMany({ where: { obrigacaoId: { in: obrIds } }, select: { obrigacaoId: true, recebidoBruto: true } }),
  ])
  const obrMap = new Map(obrs.map((o) => [o.id, o]))
  const recebidoMap = new Map(projs.map((p) => [p.obrigacaoId, Number(p.recebidoBruto)]))
  const processoId = obrs.find((o) => o.processoId != null)?.processoId ?? null

  const receitaIds = obrs.filter((o) => o.origemTipo === 'Receita' && o.origemId != null).map((o) => o.origemId as number)
  const receitas = receitaIds.length ? await prisma.receita.findMany({
    where: { id: { in: receitaIds } },
    select: { id: true, contextoAplicado: true, requerentes: { orderBy: { idx: 'asc' }, select: { requerenteId: true, nome: true } }, cobrancas: { select: { id: true } } },
  }) : []
  const recByObr = new Map<number, (typeof receitas)[number]>()
  for (const o of obrs) { if (o.origemId != null) { const r = receitas.find((x) => x.id === o.origemId); if (r) recByObr.set(o.id, r) } }

  const reqIds = [...new Set(receitas.flatMap((r) => r.requerentes.map((x) => x.requerenteId).filter((v): v is number => v != null)))]
  const requerentes = reqIds.length ? await prisma.requerente.findMany({ where: { id: { in: reqIds } }, select: { id: true, nome: true, dataNascimento: true } }) : []
  const reqMap = new Map(requerentes.map((r) => [r.id, r]))

  const totalBase = cent(obrs.reduce((s, o) => s + Number(o.valorContratado), 0))
  const totalBrl = cons.valorContratadoBrl
  // taxa efetiva com PRECISÃO TOTAL (nunca arredondar a taxa — ver taxaDe). O
  // total em BRL fonte-única é `totalBrl`; `cotacao` é derivada só p/ exibir/semear.
  const cotacao = totalBase > 0 ? taxaDe(totalBrl, totalBase) : null

  const participantes: ParticipanteEditavel[] = cons.participantes.map((p) => {
    const o = obrMap.get(p.obrigacaoId)
    const rec = recByObr.get(p.obrigacaoId)
    const reqRow = rec?.requerentes?.[0] ?? null
    const requerenteId = reqRow?.requerenteId ?? p.pessoaId ?? null
    const req = requerenteId != null ? reqMap.get(requerenteId) : null
    const idade = idadeDe(req?.dataNascimento ?? null)
    const isMenor = idade != null && idade < 18
    const recebidoBase = recebidoMap.get(p.obrigacaoId) ?? 0
    const valorBase = o ? Number(o.valorContratado) : p.valorBase
    const temCobranca = (rec?.cobrancas?.length ?? 0) > 0
    const temPagamento = recebidoBase > 0.005 || p.recebidoBrl > 0.005 || p.parcelasRecebidas > 0
    // ctx herdado (primeiro→valorBase / adicional→valorAdicional)
    let valorHerdadoBase = valorBase
    const ctx = rec?.contextoAplicado
    if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
      const c = ctx as Record<string, unknown>
      const cls = String(c.classificacao ?? '').toLowerCase()
      const vb = Number(c.valorBase ?? NaN), va = Number(c.valorAdicional ?? NaN)
      if (cls.includes('primeir') || cls.includes('princip')) { if (!Number.isNaN(vb)) valorHerdadoBase = cent(vb) }
      else if (!Number.isNaN(va)) valorHerdadoBase = cent(va)
    }
    return {
      obrigacaoId: p.obrigacaoId, receitaId: rec?.id ?? (o?.origemTipo === 'Receita' ? o?.origemId ?? null : null),
      requerenteId, nome: p.nome, papel: p.papel, valorBase: cent(valorBase), valorBrl: p.valorContratadoBrl,
      pct: p.participacaoPct, recebidoBase: cent(recebidoBase), recebidoBrl: p.recebidoBrl, saldoBase: cent(valorBase - recebidoBase),
      valorHerdadoBase, temCobranca, temPagamento, podeRemover: !temPagamento && !isMenor, isMenor, idade, status: p.status,
    }
  })

  // participantes disponíveis do processo (requerentes fora do grupo)
  let disponiveis: DisponivelProcesso[] = []
  if (processoId != null) {
    const jaTem = new Set(participantes.map((p) => p.requerenteId).filter((v): v is number => v != null))
    const pr = await prisma.processoRequerente.findMany({ where: { processoId }, select: { requerente: { select: { id: true, nome: true, dataNascimento: true, personId: true } } } }).catch(() => [])
    const reqs = pr.map((x) => x.requerente).filter((r): r is NonNullable<typeof r> => !!r)
    // Pessoa já participante (identidade canônica) não reaparece como disponível sob outro requerente.
    const jaTemPerson = new Set(reqs.filter((r) => jaTem.has(r.id) && r.personId != null).map((r) => r.personId as number))
    const candidatos = reqs.filter((r) => !jaTem.has(r.id) && !(r.personId != null && jaTemPerson.has(r.personId)))
    // dedup VISUAL por personId (sem personId → individual); duplicidade real vira pendência (sem merge).
    const { itens, duplicatas } = dedupPorPessoa(candidatos.map((r) => ({ id: r.id, personId: r.personId, nome: r.nome, dataNascimento: r.dataNascimento })))
    registrarPendenciaReconciliacao(`redistribuir:processo:${processoId}`, duplicatas)
    disponiveis = itens.map((r) => {
      const idade = idadeDe(r.dataNascimento); return { requerenteId: r.id, nome: r.nome, idade, isMenor: idade != null && idade < 18, vinculo: 'Requerente' }
    })
  }

  return {
    ref, obrigacaoIdRef: cons.obrigacaoId, codigo: cons.codigo, descricao: cons.descricao, moedaBase: cons.moedaBase,
    totalBase, totalBrl, cotacao, metodoAtual: cons.metodoDistribuicao, processoId, participantes, disponiveis,
  }
}

// ── Aplicar redistribuição ──────────────────────────────────────────────────
export interface RedistribuirParticipante { obrigacaoId?: number | null; requerenteId?: number | null; incluido: boolean; valorBase: number }
export interface RedistribuirInput {
  ref: string
  metodo?: string
  estrategia?: 'ATUALIZAR_ABERTAS' | 'REGERAR_NAO_PAGAS' | 'AJUSTE_COMPENSATORIO'
  participantes: RedistribuirParticipante[]
  motivo?: string | null
  criadoPorId?: number | null
}
export interface RedistribuirResultado {
  ok: boolean
  erros: string[]
  totalBase: number
  membrosAfetados: number
  adicionados: number
  removidos: number
}

export async function redistribuir(input: RedistribuirInput): Promise<RedistribuirResultado> {
  const vazio: RedistribuirResultado = { ok: false, erros: [], totalBase: 0, membrosAfetados: 0, adicionados: 0, removidos: 0 }
  const estado = await carregarDistribuicaoEditavel(input.ref)
  if (!estado) return { ...vazio, erros: ['Distribuição não encontrada.'] }
  const totalBase = estado.totalBase
  const moeda = estado.moedaBase
  const lote = `redistrib:${estado.obrigacaoIdRef}:${Date.now()}`
  const criadoPorId = input.criadoPorId ?? null
  const metodo = input.metodo ?? 'PERSONALIZADA'

  // moeda-base homogênea (senão a soma não faz sentido econômico).
  // BUG REAL: o ternário anterior devolvia `moeda` nos dois ramos — a checagem
  // nunca disparava, não importa o que os participantes tivessem. A moeda de
  // cada um vem de `ObrigacaoEconomica.moedaContratual`, não de `estado.moedaBase`
  // (que é só a moeda do grupo já consolidado, sempre uma).
  const obrsDoGrupo = await prisma.obrigacaoEconomica.findMany({
    where: { id: { in: estado.participantes.map((p) => p.obrigacaoId) } },
    select: { moedaContratual: true },
  })
  const moedasDistintas = new Set(obrsDoGrupo.map((o) => o.moedaContratual))
  if (moedasDistintas.size > 1) return { ...vazio, erros: ['Grupo com moedas-base distintas — redistribuição indisponível.'] }

  const curByObr = new Map(estado.participantes.map((p) => [p.obrigacaoId, p]))

  // separar entradas: existentes (têm obrigacaoId) vs adições (requerenteId sem obrigacaoId)
  const existentes = input.participantes.filter((p) => p.obrigacaoId != null)
  const adicoes = input.participantes.filter((p) => p.obrigacaoId == null && p.requerenteId != null && p.incluido && cent(p.valorBase) > 0)

  // validação prévia de soma (existentes incluídos + adições) == totalBase
  const somaExist = existentes.reduce((s, p) => s + (p.incluido ? cent(p.valorBase) : 0), 0)
  const somaAdd = adicoes.reduce((s, p) => s + cent(p.valorBase), 0)
  if (Math.abs(cent(somaExist + somaAdd) - totalBase) > 0.01) {
    return { ...vazio, totalBase, erros: [`A soma da distribuição (${cent(somaExist + somaAdd)}) deve ser igual ao total da Receita (${totalBase}).`] }
  }
  // guarda: nenhum existente abaixo do já recebido
  for (const p of existentes) {
    const cur = curByObr.get(Number(p.obrigacaoId)); if (!cur) return { ...vazio, totalBase, erros: [`Participante ${p.obrigacaoId} não pertence ao grupo.`] }
    const alvo = p.incluido ? cent(p.valorBase) : 0
    if (alvo < cur.recebidoBase - 0.005) return { ...vazio, totalBase, erros: [`${cur.nome}: novo valor (${alvo}) não pode ser menor que o já recebido (${cur.recebidoBase}).`] }
    if (!p.incluido && cur.temPagamento) return { ...vazio, totalBase, erros: [`${cur.nome} não pode ser removido: possui pagamento.`] }
    if (!p.incluido && cur.isMenor) return { ...vazio, totalBase, erros: [`${cur.nome} é menor de idade e não pode ser removido.`] }
  }

  // representante p/ herdar config/regra/fase/câmbio nas adições
  const repObr = await prisma.obrigacaoEconomica.findUnique({ where: { id: estado.obrigacaoIdRef }, select: { origemId: true, origemTipo: true, processoId: true, moedaContratual: true, regraFinanceiraId: true, natureza: true } })
  const repRec = repObr?.origemTipo === 'Receita' && repObr.origemId != null
    ? await prisma.receita.findUnique({ where: { id: repObr.origemId }, select: { moeda: true, fxEstimado: true, fxRule: true, fxFixo: true, fxData: true, valorBrlFixo: true, configFinanceiraId: true, regraFinanceiraId: true, phaseKey: true, phaseCycle: true, categoria: true, naturezaPreco: true, tipoServicoId: true } })
    : null

  // 1) criar as ADIÇÕES (fora da tx principal — criarObrigacaoEconomicaComLedger é transacional).
  //    Nascem já no valor-alvo (>0), então não precisam de ajuste depois.
  const novos: { obrigacaoId: number; requerenteId: number; valor: number }[] = []
  for (const a of adicoes) {
    const req = await prisma.requerente.findUnique({ where: { id: Number(a.requerenteId) }, select: { nome: true } })
    const codigo = await gerarCodigoReceita()
    const novaRec = await prisma.receita.create({ data: {
      codigo, processoId: repObr?.processoId ?? estado.processoId ?? 0,
      categoria: (repRec?.categoria as never) ?? undefined, descricao: `${estado.descricao ?? 'Receita'} — Requerente adicional — ${req?.nome ?? ''}`.slice(0, 300),
      moeda: (repRec?.moeda as never) ?? (moeda as never), valor: cent(a.valorBase), valorUnitario: cent(a.valorBase), quantidade: 1, valorTotalCongelado: cent(a.valorBase),
      fxEstimado: Number(repRec?.fxEstimado ?? 1), fxRule: (repRec?.fxRule as never) ?? undefined, fxFixo: repRec?.fxFixo ?? undefined, fxData: repRec?.fxData ?? undefined, valorBrlFixo: repRec?.valorBrlFixo ?? undefined,
      nParcelas: 1, data1: new Date(), periodicidade: 'Mensal', status: 'ATIVA' as never, origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA', naturezaPreco: (repRec?.naturezaPreco as never) ?? undefined,
      configFinanceiraId: repRec?.configFinanceiraId ?? null, regraFinanceiraId: repRec?.regraFinanceiraId ?? null, phaseKey: repRec?.phaseKey ?? null, phaseCycle: repRec?.phaseCycle ?? null, tipoServicoId: repRec?.tipoServicoId ?? undefined,
      requerentes: { create: { idx: 0, nome: req?.nome ?? 'Participante', requerenteId: Number(a.requerenteId) } },
    } })
    const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
      natureza: 'RECEITA', valorContratado: cent(a.valorBase), moedaContratual: String(repRec?.moeda ?? moeda), codigoOperacional: codigo,
      processoId: repObr?.processoId ?? estado.processoId ?? null, regraFinanceiraId: repRec?.regraFinanceiraId ?? null,
      origemTipo: 'Receita', origemId: novaRec.id, criadoPorId,
    })
    novos.push({ obrigacaoId, requerenteId: Number(a.requerenteId), valor: cent(a.valorBase) })
    await prisma.eventoFinanceiro.create({ data: { receitaId: novaRec.id, tipo: 'EDICAO', descricao: `Participante adicionado à distribuição (${req?.nome ?? ''}) — ${cent(a.valorBase)}` } }).catch(() => {})
  }

  // 2) AJUSTAR os existentes (transação atômica única)
  //
  // RACE REAL: duas chamadas concorrentes de `redistribuir()` pro MESMO grupo
  // liam o `estado` (pré-transação) uma vez cada, e o `delta` era calculado
  // contra esse valor PARADO — nunca contra o que a outra chamada já tivesse
  // commitado. `version` existe no schema exatamente pra isto ("optimistic
  // locking (aggregate)"), mas só era incrementado, nunca CONFERIDO: a segunda
  // chamada aplicava um delta calculado sobre uma base que já não valia mais,
  // e o Ledger ficava com lançamentos que não batem com `valorContratado` final.
  // Agora o UPDATE só aplica se a versão ainda for a que foi lida — perdeu a
  // corrida, a transação inteira recua com um erro claro, em vez de gravar
  // sobre um estado que já mudou.
  let membrosAfetados = 0, removidos = 0
  const erroConcorrencia: string[] = []
  await prisma.$transaction(async (tx) => {
    for (const p of existentes) {
      const cur = curByObr.get(Number(p.obrigacaoId)); if (!cur) continue
      const alvo = p.incluido ? cent(p.valorBase) : 0
      const delta = cent(alvo - cur.valorBase)
      if (Math.abs(delta) < 0.005) continue
      const obr = await tx.obrigacaoEconomica.findUnique({ where: { id: cur.obrigacaoId }, include: { ledger: true } })
      if (!obr || !obr.ledger) continue
      if (Number(obr.valorContratado) !== cur.valorBase) {
        erroConcorrencia.push(`${cur.nome}: a distribuição mudou desde que a tela foi carregada — recarregue e tente de novo.`)
        throw new Error('REDISTRIBUIR_CONCORRENCIA')
      }

      if (cur.receitaId != null) {
        await tx.receita.update({ where: { id: cur.receitaId }, data: { valor: alvo, valorUnitario: alvo, valorTotalCongelado: alvo } }).catch(() => {})
      }
      const aplicado = await tx.obrigacaoEconomica.updateMany({
        where: { id: cur.obrigacaoId, version: obr.version },
        data: { valorContratado: alvo, version: { increment: 1 } },
      })
      if (aplicado.count === 0) {
        erroConcorrencia.push(`${cur.nome}: a distribuição mudou desde que a tela foi carregada — recarregue e tente de novo.`)
        throw new Error('REDISTRIBUIR_CONCORRENCIA')
      }

      const oc = await tx.ocorrenciaFinanceira.create({ data: {
        obrigacaoId: cur.obrigacaoId, tipo: 'AJUSTE', valor: Math.abs(delta), moeda: moeda as never, data: new Date(),
        status: 'PROCESSADA', observacao: `Redistribuição (${metodo})${input.motivo ? ' — ' + input.motivo : ''}`.slice(0, 300),
        idempotencyKey: `${lote}:${cur.obrigacaoId}`, correlacaoId: lote.slice(0, 60), criadoPorId,
      } })
      await registrarLancamento(tx, {
        obrigacaoId: cur.obrigacaoId, ledgerId: obr.ledger.id, transacaoId: `${lote}:${cur.obrigacaoId}`,
        lancamento: lancAjusteContrato(delta, aReceber((obr.natureza as Natureza) ?? 'RECEITA')), ocorrenciaId: oc.id, moeda, criadoPorId,
      })

      // nova versão da DistribuicaoEconomica (single-participant desta obrigação)
      const ultima = await tx.distribuicaoEconomica.aggregate({ where: { obrigacaoId: cur.obrigacaoId }, _max: { versao: true } })
      const dist = await tx.distribuicaoEconomica.create({ data: { obrigacaoId: cur.obrigacaoId, modo: 'PERSONALIZADA', versao: (ultima._max.versao ?? 0) + 1 } })
      await tx.participacaoEconomica.create({ data: { distribuicaoId: dist.id, pessoaId: cur.requerenteId ?? 0, incluido: p.incluido, percentual: totalBase > 0 ? cent((alvo / totalBase) * 100) : 0, valor: alvo, ordem: 0 } })

      if (cur.receitaId != null) {
        await tx.eventoFinanceiro.create({ data: { receitaId: cur.receitaId, tipo: 'EDICAO', descricao: `Distribuição alterada: ${cur.nome} ${cur.valorBase} → ${alvo} (${metodo})`.slice(0, 480) } }).catch(() => {})
      }
      membrosAfetados++
      if (!p.incluido) removidos++
    }
  }).catch((e) => {
    if (e instanceof Error && e.message === 'REDISTRIBUIR_CONCORRENCIA') return 'concorrencia' as const
    throw e
  })

  if (erroConcorrencia.length > 0) {
    return { ...vazio, totalBase, erros: erroConcorrencia }
  }

  return { ok: true, erros: [], totalBase, membrosAfetados: membrosAfetados + novos.length, adicionados: novos.length, removidos }
}
