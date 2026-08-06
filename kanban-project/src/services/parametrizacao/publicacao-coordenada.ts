// src/services/parametrizacao/publicacao-coordenada.ts
// ============================================================================
// PUBLICAÇÃO COORDENADA — tudo ou nada.
//
// Publicar a parametrização é ligar várias chaves ao mesmo tempo: os componentes
// econômicos passam a valer e as regras documentais passam a executar. Ligar
// metade é o pior estado possível — regra publicada com componente inativo gera
// pendência processo a processo, e componente ativo sem regra publicada não gera
// nada e parece quebrado.
//
// Por isso: valida TUDO antes de escrever QUALQUER coisa, e escreve numa
// transação só. Se um item crítico falhar, nada é publicado e os rascunhos
// permanecem intactos.
//
// Este serviço NÃO cria nem edita configuração — ele só muda ESTADO
// (rascunho → publicada, inativo → ativo) do que as telas oficiais cadastraram.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { pendenciasDoComponente, impedimentosDePublicacao, type Pendencia } from "@/src/services/financeiro/pendencias-parametrizacao"

export interface ResultadoPublicacao {
  publicou: boolean
  /** o que impediu — vazio quando publicou */
  impedimentos: Pendencia[]
  regrasPublicadas: number[]
  componentesAtivados: number[]
}

/**
 * Publica o escopo. `phaseKey` null = todas as fases do tipo de processo.
 *
 * Ordem de escrita dentro da transação: primeiro os componentes econômicos
 * (o que a regra vai precisar quando executar), depois as regras documentais
 * (o que dispara a execução). Assim, em nenhum instante existe regra publicada
 * apontando para componente ainda inativo.
 */
export async function publicarParametrizacao(args: {
  tipoProcessoId: number
  phaseKey?: string | null
  usuarioId?: number | null
}): Promise<ResultadoPublicacao> {
  const macro = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: args.tipoProcessoId },
    select: { fases: { select: { phaseKey: true } } },
  })
  const fases = (macro?.fases ?? []).map((f) => f.phaseKey).filter((f) => (args.phaseKey ? f === args.phaseKey : true))
  if (fases.length === 0) {
    return { publicou: false, impedimentos: [], regrasPublicadas: [], componentesAtivados: [] }
  }

  // ── 1. O QUE seria publicado ─────────────────────────────────────────────
  const regras = await prisma.matrizDocumental.findMany({
    where: { tipoProcessoId: args.tipoProcessoId, phaseKey: { in: fases }, arquivado: false, status: { not: "PUBLICADA" } },
    select: { id: true, phaseKey: true, nome: true, documentTypeCode: true, createsCost: true, createsRevenue: true },
  })
  const componentes = await prisma.phaseEconomicRule.findMany({
    where: { phaseKey: { in: fases } }, select: { id: true, ativo: true, componentName: true },
  })

  // ── 2. VALIDAÇÃO — antes de qualquer escrita ─────────────────────────────
  const impedimentos: Pendencia[] = []

  if (regras.length === 0) {
    impedimentos.push({
      tipo: "REGRA_NAO_PUBLICADA", bloqueia: true,
      mensagem: "Não há regra documental em rascunho para publicar neste escopo",
      onde: "Gerenciamento › Documentos › Regras Documentais",
      phaseKey: args.phaseKey ?? null, componentKey: null, componentName: null,
      configFinanceiraId: null, regraDocumentalId: null,
    })
  }

  // Só os componentes que serão ATIVADOS precisam estar completos. Componente
  // que fica inativo de propósito (serviço que a Discovery não usa nesta fase)
  // não pode barrar a publicação do resto.
  const aAtivar = componentes.filter((c) => !c.ativo)
  const geraDinheiro = regras.some((r) => r.createsCost || r.createsRevenue)
  if (geraDinheiro && componentes.length === 0) {
    impedimentos.push({
      tipo: "SEM_CONFIG_DE_CUSTO", bloqueia: true,
      mensagem: `As fases deste escopo não têm componente econômico — a regra geraria custo sem ter o que lançar`,
      onde: "Gerenciamento › Financeiro › Aplicabilidade Econômica",
      phaseKey: args.phaseKey ?? null, componentKey: null, componentName: null,
      configFinanceiraId: null, regraDocumentalId: null,
    })
  }
  for (const c of aAtivar) {
    // As pendências do componente são apuradas pelo MESMO serviço que o guard de
    // publicação da regra usa. `COMPONENTE_INATIVO` é o que estamos prestes a
    // resolver — não conta como impedimento aqui.
    impedimentos.push(...impedimentosDePublicacao(await pendenciasDoComponente(c.id)))
  }

  if (impedimentos.length > 0) {
    return { publicou: false, impedimentos, regrasPublicadas: [], componentesAtivados: [] }
  }

  // ── 3. ESCRITA — uma transação, ordem que nunca deixa estado inválido ─────
  const agora = new Date()
  const { regrasPublicadas, componentesAtivados } = await prisma.$transaction(async (tx) => {
    const ativados: number[] = []
    for (const c of aAtivar) {
      await tx.phaseEconomicRule.update({ where: { id: c.id }, data: { ativo: true } })
      ativados.push(c.id)
    }
    const publicadas: number[] = []
    for (const r of regras) {
      await tx.matrizDocumental.update({
        where: { id: r.id },
        data: { status: "PUBLICADA", publicadoEm: agora, publicadoPor: args.usuarioId ?? undefined },
      })
      publicadas.push(r.id)
    }
    await tx.assistenteParametrizacaoProgresso.updateMany({
      where: { tipoProcessoId: args.tipoProcessoId, phaseKey: args.phaseKey ?? null },
      data: { publicadoEm: agora, publicadoPor: args.usuarioId ?? null, etapaAtual: "materializacao" },
    })
    return { regrasPublicadas: publicadas, componentesAtivados: ativados }
  }, { timeout: 30000, maxWait: 10000 })

  return { publicou: true, impedimentos: [], regrasPublicadas, componentesAtivados }
}
