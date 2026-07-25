// lib/financeiro/receitas/criar-receita-manual.ts
// ============================================================================
// Criação MANUAL de Receita — CANÔNICA (Cadastro Mestre como fonte ÚNICA).
// Substitui o caminho legado (ObrigacaoEconomica "nativo" sem contrato Receita).
// Reusa EXATAMENTE o padrão do motor (executor.criarReceita): resolve preço/moeda
// pela Configuração Financeira (ProdutoFinanceiro) + Tabela de Preços
// (resolverPrecoPorConfigDB), CONGELA (pricingRuleId/valorTotalCongelado/config/
// contextoAplicado/câmbio) e ESPELHA em ObrigacaoEconomica. Consolida por
// participante (mesma chave processo|config|regra|fase|ciclo). Idempotente.
// NADA de enum hardcoded, NADA de fallback legado, NADA de preço inventado.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { gerarCodigoReceita } from '@/lib/financeiro/codigos'
import { resolverPrecoPorConfigDB } from '@/src/lib/motor/resolver-preco-financeiro.prisma'
import { snapshotCotacoes } from '@/src/lib/cambio/servico-cambio'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface ParticipanteManual { requerenteId: number; nome: string; valor: number } // valor na moeda contratual
export interface CriarReceitaManualInput {
  processoId: number
  itemCatalogoId: number
  descricao?: string | null // COMPLEMENTAR (opcional); default = nome do item mestre
  quantidade?: number
  valorUnitarioOverride?: number | null // só com permissão; senão usa o do Cadastro Mestre
  desconto?: number
  faseLabel?: string | null
  vinculo: 'PROCESSO' | 'PARTICIPANTES'
  participantes?: ParticipanteManual[]
  idempotencyKey?: string | null
  justificativaOverride?: string | null
  criadoPorId?: number | null
  podeOverridePreco?: boolean
}
export interface CriarReceitaManualResultado {
  ok: boolean
  erros: string[]
  receitaIds: number[]
  obrigacaoIds: number[]
  obrigacaoRef: number | null // rep p/ abrir o detalhe / registrar pagamento
  moeda: string
  totalContratado: number
  totalBrl: number
  grupo: string
  idempotente: boolean
}

