// src/services/parametrizacao/concluir-parametrizacao.ts
// ============================================================================
// CONCLUIR PARAMETRIZAÇÃO — o ciclo inteiro, sem terminal.
//
// Este serviço não faz nada sozinho. Ele CHAMA, em ordem, os serviços canônicos
// que já existem e já são testados:
//
//   publicar        → publicarParametrizacao      (transacional, tudo-ou-nada)
//   materializar    → materializarExecucaoDaFase  (o materializador ÚNICO)
//   reconciliar     → reconciliarFaseAtiva + reconciliarDocumentalFinanceiro
//   projeções       → resolveOperationalProjection
//   validar         → montarPlanilhaDocumental + listarObrigacoes
//
// Reimplementar qualquer um deles aqui — mesmo "só para o assistente" — criaria
// um segundo caminho para o mesmo fato, e ele divergiria do primeiro no primeiro
// ajuste de regra. O que este arquivo tem de próprio é a SEQUÊNCIA e a contagem.
//
// ISOLAMENTO POR ETAPA
// --------------------
// Uma etapa que falha não derruba as seguintes quando elas não dependem dela:
// publicar é pré-requisito de materializar, mas validar a planilha não é
// pré-requisito de nada. O relatório diz o que rodou, o que foi pulado e por quê
// — "não obrigar o administrador a procurar o erro" é requisito, não cortesia.
//
// IDEMPOTÊNCIA
// ------------
// Vem dos serviços chamados: publicar ignora o que já está publicado,
// materializar reaproveita passo existente, a projeção documental tem chave
// única no banco. Rodar de novo converge; não duplica.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { publicarParametrizacao } from "./publicacao-coordenada"
import { estadoParametrizacao } from "./estado-parametrizacao"
import { pendenciasDaParametrizacao, impedimentosDePublicacao, type Pendencia } from "@/src/services/financeiro/pendencias-parametrizacao"
import { materializarExecucaoDaFase } from "@/src/services/materializar-fase"
import { reconciliarDocumentalFinanceiro } from "@/src/services/financeiro/reconciliacao-documental-financeira"
import { montarPlanilhaDocumental } from "@/lib/financeiro/leitura/planilha-documental"
import { listarObrigacoes } from "@/lib/financeiro/leitura/consultas"

export type EtapaExecucaoKey =
  | "validar" | "publicar" | "materializar" | "reconciliar"
  | "projecoes" | "financeiro" | "planilha" | "guards"

export interface ResultadoEtapaExecucao {
  etapa: EtapaExecucaoKey
  titulo: string
  status: "OK" | "PULADA" | "ERRO"
  duracaoMs: number
  processados: number
  criados: number
  atualizados: number
  ignorados: number
  erros: number
  /** o que aconteceu, em frase de operador */
  detalhe: string
  /** motivos nomeados — nunca silêncio */
  mensagens: string[]
}

export interface RelatorioConclusao {
  tipoProcessoId: number
  phaseKey: string | null
  iniciadoEm: string
  duracaoMs: number
  etapas: ResultadoEtapaExecucao[]
  /** resumo administrativo, na estrutura que o relatório final pede */
  resumo: {
    documentos: { criados: number; atualizados: number; ignorados: number; erros: number }
    workflows: { criados: number; reutilizados: number; ignorados: number }
    tasks: { criadas: number; reutilizadas: number }
    financeiro: { custosGerados: number; receitasGeradas: number; custosIgnorados: number; receitasIgnoradas: number }
    planilha: { linhas: number; colunas: number; totalBrl: number }
    reconciliacao: { encontradas: number; corrigidas: number; restantes: number }
    parametrizacao: { matrizesPublicadas: number; regrasPublicadas: number; componentesAtivos: number }
  }
  pendencias: Pendencia[]
  concluiu: boolean
}

const TITULO: Record<EtapaExecucaoKey, string> = {
  validar: "Validando regras e dependências",
  publicar: "Publicando parametrização",
  materializar: "Materializando documentos, workflows e tarefas",
  reconciliar: "Reconciliando a cadeia documental-financeira",
  projecoes: "Atualizando projeções",
  financeiro: "Validando o Financeiro",
  planilha: "Validando a Planilha Documental-Financeira",
  guards: "Executando os guards obrigatórios",
}

