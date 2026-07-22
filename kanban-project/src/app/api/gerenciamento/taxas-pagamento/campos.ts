// src/app/api/gerenciamento/taxas-pagamento/campos.ts
// ============================================================================
// Mapeamento ÚNICO body → colunas de TaxaPagamento (POST e PUT nunca divergem).
// A Taxa é só a REGRA de cálculo — não conhece Receita/Cobrança/Pagamento.
// ============================================================================
import {
  CATEGORIAS_TAXA, APLICA_PARCELA, ANTICIPATION_TYPES, BASE_INCIDENCIA,
  QUEM_ABSORVE, ADQUIRENTES, MOMENTO_CAMBIO,
} from '@/lib/financeiro/taxa-constants'

const str = (v: unknown, max = 300): string | null => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s.slice(0, max)
}
const int = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null
}
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v); return Number.isFinite(n) ? n : null
}
const dataOu = (v: unknown): Date | null => {
  if (!v) return null
  const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d
}
const listaStr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : []
const listaInt = (v: unknown): number[] =>
  Array.isArray(v) ? v.map((x) => Math.trunc(Number(x))).filter((n) => Number.isFinite(n)) : []
const enumOu = (v: unknown, permitidos: readonly string[], padrao: string | null = null): string | null => {
  const s = v == null ? '' : String(v).toUpperCase()
  return permitidos.includes(s) ? s : padrao
}

export interface ErroTaxa { campo: string; mensagem: string }

export function validarTaxa(b: Record<string, unknown>): ErroTaxa[] {
  const erros: ErroTaxa[] = []
  if (!b.name || !String(b.name).trim()) erros.push({ campo: 'name', mensagem: 'Informe o nome.' })
  const ini = dataOu(b.vigenciaInicio), fim = dataOu(b.vigenciaFim)
  if (ini && fim && fim.getTime() < ini.getTime()) erros.push({ campo: 'vigenciaFim', mensagem: 'Fim da vigência anterior ao início.' })
  if (enumOu(b.aplicaParcela, APLICA_PARCELA) === 'FAIXA') {
    const de = int(b.installmentsFrom), ate = int(b.installmentsTo)
    if (de === null || ate === null) erros.push({ campo: 'installmentsFrom', mensagem: 'Faixa de parcelas exige início e fim.' })
    else if (ate < de) erros.push({ campo: 'installmentsTo', mensagem: 'Fim da faixa menor que o início.' })
  }
  return erros
}

/** Body → colunas. Só campos conhecidos. feeType aceita legado (passthrough). */
export function paraColunasTaxa(b: Record<string, unknown>) {
  const feeType = b.feeType ? String(b.feeType) : null // enum na UI, mas preserva legado
  const aplica = enumOu(b.aplicaParcela, APLICA_PARCELA, 'TODAS')
  const antType = enumOu(b.anticipationType, ANTICIPATION_TYPES)
  const temAntecipacao = antType === 'OPCIONAL' || antType === 'OBRIGATORIA' || !!b.anticipationEnabled
  return {
    // identificação
    code: str(b.code, 40),
    name: String(b.name).trim().slice(0, 200),
    descricao: str(b.descricao, 300),
    categoria: enumOu(b.categoria, CATEGORIAS_TAXA),
    ativo: b.ativo === undefined ? true : !!b.ativo,
    prioridade: int(b.prioridade) ?? 0,

    // forma(s)
    formaPagamentoId: int(b.formaPagamentoId), // legado (compat)
    formasAplicaveis: listaInt(b.formasAplicaveis),

    // cálculo
    feeType,
    feePercent: num(b.feePercent),
    fixedFee: num(b.fixedFee),
    // moeda só faz sentido em taxa com valor fixo; percentual independe
    moeda: str(b.moeda, 10),

    // aplicação por parcela
    aplicaParcela: aplica,
    installmentsFrom: aplica === 'FAIXA' ? int(b.installmentsFrom) : null,
    installmentsTo: aplica === 'FAIXA' ? int(b.installmentsTo) : null,

    // antecipação
    anticipationType: antType,
    anticipationEnabled: temAntecipacao,
    anticipationPercent: temAntecipacao ? num(b.anticipationPercent) : null,
    anticipationFixed: temAntecipacao ? num(b.anticipationFixed) : null,
    anticipationMinDays: temAntecipacao ? int(b.anticipationMinDays) : null,

    // incidência e absorção (colunas NÃO-nulas → colapsa o tipo com o default)
    baseIncidencia: enumOu(b.baseIncidencia, BASE_INCIDENCIA, 'TOTAL') ?? 'TOTAL',
    quemAbsorve: enumOu(b.quemAbsorve, QUEM_ABSORVE, 'EMPRESA') ?? 'EMPRESA',
    absorcaoPercentEmpresa: enumOu(b.quemAbsorve, QUEM_ABSORVE) === 'COMPARTILHADA' ? num(b.absorcaoPercentEmpresa) : null,
    adquirente: enumOu(b.adquirente, ADQUIRENTES),

    // regras de aplicação
    paises: listaStr(b.paises),
    moedasAplicaveis: listaStr(b.moedasAplicaveis),
    servicos: listaInt(b.servicos),
    modalidades: listaStr(b.modalidades),
    tiposProcesso: listaStr(b.tiposProcesso),
    valorMinimo: num(b.valorMinimo),
    valorMaximo: num(b.valorMaximo),
    canal: str(b.canal, 60),
    gateway: str(b.gateway, 40),
    perfil: str(b.perfil, 60),

    // câmbio
    momentoCambio: enumOu(b.momentoCambio, MOMENTO_CAMBIO),

    // vigência
    vigenciaInicio: dataOu(b.vigenciaInicio),
    vigenciaFim: dataOu(b.vigenciaFim),
  }
}
