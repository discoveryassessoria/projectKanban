// src/services/exclusao-definitiva.ts
//
// MOTOR CANÔNICO ÚNICO DE EXCLUSÃO DEFINITIVA (Serviço · Configuração Financeira · Item Mestre).
//
// DECISÃO ARQUITETURAL (única, sem outro comportamento aceito):
//
//   • SEM nenhum fato histórico real  → EXCLUI definitivamente: o cadastro sai, as dependências
//     CONFIGURACIONAIS exclusivas caem em cascata, as COMPARTILHADAS são apenas desvinculadas,
//     e não sobra órfão.
//   • COM qualquer fato histórico real → NÃO exclui: INATIVA e preserva o histórico integralmente.
//
// A classificação do que é CONFIGURAÇÃO e do que é FATO HISTÓRICO vive numa fonte única e pura:
// lib/gerenciamento/classificacao-exclusao.ts. Configuração (Regra de Aplicabilidade Econômica,
// Configuração Financeira, Regra de Preço, vínculos…) NUNCA bloqueia exclusão — era exatamente
// esse o defeito que impedia excluir "Localização de Registro" tendo zero movimento financeiro.
//
// A regra final é literal e não é reescrita aqui:  deletionAllowed = historicalFacts.total === 0
//
// Prévia e execução usam ESTE MESMO analisador; a execução ainda o re-roda DENTRO da transação
// (guarda de corrida) e aborta com rollback total se qualquer fato histórico surgir no meio.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import {
  dependencia,
  fato,
  totalizar,
  permiteExclusaoDefinitiva,
  exigeInativacao,
  type DependenciaConfiguracional,
  type FatoHistoricoDetectado,
} from "@/lib/gerenciamento/classificacao-exclusao"

export const FRASE_CONFIRMACAO = "EXCLUIR DEFINITIVAMENTE"

type DB = Prisma.TransactionClient | typeof prisma

// A execução re-roda a análise INTEIRA dentro da transação (guarda de corrida). São dezenas de
// idas ao banco sob uma conexão remota: os 5s padrão do Prisma estouram e a transação morre no
// meio. O limite é generoso de propósito — abortar por relógio seria perder a guarda, não ganhar
// segurança (a trava FOR UPDATE é que protege a linha).
const TX_OPTS = { timeout: 60_000, maxWait: 20_000 } as const

export interface AnaliseExclusao {
  /** Identidade do cadastro analisado (o que a tela mostra no cabeçalho). */
  alvo: { tipo: "SERVICO" | "CONFIG_FINANCEIRA" | "ITEM_CATALOGO"; id: number; nome: string; codigo: string | null; ativo: boolean }
  /** Parametrizações. Somem em cascata (EXCLUIR) ou só perdem o vínculo (DESVINCULAR). Nunca bloqueiam. */
  configDependencies: { itens: DependenciaConfiguracional[]; total: number }
  /** Provas de que algo aconteceu. Nunca são apagadas. A existência de UMA já proíbe o hard delete. */
  historicalFacts: { itens: FatoHistoricoDetectado[]; total: number }
  deletionAllowed: boolean
  deactivationRequired: boolean
  fraseConfirmacao: string
}

// ─────────────────────────────────────────────────────────────────────────────
// COLETA — cada função devolve dependências JÁ classificadas. Nenhuma decide nada.
// ─────────────────────────────────────────────────────────────────────────────

/** Fatos históricos amarrados a uma Configuração Financeira (e aos preços que ela congelou). */
async function fatosDaConfig(db: DB, configId: number, priceIds: number[]): Promise<FatoHistoricoDetectado[]> {
  const orLanc: Prisma.ReceitaWhereInput[] = [{ configFinanceiraId: configId }]
  if (priceIds.length) orLanc.push({ pricingRuleId: { in: priceIds } })
  const where = { OR: orLanc }
  const [receitas, custos, obrigacoes, pendencias] = await Promise.all([
    db.receita.count({ where }),
    db.custo.count({ where: where as unknown as Prisma.CustoWhereInput }),
    db.obrigacaoEconomica.count({ where: { configFinanceiraId: configId } }),
    db.pendenciaFinanceira.count({ where: { configFinanceiraId: configId } }),
  ])
  return [
    fato("Receita", receitas),
    fato("Custo", custos),
    fato("ObrigacaoEconomica", obrigacoes),
    fato("PendenciaFinanceira", pendencias),
  ].filter((f) => f.quantidade > 0)
}

/** Dependências CONFIGURACIONAIS de uma Configuração Financeira. */
async function configsDaConfig(db: DB, configId: number, priceIds: number[]): Promise<DependenciaConfiguracional[]> {
  const [regras, autos, servicos] = await Promise.all([
    db.phaseEconomicRule.findMany({ where: { OR: [{ custoConfigId: configId }, { receitaConfigId: configId }] }, select: { id: true } }),
    db.phaseAutomationRule.findMany({ where: { configItemId: configId }, select: { id: true } }),
    db.servicoProduto.findMany({ where: { itensFinanceiros: { some: { id: configId } } }, select: { id: true } }),
  ])
  return [
    dependencia("RegraDePreco", priceIds.length, "EXCLUIR", priceIds),
    dependencia("RegraAplicabilidadeEconomica", regras.length, "EXCLUIR", regras.map((r) => r.id)),
    dependencia("AutomacaoFinanceiraDeFase", autos.length, "EXCLUIR", autos.map((a) => a.id)),
    dependencia("VinculoConfigFinanceiraServico", servicos.length, "DESVINCULAR", servicos.map((s) => s.id)),
  ].filter((d) => d.quantidade > 0)
}

