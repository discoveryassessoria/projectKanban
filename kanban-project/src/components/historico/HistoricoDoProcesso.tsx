// src/components/historico/HistoricoDoProcesso.tsx
// ============================================================================
// HISTÓRICO DO PROCESSO — a linha do tempo de FATOS (protótipo aprovado:
// docs/referencias-torre/Histórico do Processo.html). UM componente, duas casas:
//   • a aba "Histórico" do processo (`ProcessoHistorico`) → /api/processos/{id}/historico
//   • a página do processo na Torre (`TorreProcessoPagina`)  → /api/torre/foco/{id}/historico
// As duas rotas chamam o MESMO serviço; este componente só desenha e filtra o que veio
// (filtros/dia/contadores em `lib/operacional/historico-filtros.ts`, puro e testado).
//
// Regras de tela: hora · quem · o que fez · em qual certidão e de quem · (fase · passo) ·
// Motivo / Justificativa / Efeito · chips · "Ver as N" · "Reabrir certidão" (só com a permissão
// da porta canônica). Dia e hora sempre em America/Sao_Paulo (formatação com fuso explícito).
// ============================================================================
"use client"

import { useMemo, useState } from "react"
import { Download, FileText, RotateCcw, Search } from "lucide-react"
import { useApi } from "@/src/lib/dados"
import { authHeaders, jsonHeaders } from "@/src/lib/financeiro/http"
import type { FatoDoHistorico, FatoItem, LinksDoFato } from "@/lib/operacional/historico-processo"
import { CABECALHO_DA_EXPORTACAO, linhasDaExportacao, nomeDoArquivo } from "@/lib/operacional/historico-exportar"
import {
  FILTROS_LIMPOS, FILTROS_PADRAO, horaSP, montarVisao, queryDosFiltros, ROTULOS_DE_PERIODO,
  type ChipDeFiltro, type FiltrosDoHistorico, type PeriodoDoHistorico,
} from "@/lib/operacional/historico-filtros"

export interface RespostaDoHistorico {
  processo: { id: number; nome: string; codigo: string | null; pais: string | null; familiaId: number | null; faseAtual: string | null }
  geradoEm: string
  fatos: FatoDoHistorico[]
  truncado: boolean
  permissoes: { reabrir: boolean }
}

export interface HistoricoDoProcessoProps {
  processoId: number
  /** A rota do histórico (GET); CSV e PDF usam a mesma base. */
  url: string
  /** Abrir a certidão/tarefa do fato. Sem isto o nome da certidão aparece sem link. */
  onAbrirCertidao?: (links: LinksDoFato) => void
  onAbrirPessoa?: (pessoaId: number) => void
  /** Depois de reabrir uma certidão (o processo mudou). */
  onMudou?: () => void
}

const CAMPO = "h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
const ROTULO_CAMPO = "text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
const BOTAO = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"

/** O chip de categoria do cartão (curto; o nome longo vive no seletor "Tipo de fato"). */
const CHIP_DO_TIPO: Record<FatoDoHistorico["tipo"], string> = {
  PROCESSO: "Processo", FASE: "Fase", ARVORE: "Árvore", CERTIDAO: "Certidão", ATRIBUICAO: "Atribuição", CARTORIO: "Cartório",
  PRAZO: "Prazo", BLOQUEIO: "Bloqueio", COMENTARIO: "Comentário", TAREFA: "Tarefa",
}

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?"

/** Cor do chip por significado (tokens do sistema; nenhuma cor local). */
function classeDoChip(f: FatoDoHistorico): string {
  switch (f.subtipo) {
    case "cancelada": case "nao_exigida": case "exigencia_removida": return "bg-[var(--danger-tile)] text-[var(--danger-text)]"
    case "validada": case "recebida": case "localizada": case "confirmacao_pedido": return "bg-[var(--success-tile)] text-[var(--success-text)]"
    case "reaberta": case "bloqueada": case "exigencia_sem_causa": return "bg-[var(--warning-tile)] text-[var(--warning-text)]"
    case "abertura": case "avanco_fase": case "retorno_fase": case "movimento_fase": case "preparo_fase": case "edicao": return "bg-[var(--info-tile)] text-[var(--info-text)]"
    default: return "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"
  }
}

