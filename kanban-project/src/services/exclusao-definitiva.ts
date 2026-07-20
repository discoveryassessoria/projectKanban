// src/services/exclusao-definitiva.ts
//
// EXCLUSÃO DEFINITIVA (dados de teste) — requer permissão sistema.exclusaoDefinitiva. Apaga
// fisicamente Config Financeira (ProdutoFinanceiro) + TODOS os preços (ativos+históricos) + os
// LANÇAMENTOS financeiros EXCLUSIVAMENTE DE TESTE (cascata controlada). BLOQUEIA se houver uso
// real: lançamento pago/recebido/baixado/com comprovante/movimentação bancária/estorno, regra
// econômica, automação de fase ou vínculo de serviço. Tudo em transação + rechecagem + rollback +
// auditoria. A regra geral (inativar, nunca apagar) para usuários sem permissão permanece intacta.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export const FRASE_CONFIRMACAO = "EXCLUIR DEFINITIVAMENTE"

export interface PrecoResumo { id: number; natureza: string; arquivado: boolean; legadoPendente: boolean; valor: string | null }
export interface LancamentoResumo {
  id: number
  tipo: "RECEITA" | "CUSTO"
  descricao: string
  valor: string | null
  natureza: string
  status: string
  deletavel: boolean          // true = exclusivamente de teste (sem uso financeiro real)
  motivoBloqueio: string | null
}
export interface BlockersConfig {
  regrasEconomicas: number
  automacoesFase: number
  vinculosServico: number
  lancamentosReais: number    // lançamentos com uso financeiro real (bloqueiam)
  total: number
}

/** where p/ Receita/Custo que referenciam a config OU um de seus preços (snapshot congelado). */
function whereLancamento(configId: number, priceIds: number[]): Prisma.ReceitaWhereInput {
  const ors: Prisma.ReceitaWhereInput[] = [{ configFinanceiraId: configId }]
  if (priceIds.length) ors.push({ pricingRuleId: { in: priceIds } })
  return { OR: ors }
}

const SELECT_LANC = {
  id: true, descricao: true, valor: true, categoria: true, status: true,
  estornadoEm: true, estornoDeId: true, naturezaLancamento: true,
  parcelas: { select: { status: true, dataPagamento: true, banco: true, comprovanteUrl: true } },
  _count: { select: { estornos: true } },
} as const

type LancRow = {
  id: number; descricao: string; valor: unknown; categoria: unknown; status: unknown
  estornadoEm: Date | null; estornoDeId: number | null; naturezaLancamento: string
  parcelas: { status: unknown; dataPagamento: Date | null; banco: string | null; comprovanteUrl: string | null }[]
  _count: { estornos: number }
}

/**
 * Classifica um lançamento: pode ser apagado em cascata SOMENTE se for exclusivamente de teste —
 * nada pago/recebido, sem baixa (data de pagamento), sem comprovante, sem movimentação bancária e
 * sem estorno. Qualquer uso financeiro real ⇒ bloqueia (retorna o motivo exato).
 */
function motivoUsoRealLancamento(r: LancRow): string | null {
  if (r.parcelas.some((p) => p.status === "PAGA" || p.status === "RECEBIDA")) return "possui parcela paga/recebida"
  if (r.parcelas.some((p) => p.dataPagamento != null)) return "possui baixa (pagamento registrado)"
  if (r.parcelas.some((p) => p.comprovanteUrl != null && String(p.comprovanteUrl).trim() !== "")) return "possui comprovante anexado"
  if (r.parcelas.some((p) => p.banco != null && String(p.banco).trim() !== "")) return "possui movimentação bancária"
  if (r.estornadoEm != null || r.estornoDeId != null || (r._count?.estornos ?? 0) > 0) return "possui estorno vinculado"
  return null
}

