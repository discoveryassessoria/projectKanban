// src/services/exclusao-definitiva.ts
//
// EXCLUSÃO DEFINITIVA (dados de teste) — restrita a ADMIN. Apaga fisicamente uma Configuração
// Financeira (ProdutoFinanceiro) e TODOS os seus preços (ativos + históricos), SOMENTE quando não
// houver USO OPERACIONAL REAL (lançamentos financeiros, regras econômicas, automações de fase,
// vínculos de serviço). Tudo em transação + auditoria completa. A regra geral (inativar, nunca
// apagar) para usuários comuns permanece intacta — este caminho é isolado e nunca é automático.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export const FRASE_CONFIRMACAO = "EXCLUIR DEFINITIVAMENTE"

export interface PrecoResumo { id: number; natureza: string; arquivado: boolean; legadoPendente: boolean; valor: string | null }
export interface BlockersConfig {
  lancamentosReceita: number
  lancamentosCusto: number
  regrasEconomicas: number
  automacoesFase: number
  vinculosServico: number
  total: number
}

/** where p/ Receita/Custo que referenciam a config OU um de seus preços (snapshot congelado). */
function whereLancamento(configId: number, priceIds: number[]): Prisma.ReceitaWhereInput {
  const ors: Prisma.ReceitaWhereInput[] = [{ configFinanceiraId: configId }]
  if (priceIds.length) ors.push({ pricingRuleId: { in: priceIds } })
  return { OR: ors }
}

/** Analisa a exclusão definitiva de uma Config Financeira: preços a apagar + blockers de uso real. */
export async function analisarExclusaoConfig(configId: number) {
  const config = await prisma.produtoFinanceiro.findUnique({
    where: { id: configId },
    select: { id: true, codigo: true, ativo: true, tipoDocumento: { select: { name: true } }, itemCatalogo: { select: { name: true } }, honorario: { select: { name: true } } },
  })
  if (!config) return null

  const precos: PrecoResumo[] = (await prisma.tabelaValor.findMany({
    where: { configuracaoFinanceiraItemId: configId },
    orderBy: { id: "asc" },
    select: { id: true, natureza: true, arquivado: true, legadoPendente: true, valor: true },
  })).map((p) => ({ id: p.id, natureza: String(p.natureza), arquivado: p.arquivado, legadoPendente: p.legadoPendente, valor: p.valor != null ? String(p.valor) : null }))
  const priceIds = precos.map((p) => p.id)

  const [lancReceita, lancCusto, regras, autos, servicos] = await Promise.all([
    prisma.receita.count({ where: whereLancamento(configId, priceIds) as Prisma.ReceitaWhereInput }),
    prisma.custo.count({ where: whereLancamento(configId, priceIds) as unknown as Prisma.CustoWhereInput }),
    prisma.phaseEconomicRule.count({ where: { OR: [{ custoConfigId: configId }, { receitaConfigId: configId }] } }),
    prisma.phaseAutomationRule.count({ where: { configItemId: configId } }),
    prisma.servicoProduto.count({ where: { itensFinanceiros: { some: { id: configId } } } }),
  ])
  const blockers: BlockersConfig = {
    lancamentosReceita: lancReceita, lancamentosCusto: lancCusto, regrasEconomicas: regras,
    automacoesFase: autos, vinculosServico: servicos,
    total: lancReceita + lancCusto + regras + autos + servicos,
  }
  const mestre = config.tipoDocumento?.name ?? config.itemCatalogo?.name ?? config.honorario?.name ?? config.codigo ?? `#${config.id}`
  return { config: { id: config.id, ativo: config.ativo, mestre }, precos, blockers, podeExcluir: blockers.total === 0 }
}

function motivoBlockers(b: BlockersConfig): string[] {
  const m: string[] = []
  if (b.lancamentosReceita + b.lancamentosCusto > 0) m.push(`${b.lancamentosReceita + b.lancamentosCusto} lançamento(s) financeiro(s) real(is)`)
  if (b.regrasEconomicas > 0) m.push(`${b.regrasEconomicas} regra(s) de aplicabilidade econômica`)
  if (b.automacoesFase > 0) m.push(`${b.automacoesFase} automação(ões) financeira(s) de fase`)
  if (b.vinculosServico > 0) m.push(`${b.vinculosServico} vínculo(s) de serviço`)
  return m
}

/**
 * Executa a exclusão definitiva EM TRANSAÇÃO. Re-verifica os blockers DENTRO da transação (guarda
 * contra corrida) e ABORTA (rollback) se surgir qualquer uso real. Registra auditoria completa
 * com usuário, data, motivo e IDs apagados.
 */
