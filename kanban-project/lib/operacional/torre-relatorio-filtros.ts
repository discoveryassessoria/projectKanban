// lib/operacional/torre-relatorio-filtros.ts
// ============================================================================
// OS FILTROS DO "RELATÓRIO DE CONTROLE" DA TORRE — módulo PURO (tela e teste). Quatro filtros, todos combináveis:
//   Fase      Fase atual (padrão) · Fases anteriores · Todas as fases · uma por fase que o processo já cursou ou cursa (futuras não entram)
//   Linhagem  Todas (padrão) · Só linha reta · Só fora da linha
//   Status    Só ativas (padrão) · Concluídas · Canceladas / não exigidas · Todas   (os nomes da página do processo)
//   Pessoa    Todas (padrão) · uma por requerente/ascendente do processo
// Eles viram `filtros` do motor de Relatórios (domínio Certidões: `ctl_fase`, `ctl_linhagem`, `ctl_status`, `ctl_pessoa`) — a MESMA lista vale
// para a prévia, para o resumo do título e para CSV/Excel/PDF. Ficam na URL da página do processo (`relatorio=1&rel_fase=…`).
// ============================================================================

export const FASE_ATUAL = "atual"
export const FASES_ANTERIORES = "anteriores"
export const TODAS_AS_FASES = "todas"
/** Nenhuma fase casa: o motor ignora filtro com lista vazia (e traria tudo), então a lista "vazia" vai com esta chave. */
export const NENHUMA_FASE = "__nenhuma__"

export type FiltroDeLinhagem = "todas" | "reta" | "fora"
export type FiltroDeStatusDoRelatorio = "ativas" | "concluidas" | "encerradas" | "todas"

export interface FiltrosDoRelatorio {
  /** `atual` · `anteriores` · `todas` · ou a `phaseKey` de uma fase. */
  fase: string
  linhagem: FiltroDeLinhagem
  status: FiltroDeStatusDoRelatorio
  pessoa: number | null
}

export const FILTROS_PADRAO: FiltrosDoRelatorio = { fase: FASE_ATUAL, linhagem: "todas", status: "ativas", pessoa: null }

export interface FaseDoRelatorio { key: string; label: string; estado: "concluida" | "atual" }
export interface PessoaDoRelatorio { id: number; nome: string }
export interface OpcoesDoRelatorio { faseAtualKey: string | null; fases: FaseDoRelatorio[]; pessoas: PessoaDoRelatorio[] }

export const ROTULO_STATUS: Record<FiltroDeStatusDoRelatorio, string> = {
  ativas: "Só ativas", concluidas: "Concluídas", encerradas: "Canceladas / não exigidas", todas: "Todas",
}
export const ROTULO_LINHAGEM: Record<FiltroDeLinhagem, string> = { todas: "Todas as linhagens", reta: "Só linha reta", fora: "Só fora da linha" }

const STATUS_VALIDOS = Object.keys(ROTULO_STATUS) as FiltroDeStatusDoRelatorio[]
const LINHAGENS_VALIDAS = Object.keys(ROTULO_LINHAGEM) as FiltroDeLinhagem[]

// ─── URL ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CHAVES_DA_URL = ["relatorio", "rel_fase", "rel_linhagem", "rel_status", "rel_pessoa"] as const

/** Lê o relatório da URL. Sem filtros na URL: os padrões. Valor inválido cai no padrão (nunca em erro). */
export function lerRelatorioDaUrl(params: URLSearchParams): { aberto: boolean; filtros: FiltrosDoRelatorio } {
  const linhagem = params.get("rel_linhagem") as FiltroDeLinhagem | null
  const status = params.get("rel_status") as FiltroDeStatusDoRelatorio | null
  const pessoa = Number(params.get("rel_pessoa"))
  return {
    aberto: params.get("relatorio") === "1",
    filtros: {
      fase: params.get("rel_fase")?.trim() || FILTROS_PADRAO.fase,
      linhagem: linhagem && LINHAGENS_VALIDAS.includes(linhagem) ? linhagem : FILTROS_PADRAO.linhagem,
      status: status && STATUS_VALIDOS.includes(status) ? status : FILTROS_PADRAO.status,
      pessoa: Number.isInteger(pessoa) && pessoa > 0 ? pessoa : null,
    },
  }
}