/** Fatos históricos amarrados a um Item do Cadastro Mestre (o "pivô" documental). */
async function fatosDoItem(db: DB, itemId: number): Promise<FatoHistoricoDetectado[]> {
  const [necessidades, evidencias, obrigacoes] = await Promise.all([
    db.necessidadeDocumental.count({ where: { itemCatalogoId: itemId } }),
    db.evidenciaRegistral.count({ where: { itemCatalogoId: itemId } }),
    db.obrigacaoEconomica.count({ where: { itemCatalogoId: itemId } }),
  ])
  return [
    fato("NecessidadeDocumental", necessidades),
    fato("EvidenciaRegistral", evidencias),
    fato("ObrigacaoEconomica", obrigacoes),
  ].filter((f) => f.quantidade > 0)
}

/** Fatos históricos amarrados diretamente ao Serviço (fora do caminho da config). */
async function fatosDoServico(db: DB, servicoId: number): Promise<FatoHistoricoDetectado[]> {
  const [receitas, custos, docs] = await Promise.all([
    db.receita.count({ where: { productServiceId: servicoId } }),
    db.custo.count({ where: { productServiceId: servicoId } }),
    db.documentoGerado.count({ where: { servicoId } }),
  ])
  return [fato("Receita", receitas), fato("Custo", custos), fato("DocumentoGerado", docs)].filter((f) => f.quantidade > 0)
}

/** Soma fatos de mesma entidade vindos de caminhos diferentes (config + serviço + item). */
function consolidarFatos(...listas: FatoHistoricoDetectado[][]): { itens: FatoHistoricoDetectado[]; total: number } {
  const acc = new Map<string, FatoHistoricoDetectado>()
  for (const f of listas.flat()) {
    const atual = acc.get(f.entidade)
    if (atual) atual.quantidade += f.quantidade
    else acc.set(f.entidade, { ...f })
  }
  const itens = [...acc.values()].filter((f) => f.quantidade > 0)
  return { itens, total: totalizar(itens) }
}

