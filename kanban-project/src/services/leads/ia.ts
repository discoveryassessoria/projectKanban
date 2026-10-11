// src/services/leads/ia.ts
// ============================================================================
// A CHAMADA À IA DO AGENTE DE LEADS — docs/leads-mandato.md §7 e regra 14.
//
// Mesmo padrão de `src/lib/genealogia/importar-arvore/visao-cliente.ts`: `fetch` direto na API da
// Anthropic, sem SDK, com tempo limite. A resposta é pedida no formato fixo (`output_config.format`),
// então o texto devolvido já é o objeto que as instruções descrevem.
//
// O texto fixo das instruções vai marcado para cache; a hora, que muda a cada resposta, vai num bloco
// depois dele e não invalida o cache.
// ============================================================================
import type { ConfiguracaoDaIA } from "./config"
import type { Buscar } from "./whatsapp"

export interface TurnoDaConversa {
  role: "user" | "assistant"
  content: string
}

export interface PessoaDaLinhagem {
  quem: string
  nome: string
  conjuge: string
  pais: string
  nasceu: string
}

/** O objeto que as instruções pedem (seção "FORMATO DA RESPOSTA"). */
export interface RespostaDoAgente {
  mensagens: string[]
  ficha: Record<string, string>
  linhagem: PessoaDaLinhagem[]
  passar_para_equipe: boolean
  motivo: string
  resumo: string
}

export interface IA {
  responder(args: { instrucoesFixas: string; instrucaoDaHora: string; turnos: TurnoDaConversa[] }): Promise<RespostaDoAgente>
}

const ENDPOINT = "https://api.anthropic.com/v1/messages"
const VERSAO_API = "2023-06-01"
const TEMPO_LIMITE_MS = 40_000
const MAX_TOKENS = 1500
/** A IA relê no máximo este tanto de turnos; conversa de triagem não chega perto. */
const MAX_TURNOS = 60
const MAX_MENSAGENS_POR_RESPOSTA = 4

export const CAMPOS_DA_FICHA = ["nome", "pais", "antepassado", "origem", "linha", "naturalizacao", "familia", "pessoas", "documentos"] as const
const CAMPOS_DA_LINHAGEM = ["quem", "nome", "conjuge", "pais", "nasceu"] as const

const texto = { type: "string" } as const
const ESQUEMA_DA_RESPOSTA = {
  type: "object",
  properties: {
    mensagens: { type: "array", items: texto },
    ficha: {
      type: "object",
      properties: Object.fromEntries(CAMPOS_DA_FICHA.map((c) => [c, texto])),
      required: [...CAMPOS_DA_FICHA],
      additionalProperties: false,
    },
    linhagem: {
      type: "array",
      items: {
        type: "object",
        properties: Object.fromEntries(CAMPOS_DA_LINHAGEM.map((c) => [c, texto])),
        required: [...CAMPOS_DA_LINHAGEM],
        additionalProperties: false,
      },
    },
    passar_para_equipe: { type: "boolean" },
    motivo: texto,
    resumo: texto,
  },
  required: ["mensagens", "ficha", "linhagem", "passar_para_equipe", "motivo", "resumo"],
  additionalProperties: false,
} as const

/** Lê o objeto mesmo que venha dentro de um bloco de código ou com uma frase em volta. */
export function extrairJson(bruto: unknown): Record<string, unknown> | null {
  if (typeof bruto !== "string") return null
  const tentativas = [bruto.trim()]
  const cerca = bruto.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (cerca) tentativas.push(cerca[1].trim())
  const ini = bruto.indexOf("{")
  const fim = bruto.lastIndexOf("}")
  if (ini >= 0 && fim > ini) tentativas.push(bruto.slice(ini, fim + 1))
  for (const t of tentativas) {
    try {
      const obj: unknown = JSON.parse(t)
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, unknown>
    } catch {
      // tenta a próxima forma
    }
  }
  return null
}