/** Devolve os parâmetros com o relatório aberto/fechado e SÓ os filtros que fogem do padrão (URL curta; sem nada = padrões). */
export function escreverRelatorioNaUrl(params: URLSearchParams, estado: { aberto: boolean; filtros: FiltrosDoRelatorio }): URLSearchParams {
  const novo = new URLSearchParams(params)
  for (const k of CHAVES_DA_URL) novo.delete(k)
  if (!estado.aberto) return novo
  novo.set("relatorio", "1")
  const f = estado.filtros
  if (f.fase !== FILTROS_PADRAO.fase) novo.set("rel_fase", f.fase)
  if (f.linhagem !== FILTROS_PADRAO.linhagem) novo.set("rel_linhagem", f.linhagem)
  if (f.status !== FILTROS_PADRAO.status) novo.set("rel_status", f.status)
  if (f.pessoa != null) novo.set("rel_pessoa", String(f.pessoa))
  return novo
}

// ─── DOS FILTROS AO MOTOR ────────────────────────────────────────────────────────────────────────────────────────────────

/** As fases de cada escolha. `null` = sem filtro de fase (Todas as fases). */
export function fasesDoFiltro(fase: string, o: Pick<OpcoesDoRelatorio, "faseAtualKey" | "fases">): { valores: string[]; rotulos: string[] } | null {
  if (fase === TODAS_AS_FASES) return null
  const comRotulo = (fs: FaseDoRelatorio[]) => (fs.length ? { valores: fs.map((f) => f.key), rotulos: fs.map((f) => f.label) } : { valores: [NENHUMA_FASE], rotulos: ["nenhuma"] })
  if (fase === FASE_ATUAL) return comRotulo(o.fases.filter((f) => f.key === o.faseAtualKey))
  if (fase === FASES_ANTERIORES) return comRotulo(o.fases.filter((f) => f.estado === "concluida" && f.key !== o.faseAtualKey))
  const f = o.fases.find((x) => x.key === fase)
  return f ? { valores: [f.key], rotulos: [f.label] } : { valores: [NENHUMA_FASE], rotulos: ["fase fora do caminho do processo"] }
}

type ValorMulti = { tipo: "multi_selecao"; valores: string[]; rotulos?: string[] }
export interface FiltroDoMotor { key: string; valor: ValorMulti | { tipo: "entidade"; id: number; rotulo?: string } }

/** Os `filtros` do motor para este conjunto (só os que restringem; o padrão "Só ativas" restringe). */
export function filtrosParaOMotor(f: FiltrosDoRelatorio, o: OpcoesDoRelatorio): FiltroDoMotor[] {
  const out: FiltroDoMotor[] = []
  const fases = fasesDoFiltro(f.fase, o)
  if (fases) out.push({ key: "ctl_fase", valor: { tipo: "multi_selecao", valores: fases.valores, rotulos: fases.rotulos } })
  if (f.linhagem !== "todas") out.push({ key: "ctl_linhagem", valor: { tipo: "multi_selecao", valores: [f.linhagem], rotulos: [ROTULO_LINHAGEM[f.linhagem].toLowerCase()] } })
  if (f.status !== "todas") out.push({ key: "ctl_status", valor: { tipo: "multi_selecao", valores: [f.status], rotulos: [ROTULO_STATUS[f.status].toLowerCase()] } })
  if (f.pessoa != null) out.push({ key: "ctl_pessoa", valor: { tipo: "entidade", id: f.pessoa, rotulo: o.pessoas.find((p) => p.id === f.pessoa)?.nome ?? `#${f.pessoa}` } })
  return out
}

// ─── O RESUMO DO TÍTULO ──────────────────────────────────────────────────────────────────────────────────────────────────

/** "família Salvarani · Genealogia · linha reta · só ativas · 9 linhas" — todos os filtros ativos + o nº de linhas. */
export function resumoDoRelatorio(a: { familiaNome: string; filtros: FiltrosDoRelatorio; opcoes: OpcoesDoRelatorio; linhas: number | null }): string {
  const f = a.filtros
  const fases = fasesDoFiltro(f.fase, a.opcoes)
  const fase = f.fase === TODAS_AS_FASES ? "todas as fases"
    : f.fase === FASES_ANTERIORES ? "fases anteriores"
    : fases && fases.valores[0] !== NENHUMA_FASE ? fases.rotulos.join(", ") : "nenhuma fase"
  const pessoa = f.pessoa != null ? a.opcoes.pessoas.find((p) => p.id === f.pessoa)?.nome ?? `pessoa #${f.pessoa}` : null
  const n = a.linhas
  return [
    `família ${a.familiaNome}`,
    fase,
    f.linhagem === "todas" ? "todas as linhagens" : f.linhagem === "reta" ? "linha reta" : "fora da linha",
    f.status === "todas" ? "todos os status" : f.status === "ativas" ? "só ativas" : f.status === "concluidas" ? "concluídas" : "canceladas / não exigidas",
    ...(pessoa ? [pessoa] : []),
    n == null ? "…" : `${n} ${n === 1 ? "linha" : "linhas"}`,
  ].join(" · ")
}
