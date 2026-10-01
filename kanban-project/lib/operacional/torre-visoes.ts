// lib/operacional/torre-visoes.ts — a validação das VISÕES SALVAS da Torre (Bloco J4). Puro: valores fora da lista
// fechada são recusados/normalizados; a visão guarda a PERGUNTA, nunca o resultado. Os filtros da barra vão em `filtros` (lib/operacional/torre-filtros.ts). Tabela: `RelatorioVisao` (sem migration).
import { normalizarFiltros } from './torre-filtros'

export const DOMINIO_VISAO_TORRE = 'torre-tarefas'
// 'bloqueadas' entrou na Torre nova (01/10/2026); 'acompvenc' continua válida (visão salva antiga), mas a tela já não a mostra.
export const VISOES_TORRE = ['todas', 'minhas', 'vencidas', 'semdono', 'aguard', 'acompvenc', 'cobranca', 'bloqueadas', 'feito'] as const
export const DENTRO_TORRE = ['none', 'pessoa', 'orgao', 'passo'] as const
export const AGRUPAR_TORRE = ['fam', 'resp', 'org', 'fase', 'none'] as const
export const KPIS_TORRE = ['venc', 'v7', 'semdono', 'aguard', 'cob', 'esc', 'risco'] as const

export function limparSpec(b: Record<string, unknown>) {
  const em = <T extends readonly string[]>(v: unknown, lista: T, padrao: T[number] | null): T[number] | null => (typeof v === 'string' && (lista as readonly string[]).includes(v) ? v : padrao)
  return {
    visao: em(b.visao, VISOES_TORRE, 'todas'),
    agrupar: em(b.agrupar, AGRUPAR_TORRE, 'fam'),
    dentro: em(b.dentro, DENTRO_TORRE, 'none'),
    kpi: em(b.kpi, KPIS_TORRE, null),
    pais: typeof b.pais === 'string' && b.pais.trim() ? b.pais.trim().slice(0, 40) : null,
    busca: typeof b.busca === 'string' && b.busca.trim() ? b.busca.trim().slice(0, 120) : null,
    // A barra de filtros da aba Tarefas (Seção 3): o ÚNICO validador é `normalizarFiltros` (lista fechada de chaves; valor fora
    // da lista é descartado). Visão salva ANTES da barra não traz `filtros` — vira "nenhum filtro", sem quebrar.
    filtros: normalizarFiltros(b.filtros && typeof b.filtros === 'object' && !Array.isArray(b.filtros) ? (b.filtros as Record<string, unknown>) : null),
  }
}

