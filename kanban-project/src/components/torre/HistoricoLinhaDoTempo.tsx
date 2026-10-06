"use client"
// src/components/torre/HistoricoLinhaDoTempo.tsx — o "Histórico completo" da página do processo: a FONTE DA VERDADE do processo, como linha do tempo
// compacta e SÓ LEITURA. Uma linha por fato (sem cartão, sem avatar, sem chip); lote = um fato com "ver as N"; antes → depois; marco de fase
// destacado; automáticos numa linha cinza por dia; dias com contagem; resumo no topo; "novo desde a última visita". Busca sempre visível; o resto
// atrás de "Filtrar (N)". Exporta CSV e PDF (do que está filtrado) e o PDF "para o cliente". Nenhuma ação que altere dado mora aqui.
import { useEffect, useMemo, useState } from "react"
import { api, erroDe } from "./torre-base"
import { authHeaders, jsonHeaders } from "@/src/lib/financeiro/http"
import { montarVisao, queryDosFiltros, ROTULOS_DE_PERIODO, type PeriodoDoHistorico } from "@/lib/operacional/historico-filtros"
import { nomeDoArquivo } from "@/lib/operacional/historico-exportar"
import type { FatoDoHistorico } from "@/lib/operacional/historico-processo"
import {
  FILTROS_PADRAO_DA_LINHA, blocosDoPdf, cabecalhoDoCliente, filtrosAtivos, linhasDoCliente, montarLinhaDoTempo, passaNaLinhaDoTempo,
  type CertidaoDoFiltro, type FiltrosDaLinhaDoTempo, type LinhaDoTempo,
} from "@/lib/operacional/historico-linha-do-tempo"
import "./historico-linha.css"

interface Resposta {
  processo: { id: number; nome: string; codigo: string | null; pais: string | null; familiaId: number | null; familiaNome: string | null; faseAtual: string | null }
  geradoEm: string
  fatos: FatoDoHistorico[]
  truncado: boolean
  ultimaVisita: string | null
}

