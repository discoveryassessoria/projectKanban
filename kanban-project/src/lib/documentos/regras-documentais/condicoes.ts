// src/lib/documentos/regras-documentais/condicoes.ts
//
// Avaliação e validação das CONDIÇÕES estruturadas (puro). Nada de SQL, nomes de
// tabela livres ou código executável — só o vocabulário fechado de tipos.ts.

import {
  type Condicao, type ConjuntoCondicoes, type CampoCondicao, type Operador,
  type SujeitoContexto, type ValorCondicao,
  CAMPO_CONDICAO_LABEL, OPERADOR_LABEL, CAMPOS_CONDICAO, OPERADORES,
} from "./tipos"

// ---- resolução do valor ATUAL do sujeito para um campo de condição ----

export function valorDoSujeito(campo: CampoCondicao, s: SujeitoContexto): ValorCondicao | undefined {
  switch (campo) {
    case "precisaDeDocumentacao": return s.precisaDeDocumentacao
    case "requerente": return s.requerente
    case "contratante": return s.contratante
    case "linhaReta": return s.linhaReta
    case "casado": return s.casado
    case "falecido": return s.falecido ?? (s.vivo === undefined ? undefined : !s.vivo)
    case "vivo": return s.vivo ?? (s.falecido === undefined ? undefined : !s.falecido)
    case "possuiConjuge": return s.possuiConjuge ?? s.casado
    case "modalidade": return (s.modalidade ?? undefined) as ValorCondicao | undefined
    case "geracao": return s.geracao ?? undefined
    case "nacionalidade": return s.nacionalidade ?? undefined
    case "paisRegistro": return s.paisRegistro ?? undefined
    default: return undefined
  }
}

// Normaliza "Sim"/"Não"/"true"/1 → boolean quando o campo é booleano.
const CAMPOS_BOOL: CampoCondicao[] = [
  "precisaDeDocumentacao", "requerente", "contratante", "linhaReta", "casado", "falecido", "vivo", "possuiConjuge",
]
function coerceBool(v: ValorCondicao | undefined): boolean | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === "boolean") return v
  const s = String(v).trim().toLowerCase()
  if (["true", "sim", "1", "yes"].includes(s)) return true
  if (["false", "nao", "não", "0", "no"].includes(s)) return false
  return undefined
}

// ---- avaliação de UMA condição ----

export function avaliarCondicao(cond: Condicao, s: SujeitoContexto): boolean {
  const ehBool = CAMPOS_BOOL.includes(cond.campo)
  const atualRaw = valorDoSujeito(cond.campo, s)

  // existe / não existe independem de tipo
  if (cond.operador === "existe") return atualRaw !== undefined && atualRaw !== null
  if (cond.operador === "nao_existe") return atualRaw === undefined || atualRaw === null

  if (ehBool) {
    const atual = coerceBool(atualRaw)
    const alvo = coerceBool(cond.valor)
    if (atual === undefined) return false // atributo desconhecido → não satisfaz
    switch (cond.operador) {
      case "igual": return atual === alvo
      case "diferente": return atual !== alvo
      default: return false // operadores numéricos/texto não fazem sentido em bool
    }
  }

  // numéricos / texto
  const atual = atualRaw
  if (atual === undefined || atual === null) return false
  switch (cond.operador) {
    case "igual": return String(atual) === String(cond.valor)
    case "diferente": return String(atual) !== String(cond.valor)
    case "contem": return String(atual).toLowerCase().includes(String(cond.valor ?? "").toLowerCase())
    case "nao_contem": return !String(atual).toLowerCase().includes(String(cond.valor ?? "").toLowerCase())
    case "maior": return Number(atual) > Number(cond.valor)
    case "menor": return Number(atual) < Number(cond.valor)
    default: return false
  }
}

// ---- avaliação do CONJUNTO (TODAS / QUALQUER) ----

export interface ResultadoConjunto {
  satisfeito: boolean
  satisfeitas: string[]
  naoSatisfeitas: string[]
}

export function avaliarConjunto(conj: ConjuntoCondicoes | null, s: SujeitoContexto): ResultadoConjunto {
  if (!conj || !Array.isArray(conj.regras) || conj.regras.length === 0) {
    return { satisfeito: true, satisfeitas: [], naoSatisfeitas: [] } // sem condição → aplica
  }
  const satisfeitas: string[] = []
  const naoSatisfeitas: string[] = []
  for (const c of conj.regras) {
    const ok = avaliarCondicao(c, s)
    ;(ok ? satisfeitas : naoSatisfeitas).push(descreverCondicao(c))
  }
  const satisfeito = conj.combinador === "QUALQUER"
    ? satisfeitas.length > 0
    : naoSatisfeitas.length === 0
  return { satisfeito, satisfeitas, naoSatisfeitas }
}

