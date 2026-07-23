// lib/financeiro/taxa-identidade.ts
// ============================================================================
// IDENTIDADE + AGRUPAMENTO da Taxa de Pagamento — FONTE ÚNICA (pura, sem Prisma).
//
// Uma Taxa de Pagamento É a tabela lógica inteira (o registro TaxaPagamento).
// Para cartão de crédito ela carrega a grade 1x–12x em TaxaParcelamento; para as
// demais formas é um percentual/valor único. Este módulo:
//   • decide o PERFIL da forma (o que a tela mostra e como calcula);
//   • GERA o nome canônico (o admin nunca digita nome nem código);
//   • RESUME a taxa para a listagem agrupada (taxa mín/máx, nº de linhas);
//   • deriva a CHAVE de unicidade lógica (forma × adquirente × bandeira ×
//     finalidade × vigência) para o backend barrar duplicidade acidental.
//
// Config-driven por TIPO de forma — nenhuma regra é hardcoded por nome.
// ============================================================================

/** Como a Taxa é calculada para uma forma. */
export type CalculoTaxa = 'GRADE' | 'PERCENTUAL' | 'FIXO' | 'BOLETO'

export interface PerfilForma {
  calculo: CalculoTaxa
  mostraAdquirente: boolean
  mostraBandeira: boolean
  mostraGrade: boolean
  mostraFinalidade: boolean
}

const T = (s: string) => String(s || '').trim().toUpperCase().replace(/\s+/g, '_')

/**
 * Perfil da forma pelo TIPO do cadastro (FormaPagamentoCadastro.type). Config
 * única: cartão de crédito tem grade + bandeira; débito tem bandeira e taxa
 * única; PIX/Transferência/Dinheiro/Wise taxa única; boleto tem finalidade.
 */
export function perfilForma(formaType: string | null | undefined): PerfilForma {
  switch (T(formaType ?? '')) {
    case 'CARTAO_CREDITO':
      return { calculo: 'GRADE', mostraAdquirente: true, mostraBandeira: true, mostraGrade: true, mostraFinalidade: false }
    case 'CARTAO_DEBITO':
      return { calculo: 'PERCENTUAL', mostraAdquirente: true, mostraBandeira: true, mostraGrade: false, mostraFinalidade: false }
    case 'BOLETO':
      return { calculo: 'BOLETO', mostraAdquirente: false, mostraBandeira: false, mostraGrade: false, mostraFinalidade: true }
    // PIX, TRANSFERENCIA, DINHEIRO, WISE e quaisquer outras: taxa única.
    default:
      return { calculo: 'PERCENTUAL', mostraAdquirente: false, mostraBandeira: false, mostraGrade: false, mostraFinalidade: false }
  }
}

// ── Finalidade do boleto (encargos separados; nunca uma taxa genérica) ──
export const FINALIDADES_BOLETO = ['EMISSAO', 'PAGAMENTO', 'MULTA', 'JUROS'] as const
export type FinalidadeBoleto = (typeof FINALIDADES_BOLETO)[number]

export const FINALIDADE_LABEL: Record<string, string> = {
  EMISSAO: 'Taxa de Emissão',
  PAGAMENTO: 'Taxa de Pagamento',
  MULTA: 'Multa por atraso',
  JUROS: 'Juros de mora',
}

/** Emissão/Pagamento = valor fixo; Multa/Juros = percentual. */
export function calculoFinalidade(finalidade: string | null | undefined): 'FIXO' | 'PERCENTUAL' {
  const f = T(finalidade ?? '')
  return f === 'MULTA' || f === 'JUROS' ? 'PERCENTUAL' : 'FIXO'
}

/** Deriva a finalidade a partir do nome legado do boleto (backfill idempotente). */
export function finalidadeDoNome(nome: string | null | undefined): FinalidadeBoleto | null {
  const n = String(nome ?? '').toLowerCase()
  if (!n.includes('boleto')) return null
  if (n.includes('emiss')) return 'EMISSAO'
  if (n.includes('pagam') || n.includes('liquid')) return 'PAGAMENTO'
  if (n.includes('multa')) return 'MULTA'
  if (n.includes('juro')) return 'JUROS'
  return null
}

export interface CtxNome {
  formaType: string | null | undefined
  formaNome: string | null | undefined
  bandeiraNome?: string | null
  finalidade?: string | null
}

/**
 * Nome CANÔNICO da taxa (autoridade do backend — o admin nunca digita):
 *   • Cartão de Crédito/Débito → "Cartão de Crédito — Visa"
 *   • Boleto → "Boleto — Taxa de Emissão"
 *   • PIX/Transferência/Dinheiro/Wise → "PIX — Taxa"
 * Compatível com os registros já cadastrados (mesma grafia do seed) — regerar o
 * nome de um registro existente devolve exatamente o mesmo texto (sem drift).
 */
