"use client"
// src/components/torre/RelatorioControle.tsx — "Relatório de controle" (Bloco I4): o relatório de Certidões do
// MOTOR DE RELATÓRIOS existente, filtrado pela família (ou pelo processo), versão interna. Nada novo no servidor.
import { useEffect, useMemo, useState } from "react"
import { auth } from "@/src/components/operacao/kit-operacional"
import { api, erroDe, Modal, useTorre } from "./torre-base"

type Cor = "vermelho" | "amarelo" | "verde" | "cinza"
interface Resultado {
  total: number
  colunas: Array<{ key: string; rotulo: string }>
  linhas: Array<{ id: number; celulas: Array<{ key: string; valor: string | number | null; cor?: Cor | null }> }>
  aplicados: Array<{ key: string; rotulo: string; descricao: string }>
}
const COR: Record<Cor, string> = { vermelho: "var(--danger-text)", amarelo: "var(--warning-text)", verde: "var(--success-text)", cinza: "var(--text-muted)" }

export function RelatorioControle({ processoId, processoRotulo, familiaId, familiaNome, onFechar }: {
  processoId: number; processoRotulo: string; familiaId: number | null; familiaNome: string; onFechar: () => void
}) {
  const { avisar } = useTorre()
  const spec = useMemo(() => ({
    dominio: "certidoes",
    filtros: [familiaId != null
      ? { key: "familia", valor: { tipo: "entidade", id: familiaId, rotulo: familiaNome } }
      : { key: "processo", valor: { tipo: "entidade", id: processoId, rotulo: processoRotulo } }],
    ordenarPor: "familia_geracao", direcao: "asc", pagina: 1, porPagina: 100,
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
      if (!r.ok) { const d = await r.json().catch(() => ({})); avisar(r.status === 403 ? "Seu perfil não tem acesso ao módulo de Relatórios." : erroDe(d)); return }
      const blob = await r.blob()
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `relatorio-de-controle.${formato}`
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); URL.revokeObjectURL(a.href)
      avisar(`Relatório exportado (${formato.toUpperCase()}, ${r.headers.get("X-Relatorio-Extraidas") ?? "?"} de ${r.headers.get("X-Relatorio-Total") ?? "?"} linhas).${r.headers.get("X-Relatorio-Truncado") === "1" ? " Extração truncada." : ""}`)
    } catch { avisar("Erro de conexão ao exportar.") } finally { setExportando(null) }
  }

  return (
    <Modal titulo={`Relatório de controle — ${familiaNome}`} subtitulo="Versão interna · relatório de Certidões do módulo de Relatórios, filtrado por esta família." onFechar={onFechar}
      rodape={<>
        {(["csv", "xlsx", "pdf"] as const).map((f) => (
          <button key={f} className="tor-btn" disabled={!!exportando || !res} onClick={() => void exportar(f)}>{exportando === f ? "Gerando…" : `Exportar ${f === "xlsx" ? "Excel" : f.toUpperCase()}`}</button>
        ))}
        <button className="tor-btn pri" onClick={onFechar}>Fechar</button>
      </>}>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
      {!erro && !res && <div className="small">Gerando relatório…</div>}
      {res && (
        <>
          <div className="small">{res.aplicados.map((a) => `${a.rotulo}: ${a.descricao}`).join(" · ")} · {res.total} linha(s)</div>
          {res.total > res.linhas.length && <div className="small">Mostrando {res.linhas.length} de {res.total}. Use a exportação para o total.</div>}
          {res.linhas.length === 0 ? <div className="small">Nenhuma certidão para esta família.</div> : (
            <div className="tor-scroll"><table style={{ borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{res.colunas.map((c) => <th key={c.key} className="small" style={{ textAlign: "left", padding: "4px 8px" }}>{c.rotulo}</th>)}</tr></thead>
              <tbody>{res.linhas.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--border-default)" }}>
                  {res.colunas.map((c) => { const cel = l.celulas.find((x) => x.key === c.key); return <td key={c.key} style={{ padding: "4px 8px", color: cel?.cor ? COR[cel.cor] : undefined }}>{cel?.valor ?? "—"}</td> })}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </Modal>
  )
}
