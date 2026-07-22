// lib/financeiro/financial-configuration-service.ts
// ============================================================================
// FinancialConfigurationService — FONTE ÚNICA de configuração financeira para
// consumo (wizard de Cobrança etc.). Lê EXATAMENTE os mesmos cadastros de
// Gerenciamento → Financeiro (Formas, Condições, Taxas, Contas, Carteiras, Bancos,
// Moedas). NUNCA duplica: entrega só os registros oficiais + seus IDs. O Processo
// nunca consulta várias tabelas soltas — tudo vem daqui.
// ============================================================================
import { prisma } from '@/lib/prisma'

export interface ConfiguracaoFinanceira {
  formasPagamento: {
    id: number; code: string | null; name: string; icone: string | null; type: string | null
    permiteParcelas: boolean; maxParcelas: number | null; moeda: string | null; moedasAceitas: string[]; ativo: boolean
    aceitaEntrada: boolean; aceitaRecorrencia: boolean; permiteInternacional: boolean
    carteirasCompativeis: number[]; contasCompativeis: number[]; prazoLiquidacao: string | null
  }[]
  condicoesPagamento: {
    id: number; name: string; codigo: string | null; versao: number; moeda: string; ativo: boolean
    tipoPagamento: string; parcelas: number; parcelasMin: number | null; parcelasMax: number | null; parcelasPadrao: number | null
    temEntrada: boolean; periodicidade: string; aplicaA: string
    // formasPermitidas: vazio = SEM RESTRIÇÃO (qualquer forma ativa compatível).
    // formaPadraoId: sugestão inicial da cobrança (pode ser trocada).
    formasPermitidas: number[]; formaPadraoId: number | null; taxasVinculadas: number[]; carteiraId: number | null
  }[]
  taxasPagamento: { id: number; code: string | null; name: string; feeType: string | null; feePercent: number | null; fixedFee: number | null; ativo: boolean }[]
  contasBancarias: { id: number; nome: string; moeda: string; banco: string | null; isDefaultReceiving: boolean }[]
  carteiras: { id: number; nome: string; moeda: string; contaBancariaId: number | null; contaNome: string | null; isDefault: boolean }[]
  bancos: { id: number; nome: string; sigla: string | null }[]
  moedas: { id: number; code: string; name: string }[]
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

/** Agrega TODA a configuração financeira oficial (ativa por padrão). */
export async function obterConfiguracaoFinanceira(opts?: { incluirInativos?: boolean }): Promise<ConfiguracaoFinanceira> {
  const soAtivos = opts?.incluirInativos ? {} : { ativo: true }
  const [formas, condicoes, taxas, contas, carteiras, bancos, moedas] = await Promise.all([
    prisma.formaPagamentoCadastro.findMany({ where: soAtivos, orderBy: [{ ordem: 'asc' }, { name: 'asc' }] }),
    prisma.condicaoPagamento.findMany({
      where: soAtivos,
      include: { carteira: { select: { id: true } }, formasPermitidas: { select: { formaId: true } }, taxasVinculadas: { select: { taxaId: true } } },
      orderBy: [{ name: 'asc' }, { versao: 'desc' }],
    }),
    prisma.taxaPagamento.findMany({ where: soAtivos, orderBy: { name: 'asc' } }),
    prisma.contaBancaria.findMany({ where: opts?.incluirInativos ? {} : { ativo: true }, include: { bank: { select: { nome: true } } }, orderBy: [{ isDefaultReceiving: 'desc' }, { nome: 'asc' }] }),
    prisma.carteiraRecebimento.findMany({ where: soAtivos, include: { contaBancaria: { select: { id: true, nome: true } } }, orderBy: [{ isDefault: 'desc' }, { nome: 'asc' }] }),
    prisma.banco.findMany({ where: soAtivos, orderBy: { nome: 'asc' }, select: { id: true, nome: true, sigla: true } }),
    prisma.moedaCadastro.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } }).catch(() => []),
  ])

  return {
    formasPagamento: formas.map((f) => ({
      id: f.id, code: f.code, name: f.name, icone: f.icone, type: f.type,
      permiteParcelas: f.permiteParcelas, maxParcelas: f.maxParcelas, moeda: f.moeda,
      moedasAceitas: f.moedasAceitas?.length ? f.moedasAceitas : (f.moeda ? [f.moeda] : []),
      ativo: f.ativo, aceitaEntrada: f.aceitaEntrada, aceitaRecorrencia: f.aceitaRecorrencia,
      permiteInternacional: f.permiteInternacional, carteirasCompativeis: f.carteirasCompativeis ?? [],
      contasCompativeis: f.contasCompativeis ?? [], prazoLiquidacao: f.prazoLiquidacao,
    })),
    condicoesPagamento: condicoes.map((c) => ({
      id: c.id, name: c.name, codigo: c.codigo, versao: c.versao, moeda: String(c.moeda), ativo: c.ativo,
      tipoPagamento: c.tipoPagamento, parcelas: c.parcelas, parcelasMin: c.parcelasMin, parcelasMax: c.parcelasMax, parcelasPadrao: c.parcelasPadrao,
      temEntrada: c.temEntrada, periodicidade: c.periodicidade, aplicaA: c.aplicaA,
      formasPermitidas: c.formasPermitidas.map((x) => x.formaId), formaPadraoId: c.formaSugeridaId ?? null,
      taxasVinculadas: c.taxasVinculadas.map((x) => x.taxaId), carteiraId: c.carteiraId,
    })),
    taxasPagamento: taxas.map((t) => ({ id: t.id, code: t.code, name: t.name, feeType: t.feeType, feePercent: num(t.feePercent), fixedFee: num(t.fixedFee), ativo: t.ativo })),
    contasBancarias: contas.map((c) => ({ id: c.id, nome: c.nome, moeda: String(c.moeda), banco: c.bank?.nome ?? c.banco ?? null, isDefaultReceiving: c.isDefaultReceiving })),
    carteiras: carteiras.map((w) => ({ id: w.id, nome: w.nome, moeda: String(w.moeda), contaBancariaId: w.contaBancariaId, contaNome: w.contaBancaria?.nome ?? null, isDefault: w.isDefault })),
    bancos: bancos.map((b) => ({ id: b.id, nome: b.nome, sigla: b.sigla })),
    moedas: (moedas as any[]).map((m) => ({ id: m.id, code: m.code, name: m.name })),
  }
}