function mapLanc(rows: LancRow[], tipo: "RECEITA" | "CUSTO"): LancamentoResumo[] {
  return rows.map((r) => {
    const motivo = motivoUsoRealLancamento(r)
    return {
      id: r.id, tipo, descricao: r.descricao, valor: r.valor != null ? String(r.valor) : null,
      natureza: String(r.naturezaLancamento ?? tipo), status: String(r.status),
      deletavel: motivo == null, motivoBloqueio: motivo,
    }
  })
}

async function carregarLancamentos(db: Prisma.TransactionClient | typeof prisma, configId: number, priceIds: number[]): Promise<LancamentoResumo[]> {
  const [receitas, custos] = await Promise.all([
    db.receita.findMany({ where: whereLancamento(configId, priceIds), select: SELECT_LANC }),
    db.custo.findMany({ where: whereLancamento(configId, priceIds) as unknown as Prisma.CustoWhereInput, select: SELECT_LANC }),
  ])
  return [...mapLanc(receitas as unknown as LancRow[], "RECEITA"), ...mapLanc(custos as unknown as LancRow[], "CUSTO")]
}

/** Analisa a exclusão definitiva de uma Config Financeira: preços + lançamentos classificados + blockers. */
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

  const [lancamentos, regras, autos, servicos] = await Promise.all([
    carregarLancamentos(prisma, configId, priceIds),
    prisma.phaseEconomicRule.count({ where: { OR: [{ custoConfigId: configId }, { receitaConfigId: configId }] } }),
    prisma.phaseAutomationRule.count({ where: { configItemId: configId } }),
    prisma.servicoProduto.count({ where: { itensFinanceiros: { some: { id: configId } } } }),
  ])
  const lancamentosReais = lancamentos.filter((l) => !l.deletavel).length
  const blockers: BlockersConfig = {
    regrasEconomicas: regras, automacoesFase: autos, vinculosServico: servicos, lancamentosReais,
    total: regras + autos + servicos + lancamentosReais,
  }
  const mestre = config.tipoDocumento?.name ?? config.itemCatalogo?.name ?? config.honorario?.name ?? config.codigo ?? `#${config.id}`
  return { config: { id: config.id, ativo: config.ativo, mestre }, precos, lancamentos, blockers, podeExcluir: blockers.total === 0 }
}

function motivoBlockers(b: BlockersConfig, lanc: LancamentoResumo[]): string[] {
  const m: string[] = []
  for (const l of lanc.filter((x) => !x.deletavel)) m.push(`${l.tipo} #${l.id} (${l.motivoBloqueio})`)
  if (b.regrasEconomicas > 0) m.push(`${b.regrasEconomicas} regra(s) de aplicabilidade econômica`)
  if (b.automacoesFase > 0) m.push(`${b.automacoesFase} automação(ões) financeira(s) de fase`)
  if (b.vinculosServico > 0) m.push(`${b.vinculosServico} vínculo(s) de serviço`)
  return m
}

/**
 * Executa a exclusão definitiva EM TRANSAÇÃO. Re-classifica os lançamentos e re-verifica os
 * blockers estruturais DENTRO da transação (guarda contra corrida) e ABORTA (rollback) se surgir
 * qualquer uso real. Apaga em cascata: lançamentos de teste (parcelas/eventos/requerentes caem por
 * FK Cascade das PRÓPRIAS entidades), preços (ativos + históricos) e a Config. Auditoria completa.
 */
