"use client"
// src/components/torre/RelatorioControle.tsx — "Relatório de controle · <família>" (modal de 760 px do protótipo).
// O motor é o de Relatórios que já existe (`/api/relatorios/exportar`, domínio de Certidões) filtrado pela família — nada novo no
// servidor: as exportações CSV, Excel e PDF são REAIS (baixam o arquivo com TODAS as linhas da família, em todas as fases).
// Sucesso: o modal fecha e o aviso diz "Relatório exportado com todas as linhas" (sem "Desfazer" — não há o que desfazer). Se o motor
// truncar a extração, o aviso diz quantas linhas vieram de quantas. "Fechar" e "✕" fecham sem aviso. Não fecha com Esc nem clicando fora.
import { useMemo, useState } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { auth } from "@/src/components/operacao/kit-operacional"
import { erroDe, useEscFecha, useTorre } from "./torre-base"
import { COLUNAS_DO_RELATORIO_DE_CONTROLE } from "@/lib/operacional/torre-relatorio-colunas"
import "./torre-radar.css"

type Formato = "csv" | "xlsx" | "pdf"
const ROTULO: Record<Formato, string> = { csv: "Exportar CSV", xlsx: "Exportar Excel", pdf: "Exportar PDF" }

export function RelatorioControle({ processoId, processoRotulo, familiaId, familiaNome, onFechar }: {
  processoId: number; processoRotulo: string; familiaId: number | null; familiaNome: string; onFechar: () => void
}) {
  const { avisar } = useTorre()
  const spec = useMemo(() => ({
    dominio: "certidoes",
    filtros: [familiaId != null
      ? { key: "familia", valor: { tipo: "entidade", id: familiaId, rotulo: familiaNome } }
      : { key: "processo", valor: { tipo: "entidade", id: processoId, rotulo: processoRotulo } }],
    colunas: [...COLUNAS_DO_RELATORIO_DE_CONTROLE], ordenarPor: "familia_geracao", direcao: "asc", pagina: 1, porPagina: 100,
  }), [familiaId, familiaNome, processoId, processoRotulo])
  const [exportando, setExportando] = useState<Formato | null>(null)
  useEscFecha(onFechar, !exportando)
  const [erro, setErro] = useState<string | null>(null)

  const exportar = async (formato: Formato) => {
    setExportando(formato); setErro(null)
    try {
      const r = await fetch("/api/relatorios/exportar", { method: "POST", headers: auth(), body: JSON.stringify({ ...spec, formato }) })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErro(r.status === 403 ? "Seu perfil não tem acesso ao módulo de Relatórios." : erroDe(d, "Não foi possível exportar o relatório."))
        return
      }
      const blob = await r.blob()
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `relatorio-de-controle.${formato}`
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); URL.revokeObjectURL(a.href)
      const truncado = r.headers.get("X-Relatorio-Truncado") === "1"
      avisar(truncado
        ? `Relatório exportado, mas a extração foi truncada: ${r.headers.get("X-Relatorio-Extraidas") ?? "?"} de ${r.headers.get("X-Relatorio-Total") ?? "?"} linhas.`
        : "Relatório exportado com todas as linhas")
      onFechar()
    } catch { setErro("Erro de conexão ao exportar.") } finally { setExportando(null) }
  }

  return (
    <div className="tor-rel-fundo" style={{ zIndex: LAYER.popover }}>
      <div role="dialog" aria-label={`Relatório de controle · ${familiaNome}`} className="tor-rel">
        <div className="tor-rel-topo">
          <div className="tor-rel-titulo">Relatório de controle · {familiaNome}</div>
          <button type="button" aria-label="Fechar" className="tor-rel-x" onClick={onFechar}>✕</button>
        </div>
        <div className="tor-rel-texto">Todas as certidões da família, em todas as fases, com passo, responsável, datas e histórico resumido. Mesmo motor da aba Relatórios, já filtrado pela família.</div>
        {erro && <div className="tor-rel-erro" role="alert">{erro}</div>}
        <div className="tor-rel-acoes">
          {(["csv", "xlsx", "pdf"] as const).map((f) => (
            <button key={f} type="button" className="tor-rel-btn" disabled={exportando != null} onClick={() => void exportar(f)}>{exportando === f ? "Gerando…" : ROTULO[f]}</button>
          ))}
          <button type="button" className="tor-rel-btn pri" disabled={exportando != null} onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