/** A API exige turnos alternados começando pelo lead. Seguidos do mesmo lado viram um só. */
export function juntarTurnos(turnos: TurnoDaConversa[]): TurnoDaConversa[] {
  const saida: TurnoDaConversa[] = []
  for (const t of turnos) {
    const ultimo = saida[saida.length - 1]
    if (ultimo && ultimo.role === t.role) ultimo.content += "\n" + t.content
    else saida.push({ role: t.role, content: t.content })
  }
  while (saida.length && saida[0].role !== "user") saida.shift()
  return saida
}

const comoTexto = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v))

/** Confere e normaliza o que a IA devolveu. `null` quando não há nenhuma mensagem para enviar. */
export function normalizarResposta(obj: Record<string, unknown> | null): RespostaDoAgente | null {
  if (!obj) return null
  const mensagens = Array.isArray(obj.mensagens)
    ? obj.mensagens.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim().slice(0, 4096)).slice(0, MAX_MENSAGENS_POR_RESPOSTA)
    : []
  if (!mensagens.length) return null
  const fichaBruta = obj.ficha && typeof obj.ficha === "object" && !Array.isArray(obj.ficha) ? (obj.ficha as Record<string, unknown>) : {}
  const ficha: Record<string, string> = {}
  for (const campo of CAMPOS_DA_FICHA) ficha[campo] = comoTexto(fichaBruta[campo])
  const linhagem: PessoaDaLinhagem[] = Array.isArray(obj.linhagem)
    ? obj.linhagem
        .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object" && !Array.isArray(p))
        .map((p) => ({ quem: comoTexto(p.quem), nome: comoTexto(p.nome), conjuge: comoTexto(p.conjuge), pais: comoTexto(p.pais), nasceu: comoTexto(p.nasceu) }))
        .slice(0, 40)
    : []
  return {
    mensagens,
    ficha,
    linhagem,
    passar_para_equipe: obj.passar_para_equipe === true,
    motivo: comoTexto(obj.motivo).slice(0, 300),
    resumo: comoTexto(obj.resumo),
  }
}

export function criarIA(config: ConfiguracaoDaIA, buscar: Buscar = fetch): IA {
  async function chamar(instrucoesFixas: string, instrucaoDaHora: string, turnos: TurnoDaConversa[]): Promise<string> {
    const resp = await buscar(ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: { "content-type": "application/json", "x-api-key": config.chave, "anthropic-version": VERSAO_API },
      body: JSON.stringify({
        model: config.modelo,
        max_tokens: MAX_TOKENS,
        system: [
          { type: "text", text: instrucoesFixas, cache_control: { type: "ephemeral" } },
          { type: "text", text: instrucaoDaHora },
        ],
        messages: turnos,
        output_config: { format: { type: "json_schema", schema: ESQUEMA_DA_RESPOSTA } },
      }),
    })
    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => "")
      throw new Error(`A IA respondeu ${resp.status}: ${detalhe.slice(0, 300)}`)
    }
    const dados = (await resp.json()) as { content?: { type: string; text?: string }[] }
    return (dados.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("")
  }

  return {
    async responder({ instrucoesFixas, instrucaoDaHora, turnos }) {
      const limpos = juntarTurnos(turnos).slice(-MAX_TURNOS)
      while (limpos.length && limpos[0].role !== "user") limpos.shift()
      if (!limpos.length) throw new Error("Não há mensagem do lead para responder.")
      // Uma segunda tentativa cobre a resposta fora do formato e a falha passageira da API.
      let ultimoErro = "A IA respondeu fora do formato."
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        try {
          const resposta = normalizarResposta(extrairJson(await chamar(instrucoesFixas, instrucaoDaHora, limpos)))
          if (resposta) return resposta
          ultimoErro = "A IA respondeu fora do formato."
        } catch (e) {
          ultimoErro = e instanceof Error ? e.message : String(e)
        }
      }
      throw new Error(ultimoErro)
    },
  }
}
