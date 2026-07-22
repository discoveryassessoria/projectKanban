// src/app/api/gerenciamento/condicoes-pagamento/campos.ts
// ============================================================================
// Mapeamento ÚNICO body → colunas de CondicaoPagamento. Usado pelo POST (criar
// / nova versão) e pelo PUT (editar), para os dois nunca divergirem.
//
// Enums espelham os tipos do motor (lib/financeiro/condicao-pagamento.ts). Só o
// que passa pela validação é gravado — o restante do body é ignorado.
// ============================================================================

export const MOEDAS = ['BRL', 'EUR', 'USD']
export const FORMAS = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'DINHEIRO', 'CHEQUE', 'OUTRO']

export const TIPOS_PAGAMENTO = ['AVISTA', 'PARCELADO']
export const PERIODICIDADES = ['SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADA']
export const INICIOS = ['IMEDIATA', 'DIAS', 'DATA_ESPECIFICA']
export const AJUSTES_DIA_UTIL = ['NENHUM', 'ULTIMO_DIA_UTIL', 'PROXIMO_DIA_UTIL']
// Distribuição — inclui os modos novos (primeira/última maior, entrada fixa/percentual).
export const DISTRIBUICOES = ['IGUAIS', 'ULTIMA_AJUSTA', 'PRIMEIRA_DIFERENCIADA', 'PRIMEIRA_MAIOR', 'ULTIMA_MAIOR', 'ENTRADA_FIXA', 'ENTRADA_PERCENTUAL', 'ENTRADA_SALDO', 'PERSONALIZADO']
// Política Cambial (SUGESTÃO — a decisão efetiva é da Cobrança). Valores legados preservados.
export const POLITICAS_CAMBIO = ['PADRAO_SISTEMA', 'SUGERIR_VARIAVEL', 'SUGERIR_TRAVA', 'FIXO', 'VARIAVEL', 'CONTRATACAO', 'RECEBIMENTO']
export const APLICA_A = ['RECEITA', 'CUSTO', 'AMBOS'] // rótulos na UI: Contas a Receber | Contas a Pagar | Ambos

// ── novos enums (regra reutilizável) ──
export const POLITICAS_TAXAS = ['IGNORAR', 'REPASSAR', 'ABSORVER', 'ESCOLHER_NA_COBRANCA']
export const ENTRADA_TIPOS = ['PERCENTUAL', 'VALOR_FIXO']
export const DIA_INEXISTENTE = ['ULTIMO_DIA', 'PROX_UTIL', 'ANT_UTIL']
export const AJUSTE_DATA = ['MANTER', 'PROX_UTIL', 'ANT_UTIL']
export const MULTA_TIPOS = ['FIXA', 'PERCENTUAL']
export const JUROS_TIPOS = ['SIMPLES', 'COMPOSTO']
export const JUROS_PERIODOS = ['DIARIO', 'MENSAL']
export const DESCONTO_TIPOS = ['COMERCIAL', 'ANTECIPACAO']

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export function inteiro(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.trunc(n)
}
export function data(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}
export function lista(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(',').map((x) => x.trim()).filter(Boolean)
  return []
}
function enumOu<T extends string>(v: unknown, permitidos: readonly string[], padrao: T): T {
  const s = v == null ? '' : String(v).toUpperCase()
  return (permitidos.includes(s) ? s : padrao) as T
}

export interface ErroValidacao { campo: string; mensagem: string }

/** Valida o body. Devolve lista vazia quando está tudo certo. */
export function validar(b: Record<string, unknown>): ErroValidacao[] {
  const erros: ErroValidacao[] = []
  if (!b.name || !String(b.name).trim()) erros.push({ campo: 'name', mensagem: 'Nome é obrigatório' })
  if (b.moeda && !MOEDAS.includes(String(b.moeda))) erros.push({ campo: 'moeda', mensagem: 'Moeda inválida' })
  if (b.formaPagamento && !FORMAS.includes(String(b.formaPagamento))) {
    erros.push({ campo: 'formaPagamento', mensagem: 'Forma de pagamento inválida' })
  }

  const min = inteiro(b.parcelasMin)
  const max = inteiro(b.parcelasMax)
  const padrao = inteiro(b.parcelasPadrao)
  if (min !== null && min < 1) erros.push({ campo: 'parcelasMin', mensagem: 'Mínimo deve ser ≥ 1' })
  if (min !== null && max !== null && max < min) {
    erros.push({ campo: 'parcelasMax', mensagem: 'Máximo não pode ser menor que o mínimo' })
  }
  if (padrao !== null && min !== null && padrao < min) {
    erros.push({ campo: 'parcelasPadrao', mensagem: 'Padrão não pode ser menor que o mínimo' })
  }
  if (padrao !== null && max !== null && padrao > max) {
    erros.push({ campo: 'parcelasPadrao', mensagem: 'Padrão não pode ser maior que o máximo' })
  }

  const pct = num(b.percentEntrada)
  if (pct !== null && (pct < 0 || pct > 100)) erros.push({ campo: 'percentEntrada', mensagem: 'Entrada deve estar entre 0 e 100%' })

  const dia = inteiro(b.diaFixo ?? b.diaVencimento)
  if (dia !== null && (dia < 1 || dia > 31)) erros.push({ campo: 'diaFixo', mensagem: 'Dia fixo deve estar entre 1 e 31' })

  const ini = data(b.vigenciaInicio)
  const fim = data(b.vigenciaFim)
  if (ini && fim && fim.getTime() < ini.getTime()) {
    erros.push({ campo: 'vigenciaFim', mensagem: 'Fim da vigência não pode ser anterior ao início' })
  }

  if (String(b.periodicidade ?? '').toUpperCase() === 'PERSONALIZADA') {
    const d = inteiro(b.periodicidadeDias)
    if (d === null || d < 1) erros.push({ campo: 'periodicidadeDias', mensagem: 'Informe o intervalo em dias' })
  }
  return erros
}

