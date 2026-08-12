// src/services/parametrizacao/estado-parametrizacao.ts
// ============================================================================
// ESTADO DO ASSISTENTE DE PARAMETRIZAÇÃO — derivado, nunca guardado.
//
// Cada etapa responde "como estou?" olhando a entidade canônica que lhe
// corresponde: a Matriz olha `MatrizDocumental`, os serviços olham
// `ItemCatalogo`, o custo olha `TabelaValor` de natureza CUSTO. Nada aqui é
// persistido — se fosse, alguém cadastraria um preço pela Tabela de Valores e o
// assistente continuaria dizendo que falta, até que outra rotina o corrigisse.
//
// O assistente guarda apenas ONDE o administrador parou
// (`AssistenteParametrizacaoProgresso`). O QUE está preenchido é sempre lido.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { pendenciasDaParametrizacao, impedimentosDePublicacao, type Pendencia } from "@/src/services/financeiro/pendencias-parametrizacao"

/** Chaves ESTRUTURAIS das etapas — identidade, não rótulo de tela. */
export const ETAPAS = [
  "escopo", "matriz", "servicos", "fornecedores", "aplicabilidade",
  "custos", "receitas", "politicas", "moedas", "simulacao",
  "pendencias", "publicacao", "materializacao", "validacao",
] as const
export type EtapaKey = (typeof ETAPAS)[number]

export type StatusEtapa =
  | "NAO_INICIADA" | "EM_PREENCHIMENTO" | "PENDENTE"
  | "COMPLETA" | "PUBLICAVEL" | "PUBLICADA" | "BLOQUEADA"

export interface EstadoEtapa {
  etapa: EtapaKey
  titulo: string
  status: StatusEtapa
  completos: number
  pendentes: number
  /** o que precisa ser feito, em frase de operador */
  acao: string | null
  /** tela oficial que edita esta etapa (o assistente a embute, não a substitui) */
  telaKey: string | null
  pendencias: Pendencia[]
}

export interface EscopoParametrizacao {
  tipoProcessoId: number
  phaseKey?: string | null
}

export interface EstadoParametrizacao {
  escopo: {
    tipoProcessoId: number
    tipoProcessoNome: string
    pais: string
    fases: { phaseKey: string; label: string; ordem: number; obrigatoria: boolean }[]
    phaseKey: string | null
  }
  etapas: EstadoEtapa[]
  /** progresso salvo (só marcador de lugar) */
  progresso: { etapaAtual: EtapaKey; etapasConcluidas: EtapaKey[]; publicadoEm: string | null } | null
  /** true = tudo que bloqueia foi resolvido; a publicação pode ser oferecida */
  publicavel: boolean
}

const TITULO: Record<EtapaKey, string> = {
  escopo: "Escopo da parametrização",
  matriz: "Matriz Documental",
  servicos: "Produtos e Serviços",
  fornecedores: "Fornecedores",
  aplicabilidade: "Aplicabilidade Econômica",
  custos: "Custos",
  receitas: "Receitas",
  politicas: "Políticas de cobrança e reembolso",
  moedas: "Moedas, impostos e descontos",
  simulacao: "Simulação",
  pendencias: "Revisão de pendências",
  publicacao: "Publicação",
  materializacao: "Materialização e reconciliação",
  validacao: "Validação final",
}

/** Tela oficial que edita cada etapa — o assistente a EMBUTE (mesma tela, mesmo endpoint). */
const TELA: Partial<Record<EtapaKey, string>> = {
  matriz: "docrules",
  servicos: "servicecatalog",
  fornecedores: "suppliers",
  aplicabilidade: "econapplicability",
  custos: "pricingtable",
  receitas: "pricingtable",
  politicas: "econapplicability",
  moedas: "currencies",
}

