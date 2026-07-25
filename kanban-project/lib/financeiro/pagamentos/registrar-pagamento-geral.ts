// lib/financeiro/pagamentos/registrar-pagamento-geral.ts
// ============================================================================
// Pagamento GERAL da Receita consolidada: NÃO assume um participante. Recebe uma
// ALOCAÇÃO explícita por obrigação (automática = proporcional ao saldo, ou manual)
// e aplica em cada participante, escalando a composição de formas pela fração da
// alocação. Reusa registrarPagamentoComposto por participante (mesmos lançamentos,
// crédito, excedente). A soma das alocações tem de bater com a composição.
// ============================================================================
import { registrarPagamentoComposto, type FormaLinhaEntrada, type PagadorEntrada } from './registrar-pagamento-composto'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface AlocacaoGeral { obrigacaoId: number; valor: number }
export interface AjustesGerais { desconto?: number; juros?: number; multa?: number; acrescimo?: number; creditoUtilizado?: number }
export interface RegistrarPagamentoGeralInput {
  alocacoes: AlocacaoGeral[]
  formas: FormaLinhaEntrada[]
  ajustes?: AjustesGerais | null
  pagador?: PagadorEntrada | null
  observacao?: string | null
  criadoPorId?: number | null
}
export interface RegistrarPagamentoGeralResultado {
  ok: boolean
  erros: string[]
  totalAplicado: number
  porParticipante: { obrigacaoId: number; valor: number; ocorrenciasCriadas: number; saldoRestante: number }[]
}

export async function registrarPagamentoGeral(input: RegistrarPagamentoGeralInput): Promise<RegistrarPagamentoGeralResultado> {
  const vazio: RegistrarPagamentoGeralResultado = { ok: false, erros: [], totalAplicado: 0, porParticipante: [] }
  const formas = (input.formas ?? []).filter((f) => cent(f.valor) > 0)
  const alocacoes = (input.alocacoes ?? []).filter((a) => cent(a.valor) > 0)
  if (!formas.length) return { ...vazio, erros: ['Informe ao menos uma forma de pagamento com valor.'] }
  if (!alocacoes.length) return { ...vazio, erros: ['Informe a alocação por participante.'] }

  const totalFormas = cent(formas.reduce((s, f) => s + cent(f.valor), 0))
  const totalAloc = cent(alocacoes.reduce((s, a) => s + cent(a.valor), 0))
  if (Math.abs(totalFormas - totalAloc) > 0.01) {
    return { ...vazio, erros: [`A soma das alocações (${totalAloc}) deve ser igual ao total informado (${totalFormas}).`] }
  }

  // Ajustes do nível-Receita são RATEADOS por participante (fração da alocação) e passados
  // ao composto de cada um — cada cobrança registra o SEU desconto/juros/multa/acréscimo/crédito
  // (rastreabilidade por cobrança; nunca aplicado silenciosamente a outra). Preview = backend.
  const aj = input.ajustes ?? {}
  const scale = (v: number | undefined, frac: number) => cent(Math.max(0, Number(v ?? 0)) * frac)
  const porParticipante: RegistrarPagamentoGeralResultado['porParticipante'] = []
  const erros: string[] = []
  for (const a of alocacoes) {
    const fracao = totalAloc > 0 ? cent(a.valor) / totalAloc : 0
    const formasEscaladas = formas.map((f) => ({ ...f, valor: cent(f.valor * fracao) }))
    const r = await registrarPagamentoComposto({
      obrigacaoId: a.obrigacaoId, formas: formasEscaladas, pagador: input.pagador ?? null,
      ajustes: { desconto: scale(aj.desconto, fracao), juros: scale(aj.juros, fracao), multa: scale(aj.multa, fracao), acrescimo: scale(aj.acrescimo, fracao), creditoUtilizado: scale(aj.creditoUtilizado, fracao) },
      observacao: [input.observacao, '[Pagamento geral da Receita]'].filter(Boolean).join(' '),
      excedenteTratamento: 'CREDITO', saldoSelecionado: a.valor,
      criadoPorId: input.criadoPorId ?? null,
    })
    if (!r.ok) { erros.push(...r.erros); continue }
    porParticipante.push({ obrigacaoId: a.obrigacaoId, valor: cent(a.valor), ocorrenciasCriadas: r.ocorrenciasCriadas, saldoRestante: r.saldoRestante })
  }
  if (erros.length && !porParticipante.length) return { ...vazio, erros: [...new Set(erros)] }
  return { ok: true, erros: [...new Set(erros)], totalAplicado: cent(porParticipante.reduce((s, p) => s + p.valor, 0)), porParticipante }
}
