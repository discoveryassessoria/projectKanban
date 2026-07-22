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
export function listaInt(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n))
  return []
}
function enumOu(v: unknown, permitidos: readonly string[], padrao: string): string {
  const s = v == null ? '' : String(v).toUpperCase()
  return permitidos.includes(s) ? s : padrao
}
/** Igual a enumOu, mas devolve null quando não bate (campos opcionais). */
function enumN(v: unknown, permitidos: readonly string[]): string | null {
  const s = v == null ? '' : String(v).toUpperCase()
  return permitidos.includes(s) ? s : null
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

  // Vigência: ambas opcionais. Sem início = vale imediatamente; sem fim =
  // indeterminada. Fim anterior ao início é sempre inválido.
  const ini = data(b.vigenciaInicio)
  const fim = data(b.vigenciaFim)
  if (ini && fim && fim.getTime() < ini.getTime()) {
    erros.push({ campo: 'vigenciaFim', mensagem: 'Fim da vigência não pode ser anterior ao início' })
  }

  // Faixa de valor: ambas opcionais; mínimo nunca negativo; máximo ≥ mínimo.
  const vMin = num(b.valorMinimo)
  const vMax = num(b.valorMaximo)
  if (vMin !== null && vMin < 0) erros.push({ campo: 'valorMinimo', mensagem: 'Valor mínimo não pode ser negativo' })
  if (vMax !== null && vMax < 0) erros.push({ campo: 'valorMaximo', mensagem: 'Valor máximo não pode ser negativo' })
  if (vMin !== null && vMax !== null && vMax < vMin) {
    erros.push({ campo: 'valorMaximo', mensagem: 'Valor máximo não pode ser menor que o mínimo' })
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
    // `codigo` NÃO entra aqui: é gerado pelo CodeGeneratorService no create e é
    // IMUTÁVEL depois. A rota decide o valor; o body nunca o define.
    name: String(b.name).trim(),
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

    // câmbio — POLÍTICA (sugestão); a Cobrança decide de fato. travaCambial derivado.
    politicaCambio: enumOu(b.politicaCambio, POLITICAS_CAMBIO, 'PADRAO_SISTEMA'),
    travaCambial: String(b.politicaCambio ?? '').toUpperCase() === 'SUGERIR_TRAVA' || !!b.travaCambial,

    // taxas — POLÍTICA (a taxa depende da Forma escolhida na Cobrança). aplicarTaxas derivado.
    politicaTaxas: enumOu(b.politicaTaxas, POLITICAS_TAXAS, 'IGNORAR'),
    aplicarTaxas: enumOu(b.politicaTaxas, POLITICAS_TAXAS, 'IGNORAR') !== 'IGNORAR',

    // forma/entrada sugeridas
    formaSugeridaId: inteiro(b.formaSugeridaId),
    entradaTipo: enumN(b.entradaTipo, ENTRADA_TIPOS),
    entradaMin: num(b.entradaMin),
    entradaMax: num(b.entradaMax),
    entradaCompoeTotal: b.entradaCompoeTotal === undefined ? true : !!b.entradaCompoeTotal,
    entradaAdicional: !!b.entradaAdicional,

    // cronograma — comportamentos explícitos
    diaInexistente: enumN(b.diaInexistente, DIA_INEXISTENTE),
    comportamentoFimSemana: enumN(b.comportamentoFimSemana, AJUSTE_DATA),
    comportamentoFeriado: enumN(b.comportamentoFeriado, AJUSTE_DATA),

    // encargos expandidos
    multaTipo: enumN(b.multaTipo, MULTA_TIPOS),
    multaValor: num(b.multaValor),
    jurosTipo: enumN(b.jurosTipo, JUROS_TIPOS),
    jurosPeriodo: enumN(b.jurosPeriodo, JUROS_PERIODOS),
    carenciaDias: inteiro(b.carenciaDias),
    descontoTipo: enumN(b.descontoTipo, DESCONTO_TIPOS),
    descontoAntecipacaoAuto: !!b.descontoAntecipacaoAuto,
    quemConcedeDesconto: b.quemConcedeDesconto ? String(b.quemConcedeDesconto).slice(0, 40) : null,

    // restrições / aplicabilidade
    //
    // moedasPermitidas / paises / modalidades / servicos NÃO são mais escritos
    // aqui: viraram RELACIONAMENTO REAL (CondicaoPagamentoMoeda/Pais/Modalidade/
    // Servico). As rotas gravam esses arrays como PROJEÇÃO derivada dos vínculos
    // — ver lib/financeiro/condicao-aplicabilidade.ts. Assim o motor de cálculo
    // (condicaoAplicavel) segue intacto e o histórico é preservado.
    //
    // perfil / canal saíram da UI e do payload: não controlam comportamento
    // nenhum no motor. As colunas e os dados históricos permanecem no banco.
    aplicaA: enumOu(b.aplicaA, APLICA_A, 'AMBOS'),
    valorMinimo: num(b.valorMinimo),
    valorMaximo: num(b.valorMaximo),
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
  // regra reutilizável (expansão)
  'entradaTipo', 'entradaMin', 'entradaMax', 'entradaCompoeTotal', 'entradaAdicional',
  'diaInexistente', 'comportamentoFimSemana', 'comportamentoFeriado',
  'multaTipo', 'multaValor', 'jurosTipo', 'jurosPeriodo', 'carenciaDias',
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
