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

/** Rótulo do passo/subtarefa corrente — "X/N · Rótulo" no mesmo padrão do protótipo.
 *  Genealogia não tem subtarefa (`passoCorrente` sempre `null`) — o rótulo real do
 *  passo vem de `etapaAtual` (achado real, mandato "Operação/Antão", correção
 *  pós-conferência 29/09/2026: toda tarefa "a iniciar" de Genealogia mostrava o
 *  texto fixo da Emissão, "A iniciar (enviar ao cartório)", porque este fallback
 *  nunca olhava `etapaAtual` — o nome real do passo, "Localizar registro", ficava
 *  sem uso nenhum aqui). */
export function passoLabelDe(l: LinhaOperacaoV3): { label: string; sub: string } {
  if (l.estadoOperacao === "CONCLUIDA") {
    return { label: `Concluída${l.passoAtual ? ` · ${l.passoAtual.total}/${l.passoAtual.total}` : ""}`, sub: "" }
  }
  if (l.origem === "TRANSVERSAL") return { label: "Transversal · ação interna", sub: "não muda a fase" }
  const rotulo = l.passoCorrente?.label ?? l.etapaAtual ?? "—"
  if (l.aIniciar) {
    const label = l.faseMacroKey === "genealogia" ? `A iniciar · ${rotulo}` : "A iniciar (enviar ao cartório)"
    return { label, sub: l.faseMacroKey === "genealogia" ? "fase Genealogia" : (l.passoCorrente?.label ?? "passo 1 acontece ao iniciar") }
  }
  const posicao = l.passoAtual ? `${l.passoAtual.ordem + 1}/${l.passoAtual.total} · ` : ""
  return { label: `${posicao}${rotulo}`, sub: l.faseMacroKey === "genealogia" ? "fase Genealogia" : "" }
}

/** A FASE da tarefa — coluna "Fase" (renomeada de "Por que aqui", mandato
 *  "Operação/Antão", correção pós-conferência 29/09/2026) e o selo da linha na
 *  agrupação por pessoa. Informação NEUTRA por padrão (nunca vermelho): o
 *  vermelho fica reservado para "Fase anterior", quando a tarefa É de uma fase
 *  já passada do processo — a única situação que é alerta de verdade.
 *  "Fase atual: <fase>"/"· <país>" saíram daqui: aparecem UMA vez, no
 *  cabeçalho da família (achado real, mandato acima: repetiam em toda linha
 *  de Genealogia, e "· Espanha" — nacionalidade do PROCESSO, não do
 *  documento — aparecia até na certidão de quem nasceu no Brasil). */
export function faseLabelDe(l: LinhaOperacaoV3): { texto: string; cls: string } {
  if (l.origem === "TRANSVERSAL") return { texto: "Transversal", cls: "opv3-p-gry" }
  if (l.faseAnteriorAFaseAtual) return { texto: "Fase anterior", cls: "opv3-p-red" }
  return { texto: l.faseAtualDoProcessoLabel ?? (l.faseMacroKey === "genealogia" ? "Genealogia" : "Emissão documental"), cls: "opv3-p-gry" }
}

/** Só o TIPO do documento ("Certidão de Nascimento") — sem "- Inteiro Teor" e
 *  sem o nome da pessoa (que já tem coluna própria). Mandato "Operação/Antão",
 *  29/09/2026: `t.titulo` vem pronto do servidor como
 *  "{Tipo} - Inteiro Teor · {Pessoa}" (ver `nomeDaTarefa`) — "Inteiro Teor" é
 *  jargão de cartório, não informação que falta aqui, e a pessoa duplicava a
 *  coluna ao lado. */
export function docTipoTxt(l: LinhaOperacaoV3): string {
  const semPessoa = l.titulo.split(" · ")[0]
  return semPessoa.replace(/\s*-\s*Inteiro Teor\s*$/i, "").trim()
}

/** Na Genealogia, sem órgão vinculado é o TRABALHO em curso (é isso que
 *  "Localizar registro" descobre), nunca falso alarme — "a definir", neutro.
 *  Bloqueio de verdade (vermelho) fica só na Emissão Documental, onde o órgão
 *  já devia estar resolvido antes de enviar o requerimento (mandato
 *  "Operação/Antão", correção pós-conferência 29/09/2026). */
export const orgaoTxt = (l: LinhaOperacaoV3): string =>
  l.terceiroNome ?? (l.documentoId == null ? "—" : l.faseMacroKey === "genealogia" ? "a definir" : "não vinculado")
export const orgaoCls = (l: LinhaOperacaoV3): string =>
  l.terceiroNome || l.documentoId == null ? "opv3-p-gry" : l.faseMacroKey === "genealogia" ? "opv3-p-gry" : "opv3-p-red"

/** "SEM ÓRGÃO EMISSOR" — a UMA definição do card do radar, do aviso "Vincular órgão nas N" e da lista que o
 *  card abre (número = lista). Só conta TAREFA DE DOCUMENTO (tem `documentoId`) que precisa de órgão: a tarefa
 *  de gestor ("Atribuir tarefas — <família>"), manual ou administrativa não tem documento nem cartório por
 *  natureza, e nunca poderia ser "vinculada" a um órgão (achado real 30/09/2026: #3980 e #3928 entravam na
 *  contagem). Genealogia fica de fora: sem órgão é o trabalho em curso (descobrir ONDE registrar). */
export const precisaDeOrgaoEmissor = (l: Pick<LinhaOperacaoV3, "documentoId" | "terceiroNome" | "faseMacroKey">): boolean =>
  l.documentoId != null && !l.terceiroNome && l.faseMacroKey !== "genealogia"

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

