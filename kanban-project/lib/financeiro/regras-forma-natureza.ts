// lib/financeiro/regras-forma-natureza.ts
// ============================================================================
// Regras OBRIGATÓRIAS por NATUREZA da forma de pagamento (camada de segurança
// além da configuração do cadastro). PURO: sem Prisma/fetch/React.
//
// Natureza (independe de config individual):
//   • À VISTA APENAS: PIX, TRANSFERENCIA, DINHEIRO, WISE, CARTAO_DEBITO
//   • PARCELÁVEL:     CARTAO_CREDITO, BOLETO
//   • ENTRADA APENAS: PIX, TRANSFERENCIA
//   • Teto global de parcelas: 12
// ============================================================================

export const MAX_PARCELAS_GLOBAL = 12

export const FORMAS_A_VISTA = ['PIX', 'TRANSFERENCIA', 'DINHEIRO', 'WISE', 'CARTAO_DEBITO'] as const
export const FORMAS_PARCELAVEIS = ['CARTAO_CREDITO', 'BOLETO'] as const
export const FORMAS_ENTRADA = ['PIX', 'TRANSFERENCIA'] as const

const up = (v: string | null | undefined) => String(v ?? '').toUpperCase()

export function permiteParcelamentoPorNatureza(tipoForma: string): boolean {
  return (FORMAS_PARCELAVEIS as readonly string[]).includes(up(tipoForma))
}
export function permiteEntradaPorNatureza(tipoForma: string): boolean {
  return (FORMAS_ENTRADA as readonly string[]).includes(up(tipoForma))
}

export interface ErroRegra { codigo: string; mensagem: string }

/** Valida forma × quantidade de parcelas pela NATUREZA. null = ok. */
export function validarParcelamentoPorNatureza(tipoForma: string, nParcelas: number): ErroRegra | null {
  const n = Math.trunc(Number(nParcelas) || 1)
  if (n > MAX_PARCELAS_GLOBAL) {
    return { codigo: 'PARCELAS_ACIMA_MAX', mensagem: 'O parcelamento está limitado a 12 parcelas.' }
  }
  if (n > 1 && !permiteParcelamentoPorNatureza(tipoForma)) {
    return { codigo: 'FORMA_A_VISTA', mensagem: 'Esta forma de pagamento permite apenas pagamento à vista.' }
  }
  return null
}

/** Valida a forma escolhida para a ENTRADA. null = ok. */
export function validarFormaEntrada(tipoFormaEntrada: string): ErroRegra | null {
  if (!permiteEntradaPorNatureza(tipoFormaEntrada)) {
    return { codigo: 'ENTRADA_FORMA_INVALIDA', mensagem: 'A entrada somente pode ser paga por PIX ou transferência bancária.' }
  }
  return null
}

/** Valida se uma condição é aplicável a um processo (fallback p/ configuração geral). */
export function condicaoDisponivelNoProcesso(cond: { tiposProcesso?: string[] | null; modalidades?: string[] | null }, ctx: { tipoProcesso?: string | null; modalidade?: string | null }): ErroRegra | null {
  const tp = (cond.tiposProcesso ?? []).map(up)
  const md = (cond.modalidades ?? []).map(up)
  // vazio = configuração geral (disponível para todos)
  if (tp.length && ctx.tipoProcesso && !tp.includes(up(ctx.tipoProcesso))) {
    return { codigo: 'CONDICAO_INDISPONIVEL', mensagem: 'Esta condição de pagamento não está disponível para este processo.' }
  }
  if (md.length && ctx.modalidade && !md.includes(up(ctx.modalidade))) {
    return { codigo: 'CONDICAO_INDISPONIVEL', mensagem: 'Esta condição de pagamento não está disponível para este processo.' }
  }
  return null
}