export async function excluirConfigDefinitivo(configId: number, opts: { usuarioId: number; motivo?: string | null }) {
  const analise = await analisarExclusaoConfig(configId)
  if (!analise) throw Object.assign(new Error("Configuração financeira não encontrada"), { code: "NAO_ENCONTRADA" })
  if (!analise.podeExcluir) {
    throw Object.assign(new Error(`Não é possível excluir: existe uso operacional real (${motivoBlockers(analise.blockers).join(", ")}).`), { code: "USO_REAL", blockers: analise.blockers })
  }

  return prisma.$transaction(async (tx) => {
    // RE-VERIFICAÇÃO dentro da transação — se surgiu uso real entre a análise e agora, aborta.
    const precos = await tx.tabelaValor.findMany({ where: { configuracaoFinanceiraItemId: configId }, select: { id: true } })
    const priceIds = precos.map((p) => p.id)
    const [r, c, reg, au, sv] = await Promise.all([
      tx.receita.count({ where: whereLancamento(configId, priceIds) as Prisma.ReceitaWhereInput }),
      tx.custo.count({ where: whereLancamento(configId, priceIds) as unknown as Prisma.CustoWhereInput }),
      tx.phaseEconomicRule.count({ where: { OR: [{ custoConfigId: configId }, { receitaConfigId: configId }] } }),
      tx.phaseAutomationRule.count({ where: { configItemId: configId } }),
      tx.servicoProduto.count({ where: { itensFinanceiros: { some: { id: configId } } } }),
    ])
    if (r + c + reg + au + sv > 0) throw Object.assign(new Error("Uso operacional real detectado durante a exclusão — operação abortada."), { code: "USO_REAL_RACE" })

    await tx.tabelaValor.deleteMany({ where: { configuracaoFinanceiraItemId: configId } })
    await tx.produtoFinanceiro.delete({ where: { id: configId } })
    await tx.logAuditoria.create({
      data: {
        acao: "EXCLUSAO_DEFINITIVA", entidade: "CONFIG_FINANCEIRA", entidadeId: configId, usuarioId: opts.usuarioId,
        descricao: `Exclusão definitiva (dados de teste) por admin ${opts.usuarioId}. Config "${analise.config.mestre}". Motivo: ${opts.motivo ?? "—"}. Preços apagados: [${priceIds.join(", ")}].`.slice(0, 500),
      },
    })
    return { configId, precosApagados: priceIds, mestre: analise.config.mestre }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO MESTRE (ItemCatalogo) — mesmo padrão (admin + confirmação + auditoria). Só permite
// apagar um item de TESTE realmente órfão: bloqueia se houver QUALQUER dependente real
// (tipos de documento, configs financeiras, serviços, necessidades usadas em processos). Apaga
// apenas os PREÇOS soltos do item + o próprio item. Nunca cascateia dados reais silenciosamente.

export interface BlockersItem {
  tiposDocumento: number
  configsFinanceiras: number
  vinculosServico: number
  necessidades: number
  total: number
}

export async function analisarExclusaoItemCatalogo(itemId: number) {
  const item = await prisma.itemCatalogo.findUnique({
    where: { id: itemId },
    select: { id: true, code: true, name: true, _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true, necessidades: true } } },
  })
  if (!item) return null
  const c = item._count
  const blockers: BlockersItem = {
    tiposDocumento: c.tiposDocumento, configsFinanceiras: c.produtos, vinculosServico: c.servicos, necessidades: c.necessidades,
    total: c.tiposDocumento + c.produtos + c.servicos + c.necessidades,
  }
  const precos: PrecoResumo[] = (await prisma.tabelaValor.findMany({
    where: { itemCatalogoId: itemId }, orderBy: { id: "asc" },
    select: { id: true, natureza: true, arquivado: true, legadoPendente: true, valor: true },
  })).map((p) => ({ id: p.id, natureza: String(p.natureza), arquivado: p.arquivado, legadoPendente: p.legadoPendente, valor: p.valor != null ? String(p.valor) : null }))
  return { item: { id: item.id, code: item.code, name: item.name }, precos, blockers, podeExcluir: blockers.total === 0 }
}

function motivoBlockersItem(b: BlockersItem): string[] {
  const m: string[] = []
  if (b.necessidades > 0) m.push(`${b.necessidades} necessidade(s) em processos`)
  if (b.tiposDocumento > 0) m.push(`${b.tiposDocumento} tipo(s) de documento`)
  if (b.configsFinanceiras > 0) m.push(`${b.configsFinanceiras} configuração(ões) financeira(s)`)
  if (b.vinculosServico > 0) m.push(`${b.vinculosServico} vínculo(s) de serviço`)
  return m
}

export async function excluirItemCatalogoDefinitivo(itemId: number, opts: { usuarioId: number; motivo?: string | null }) {
  const analise = await analisarExclusaoItemCatalogo(itemId)
  if (!analise) throw Object.assign(new Error("Item de catálogo não encontrado"), { code: "NAO_ENCONTRADA" })
  if (!analise.podeExcluir) {
    throw Object.assign(new Error(`Não é possível excluir: o item tem dependentes reais (${motivoBlockersItem(analise.blockers).join(", ")}).`), { code: "USO_REAL", blockers: analise.blockers })
  }
  return prisma.$transaction(async (tx) => {
    // RE-VERIFICAÇÃO transacional (guarda contra corrida).
    const it = await tx.itemCatalogo.findUnique({ where: { id: itemId }, select: { _count: { select: { tiposDocumento: true, produtos: true, servicos: true, necessidades: true } } } })
    const cc = it?._count
    if (!cc) throw Object.assign(new Error("Item de catálogo não encontrado"), { code: "NAO_ENCONTRADA" })
    if (cc.tiposDocumento + cc.produtos + cc.servicos + cc.necessidades > 0) throw Object.assign(new Error("Dependente real detectado durante a exclusão — operação abortada."), { code: "USO_REAL_RACE" })

    const precos = await tx.tabelaValor.findMany({ where: { itemCatalogoId: itemId }, select: { id: true } })
    const priceIds = precos.map((p) => p.id)
    await tx.tabelaValor.deleteMany({ where: { itemCatalogoId: itemId } })
    await tx.itemCatalogo.delete({ where: { id: itemId } })
    await tx.logAuditoria.create({
      data: {
        acao: "EXCLUSAO_DEFINITIVA", entidade: "ITEM_CATALOGO", entidadeId: itemId, usuarioId: opts.usuarioId,
        descricao: `Exclusão definitiva (dados de teste) por admin ${opts.usuarioId}. Item "${analise.item.name}" (${analise.item.code}). Motivo: ${opts.motivo ?? "—"}. Preços apagados: [${priceIds.join(", ")}].`.slice(0, 500),
      },
    })
    return { itemId, precosApagados: priceIds, nome: analise.item.name }
  })
}
