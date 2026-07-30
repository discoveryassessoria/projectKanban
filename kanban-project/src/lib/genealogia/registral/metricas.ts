// src/lib/genealogia/registral/metricas.ts
//
// MRG — OBSERVABILIDADE (requisito 22). Puro.
//
// Duas responsabilidades, e nada mais:
//   1. o VOCABULÁRIO fechado de métricas (chave fixa, sem string solta no meio
//      do código — métrica com nome inventado em cada lugar é métrica que
//      ninguém consegue somar);
//   2. a REDAÇÃO obrigatória: nenhum log do motor registral pode conter conteúdo
//      sensível integral (nome completo, texto do documento, filiação).

export const METRICAS = {
  DOCUMENTOS_PROCESSADOS: "documentos_processados",
  TEMPO_POR_DOCUMENTO_MS: "tempo_por_documento_ms",
  CAMPOS_EXTRAIDOS: "campos_extraidos",
  TAXA_EXTRACAO: "taxa_extracao",
  CAMPOS_DIVERGENTES: "campos_divergentes",
  TAXA_CONFLITO: "taxa_conflito",
  TAXA_REVISAO_HUMANA: "taxa_revisao_humana",
  PROPOSTAS_CRIADAS: "propostas_criadas",
  PROPOSTAS_APROVADAS: "propostas_aprovadas",
  PROPOSTAS_REJEITADAS: "propostas_rejeitadas",
  FALSOS_POSITIVOS: "falsos_positivos_identificados",
  ERROS: "erros",
  REPROCESSAMENTOS: "reprocessamentos",
  DUPLICIDADES_EVITADAS: "duplicidades_evitadas",
  ALTERACOES_REVERTIDAS: "alteracoes_revertidas",
  APLICACOES_ABORTADAS: "aplicacoes_abortadas",
  EVIDENCIAS_CRIADAS: "evidencias_criadas",
  PESSOAS_CRIADAS: "pessoas_criadas",
  VINCULOS_CRIADOS: "vinculos_criados",
} as const

export type ChaveMetrica = (typeof METRICAS)[keyof typeof METRICAS]

/** Janela de agregação: hora cheia em UTC. Recebe o instante de fora. */
export function janelaDe(instante: Date): Date {
  return new Date(Date.UTC(
    instante.getUTCFullYear(),
    instante.getUTCMonth(),
    instante.getUTCDate(),
    instante.getUTCHours(),
    0,
    0,
    0,
  ))
}

/**
 * Campos que NUNCA entram em log estruturado por extenso. A lista é usada pelo
 * redator abaixo e checada por teste de guarda.
 */
export const CAMPOS_SENSIVEIS = [
  "nome",
  "nomeBruto",
  "nomeNormalizado",
  "nomeCompleto",
  "sobrenome",
  "nomePai",
  "nomeMae",
  "nomeConjuge",
  "paiRegistrado",
  "maeRegistrada",
  "conjugeRegistrado",
  "nomeRegistrado",
  "trecho",
  "trechoTexto",
  "texto",
  "transcricaoTexto",
  "valorBruto",
  "cpf",
  "observacoes",
  "justificativa",
] as const

/**
 * Reduz um valor sensível a uma forma que ainda permite investigar sem expor:
 * inicial + tamanho. "MARIA SOUZA BIANCHI" -> "M…(19)".
 */
export function reduzir(v: unknown): string {
  const s = v == null ? "" : String(v)
  if (!s) return "∅"
  return `${s.trim().charAt(0)}…(${s.length})`
}

/**
 * Redige um objeto para log: mantém a estrutura e os números, substitui todo
 * campo sensível pela forma reduzida. Recursivo, e resistente a ciclo.
 */
export function redigirParaLog(v: unknown, profundidade = 0, vistos = new WeakSet<object>()): unknown {
  if (profundidade > 6) return "…"
  if (v == null || typeof v === "number" || typeof v === "boolean") return v
  if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 40)}…(${v.length})` : v
  if (typeof v !== "object") return String(v)

  if (vistos.has(v as object)) return "[ciclo]"
  vistos.add(v as object)

  if (Array.isArray(v)) {
    return v.slice(0, 20).map((x) => redigirParaLog(x, profundidade + 1, vistos))
  }

  const sensiveis = new Set<string>(CAMPOS_SENSIVEIS)
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (sensiveis.has(k)) {
      out[k] = reduzir(val)
      continue
    }
    out[k] = redigirParaLog(val, profundidade + 1, vistos)
  }
  return out
}

export interface AmostraMetrica {
  chave: ChaveMetrica
  escopo: string
  valor: number
}

/** Métricas derivadas de uma execução de lote. */
export function metricasDoLote(p: {
  processoId: number
  totalDocumentos: number
  processados: number
  falhos: number
  camposExtraidos: number
  camposDivergentes: number
  conflitosAbertos: number
  propostasCriadas: number
  propostasAutomaticas: number
  evidenciasCriadas: number
  pessoasCriadas: number
  vinculosCriados: number
  duplicidadesEvitadas: number
  duracaoMs: number
}): AmostraMetrica[] {
  const escopo = `processo:${p.processoId}`
  const denominadorCampos = Math.max(1, p.camposExtraidos)
  const aguardandoRevisao = Math.max(0, p.propostasCriadas - p.propostasAutomaticas)

  return [
    { chave: METRICAS.DOCUMENTOS_PROCESSADOS, escopo, valor: p.processados },
    {
      chave: METRICAS.TEMPO_POR_DOCUMENTO_MS,
      escopo,
      valor: p.processados > 0 ? Math.round(p.duracaoMs / p.processados) : 0,
    },
    { chave: METRICAS.CAMPOS_EXTRAIDOS, escopo, valor: p.camposExtraidos },
    {
      chave: METRICAS.TAXA_EXTRACAO,
      escopo,
      valor: p.totalDocumentos > 0 ? round4(p.camposExtraidos / p.totalDocumentos) : 0,
    },
    { chave: METRICAS.CAMPOS_DIVERGENTES, escopo, valor: p.camposDivergentes },
    { chave: METRICAS.TAXA_CONFLITO, escopo, valor: round4(p.camposDivergentes / denominadorCampos) },
    {
      chave: METRICAS.TAXA_REVISAO_HUMANA,
      escopo,
      valor: p.propostasCriadas > 0 ? round4(aguardandoRevisao / p.propostasCriadas) : 0,
    },
    { chave: METRICAS.PROPOSTAS_CRIADAS, escopo, valor: p.propostasCriadas },
    { chave: METRICAS.EVIDENCIAS_CRIADAS, escopo, valor: p.evidenciasCriadas },
    { chave: METRICAS.PESSOAS_CRIADAS, escopo, valor: p.pessoasCriadas },
    { chave: METRICAS.VINCULOS_CRIADOS, escopo, valor: p.vinculosCriados },
    { chave: METRICAS.DUPLICIDADES_EVITADAS, escopo, valor: p.duplicidadesEvitadas },
    { chave: METRICAS.ERROS, escopo, valor: p.falhos },
  ]
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}
