// lib/financeiro/vocabulario.ts
// ============================================================================
// F7.4 — VOCABULÁRIO ÚNICO do lançamento financeiro por natureza.
//
// As telas do Financeiro são COMPARTILHADAS entre Receita (direitos a receber) e
// Custo (obrigações a pagar) — mesma infraestrutura, domínios distintos. Sem uma
// fonte única de rótulos, cada componente reinventa o texto e a linguagem de Receita
// vaza no modo custo ("Cancelar Receita", "Saldo a receber", "Cliente"…).
//
// Regra: NENHUM componente escreve "Receita"/"Custo" à mão. Todos leem daqui.
// ============================================================================

export interface VocabularioFinanceiro {
  /** true quando o lançamento é uma obrigação A PAGAR. */
  custo: boolean
  /** "custo" | "receita" — minúsculo, para compor frases. */
  entidade: string
  /** "Custo" | "Receita" — início de frase / rótulo isolado. */
  Entidade: string
  /** "este custo" | "esta receita". */
  esteEsta: string
  /** "do custo" | "da receita". */
  doDa: string
  /** "Custos" | "Receitas" — nome da lista/aba de origem. */
  lista: string
  /** "Pago" | "Recebido" — total já liquidado. */
  liquidado: string
  /** "Saldo a pagar" | "Saldo a receber". */
  saldo: string
  /** "Fornecedor" | "Cliente" — contraparte do lançamento. */
  contraparte: string
  /** "Parcelas" | "Cobranças" — cronograma de liquidação. */
  cronograma: string
  /** "pagamento efetuado" | "pagamento recebido". */
  pagamento: string
}

export function vocabularioFinanceiro(natureza?: string | null): VocabularioFinanceiro {
  const custo = String(natureza ?? '').toUpperCase() === 'CUSTO'
  return {
    custo,
    entidade: custo ? 'custo' : 'receita',
    Entidade: custo ? 'Custo' : 'Receita',
    esteEsta: custo ? 'este custo' : 'esta receita',
    doDa: custo ? 'do custo' : 'da receita',
    lista: custo ? 'Custos' : 'Receitas',
    liquidado: custo ? 'Pago' : 'Recebido',
    saldo: custo ? 'Saldo a pagar' : 'Saldo a receber',
    contraparte: custo ? 'Fornecedor' : 'Cliente',
    cronograma: custo ? 'Parcelas' : 'Cobranças',
    pagamento: custo ? 'pagamento efetuado' : 'pagamento recebido',
  }
}