const vazia = (etapa: EtapaExecucaoKey): ResultadoEtapaExecucao => ({
  etapa, titulo: TITULO[etapa], status: "PULADA", duracaoMs: 0,
  processados: 0, criados: 0, atualizados: 0, ignorados: 0, erros: 0,
  detalhe: "", mensagens: [],
})

/**
 * Executa o ciclo e EMITE cada etapa assim que ela termina, para a interface
 * mostrar progresso real em vez de um spinner cego.
 */
export async function* concluirParametrizacao(args: {
  tipoProcessoId: number
  phaseKey?: string | null
  usuarioId?: number | null
}): AsyncGenerator<ResultadoEtapaExecucao | { relatorio: RelatorioConclusao }> {
  const t0 = Date.now()
  const iniciadoEm = new Date().toISOString()
  const etapas: ResultadoEtapaExecucao[] = []
  const emitir = async (e: ResultadoEtapaExecucao) => { etapas.push(e); return e }

  const macro = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: args.tipoProcessoId },
    select: { fases: { select: { phaseKey: true }, orderBy: { ordem: "asc" } } },
  })
  const fases = (macro?.fases ?? []).map((f) => f.phaseKey).filter((f) => (args.phaseKey ? f === args.phaseKey : true))

  const resumo: RelatorioConclusao["resumo"] = {
    documentos: { criados: 0, atualizados: 0, ignorados: 0, erros: 0 },
    workflows: { criados: 0, reutilizados: 0, ignorados: 0 },
    tasks: { criadas: 0, reutilizadas: 0 },
    financeiro: { custosGerados: 0, receitasGeradas: 0, custosIgnorados: 0, receitasIgnoradas: 0 },
    planilha: { linhas: 0, colunas: 0, totalBrl: 0 },
    reconciliacao: { encontradas: 0, corrigidas: 0, restantes: 0 },
    parametrizacao: { matrizesPublicadas: 0, regrasPublicadas: 0, componentesAtivos: 0 },
  }

  // ── 1. VALIDAR ───────────────────────────────────────────────────────────
  let t = Date.now()
  const et1 = vazia("validar")
  const rel = await pendenciasDaParametrizacao({ phaseKeys: fases })
  const impedimentos = impedimentosDePublicacao(rel.pendencias)
  et1.processados = rel.componentes
  et1.ignorados = rel.pendencias.length - impedimentos.length
  et1.erros = impedimentos.length
  et1.status = impedimentos.length ? "ERRO" : "OK"
  et1.detalhe = impedimentos.length
    ? `${impedimentos.length} pendência(s) impedem a publicação`
    : `${rel.componentes} componente(s) verificado(s), nenhuma pendência bloqueante`
  et1.mensagens = impedimentos.map((i) => `${i.mensagem} · ${i.onde}`)
  et1.duracaoMs = Date.now() - t
  yield await emitir(et1)

  // ── 2. PUBLICAR ──────────────────────────────────────────────────────────
  t = Date.now()
  const et2 = vazia("publicar")
  if (impedimentos.length) {
    et2.detalhe = "pulada — a validação encontrou impedimentos"
    et2.duracaoMs = Date.now() - t
  } else {
    const p = await publicarParametrizacao({ tipoProcessoId: args.tipoProcessoId, phaseKey: args.phaseKey ?? null, usuarioId: args.usuarioId ?? null })
    et2.status = p.publicou ? "OK" : (p.impedimentos.length ? "ERRO" : "PULADA")
    et2.atualizados = p.regrasPublicadas.length + p.componentesAtivados.length
    et2.erros = p.impedimentos.length
    et2.mensagens = p.impedimentos.map((i) => `${i.mensagem} · ${i.onde}`)
    et2.detalhe = p.publicou
      ? `${p.regrasPublicadas.length} regra(s) publicada(s), ${p.componentesAtivados.length} componente(s) ativado(s)`
      : (p.impedimentos.length ? "publicação bloqueada" : "nada em rascunho para publicar")
    resumo.parametrizacao.matrizesPublicadas = p.regrasPublicadas.length
    resumo.parametrizacao.regrasPublicadas = p.regrasPublicadas.length
    et2.duracaoMs = Date.now() - t
  }
  yield await emitir(et2)

  // ── 3. MATERIALIZAR — o materializador ÚNICO, processo a processo ────────
  t = Date.now()
  const et3 = vazia("materializar")
  const processos = await prisma.processo.findMany({
    where: { tipoProcessoMotorId: args.tipoProcessoId },
    select: { id: true }, orderBy: { id: "asc" },
  })
  et3.processados = processos.length
  for (const proc of processos) {
    try {
      const r = await materializarExecucaoDaFase({ processoId: proc.id, fonte: "RECONCILIACAO", solicitadoPorId: args.usuarioId ?? undefined })
      if (r.ok) {
        resumo.workflows[r.passosCriados > 0 ? "criados" : "reutilizados"] += 1
        resumo.tasks.criadas += r.tarefasCriadas
        resumo.tasks.reutilizadas += r.tarefasPreexistentes
        et3.criados += r.passosCriados
        et3.ignorados += r.passosPreexistentes
      } else {
        resumo.workflows.ignorados += 1
        et3.ignorados += 1
        if (r.mensagemAdministrativa) et3.mensagens.push(`processo ${proc.id}: ${r.mensagemAdministrativa}`)
      }
    } catch (e) {
      et3.erros++
      et3.mensagens.push(`processo ${proc.id}: ${e instanceof Error ? e.message : "erro"}`)
    }
  }
  et3.status = et3.erros ? "ERRO" : "OK"
  et3.detalhe = `${processos.length} processo(s) · ${et3.criados} passo(s) criado(s) · ${resumo.tasks.criadas} tarefa(s) criada(s)`
  et3.duracaoMs = Date.now() - t
  yield await emitir(et3)

  // ── 4. RECONCILIAR — o reconciliador documental-financeiro canônico ──────
  t = Date.now()
  const et4 = vazia("reconciliar")
  try {
    // `executar` só quando a publicação passou: reconciliar com regra em
    // rascunho criaria expectativa de reparo que o motor não cumpriria.
    const podeReparar = et2.status === "OK" || (impedimentos.length === 0 && et2.status === "PULADA")
    const r = await reconciliarDocumentalFinanceiro({ executar: podeReparar })
    et4.processados = r.documentosLocalizados
    et4.criados = r.reparados
    et4.erros = 0
    resumo.reconciliacao.encontradas = r.achados.length
    resumo.reconciliacao.corrigidas = r.reparados
    resumo.reconciliacao.restantes = r.ambiguos
    resumo.financeiro.custosGerados += r.reparados
    et4.mensagens = r.achados.slice(0, 20).map((a) => `[${a.tipo}] ${a.detalhe}`)
    et4.status = "OK"
    et4.detalhe = `${r.documentosLocalizados} documento(s) localizado(s) · ${r.reparados} lançamento(s) criado(s) · ${r.ambiguos} pendência(s) de decisão`
  } catch (e) {
    et4.status = "ERRO"; et4.erros = 1
    et4.mensagens.push(e instanceof Error ? e.message : "erro na reconciliação")
    et4.detalhe = "falhou — os passos anteriores permanecem válidos"
  }
  et4.duracaoMs = Date.now() - t
  yield await emitir(et4)

  // ── 5. PROJEÇÕES ─────────────────────────────────────────────────────────
  t = Date.now()
  const et5 = vazia("projecoes")
  try {
    // A projeção operacional é DERIVADA na leitura — não há cache a invalidar.
    // Recalcular aqui é conferir que ela responde para cada processo do escopo.
    const { resolveOperationalProjection } = await import("@/src/lib/process-stage/operational-projection")
    for (const proc of processos) {
      try { await resolveOperationalProjection(proc.id); et5.processados++ }
      catch { et5.erros++ }
    }
    et5.status = et5.erros ? "ERRO" : "OK"
    et5.detalhe = `${et5.processados} projeção(ões) resolvida(s)${et5.erros ? `, ${et5.erros} com erro` : ""}`
  } catch (e) {
    et5.status = "ERRO"; et5.erros = 1
    et5.mensagens.push(e instanceof Error ? e.message : "erro")
    et5.detalhe = "não foi possível resolver as projeções"
  }
  et5.duracaoMs = Date.now() - t
  yield await emitir(et5)

  // ── 6. FINANCEIRO ────────────────────────────────────────────────────────
  t = Date.now()
  const et6 = vazia("financeiro")
  try {
    let custos = 0, receitas = 0
    for (const proc of processos) {
      const obrs = await listarObrigacoes({ processoId: proc.id })
      custos += obrs.filter((o) => o.natureza === "CUSTO").length
      receitas += obrs.filter((o) => o.natureza === "RECEITA").length
    }
    resumo.financeiro.custosGerados = custos
    resumo.financeiro.receitasGeradas = receitas
    et6.processados = processos.length
    et6.status = "OK"
    et6.detalhe = `${custos} custo(s) e ${receitas} receita(s) legíveis pela camada oficial`
  } catch (e) {
    et6.status = "ERRO"; et6.erros = 1
    et6.mensagens.push(e instanceof Error ? e.message : "erro")
    et6.detalhe = "o Financeiro não respondeu"
  }
  et6.duracaoMs = Date.now() - t
  yield await emitir(et6)

  // ── 7. PLANILHA ──────────────────────────────────────────────────────────
  t = Date.now()
  const et7 = vazia("planilha")
  try {
    let linhas = 0, colunas = 0, total = 0
    for (const proc of processos) {
      const pl = await montarPlanilhaDocumental(proc.id)
      linhas += pl.pessoas.reduce((s, b) => s + b.linhas.length, 0)
      colunas = Math.max(colunas, pl.colunas.length)
      total += pl.totalGeralBrl
    }
    resumo.planilha = { linhas, colunas, totalBrl: total }
    et7.processados = processos.length
    et7.criados = linhas
    et7.status = "OK"
    et7.detalhe = `${linhas} linha(s) em ${colunas} coluna(s) de serviço · total ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
  } catch (e) {
    et7.status = "ERRO"; et7.erros = 1
    et7.mensagens.push(e instanceof Error ? e.message : "erro")
    et7.detalhe = "a Planilha não pôde ser montada"
  }
  et7.duracaoMs = Date.now() - t
  yield await emitir(et7)

  // ── 8. GUARDS ────────────────────────────────────────────────────────────
  t = Date.now()
  const et8 = vazia("guards")
  const guards: string[] = []
  try {
    const estado = await estadoParametrizacao({ tipoProcessoId: args.tipoProcessoId, phaseKey: args.phaseKey ?? null })
    const ativos = await prisma.phaseEconomicRule.count({ where: { phaseKey: { in: fases }, ativo: true } })
    resumo.parametrizacao.componentesAtivos = ativos

    const zeros = await prisma.tabelaValor.count({ where: { arquivado: false, valor: { lte: 0 } } })
    if (zeros > 0) { et8.erros++; guards.push(`${zeros} linha(s) de preço com valor <= 0`) }
    else guards.push("nenhum preço zero publicado")

    const placeholders = await prisma.tabelaValor.count({ where: { arquivado: false, name: { contains: "[AJUSTAR]" } } })
    if (placeholders > 0) { et8.erros++; guards.push(`${placeholders} preço(s) ainda marcado(s) [AJUSTAR]`) }
    else guards.push("nenhum placeholder publicado")

    const rascunhosAtivos = await prisma.matrizDocumental.count({
      where: { tipoProcessoId: args.tipoProcessoId, phaseKey: { in: fases }, arquivado: false, status: { not: "PUBLICADA" } },
    })
    guards.push(rascunhosAtivos ? `${rascunhosAtivos} regra(s) permanecem em rascunho (não executam)` : "nenhuma regra pendente de publicação")

    const bloqueadas = estado.etapas.filter((e) => e.status === "BLOQUEADA").length
    guards.push(bloqueadas ? `${bloqueadas} etapa(s) ainda bloqueada(s)` : "nenhuma etapa bloqueada")

    et8.processados = guards.length
    et8.mensagens = guards
    et8.status = et8.erros ? "ERRO" : "OK"
    et8.detalhe = `${guards.length} guard(s) verificado(s)${et8.erros ? `, ${et8.erros} com achado` : ", todos limpos"}`
  } catch (e) {
    et8.status = "ERRO"; et8.erros = 1
    et8.mensagens.push(e instanceof Error ? e.message : "erro")
    et8.detalhe = "não foi possível executar os guards"
  }
  et8.duracaoMs = Date.now() - t
  yield await emitir(et8)

  // ── RELATÓRIO ────────────────────────────────────────────────────────────
  const finais = await pendenciasDaParametrizacao({ phaseKeys: fases })
  const relatorio: RelatorioConclusao = {
    tipoProcessoId: args.tipoProcessoId, phaseKey: args.phaseKey ?? null,
    iniciadoEm, duracaoMs: Date.now() - t0, etapas, resumo,
    pendencias: finais.pendencias,
    concluiu: etapas.every((e) => e.status !== "ERRO"),
  }
  yield { relatorio }
}
