// lib/financeiro/pagamentos/registrar-pagamento-composto.ts
// ============================================================================
// Serviço da tela "Registrar Pagamento" (recebimento rico). NÃO reimplementa o
// motor: orquestra N chamadas a `registrarOcorrencia` (uma por forma de pagamento
// + uma por ajuste), grava os campos de EXIBIÇÃO na ocorrência, consome crédito,
// anexa comprovantes e — se pedido — gera a cobrança do saldo. Aditivo e seguro:
// cada ocorrência é atômica/idempotente; nada é apagado. Ver ocorrencia-service.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { registrarOcorrencia } from '../ocorrencias/ocorrencia-service'
import { totaisConsistentes } from '../dominio/calculo-recebimento'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const brl = (v: number) => `R$ ${cent(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const cut = (s: string | null | undefined, n: number) => (s == null ? null : String(s).slice(0, n))

export interface FormaLinhaEntrada {
  formaPagamentoId: number | null
  formaLabel?: string | null
  valor: number
  contaId?: number | null
  contaTipo?: 'conta' | 'carteira' | null
  contaLabel?: string | null
  contaBanco?: string | null
  contaAgencia?: string | null
  contaNumero?: string | null
  dataRecebimento?: string | null
  dataCompensacao?: string | null
  referencia?: string | null
  origemRecurso?: string | null
  // cartão: adquirente/bandeira e a TARIFA calculada (reduz o líquido, lança em Taxas)
  tarifa?: number | null
  adquirenteLabel?: string | null
  bandeiraLabel?: string | null
}
export interface PagadorEntrada {
  tipo: 'REQUERENTE' | 'EMPRESA' | 'TERCEIRO' | 'EXTERNO'
  pessoaId?: number | null
  parteExterna?: { nome: string; documento?: string | null; telefone?: string | null; observacao?: string | null } | null
}
export interface AjustesEntrada {
  desconto?: number; juros?: number; multa?: number; acrescimo?: number; creditoUtilizado?: number
}
export interface RegistrarPagamentoCompostoInput {
  obrigacaoId: number
  moeda?: string | null
  formas: FormaLinhaEntrada[]
  pagador?: PagadorEntrada | null
  ajustes?: AjustesEntrada | null
  aplicacao?: { politica?: string | null; manual?: { parcelaId: number; valor: number }[] | null } | null
  excedenteTratamento?: 'CREDITO' | 'ADIANTAMENTO' | 'ABATER_PROXIMAS' | 'DEVOLVER' | null
  parcialTratamento?: 'MANTER' | 'GERAR_COBRANCA' | 'RENEGOCIAR' | null
  comprovantes?: { arquivoUrl: string; arquivoNome: string; tamanho?: number | null }[] | null
  observacao?: string | null
  saldoSelecionado?: number | null
  totais?: { totalInformado?: number; saldoRestante?: number; excedente?: number } | null
  idempotencyKey?: string | null
  criadoPorId?: number | null
}
export interface RegistrarPagamentoCompostoResultado {
  ok: boolean
  erros: string[]
  ocorrenciasCriadas: number
  totalRecebido: number
  ajustesAplicados: { desconto: number; juros: number; multa: number; acrescimo: number; creditoUtilizado: number }
  excedente: number
  saldoRestante: number
  cobrancaGeradaId: number | null
}

type OcResp = { ocorrenciaId: number; idempotente?: boolean; excedente?: number; saldo?: number }

function mapPagador(p?: PagadorEntrada | null) {
  if (!p) return null
  if (p.tipo === 'EXTERNO') {
    const pe = p.parteExterna
    return { tipo: 'EXTERNO', parteExterna: { nome: pe?.nome || 'Externo', documento: pe?.documento ?? null, tipo: null as string | null } }
  }
  return { tipo: p.tipo, pessoaId: p.pessoaId ?? null }
}
function mapPolitica(p?: string | null): 'FIFO' | 'PROPORCIONAL' | 'MANUAL' | 'PARCELA_ESPECIFICA' {
  switch (p) {
    case 'AUTOMATICA': case 'PROPORCIONAL': return 'PROPORCIONAL'
    case 'MANUAL': return 'MANUAL'
    default: return 'FIFO' // NESTA | PROXIMAS | MAIS_ANTIGA | FIFO
  }
}
function mapExcedente(t?: string | null): 'CREDITO' | 'ADIANTAMENTO' | 'QUITAR_OUTRO' | 'DEVOLUCAO' {
  switch (t) {
    case 'ADIANTAMENTO': return 'ADIANTAMENTO'
    case 'ABATER_PROXIMAS': return 'QUITAR_OUTRO'
    case 'DEVOLVER': return 'DEVOLUCAO'
    default: return 'CREDITO'
  }
}

/** Marca créditos ABERTOS (da obrigação/pessoa) como UTILIZADO até `valor`. */
async function consumirCredito(obrigacaoId: number, pessoaId: number | null, valor: number, criadoPorId: number | null, correlationId: string, ocorrenciaId?: number | null, processoId?: number | null) {
  // Crédito é do PROCESSO/pessoa — não da obrigação-alvo. Busca por obrigações do processo OR pessoa.
  const obrsProc = processoId != null ? await prisma.obrigacaoEconomica.findMany({ where: { processoId }, select: { id: true } }).then((r) => r.map((o) => o.id)).catch(() => [obrigacaoId]) : [obrigacaoId]
  const ors: Record<string, unknown>[] = [{ obrigacaoId: { in: obrsProc.length ? obrsProc : [obrigacaoId] } }]
  if (pessoaId != null) ors.push({ pessoaId })
  const where = { status: 'ABERTO', OR: ors }
  // ATÔMICO: consumo FIFO + registro no razão imutável de crédito (saldo anterior→posterior).
  await prisma.$transaction(async (tx) => {
    let restante = cent(valor)
    const creditos = await tx.creditoFinanceiro.findMany({ where, orderBy: { criadoEm: 'asc' } })
    for (const c of creditos) {
      if (restante <= 0.005) break
      const antes = cent(Number(c.valor))
      const usar = Math.min(antes, restante)
      const depois = cent(antes - usar)
      if (depois <= 0.005) await tx.creditoFinanceiro.update({ where: { id: c.id }, data: { valor: 0, status: 'UTILIZADO', aprovadoPorId: criadoPorId } })
      else await tx.creditoFinanceiro.update({ where: { id: c.id }, data: { valor: depois } })
      await tx.creditoMovimento.create({ data: {
        creditoId: c.id, tipo: 'UTILIZACAO', valor: usar, saldoAnterior: antes, saldoPosterior: depois, moeda: (c.moeda as never),
        obrigacaoDestinoId: obrigacaoId, ocorrenciaId: ocorrenciaId ?? null, pessoaId, processoId: processoId ?? null,
        usuarioId: criadoPorId, correlationId: cut(correlationId, 80), observacao: 'Crédito utilizado em recebimento',
      } }).catch(() => {})
      restante = cent(restante - usar)
    }
  }).catch(() => {})
}

export async function registrarPagamentoComposto(input: RegistrarPagamentoCompostoInput): Promise<RegistrarPagamentoCompostoResultado> {
  const vazio: RegistrarPagamentoCompostoResultado = {
    ok: false, erros: [], ocorrenciasCriadas: 0, totalRecebido: 0,
    ajustesAplicados: { desconto: 0, juros: 0, multa: 0, acrescimo: 0, creditoUtilizado: 0 },
    excedente: 0, saldoRestante: 0, cobrancaGeradaId: null,
  }

  const obr = await prisma.obrigacaoEconomica.findUnique({
    where: { id: input.obrigacaoId },
    select: { id: true, origemTipo: true, origemId: true, processoId: true, moedaContratual: true },
  })
  if (!obr) return { ...vazio, erros: ['Obrigação inexistente.'] }
  const receitaId = obr.origemTipo === 'Receita' ? (obr.origemId ?? null) : null
  const moeda = input.moeda || String(obr.moedaContratual) || 'BRL'

  // ── validação (nunca deixa passar botão morto) ──────────────────────────
  const formas = (input.formas ?? []).filter((f) => cent(f.valor) > 0)
  const erros: string[] = []
  if (!formas.length) erros.push('Informe ao menos uma forma de pagamento com valor.')
  for (const f of formas) {
    if (!f.formaPagamentoId) erros.push('Toda linha de pagamento precisa de uma forma de pagamento.')
    if (f.contaId == null) erros.push('Toda linha de pagamento precisa de uma conta de destino.')
    if (cent(f.valor) < 0) erros.push('Valor de pagamento não pode ser negativo.')
  }
  const aj = input.ajustes ?? {}
  const desconto = Math.max(0, cent(aj.desconto ?? 0))
  const juros = Math.max(0, cent(aj.juros ?? 0))
  const multa = Math.max(0, cent(aj.multa ?? 0))
  const acrescimo = Math.max(0, cent(aj.acrescimo ?? 0))
  const creditoUtilizado = Math.max(0, cent(aj.creditoUtilizado ?? 0))
  // M3: forma NEGATIVA é rejeitada explicitamente (não descartada em silêncio).
  if ((input.formas ?? []).some((f) => cent(f.valor) < 0)) erros.push('Valor de pagamento não pode ser negativo.')
  if (erros.length) return { ...vazio, erros: [...new Set(erros)] }

  // A2/C1: validações que dependem do ESTADO atual (saldo/crédito) — no BACKEND, não confiar no front.
  const projAtual = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: obr.id }, select: { saldo: true } })
  const saldoAtual = projAtual ? cent(Number(projAtual.saldo)) : cent(Number(input.saldoSelecionado ?? 0))
  if (desconto > saldoAtual + 0.01) return { ...vazio, erros: [`Desconto (${desconto}) não pode exceder o saldo em aberto (${saldoAtual}).`] }
  if (creditoUtilizado > 0) {
    const obrsProc = obr.processoId != null ? (await prisma.obrigacaoEconomica.findMany({ where: { processoId: obr.processoId }, select: { id: true } })).map((o) => o.id) : [obr.id]
    const credAgg = await prisma.creditoFinanceiro.aggregate({ where: { status: 'ABERTO', obrigacaoId: { in: obrsProc.length ? obrsProc : [obr.id] } }, _sum: { valor: true } })
    const dispCred = cent(Number(credAgg._sum.valor ?? 0))
    if (creditoUtilizado > dispCred + 0.01) return { ...vazio, erros: [`Crédito utilizado (${creditoUtilizado}) excede o disponível (${dispCred}).`] }
  }

  // revalidação da FONTE ÚNICA de cálculo — rejeita payload cujos totais não batam
  if (input.totais) {
    const consistente = totaisConsistentes(
      { saldoSelecionado: Number(input.saldoSelecionado ?? 0), linhas: formas.map((f) => ({ valor: cent(f.valor) })), desconto, juros, multa, acrescimo, creditoUtilizado },
      input.totais,
    )
    if (!consistente) return { ...vazio, erros: ['Totais divergentes entre cliente e servidor — recálculo rejeitado.'] }
  }

  const totalRecebido = cent(formas.reduce((s, f) => s + cent(f.valor), 0))
  // Idempotência de double-click: chave DETERMINÍSTICA do cliente (se enviada) — repetir a
  // mesma requisição não duplica (as idempotencyKey por linha ficam estáveis). Sem chave → timestamp.
  const correlacaoId = input.idempotencyKey ? `pg:${obr.id}:${cut(input.idempotencyKey, 40)}` : `pg:${obr.id}:${Date.now()}`
  const criadoPorId = input.criadoPorId ?? null
  const pagador = mapPagador(input.pagador)
  const politica = mapPolitica(input.aplicacao?.politica)
  const excedenteDestino = mapExcedente(input.excedenteTratamento)
  const obsBase = input.observacao ?? null

  let ocorrenciasCriadas = 0
  let excedente = 0

  // ── 1) ajustes primeiro (mudam o saldo antes do pagamento) ──────────────
  const ajustes: { tipo: 'DESCONTO' | 'JUROS' | 'MULTA'; valor: number; rot: string }[] = []
  if (desconto > 0) ajustes.push({ tipo: 'DESCONTO', valor: desconto, rot: 'Desconto' })
  if (juros > 0) ajustes.push({ tipo: 'JUROS', valor: juros, rot: 'Juros' })
  if (multa > 0) ajustes.push({ tipo: 'MULTA', valor: multa, rot: 'Multa' })
  if (acrescimo > 0) ajustes.push({ tipo: 'JUROS', valor: acrescimo, rot: 'Acréscimo' })
  for (let i = 0; i < ajustes.length; i++) {
    const a = ajustes[i]
    await registrarOcorrencia({ obrigacaoId: obr.id, tipo: a.tipo, valor: a.valor, moeda, observacao: a.rot, idempotencyKey: `${correlacaoId}:aj:${i}`, criadoPorId })
    ocorrenciasCriadas++
  }

  // ── 2) crédito utilizado (pagamento financiado por crédito) ─────────────
  if (creditoUtilizado > 0) {
    const rc = await registrarOcorrencia({ obrigacaoId: obr.id, tipo: 'PAGAMENTO', valor: creditoUtilizado, moeda, origemRecurso: 'CREDITO', pagador, aplicacao: { politica }, observacao: 'Crédito utilizado', idempotencyKey: `${correlacaoId}:cred`, criadoPorId }) as OcResp
    ocorrenciasCriadas++
    await consumirCredito(obr.id, pagador && 'pessoaId' in pagador ? pagador.pessoaId ?? null : null, creditoUtilizado, criadoPorId, correlacaoId, rc?.ocorrenciaId ?? null, obr.processoId ?? null)
  }

  // ── 3) linhas de pagamento (uma ocorrência por forma) ───────────────────
  for (let i = 0; i < formas.length; i++) {
    const f = formas[i]
    const ultima = i === formas.length - 1
    const tarifa = Math.max(0, cent(f.tarifa ?? 0))
    // Seleção MANUAL com múltiplas formas: escala a alocação por parcela pela fração desta forma
    // (mantém Σ por forma = valor da forma e Σ por parcela = alocação pedida).
    const fracao = totalRecebido > 0 ? cent(f.valor) / totalRecebido : 0
    const manualLinha = politica === 'MANUAL' && Array.isArray(input.aplicacao?.manual)
      ? input.aplicacao!.manual!.map((m) => ({ parcelaId: m.parcelaId, valor: cent(m.valor * fracao) })).filter((m) => m.valor > 0)
      : undefined
    const r = (await registrarOcorrencia({
      obrigacaoId: obr.id, tipo: 'PAGAMENTO', valor: cent(f.valor), moeda,
      data: f.dataRecebimento ? new Date(f.dataRecebimento) : undefined,
      formaPagamentoId: f.formaPagamentoId ?? null,
      origemRecurso: cut(f.origemRecurso, 20),
      pagador, aplicacao: { politica, manual: manualLinha },
      excedenteDestino: ultima ? excedenteDestino : null,
      tarifa: tarifa > 0 ? tarifa : null,
      observacao: obsBase, idempotencyKey: `${correlacaoId}:forma:${i}`, criadoPorId,
    })) as OcResp
    ocorrenciasCriadas++
    if (r && r.idempotente !== true && typeof r.excedente === 'number') excedente = cent(excedente + r.excedente)
    // grava os campos de exibição (forma/conta/referência) na ocorrência
    if (r?.ocorrenciaId) {
      await prisma.ocorrenciaFinanceira.update({
        where: { id: r.ocorrenciaId },
        data: {
          formaLabel: cut(f.formaLabel, 40),
          contaBanco: cut(f.contaBanco ?? f.contaLabel, 80),
          contaAgencia: cut(f.contaAgencia, 20),
          contaNumero: cut(f.contaNumero, 30),
          referencia: cut([f.referencia, [f.adquirenteLabel, f.bandeiraLabel].filter(Boolean).join(" "), tarifa > 0 ? `taxa ${brl(tarifa)}` : null].filter(Boolean).join(" · ") || null, 120),
          correlacaoId: cut(correlacaoId, 60),
        },
      }).catch(() => {})
    }
  }

  // ── 4) comprovantes anexados ────────────────────────────────────────────
  if (receitaId && input.comprovantes?.length) {
    for (const c of input.comprovantes) {
      await prisma.receitaDocumento.create({ data: {
        receitaId, obrigacaoId: obr.id, arquivoUrl: cut(c.arquivoUrl, 400)!, arquivoNome: cut(c.arquivoNome, 200)!,
        tipo: 'comprovante', tamanho: c.tamanho ?? null, criadoPorId,
      } }).catch(() => {})
    }
  }

  // ── 5) saldo restante (projeção recomputada pelo motor) ─────────────────
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: obr.id }, select: { saldo: true } })
  const saldoRestante = proj ? Math.max(0, cent(Number(proj.saldo))) : 0

  // ── 6) tratamento do saldo parcial ──────────────────────────────────────
  let cobrancaGeradaId: number | null = null
  if (saldoRestante > 0.005 && input.parcialTratamento === 'GERAR_COBRANCA' && receitaId && obr.processoId) {
    const nova = await prisma.cobranca.create({ data: {
      receitaId, processoId: obr.processoId, valorTotal: saldoRestante, moeda: moeda as never,
      status: 'ABERTA', obrigacaoId: obr.id, observacoes: 'Saldo remanescente de recebimento parcial',
      criadoPorId, idempotencyKey: cut(`${correlacaoId}:saldo`, 80),
    } }).catch(() => null)
    if (nova) {
      cobrancaGeradaId = nova.id
      await prisma.parcelaFinanceira.create({ data: { cobrancaId: nova.id, numero: 1, vencimento: new Date(), valor: saldoRestante, status: 'PENDENTE' } }).catch(() => {})
    }
  }

  // ── 7) auditoria (timeline da Receita) ──────────────────────────────────
  if (receitaId) {
    const partes = [`Recebimento ${brl(totalRecebido)} em ${formas.length} forma(s)`]
    if (desconto || juros || multa || acrescimo) partes.push(`ajustes: ${[desconto && `desc ${brl(desconto)}`, juros && `juros ${brl(juros)}`, multa && `multa ${brl(multa)}`, acrescimo && `acrésc ${brl(acrescimo)}`].filter(Boolean).join(', ')}`)
    if (creditoUtilizado) partes.push(`crédito usado ${brl(creditoUtilizado)}`)
    if (excedente > 0.005) partes.push(`excedente ${brl(excedente)} → ${excedenteDestino}`)
    if (cobrancaGeradaId) partes.push(`cobrança de saldo #${cobrancaGeradaId} gerada`)
    partes.push(`saldo restante ${brl(saldoRestante)}`)
    await prisma.eventoFinanceiro.create({ data: { receitaId, tipo: 'PAGAMENTO', descricao: partes.join(' · ').slice(0, 480) } }).catch(() => {})
  }

  return {
    ok: true, erros: [], ocorrenciasCriadas, totalRecebido,
    ajustesAplicados: { desconto, juros, multa, acrescimo, creditoUtilizado },
    excedente: cent(excedente), saldoRestante, cobrancaGeradaId,
  }
}
