// src/lib/genealogia/motor/analisar.ts
//
// Orquestrador do motor. Uma única passada produz TUDO que a árvore precisa
// saber sobre si mesma: conflitos, duplicidades, lacunas, sugestões, pesquisas,
// linha de cidadania, gargalos, qualidade e próximos passos.
//
// Determinístico: mesma entrada → mesma saída, sempre. Sem rede, sem relógio
// além do ano corrente, sem aleatoriedade. Isso é o que permite testar.

import { construirGrafo, GrafoGenealogico } from "./grafo"
import { analisarCronologia } from "./regras/cronologia"
import { analisarDuplicidade } from "./regras/duplicidade"
import { analisarLinhagem } from "./regras/linhagem"
import { analisarSugestoes } from "./regras/sugestoes"
import { analisarPesquisa } from "./regras/pesquisa"
import { analisarLacunas, calcularCompletude, resumirPessoa, type ResultadoCompletude } from "./regras/completude"
import {
  ORDEM_SEVERIDADE,
  piorSeveridade,
  type AnaliseArvore,
  type AnalisePessoa,
  type Insight,
  type PaisAlvo,
  type PapelLinha,
  type CategoriaInsight,
  type PassoSugerido,
  type PessoaEntrada,
  type Severidade,
  type UniaoEntrada,
} from "./tipos"
import { nomeCompleto } from "./texto"

export interface OpcoesAnalise {
  paisAlvo?: PaisAlvo | null
  /** Pessoa raiz da árvore (pessoaPrincipal). */
  raizId?: number | null
}