export async function excluirConfigDefinitivo(configId: number, opts: { usuarioId: number; motivo?: string | null }) {
  const analise = await analisarExclusaoConfig(configId)
  if (!analise) throw Object.assign(new Error("Configuração financeira não encontrada"), { code: "NAO_ENCONTRADA" })
  if (!analise.podeExcluir) {
    throw Object.assign(new Error(`Não é possível excluir: existe uso operacional real (${motivoBlockers(analise.blockers, analise.lancamentos).join(", ")}).`), { code: "USO_REAL", blockers: analise.blockers, lancamentos: analise.lancamentos })
  }

  return prisma.$transaction(async (tx) => {
    const precos = await tx.tabelaValor.findMany({ where: { configuracaoFinanceiraItemId: configId }, select: { id: true } })
    const priceIds = precos.map((p) => p.id)
    // RE-CLASSIFICAÇÃO/RE-VERIFICAÇÃO transacional — aborta se surgiu uso real desde a análise.
    const [lancamentos, reg, au, sv] = await Promise.all([
      carregarLancamentos(tx, configId, priceIds),
      tx.phaseEconomicRule.count({ where: { OR: [{ custoConfigId: configId }, { receitaConfigId: configId }] } }),
      tx.phaseAutomationRule.count({ where: { configItemId: configId } }),
      tx.servicoProduto.count({ where: { itensFinanceiros: { some: { id: configId } } } }),
    ])
    const reais = lancamentos.filter((l) => !l.deletavel)
    if (reais.length + reg + au + sv > 0) {
      throw Object.assign(new Error("Uso operacional/financeiro real detectado durante a exclusão — operação abortada."), { code: "USO_REAL_RACE" })
    }

    // 1) lançamentos de teste (parcelas/eventos/requerentes caem por Cascade da própria Receita/Custo)
    const receitaIds = lancamentos.filter((l) => l.tipo === "RECEITA").map((l) => l.id)
    const custoIds = lancamentos.filter((l) => l.tipo === "CUSTO").map((l) => l.id)
    if (receitaIds.length) await tx.receita.deleteMany({ where: { id: { in: receitaIds } } })
    if (custoIds.length) await tx.custo.deleteMany({ where: { id: { in: custoIds } } })
    // 2) preços (ativos + históricos)  3) a Config
    await tx.tabelaValor.deleteMany({ where: { configuracaoFinanceiraItemId: configId } })
    await tx.produtoFinanceiro.delete({ where: { id: configId } })

    const detalheLanc = lancamentos.map((l) => `${l.tipo}#${l.id}=${l.valor ?? "?"}(${l.natureza})`).join("; ")
    await tx.logAuditoria.create({
      data: {
        acao: "EXCLUSAO_DEFINITIVA", entidade: "CONFIG_FINANCEIRA", entidadeId: configId, usuarioId: opts.usuarioId,
        descricao: `Exclusão definitiva (dados de teste) por usuário ${opts.usuarioId}. Config "${analise.config.mestre}". Motivo: ${opts.motivo ?? "—"}. Preços: [${priceIds.join(", ")}]. Lançamentos: [${detalheLanc}].`.slice(0, 500),
      },
    })
    return { configId, precosApagados: priceIds, receitasApagadas: receitaIds, custosApagados: custoIds, mestre: analise.config.mestre }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO DE SERVIÇOS (ServicoProduto) — mesmo padrão. O serviço arrasta a sua Configuração
// Financeira (por itemCatalogoId), preços (ativos+históricos) e lançamentos EXCLUSIVAMENTE DE
// TESTE. BLOQUEIA se houver uso operacional real: necessidade documental (item usado em processo),
// lançamento com uso financeiro real, regra econômica ou automação de fase. O auto-vínculo do
// próprio serviço à config NÃO conta como bloqueio.

export interface BlockersServico {
  configId: number | null
  regrasEconomicas: number
  automacoesFase: number
  necessidades: number
  lancamentosReais: number
  total: number
}

/** Lançamentos ligados ao serviço via productServiceId (fora do vínculo pela config). */
async function carregarLancamentosPorServico(db: Prisma.TransactionClient | typeof prisma, servicoId: number): Promise<LancamentoResumo[]> {
  const [receitas, custos] = await Promise.all([
    db.receita.findMany({ where: { productServiceId: servicoId }, select: SELECT_LANC }),
    db.custo.findMany({ where: { productServiceId: servicoId }, select: SELECT_LANC }),
  ])
  return [...mapLanc(receitas as unknown as LancRow[], "RECEITA"), ...mapLanc(custos as unknown as LancRow[], "CUSTO")]
}

function dedupLanc(lancs: LancamentoResumo[]): LancamentoResumo[] {
  const seen = new Set<string>(); const out: LancamentoResumo[] = []
  for (const l of lancs) { const k = `${l.tipo}#${l.id}`; if (!seen.has(k)) { seen.add(k); out.push(l) } }
  return out
}

export async function analisarExclusaoServico(servicoId: number) {
  const svc = await prisma.servicoProduto.findUnique({ where: { id: servicoId }, select: { id: true, name: true, code: true, itemCatalogoId: true, ativo: true } })
  if (!svc) return null
  const itemId = svc.itemCatalogoId
  const config = itemId != null ? await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: itemId }, select: { id: true } }) : null
  const analiseConfig = config ? await analisarExclusaoConfig(config.id) : null

  const [necessidades, lancServico] = await Promise.all([
    itemId != null ? prisma.necessidadeDocumental.count({ where: { itemCatalogoId: itemId } }) : Promise.resolve(0),
    carregarLancamentosPorServico(prisma, servicoId),
  ])
  // Lançamentos = os da config (configFinanceiraId/pricingRuleId) + os do serviço (productServiceId), deduplicados.
  const lancamentos = dedupLanc([...(analiseConfig?.lancamentos ?? []), ...lancServico])
  const lancamentosReais = lancamentos.filter((l) => !l.deletavel).length
  // vínculosServico da config é IGNORADO (é o auto-vínculo deste serviço).
  const regras = analiseConfig?.blockers.regrasEconomicas ?? 0
  const autos = analiseConfig?.blockers.automacoesFase ?? 0
  const blockers: BlockersServico = {
    configId: config?.id ?? null, regrasEconomicas: regras, automacoesFase: autos, necessidades, lancamentosReais,
    total: regras + autos + necessidades + lancamentosReais,
  }
  return {
    servico: { id: svc.id, name: svc.name, ativo: svc.ativo, itemCatalogoId: itemId, configId: config?.id ?? null },
    precos: analiseConfig?.precos ?? [], lancamentos, blockers, podeExcluir: blockers.total === 0,
  }
}