function Avatar({ f }: { f: FatoDoHistorico }) {
  const humano = f.quem.tipo === "humano"
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold ${humano ? "bg-[var(--action-primary)] text-[var(--action-primary-ink)]" : "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"}`}
      aria-hidden
    >
      {humano ? iniciais(f.quem.nome) : "S"}
    </span>
  )
}

function Frase({ f, onAbrirCertidao, onAbrirPessoa }: { f: FatoDoHistorico; onAbrirCertidao?: HistoricoDoProcessoProps["onAbrirCertidao"]; onAbrirPessoa?: HistoricoDoProcessoProps["onAbrirPessoa"] }) {
  // Fato do Sistema em frase livre: o núcleo já é a frase inteira.
  if (f.verbo === "" || f.objeto == null) {
    const t = f.quem.tipo === "sistema" && f.nucleo.startsWith("Sistema ") ? f.nucleo.slice("Sistema ".length) : f.nucleo
    return <span>{f.quem.tipo === "sistema" ? <b className="font-semibold">Sistema </b> : null}{t}</span>
  }
  const abrir = f.links.tarefaId != null && onAbrirCertidao ? () => onAbrirCertidao(f.links) : f.links.pessoaId != null && f.quantidade > 1 && onAbrirPessoa ? () => onAbrirPessoa(f.links.pessoaId as number) : null
  return (
    <span>
      <b className="font-semibold">{f.quem.nome}</b> {f.verbo}{" "}
      {abrir
        ? <button type="button" onClick={abrir} className="font-semibold text-[var(--accent-text)] underline-offset-2 hover:underline">{f.objeto}</button>
        : <b className="font-semibold">{f.objeto}</b>}
      {f.complemento ? <> {f.complemento}</> : null}
      {f.contexto ? <span className="text-[var(--text-secondary)]"> ({f.contexto})</span> : null}
    </span>
  )
}

function Detalhe({ f }: { f: FatoDoHistorico }) {
  if (!f.motivo && !f.justificativa && !f.efeito) return null
  const cancel = f.subtipo === "cancelada"
  return (
    <div className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-[13px] ${cancel ? "bg-[var(--danger-tile)]/50" : "bg-[var(--surface-secondary)]"}`}>
      {f.motivo && <div><span className="text-[var(--text-secondary)]">Motivo:</span> {f.motivo}</div>}
      {f.justificativa && <div><span className="text-[var(--text-secondary)]">Justificativa:</span> “{f.justificativa}”</div>}
      {f.efeito && <div><span className="text-[var(--text-secondary)]">Efeito:</span> {f.efeito}</div>}
    </div>
  )
}

function Itens({ itens, onAbrirCertidao }: { itens: FatoItem[]; onAbrirCertidao?: HistoricoDoProcessoProps["onAbrirCertidao"] }) {
  return (
    <ul className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2 text-[12.5px]">
      {itens.map((i) => (
        <li key={i.id} className="flex items-start gap-2">
          <span className="w-11 shrink-0 tabular-nums text-[var(--text-secondary)]">{horaSP(i.quando)}</span>
          <span className="min-w-0 flex-1">{i.frase}</span>
          {i.links.tarefaId != null && onAbrirCertidao && (
            <button type="button" onClick={() => onAbrirCertidao(i.links)} className="shrink-0 text-[var(--accent-text)] hover:underline">abrir</button>
          )}
        </li>
      ))}
    </ul>
  )
}