export function nomeTaxaAuto(ctx: CtxNome): string {
  const perfil = perfilForma(ctx.formaType)
  const forma = String(ctx.formaNome ?? '').trim() || 'Taxa'
  if (perfil.mostraBandeira && ctx.bandeiraNome) return `${forma} — ${ctx.bandeiraNome}`
  if (perfil.mostraFinalidade && ctx.finalidade) {
    const rot = FINALIDADE_LABEL[T(ctx.finalidade)] ?? String(ctx.finalidade)
    return `${forma} — ${rot}`
  }
  return `${forma} — Taxa`
}

// ── Resumo para a listagem agrupada ─────────────────────────────────────────
export interface LinhaGrade { parcelasDe: number; parcelasAte: number; feePercent: number | null; fixedFee: number | null }

export interface ResumoTaxa {
  tipoCalculo: 'GRADE' | 'PERCENTUAL' | 'FIXO'
  nLinhas: number
  parcelaMin: number | null
  parcelaMax: number | null
  taxaMinPercent: number | null
  taxaMaxPercent: number | null
  valorFixo: number | null
}

/**
 * Resume a taxa para a lista: quando tem grade, devolve taxa mínima/máxima e a
 * faixa de parcelas (12 linhas viram UMA linha na tela "3,25% → 11,60%, 12x").
 */
export function resumoTaxa(input: {
  feeType?: string | null; feePercent?: number | null; fixedFee?: number | null
  parcelamento?: LinhaGrade[] | null
}): ResumoTaxa {
  const linhas = (input.parcelamento ?? []).filter((l) => l && Number.isFinite(Number(l.parcelasDe)))
  const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))
  if (linhas.length > 0) {
    const pcts = linhas.map((l) => num(l.feePercent)).filter((n): n is number => n != null)
    const parcelas = linhas.flatMap((l) => [Number(l.parcelasDe), Number(l.parcelasAte)])
    return {
      tipoCalculo: 'GRADE', nLinhas: linhas.length,
      parcelaMin: Math.min(...parcelas), parcelaMax: Math.max(...parcelas),
      taxaMinPercent: pcts.length ? Math.min(...pcts) : null,
      taxaMaxPercent: pcts.length ? Math.max(...pcts) : null,
      valorFixo: null,
    }
  }
  const pct = num(input.feePercent), fixo = num(input.fixedFee)
  return {
    tipoCalculo: fixo != null && (pct == null || pct === 0) ? 'FIXO' : 'PERCENTUAL',
    nLinhas: 0, parcelaMin: null, parcelaMax: null,
    taxaMinPercent: pct, taxaMaxPercent: pct, valorFixo: fixo,
  }
}

/**
 * Chave de UNICIDADE lógica de uma tabela de taxa ATIVA. Duas taxas ativas com a
 * mesma chave são duplicidade acidental (o backend rejeita). Trocar a vigência
 * gera chave nova → é uma nova versão, permitida.
 */
export function chaveUnicidade(t: {
  formaId?: number | null
  adquirenteId?: number | null
  bandeiraId?: number | null
  finalidade?: string | null
  vigenciaInicio?: Date | string | null
}): string {
  const forma = t.formaId ?? '∅'
  const adq = t.adquirenteId ?? '∅'
  const band = t.bandeiraId ?? '∅'
  const fin = t.finalidade ? T(t.finalidade) : '∅'
  const vig = t.vigenciaInicio ? new Date(t.vigenciaInicio).toISOString().slice(0, 10) : '∅'
  return `F${forma}|A${adq}|B${band}|${fin}|V${vig}`
}

/** Forma "principal" de uma taxa (1ª de formasAplicaveis, ou a legada). */
export function formaPrincipalId(t: { formasAplicaveis?: number[] | null; formaPagamentoId?: number | null }): number | null {
  const arr = t.formasAplicaveis ?? []
  if (arr.length > 0) return Number(arr[0])
  return t.formaPagamentoId ?? null
}

// ── AGREGAÇÃO POR FORMA DE PAGAMENTO (camada de apresentação) ────────────────
// A listagem passa a ter UMA linha por Forma; bandeira/adquirente/parcela ficam
// DENTRO da configuração. O banco continua normalizado (uma taxa por
// forma×bandeira com grade) — isto é só leitura agregada.