export function analisarArvore(
  pessoas: PessoaEntrada[],
  unioes: UniaoEntrada[],
  opcoes: OpcoesAnalise = {},
): AnaliseArvore & { grafo: GrafoGenealogico } {
  const grafo = construirGrafo(pessoas, unioes)
  const paisAlvo = opcoes.paisAlvo ?? null
  const raizId = opcoes.raizId ?? (pessoas.length ? pessoas[0].id : null)

  // 1. Linha de cidadania primeiro: ela define a PRIORIDADE de tudo o resto.
  const linhagem = analisarLinhagem(grafo, paisAlvo, raizId)
  const naLinha = linhagem.naLinha

  // 2. Papéis
  const papeis = new Map<number, PapelLinha>()
  for (const p of grafo.pessoas) {
    let papel: PapelLinha = "colateral"
    if (naLinha.has(p.id)) papel = "linha"
    if (p.id === linhagem.danteCausaId) papel = "dante_causa"
    if (p.id === linhagem.requerenteId) papel = "requerente"
    if (papel === "colateral") {
      const ehConjugeDeLinha = grafo.conjugesIds(p.id).some((c) => naLinha.has(c))
      if (ehConjugeDeLinha) papel = "conjuge"
    }
    papeis.set(p.id, papel)
  }

  // 3. Completude
  const completudes = new Map<number, ResultadoCompletude>()
  for (const p of grafo.pessoas) {
    completudes.set(p.id, calcularCompletude(grafo, p, papeis.get(p.id)!))
  }

  // 4. Regras
  const insights: Insight[] = [
    ...linhagem.insights,
    ...analisarCronologia(grafo),
    ...analisarDuplicidade(grafo),
    ...analisarLacunas(grafo, papeis, completudes),
    ...analisarSugestoes(grafo, naLinha),
    ...analisarPesquisa(grafo, naLinha, linhagem.danteCausaId, paisAlvo),
  ]

  // 5. Impacto na linha: um conflito na linha de transmissão vale mais que o
  //    mesmo conflito num colateral. Isso é o coração da priorização.
  for (const i of insights) {
    const tocaLinha = i.pessoaIds.some((id) => naLinha.has(id))
    const tocaDanteCausa = linhagem.danteCausaId != null && i.pessoaIds.includes(linhagem.danteCausaId)
    if (tocaDanteCausa) i.peso = Math.round(i.peso * 1.6)
    else if (tocaLinha) i.peso = Math.round(i.peso * 1.3)
  }

  // 5b. Sugestão de vínculo NÃO pode competir com suspeita de duplicidade.
  //
  // Caso real visto na validação: "Antonietta e Giovani podem ser irmãos" —
  // porque Giovani era, na verdade, a ficha repetida do marido dela. Enquanto a
  // duplicidade não for resolvida, qualquer vínculo proposto para a ficha
  // repetida é hipótese sobre um fantasma. A decisão pendente é uma só.
  const duplicataDe = new Map<number, Set<number>>()
  for (const i of insights) {
    if (i.categoria !== "duplicidade" || i.pessoaIds.length < 2) continue
    const [a, b] = i.pessoaIds
    if (!duplicataDe.has(a)) duplicataDe.set(a, new Set())
    if (!duplicataDe.has(b)) duplicataDe.set(b, new Set())
    duplicataDe.get(a)!.add(b)
    duplicataDe.get(b)!.add(a)
  }

  const conflitaComDuplicidade = (i: Insight): boolean => {
    if (i.categoria !== "relacao" || i.pessoaIds.length < 2) return false
    const [a, b] = i.pessoaIds
    if (duplicataDe.get(a)?.has(b)) return true
    // ...ou quando um dos dois é a ficha repetida de alguém já ligado ao outro.
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      for (const gemeo of duplicataDe.get(y) || []) {
        if (gemeo === x) return true
        if (grafo.conjugesIds(x).includes(gemeo)) return true
        if (grafo.irmaosIds(x).includes(gemeo)) return true
        const px = grafo.pessoa(x)
        if (px && (px.paiId === gemeo || px.maeId === gemeo)) return true
      }
    }
    return false
  }

  const semRuido = insights.filter((i) => !conflitaComDuplicidade(i))

  // Dedup defensivo por id (regras independentes podem convergir)
  const porId = new Map<string, Insight>()
  for (const i of semRuido) {
    const existente = porId.get(i.id)
    if (!existente || i.peso > existente.peso) porId.set(i.id, i)
  }
  const ordenados = [...porId.values()].sort(
    (a, b) => b.peso - a.peso || ORDEM_SEVERIDADE[b.severidade] - ORDEM_SEVERIDADE[a.severidade] || a.id.localeCompare(b.id),
  )

  // 6. Índice por pessoa — calculado sobre a lista COMPLETA.
  //
  // A ordem importa: o selo de severidade do cartão e a lista de achados de
  // cada pessoa precisam enxergar tudo. Só depois disso a lista global é
  // cortada. Cortar antes faria uma pessoa com problema crítico aparecer limpa
  // no cartão só porque o achado dela ficou fora do teto de exibição.
  const geracoes = raizId != null ? grafo.geracoes(raizId) : new Map<number, number>()
  const porPessoa = new Map<number, AnalisePessoa>()
  for (const p of grafo.pessoas) {
    const papel = papeis.get(p.id)!
    const comp = completudes.get(p.id)!
    porPessoa.set(p.id, {
      pessoaId: p.id,
      geracao: geracoes.get(p.id) ?? 0,
      papel,
      naLinhaCidadania: naLinha.has(p.id),
      completude: comp.completude,
      faltando: comp.faltando,
      insightIds: [],
      severidadeMax: null,
      descendentesNaLinha: 0,
      resumo: resumirPessoa(grafo, p, papel),
    })
  }
  for (const i of ordenados) {
    for (const pid of i.pessoaIds) {
      const a = porPessoa.get(pid)
      if (!a) continue
      a.insightIds.push(i.id)
      // Sugestão e pesquisa não "sujam" o selo do card — só problema real suja.
      if (i.categoria === "conflito" || i.categoria === "duplicidade" || i.categoria === "risco" || i.categoria === "lacuna") {
        a.severidadeMax = piorSeveridade(a.severidadeMax, i.severidade)
      }
    }
  }

  // 7. Gargalos: quem trava mais linha. Um ascendente sem filiação que sustenta
  //    muitos descendentes é onde o escritório deve gastar a próxima hora.
  for (const p of grafo.pessoas) {
    const a = porPessoa.get(p.id)!
    const desc = grafo.descendentes(p.id)
    let naLinhaCount = 0
    desc.forEach((d) => {
      if (naLinha.has(d)) naLinhaCount++
    })
    a.descendentesNaLinha = naLinhaCount
  }

  const gargalos = grafo.pessoas
    .filter((p) => p.paiId == null && p.maeId == null && p.id !== linhagem.danteCausaId)
    .map((p) => ({
      id: p.id,
      score:
        (porPessoa.get(p.id)!.descendentesNaLinha + 1) *
        (naLinha.has(p.id) ? 4 : 1) *
        (100 - porPessoa.get(p.id)!.completude + 10),
    }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, 8)
    .map((x) => x.id)

  // 8. Qualidade — também sobre a lista completa
  const qualidade = calcularQualidade(grafo, porPessoa, ordenados, linhagem.linha, geracoes)

  // 9. Próximos passos — o que fazer AGORA, em ordem, com ganho estimado
  const proximosPassos = montarPassos(grafo, ordenados, porPessoa)

  // 10. Corte de exibição, por categoria e global
  const totais = contarPorCategoria(ordenados)
  const finais = limitarInsights(ordenados)

  return {
    insights: finais,
    totais,
    truncado: finais.length < ordenados.length,
    porPessoa,
    qualidade,
    gargalos,
    proximosPassos,
    linhaCidadania: linhagem.linha,
    danteCausaId: linhagem.danteCausaId,
    paisAlvo,
    grafo,
  }
}

/** Teto por categoria — o painel mostra o topo de cada frente de trabalho. */
const TETO_CATEGORIA = 250
/** Teto global — acima disso a lista deixa de ser lida por qualquer humano. */
const TETO_TOTAL = 1200

function contarPorCategoria(insights: Insight[]): Record<CategoriaInsight, number> {
  const base: Record<CategoriaInsight, number> = {
    conflito: 0,
    duplicidade: 0,
    lacuna: 0,
    relacao: 0,
    pesquisa: 0,
    migracao: 0,
    sobrenome: 0,
    risco: 0,
  }
  for (const i of insights) base[i.categoria]++
  return base
}