/** NASCIMENTO → ÓBITO → CASAMENTO → (sem categoria) — a ordem dentro do grupo
 *  da pessoa (mandato "Operação/Antão", correção pós-conferência 29/09/2026:
 *  "certidão de casamento no grupo da pessoa da linha reta, APÓS nascimento e
 *  óbito"). */
const ORDEM_CATEGORIA: Record<string, number> = { NASCIMENTO: 0, OBITO: 1, CASAMENTO: 2 }
const ordemCategoria = (l: LinhaOperacaoV3): number => (l.categoriaDoc ? ORDEM_CATEGORIA[l.categoriaDoc] ?? 3 : 3)

/** Agrupa (dentro de uma família) por pessoa/órgão/passo — mesma régua do seletor "Por família, depois por".
 *  ORDENADO por G1→Gn (`numeroLinhagem` crescente — mandato "Operação/Antão",
 *  29/09/2026): quem não tem número calculado (ainda) vai ao fim, nunca some.
 *
 *  CASAMENTO ENTRA NO GRUPO DA PESSOA (correção pós-conferência, 29/09/2026):
 *  `pessoaId`/`pessoaNome` de uma tarefa de União já são os da pessoa da
 *  linha reta (`tarefa-projecoes.ts::projetar`) — agrupar por `pessoaId` funde
 *  a certidão de casamento no MESMO grupo do nascimento/óbito dessa pessoa,
 *  nunca um grupo "Fulano e Fulana" à parte. */
export function agruparDentroDaFamilia(linhasEntrada: LinhaOperacaoV3[], por: "pessoa" | "orgao" | "passo"): GrupoDeLinhas[] {
  const linhas = [...linhasEntrada].sort((a, b) => (a.numeroLinhagem ?? Infinity) - (b.numeroLinhagem ?? Infinity))
  const ordem: string[] = []
  const mapa = new Map<string, LinhaOperacaoV3[]>()
  const chaveDe = (l: LinhaOperacaoV3): string => {
    if (por === "orgao") return l.terceiroNome ?? "não vinculado"
    if (por === "passo") return passoLabelDe(l).label
    return `${l.pessoaId ?? l.pessoaNome ?? "—"}|${l.origem === "TRANSVERSAL" ? "tr" : l.faseMacroKey === "genealogia" ? "gen" : "em"}`
  }
  for (const l of linhas) {
    const k = chaveDe(l)
    if (!mapa.has(k)) { mapa.set(k, []); ordem.push(k) }
    mapa.get(k)!.push(l)
  }
  return ordem.map((k) => {
    const rsBrutas = mapa.get(k)!
    const rs = por === "pessoa" ? [...rsBrutas].sort((a, b) => ordemCategoria(a) - ordemCategoria(b)) : rsBrutas
    const f = rs[0]
    let titulo = k, sub = "", pill = "", pillCls = "opv3-p-blu"
    if (por === "pessoa") {
      titulo = f.pessoaNome ?? f.casalNomes ?? "—"
      sub = `${rs.length} tarefa(s)`
      // Selo "FASE" do grupo — mesma régua neutra da coluna por linha (`faseLabelDe`,
      // item 17 do mandato "Operação/Antão"): "Fase atual: X" saiu daqui também
      // ("não por pessoa nem por linha", correção pós-conferência 29/09/2026).
      const fl = faseLabelDe(f)
      pill = fl.texto; pillCls = fl.cls
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
    // "MESMO REQUERIMENTO" só quando o órgão vinculado é o MESMO em todas as
    // "a iniciar" do grupo — achado real, mandato acima: nascimento (Espanha)
    // e óbito (Brasil) da mesma pessoa nunca são o mesmo requerimento, mesmo
    // as duas "a iniciar" juntas.
    const aIniciarDoGrupo = rs.filter((r) => r.aIniciar)
    const orgaosDoGrupo = new Set(aIniciarDoGrupo.map((r) => r.terceiroNome ?? null))
    const lote = aIniciarDoGrupo.length > 1 && orgaosDoGrupo.size === 1 && aIniciarDoGrupo[0].terceiroNome != null
    return { chave: k, titulo, sub, pill, pillCls, linhas: rs, lote }
  })
}

export interface FamiliaComGrupos {
  fam: string
  pais: string | null
  /** Fase atual do processo — para o cabeçalho mostrar "Fase atual: X" UMA vez (item 5 do mandato "Operação/Antão"). `null` sem fase corrente. */
  faseAtualLabel: string | null
  linhas: LinhaOperacaoV3[]
}

/** Agrupa por família — usado em Aguardando/Acompanhamento/Feito/Fila (nível externo).
 *  Sem `Familia` cadastrada (`familiaNome` nulo), cai no NOME DO PROCESSO —
 *  nunca no país (achado real, mandato "Operação/Antão", correção
 *  pós-conferência 29/09/2026: processo 675/Antão sem `Familia` vinculada
 *  mostrava "—" no lugar do nome e o país ("Espanha", a nacionalidade
 *  buscada) sobrava como se fosse o rótulo da família). */
export function agruparPorFamilia(linhas: LinhaOperacaoV3[]): FamiliaComGrupos[] {
  const ordem: string[] = []
  const mapa = new Map<string, LinhaOperacaoV3[]>()
  for (const l of linhas) {
    const k = l.familiaNome ?? l.processoNome ?? "—"
    if (!mapa.has(k)) { mapa.set(k, []); ordem.push(k) }
    mapa.get(k)!.push(l)
  }
  return ordem.map((k) => {
    const rs = mapa.get(k)!
    return { fam: k, pais: rs[0].pais, faseAtualLabel: rs[0].faseAtualDoProcessoLabel, linhas: rs }
  })
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
  return ordem.map((k) => ({ fam: k, pais: null, faseAtualLabel: null, linhas: mapa.get(k)! }))
}