function Cartao({ f, aberto, alternar, pode, onAbrirCertidao, onAbrirPessoa, aoReabrir }: {
  f: FatoDoHistorico; aberto: boolean; alternar: () => void; pode: boolean
  onAbrirCertidao?: HistoricoDoProcessoProps["onAbrirCertidao"]; onAbrirPessoa?: HistoricoDoProcessoProps["onAbrirPessoa"]
  aoReabrir: (tarefaId: number, motivo: string) => Promise<string | null>
}) {
  const [reabrindo, setReabrindo] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const cancel = f.subtipo === "cancelada"

  const confirmar = async () => {
    if (!f.reabrivel) return
    setEnviando(true); setErro(null)
    const e = await aoReabrir(f.reabrivel.tarefaId, motivo.trim())
    setEnviando(false)
    if (e) setErro(e); else { setReabrindo(false); setMotivo("") }
  }

  return (
    <div className={`flex gap-3.5 rounded-xl border bg-[var(--surface-popover)] px-4 py-3 ${cancel ? "border-[var(--danger-tile)] border-l-4 border-l-[var(--danger)]" : "border-[var(--border-default)]"} ${f.automatico ? "opacity-90" : ""}`}>
      <div className="w-12 shrink-0 pt-1 text-[13px] font-semibold tabular-nums">{horaSP(f.quando)}</div>
      <Avatar f={f} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-[14px] leading-snug"><Frase f={f} onAbrirCertidao={onAbrirCertidao} onAbrirPessoa={onAbrirPessoa} /></div>
        <Detalhe f={f} />
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex h-[22px] items-center rounded-md px-2 text-[12px] font-semibold ${classeDoChip(f)}`}>{f.rotuloSubtipo}</span>
          <span className="inline-flex h-[22px] items-center rounded-md bg-[var(--surface-tertiary)] px-2 text-[12px] font-medium text-[var(--text-secondary)]">{CHIP_DO_TIPO[f.tipo]}</span>
          {f.automatico && <span className="inline-flex h-[22px] items-center rounded-md bg-[var(--surface-tertiary)] px-2 text-[12px] font-medium text-[var(--text-secondary)]">automático</span>}
          <span className="ml-auto flex items-center gap-3">
            {f.agrupadoDe.length > 0 && (
              <button type="button" onClick={alternar} className="text-[12px] font-medium text-[var(--accent-text)] hover:underline">
                {aberto ? "Ocultar" : `Ver as ${f.quantidade}`}
              </button>
            )}
            {f.reabrivel && pode && !reabrindo && (
              <button type="button" onClick={() => setReabrindo(true)} className="text-[12px] font-medium text-[var(--accent-text)] hover:underline">Reabrir certidão</button>
            )}
          </span>
        </div>
        {aberto && f.agrupadoDe.length > 0 && <Itens itens={f.agrupadoDe} onAbrirCertidao={onAbrirCertidao} />}
        {reabrindo && f.reabrivel && (
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
            <label className={ROTULO_CAMPO} htmlFor={`motivo-${f.id}`}>Por que reabrir? (fica no histórico)</label>
            <textarea id={`motivo-${f.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={300}
              className="w-full resize-none rounded-lg border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-[13px] outline-none focus:border-[var(--border-focus)]" />
            {erro && <div role="alert" className="text-[12.5px] text-[var(--danger-text)]">{erro}</div>}
            <div className="flex gap-2">
              <button type="button" disabled={enviando || motivo.trim().length < 5} onClick={() => void confirmar()} className={BOTAO}>{enviando ? "Reabrindo…" : "Confirmar reabertura"}</button>
              <button type="button" disabled={enviando} onClick={() => { setReabrindo(false); setErro(null) }} className={BOTAO}>Cancelar</button>
            </div>
            <div className="text-[12px] text-[var(--text-secondary)]">A mesma tarefa volta (o histórico anterior permanece): documento, exigência e etapas reabrem juntos.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Seletor<V extends string | number>({ rotulo, valor, opcoes, aoMudar, id }: {
  rotulo: string; valor: V; opcoes: Array<{ valor: V; rotulo: string; n: number }>; aoMudar: (v: V) => void; id: string
}) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1">
      <label htmlFor={id} className={ROTULO_CAMPO}>{rotulo}</label>
      <select id={id} className={CAMPO} value={String(valor)} onChange={(e) => { const o = opcoes.find((x) => String(x.valor) === e.target.value); if (o) aoMudar(o.valor) }}>
        {opcoes.map((o) => <option key={String(o.valor)} value={String(o.valor)}>{o.rotulo}{o.valor !== "todos" && o.valor !== "todas" ? ` (${o.n})` : ""}</option>)}
      </select>
    </div>
  )
}

export function HistoricoDoProcesso({ processoId, url, onAbrirCertidao, onAbrirPessoa, onMudou }: HistoricoDoProcessoProps) {
  const consulta = useApi<RespostaDoHistorico>(url)
  const dados = consulta.dados
  const [filtros, setFiltros] = useState<FiltrosDoHistorico>(FILTROS_PADRAO)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState<"csv" | "pdf" | null>(null)

  // O "agora" da tela é o instante em que o SERVIDOR montou o histórico — Hoje/Ontem e o período não dependem do relógio do navegador.
  const agora = useMemo(() => (dados ? new Date(dados.geradoEm) : new Date(0)), [dados])
  const visao = useMemo(() => montarVisao(dados?.fatos ?? [], filtros, agora), [dados, filtros, agora])
  const set = <K extends keyof FiltrosDoHistorico>(k: K, v: FiltrosDoHistorico[K]) => setFiltros((f) => ({ ...f, [k]: v }))
  const alternar = (id: string) => setAbertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const limparChip = (c: ChipDeFiltro) => setFiltros((f) => {
    switch (c.chave) {
      case "periodo": return { ...f, periodo: "todo", de: null, ate: null }
      case "busca": return { ...f, busca: "" }
      case "quem": return { ...f, quem: "todos" }
      case "tipo": return { ...f, tipo: "todos" }
      case "pessoa": return { ...f, pessoaId: "todas" }
      case "automaticos": return { ...f, ocultarAutomaticos: false }
    }
  })

  const reabrir = async (tarefaId: number, motivo: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/processos/${processoId}/reabrir-certidao`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ tarefaId, motivo }) })
      const c = await r.json().catch(() => ({}))
      if (!r.ok) return c?.mensagem || c?.error || "Não foi possível reabrir a certidão."
      setAviso("Certidão reaberta — o fato ficou no histórico."); await consulta.recarregar(); onMudou?.()
      return null
    } catch { return "Não foi possível reabrir a certidão." }
  }

  const exportarCsv = async () => {
    setExportando("csv"); setAviso(null)
    try {
      const r = await fetch(`${url}?formato=csv&${queryDosFiltros(filtros).toString()}`, { headers: authHeaders() })
      if (!r.ok) { setAviso("Não foi possível exportar o CSV."); return }
      const blob = await r.blob()
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob)
      a.download = nomeDoArquivo(dados?.processo.nome ?? "processo", "csv", new Date()); a.click(); URL.revokeObjectURL(a.href)
      setAviso(`CSV exportado: ${r.headers.get("X-Historico-Fatos") ?? visao.mostrando} fato(s) do que está filtrado.`)
    } catch { setAviso("Não foi possível exportar o CSV.") } finally { setExportando(null) }
  }

  const exportarPdf = async () => {
    if (!dados) return
    setExportando("pdf"); setAviso(null)
    try {
      const [{ default: JsPdf }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
      const doc = new JsPdf({ orientation: "landscape", unit: "mm", format: "a4" })
      doc.setFontSize(14); doc.text(`Histórico do processo — ${dados.processo.nome}`, 14, 14)
      doc.setFontSize(9)
      doc.text(`${dados.processo.pais ?? ""}${dados.processo.codigo ? ` · ${dados.processo.codigo}` : ""} · ${visao.mostrando} de ${visao.total} fatos · filtros: ${visao.chips.map((c) => c.rotulo).join(", ") || "nenhum"}`, 14, 20)
      const linhas = linhasDaExportacao(visao.visiveis)
      autoTable(doc, {
        startY: 25, head: [[...CABECALHO_DA_EXPORTACAO].filter((_, i) => ![2, 4, 5, 13].includes(i))],
        body: linhas.map((l) => l.filter((_, i) => ![2, 4, 5, 13].includes(i))),
        styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" }, headStyles: { fillColor: [13, 44, 88] },
        columnStyles: { 1: { cellWidth: 30 }, 2: { cellWidth: 95 } },
      })
      doc.save(nomeDoArquivo(dados.processo.nome, "pdf", new Date()))
      await fetch(url, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ formato: "pdf", filtros: queryDosFiltros(filtros).toString(), linhas: linhas.length }) }).catch(() => null)
      setAviso(`PDF exportado: ${linhas.length} fato(s) do que está filtrado.`)
    } catch { setAviso("Não foi possível exportar o PDF.") } finally { setExportando(null) }
  }

  if (consulta.carregando && !dados) return <div className="py-12 text-center text-sm text-[var(--text-muted)]">Carregando o histórico…</div>
  if (consulta.erro && !dados) {
    return (
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-6 text-center text-sm">
        <div className="text-[var(--danger-text)]">{consulta.erro.message}</div>
        <button type="button" className={`${BOTAO} mt-3`} onClick={() => void consulta.recarregar()}>Tentar novamente</button>
      </div>
    )
  }
  if (!dados) return null

  const { rodape } = visao
  return (
    <div className="flex flex-col gap-4 text-[var(--text-primary)] min-h-full" data-processo={processoId}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[18px] font-bold">Histórico do processo</h2>
          <p className="text-[13px] text-[var(--text-secondary)]">Tudo o que aconteceu com esta família: quando, quem, o quê e por quê. Um registro por fato.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={BOTAO} disabled={exportando != null || visao.mostrando === 0} onClick={() => void exportarCsv()}><Download className="h-4 w-4" /> {exportando === "csv" ? "Exportando…" : "Exportar CSV"}</button>
          <button type="button" className={BOTAO} disabled={exportando != null || visao.mostrando === 0} onClick={() => void exportarPdf()}><FileText className="h-4 w-4" /> {exportando === "pdf" ? "Exportando…" : "Exportar PDF"}</button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-3.5">
        <div className="flex min-w-[220px] flex-[2] flex-col gap-1">
          <label htmlFor="hist-busca" className={ROTULO_CAMPO}>Buscar</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input id="hist-busca" className={`${CAMPO} w-full pl-8`} value={filtros.busca} onChange={(e) => set("busca", e.target.value)} placeholder="pessoa, certidão, cartório, motivo…" />
          </div>
        </div>
        <div className="flex min-w-[150px] flex-1 flex-col gap-1">
          <label htmlFor="hist-periodo" className={ROTULO_CAMPO}>Período</label>
          <select id="hist-periodo" className={CAMPO} value={filtros.periodo} onChange={(e) => set("periodo", e.target.value as PeriodoDoHistorico)}>
            {(["7d", "hoje", "30d", "todo", "intervalo"] as const).map((p) => <option key={p} value={p}>{p === "intervalo" ? "Intervalo…" : ROTULOS_DE_PERIODO[p]}</option>)}
          </select>
        </div>
        {filtros.periodo === "intervalo" && (
          <>
            <div className="flex flex-col gap-1"><label htmlFor="hist-de" className={ROTULO_CAMPO}>De</label><input id="hist-de" type="date" className={CAMPO} value={filtros.de ?? ""} onChange={(e) => set("de", e.target.value || null)} /></div>
            <div className="flex flex-col gap-1"><label htmlFor="hist-ate" className={ROTULO_CAMPO}>Até</label><input id="hist-ate" type="date" className={CAMPO} value={filtros.ate ?? ""} onChange={(e) => set("ate", e.target.value || null)} /></div>
          </>
        )}
        <Seletor id="hist-quem" rotulo="Quem" valor={filtros.quem} opcoes={visao.opcoes.quem} aoMudar={(v) => set("quem", v)} />
        <Seletor id="hist-tipo" rotulo="Tipo de fato" valor={filtros.tipo} opcoes={visao.opcoes.tipo} aoMudar={(v) => set("tipo", v)} />
        <Seletor id="hist-pessoa" rotulo="Pessoa da árvore" valor={filtros.pessoaId} opcoes={visao.opcoes.pessoa} aoMudar={(v) => set("pessoaId", v)} />
        <label className="flex h-9 items-center gap-2 whitespace-nowrap px-1 text-[13px]">
          <input type="checkbox" className="h-4 w-4" checked={filtros.ocultarAutomaticos} onChange={(e) => set("ocultarAutomaticos", e.target.checked)} /> Ocultar automáticos
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-[var(--text-secondary)]">Mostrando {visao.mostrando} de {visao.total} fatos{visao.chips.length ? " · filtros:" : ""}</span>
        {visao.chips.map((c) => (
          <span key={c.chave} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 text-[13px] font-medium text-[var(--accent-text)]">
            {c.rotulo}
            <button type="button" aria-label={`Remover o filtro ${c.rotulo}`} onClick={() => limparChip(c)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">✕</button>
          </span>
        ))}
        {visao.automaticosOcultos > 0 && (
          <span className="text-[var(--text-secondary)]">
            · {visao.automaticosOcultos} automático{visao.automaticosOcultos === 1 ? "" : "s"} oculto{visao.automaticosOcultos === 1 ? "" : "s"} ·{" "}
            <button type="button" className="text-[var(--accent-text)] hover:underline" onClick={() => set("ocultarAutomaticos", false)}>mostrar</button>
          </span>
        )}
        {visao.chips.length > 0 && <button type="button" className="ml-1 text-[var(--accent-text)] hover:underline" onClick={() => setFiltros(FILTROS_LIMPOS)}><RotateCcw className="mr-1 inline h-3.5 w-3.5" />Limpar filtros</button>}
      </div>
      {aviso && <div role="status" className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-[13px]">{aviso}</div>}
      {dados.truncado && <div role="status" className="rounded-lg border border-[var(--warning-tile)] bg-[var(--warning-tile)]/40 px-3 py-2 text-[13px]">O histórico é muito grande: só os registros mais recentes de cada fonte foram lidos.</div>}

      <div className="flex flex-col gap-5">
        {visao.dias.length === 0 && (
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] px-5 py-10 text-center text-sm text-[var(--text-secondary)]">
            {dados.fatos.length === 0 ? "Nada aconteceu ainda com este processo." : "Nenhum fato neste recorte."}
            {dados.fatos.length > 0 && <div className="mt-2"><button type="button" className="text-[var(--accent-text)] hover:underline" onClick={() => setFiltros(FILTROS_LIMPOS)}>Limpar filtros</button></div>}
          </div>
        )}
        {visao.dias.map((d) => (
          <section key={d.dia} className="flex flex-col gap-2.5" aria-label={d.rotulo}>
            <div className="flex items-center gap-3">
              <h3 className="text-[13px] font-bold uppercase tracking-wide text-[var(--accent-text)]">{d.rotulo}</h3>
              <span className="h-px flex-1 bg-[var(--border-default)]" />
              <span className="text-[12px] text-[var(--text-secondary)]">{d.fatos.length} fato{d.fatos.length === 1 ? "" : "s"}{d.ocultosAutomaticos > 0 ? ` · ${d.ocultosAutomaticos} oculto${d.ocultosAutomaticos === 1 ? "" : "s"} (automáticos)` : ""}</span>
            </div>
            {d.fatos.map((f) => (
              <Cartao key={f.id} f={f} aberto={abertos.has(f.id)} alternar={() => alternar(f.id)} pode={dados.permissoes.reabrir}
                onAbrirCertidao={onAbrirCertidao} onAbrirPessoa={onAbrirPessoa} aoReabrir={reabrir} />
            ))}
            {d.ocultosAutomaticos > 0 && (
              <div className="flex items-center justify-center gap-2 py-1.5 text-[13px] text-[var(--text-secondary)]">
                <span>{d.ocultosAutomaticos} fato{d.ocultosAutomaticos === 1 ? "" : "s"} automático{d.ocultosAutomaticos === 1 ? "" : "s"} oculto{d.ocultosAutomaticos === 1 ? "" : "s"} ({d.ocultosDescricao})</span>
                <button type="button" className="text-[var(--accent-text)] hover:underline" onClick={() => set("ocultarAutomaticos", false)}>mostrar</button>
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="mt-auto flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--border-default)] pt-3.5 text-[13px] text-[var(--text-secondary)]">
        <div><b className="font-semibold text-[var(--text-primary)]">{rodape.fatosNoPeriodo}</b> fatos no período</div>
        <div><b className="font-semibold text-[var(--text-primary)]">{rodape.pessoasQueAtuaram.length}</b> pessoa{rodape.pessoasQueAtuaram.length === 1 ? "" : "s"} atuaram{rodape.pessoasQueAtuaram.length ? `: ${rodape.pessoasQueAtuaram.join(", ")}` : ""}</div>
        <div><b className="font-semibold text-[var(--text-primary)]">{rodape.cancelamentos}</b> cancelamento{rodape.cancelamentos === 1 ? "" : "s"}</div>
        <div><b className="font-semibold text-[var(--text-primary)]">{rodape.certidoesValidadas}</b> certidões validadas</div>
        <div className="ml-auto">Último fato: {rodape.ultimoFato ?? "—"}</div>
      </div>
    </div>
  )
}