/**
 * Mantém os mais relevantes de CADA categoria (a lista já chega ordenada por
 * peso). Cortar só pelo topo global apagaria categorias inteiras: 8.000 lacunas
 * de peso médio enterrariam os 3 riscos críticos do processo.
 */
function limitarInsights(insights: Insight[]): Insight[] {
  const porCategoria = new Map<CategoriaInsight, number>()
  const saida: Insight[] = []
  for (const i of insights) {
    if (saida.length >= TETO_TOTAL) break
    const n = porCategoria.get(i.categoria) ?? 0
    if (n >= TETO_CATEGORIA) continue
    porCategoria.set(i.categoria, n + 1)
    saida.push(i)
  }
  return saida
}

function calcularQualidade(
  grafo: GrafoGenealogico,
  porPessoa: Map<number, AnalisePessoa>,
  insights: Insight[],
  linha: number[],
  geracoes: Map<number, number>,
): AnaliseArvore["qualidade"] {
  const total = grafo.pessoas.length
  const conflitos = insights.filter((i) => i.categoria === "conflito").length
  const duplicidades = insights.filter((i) => i.categoria === "duplicidade").length
  const lacunas = insights.filter((i) => i.categoria === "lacuna").length

  // Completude média ponderada: quem está na linha pesa 4×.
  let soma = 0
  let peso = 0
  porPessoa.forEach((a) => {
    const w = a.naLinhaCidadania ? 4 : 1
    soma += a.completude * w
    peso += w
  })
  const completude = peso ? Math.round(soma / peso) : 0

  // Consistência: penaliza por gravidade, não por contagem crua.
  const penalidade = insights
    .filter((i) => i.categoria === "conflito" || i.categoria === "duplicidade")
    .reduce((acc, i) => acc + ORDEM_SEVERIDADE[i.severidade] * 2, 0)
  const consistencia = Math.max(0, Math.round(100 - (total ? (penalidade / total) * 8 : penalidade)))

  // Cobertura da linha: a linha está resolvida do requerente ao dante causa?
  let resolvidos = 0
  for (const id of linha) {
    const a = porPessoa.get(id)
    if (a && a.completude >= 80) resolvidos++
  }
  const coberturaLinha = linha.length ? Math.round((resolvidos / linha.length) * 100) : 0

  const geracoesMapeadas = geracoes.size
    ? Math.max(...[...geracoes.values()]) - Math.min(...[...geracoes.values()]) + 1
    : 0

  const score = Math.round(completude * 0.4 + consistencia * 0.3 + coberturaLinha * 0.3)

  return {
    score,
    completude,
    consistencia,
    coberturaLinha,
    totalPessoas: total,
    totalUnioes: grafo.unioes.length,
    geracoesMapeadas,
    conflitos,
    duplicidades,
    lacunas,
  }
}

function montarPassos(
  grafo: GrafoGenealogico,
  insights: Insight[],
  porPessoa: Map<number, AnalisePessoa>,
): PassoSugerido[] {
  // UMA frente de trabalho por PESSOA.
  //
  // A primeira versão deduplicava por (categoria, pessoa) e o resultado foi
  // "Solicitar certidão de naturalização do dante causa" duas vezes seguidas —
  // uma vinda da regra de pesquisa, outra da regra de risco. São insights
  // distintos, mas para quem executa é a mesma tarefa. Deduplicar por pessoa
  // resolve isso e ainda distribui a lista entre 8 pessoas diferentes, que é
  // como o trabalho é repartido no escritório. O detalhe completo de cada
  // pessoa continua no painel dela.
  const vistos = new Set<string>()
  const passos: PassoSugerido[] = []

  for (const i of insights) {
    if (passos.length >= 8) break
    if (!i.acao) continue
    const chave = String(i.pessoaIds[0] ?? `-${i.id}`)
    if (vistos.has(chave)) continue
    vistos.add(chave)

    const alvo = i.pessoaIds[0] != null ? grafo.pessoa(i.pessoaIds[0]) : null
    const analise = i.pessoaIds[0] != null ? porPessoa.get(i.pessoaIds[0]) : null
    const ganho = Math.min(
      25,
      Math.round(
        (i.peso / 10) * (analise?.naLinhaCidadania ? 1.5 : 1) * (i.severidade === "critico" ? 1.4 : 1),
      ),
    )

    passos.push({
      id: `passo-${i.id}`,
      ordem: passos.length + 1,
      titulo: i.acao,
      motivo: alvo ? `${nomeCompleto(alvo)} — ${i.titulo}` : i.titulo,
      pessoaIds: i.pessoaIds,
      severidade: i.severidade,
      ganho,
    })
  }
  return passos
}

/** Filtro de insights por pessoa — usado pelo painel lateral. */
export function insightsDaPessoa(analise: AnaliseArvore, pessoaId: number): Insight[] {
  const ids = new Set(analise.porPessoa.get(pessoaId)?.insightIds || [])
  return analise.insights.filter((i) => ids.has(i.id))
}

export const SEVERIDADE_ORDEM = ORDEM_SEVERIDADE
export type { Severidade }
