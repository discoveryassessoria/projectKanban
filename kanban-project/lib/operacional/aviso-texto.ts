// lib/operacional/aviso-texto.ts
// ============================================================================
// O TEXTO DO SINO — uma função pura, uma fonte. Redesenho do sino (29/09/2026).
//
// O texto NUNCA é guardado como número dentro de `titulo` para ser "somado" depois:
// ele é recomposto a partir de (tipo, família, contagem, resumo) toda vez que o aviso
// muda. Assim "2 tarefas" nunca vira "1 + 1" mal concatenado, e o plural/singular
// sai certo em qualquer contagem.
//
// Sempre "tarefa(s)" e nome da FAMÍLIA. Nunca tipo de documento, nunca nome de pessoa
// por certidão: quem quer o detalhe abre a Operação (o aviso só diz que há e onde).
// ============================================================================

export type TipoAviso =
  | 'CHEGOU_TRABALHO' | 'PRECISA_AGIR' | 'MUDOU_DE_MAO'
  | 'ESCALADA' | 'SEM_RESPONSAVEL' | 'INTEGRIDADE' | 'FASE_CONCLUIDA'

export interface ResumoDoAviso {
  /** Ids das tarefas por categoria (PRECISA_AGIR, e as 3 primeiras também no gestor). */
  vencidas?: number[]
  hoje?: number[]
  amanha?: number[]
  cobrancas?: number[]
  /** `FOTO` = a foto inteira do dia; `NOVOS` = só o que é fato novo depois do clique. */
  modo?: 'FOTO' | 'NOVOS'
  /** Ids já vistos na leitura anterior — a base de "o que é novo". */
  base?: { vencidas: number[]; cobrancas: number[] }
  /** Fatos que não são tarefa (fase concluída, alerta de integridade): chave estável de cada um. */
  itens?: string[]
}

export const FAMILIA_AVULSA = 'Tarefas avulsas'

const q = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`

/** Ids únicos de todas as categorias — o que o aviso "cobre". */
export function idsDoResumo(r: ResumoDoAviso | null | undefined): number[] {
  if (!r) return []
  return [...new Set([...(r.vencidas ?? []), ...(r.hoje ?? []), ...(r.amanha ?? []), ...(r.cobrancas ?? [])])]
}

/** Categorias de PRECISA_AGIR que são FATO NOVO em relação à leitura anterior. */
export function novosDoResumo(r: ResumoDoAviso): { vencidas: number[]; cobrancas: number[] } {
  const baseV = new Set(r.base?.vencidas ?? [])
  const baseC = new Set(r.base?.cobrancas ?? [])
  return {
    vencidas: (r.vencidas ?? []).filter((id) => !baseV.has(id)),
    cobrancas: (r.cobrancas ?? []).filter((id) => !baseC.has(id)),
  }
}

export function textoDoAviso(
  tipo: TipoAviso,
  familia: string | null,
  d: { contagem: number; resumo?: ResumoDoAviso | null },
): string {
  const f = familia?.trim() || FAMILIA_AVULSA
  const n = d.contagem
  switch (tipo) {
    case 'CHEGOU_TRABALHO':
      return `${f} — ${q(n, 'tarefa atribuída', 'tarefas atribuídas')} a você`
    case 'MUDOU_DE_MAO':
      return `${f} — ${n === 1 ? '1 tarefa saiu' : `${n} tarefas saíram`} do seu A fazer`
    case 'PRECISA_AGIR': {
      const r = d.resumo ?? {}
      const partes: string[] = []
      if (r.modo === 'NOVOS') {
        const nv = novosDoResumo(r)
        if (nv.vencidas.length) partes.push(q(nv.vencidas.length, 'nova vencida', 'novas vencidas'))
        if (nv.cobrancas.length) partes.push(q(nv.cobrancas.length, 'nova cobrança a fazer', 'novas cobranças a fazer'))
      } else {
        const v = r.vencidas?.length ?? 0, h = r.hoje?.length ?? 0, a = r.amanha?.length ?? 0, c = r.cobrancas?.length ?? 0
        if (v) partes.push(q(v, 'vencida', 'vencidas'))
        if (h) partes.push(h === 1 ? '1 vence hoje' : `${h} vencem hoje`)
        if (a) partes.push(a === 1 ? '1 vence amanhã' : `${a} vencem amanhã`)
        if (c) partes.push(q(c, 'cobrança a fazer', 'cobranças a fazer'))
      }
      return `${f} — ${partes.join(' · ')}`
    }
    case 'ESCALADA':
      return `${f} — ${q(n, 'tarefa com 2ª cobrança sem resposta', 'tarefas com 2ª cobrança sem resposta')}`
    case 'SEM_RESPONSAVEL':
      return `${f} — ${q(n, 'tarefa sem responsável', 'tarefas sem responsável')} há mais de 1 dia`
    case 'INTEGRIDADE':
      return `${f} — ${q(n, 'alerta crítico de integridade', 'alertas críticos de integridade')}`
    case 'FASE_CONCLUIDA':
      return `${f} — ${q(n, 'fase concluída', 'fases concluídas')}`
  }
}

/** O PRECISA_AGIR ainda diz alguma coisa? (foto vazia = o aviso deixa de existir) */
export function resumoTemConteudo(r: ResumoDoAviso | null | undefined): boolean {
  if (!r) return false
  if (r.modo === 'NOVOS') {
    const nv = novosDoResumo(r)
    return nv.vencidas.length + nv.cobrancas.length > 0
  }
  return idsDoResumo(r).length > 0
}