function consolidarConfigs(...listas: DependenciaConfiguracional[][]): { itens: DependenciaConfiguracional[]; total: number } {
  const acc = new Map<string, DependenciaConfiguracional>()
  for (const d of listas.flat()) {
    const atual = acc.get(d.entidade)
    if (atual) {
      atual.quantidade += d.quantidade
      atual.ids = [...new Set([...atual.ids, ...d.ids])]
    } else acc.set(d.entidade, { ...d, ids: [...d.ids] })
  }
  const itens = [...acc.values()].filter((d) => d.quantidade > 0)
  return { itens, total: totalizar(itens) }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPOLOGIA DO SERVIÇO — o que é EXCLUSIVO deste serviço e o que é COMPARTILHADO.
// ─────────────────────────────────────────────────────────────────────────────

interface TopologiaServico {
  servicoId: number
  itemCatalogoId: number | null
  configId: number | null
  priceIds: number[]
  /** O Item Mestre existe só para projetar ESTE serviço (nenhum outro consumidor estrutural). */
  itemExclusivo: boolean
  /** Consumidores COMPARTILHADOS do item — preservados, apenas desvinculados. */
  tiposDocumentoIds: number[]
  tiposServicoIds: number[]
  outrosServicosIds: number[]
  paisesIds: number[]
  condicoesVinculadasIds: number[]
}

async function topologiaDoServico(db: DB, servicoId: number, itemCatalogoId: number | null): Promise<TopologiaServico> {
  const config = itemCatalogoId != null
    ? await db.produtoFinanceiro.findUnique({ where: { itemCatalogoId }, select: { id: true } })
    : null
  const configId = config?.id ?? null

  const priceIds = (await db.tabelaValor.findMany({
    where: {
      OR: [
        ...(configId != null ? [{ configuracaoFinanceiraItemId: configId }] : []),
        ...(itemCatalogoId != null ? [{ itemCatalogoId }] : []),
      ],
    },
    select: { id: true },
  })).map((p) => p.id)

  const [tiposDoc, tiposSvc, outrosSvc, paises, condicoes] = await Promise.all([
    itemCatalogoId != null ? db.tipoDocumentoCadastro.findMany({ where: { itemCatalogoId }, select: { id: true } }) : Promise.resolve([]),
    itemCatalogoId != null ? db.tipoServico.findMany({ where: { itemCatalogoId }, select: { id: true } }) : Promise.resolve([]),
    itemCatalogoId != null ? db.servicoProduto.findMany({ where: { itemCatalogoId, id: { not: servicoId } }, select: { id: true } }) : Promise.resolve([]),
    db.servicoProdutoPais.findMany({ where: { servicoId }, select: { id: true } }),
    db.condicaoPagamentoServico.findMany({ where: { servicoId }, select: { id: true, condicaoId: true } }),
  ])

  return {
    servicoId,
    itemCatalogoId,
    configId,
    priceIds,
    itemExclusivo: itemCatalogoId != null && tiposDoc.length === 0 && tiposSvc.length === 0 && outrosSvc.length === 0,
    tiposDocumentoIds: tiposDoc.map((t) => t.id),
    tiposServicoIds: tiposSvc.map((t) => t.id),
    outrosServicosIds: outrosSvc.map((s) => s.id),
    paisesIds: paises.map((p) => p.id),
    condicoesVinculadasIds: condicoes.map((c) => c.id),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANÁLISE DE SERVIÇO — o analisador canônico. Prévia e exclusão chamam ESTE.
// ─────────────────────────────────────────────────────────────────────────────

export async function analyzeServiceDeletion(servicoId: number, db: DB = prisma): Promise<AnaliseExclusao | null> {
  const svc = await db.servicoProduto.findUnique({
    where: { id: servicoId },
    select: { id: true, name: true, code: true, ativo: true, itemCatalogoId: true },
  })
  if (!svc) return null

  const topo = await topologiaDoServico(db, servicoId, svc.itemCatalogoId)

  const [fatosCfg, fatosSvc, fatosItm, cfgsDaConfig] = await Promise.all([
    topo.configId != null ? fatosDaConfig(db, topo.configId, topo.priceIds) : Promise.resolve([] as FatoHistoricoDetectado[]),
    fatosDoServico(db, servicoId),
    topo.itemCatalogoId != null ? fatosDoItem(db, topo.itemCatalogoId) : Promise.resolve([] as FatoHistoricoDetectado[]),
    topo.configId != null ? configsDaConfig(db, topo.configId, topo.priceIds) : Promise.resolve([] as DependenciaConfiguracional[]),
  ])

  // O auto-vínculo Serviço↔Config NÃO é dependência externa: é o próprio serviço.
  const cfgsExternas = cfgsDaConfig
    .map((d) =>
      d.entidade === "VinculoConfigFinanceiraServico"
        ? { ...d, ids: d.ids.filter((id) => id !== servicoId), quantidade: d.ids.filter((id) => id !== servicoId).length }
        : d,
    )
    .filter((d) => d.quantidade > 0)

  // A Configuração Financeira, os preços, a aplicabilidade econômica e a automação pertencem ao
  // ITEM MESTRE, não ao serviço. Só caem junto quando o item existe unicamente para projetar
  // ESTE serviço. Se o mestre é compartilhado (um Tipo de Documento, um Tipo de Serviço ou outro
  // Serviço também aponta para ele), essa parametrização é de terceiros: fica intacta e o serviço
  // apenas se desliga dela.
  const parametrizacaoDoMestre: DependenciaConfiguracional[] = topo.itemExclusivo
    ? [
        ...cfgsExternas,
        ...(topo.configId == null && topo.priceIds.length
          ? [dependencia("RegraDePreco", topo.priceIds.length, "EXCLUIR", topo.priceIds)]
          : []),
        ...(topo.configId != null ? [dependencia("ConfiguracaoFinanceira", 1, "EXCLUIR", [topo.configId])] : []),
      ]
    : [
        // Compartilhado: nada da parametrização do mestre é tocado.
        ...cfgsExternas.filter((d) => d.entidade === "VinculoConfigFinanceiraServico"),
        ...(topo.configId != null ? [dependencia("ConfiguracaoFinanceira", 1, "DESVINCULAR", [topo.configId])] : []),
      ]

  const configDependencies = consolidarConfigs(parametrizacaoDoMestre, [
    ...(topo.paisesIds.length ? [dependencia("AplicacaoTerritorial", topo.paisesIds.length, "EXCLUIR", topo.paisesIds)] : []),
    ...(topo.condicoesVinculadasIds.length ? [dependencia("VinculoCondicaoPagamento", topo.condicoesVinculadasIds.length, "DESVINCULAR", topo.condicoesVinculadasIds)] : []),
    ...(topo.tiposDocumentoIds.length ? [dependencia("VinculoTipoDocumento", topo.tiposDocumentoIds.length, "DESVINCULAR", topo.tiposDocumentoIds)] : []),
    ...(topo.tiposServicoIds.length ? [dependencia("VinculoTipoServico", topo.tiposServicoIds.length, "DESVINCULAR", topo.tiposServicoIds)] : []),
    ...(topo.itemCatalogoId != null
      ? [dependencia("ItemCatalogoMestre", 1, topo.itemExclusivo ? "EXCLUIR" : "DESVINCULAR", [topo.itemCatalogoId])]
      : []),
  ])

  const historicalFacts = consolidarFatos(fatosCfg, fatosSvc, fatosItm)

  return {
    alvo: { tipo: "SERVICO", id: svc.id, nome: svc.name, codigo: svc.code, ativo: svc.ativo },
    configDependencies,
    historicalFacts,
    deletionAllowed: permiteExclusaoDefinitiva(historicalFacts),
    deactivationRequired: exigeInativacao(historicalFacts),
    fraseConfirmacao: FRASE_CONFIRMACAO,
  }
}

/** Nome histórico mantido para o restante do código; é o MESMO analisador. */
export const analisarExclusaoServico = analyzeServiceDeletion

// ─────────────────────────────────────────────────────────────────────────────
// EXECUÇÃO — transacional, com re-análise dentro da transação e rollback total.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResultadoExclusaoServico {
  servicoId: number
  nome: string
  configDependenciesRemoved: DependenciaConfiguracional[]
  sharedLinksDetached: DependenciaConfiguracional[]
  historicalFactsFound: FatoHistoricoDetectado[]
  deletionMode: "HARD_DELETE"
  correlationId: string
}

function correlacao(prefixo: string, id: number, agora: Date): string {
  return `${prefixo}-${id}-${agora.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
}

function erroUsoReal(analise: AnaliseExclusao, race: boolean) {
  const motivos = analise.historicalFacts.itens.map((f) => `${f.quantidade} ${f.rotulo}`).join(", ")
  return Object.assign(
    new Error(
      race
        ? `Fato histórico real detectado durante a exclusão (${motivos}) — operação abortada.`
        : `Não é possível excluir definitivamente: existe fato histórico real (${motivos}). O cadastro deve ser inativado.`,
    ),
    { code: race ? "FATO_HISTORICO_RACE" : "FATO_HISTORICO", historicalFacts: analise.historicalFacts },
  )
}

/**
 * Exclusão definitiva de um Serviço. Só roda quando historicalFacts.total === 0.
 * Ordem: aplicabilidade econômica → automação → preços → vínculos → config → mestres
 * compartilhados (só desvínculo) → serviço → item mestre órfão → auditoria.
 */
export async function deleteService(
  servicoId: number,
  opts: { usuarioId: number; motivo?: string | null },
): Promise<ResultadoExclusaoServico> {
  const previa = await analyzeServiceDeletion(servicoId)
  if (!previa) throw Object.assign(new Error("Serviço não encontrado"), { code: "NAO_ENCONTRADA" })
  if (!previa.deletionAllowed) throw erroUsoReal(previa, false)

  const correlationId = correlacao("EXCL-SVC", servicoId, new Date())

  return prisma.$transaction(async (tx) => {
    // 1) TRAVA da linha do Serviço — nada nasce sob ela enquanto a transação corre.
    const travado = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "ServicoProduto" WHERE id = ${servicoId} FOR UPDATE`
    if (travado.length === 0) throw Object.assign(new Error("Serviço não encontrado"), { code: "NAO_ENCONTRADA" })

    // 2) RE-ANÁLISE dentro da transação — o MESMO analisador, agora sob a trava.
    const analise = await analyzeServiceDeletion(servicoId, tx)
    if (!analise) throw Object.assign(new Error("Serviço não encontrado"), { code: "NAO_ENCONTRADA" })
    // 3) Se surgiu fato histórico entre a prévia e agora: ABORTA (rollback total).
    if (!analise.deletionAllowed) throw erroUsoReal(analise, true)

    const svc = await tx.servicoProduto.findUnique({ where: { id: servicoId }, select: { itemCatalogoId: true } })
    const topo = await topologiaDoServico(tx, servicoId, svc?.itemCatalogoId ?? null)

    // A parametrização abaixo pertence ao ITEM MESTRE. Só cai junto quando o mestre existe
    // exclusivamente para projetar este serviço; se for compartilhado, é de terceiros.
    if (topo.itemExclusivo && topo.configId != null) {
      // 4) Regra de Aplicabilidade Econômica (CONFIGURAÇÃO — nunca histórico).
      await tx.phaseEconomicRule.deleteMany({ where: { OR: [{ custoConfigId: topo.configId }, { receitaConfigId: topo.configId }] } })
      // 5) Automação financeira de fase (CONFIGURAÇÃO).
      await tx.phaseAutomationRule.deleteMany({ where: { configItemId: topo.configId } })
    }

    // 6) Regras de preço / vínculos de Tabela de Preços (CONFIGURAÇÃO do mestre exclusivo).
    if (topo.itemExclusivo && topo.priceIds.length) await tx.tabelaValor.deleteMany({ where: { id: { in: topo.priceIds } } })

    // 7) Vínculos com cadastros mestres COMPARTILHADOS — só o vínculo cai.
    if (topo.condicoesVinculadasIds.length) {
      await tx.condicaoPagamentoServico.deleteMany({ where: { servicoId } })
      // Projeção derivada (CondicaoPagamento.servicos Int[]) — sem isto sobra id órfão no array.
      await tx.$executeRaw`UPDATE "CondicaoPagamento" SET "servicos" = array_remove("servicos", ${servicoId}) WHERE ${servicoId} = ANY("servicos")`
    }
    if (topo.paisesIds.length) await tx.servicoProdutoPais.deleteMany({ where: { servicoId } })
    // Desvincula (nunca apaga) o Serviço da Configuração Financeira compartilhada.
    await tx.servicoProduto.update({ where: { id: servicoId }, data: { itensFinanceiros: { set: [] } } })

    // 8) Configuração Financeira — só quando é EXCLUSIVA deste serviço.
    if (topo.configId != null && topo.itemExclusivo) {
      await tx.tabelaValor.deleteMany({ where: { configuracaoFinanceiraItemId: topo.configId } })
      await tx.produtoFinanceiro.delete({ where: { id: topo.configId } })
    } else if (topo.configId != null && topo.itemCatalogoId != null) {
      // Item compartilhado: a config pertence ao mestre, não a este serviço. Preservada.
      await tx.produtoFinanceiro.update({ where: { id: topo.configId }, data: { servicos: { disconnect: { id: servicoId } } } })
    }

    // 9) O Serviço.
    await tx.servicoProduto.delete({ where: { id: servicoId } })

    // 10) Item Mestre — apagado APENAS se ficou órfão; se compartilhado, preservado intacto.
    let itemRemovido: number | null = null
    if (topo.itemCatalogoId != null) {
      const it = await tx.itemCatalogo.findUnique({
        where: { id: topo.itemCatalogoId },
        select: { _count: { select: { tiposDocumento: true, produtos: true, servicos: true, necessidades: true, precos: true, tiposServico: true, evidenciasRegistrais: true } } },
      })
      const c = it?._count
      if (c && c.tiposDocumento + c.produtos + c.servicos + c.necessidades + c.precos + c.tiposServico + c.evidenciasRegistrais === 0) {
        await tx.itemCatalogo.delete({ where: { id: topo.itemCatalogoId } })
        itemRemovido = topo.itemCatalogoId
      }
    }

    const removidas = analise.configDependencies.itens.filter((d) => d.acao === "EXCLUIR")
    const desvinculadas = analise.configDependencies.itens.filter((d) => d.acao === "DESVINCULAR")

    // 11) Auditoria (§12) — quem, o quê, quando, o que caiu, o que só se desvinculou.
    await tx.logAuditoria.create({
      data: {
        acao: "EXCLUSAO_DEFINITIVA",
        entidade: "SERVICO",
        entidadeId: servicoId,
        usuarioId: opts.usuarioId,
        descricao: `Exclusão definitiva do serviço "${analise.alvo.nome}" (${analise.alvo.codigo ?? "—"}) por usuário ${opts.usuarioId}. Sem fato histórico. Motivo: ${opts.motivo ?? "—"}. correlationId=${correlationId}`.slice(0, 500),
        detalhes: {
          correlationId,
          serviceId: servicoId,
          serviceCode: analise.alvo.codigo,
          serviceName: analise.alvo.nome,
          actorUserId: opts.usuarioId,
          deletionMode: "HARD_DELETE",
          configDependenciesRemoved: removidas.map((d) => ({ entidade: d.entidade, quantidade: d.quantidade, ids: d.ids })),
          sharedLinksDetached: desvinculadas.map((d) => ({ entidade: d.entidade, quantidade: d.quantidade, ids: d.ids })),
          historicalFactsFound: [],
          itemCatalogoRemovido: itemRemovido,
          motivo: opts.motivo ?? null,
        } as Prisma.InputJsonValue,
      },
    })

    return {
      servicoId,
      nome: analise.alvo.nome,
      configDependenciesRemoved: removidas,
      sharedLinksDetached: desvinculadas,
      historicalFactsFound: [],
      deletionMode: "HARD_DELETE" as const,
      correlationId,
    }
  }, TX_OPTS)
}

