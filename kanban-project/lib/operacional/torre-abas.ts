// lib/operacional/torre-abas.ts
// ============================================================================
// AS ABAS DA TORRE — Torre nova, Etapa A (01/10/2026). PURO: a tela (`Torre.tsx`) e o teste leem a MESMA lista.
//
// Oito abas (as sete do protótipo + "Minha operação", 06/10/2026, logo depois de Tarefas):
//   Visão geral · Precisa de você · Radar · Processos · Tarefas · Minha operação · Equipe · Terceiros
// O Processo (detalhe) NÃO é aba: é a página `/torre/processo/[id]`.
//
// CONTRATO DE URL — `?aba=` com ids ESTÁVEIS: visao · precisa · radar · processos · tarefas · minha · equipe · terceiros.
// Sem `?aba=` (ou valor desconhecido) a Torre abre na Visão geral. Os valores ANTIGOS (precisa, radar, tarefas, equipe,
// processos, terceiros) continuam todos válidos — links antigos (sino, avisos gravados, favoritos) seguem funcionando.
// `?aba=regras|integridade|auditoria` não é aba da Torre: redireciona para o Gerenciamento (`destinoDaAbaAntigaDaTorre`).
// ============================================================================

export type Aba = 'visao' | 'precisa' | 'radar' | 'processos' | 'tarefas' | 'minha' | 'equipe' | 'terceiros'

/** As abas, na ordem, com o rótulo oficial. */
export const ABAS_DA_TORRE: Array<[Aba, string]> = [
  ['visao', 'Visão geral'], ['precisa', 'Precisa de você'], ['radar', 'Radar'], ['processos', 'Processos'],
  ['tarefas', 'Tarefas'], ['minha', 'Minha operação'], ['equipe', 'Equipe'], ['terceiros', 'Terceiros'],
]

/** A aba em que a Torre abre quando a URL não pede outra. */
export const ABA_INICIAL: Aba = 'visao'

/** Os ids de aba válidos em `?aba=`. */
export const IDS_DAS_ABAS: readonly Aba[] = ABAS_DA_TORRE.map(([id]) => id)

/** Os valores de `?aba=` que existiam ANTES da Visão geral — todos continuam válidos (compatibilidade de links). */
export const IDS_ANTIGOS_DAS_ABAS: readonly Aba[] = ['precisa', 'radar', 'tarefas', 'equipe', 'processos', 'terceiros']

export const ehAbaDaTorre = (v: string | null | undefined): v is Aba => !!v && (IDS_DAS_ABAS as readonly string[]).includes(v)

/** O `?aba=` → a aba (valor desconhecido ou ausente = a inicial). */
export const abaDaUrl = (v: string | null | undefined): Aba => (ehAbaDaTorre(v) ? v : ABA_INICIAL)

/** Rótulo oficial da aba. */
export const rotuloDaAba = (aba: Aba): string => ABAS_DA_TORRE.find(([id]) => id === aba)![1]