export interface TaxaParaAgrupar {
  id: number
  formasAplicaveis?: number[] | null
  formaPagamentoId?: number | null
  adquirenteId?: number | null
  bandeiraId?: number | null
  finalidade?: string | null
  feePercent?: number | null
  fixedFee?: number | null
  ativo?: boolean | null
  vigenciaInicio?: string | Date | null
  vigenciaFim?: string | Date | null
  atualizadoEm?: string | Date | null
  parcelamento?: LinhaGrade[] | null
}

export interface FormaAgrupada {
  formaPagamentoId: number
  nome: string
  code: string | null
  type: string | null
  /** GRADE (crédito) | PERCENTUAL (débito/pix/wise…) | ENCARGOS (boleto). */
  tipoTaxa: 'GRADE' | 'PERCENTUAL' | 'ENCARGOS'
  quantidadeAdquirentes: number
  quantidadeBandeiras: number
  quantidadeConfiguracoes: number
  parcelasMin: number | null
  parcelasMax: number | null
  possuiEncargos: boolean
  status: boolean
  vigenciaInicio: string | null
  vigenciaFim: string | null
  versao: number
  ultimaAlteracao: string | null
  bandeirasNomes: string[]
  adquirentesNomes: string[]
}

/**
 * Agrupa as taxas normalizadas em UMA linha por Forma de Pagamento. Só formas
 * que possuem ao menos uma taxa aparecem. A ordem segue a lista de formas.
 */
export function agruparTaxasPorForma(
  taxas: TaxaParaAgrupar[],
  formas: { id: number; name: string; code?: string | null; type?: string | null; ativo?: boolean | null }[],
  nomeAdquirente: (id: number) => string | null,
  nomeBandeira: (id: number) => string | null,
): FormaAgrupada[] {
  const porForma = new Map<number, TaxaParaAgrupar[]>()
  for (const t of taxas) {
    const fid = formaPrincipalId(t)
    if (fid == null) continue
    if (!porForma.has(fid)) porForma.set(fid, [])
    porForma.get(fid)!.push(t)
  }

  const out: FormaAgrupada[] = []
  for (const forma of formas) {
    const grupo = porForma.get(forma.id)
    if (!grupo || grupo.length === 0) continue
    const perfil = perfilForma(forma.type)

    const adqIds = new Set<number>(), bandIds = new Set<number>()
    const parcelas: number[] = []
    let vigIni: number | null = null, vigFim: number | null = null, ult: number | null = null
    let temEncargo = false
    for (const t of grupo) {
      if (t.adquirenteId != null) adqIds.add(t.adquirenteId)
      if (t.bandeiraId != null) bandIds.add(t.bandeiraId)
      for (const l of t.parcelamento ?? []) { parcelas.push(Number(l.parcelasDe), Number(l.parcelasAte)) }
      if (t.finalidade) temEncargo = true
      const vi = t.vigenciaInicio ? new Date(t.vigenciaInicio).getTime() : null
      const vf = t.vigenciaFim ? new Date(t.vigenciaFim).getTime() : null
      const at = t.atualizadoEm ? new Date(t.atualizadoEm).getTime() : null
      if (vi != null) vigIni = vigIni == null ? vi : Math.min(vigIni, vi)
      if (vf != null) vigFim = vigFim == null ? vf : Math.max(vigFim, vf)
      if (at != null) ult = ult == null ? at : Math.max(ult, at)
    }
    // Parcelas: no crédito vêm da grade; no débito/único é 1x (pagamento único).
    const parcelasMin = parcelas.length ? Math.min(...parcelas) : (perfil.mostraGrade ? null : 1)
    const parcelasMax = parcelas.length ? Math.max(...parcelas) : (perfil.mostraGrade ? null : 1)

    out.push({
      formaPagamentoId: forma.id, nome: forma.name, code: forma.code ?? null, type: forma.type ?? null,
      tipoTaxa: perfil.calculo === 'BOLETO' ? 'ENCARGOS' : perfil.mostraGrade ? 'GRADE' : 'PERCENTUAL',
      quantidadeAdquirentes: adqIds.size, quantidadeBandeiras: bandIds.size, quantidadeConfiguracoes: grupo.length,
      parcelasMin, parcelasMax,
      possuiEncargos: temEncargo || perfil.calculo === 'BOLETO',
      status: forma.ativo !== false,
      vigenciaInicio: vigIni != null ? new Date(vigIni).toISOString() : null,
      vigenciaFim: vigFim != null ? new Date(vigFim).toISOString() : null,
      versao: 1,
      ultimaAlteracao: ult != null ? new Date(ult).toISOString() : null,
      bandeirasNomes: [...bandIds].map((id) => nomeBandeira(id)).filter((x): x is string => !!x),
      adquirentesNomes: [...adqIds].map((id) => nomeAdquirente(id)).filter((x): x is string => !!x),
    })
  }
  return out
}