// ---- descrições legíveis ----

export function descreverCondicao(c: Condicao): string {
  const campo = CAMPO_CONDICAO_LABEL[c.campo] ?? c.campo
  const op = OPERADOR_LABEL[c.operador] ?? c.operador
  if (c.operador === "existe" || c.operador === "nao_existe") return `${campo} ${op}`
  const valor = typeof c.valor === "boolean" ? (c.valor ? "Sim" : "Não") : String(c.valor ?? "")
  return `${campo} ${op} ${valor}`
}

// Frase curta para justificativa ("precisa de documentação", "é casado").
export function fraseCurtaCondicao(c: Condicao): string {
  const b = coerceBool(c.valor)
  const afirm = c.operador === "igual" ? b === true : c.operador === "diferente" ? b === false : undefined
  if (afirm !== undefined) {
    const mapa: Partial<Record<CampoCondicao, [string, string]>> = {
      precisaDeDocumentacao: ["precisa de documentação", "não precisa de documentação"],
      requerente: ["é requerente", "não é requerente"],
      contratante: ["é contratante", "não é contratante"],
      linhaReta: ["é da linha reta", "não é da linha reta"],
      casado: ["é casado", "não é casado"],
      falecido: ["é falecido", "não é falecido"],
      vivo: ["está vivo", "não está vivo"],
      possuiConjuge: ["possui cônjuge", "não possui cônjuge"],
    }
    const par = mapa[c.campo]
    if (par) return afirm ? par[0] : par[1]
  }
  return descreverCondicao(c).toLowerCase()
}

export function justificativaDoConjunto(conj: ConjuntoCondicoes | null): string {
  if (!conj || conj.regras.length === 0) return "aplica-se sem condições adicionais"
  const frases = conj.regras.map(fraseCurtaCondicao)
  const conector = conj.combinador === "QUALQUER" ? " ou " : " e "
  return frases.join(conector)
}

// ---- VALIDAÇÃO de condições incompatíveis (alerta antes de salvar) ----

export interface ProblemaCondicao {
  tipo: "campo_invalido" | "operador_invalido" | "contradicao" | "duplicada"
  mensagem: string
}

export function validarConjunto(conj: ConjuntoCondicoes | null): ProblemaCondicao[] {
  const problemas: ProblemaCondicao[] = []
  if (!conj || conj.regras.length === 0) return problemas

  // vocabulário fechado
  for (const c of conj.regras) {
    if (!(CAMPOS_CONDICAO as readonly string[]).includes(c.campo)) {
      problemas.push({ tipo: "campo_invalido", mensagem: `Campo desconhecido: "${c.campo}".` })
    }
    if (!(OPERADORES as readonly string[]).includes(c.operador)) {
      problemas.push({ tipo: "operador_invalido", mensagem: `Operador desconhecido: "${c.operador}".` })
    }
  }

  // duplicadas (mesmo campo+operador+valor)
  const vistas = new Set<string>()
  for (const c of conj.regras) {
    const chave = `${c.campo}|${c.operador}|${String(c.valor)}`
    if (vistas.has(chave)) problemas.push({ tipo: "duplicada", mensagem: `Condição duplicada: ${descreverCondicao(c)}.` })
    vistas.add(chave)
  }

  // contradições booleanas conhecidas
  const boolIgual = new Map<CampoCondicao, boolean>()
  for (const c of conj.regras) {
    if (c.operador === "igual" && CAMPOS_BOOL.includes(c.campo)) {
      const b = coerceBool(c.valor)
      if (b !== undefined) {
        if (boolIgual.has(c.campo) && boolIgual.get(c.campo) !== b) {
          problemas.push({ tipo: "contradicao", mensagem: `Condição contraditória em "${CAMPO_CONDICAO_LABEL[c.campo]}": exige Sim e Não ao mesmo tempo.` })
        }
        boolIgual.set(c.campo, b)
      }
    }
  }
  const vivo = boolIgual.get("vivo")
  const falecido = boolIgual.get("falecido")
  if (vivo === true && falecido === true) problemas.push({ tipo: "contradicao", mensagem: "Condição inválida: vivo = Sim e falecido = Sim ao mesmo tempo." })
  if (vivo === false && falecido === false) problemas.push({ tipo: "contradicao", mensagem: "Condição inválida: vivo = Não e falecido = Não ao mesmo tempo." })
  const casado = boolIgual.get("casado")
  const conjuge = boolIgual.get("possuiConjuge")
  if (casado === false && conjuge === true) problemas.push({ tipo: "contradicao", mensagem: "Condição inválida: não casado, mas exige possuir cônjuge." })

  return problemas
}
