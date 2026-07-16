// src/lib/documentos/regras-documentais/conflitos.ts
//
// Detecção de CONFLITOS entre regras documentais (puro). Nunca resolve uma
// contradição silenciosamente — apenas REPORTA para o usuário decidir. A
// prioridade só é considerada quando explicitamente definida (prioridade != 0).

import { type RegraDocumental } from "./tipos"
import { validarConjunto } from "./condicoes"

export type TipoConflito =
  | "obrigatoriedade_divergente"
  | "regra_duplicada"
  | "documento_duplicado"
  | "validade_conflitante"
  | "fase_incompativel"
  | "condicao_incompativel"

export interface Conflito {
  tipo: TipoConflito
  severidade: "erro" | "aviso"
  mensagem: string
  regras: number[] // ids envolvidos
  resolvidoPorPrioridade: boolean
}

function serializaCondicoes(r: RegraDocumental): string {
  if (!r.condicoes || r.condicoes.regras.length === 0) return "∅"
  const regras = [...r.condicoes.regras]
    .map((c) => `${c.campo}|${c.operador}|${String(c.valor)}`)
    .sort()
  return `${r.condicoes.combinador}:${regras.join(",")}`
}

// escopo de comparação: mesmo processo + documento + público-alvo (+ modalidade)
function escopo(r: RegraDocumental): string {
  return [r.tipoProcessoId, r.modalidadeId ?? "*", r.documentTypeCode, r.publicoAlvo].join("::")
}

export function detectarConflitos(
  regras: RegraDocumental[],
  ordemFase?: Record<string, number>,
): Conflito[] {
  const conflitos: Conflito[] = []
  // considera apenas regras "vivas" (publicada ou rascunho) — arquivadas/inativas não conflitam
  const ativas = regras.filter((r) => r.status === "PUBLICADA" || r.status === "RASCUNHO")

  // 1) incompatibilidade de fase e de condição DENTRO de cada regra
  for (const r of ativas) {
    if (ordemFase && r.faseExigencia && r.faseBloqueio) {
      const oe = ordemFase[r.faseExigencia]
      const ob = ordemFase[r.faseBloqueio]
      if (oe != null && ob != null && ob < oe) {
        conflitos.push({
          tipo: "fase_incompativel", severidade: "erro", regras: [r.id], resolvidoPorPrioridade: false,
          mensagem: `Regra "${r.nome ?? r.documentTypeCode}": bloqueia uma fase (${r.faseBloqueio}) anterior à fase em que passa a ser exigida (${r.faseExigencia}).`,
        })
      }
    }
    const probs = validarConjunto(r.condicoes)
    for (const p of probs.filter((x) => x.tipo === "contradicao")) {
      conflitos.push({
        tipo: "condicao_incompativel", severidade: "erro", regras: [r.id], resolvidoPorPrioridade: false,
        mensagem: `Regra "${r.nome ?? r.documentTypeCode}": ${p.mensagem}`,
      })
    }
  }

  // 2) comparação por PARES no mesmo escopo
  for (let i = 0; i < ativas.length; i++) {
    for (let j = i + 1; j < ativas.length; j++) {
      const a = ativas[i], b = ativas[j]
      if (escopo(a) !== escopo(b)) continue

      const mesmaCondicao = serializaCondicoes(a) === serializaCondicoes(b)
      const temPrioridade = a.prioridade !== b.prioridade // prioridade explícita desempata
      const nome = (r: RegraDocumental) => r.nome ?? r.documentTypeCode

      // 2a) regras idênticas (mesma condição + mesma obrigatoriedade)
      if (mesmaCondicao && a.obrigatoriedade === b.obrigatoriedade) {
        conflitos.push({
          tipo: "regra_duplicada", severidade: "aviso", regras: [a.id, b.id], resolvidoPorPrioridade: false,
          mensagem: `Regras idênticas para o mesmo documento e público: "${nome(a)}" e "${nome(b)}".`,
        })
        continue
      }

      // 2b) obrigatoriedade divergente (mesma condição, obrigatoriedade diferente)
      if (mesmaCondicao && a.obrigatoriedade !== b.obrigatoriedade) {
        conflitos.push({
          tipo: "obrigatoriedade_divergente", severidade: "erro", regras: [a.id, b.id],
          resolvidoPorPrioridade: temPrioridade,
          mensagem: `Contradição: "${nome(a)}" (${a.obrigatoriedade}) x "${nome(b)}" (${b.obrigatoriedade}) para o mesmo documento e público${temPrioridade ? " — resolvida por prioridade explícita" : " — sem prioridade definida (resolver manualmente)"}.`,
        })
      } else if (!mesmaCondicao) {
        // 2c) mesmo documento/público, condições diferentes → sobreposição possível
        conflitos.push({
          tipo: "documento_duplicado", severidade: "aviso", regras: [a.id, b.id], resolvidoPorPrioridade: temPrioridade,
          mensagem: `Mesmo documento e público em duas regras com condições diferentes: "${nome(a)}" e "${nome(b)}". Verifique sobreposição.`,
        })
      }

      // 2d) validade conflitante
      if (a.possuiValidade !== b.possuiValidade || (a.validadeDias ?? null) !== (b.validadeDias ?? null)) {
        conflitos.push({
          tipo: "validade_conflitante", severidade: "aviso", regras: [a.id, b.id], resolvidoPorPrioridade: false,
          mensagem: `Validade divergente para o mesmo documento e público: "${nome(a)}" e "${nome(b)}".`,
        })
      }
    }
  }

  return conflitos
}