/** Body → colunas. Só campos conhecidos; o motor consome exatamente estes. */
export function paraColunas(b: Record<string, unknown>) {
  const parcelas = inteiro(b.parcelas)
  return {
    // identificação
    name: String(b.name).trim(),
    codigo: b.codigo ? String(b.codigo).trim().slice(0, 40) : null,
    descricao: b.descricao ? String(b.descricao) : null,
    moeda: (MOEDAS.includes(String(b.moeda)) ? String(b.moeda) : 'BRL') as 'BRL' | 'EUR' | 'USD',
    formaPagamento: (b.formaPagamento && FORMAS.includes(String(b.formaPagamento)) ? String(b.formaPagamento) : null) as never,
    carteiraId: inteiro(b.carteiraId),
    ativo: b.ativo === undefined ? true : !!b.ativo,
    observacoes: b.observacoes ? String(b.observacoes) : null,

    // vigência
    vigenciaInicio: data(b.vigenciaInicio),
    vigenciaFim: data(b.vigenciaFim),

    // parcelamento
    tipoPagamento: enumOu(b.tipoPagamento, TIPOS_PAGAMENTO, 'PARCELADO'),
    temEntrada: !!b.temEntrada,
    entradaObrigatoria: !!b.entradaObrigatoria,
    percentEntrada: num(b.percentEntrada),
    valorEntradaFixo: num(b.valorEntradaFixo),
    parcelas: parcelas && parcelas > 0 ? parcelas : 1,
    parcelasMin: inteiro(b.parcelasMin),
    parcelasMax: inteiro(b.parcelasMax),
    parcelasPadrao: inteiro(b.parcelasPadrao),
    permiteParcelasPersonalizadas: !!b.permiteParcelasPersonalizadas,
    permiteEdicaoManual: !!b.permiteEdicaoManual,

    // cronograma
    inicioCronograma: enumOu(b.inicioCronograma, INICIOS, 'IMEDIATA'),
    primeiraParcelaDias: inteiro(b.primeiraParcelaDias),
    primeiraParcelaData: data(b.primeiraParcelaData),
    periodicidade: enumOu(b.periodicidade, PERIODICIDADES, 'MENSAL'),
    periodicidadeDias: inteiro(b.periodicidadeDias),
    diaFixo: inteiro(b.diaFixo ?? b.diaVencimento),
    diaVencimento: inteiro(b.diaVencimento ?? b.diaFixo),
    ajusteDiaUtil: enumOu(b.ajusteDiaUtil, AJUSTES_DIA_UTIL, 'NENHUM'),
    ajustarFimDeSemana: !!b.ajustarFimDeSemana,
    ajustarFeriados: !!b.ajustarFeriados,

    // distribuição
    distribuicao: enumOu(b.distribuicao, DISTRIBUICOES, 'ULTIMA_AJUSTA'),
    primeiraParcelaPercent: num(b.primeiraParcelaPercent),

    // encargos
    multaPercent: num(b.multaPercent),
    jurosMesPercent: num(b.jurosMesPercent),
    descontoPercent: num(b.descontoPercent),
    descontoAntecipacaoPercent: num(b.descontoAntecipacaoPercent),
    descontoAVistaPercent: num(b.descontoAVistaPercent),

    // câmbio
    politicaCambio: enumOu(b.politicaCambio, POLITICAS_CAMBIO, 'VARIAVEL'),
    travaCambial: !!b.travaCambial,

    // taxas
    aplicarTaxas: !!b.aplicarTaxas,

    // restrições
    aplicaA: enumOu(b.aplicaA, APLICA_A, 'AMBOS'),
    moedasPermitidas: lista(b.moedasPermitidas),
    valorMinimo: num(b.valorMinimo),
    valorMaximo: num(b.valorMaximo),
    paises: lista(b.paises),
    modalidades: lista(b.modalidades),
    tiposProcesso: lista(b.tiposProcesso),
  }
}

/**
 * Campos cuja alteração muda o CRONOGRAMA de lançamentos futuros. Se a condição
 * já foi usada, mexer neles exige NOVA VERSÃO — o histórico fica intacto.
 */
export const CAMPOS_ESTRUTURAIS = [
  'tipoPagamento', 'temEntrada', 'percentEntrada', 'valorEntradaFixo',
  'parcelas', 'parcelasMin', 'parcelasMax', 'parcelasPadrao',
  'inicioCronograma', 'primeiraParcelaDias', 'primeiraParcelaData',
  'periodicidade', 'periodicidadeDias', 'diaFixo', 'ajusteDiaUtil',
  'ajustarFimDeSemana', 'distribuicao', 'primeiraParcelaPercent',
  'multaPercent', 'jurosMesPercent', 'descontoPercent',
  'descontoAntecipacaoPercent', 'descontoAVistaPercent',
  'politicaCambio', 'travaCambial',
] as const

/** Houve mudança estrutural entre o registro atual e o novo payload? */
export function mudouEstrutura(atual: Record<string, unknown>, novo: Record<string, unknown>): string[] {
  const mudou: string[] = []
  for (const c of CAMPOS_ESTRUTURAIS) {
    const a = atual[c]
    const b = novo[c]
    const na = a == null ? null : typeof a === 'object' ? String(a) : a
    const nb = b == null ? null : typeof b === 'object' ? String(b) : b
    if (String(na) !== String(nb)) mudou.push(c)
  }
  return mudou
}
