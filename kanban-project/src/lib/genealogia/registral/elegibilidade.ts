// src/lib/genealogia/registral/elegibilidade.ts
//
// MRG — MOTOR DE LINHAGEM E ELEGIBILIDADE (requisito 9 do escopo). Puro.
//
// A distinção que este módulo existe para não deixar ninguém confundir:
//
//   LINHA ESTRUTURALMENTE POSSÍVEL  ≠  LINHA DOCUMENTALMENTE COMPROVADA
//
// A primeira é uma cadeia de vínculos cadastrados. A segunda exige que CADA
// geração da cadeia tenha evidência registral. O motor nunca declara direito:
// ele diz o que está comprovado, o que falta e onde a linha quebra.
//
// Reusa `motor/regras/linhagem.ts` (que já resolve país-alvo, dante causa,
// migração, sobrenome e naturalização) e acrescenta o que faltava para
// responsabilidade jurídica: TODOS os caminhos possíveis, gerações sem
// comprovação, conflito de linha e o veredicto de elegibilidade.

import { construirGrafo, type GrafoGenealogico } from "@/src/lib/genealogia/motor/grafo"
import { acharRequerente, analisarLinhagem, ehDoPais } from "@/src/lib/genealogia/motor/regras/linhagem"
import type { PaisAlvo, PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import { nomeCompleto } from "@/src/lib/genealogia/motor/texto"
import type {
  CampoRegistral,
  CaminhoLinhagem,
  Inconsistencia,
  ResultadoElegibilidade,
  ResultadoLinhagemRegistral,
} from "./tipos"

export interface EntradaElegibilidade {
  pessoas: PessoaEntrada[]
  unioes: UniaoEntrada[]
  /** País-alvo do processo (vem da modalidade/nacionalidade). */
  paisAlvo: PaisAlvo | null
  /** Requerente do processo. Quando null, é derivado da árvore. */
  requerenteId: number | null
  raizId: number | null
  /**
   * Comprovação documental por pessoa: quais campos registrais ESTÃO
   * confirmados. Vem do Sistema Documental + fatos registrais — nunca inventado
   * aqui.
   */
  comprovacaoPorPessoa: Map<number, Set<CampoRegistral>>
  /** Inconsistências abertas — linha com conflito não é linha comprovada. */
  inconsistencias?: Inconsistencia[]
}

/**
 * Campos mínimos que comprovam uma geração da linha: o nascimento (que traz a
 * filiação) é o documento que liga a pessoa ao ascendente. Sem ele, a geração é
 * estrutural, não comprovada.
 */
const CAMPOS_QUE_COMPROVAM_GERACAO: CampoRegistral[] = [
  "DATA_NASCIMENTO",
  "FILIACAO_PAI",
  "FILIACAO_MAE",
]

/** Máximo de caminhos alternativos apurados (evita explosão combinatória). */
const MAX_CAMINHOS = 12

/**
 * Códigos de INTEGRIDADE que descrevem LACUNA (falta de informação), não
 * contradição. Não entram no cálculo de "linha conflitante": a ausência de
 * ascendente no topo da linha é onde a pesquisa genealógica ainda não chegou.
 */
const CODIGOS_DE_LACUNA = new Set<string>(["LINHA_INTERROMPIDA", "FILIACAO_INCOMPLETA"])

export function apurarElegibilidade(entrada: EntradaElegibilidade): ResultadoElegibilidade {
  const g = construirGrafo(entrada.pessoas, entrada.unioes)
  const requerenteId = entrada.requerenteId ?? acharRequerente(g, entrada.raizId)

  if (requerenteId == null || !g.existe(requerenteId)) {
    return {
      requerenteId: null,
      ascendenteTransmissorId: null,
      caminhoPrincipal: null,
      caminhosAlternativos: [],
      resultado: "REVISAO_OBRIGATORIA",
      explicacao:
        "Não há requerente identificado na árvore. Sem requerente não existe linha de transmissão a apurar.",
      pendencias: ["Marcar quem é o requerente do processo."],
      conflitos: [],
      comprovadoDocumentalmente: false,
    }
  }

  // O motor genealógico já resolve dante causa, migração e naturalização.
  const base = analisarLinhagem(g, entrada.paisAlvo, requerenteId)

  // Todos os caminhos ascendentes até candidatos a ascendente transmissor.
  const candidatos = candidatosTransmissores(g, requerenteId, entrada.paisAlvo)
  const caminhos = todosOsCaminhos(g, requerenteId, candidatos)

  const avaliados = caminhos
    .map((ids) => avaliarCaminho(g, ids, entrada.comprovacaoPorPessoa))
    .sort(ordenarCaminhos)

  const principal = avaliados[0] ?? null
  const alternativos = avaliados.slice(1, MAX_CAMINHOS)

  // CONFLITO ≠ LACUNA. Falta de ascendente no TOPO da linha e filiação incompleta
  // são a fronteira da pesquisa: já aparecem em `pendencias` e não contradizem
  // nada. Tratá-las como conflito fazia toda linha corretamente comprovada ser
  // classificada como LINHA_CONFLITANTE — falso positivo que apagava a distinção
  // entre "falta documento" e "os documentos se contradizem".
  const conflitosDaLinha = (entrada.inconsistencias ?? []).filter(
    (i) =>
      !CODIGOS_DE_LACUNA.has(i.codigo) &&
      (i.severidade === "CRITICO" || i.severidade === "ALTO") &&
      i.pessoaIds.some((pid) => principal?.ids.includes(pid) ?? false),
  )

  const pendencias = montarPendencias(g, principal, entrada.comprovacaoPorPessoa, entrada.paisAlvo, base.danteCausaId)
  const resultado = decidir({
    temCandidato: candidatos.length > 0,
    principal,
    conflitos: conflitosDaLinha.length,
    pendencias: pendencias.length,
    paisAlvo: entrada.paisAlvo,
  })

  const transmissorId = principal ? principal.ids[principal.ids.length - 1] : base.danteCausaId

  return {
    requerenteId,
    ascendenteTransmissorId: transmissorId ?? null,
    caminhoPrincipal: principal,
    caminhosAlternativos: alternativos,
    resultado,
    explicacao: explicar(g, resultado, principal, transmissorId, conflitosDaLinha.length, pendencias.length),
    pendencias,
    conflitos: conflitosDaLinha.map((c) => c.descricao),
    // O motor SÓ declara comprovado quando não falta evidência e não há conflito.
    comprovadoDocumentalmente:
      resultado === "LINHA_COMPLETA_COMPROVADA" && pendencias.length === 0 && conflitosDaLinha.length === 0,
  }
}

// ---------------------------------------------------------------- caminhos

function candidatosTransmissores(
  g: GrafoGenealogico,
  requerenteId: number,
  paisAlvo: PaisAlvo | null,
): number[] {
  if (!paisAlvo) {
    // Sem país-alvo, o candidato é o topo de cada cadeia ascendente.
    return [...g.ancestrais(requerenteId)].filter((id) => {
      const p = g.pessoa(id)
      return p != null && p.paiId == null && p.maeId == null
    })
  }
  const out: number[] = []
  for (const id of g.ancestrais(requerenteId)) {
    const p = g.pessoa(id)
    if (p && ehDoPais(p, paisAlvo)) out.push(id)
  }
  return out.sort((a, b) => a - b)
}

/**
 * Todos os caminhos ascendentes distintos do requerente até cada candidato.
 * Enumeração completa (não só o mais curto) porque a linha mais curta não é
 * necessariamente a comprovável — e é a comprovável que interessa.
 */
function todosOsCaminhos(g: GrafoGenealogico, de: number, alvos: number[]): number[][] {
  const alvoSet = new Set(alvos)
  const resultados: number[][] = []

  const andar = (atual: number, caminho: number[], visitados: Set<number>) => {
    if (resultados.length >= MAX_CAMINHOS * 3) return
    if (alvoSet.has(atual) && caminho.length > 1) {
      resultados.push([...caminho])
      return // não segue além do transmissor
    }
    const p = g.pessoa(atual)
    if (!p) return
    let avancou = false
    for (const pid of [p.paiId, p.maeId]) {
      if (pid == null || !g.existe(pid) || visitados.has(pid)) continue
      avancou = true
      visitados.add(pid)
      andar(pid, [...caminho, pid], visitados)
      visitados.delete(pid)
    }
    // Cadeia que termina sem alcançar alvo também é um caminho (linha incompleta).
    if (!avancou && !alvoSet.size && caminho.length > 1) resultados.push([...caminho])
  }

  andar(de, [de], new Set([de]))

  if (!resultados.length) {
    // Nenhum alvo alcançado: devolve a cadeia ascendente mais profunda, que é a
    // linha estruturalmente existente (incompleta).
    const maisProfunda = cadeiaMaisProfunda(g, de)
    if (maisProfunda.length > 1) resultados.push(maisProfunda)
  }

  // Deduplica caminhos idênticos.
  const vistos = new Set<string>()
  return resultados.filter((c) => {
    const k = c.join(">")
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

function cadeiaMaisProfunda(g: GrafoGenealogico, id: number): number[] {
  const memo = new Map<number, number[]>()
  const visitando = new Set<number>()
  const dfs = (atual: number): number[] => {
    const m = memo.get(atual)
    if (m) return m
    if (visitando.has(atual)) return [atual]
    visitando.add(atual)
    const p = g.pessoa(atual)
    let melhor: number[] = []
    if (p) {
      for (const pid of [p.paiId, p.maeId]) {
        if (pid == null || !g.existe(pid)) continue
        const sub = dfs(pid)
        if (sub.length > melhor.length) melhor = sub
      }
    }
    visitando.delete(atual)
    const r = [atual, ...melhor]
    memo.set(atual, r)
    return r
  }
  return dfs(id)
}

function avaliarCaminho(
  g: GrafoGenealogico,
  ids: number[],
  comprovacao: Map<number, Set<CampoRegistral>>,
): CaminhoLinhagem {
  const semComprovacao: number[] = []
  let quebra: number | null = null

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const ehTopo = i === ids.length - 1
    const comprovados = comprovacao.get(id) ?? new Set<CampoRegistral>()

    // Cada geração precisa do documento que liga a pessoa ao ascendente. No topo
    // da linha basta o registro da própria pessoa (não há ascendente a ligar).
    const necessarios = ehTopo ? (["DATA_NASCIMENTO"] as CampoRegistral[]) : CAMPOS_QUE_COMPROVAM_GERACAO
    const faltando = necessarios.filter((c) => !comprovados.has(c))
    if (faltando.length) semComprovacao.push(id)

    if (!ehTopo) {
      const p = g.pessoa(id)
      const proximo = ids[i + 1]
      const ligado = p != null && (p.paiId === proximo || p.maeId === proximo)
      if (!ligado && quebra == null) quebra = id
    }
  }

  return {
    ids,
    geracoesSemComprovacao: semComprovacao,
    quebraEm: quebra,
    comprovado: semComprovacao.length === 0 && quebra == null,
  }
}

function ordenarCaminhos(a: CaminhoLinhagem, b: CaminhoLinhagem): number {
  // 1. comprovado vence; 2. menos gerações sem comprovação; 3. mais curto.
  if (a.comprovado !== b.comprovado) return a.comprovado ? -1 : 1
  if (a.geracoesSemComprovacao.length !== b.geracoesSemComprovacao.length) {
    return a.geracoesSemComprovacao.length - b.geracoesSemComprovacao.length
  }
  if (a.ids.length !== b.ids.length) return a.ids.length - b.ids.length
  return (a.ids[a.ids.length - 1] ?? 0) - (b.ids[b.ids.length - 1] ?? 0)
}

// ---------------------------------------------------------------- veredicto

function montarPendencias(
  g: GrafoGenealogico,
  principal: CaminhoLinhagem | null,
  comprovacao: Map<number, Set<CampoRegistral>>,
  paisAlvo: PaisAlvo | null,
  danteCausaId: number | null,
): string[] {
  const out: string[] = []
  if (!principal) {
    out.push("Nenhum caminho genealógico apurado a partir do requerente.")
    return out
  }

  for (const id of principal.geracoesSemComprovacao) {
    const p = g.pessoa(id)
    const comprovados = comprovacao.get(id) ?? new Set<CampoRegistral>()
    const faltando = CAMPOS_QUE_COMPROVAM_GERACAO.filter((c) => !comprovados.has(c))
    out.push(
      `${p ? nomeCompleto(p) : `#${id}`}: sem comprovação de ${faltando.join(", ").toLowerCase().replace(/_/g, " ")}.`,
    )
  }

  if (principal.quebraEm != null) {
    const p = g.pessoa(principal.quebraEm)
    out.push(`Vínculo não cadastrado a partir de ${p ? nomeCompleto(p) : `#${principal.quebraEm}`}.`)
  }

  if (paisAlvo && danteCausaId == null) {
    out.push("Ascendente estrangeiro (dante causa) não identificado na linha.")
  }

  return out
}

function decidir(p: {
  temCandidato: boolean
  principal: CaminhoLinhagem | null
  conflitos: number
  pendencias: number
  paisAlvo: PaisAlvo | null
}): ResultadoLinhagemRegistral {
  if (!p.principal) return "REVISAO_OBRIGATORIA"
  if (p.conflitos > 0) return "LINHA_CONFLITANTE"
  if (p.paisAlvo && !p.temCandidato) return "ASCENDENTE_ELEGIVEL_NAO_IDENTIFICADO"
  if (p.principal.quebraEm != null) return "LINHA_ESTRUTURAL_INCOMPLETA"
  if (p.principal.comprovado && p.pendencias === 0) return "LINHA_COMPLETA_COMPROVADA"
  return "LINHA_COMPLETA_COM_PENDENCIAS"
}

function explicar(
  g: GrafoGenealogico,
  resultado: ResultadoLinhagemRegistral,
  principal: CaminhoLinhagem | null,
  transmissorId: number | null,
  conflitos: number,
  pendencias: number,
): string {
  const transmissor = transmissorId != null ? g.pessoa(transmissorId) : null
  const nomeT = transmissor ? nomeCompleto(transmissor) : "ascendente não identificado"
  const geracoes = principal ? principal.ids.length : 0

  switch (resultado) {
    case "LINHA_COMPLETA_COMPROVADA":
      return `Linha de ${geracoes} geração(ões) até ${nomeT}, com evidência documental em todas as gerações e nenhuma inconsistência aberta.`
    case "LINHA_COMPLETA_COM_PENDENCIAS":
      return `A linha até ${nomeT} está estruturalmente completa (${geracoes} gerações), mas ${pendencias} geração(ões) ainda não têm comprovação documental. Estruturalmente possível, documentalmente não comprovada.`
    case "LINHA_ESTRUTURAL_INCOMPLETA":
      return `A linha até ${nomeT} tem vínculo não cadastrado: a cadeia de filiação se interrompe antes de chegar ao ascendente. Não é possível afirmar transmissão.`
    case "LINHA_CONFLITANTE":
      return `A linha até ${nomeT} tem ${conflitos} inconsistência(s) grave(s) sobre pessoas do próprio caminho. Enquanto o conflito existir, a linha não sustenta processo.`
    case "ASCENDENTE_ELEGIVEL_NAO_IDENTIFICADO":
      return "Não há, na ascendência do requerente, ninguém com país de nascimento ou nacionalidade correspondente ao país do processo. O ascendente que originaria o direito ainda não foi identificado."
    default:
      return "A apuração da linha exige revisão humana: falta informação estrutural mínima."
  }
}

/**
 * Comparação ANTES × DEPOIS de uma alteração — é o que a análise de impacto
 * (requisito 13) usa para decidir se a mudança altera elegibilidade.
 */
export interface DeltaElegibilidade {
  mudouResultado: boolean
  mudouTransmissor: boolean
  mudouCaminho: boolean
  perdeuComprovacao: boolean
  ganhouComprovacao: boolean
  descricao: string
}

export function compararElegibilidade(
  antes: ResultadoElegibilidade,
  depois: ResultadoElegibilidade,
): DeltaElegibilidade {
  const caminhoAntes = (antes.caminhoPrincipal?.ids ?? []).join(">")
  const caminhoDepois = (depois.caminhoPrincipal?.ids ?? []).join(">")

  const mudouResultado = antes.resultado !== depois.resultado
  const mudouTransmissor = antes.ascendenteTransmissorId !== depois.ascendenteTransmissorId
  const mudouCaminho = caminhoAntes !== caminhoDepois
  const perdeuComprovacao = antes.comprovadoDocumentalmente && !depois.comprovadoDocumentalmente
  const ganhouComprovacao = !antes.comprovadoDocumentalmente && depois.comprovadoDocumentalmente

  const partes: string[] = []
  if (mudouResultado) partes.push(`resultado ${antes.resultado} → ${depois.resultado}`)
  if (mudouTransmissor) {
    partes.push(
      `ascendente transmissor ${antes.ascendenteTransmissorId ?? "nenhum"} → ${depois.ascendenteTransmissorId ?? "nenhum"}`,
    )
  }
  if (mudouCaminho) partes.push(`caminho ${caminhoAntes || "vazio"} → ${caminhoDepois || "vazio"}`)
  if (perdeuComprovacao) partes.push("a linha DEIXOU de estar comprovada")
  if (ganhouComprovacao) partes.push("a linha PASSOU a estar comprovada")

  return {
    mudouResultado,
    mudouTransmissor,
    mudouCaminho,
    perdeuComprovacao,
    ganhouComprovacao,
    descricao: partes.length ? partes.join("; ") : "nenhuma mudança na linha de cidadania",
  }
}
