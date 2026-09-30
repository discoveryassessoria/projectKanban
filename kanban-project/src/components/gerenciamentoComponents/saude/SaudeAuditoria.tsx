"use client"
// SaudeAuditoria.tsx — sub-aba AUDITORIA de Gerenciamento › Saúde do sistema (era a aba Auditoria da Torre, Bloco I2; movida 01/10/2026).
// LogAuditoria classificado em SISTEMA × PROCESSO/TAREFA (`NATUREZA_DA_ACAO`, padrão: Sistema),
// paginado e filtrado no servidor; "Exportar CSV" gerado pelo servidor com os mesmos filtros.
import { useEffect, useState } from "react"
import { auth } from "@/src/components/operacao/kit-operacional"
import { api, erroDe, useTorre } from "@/src/components/torre/torre-base"

interface Linha { id: number; quando: string; autor: string; acao: string; alvo: string; justificativa: string | null; descricao: string }
interface Filtros { de: string; ate: string; autorId: string; processoId: string; acao: string; natureza: string }
const VAZIO: Filtros = { de: "", ate: "", autorId: "", processoId: "", acao: "", natureza: "SISTEMA" }
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
const consulta = (f: Filtros) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v.trim()) p.set(k, v.trim())
  return p
}

export function SaudeAuditoria() {
  const { avisar } = useTorre()
  const [form, setForm] = useState<Filtros>(VAZIO)
  const [aplicados, setAplicados] = useState<Filtros>(VAZIO)
  const [pagina, setPagina] = useState(1)
  const [dados, setDados] = useState<{ itens: Linha[]; total: number; porPagina: number } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pessoas, setPessoas] = useState<Array<{ id: number; nome: string }>>([])
  const [exportando, setExportando] = useState(false)

  useEffect(() => {
    void api<{ funcionarios: Array<{ id: number; nome: string }> }>("/api/operacao/atribuiveis").then((r) => { if (r.ok) setPessoas(r.data.funcionarios ?? []) })
  }, [])
  useEffect(() => {
    let vivo = true
    const p = consulta(aplicados); p.set("pagina", String(pagina)); p.set("porPagina", "50")
    void api<{ itens: Linha[]; total: number; porPagina: number }>(`/api/torre/auditoria?${p}`).then((r) => {
      if (!vivo) return
      if (r.ok) { setDados(r.data); setErro(null) } else setErro(r.status === 403 ? "A auditoria é só para administradores." : erroDe(r.data, "Não foi possível carregar a auditoria."))
    })
    return () => { vivo = false }
  }, [aplicados, pagina])

  const exportar = async () => {
    setExportando(true)
    try {
      const r = await fetch(`/api/torre/auditoria/csv?${consulta(aplicados)}`, { headers: auth() })
      if (!r.ok) { const d = await r.json().catch(() => ({})); avisar(r.status === 403 ? "A exportação da auditoria é só para administradores." : erroDe(d)); return }
      const blob = await r.blob()
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "auditoria-torre.csv"
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); URL.revokeObjectURL(a.href)
      avisar(`CSV gerado (${r.headers.get("X-Auditoria-Linhas") ?? "?"} linhas).${r.headers.get("X-Auditoria-Truncado") === "1" ? " Truncado em 20.000 linhas — refine o filtro." : ""}`)
    } catch { avisar("Erro de conexão ao gerar o CSV.") } finally { setExportando(false) }
  }

  const total = dados?.total ?? 0, porPagina = dados?.porPagina ?? 50
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  const set = (k: keyof Filtros) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <div>
      <div className="small mb-2">Fatos de SISTEMA gravados de verdade (regras, diagnóstico, visões, exclusão de processo, manutenção em lote…) — quem, quando, o quê, em quê e por quê. Os fatos de um processo ou tarefa ficam no Histórico do processo; o filtro «Tipo» mostra também esses.</div>
      <div className="tor-bar">
        <label className="small">De <input type="date" className="tor-in" value={form.de} onChange={set("de")} /></label>
        <label className="small">Até <input type="date" className="tor-in" value={form.ate} onChange={set("ate")} /></label>
        <label className="small">Tipo <select className="tor-in" value={form.natureza} onChange={set("natureza")}><option value="SISTEMA">Sistema</option><option value="PROCESSO_TAREFA">Processo e tarefa</option><option value="TODOS">Todos</option></select></label>
        <label className="small">Autor <select className="tor-in" value={form.autorId} onChange={set("autorId")}><option value="">Todos</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
        <label className="small">Processo nº <input type="number" min={1} className="tor-in" style={{ width: 100 }} value={form.processoId} onChange={set("processoId")} /></label>
        <label className="small">Ação <input className="tor-in" placeholder="ex.: PRAZO" value={form.acao} onChange={set("acao")} /></label>
        <button className="tor-btn pri" onClick={() => { setPagina(1); setAplicados(form) }}>Filtrar</button>
        <button className="tor-btn" onClick={() => { setForm(VAZIO); setPagina(1); setAplicados(VAZIO) }}>Limpar</button>
        <div style={{ flexGrow: 1 }} />
        <button className="tor-btn" disabled={exportando} onClick={() => void exportar()}>{exportando ? "Gerando…" : "Exportar CSV"}</button>
      </div>
      {erro && <div className="tor-card pad">{erro}</div>}
      {!erro && !dados && <div className="tor-card pad small">Carregando auditoria…</div>}
      {dados && (
        <div className="tor-card tor-scroll">
          <div className="tor-hd tor-gA"><span>Quando</span><span>Autor</span><span>Ação</span><span>Alvo</span><span>Justificativa</span></div>
          {dados.itens.length === 0 && <div className="p-4 small">Nenhum registro para este filtro.</div>}
          {dados.itens.map((l) => (
            <div key={l.id} className="tor-row tor-gA">
              <div className="small">{quando(l.quando)}</div><div>{l.autor}</div>
              <div><b>{l.acao}</b><div className="small">{l.descricao}</div></div>
              <div className="small">{l.alvo}</div><div className="small">{l.justificativa ?? "—"}</div>
            </div>
          ))}
        </div>
      )}
      {dados && (
        <div className="tor-bar">
          <button className="tor-btn" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
          <span className="small">página {pagina} de {paginas} · {total} registro(s)</span>
          <button className="tor-btn" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
        </div>
      )}
    </div>
  )
}
