// lib/financeiro/pagamentos/registrar-pagamento-geral.ts
// ============================================================================
// Pagamento GERAL da Receita consolidada: NÃO assume um participante. Recebe uma
// ALOCAÇÃO explícita por obrigação (automática = proporcional ao saldo, ou manual)
// e aplica em cada participante, escalando a composição de formas pela fração da
// alocação. Reusa registrarPagamentoComposto por participante (mesmos lançamentos,
// crédito, excedente). A soma das alocações tem de bater com a composição.
// ============================================================================
import { registrarPagamentoComposto, type FormaLinhaEntrada, type PagadorEntrada } from './registrar-pagamento-composto'
import { ratearBrlPorBase } from '@/lib/financeiro/dominio/cambio'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface AlocacaoGeral { obrigacaoId: number; valor: number }
export interface AjustesGerais { desconto?: number; juros?: number; multa?: number; acrescimo?: number; creditoUtilizado?: number }
export interface RegistrarPagamentoGeralInput {
  alocacoes: AlocacaoGeral[]
  formas: FormaLinhaEntrada[]
  ajustes?: AjustesGerais | null
  pagador?: PagadorEntrada | null
  observacao?: string | null
  idempotencyKey?: string | null
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
  // Cada FORMA e cada AJUSTE do nível-Receita é repartido entre participantes por
  // ratearBrlPorBase (proporcional à alocação, RESÍDUO determinístico no maior): a soma
  // por forma/ajuste bate EXATAMENTE com o total (sem perder/criar centavos no rateio).
  const bases = alocacoes.map((a) => cent(a.valor))
  const formaSplits = formas.map((f) => ratearBrlPorBase(bases, cent(f.valor)))
  const ajusteSplit = (v: number | undefined) => ratearBrlPorBase(bases, cent(Math.max(0, Number(v ?? 0))))
  const descS = ajusteSplit(aj.desconto), jurosS = ajusteSplit(aj.juros), multaS = ajusteSplit(aj.multa), acrS = ajusteSplit(aj.acrescimo), credS = ajusteSplit(aj.creditoUtilizado)
  const porParticipante: RegistrarPagamentoGeralResultado['porParticipante'] = []
  const erros: string[] = []
  for (let i = 0; i < alocacoes.length; i++) {
    const a = alocacoes[i]
    const formasEscaladas = formas.map((f, fi) => ({ ...f, valor: formaSplits[fi][i] }))
    const r = await registrarPagamentoComposto({
      obrigacaoId: a.obrigacaoId, formas: formasEscaladas, pagador: input.pagador ?? null,
      ajustes: { desconto: descS[i], juros: jurosS[i], multa: multaS[i], acrescimo: acrS[i], creditoUtilizado: credS[i] },
      observacao: [input.observacao, '[Pagamento geral da Receita]'].filter(Boolean).join(' '),
      excedenteTratamento: 'CREDITO', saldoSelecionado: a.valor,
      // idempotência determinística por participante (o composto é atômico/idempotente):
      // repetir o pagamento geral com a mesma chave não duplica nenhum participante.
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:p${a.obrigacaoId}` : null,
      criadoPorId: input.criadoPorId ?? null,
    })
    if (!r.ok) { erros.push(...r.erros); continue }
    porParticipante.push({ obrigacaoId: a.obrigacaoId, valor: cent(a.valor), ocorrenciasCriadas: r.ocorrenciasCriadas, saldoRestante: r.saldoRestante })
  }
  if (erros.length && !porParticipante.length) return { ...vazio, erros: [...new Set(erros)] }
  return { ok: true, erros: [...new Set(erros)], totalAplicado: cent(porParticipante.reduce((s, p) => s + p.valor, 0)), porParticipante }
}
