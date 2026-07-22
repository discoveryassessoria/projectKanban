// src/app/api/gerenciamento/formas-pagamento/campos.ts
// ============================================================================
// Mapeamento ÚNICO body → colunas de FormaPagamentoCadastro (POST e PUT nunca
// divergem). A Forma descreve só CAPACIDADES do meio — nenhuma regra comercial.
// ============================================================================
import { TIPOS_FORMA, TIPOS_INTEGRACAO, PRAZOS_LIQUIDACAO, CATEGORIAS_FORMA } from '@/lib/financeiro/payment-method-service'

const str = (v: unknown, max = 300): string | null => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s.slice(0, max)
}
const int = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
const bool = (v: unknown, padrao = false): boolean => (v === undefined ? padrao : !!v)
const listaStr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : []
const listaInt = (v: unknown): number[] =>
  Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n)) : []
const enumOu = (v: unknown, permitidos: readonly string[]): string | null => {
  const s = v == null ? '' : String(v).toUpperCase()
  return permitidos.includes(s) ? s : null
}

export interface ErroForma { campo: string; mensagem: string }

/** Validação de negócio (server-side). Lista vazia = ok. */
export function validarForma(b: Record<string, unknown>): ErroForma[] {
  const erros: ErroForma[] = []
  if (!b.name || !String(b.name).trim()) erros.push({ campo: 'name', mensagem: 'Informe o nome.' })
  const parcela = bool(b.permiteParcelas)
  const max = int(b.maxParcelas)
  const min = int(b.minParcelas)
  if (parcela && max !== null && max < 1) erros.push({ campo: 'maxParcelas', mensagem: 'Máximo técnico deve ser ≥ 1.' })
  if (!parcela && max !== null && max > 1) erros.push({ campo: 'maxParcelas', mensagem: 'Sem parcelamento, o máximo técnico é 1.' })
  if (min !== null && min < 1) erros.push({ campo: 'minParcelas', mensagem: 'Mínimo técnico deve ser ≥ 1.' })
  if (min !== null && max !== null && min > max) erros.push({ campo: 'minParcelas', mensagem: 'Mínimo técnico não pode ser maior que o máximo.' })
  if (!bool(b.usoRecebimento, true) && !bool(b.usoPagamento, true)) {
    erros.push({ campo: 'usoRecebimento', mensagem: 'A forma deve servir a recebimentos, a pagamentos, ou a ambos.' })
  }
  const moedas = listaStr(b.moedasAceitas)
  if (moedas.length === 0 && !str(b.moeda, 10)) erros.push({ campo: 'moedasAceitas', mensagem: 'Selecione ao menos uma moeda aceita.' })
  if (bool(b.integracaoAtiva) && !str(b.provedorIntegracao, 120)) {
    erros.push({ campo: 'provedorIntegracao', mensagem: 'Integração ativa exige um provedor.' })
  }
  return erros
}

/**
 * Body → colunas. Só campos conhecidos são gravados.
 * `code` NÃO está aqui de propósito: é gerado pelo CodeGeneratorService na criação
 * e é IMUTÁVEL — nem POST nem PUT aceitam código vindo do cliente.
 */
export function paraColunasForma(b: Record<string, unknown>) {
  const parcela = bool(b.permiteParcelas)
  return {
    // identificação
    name: String(b.name).trim().slice(0, 200),
    type: enumOu(b.type, TIPOS_FORMA) ?? str(b.type, 30), // aceita legado string livre
    descricao: str(b.descricao, 300),
    categoria: enumOu(b.categoria, CATEGORIAS_FORMA),
    icone: str(b.icone, 60),
    ordem: int(b.ordem) ?? 0,
    ativo: bool(b.ativo, true),
    observacoes: str(b.observacoes, 2000),

    // moedas
    moeda: str(b.moeda, 10), // legado preservado (compat/backfill)
    moedasAceitas: listaStr(b.moedasAceitas),

    // parcelamento (só limite TÉCNICO)
    permiteParcelas: parcela,
    minParcelas: int(b.minParcelas) ?? 1,
    maxParcelas: parcela ? int(b.maxParcelas) : null,

    // direção de uso e exigência de adquirente
    exigeAdquirente: bool(b.exigeAdquirente),
    usoRecebimento: bool(b.usoRecebimento, true),
    usoPagamento: bool(b.usoPagamento, true),

    // capacidades do meio
    aceitaEntrada: bool(b.aceitaEntrada),
    aceitaRecorrencia: bool(b.aceitaRecorrencia),
    aceitaMoedaEstrangeira: bool(b.aceitaMoedaEstrangeira),
    permiteCancelamento: bool(b.permiteCancelamento),
    permiteEstorno: bool(b.permiteEstorno),
    permiteReembolso: bool(b.permiteReembolso),
    permiteInternacional: bool(b.permiteInternacional),
    liquidacaoAutomatica: bool(b.liquidacaoAutomatica),
    conciliacaoAutomatica: bool(b.conciliacaoAutomatica),
    permiteComprovante: bool(b.permiteComprovante),
    emissaoAutomatica: bool(b.emissaoAutomatica),
    permiteCobrancaManual: bool(b.permiteCobrancaManual, true),

    // integração
    tipoIntegracao: enumOu(b.tipoIntegracao, TIPOS_INTEGRACAO),
    provedorIntegracao: str(b.provedorIntegracao, 120),
    integracaoAtiva: bool(b.integracaoAtiva),

    // destinos compatíveis (só restringe; a escolha efetiva é da Cobrança)
    carteirasCompativeis: listaInt(b.carteirasCompativeis),
    contasCompativeis: listaInt(b.contasCompativeis),

    // liquidação (informativo)
    prazoLiquidacao: enumOu(b.prazoLiquidacao, PRAZOS_LIQUIDACAO),
    diasLiquidacao: int(b.diasLiquidacao),
    diasCorridos: bool(b.diasCorridos, true),
    permiteAntecipacao: bool(b.permiteAntecipacao),

    // flags de taxa (valores vêm de TaxaPagamento)
    utilizaTaxas: bool(b.utilizaTaxas),
    permiteTaxaAntecipacao: bool(b.permiteTaxaAntecipacao),
    permiteTaxaParcelamento: bool(b.permiteTaxaParcelamento),
    permiteTaxaInternacional: bool(b.permiteTaxaInternacional),
  }
}
