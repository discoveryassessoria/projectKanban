"use client"
// src/components/torre/ProcessoRelatorio.tsx — o modal "Relatório de controle · <família>" DO DETALHE DO PROCESSO (980 px, com a prévia
// das linhas — telas/detalhe-processo-modal-relatorio.png). É o relatório de Certidões do MOTOR DE RELATÓRIOS existente
// (`/api/relatorios/consultar` e `/api/relatorios/exportar`), filtrado pela família: nada novo no servidor. (O modal de 760 px da aba
// Processos é `RelatorioControle.tsx`, outra tela do protótipo, sem prévia.)
// Exportar CSV/Excel/PDF baixa o arquivo com TODAS as linhas e filtros, fecha o modal e avisa "Relatório exportado · N de M linhas"
// (sem "Desfazer": um arquivo baixado não se desfaz).
import { useEffect, useMemo, useState } from "react"
import { auth } from "@/src/components/operacao/kit-operacional"
import { api, erroDe } from "./torre-base"
import { COLUNAS_DO_RELATORIO_DE_CONTROLE } from "@/lib/operacional/torre-relatorio-colunas"

type Cor = "vermelho" | "amarelo" | "verde" | "cinza"
interface Resultado {
  total: number
  colunas: Array<{ key: string; rotulo: string }>
  linhas: Array<{ id: number; celulas: Array<{ key: string; valor: string | number | null; cor?: Cor | null }> }>
}
const COR: Record<Cor, string> = { vermelho: "var(--danger-text)", amarelo: "var(--warning-text)", verde: "var(--success-text)", cinza: "var(--text-muted)" }
// As colunas do protótipo + Geração: UMA lista (lib/operacional/torre-relatorio-colunas.ts), a mesma da prévia e das exportações.
const COLUNAS = [...COLUNAS_DO_RELATORIO_DE_CONTROLE]

export function ProcessoRelatorio({ processoId, processoRotulo, familiaId, familiaNome, onFechar, avisar }: {
  processoId: number; processoRotulo: string; familiaId: number | null; familiaNome: string; onFechar: () => void; avisar: (msg: string) => void
}) {
  const spec = useMemo(() => ({
    dominio: "certidoes",
    filtros: [familiaId != null
      ? { key: "familia", valor: { tipo: "entidade", id: familiaId, rotulo: familiaNome } }
      : { key: "processo", valor: { tipo: "entidade", id: processoId, rotulo: processoRotulo } }],
    colunas: COLUNAS, ordenarPor: "familia_geracao", direcao: "asc", pagina: 1, porPagina: 100,
  }), [familiaId, familiaNome, processoId, processoRotulo])
  const [res, setRes] = useState<Resultado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [exportando, setExportando] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void api<Resultado>("/api/relatorios/consultar", "POST", spec).then((r) => {
      if (!vivo) return
      if (r.ok) setRes(r.data)
      else setErro(r.status === 403 ? "Seu perfil não tem acesso ao módulo de Relatórios." : erroDe(r.data, "Não foi possível gerar o relatório."))
    })
    return () => { vivo = false }
  }, [spec])

  const exportar = async (formato: "csv" | "xlsx" | "pdf") => {
    setExportando(formato)
    try {
      const r = await fetch("/api/relatorios/exportar", { method: "POST", headers: auth(), body: JSON.stringify({ ...spec, formato }) })
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErro(r.status === 403 ? "Seu perfil não tem acesso ao módulo de Relatórios." : erroDe(d, "Não foi possível exportar o relatório.")); return }
      const blob = await r.blob()
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `relatorio-de-controle.${formato}`
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); URL.revokeObjectURL(a.href)
      avisar(`Relatório exportado · ${r.headers.get("X-Relatorio-Extraidas") ?? res?.total ?? "?"} de ${r.headers.get("X-Relatorio-Total") ?? res?.total ?? "?"} linhas${r.headers.get("X-Relatorio-Truncado") === "1" ? " · extração truncada" : ""}`)
      onFechar()
    } catch { setErro("Erro de conexão ao exportar.") } finally { setExportando(null) }
  }

  const n = res?.total ?? null
  return (
    <div className="tpr-modal" style={{ zIndex: 10050 }} onClick={exportando ? undefined : onFechar}>
      <div role="dialog" aria-label={`Relatório de controle · ${familiaNome}`} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Relatório de controle · {familiaNome}</div>
          <span className="tpr-12 tpr-mut">Filtro: família {familiaNome} · todas as fases · {n == null ? "…" : `${n} ${n === 1 ? "linha" : "linhas"}`}</span>
          <button type="button" aria-label="Fechar" onClick={onFechar} style={{ marginLeft: "auto", border: 0, background: "transparent", fontSize: 20, cursor: "pointer", color: "var(--text-secondary)" }}>✕</button>
        </div>
        {erro && <div role="alert" style={{ fontSize: 12, borderRadius: 8, padding: "8px 12px", background: "var(--danger-tile)", color: "var(--danger-text)" }}>{erro}</div>}
        {!erro && !res && <div className="tpr-13 tpr-mut">Gerando relatório…</div>}
        {res && (res.linhas.length === 0
          ? <div className="tpr-13 tpr-mut">Nenhuma certidão para esta família.</div>
          : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 640, width: "100%", fontSize: 13 }}>
                <thead><tr>{res.colunas.map((c) => <th key={c.key} style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-secondary)", background: "var(--surface-tertiary)" }}>{c.rotulo}</th>)}</tr></thead>
                <tbody>{res.linhas.map((l) => (
                  <tr key={l.id} style={{ borderBottom: "1px solid var(--border-default)" }}>
                    {res.colunas.map((c) => { const cel = l.celulas.find((x) => x.key === c.key); return <td key={c.key} style={{ padding: "8px 10px", color: cel?.cor ? COR[cel.cor] : undefined }}>{cel?.valor ?? "—"}</td> })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
        {res && <div className="tpr-12 tpr-mut">Mostrando {res.linhas.length} de {res.total} · a exportação leva as {res.total} linhas e os filtros aplicados.</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {(["csv", "xlsx", "pdf"] as const).map((f) => (
            <button key={f} type="button" className="tpr-btn" style={{ height: 34, fontSize: 13 }} disabled={!!exportando || !res} onClick={() => void exportar(f)}>
              {exportando === f ? "Gerando…" : `Exportar ${f === "xlsx" ? "Excel" : f.toUpperCase()}`}
            </button>
          ))}
          <button type="button" className="tpr-btn pri" style={{ height: 34, fontSize: 13 }} onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