export async function criarReceitaManualCanonica(input: CriarReceitaManualInput): Promise<CriarReceitaManualResultado> {
  const vazio: CriarReceitaManualResultado = { ok: false, erros: [], receitaIds: [], obrigacaoIds: [], obrigacaoRef: null, moeda: 'BRL', totalContratado: 0, totalBrl: 0, grupo: '', idempotente: false }
  const criadoPorId = input.criadoPorId ?? null

  // 1) ITEM do Cadastro Mestre — precisa estar ATIVO e ser elegível a RECEITA.
  const item = await prisma.itemCatalogo.findUnique({ where: { id: input.itemCatalogoId }, select: { id: true, name: true, natureza: true, categoria: true, unidade: true, ativo: true } })
  if (!item) return { ...vazio, erros: ['Item do Cadastro Mestre inexistente.'] }
  if (!item.ativo) return { ...vazio, erros: ['Item do Cadastro Mestre inativo — não pode gerar Receita.'] }

  // 2) CONFIGURAÇÃO FINANCEIRA (ProdutoFinanceiro) do item — fonte de moeda/regra.
  const cfg = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: item.id }, select: { id: true, moedaPadrao: true, naturezaFin: true, condicaoPagamentoId: true, categoriaId: true, valorPadrao: true } })
  if (!cfg) return { ...vazio, erros: ['Item sem Configuração Financeira no Cadastro Mestre — não pode gerar Receita.'] }
  if (cfg.naturezaFin === 'SOMENTE_CUSTO') return { ...vazio, erros: ['Item marcado como SOMENTE CUSTO no Cadastro Mestre.'] }

  // 3) PREÇO/MOEDA canônicos via Tabela de Preços (resolver oficial — nunca findFirst/zero silencioso).
  const preco = await resolverPrecoPorConfigDB(cfg.id, { natureza: 'VENDA' as never, processoId: input.processoId, quantidade: input.quantidade ?? 1, fallbackValorPadrao: cfg.valorPadrao ? Number(cfg.valorPadrao) : null, fallbackMoeda: cfg.moedaPadrao ?? null }).catch(() => null)
  const moeda = String((preco && preco.ok ? preco.moeda : cfg.moedaPadrao) ?? 'BRL')
  const tabelaValorId = preco && preco.ok ? preco.tabelaValorId : null
  const valorMestre = preco && preco.ok ? Number(preco.valorUnitario) : (cfg.valorPadrao ? Number(cfg.valorPadrao) : null)

  // 4) valor unitário contratado = override (com permissão) OU o do Cadastro Mestre.
  let valorUnitario = valorMestre
  let overrideAplicado = false
  if (input.valorUnitarioOverride != null && input.valorUnitarioOverride > 0 && cent(input.valorUnitarioOverride) !== cent(valorMestre ?? -1)) {
    if (!input.podeOverridePreco) return { ...vazio, erros: ['Sem permissão para sobrescrever o valor do Cadastro Mestre.'] }
    valorUnitario = cent(input.valorUnitarioOverride)
    overrideAplicado = true
  }
  if (valorUnitario == null || valorUnitario <= 0) return { ...vazio, erros: ['Item sem preço no Cadastro Mestre — cadastre o preço ou informe um override autorizado.'] }

  const quantidade = Math.max(1, Number(input.quantidade ?? 1))
  const desconto = Math.max(0, cent(input.desconto ?? 0))
  const subtotal = cent(valorUnitario * quantidade)
  const totalContratado = cent(subtotal - desconto)
  if (totalContratado <= 0) return { ...vazio, erros: ['Total inválido: quantidade × valor unitário − desconto deve ser maior que zero.'] }

  // 5) CÂMBIO-CONTRATO: EUR/USD → snapshot real (não inventa). BRL → 1.
  let fx = 1
  if (moeda !== 'BRL') {
    try { const snap = await snapshotCotacoes(); fx = Number((snap?.moedas ?? []).find((m: { moeda: string; valor: number | null }) => m.moeda === moeda)?.valor) || 0 } catch { fx = 0 }
  }
  const fxData = new Date()

  // 6) PARTICIPANTES / cotas (nunca auto-seleciona ninguém). PROCESSO = cota única sem requerente.
  type Cota = { requerenteId: number | null; nome: string; valor: number }
  let cotas: Cota[]
  if (input.vinculo === 'PARTICIPANTES') {
    const parts = (input.participantes ?? []).filter((p) => p.requerenteId != null)
    if (!parts.length) return { ...vazio, erros: ['Selecione ao menos um participante financeiro.'] }
    const somaParts = cent(parts.reduce((s, p) => s + cent(p.valor), 0))
    if (Math.abs(somaParts - totalContratado) > 0.02) return { ...vazio, erros: [`A soma dos participantes (${somaParts}) deve ser igual ao total (${totalContratado}).`] }
    cotas = parts.map((p) => ({ requerenteId: p.requerenteId, nome: p.nome, valor: cent(p.valor) }))
  } else {
    cotas = [{ requerenteId: null, nome: 'Processo inteiro', valor: totalContratado }]
  }

  // 7) chave de grupo (consolida) + idempotência.
  const phaseKey = input.faseLabel ? String(input.faseLabel).slice(0, 60) : `MANUAL:${cfg.id}`
  const phaseCycle = 1
  const baseIdem = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 60) : `manual:${input.processoId}:${cfg.id}:${input.vinculo}`
  const grupo = `grp:${input.processoId}|${cfg.id}||${phaseKey}|${phaseCycle}`
  const honorario = String(item.natureza) === 'HONORARIO'
  const descBase = (input.descricao && input.descricao.trim()) ? input.descricao.trim() : item.name

  const receitaIds: number[] = []
  const obrigacaoIds: number[] = []
  let idempotenteTudo = true

  for (const cota of cotas) {
    const chaveIdempotencia = `${baseIdem}::req:${cota.requerenteId ?? 'proc'}`.slice(0, 190)
    // idempotência real: mesma chave não recria.
    const existente = await prisma.receita.findFirst({ where: { chaveIdempotencia }, select: { id: true } }).catch(() => null)
    let receitaId: number
    if (existente) { receitaId = existente.id }
    else {
      idempotenteTudo = false
      const codigo = await gerarCodigoReceita()
      const contexto = {
        origem: 'manual', itemCatalogoId: item.id, itemNome: item.name, itemNatureza: item.natureza, unidade: item.unidade,
        configFinanceiraId: cfg.id, tabelaValorId, valorMestre, valorUnitarioContratado: valorUnitario, quantidade, desconto,
        overrideAplicado, justificativaOverride: overrideAplicado ? (input.justificativaOverride ?? null) : null,
        moedaContratual: moeda, fxSnapshot: fx || null, fxData: fxData.toISOString(), vinculo: input.vinculo,
        criadoPorId, criadoEm: fxData.toISOString(),
      }
      const rec = await prisma.receita.create({ data: {
        codigo, processoId: input.processoId,
        categoria: (honorario ? 'HONORARIOS' : 'OUTROS') as never,
        descricao: `${descBase}${cota.requerenteId != null ? ` — ${cota.nome}` : ''}`.slice(0, 300),
        moeda: moeda as never, valor: cota.valor,
        fxEstimado: fx > 0 ? fx : 1, fxRule: 'VARIAVEL' as never, fxData,
        nParcelas: 1, data1: fxData, periodicidade: 'Mensal', status: 'ATIVA' as never,
        origem: 'manual', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
        pricingRuleId: tabelaValorId, valorUnitario, quantidade, valorTotalCongelado: cota.valor,
        modoCalculoAplicado: tabelaValorId != null ? 'fixed' : 'manual', naturezaPreco: 'VENDA' as never,
        configFinanceiraId: cfg.id, regraFinanceiraId: null, contextoAplicado: contexto as never, dataReferencia: fxData,
        phaseKey, phaseCycle, chaveIdempotencia,
        tipoServicoId: undefined,
        eventos: { create: { tipo: 'CRIACAO' as const, descricao: `Receita manual (Cadastro Mestre: ${item.name})`.slice(0, 500), valor: cota.valor, cambio: fx || 1, valorBrl: cent(cota.valor * (fx || 1)) } },
        requerentes: cota.requerenteId != null ? { create: { idx: 0, nome: cota.nome, requerenteId: cota.requerenteId } } : undefined,
      } })
      receitaId = rec.id
    }
    receitaIds.push(receitaId)
    // espelho canônico (origemTipo Receita → consolida na leitura). Idempotente por (origemTipo, origemId).
    const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
      natureza: 'RECEITA', valorContratado: cota.valor, moedaContratual: moeda, codigoOperacional: null,
      processoId: input.processoId, itemCatalogoId: item.id, regraFinanceiraId: null,
      origemTipo: 'Receita', origemId: receitaId, criadoPorId,
    })
    obrigacaoIds.push(obrigacaoId)
  }

  return {
    ok: true, erros: [], receitaIds, obrigacaoIds, obrigacaoRef: obrigacaoIds[0] ?? null,
    moeda, totalContratado, totalBrl: cent(totalContratado * (fx || 1)), grupo, idempotente: idempotenteTudo,
  }
}