function Linha({ l, aberta, alternar }: { l: LinhaDoTempo; aberta: boolean; alternar: () => void }) {
  const temDetalhe = l.itens.length > 0 || l.detalhe.certidoes.length > 0 || !!l.detalhe.efeito || l.detalhe.campos.length > 0 || !!l.detalhe.justificativa
  const classe = `thl-linha ${l.marco ? "marco" : ""} ${l.novo ? "novo" : ""}`
  const miolo = (
    <>
      <span className="thl-hora">{l.hora}</span>
      <span className="thl-txt">
        {l.novo && <span className="thl-novo" title="Novo desde a sua última visita" aria-label="novo" />}
        {l.marco ? <b>{l.texto}</b> : <><b>{l.quem}</b> · {l.texto}</>}
        {l.marco && l.quem !== "Sistema" ? <span className="thl-fraco"> · {l.quem}</span> : null}
        {l.contexto ? <span className="thl-fraco"> · {l.contexto}</span> : null}
        {l.mudanca ? <span className="thl-muda"> · {l.mudanca}</span> : null}
        {l.motivo ? <span className="thl-fraco"> · {l.motivo}</span> : null}
        {l.itens.length > 0 && <span className="thl-ver">{aberta ? "ocultar" : `ver as ${l.quantidade}`}</span>}
      </span>
    </>
  )
  return (
    <>
      {temDetalhe
        ? <button type="button" className={classe} aria-expanded={aberta} onClick={alternar}>{miolo}</button>
        : <div className={classe}>{miolo}</div>}
      {aberta && temDetalhe && (
        <div className="thl-detalhe">
          {l.detalhe.certidoes.length > 0 && l.itens.length === 0 && <div>Certidão: {l.detalhe.certidoes.join("; ")}</div>}
          {l.detalhe.campos.length > 0 && <div>Alterado: {l.detalhe.campos.join(" · ")}</div>}
          {l.detalhe.efeito && <div>Efeito: {l.detalhe.efeito}</div>}
          {l.detalhe.justificativa && <div>Justificativa: “{l.detalhe.justificativa}”</div>}
          {l.itens.length > 0 && (
            <ul aria-label={`As ${l.quantidade} do lote`}>
              {l.itens.map((i, k) => <li key={k}>{i.hora} · {[i.certidao, i.pessoa].filter(Boolean).join(" · ") || i.frase}{i.mudanca ? ` · ${i.mudanca}` : ""}</li>)}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

export function HistoricoLinhaDoTempo({ processoId, url, certidaoInicial }: { processoId: number; url: string; certidaoInicial?: CertidaoDoFiltro | null }) {
  const [dados, setDados] = useState<Resposta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // A visita anterior FICA FIXA enquanto a janela está aberta (o que é "novo" não some no meio da leitura); a nova visita é gravada logo depois.
  const [visitaAnterior, setVisitaAnterior] = useState<string | null>(null)
  const [filtros, setFiltros] = useState<FiltrosDaLinhaDoTempo>({ ...FILTROS_PADRAO_DA_LINHA, certidao: certidaoInicial ?? null })
  const [painel, setPainel] = useState(false)
  const [abertas, setAbertas] = useState<Set<string>>(new Set())
  const [diasComAuto, setDiasComAuto] = useState<Set<string>>(new Set())
  const [aviso, setAviso] = useState<string | null>(null)
  const [exportando, setExportando] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void api<Resposta>(`${url}?visao=linha`).then((r) => {
      if (!vivo) return
      if (r.ok) {
        setDados(r.data); setVisitaAnterior(r.data.ultimaVisita)
        void api(url, "POST", { visita: true })
      } else setErro(erroDe(r.data, "Não foi possível carregar o histórico."))
    })
    return () => { vivo = false }
  }, [url])

  const agora = useMemo(() => (dados ? new Date(dados.geradoEm) : new Date(0)), [dados])
  const visao = useMemo(() => montarLinhaDoTempo(dados?.fatos ?? [], filtros, agora, visitaAnterior), [dados, filtros, agora, visitaAnterior])
  const opcoes = useMemo(() => montarVisao(dados?.fatos ?? [], filtros, agora).opcoes, [dados, filtros, agora])
  const set = <K extends keyof FiltrosDaLinhaDoTempo>(k: K, v: FiltrosDaLinhaDoTempo[K]) => setFiltros((f) => ({ ...f, [k]: v }))
  const alternar = (id: string) => setAbertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const alternarDia = (dia: string) => setDiasComAuto((s) => { const n = new Set(s); if (n.has(dia)) n.delete(dia); else n.add(dia); return n })
  const nFiltros = filtrosAtivos(filtros)

  const fatosFiltrados = useMemo(() => (dados?.fatos ?? []).filter((f) => passaNaLinhaDoTempo(f, filtros, agora)), [dados, filtros, agora])

  const parametrosDoFiltro = () => {
    const q = queryDosFiltros(filtros)
    q.set("visao", "linha")
    if (filtros.certidao?.documentoId != null) q.set("certidaoDoc", String(filtros.certidao.documentoId))
    else if (filtros.certidao?.tarefaId != null) q.set("certidaoTarefa", String(filtros.certidao.tarefaId))
    return q
  }

  const exportarCsv = async () => {
    setExportando("csv"); setAviso(null)
    try {
      const q = parametrosDoFiltro(); q.set("formato", "csv")
      const r = await fetch(`${url}?${q.toString()}`, { headers: authHeaders() })
      if (!r.ok) { setAviso("Não foi possível exportar o CSV."); return }
      const blob = await r.blob()
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob)
      a.download = nomeDoArquivo(dados?.processo.nome ?? "processo", "csv", new Date()); a.click(); URL.revokeObjectURL(a.href)
      setAviso(`CSV exportado: ${r.headers.get("X-Historico-Fatos") ?? fatosFiltrados.length} fato(s) do que está filtrado.`)
    } catch { setAviso("Não foi possível exportar o CSV.") } finally { setExportando(null) }
  }

  const exportarPdf = async (paraCliente: boolean) => {
    if (!dados) return
    setExportando(paraCliente ? "cliente" : "pdf"); setAviso(null)
    try {
      const [{ default: JsPdf }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
      const doc = new JsPdf({ orientation: "portrait", unit: "mm", format: "a4" })
      let linhas = 0
      if (paraCliente) {
        // Só andamento: nada de prioridade, atribuição, cancelamento interno, motivo nem nome da equipe — e SEM os filtros da tela (é a posição do processo).
        const cab = cabecalhoDoCliente({ familiaNome: dados.processo.familiaNome, faseAtual: dados.processo.faseAtual, geradoEm: agora })
        doc.setFontSize(15); doc.text(cab.titulo, 14, 16)
        doc.setFontSize(10); doc.text(cab.subtitulo, 14, 23)
        const itens = linhasDoCliente(dados.fatos)
        linhas = itens.length
        const corpo: Array<Array<string | { content: string; colSpan: number; styles: Record<string, unknown> }>> = []
        let dia = ""
        for (const i of itens) {
          if (i.dia !== dia) { dia = i.dia; corpo.push([{ content: i.dia.split("-").reverse().join("/"), colSpan: 2, styles: { fontStyle: "bold", fillColor: [236, 242, 249] } }]) }
          corpo.push([i.dia.split("-").reverse().slice(0, 2).join("/"), i.frase])
        }
        autoTable(doc, { startY: 29, head: [["Data", "Andamento"]], body: corpo, styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [13, 44, 88] }, columnStyles: { 0: { cellWidth: 22 } } })
        doc.save(nomeDoArquivo(`${dados.processo.familiaNome ?? dados.processo.nome}-andamento`, "pdf", new Date()))
      } else {
        doc.setFontSize(14); doc.text(`Histórico do processo — ${dados.processo.nome}`, 14, 14)
        doc.setFontSize(9); doc.text(visao.resumo.texto, 14, 20)
        const blocos = blocosDoPdf(visao)
        linhas = blocos.filter((b) => b.tipo === "linha").length
        autoTable(doc, {
          startY: 25, head: [["Hora", "Fato"]],
          body: blocos.map((b) => (b.tipo === "dia" ? [{ content: b.texto, colSpan: 2, styles: { fontStyle: "bold", fillColor: [236, 242, 249] } }] : [b.hora, b.texto])),
          styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak" }, headStyles: { fillColor: [13, 44, 88] }, columnStyles: { 0: { cellWidth: 14 } },
        })
        doc.save(nomeDoArquivo(dados.processo.nome, "pdf", new Date()))
      }
      await fetch(url, { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ formato: paraCliente ? "pdf-cliente" : "pdf", filtros: paraCliente ? "para o cliente" : queryDosFiltros(filtros).toString(), linhas }) }).catch(() => null)
      setAviso(paraCliente ? `PDF para o cliente: ${linhas} fato(s) de andamento.` : `PDF exportado: ${linhas} fato(s) do que está filtrado.`)
    } catch { setAviso("Não foi possível exportar o PDF.") } finally { setExportando(null) }
  }

  if (erro && !dados) return <div role="alert" className="thl-vazio">{erro}</div>
  if (!dados) return <div className="thl-vazio">Carregando o histórico…</div>

  return (
    <div className="thl" data-processo={processoId}>
      <div className="thl-barra">
        <input className="thl-busca" type="search" aria-label="Buscar no histórico" placeholder="Buscar: pessoa, certidão, cartório, motivo…" value={filtros.busca} onChange={(e) => set("busca", e.target.value)} />
        <button type="button" className="thl-btn" aria-expanded={painel} onClick={() => setPainel((p) => !p)}>Filtrar{nFiltros > 0 ? ` (${nFiltros})` : ""}</button>
        <button type="button" className="thl-btn" disabled={!!exportando || fatosFiltrados.length === 0} onClick={() => void exportarCsv()}>{exportando === "csv" ? "Exportando…" : "Exportar CSV"}</button>
        <button type="button" className="thl-btn" disabled={!!exportando || fatosFiltrados.length === 0} onClick={() => void exportarPdf(false)}>{exportando === "pdf" ? "Exportando…" : "Exportar PDF"}</button>
        <button type="button" className="thl-btn" disabled={!!exportando} onClick={() => void exportarPdf(true)} title="Só o andamento: abertura, avanço de fase, registro localizado, certidão pedida, recebida, validada, apostilada, traduzida e protocolo. Sem dados internos.">{exportando === "cliente" ? "Gerando…" : "PDF para o cliente"}</button>
      </div>

      <div className="thl-resumo" data-resumo-do-historico>{visao.resumo.texto}</div>

      {painel && (
        <div className="thl-filtros" role="group" aria-label="Filtros do histórico">
          <label>Período
            <select value={filtros.periodo} onChange={(e) => set("periodo", e.target.value as PeriodoDoHistorico)}>
              {(["todo", "hoje", "7d", "30d", "intervalo"] as const).map((p) => <option key={p} value={p}>{p === "intervalo" ? "Intervalo…" : ROTULOS_DE_PERIODO[p]}</option>)}
            </select>
          </label>
          {filtros.periodo === "intervalo" && (
            <>
              <label>De<input type="date" value={filtros.de ?? ""} onChange={(e) => set("de", e.target.value || null)} /></label>
              <label>Até<input type="date" value={filtros.ate ?? ""} onChange={(e) => set("ate", e.target.value || null)} /></label>
            </>
          )}
          <label>Quem
            <select value={filtros.quem} onChange={(e) => set("quem", e.target.value)}>
              {opcoes.quem.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}{o.valor !== "todos" ? ` (${o.n})` : ""}</option>)}
            </select>
          </label>
          <label>Tipo de fato
            <select value={filtros.tipo} onChange={(e) => set("tipo", e.target.value as FiltrosDaLinhaDoTempo["tipo"])}>
              {opcoes.tipo.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}{o.valor !== "todos" ? ` (${o.n})` : ""}</option>)}
            </select>
          </label>
          <label>Pessoa da árvore
            <select value={String(filtros.pessoaId)} onChange={(e) => set("pessoaId", e.target.value === "todas" ? "todas" : Number(e.target.value))}>
              {opcoes.pessoa.map((o) => <option key={String(o.valor)} value={String(o.valor)}>{o.rotulo}{o.valor !== "todas" ? ` (${o.n})` : ""}</option>)}
            </select>
          </label>
          <label className="thl-chk"><input type="checkbox" checked={filtros.ocultarAutomaticos} onChange={(e) => set("ocultarAutomaticos", e.target.checked)} /> Ocultar fatos automáticos</label>
          {nFiltros > 0 && <button type="button" className="thl-btn" onClick={() => setFiltros({ ...FILTROS_PADRAO_DA_LINHA })}>Limpar filtros</button>}
        </div>
      )}
      {filtros.certidao && (
        <div><span className="thl-chip">Só a certidão: {filtros.certidao.rotulo || "selecionada"} <button type="button" aria-label="Remover o filtro da certidão" onClick={() => set("certidao", null)}>✕</button></span></div>
      )}
      {aviso && <div role="status" className="thl-aviso">{aviso}</div>}
      {dados.truncado && <div role="status" className="thl-aviso">O histórico é muito grande: só os registros mais recentes de cada fonte foram lidos.</div>}

      {visao.dias.length === 0 && <div className="thl-vazio">{dados.fatos.length === 0 ? "Nada aconteceu ainda com este processo." : "Nenhum fato neste recorte."}</div>}
      {visao.dias.map((d) => {
        const autoAberto = d.automaticos != null && (!filtros.ocultarAutomaticos || diasComAuto.has(d.dia))
        return (
          <section key={d.dia} aria-label={d.rotulo}>
            <div className="thl-dia"><h3>{d.rotulo}</h3><i /><span>{d.contagem} {d.contagem === 1 ? "fato" : "fatos"}</span></div>
            <div className="thl-lista">
              {d.linhas.map((l) => <Linha key={l.id} l={l} aberta={abertas.has(l.id)} alternar={() => alternar(l.id)} />)}
              {d.automaticos && (
                <div className="thl-auto">
                  <button type="button" className="thl-linha" aria-expanded={autoAberto} onClick={() => alternarDia(d.dia)}>
                    <span className="thl-hora">·</span><span className="thl-txt">{d.automaticos.texto}<span className="thl-ver">{autoAberto ? "ocultar" : "ver"}</span></span>
                  </button>
                  {autoAberto && d.automaticos.linhas.map((l) => <Linha key={l.id} l={l} aberta={abertas.has(l.id)} alternar={() => alternar(l.id)} />)}
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
