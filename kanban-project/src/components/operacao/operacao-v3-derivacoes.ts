// src/components/operacao/operacao-v3-derivacoes.ts
// ============================================================================
// ETAPA 3 — DERIVAÇÕES PURAS (porte de `renderVals()` do protótipo).
//
// Nenhuma função aqui faz fetch nem toca estado — só transforma
// `LinhaOperacaoV3[]` (já vindo pronto do servidor) em rótulos/classes/grupos
// para a tela desenhar. As contas canônicas (atrasado/vencido/prazo) já vêm
// computadas do servidor (`rotuloDoPrazo`, `acompanhamentoPasso`, etc.) —
// aqui só se formata e agrupa, nunca se recalcula.
// ============================================================================
import type { LinhaOperacaoV3, EstadoTemporalApi } from "./operacao-v3-tipos"

export const fmtData = (iso: string | null): string => {
  if (!iso) return "—"
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** "vencido há N d" / "hoje" / "amanhã" / "em N d" — a partir do EstadoTemporal já computado. */
export const relTxt = (et: EstadoTemporalApi | null): string => {
  if (!et || et.semPrazo) return "—"
  if (et.atrasado) return `vencido há ${et.atrasadoHaDias ?? "?"} d`
  if (et.venceHoje) return "hoje"
  if (et.venceAmanha) return "amanhã"
  if (et.diasParaPrazo != null) return `em ${et.diasParaPrazo} d`
  return "—"
}
/** "vencido há N d · DD/MM" — como o protótipo mostra na coluna Acompanhamento; "—" sozinho quando não há acompanhamento. */
export const acompTxtCompleto = (et: EstadoTemporalApi | null): string =>
  !et || et.semPrazo ? "—" : `${relTxt(et)} · ${fmtData(et.dueAt)}`
export const relCls = (et: EstadoTemporalApi | null): string => {
  if (!et || et.semPrazo) return "opv3-p-gry"
  if (et.atrasado) return "opv3-p-red"
  if (et.venceHoje) return "opv3-p-amb"
  return "opv3-p-gry"
}

/** Rótulo do passo/subtarefa corrente — "X/N · Rótulo" no mesmo padrão do protótipo. */
export function passoLabelDe(l: LinhaOperacaoV3): { label: string; sub: string } {
  if (l.estadoOperacao === "CONCLUIDA") {
    return { label: `Concluída${l.passoAtual ? ` · ${l.passoAtual.total}/${l.passoAtual.total}` : ""}`, sub: "" }
  }
  if (l.origem === "TRANSVERSAL") return { label: "Transversal · ação interna", sub: "não muda a fase" }
  if (l.aIniciar) return { label: "A iniciar (enviar ao cartório)", sub: l.passoCorrente?.label ?? "passo 1 acontece ao iniciar" }
  const rotulo = l.passoCorrente?.label ?? l.etapaAtual ?? "—"
  const posicao = l.passoAtual ? `${l.passoAtual.ordem + 1}/${l.passoAtual.total} · ` : ""
  return { label: `${posicao}${rotulo}`, sub: l.faseMacroKey === "genealogia" ? "fase Genealogia" : "" }
}

/** "Por que aqui" — aproximação honesta: a API não expõe a razão genealógica
 *  fina (linha reta/colateral/requerente) que o protótipo mostra por pessoa;
 *  usa o que já existe (origem/numeroLinhagem/serviço). */
export function porQueAquiDe(l: LinhaOperacaoV3): { texto: string; cls: string } {
  if (l.origem === "TRANSVERSAL") return { texto: "Transversal", cls: "opv3-p-gry" }
  if (l.faseMacroKey === "genealogia") return { texto: "Trava a família", cls: "opv3-p-red" }
  if (l.numeroLinhagem != null) return { texto: `Linha reta${l.numeroLinhagem ? ` · G${l.numeroLinhagem}` : ""}`, cls: "opv3-p-blu" }
  return { texto: l.servico ?? "—", cls: "opv3-p-gry" }
}

export const orgaoTxt = (l: LinhaOperacaoV3): string => l.terceiroNome ?? "não vinculado"
export const orgaoCls = (l: LinhaOperacaoV3): string => (l.terceiroNome ? "opv3-p-gry" : "opv3-p-red")

export const cobrancasTxt = (l: LinhaOperacaoV3): string =>
  l.totalCobrancas === 0 ? "0" : `${l.totalCobrancas}${l.escalada ? " · escalada" : ""}`

export const prazoTarefaCls = (l: LinhaOperacaoV3): string => (l.dataPrazo == null ? "opv3-p-gry" : l.atrasada ? "opv3-p-red" : "opv3-p-blu")

/** O rótulo do botão de ação, por estado — "Iniciar"/"Conferir"/"Continuar"/"Confirmado ✓"/"Recebi ✓"/"Abrir". */
export function acaoDe(l: LinhaOperacaoV3): { label: string; accent: boolean } {
  if (l.aIniciar) return { label: "Iniciar", accent: true }
  if (l.faseMacroKey === "genealogia") return { label: "Continuar", accent: true }
  if (l.estadoOperacao === "FILA" && l.passoAtual && l.passoAtual.ordem + 1 === l.passoAtual.total) return { label: "Conferir", accent: true }
  return { label: "Abrir", accent: false }
}

export function concluirLabelDe(l: LinhaOperacaoV3): string {
  if (l.origem === "TRANSVERSAL") return "Concluída ✓"
  if (l.faseMacroKey === "genealogia") return "Registro localizado"
  const ordem = l.passoAtual ? l.passoAtual.ordem + 1 : null
  if (ordem === 2) return "Confirmado ✓"
  if (ordem === 3) return "Recebi ✓"
  if (l.passoAtual && ordem === l.passoAtual.total) return "Validar ✓"
  return "Concluir ✓"
}

// ── BUSCA (sem acento) ───────────────────────────────────────────────────
export const semAcento = (x: string | null | undefined): string =>
  String(x ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

export function aplicarBusca(linhas: LinhaOperacaoV3[], busca: string): LinhaOperacaoV3[] {
  const bq = semAcento(busca.trim())
  if (!bq) return linhas
  return linhas.filter((l) =>
    semAcento(`${l.familiaNome} ${l.pessoaNome} ${l.titulo} ${l.terceiroNome} ${l.pais} ${l.processoNome}`).includes(bq),
  )
}

export function aplicarVista(linhas: LinhaOperacaoV3[], vista: string): LinhaOperacaoV3[] {
  if (vista === "es") return linhas.filter((l) => l.pais === "Espanha")
  if (vista === "it") return linhas.filter((l) => l.pais === "Itália")
  if (vista === "urg") return linhas.filter((l) => l.acompanhamentoVencido || l.atrasada)
  return linhas
}

// ── AGRUPAMENTO ──────────────────────────────────────────────────────────
export interface GrupoDeLinhas {
  chave: string
  titulo: string
  sub: string
  pill: string
  pillCls: string
  linhas: LinhaOperacaoV3[]
  lote: boolean
}

/** Agrupa (dentro de uma família) por pessoa/órgão/passo — mesma régua do seletor "Por família, depois por". */
export function agruparDentroDaFamilia(linhas: LinhaOperacaoV3[], por: "pessoa" | "orgao" | "passo"): GrupoDeLinhas[] {
  const ordem: string[] = []
  const mapa = new Map<string, LinhaOperacaoV3[]>()
  const chaveDe = (l: LinhaOperacaoV3): string => {
    if (por === "orgao") return l.terceiroNome ?? "não vinculado"
    if (por === "passo") return passoLabelDe(l).label
    return `${l.pessoaNome ?? "—"}|${l.origem === "TRANSVERSAL" ? "tr" : l.faseMacroKey === "genealogia" ? "gen" : "em"}`
  }
  for (const l of linhas) {
    const k = chaveDe(l)
    if (!mapa.has(k)) { mapa.set(k, []); ordem.push(k) }
    mapa.get(k)!.push(l)
  }
  return ordem.map((k) => {
    const rs = mapa.get(k)!
    const f = rs[0]
    let titulo = k, sub = "", pill = "", pillCls = "opv3-p-blu"
    if (por === "pessoa") {
      titulo = f.pessoaNome ?? "—"
      sub = `${rs.length} tarefa(s)`
      pill = f.origem === "TRANSVERSAL" ? "Transversal" : f.faseMacroKey === "genealogia" ? "Fase anterior" : "Emissão documental"
      pillCls = f.origem === "TRANSVERSAL" ? "opv3-p-gry" : f.faseMacroKey === "genealogia" ? "opv3-p-amb" : "opv3-p-blu"
    } else if (por === "orgao") {
      titulo = f.terceiroNome ?? "não vinculado"
      sub = `${rs.length} certidões`
      pill = f.terceiroNome ? "Órgão" : "Sem destino"
      pillCls = f.terceiroNome ? "opv3-p-gry" : "opv3-p-red"
    } else {
      titulo = passoLabelDe(f).label
      sub = `${rs.length} tarefas`
      pill = "Passo"; pillCls = "opv3-p-gry"
    }
    const lote = rs.filter((r) => r.aIniciar).length > 1
    return { chave: k, titulo, sub, pill, pillCls, linhas: rs, lote }
  })
}

export interface FamiliaComGrupos {
  fam: string
  pais: string | null
  linhas: LinhaOperacaoV3[]
}

/** Agrupa por família — usado em Aguardando/Acompanhamento/Feito/Fila (nível externo). */
export function agruparPorFamilia(linhas: LinhaOperacaoV3[]): FamiliaComGrupos[] {
  const ordem: string[] = []
  const mapa = new Map<string, LinhaOperacaoV3[]>()
  for (const l of linhas) {
    const k = l.familiaNome ?? "—"
    if (!mapa.has(k)) { mapa.set(k, []); ordem.push(k) }
    mapa.get(k)!.push(l)
  }
  return ordem.map((k) => ({ fam: k, pais: mapa.get(k)![0].pais, linhas: mapa.get(k)! }))
}

/** Agrupa por órgão — "Aguardando: Agrupar por Órgão (cobrar juntos)". */
export function agruparPorOrgao(linhas: LinhaOperacaoV3[]): FamiliaComGrupos[] {
  const ordem: string[] = []
  const mapa = new Map<string, LinhaOperacaoV3[]>()
  for (const l of linhas) {
    const k = l.terceiroNome ?? "não vinculado"
    if (!mapa.has(k)) { mapa.set(k, []); ordem.push(k) }
    mapa.get(k)!.push(l)
  }
  return ordem.map((k) => ({ fam: k, pais: null, linhas: mapa.get(k)! }))
}