export async function estadoParametrizacao(escopo: EscopoParametrizacao): Promise<EstadoParametrizacao> {
  const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: escopo.tipoProcessoId } })
  if (!tipo) throw new Error(`Tipo de processo ${escopo.tipoProcessoId} não existe.`)

  const macro = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: tipo.id },
    select: { fases: { select: { phaseKey: true, label: true, ordem: true, required: true }, orderBy: { ordem: "asc" } } },
  })
  const fases = (macro?.fases ?? []).map((f) => ({ phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, obrigatoria: f.required }))
  const fasesNoEscopo = escopo.phaseKey ? fases.filter((f) => f.phaseKey === escopo.phaseKey) : fases
  const chavesFase = fasesNoEscopo.map((f) => f.phaseKey)

  // ── leituras canônicas ────────────────────────────────────────────────────
  const regras = await prisma.matrizDocumental.findMany({
    where: { tipoProcessoId: tipo.id, arquivado: false, ...(chavesFase.length ? { phaseKey: { in: chavesFase } } : {}) },
    select: { id: true, status: true, phaseKey: true, documentTypeCode: true, createsCost: true, createsRevenue: true },
  })
  const econs = await prisma.phaseEconomicRule.findMany({
    where: chavesFase.length ? { phaseKey: { in: chavesFase } } : {},
    select: { id: true, ativo: true, componentName: true, custoConfigId: true, receitaConfigId: true, phaseKey: true },
  })
  const configIds = [...new Set(econs.flatMap((e) => [e.custoConfigId, e.receitaConfigId]).filter((x): x is number => x != null))]
  const configs = configIds.length
    ? await prisma.produtoFinanceiro.findMany({
        where: { id: { in: configIds } },
        select: { id: true, itemCatalogoId: true, fornecedorPadraoId: true, repasse: true, reembolsavel: true, cobravelDoCliente: true, moedaPadrao: true },
      })
    : []
  const precos = configIds.length
    ? await prisma.tabelaValor.findMany({
        where: { configuracaoFinanceiraItemId: { in: configIds }, arquivado: false },
        select: { configuracaoFinanceiraItemId: true, natureza: true, valor: true, moeda: true, name: true },
      })
    : []
  const temPreco = (cfgId: number, nat: "CUSTO" | "VENDA") =>
    precos.some((p) => p.configuracaoFinanceiraItemId === cfgId && p.natureza === nat && Number(p.valor) > 0 && !p.name.includes("[AJUSTAR]"))

  // Pendências vêm do MESMO apurador que o guard de publicação usa.
  // ESCOPO: sem fase escolhida, o recorte são TODAS as fases deste tipo de
  // processo — nunca o cadastro inteiro. Pendência de outro tipo de processo não
  // pode bloquear a publicação deste.
  const rel = await pendenciasDaParametrizacao(
    escopo.phaseKey ? { phaseKey: escopo.phaseKey } : { phaseKeys: chavesFase },
  )
  const impedimentos = impedimentosDePublicacao(rel.pendencias)
  const pendDaFase = (fase: string | null) => rel.pendencias.filter((p) => (fase == null ? true : p.phaseKey === fase))

  const etapa = (
    k: EtapaKey, completos: number, pendentes: number, acao: string | null,
    status: StatusEtapa, pendencias: Pendencia[] = [],
  ): EstadoEtapa => ({ etapa: k, titulo: TITULO[k], status, completos, pendentes, acao, telaKey: TELA[k] ?? null, pendencias })

  const publicadas = regras.filter((r) => r.status === "PUBLICADA")
  const rascunhos = regras.filter((r) => r.status !== "PUBLICADA")
  const econsAtivos = econs.filter((e) => e.ativo)
  const comCusto = econs.filter((e) => e.custoConfigId != null)
  const comCustoOk = comCusto.filter((e) => temPreco(e.custoConfigId as number, "CUSTO"))
  const comReceita = econs.filter((e) => e.receitaConfigId != null)
  const comReceitaOk = comReceita.filter((e) => temPreco(e.receitaConfigId as number, "VENDA"))
  const cfgsQueExigemFornecedor = configs.filter((c) => econs.some((e) => e.custoConfigId === c.id))
  const cfgsComFornecedor = cfgsQueExigemFornecedor.filter((c) => c.fornecedorPadraoId != null)
  const cfgsComPolitica = configs.filter((c) => c.repasse || c.reembolsavel || c.cobravelDoCliente)
  const cfgsComMoeda = configs.filter((c) => c.moedaPadrao != null)
  const servicosVinculados = [...new Set(configs.map((c) => c.itemCatalogoId).filter((x): x is number => x != null))]

  const etapas: EstadoEtapa[] = [
    etapa("escopo", 1, 0, null, "COMPLETA"),

    etapa("matriz", publicadas.length, rascunhos.length,
      regras.length === 0 ? "Nenhuma regra documental cadastrada para este tipo de processo"
        : rascunhos.length ? `${rascunhos.length} regra(s) aguardando publicação` : null,
      regras.length === 0 ? "NAO_INICIADA" : publicadas.length && !rascunhos.length ? "PUBLICADA" : rascunhos.length ? "EM_PREENCHIMENTO" : "PENDENTE",
      rel.pendencias.filter((p) => p.tipo === "REGRA_NAO_PUBLICADA")),

    etapa("servicos", servicosVinculados.length, 0,
      servicosVinculados.length === 0 ? "Nenhum serviço vinculado a componente econômico" : null,
      servicosVinculados.length ? "COMPLETA" : "NAO_INICIADA"),

    etapa("fornecedores", cfgsComFornecedor.length, cfgsQueExigemFornecedor.length - cfgsComFornecedor.length,
      cfgsQueExigemFornecedor.length > cfgsComFornecedor.length
        ? `${cfgsQueExigemFornecedor.length - cfgsComFornecedor.length} serviço(s) de custo sem fornecedor` : null,
      cfgsQueExigemFornecedor.length === 0 ? "NAO_INICIADA"
        : cfgsComFornecedor.length === cfgsQueExigemFornecedor.length ? "COMPLETA" : "PENDENTE",
      rel.pendencias.filter((p) => p.tipo === "SEM_FORNECEDOR")),

    etapa("aplicabilidade", econsAtivos.length, econs.length - econsAtivos.length,
      econs.length === 0 ? "Nenhum componente econômico para as fases deste escopo"
        : econs.length > econsAtivos.length ? `${econs.length - econsAtivos.length} componente(s) inativo(s)` : null,
      econs.length === 0 ? "NAO_INICIADA" : econsAtivos.length === econs.length ? "COMPLETA" : "PENDENTE",
      rel.pendencias.filter((p) => p.tipo === "COMPONENTE_INATIVO")),

    etapa("custos", comCustoOk.length, comCusto.length - comCustoOk.length,
      comCusto.length > comCustoOk.length ? `${comCusto.length - comCustoOk.length} serviço(s) sem preço de custo vigente` : null,
      comCusto.length === 0 ? "NAO_INICIADA" : comCustoOk.length === comCusto.length ? "COMPLETA" : "PENDENTE",
      rel.pendencias.filter((p) => p.tipo === "SEM_PRECO_DE_CUSTO" || p.tipo === "PRECO_PLACEHOLDER")),

    etapa("receitas", comReceitaOk.length, comReceita.length - comReceitaOk.length,
      comReceita.length > comReceitaOk.length ? `${comReceita.length - comReceitaOk.length} serviço(s) sem preço de venda vigente` : null,
      comReceita.length === 0 ? "NAO_INICIADA" : comReceitaOk.length === comReceita.length ? "COMPLETA" : "PENDENTE",
      rel.pendencias.filter((p) => p.tipo === "SEM_PRECO_DE_VENDA")),

    etapa("politicas", cfgsComPolitica.length, configs.length - cfgsComPolitica.length,
      configs.length > cfgsComPolitica.length
        ? `${configs.length - cfgsComPolitica.length} serviço(s) sem política (absorvido / reembolsável / repassado)` : null,
      configs.length === 0 ? "NAO_INICIADA" : cfgsComPolitica.length === configs.length ? "COMPLETA" : "PENDENTE",
      rel.pendencias.filter((p) => p.tipo === "SEM_POLITICA_COMERCIAL")),

    etapa("moedas", cfgsComMoeda.length, configs.length - cfgsComMoeda.length,
      configs.length > cfgsComMoeda.length ? `${configs.length - cfgsComMoeda.length} serviço(s) sem moeda padrão` : null,
      configs.length === 0 ? "NAO_INICIADA" : cfgsComMoeda.length === configs.length ? "COMPLETA" : "EM_PREENCHIMENTO"),

    etapa("simulacao", 0, 0, "Simule antes de publicar — a simulação usa o motor real", "NAO_INICIADA"),

    etapa("pendencias", rel.pendencias.length - impedimentos.length, impedimentos.length,
      impedimentos.length ? `${impedimentos.length} pendência(s) impedem a publicação` : null,
      impedimentos.length ? "BLOQUEADA" : "COMPLETA", pendDaFase(escopo.phaseKey ?? null)),

    etapa("publicacao", publicadas.length, rascunhos.length,
      impedimentos.length ? "Resolva as pendências bloqueantes antes de publicar" : null,
      impedimentos.length ? "BLOQUEADA" : rascunhos.length ? "PUBLICAVEL" : publicadas.length ? "PUBLICADA" : "NAO_INICIADA"),

    etapa("materializacao", 0, 0,
      impedimentos.length ? "Disponível após a publicação" : null,
      impedimentos.length ? "BLOQUEADA" : "NAO_INICIADA"),

    etapa("validacao", 0, 0, null, impedimentos.length ? "BLOQUEADA" : "NAO_INICIADA"),
  ]

  // `phaseKey` é nullable: o unique composto do Prisma não aceita null na chave,
  // então a busca é por findFirst — o índice único no banco continua garantindo
  // que só existe um progresso por escopo.
  const prog = await prisma.assistenteParametrizacaoProgresso.findFirst({
    where: { tipoProcessoId: tipo.id, phaseKey: escopo.phaseKey ?? null },
  }).catch(() => null)

  return {
    escopo: {
      tipoProcessoId: tipo.id, tipoProcessoNome: tipo.name, pais: tipo.countryLabel,
      fases, phaseKey: escopo.phaseKey ?? null,
    },
    etapas,
    progresso: prog ? {
      etapaAtual: prog.etapaAtual as EtapaKey,
      etapasConcluidas: (Array.isArray(prog.etapasConcluidas) ? prog.etapasConcluidas : []) as EtapaKey[],
      publicadoEm: prog.publicadoEm ? prog.publicadoEm.toISOString() : null,
    } : null,
    publicavel: impedimentos.length === 0 && rascunhos.length > 0,
  }
}
