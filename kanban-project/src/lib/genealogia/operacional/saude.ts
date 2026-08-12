// src/lib/genealogia/operacional/saude.ts
//
// SAÚDE POR PESSOA — o heatmap, decidido por regra fechada.
//
// O diagnóstico já classifica o PROCESSO em saudável/atenção/crítico. Este
// módulo faz o mesmo por PESSOA, para que o canvas possa sinalizar onde está o
// problema sem obrigar o operador a abrir o painel e ler a lista.
//
// O CRITÉRIO É O MESMO DO DIAGNÓSTICO, de propósito — e é fechado:
//
//   CRÍTICO   existe bloqueio impeditivo (documento NÃO LOCALIZADO, ou
//             divergência que o motor classificou como crítica)
//   ATENÇÃO   existe pendência, divergência ou tarefa aberta
//   SAUDÁVEL  nenhuma pendência conhecida
//   FORA      a pessoa não está na linhagem em foco
//
// Não existe score. Um número de 0 a 100 esconderia justamente a diferença que
// importa: "falta muita coisa fácil" e "tem uma coisa que impede tudo" dariam
// notas parecidas, e são situações opostas.
//
// "Conhecida" é literal: saudável significa "sem problema QUE ESTE MOTOR VÊ".
// Quando não há exigência materializada, não há dossiê para conferir — e o
// verde não é aprovação. Quem exibe precisa dizer isso; ver `semDossie`.
//
// PURO: sem rede, sem banco, sem relógio.

import type { GrafoGenealogico } from "../motor/grafo"
import type { Linhagem } from "../motor/linhagens"
import type { DossiePessoa } from "./dossie"

export type NivelSaudePessoa = "critico" | "atencao" | "saudavel" | "fora"

export interface SaudePessoa {
  pessoaId: number
  nivel: NivelSaudePessoa
  /** Uma frase dizendo por que este nível — vira o tooltip do nó. */
  motivo: string
  /** true quando não havia exigência para conferir (verde ≠ aprovado). */
  semDossie: boolean
}

export const ROTULO_NIVEL: Record<NivelSaudePessoa, string> = {
  critico: "Crítico",
  atencao: "Atenção",
  saudavel: "Saudável",
  fora: "Fora da linhagem",
}

/**
 * Cores do heatmap.
 *
 * São as MESMAS já usadas nos cartões de insight e no selo de saúde — não é
 * paleta nova. O heatmap é um anel em volta do cartão, aplicado no wrapper do
 * nó; o cartão em si não é tocado.
 */
export const COR_NIVEL: Record<NivelSaudePessoa, string> = {
  critico: "#b42318",
  atencao: "#b54708",
  saudavel: "#067647",
  fora: "#d0d5dd",
}

export function calcularSaude(
  grafo: GrafoGenealogico,
  dossies: Map<number, DossiePessoa>,
  linhagem: Linhagem | null,
): Map<number, SaudePessoa> {
  const saida = new Map<number, SaudePessoa>()

  for (const p of grafo.pessoas) {
    // Fora do foco vem primeiro: dizer "saudável" de alguém que o operador
    // acabou de tirar da vista seria afirmar algo que não se apurou.
    if (linhagem && !linhagem.visivel.has(p.id)) {
      saida.set(p.id, {
        pessoaId: p.id,
        nivel: "fora",
        motivo: "Não pertence à linhagem em foco.",
        semDossie: false,
      })
      continue
    }

    const d = dossies.get(p.id)
    if (!d) {
      saida.set(p.id, {
        pessoaId: p.id,
        nivel: "saudavel",
        motivo: "Sem dossiê projetado para esta pessoa.",
        semDossie: true,
      })
      continue
    }

    const bloqueios = d.documental.naoLocalizadas
    const divergenciasCriticas = d.divergencias.filter((i) => i.severidade === "critico").length
    const semDossie = d.documental.necessarias === 0

    if (bloqueios > 0 || divergenciasCriticas > 0) {
      const partes: string[] = []
      if (bloqueios > 0) partes.push(`${bloqueios} documento(s) não localizado(s)`)
      if (divergenciasCriticas > 0) partes.push(`${divergenciasCriticas} divergência(s) crítica(s)`)
      saida.set(p.id, {
        pessoaId: p.id,
        nivel: "critico",
        motivo: `${partes.join(" e ")} — impede a conclusão.`,
        semDossie,
      })
      continue
    }

    const pendentes = d.documental.pendentes
    const emAndamento = d.documental.emAtendimento
    const divergencias = d.divergencias.length
    const tarefas = d.tarefasAbertas.length

    if (pendentes > 0 || divergencias > 0 || tarefas > 0 || emAndamento > 0) {
      const partes: string[] = []
      if (pendentes > 0) partes.push(`${pendentes} exigência(s) pendente(s)`)
      if (emAndamento > 0) partes.push(`${emAndamento} em atendimento`)
      if (divergencias > 0) partes.push(`${divergencias} divergência(s)`)
      if (tarefas > 0) partes.push(`${tarefas} tarefa(s) aberta(s)`)
      saida.set(p.id, {
        pessoaId: p.id,
        nivel: "atencao",
        motivo: `${partes.join(" · ")} — atrasa, mas não impede.`,
        semDossie,
      })
      continue
    }

    saida.set(p.id, {
      pessoaId: p.id,
      nivel: "saudavel",
      motivo: semDossie
        ? "Nada a apontar — nenhuma exigência materializada ainda."
        : "Todas as exigências resolvidas, sem divergência nem tarefa aberta.",
      semDossie,
    })
  }

  return saida
}

/** Quantas pessoas em cada nível — para a legenda dizer números reais. */
export function contarPorNivel(saude: Map<number, SaudePessoa>): Record<NivelSaudePessoa, number> {
  const t: Record<NivelSaudePessoa, number> = { critico: 0, atencao: 0, saudavel: 0, fora: 0 }
  for (const s of saude.values()) t[s.nivel]++
  return t
}
