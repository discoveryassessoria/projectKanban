// lib/operacional/torre-fases.ts
// ============================================================================
// UMA LISTA DE FASES PARA A TORRE E O KANBAN (07/10/2026). Antes cada aba montava a sua: a Visão geral tinha 9 fases (sem Finalizado, na ordem do `ordemPadrao` do
// catálogo), Radar e Processos 10 (Finalizado antes de Tradução), o Kanban a ordem de cada macro, o filtro de Tarefas ordem alfabética. A ORDEM REAL do processo é a do
// catálogo em código (`FASES`: Genealogia → Emissão → Análise → Retificação → Emissão retificada → Tradução → Apostilamento → Aguardando protocolo → Protocolado →
// Finalizado) — «Aguardando fechamento» (a antessala, `PHASEKEY_A_INICIAR`) é a antessala, antes de Genealogia, fora da Torre. Só a LEITURA: o Catálogo de Fases (congelado) não muda.
//   • Finalizado é terminal: processo que chega nele deixa de ser ativo, então não é coluna de nada.
//   • Condicional = o cadastro diz condicional (as duas retificações) OU a fase não existe em todos os macros (Tradução juramentada só vale para a Itália e a Alemanha).
//   • Tradução juramentada É FASE do processo (linha própria do catálogo, escopo DOCUMENTO, com 6 passos), não passo dentro de outra.
// PURO neste arquivo; o leitor de servidor está em `torre-fases-leitura.ts`. A «lista de fases» é a ÚNICA: Visão geral, Radar, Processos, Tarefas, Terceiros, Kanban e o
// rodapé «As 5 palavras da Torre» leem dela (vigia: `torre-coerencia-abas.ts`).
// ============================================================================
import { FASES, phaseKeyToFaseCode } from '@/src/lib/process-stage/fases-catalog'
import { PHASEKEY_A_INICIAR } from '@/src/lib/process-stage/fase-pre-contrato'

export const FASE_ANTESSALA = PHASEKEY_A_INICIAR
const ORDEM_DA_ANTESSALA = -1
const ORDEM_DESCONHECIDA = 9000

export interface FaseDaTorre { key: string; label: string; ordem: number; condicional: boolean }

/** A posição REAL da fase no processo (a do catálogo em código). Antessala = -1; fase fora do catálogo = fim da lista. */
export const ordemRealDaFase = (key: string | null | undefined): number => {
  if (!key) return ORDEM_DESCONHECIDA
  if (key === FASE_ANTESSALA) return ORDEM_DA_ANTESSALA
  const code = phaseKeyToFaseCode(key)
  return code != null ? FASES[code].ordem : ORDEM_DESCONHECIDA
}

const ORDEM_DA_TERMINAL = Math.max(...Object.values(FASES).map((f) => f.ordem))
/** Finalizado: o processo que chega nele deixa de ser ativo — não é coluna, botão nem etapa do funil. */
export const ehFaseTerminal = (key: string | null | undefined): boolean => { const code = phaseKeyToFaseCode(key); return code != null && FASES[code].ordem === ORDEM_DA_TERMINAL }

/** Ordena qualquer lista que tenha `key` pela ordem real (estável). */
export const ordenarPelaOrdemReal = <T,>(itens: readonly T[], chave: (i: T) => string | null | undefined): T[] =>
  [...itens].sort((a, b) => ordemRealDaFase(chave(a)) - ordemRealDaFase(chave(b)))

/**
 * A lista única. `catalogo` = as fases ATIVAS do cadastro; `macros` = as chaves de fase de cada Workflow Macro (para saber se uma fase só vale em alguns).
 * Sem a antessala e sem a terminal. PURA.
 */
export function montarFasesDaTorre(
  catalogo: ReadonlyArray<{ phaseKey: string; label: string; conditionalPadrao: boolean }>,
  macros: ReadonlyArray<ReadonlyArray<string>>,
): FaseDaTorre[] {
  const lista = catalogo
    .filter((f) => f.phaseKey !== FASE_ANTESSALA && !ehFaseTerminal(f.phaseKey))
    .map((f): FaseDaTorre => {
      const faltaEmAlgumMacro = macros.length > 0 && macros.some((m) => !m.includes(f.phaseKey))
      return { key: f.phaseKey, label: f.label, ordem: ordemRealDaFase(f.phaseKey), condicional: f.conditionalPadrao || faltaEmAlgumMacro }
    })
  return lista.sort((a, b) => a.ordem - b.ordem || a.key.localeCompare(b.key))
}

/** O texto do rodapé «As 5 palavras da Torre»: o intervalo da lista única (primeira → última). */
export const textoDasFasesNasPalavras = (fases: ReadonlyArray<{ label: string }>): string =>
  fases.length >= 2 ? `etapa do processo (${fases[0].label} → ${fases[fases.length - 1].label})` : 'etapa do processo'
