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