function motivoBlockersServico(b: BlockersServico, lanc: LancamentoResumo[]): string[] {
  const m: string[] = []
  for (const l of lanc.filter((x) => !x.deletavel)) m.push(`${l.tipo} #${l.id} (${l.motivoBloqueio})`)
  if (b.necessidades > 0) m.push(`${b.necessidades} necessidade(s) documental(is) em processos`)
  if (b.regrasEconomicas > 0) m.push(`${b.regrasEconomicas} regra(s) de aplicabilidade econômica`)
  if (b.automacoesFase > 0) m.push(`${b.automacoesFase} automação(ões) financeira(s) de fase`)
  return m
}

/** Exclusão definitiva de um Serviço: cascata controlada (config+preços+lançamentos de teste+serviço)
 *  em transação, com rechecagem e rollback. Remove o ItemCatalogo somente se ficar órfão. */
export async function excluirServicoDefinitivo(servicoId: number, opts: { usuarioId: number; motivo?: string | null }) {
  const analise = await analisarExclusaoServico(servicoId)
  if (!analise) throw Object.assign(new Error("Serviço não encontrado"), { code: "NAO_ENCONTRADA" })
  if (!analise.podeExcluir) {
    throw Object.assign(new Error(`Não é possível excluir: existe uso operacional real (${motivoBlockersServico(analise.blockers, analise.lancamentos).join(", ")}).`), { code: "USO_REAL", blockers: analise.blockers, lancamentos: analise.lancamentos })
  }
  const { itemCatalogoId, configId } = analise.servico

  return prisma.$transaction(async (tx) => {
    // RE-VERIFICAÇÃO transacional (guarda contra corrida).
    const priceIds = configId != null
      ? (await tx.tabelaValor.findMany({ where: { configuracaoFinanceiraItemId: configId }, select: { id: true } })).map((p) => p.id)
      : []
    const [lancCfg, lancSvc, necess, reg, au] = await Promise.all([
      configId != null ? carregarLancamentos(tx, configId, priceIds) : Promise.resolve([] as LancamentoResumo[]),
      carregarLancamentosPorServico(tx, servicoId),
      itemCatalogoId != null ? tx.necessidadeDocumental.count({ where: { itemCatalogoId } }) : Promise.resolve(0),
      configId != null ? tx.phaseEconomicRule.count({ where: { OR: [{ custoConfigId: configId }, { receitaConfigId: configId }] } }) : Promise.resolve(0),
      configId != null ? tx.phaseAutomationRule.count({ where: { configItemId: configId } }) : Promise.resolve(0),
    ])
    const lancamentos = dedupLanc([...lancCfg, ...lancSvc])
    if (lancamentos.some((l) => !l.deletavel) || necess + reg + au > 0) {
      throw Object.assign(new Error("Uso operacional/financeiro real detectado durante a exclusão — operação abortada."), { code: "USO_REAL_RACE" })
    }

    // 1) lançamentos de teste (parcelas/eventos/requerentes caem por Cascade das próprias entidades)
    const receitaIds = lancamentos.filter((l) => l.tipo === "RECEITA").map((l) => l.id)
    const custoIds = lancamentos.filter((l) => l.tipo === "CUSTO").map((l) => l.id)
    if (receitaIds.length) await tx.receita.deleteMany({ where: { id: { in: receitaIds } } })
    if (custoIds.length) await tx.custo.deleteMany({ where: { id: { in: custoIds } } })
    // 2) preços + 3) config
    if (configId != null) {
      await tx.tabelaValor.deleteMany({ where: { OR: [{ configuracaoFinanceiraItemId: configId }, ...(itemCatalogoId != null ? [{ itemCatalogoId }] : [])] } })
      await tx.produtoFinanceiro.delete({ where: { id: configId } })
    } else if (itemCatalogoId != null) {
      await tx.tabelaValor.deleteMany({ where: { itemCatalogoId } })
    }
    // 4) o serviço
    await tx.servicoProduto.delete({ where: { id: servicoId } })
    // 5) ItemCatalogo mestre — só se ficar ÓRFÃO (sem outros consumidores). Evita registro órfão.
    let itemRemovido: number | null = null
    if (itemCatalogoId != null) {
      const it = await tx.itemCatalogo.findUnique({ where: { id: itemCatalogoId }, select: { _count: { select: { tiposDocumento: true, produtos: true, servicos: true, necessidades: true, precos: true } } } })
      const c = it?._count
      if (c && c.tiposDocumento + c.produtos + c.servicos + c.necessidades + c.precos === 0) {
        await tx.itemCatalogo.delete({ where: { id: itemCatalogoId } })
        itemRemovido = itemCatalogoId
      }
    }

    const detalheLanc = lancamentos.map((l) => `${l.tipo}#${l.id}=${l.valor ?? "?"}`).join("; ")
    await tx.logAuditoria.create({
      data: {
        acao: "EXCLUSAO_DEFINITIVA", entidade: "SERVICO", entidadeId: servicoId, usuarioId: opts.usuarioId,
        descricao: `Exclusão definitiva (dados de teste) por usuário ${opts.usuarioId}. Serviço "${analise.servico.name}". Motivo: ${opts.motivo ?? "—"}. Config: ${configId ?? "—"}. Preços: [${priceIds.join(", ")}]. Lançamentos: [${detalheLanc}]. Item mestre removido: ${itemRemovido ?? "não (compartilhado)"}.`.slice(0, 500),
      },
    })
    return { servicoId, configId, precosApagados: priceIds, receitasApagadas: receitaIds, custosApagados: custoIds, itemRemovido, nome: analise.servico.name }
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