/** Nome histórico mantido; é o MESMO motor. */
export const excluirServicoDefinitivo = deleteService

/**
 * INATIVAÇÃO — o caminho obrigatório quando existe fato histórico. Preserva tudo:
 * custos, receitas, obrigações, processos, snapshots. Só tira o cadastro de circulação.
 * É também o ÚNICO caminho de "excluir" disponível a quem não tem exclusão definitiva.
 */
export async function deactivateService(
  servicoId: number,
  opts: { usuarioId: number; motivo?: string | null },
): Promise<{ servicoId: number; nome: string; inativado: true; historicalFactsFound: FatoHistoricoDetectado[]; correlationId: string }> {
  const analise = await analyzeServiceDeletion(servicoId)
  if (!analise) throw Object.assign(new Error("Serviço não encontrado"), { code: "NAO_ENCONTRADA" })
  const correlationId = correlacao("INAT-SVC", servicoId, new Date())

  return prisma.$transaction(async (tx) => {
    await tx.servicoProduto.update({ where: { id: servicoId }, data: { ativo: false } })
    const svc = await tx.servicoProduto.findUnique({ where: { id: servicoId }, select: { itemCatalogoId: true } })
    if (svc?.itemCatalogoId != null) {
      // A Configuração Financeira do mesmo mestre acompanha o estado — sem apagar preço nem histórico.
      await tx.produtoFinanceiro.updateMany({ where: { itemCatalogoId: svc.itemCatalogoId }, data: { ativo: false } })
      await tx.itemCatalogo.update({ where: { id: svc.itemCatalogoId }, data: { ativo: false } })
    }
    await tx.logAuditoria.create({
      data: {
        acao: "INATIVACAO", entidade: "SERVICO", entidadeId: servicoId, usuarioId: opts.usuarioId,
        descricao: `Serviço "${analise.alvo.nome}" inativado (histórico preservado) por usuário ${opts.usuarioId}. Motivo: ${opts.motivo ?? "—"}. correlationId=${correlationId}`.slice(0, 500),
        detalhes: {
          correlationId, serviceId: servicoId, serviceCode: analise.alvo.codigo, serviceName: analise.alvo.nome,
          actorUserId: opts.usuarioId, deletionMode: "DEACTIVATION",
          configDependenciesRemoved: [], sharedLinksDetached: [],
          historicalFactsFound: analise.historicalFacts.itens.map((f) => ({ entidade: f.entidade, quantidade: f.quantidade })),
          motivo: opts.motivo ?? null,
        } as Prisma.InputJsonValue,
      },
    })
    return { servicoId, nome: analise.alvo.nome, inativado: true as const, historicalFactsFound: analise.historicalFacts.itens, correlationId }
  }, TX_OPTS)
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO FINANCEIRA — mesma classificação, mesmo contrato de análise.
// ─────────────────────────────────────────────────────────────────────────────

export async function analisarExclusaoConfig(configId: number, db: DB = prisma): Promise<AnaliseExclusao | null> {
  const config = await db.produtoFinanceiro.findUnique({
    where: { id: configId },
    select: { id: true, codigo: true, ativo: true, tipoDocumento: { select: { name: true } }, itemCatalogo: { select: { name: true } }, honorario: { select: { name: true } } },
  })
  if (!config) return null

  const priceIds = (await db.tabelaValor.findMany({ where: { configuracaoFinanceiraItemId: configId }, select: { id: true } })).map((p) => p.id)
  const [fatos, cfgs] = await Promise.all([fatosDaConfig(db, configId, priceIds), configsDaConfig(db, configId, priceIds)])
  const historicalFacts = consolidarFatos(fatos)
  const nome = config.tipoDocumento?.name ?? config.itemCatalogo?.name ?? config.honorario?.name ?? config.codigo ?? `#${config.id}`

  return {
    alvo: { tipo: "CONFIG_FINANCEIRA", id: config.id, nome, codigo: config.codigo, ativo: config.ativo },
    configDependencies: consolidarConfigs(cfgs),
    historicalFacts,
    deletionAllowed: permiteExclusaoDefinitiva(historicalFacts),
    deactivationRequired: exigeInativacao(historicalFacts),
    fraseConfirmacao: FRASE_CONFIRMACAO,
  }
}

export async function excluirConfigDefinitivo(configId: number, opts: { usuarioId: number; motivo?: string | null }) {
  const previa = await analisarExclusaoConfig(configId)
  if (!previa) throw Object.assign(new Error("Configuração financeira não encontrada"), { code: "NAO_ENCONTRADA" })
  if (!previa.deletionAllowed) throw erroUsoReal(previa, false)
  const correlationId = correlacao("EXCL-CFG", configId, new Date())

  return prisma.$transaction(async (tx) => {
    const travado = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "ProdutoFinanceiro" WHERE id = ${configId} FOR UPDATE`
    if (travado.length === 0) throw Object.assign(new Error("Configuração financeira não encontrada"), { code: "NAO_ENCONTRADA" })
    const analise = await analisarExclusaoConfig(configId, tx)
    if (!analise) throw Object.assign(new Error("Configuração financeira não encontrada"), { code: "NAO_ENCONTRADA" })
    if (!analise.deletionAllowed) throw erroUsoReal(analise, true)

    await tx.phaseEconomicRule.deleteMany({ where: { OR: [{ custoConfigId: configId }, { receitaConfigId: configId }] } })
    await tx.phaseAutomationRule.deleteMany({ where: { configItemId: configId } })
    await tx.produtoFinanceiro.update({ where: { id: configId }, data: { servicos: { set: [] } } })
    const priceIds = (await tx.tabelaValor.findMany({ where: { configuracaoFinanceiraItemId: configId }, select: { id: true } })).map((p) => p.id)
    await tx.tabelaValor.deleteMany({ where: { configuracaoFinanceiraItemId: configId } })
    await tx.produtoFinanceiro.delete({ where: { id: configId } })

    const removidas = analise.configDependencies.itens.filter((d) => d.acao === "EXCLUIR")
    const desvinculadas = analise.configDependencies.itens.filter((d) => d.acao === "DESVINCULAR")
    await tx.logAuditoria.create({
      data: {
        acao: "EXCLUSAO_DEFINITIVA", entidade: "CONFIG_FINANCEIRA", entidadeId: configId, usuarioId: opts.usuarioId,
        descricao: `Exclusão definitiva da configuração financeira "${analise.alvo.nome}" por usuário ${opts.usuarioId}. Sem fato histórico. Motivo: ${opts.motivo ?? "—"}. correlationId=${correlationId}`.slice(0, 500),
        detalhes: {
          correlationId, configId, configCode: analise.alvo.codigo, configName: analise.alvo.nome, actorUserId: opts.usuarioId,
          deletionMode: "HARD_DELETE",
          configDependenciesRemoved: removidas.map((d) => ({ entidade: d.entidade, quantidade: d.quantidade, ids: d.ids })),
          sharedLinksDetached: desvinculadas.map((d) => ({ entidade: d.entidade, quantidade: d.quantidade, ids: d.ids })),
          historicalFactsFound: [], precosApagados: priceIds, motivo: opts.motivo ?? null,
        } as Prisma.InputJsonValue,
      },
    })
    return { configId, nome: analise.alvo.nome, precosApagados: priceIds, configDependenciesRemoved: removidas, sharedLinksDetached: desvinculadas, deletionMode: "HARD_DELETE" as const, correlationId }
  }, TX_OPTS)
}

/** Inativação da Configuração Financeira — preserva preços, lançamentos e histórico. */
export async function deactivateConfig(configId: number, opts: { usuarioId: number; motivo?: string | null }) {
  const analise = await analisarExclusaoConfig(configId)
  if (!analise) throw Object.assign(new Error("Configuração financeira não encontrada"), { code: "NAO_ENCONTRADA" })
  const correlationId = correlacao("INAT-CFG", configId, new Date())
  return prisma.$transaction(async (tx) => {
    await tx.produtoFinanceiro.update({ where: { id: configId }, data: { ativo: false } })
    await tx.logAuditoria.create({
      data: {
        acao: "INATIVACAO", entidade: "CONFIG_FINANCEIRA", entidadeId: configId, usuarioId: opts.usuarioId,
        descricao: `Configuração financeira "${analise.alvo.nome}" inativada (histórico preservado) por usuário ${opts.usuarioId}. Motivo: ${opts.motivo ?? "—"}. correlationId=${correlationId}`.slice(0, 500),
        detalhes: {
          correlationId, configId, configName: analise.alvo.nome, actorUserId: opts.usuarioId, deletionMode: "DEACTIVATION",
          historicalFactsFound: analise.historicalFacts.itens.map((f) => ({ entidade: f.entidade, quantidade: f.quantidade })),
          motivo: opts.motivo ?? null,
        } as Prisma.InputJsonValue,
      },
    })
    return { configId, nome: analise.alvo.nome, inativado: true as const, historicalFactsFound: analise.historicalFacts.itens, correlationId }
  }, TX_OPTS)
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM DO CADASTRO MESTRE — idem. Serviços projetados no item entram na mesma análise.
// ─────────────────────────────────────────────────────────────────────────────

export async function analisarExclusaoItemCatalogo(itemId: number, db: DB = prisma): Promise<AnaliseExclusao | null> {
  const item = await db.itemCatalogo.findUnique({
    where: { id: itemId },
    select: { id: true, code: true, name: true, ativo: true },
  })
  if (!item) return null

  const [servicos, tiposDoc, tiposSvc, config] = await Promise.all([
    db.servicoProduto.findMany({ where: { itemCatalogoId: itemId }, select: { id: true } }),
    db.tipoDocumentoCadastro.findMany({ where: { itemCatalogoId: itemId }, select: { id: true } }),
    db.tipoServico.findMany({ where: { itemCatalogoId: itemId }, select: { id: true } }),
    db.produtoFinanceiro.findUnique({ where: { itemCatalogoId: itemId }, select: { id: true } }),
  ])
  const priceIds = (await db.tabelaValor.findMany({
    where: { OR: [{ itemCatalogoId: itemId }, ...(config ? [{ configuracaoFinanceiraItemId: config.id }] : [])] },
    select: { id: true },
  })).map((p) => p.id)

  // Um serviço projetado neste item traz consigo os PRÓPRIOS fatos históricos.
  const fatosDosServicos = await Promise.all(servicos.map((s) => fatosDoServico(db, s.id)))
  const [fatosItem, fatosConfig, cfgsConfig] = await Promise.all([
    fatosDoItem(db, itemId),
    config ? fatosDaConfig(db, config.id, priceIds) : Promise.resolve([] as FatoHistoricoDetectado[]),
    config ? configsDaConfig(db, config.id, priceIds) : Promise.resolve([] as DependenciaConfiguracional[]),
  ])
  const historicalFacts = consolidarFatos(fatosItem, fatosConfig, ...fatosDosServicos)

  const configDependencies = consolidarConfigs(cfgsConfig, [
    ...(config == null && priceIds.length ? [dependencia("RegraDePreco", priceIds.length, "EXCLUIR", priceIds)] : []),
    ...(config ? [dependencia("ConfiguracaoFinanceira", 1, "EXCLUIR", [config.id])] : []),
    ...(servicos.length ? [dependencia("ProjecaoServicoServico", servicos.length, "EXCLUIR", servicos.map((s) => s.id))] : []),
    ...(tiposDoc.length ? [dependencia("VinculoTipoDocumento", tiposDoc.length, "DESVINCULAR", tiposDoc.map((t) => t.id))] : []),
    ...(tiposSvc.length ? [dependencia("VinculoTipoServico", tiposSvc.length, "DESVINCULAR", tiposSvc.map((t) => t.id))] : []),
  ])

  return {
    alvo: { tipo: "ITEM_CATALOGO", id: item.id, nome: item.name, codigo: item.code, ativo: item.ativo },
    configDependencies,
    historicalFacts,
    deletionAllowed: permiteExclusaoDefinitiva(historicalFacts),
    deactivationRequired: exigeInativacao(historicalFacts),
    fraseConfirmacao: FRASE_CONFIRMACAO,
  }
}

export async function excluirItemCatalogoDefinitivo(itemId: number, opts: { usuarioId: number; motivo?: string | null }) {
  const previa = await analisarExclusaoItemCatalogo(itemId)
  if (!previa) throw Object.assign(new Error("Item de catálogo não encontrado"), { code: "NAO_ENCONTRADA" })
  if (!previa.deletionAllowed) throw erroUsoReal(previa, false)
  const correlationId = correlacao("EXCL-ITM", itemId, new Date())

  // Os serviços projetados caem pelo MOTOR CANÔNICO de serviço (nada de delete paralelo).
  const servicos = await prisma.servicoProduto.findMany({ where: { itemCatalogoId: itemId }, select: { id: true } })
  for (const s of servicos) await deleteService(s.id, { usuarioId: opts.usuarioId, motivo: `cascata do item mestre #${itemId}` })

  const aindaExiste = await prisma.itemCatalogo.findUnique({ where: { id: itemId }, select: { id: true } })
  if (!aindaExiste) {
    return { itemId, nome: previa.alvo.nome, precosApagados: [] as number[], deletionMode: "HARD_DELETE" as const, correlationId, viaCascataDeServico: true }
  }

  return prisma.$transaction(async (tx) => {
    const travado = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "ItemCatalogo" WHERE id = ${itemId} FOR UPDATE`
    if (travado.length === 0) throw Object.assign(new Error("Item de catálogo não encontrado"), { code: "NAO_ENCONTRADA" })
    const analise = await analisarExclusaoItemCatalogo(itemId, tx)
    if (!analise) throw Object.assign(new Error("Item de catálogo não encontrado"), { code: "NAO_ENCONTRADA" })
    if (!analise.deletionAllowed) throw erroUsoReal(analise, true)

    const config = await tx.produtoFinanceiro.findUnique({ where: { itemCatalogoId: itemId }, select: { id: true } })
    if (config) {
      await tx.phaseEconomicRule.deleteMany({ where: { OR: [{ custoConfigId: config.id }, { receitaConfigId: config.id }] } })
      await tx.phaseAutomationRule.deleteMany({ where: { configItemId: config.id } })
      await tx.produtoFinanceiro.update({ where: { id: config.id }, data: { servicos: { set: [] } } })
    }
    // Mestres COMPARTILHADOS: só perdem o vínculo.
    await tx.tipoDocumentoCadastro.updateMany({ where: { itemCatalogoId: itemId }, data: { itemCatalogoId: null } })
    await tx.tipoServico.updateMany({ where: { itemCatalogoId: itemId }, data: { itemCatalogoId: null } })

    const priceIds = (await tx.tabelaValor.findMany({
      where: { OR: [{ itemCatalogoId: itemId }, ...(config ? [{ configuracaoFinanceiraItemId: config.id }] : [])] }, select: { id: true },
    })).map((p) => p.id)
    if (priceIds.length) await tx.tabelaValor.deleteMany({ where: { id: { in: priceIds } } })
    if (config) await tx.produtoFinanceiro.delete({ where: { id: config.id } })
    await tx.itemCatalogo.delete({ where: { id: itemId } })

    const removidas = analise.configDependencies.itens.filter((d) => d.acao === "EXCLUIR")
    const desvinculadas = analise.configDependencies.itens.filter((d) => d.acao === "DESVINCULAR")
    await tx.logAuditoria.create({
      data: {
        acao: "EXCLUSAO_DEFINITIVA", entidade: "ITEM_CATALOGO", entidadeId: itemId, usuarioId: opts.usuarioId,
        descricao: `Exclusão definitiva do item mestre "${analise.alvo.nome}" (${analise.alvo.codigo}) por usuário ${opts.usuarioId}. Sem fato histórico. Motivo: ${opts.motivo ?? "—"}. correlationId=${correlationId}`.slice(0, 500),
        detalhes: {
          correlationId, itemId, itemCode: analise.alvo.codigo, itemName: analise.alvo.nome, actorUserId: opts.usuarioId,
          deletionMode: "HARD_DELETE",
          configDependenciesRemoved: removidas.map((d) => ({ entidade: d.entidade, quantidade: d.quantidade, ids: d.ids })),
          sharedLinksDetached: desvinculadas.map((d) => ({ entidade: d.entidade, quantidade: d.quantidade, ids: d.ids })),
          historicalFactsFound: [], precosApagados: priceIds, motivo: opts.motivo ?? null,
        } as Prisma.InputJsonValue,
      },
    })
    return { itemId, nome: analise.alvo.nome, precosApagados: priceIds, deletionMode: "HARD_DELETE" as const, correlationId, viaCascataDeServico: false }
  }, TX_OPTS)
}

/** Inativação do Item do Cadastro Mestre — o mestre sai de circulação; nada é apagado. */
export async function deactivateItemCatalogo(itemId: number, opts: { usuarioId: number; motivo?: string | null }) {
  const analise = await analisarExclusaoItemCatalogo(itemId)
  if (!analise) throw Object.assign(new Error("Item de catálogo não encontrado"), { code: "NAO_ENCONTRADA" })
  const correlationId = correlacao("INAT-ITM", itemId, new Date())
  return prisma.$transaction(async (tx) => {
    await tx.itemCatalogo.update({ where: { id: itemId }, data: { ativo: false } })
    await tx.produtoFinanceiro.updateMany({ where: { itemCatalogoId: itemId }, data: { ativo: false } })
    await tx.servicoProduto.updateMany({ where: { itemCatalogoId: itemId }, data: { ativo: false } })
    await tx.logAuditoria.create({
      data: {
        acao: "INATIVACAO", entidade: "ITEM_CATALOGO", entidadeId: itemId, usuarioId: opts.usuarioId,
        descricao: `Item mestre "${analise.alvo.nome}" (${analise.alvo.codigo}) inativado (histórico preservado) por usuário ${opts.usuarioId}. Motivo: ${opts.motivo ?? "—"}. correlationId=${correlationId}`.slice(0, 500),
        detalhes: {
          correlationId, itemId, itemCode: analise.alvo.codigo, itemName: analise.alvo.nome, actorUserId: opts.usuarioId,
          deletionMode: "DEACTIVATION",
          historicalFactsFound: analise.historicalFacts.itens.map((f) => ({ entidade: f.entidade, quantidade: f.quantidade })),
          motivo: opts.motivo ?? null,
        } as Prisma.InputJsonValue,
      },
    })
    return { itemId, nome: analise.alvo.nome, inativado: true as const, historicalFactsFound: analise.historicalFacts.itens, correlationId }
  }, TX_OPTS)
}
