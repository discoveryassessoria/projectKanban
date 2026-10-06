"use client"
// src/components/torre/ProcessoRelatorio.tsx — o modal "Relatório de controle · <família>" DO DETALHE DO PROCESSO (980 px, com a prévia
// das linhas — telas/detalhe-processo-modal-relatorio.png). É o relatório de Certidões do MOTOR DE RELATÓRIOS existente
// (`/api/relatorios/consultar` e `/api/relatorios/exportar`), filtrado pela família e pelos quatro filtros da barra.
// Exportar CSV/Excel/PDF baixa o arquivo com as linhas FILTRADAS (os mesmos filtros da prévia), fecha o modal e avisa "Relatório exportado ·
// N de M linhas" (sem "Desfazer": um arquivo baixado não se desfaz). O CSV abre com a linha "Filtros: …"; Excel e PDF trazem o contexto no topo.
// FILTROS (barra no topo, combináveis): Fase · Linhagem · Status · Pessoa — `lib/operacional/torre-relatorio-filtros.ts`. É a janela ÚNICA: a aba
// Processos e a página do processo abrem esta mesma, com os mesmos padrões (Fase atual · todas as linhagens · só ativas · todas as pessoas).
import { useEffect, useMemo, useState } from "react"
import { auth } from "@/src/components/operacao/kit-operacional"
import { api, erroDe, useEscFecha, useTorre } from "./torre-base"
import { COLUNAS_DO_RELATORIO_DE_CONTROLE } from "@/lib/operacional/torre-relatorio-colunas"
import {
  FASE_ATUAL, FASES_ANTERIORES, TODAS_AS_FASES, FILTROS_PADRAO, ROTULO_LINHAGEM, ROTULO_STATUS, filtrosParaOMotor, resumoDoRelatorio,
  type FiltrosDoRelatorio, type OpcoesDoRelatorio, type FiltroDeLinhagem, type FiltroDeStatusDoRelatorio,
} from "@/lib/operacional/torre-relatorio-filtros"

type Cor = "vermelho" | "amarelo" | "verde" | "cinza"
interface Resultado {
  total: number
  colunas: Array<{ key: string; rotulo: string }>
  linhas: Array<{ id: number; celulas: Array<{ key: string; valor: string | number | null; cor?: Cor | null }> }>
}
const COR: Record<Cor, string> = { vermelho: "var(--danger-text)", amarelo: "var(--warning-text)", verde: "var(--success-text)", cinza: "var(--text-muted)" }
// As colunas do protótipo + Geração: UMA lista (lib/operacional/torre-relatorio-colunas.ts), a mesma da prévia e das exportações.
const COLUNAS = [...COLUNAS_DO_RELATORIO_DE_CONTROLE]

/** A janela aberta pela aba Processos: o mesmo relatório, o aviso de "exportado" vai para o toast da Torre. */
export function ProcessoRelatorioDaTorre(p: { processoId: number; processoRotulo: string; familiaId: number | null; familiaNome: string; onFechar: () => void }) {
  const { avisar } = useTorre()
  return <ProcessoRelatorio {...p} avisar={avisar} />
}

const SELECT: React.CSSProperties = { height: 32, borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--surface-input)", color: "var(--text-primary)", fontSize: 13, padding: "0 8px", minWidth: 0 }

export function ProcessoRelatorio({ processoId, processoRotulo, familiaId, familiaNome, filtrosIniciais, onFiltros, onFechar, avisar }: {
  processoId: number; processoRotulo: string; familiaId: number | null; familiaNome: string
  /** Os filtros com que a janela abre (a página os lê da URL). Sem eles: os padrões. */
  filtrosIniciais?: FiltrosDoRelatorio
  /** Avisa a cada mudança (a página grava na URL). */
  onFiltros?: (f: FiltrosDoRelatorio) => void
  onFechar: () => void; avisar: (msg: string) => void
}) {
  const [filtros, setFiltros] = useState<FiltrosDoRelatorio>(filtrosIniciais ?? FILTROS_PADRAO)
  const [opcoes, setOpcoes] = useState<OpcoesDoRelatorio | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [exportando, setExportando] = useState<string | null>(null)
  const mudar = (parcial: Partial<FiltrosDoRelatorio>) => setFiltros((f) => { const n = { ...f, ...parcial }; onFiltros?.(n); return n })

  useEffect(() => {
    let vivo = true
    void api<OpcoesDoRelatorio>(`/api/torre/processos/${processoId}/relatorio-opcoes`).then((r) => {
      if (!vivo) return
      if (r.ok) setOpcoes(r.data)
      else setErro(r.status === 403 ? "Seu perfil não tem acesso ao módulo de Relatórios." : erroDe(r.data, "Não foi possível carregar as opções do relatório."))
    })
    return () => { vivo = false }
  }, [processoId])

  // Só há consulta depois que as fases e pessoas do processo chegaram (sem elas "Fase atual" não saberia qual é).
  const spec = useMemo(() => opcoes ? ({
    dominio: "certidoes",
    filtros: [
      familiaId != null
        ? { key: "familia", valor: { tipo: "entidade", id: familiaId, rotulo: familiaNome } }
        : { key: "processo", valor: { tipo: "entidade", id: processoId, rotulo: processoRotulo } },
      ...filtrosParaOMotor(filtros, opcoes),
    ],
    colunas: COLUNAS, ordenarPor: "familia_geracao", direcao: "asc", pagina: 1, porPagina: 100,
  }) : null, [opcoes, filtros, familiaId, familiaNome, processoId, processoRotulo])
  // O resultado vale só para o conjunto de filtros que o gerou (troca de filtro não deixa número velho no título).
  const [resultado, setResultado] = useState<{ spec: unknown; dados: Resultado } | null>(null)
  const res = resultado && resultado.spec === spec ? resultado.dados : null
  useEscFecha(onFechar, !exportando)

  useEffect(() => {
    if (!spec) return
    let vivo = true
    void api<Resultado>("/api/relatorios/consultar", "POST", spec).then((r) => {
      if (!vivo) return
      if (r.ok) { setResultado({ spec, dados: r.data }); setErro(null) }
      else setErro(r.status === 403 ? "Seu perfil não tem acesso ao módulo de Relatórios." : erroDe(r.data, "Não foi possível gerar o relatório."))
    })
    return () => { vivo = false }
  }, [spec])

  const exportar = async (formato: "csv" | "xlsx" | "pdf") => {
    if (!spec) return
    setExportando(formato)
    try {
      const r = await fetch("/api/relatorios/exportar", { method: "POST", headers: auth(), body: JSON.stringify({ ...spec, formato, contextoNoCsv: true }) })
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErro(r.status === 403 ? "Seu perfil não tem acesso ao módulo de Relatórios." : erroDe(d, "Não foi possível exportar o relatório.")); return }
      const blob = await r.blob()
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? `relatorio-de-controle.${formato}`
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); URL.revokeObjectURL(a.href)
      avisar(`Relatório exportado · ${r.headers.get("X-Relatorio-Extraidas") ?? res?.total ?? "?"} de ${r.headers.get("X-Relatorio-Total") ?? res?.total ?? "?"} linhas${r.headers.get("X-Relatorio-Truncado") === "1" ? " · extração truncada" : ""}`)
      onFechar()
    } catch { setErro("Erro de conexão ao exportar.") } finally { setExportando(null) }
  }

  const n = res?.total ?? null
  const resumo = opcoes ? resumoDoRelatorio({ familiaNome, filtros, opcoes, linhas: res ? n : null }) : null
  return (
    <div className="tpr-modal" style={{ zIndex: 10050 }} onClick={exportando ? undefined : onFechar}>
      <div role="dialog" aria-label={`Relatório de controle · ${familiaNome}`} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Relatório de controle · {familiaNome}</div>
          <span className="tpr-12 tpr-mut" data-resumo-dos-filtros>Filtro: {resumo ?? `família ${familiaNome} · …`}</span>
          <button type="button" aria-label="Fechar" onClick={onFechar} style={{ marginLeft: "auto", border: 0, background: "transparent", fontSize: 20, cursor: "pointer", color: "var(--text-secondary)" }}>✕</button>
        </div>
        {opcoes && (
          <div role="group" aria-label="Filtros do relatório" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select style={SELECT} aria-label="Fase" value={filtros.fase} onChange={(e) => mudar({ fase: e.target.value })}>
              <option value={FASE_ATUAL}>Fase atual</option>
              <option value={FASES_ANTERIORES}>Fases anteriores</option>
              <option value={TODAS_AS_FASES}>Todas as fases</option>
              {opcoes.fases.length > 0 && <option disabled>──────────</option>}
              {opcoes.fases.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select style={SELECT} aria-label="Linhagem" value={filtros.linhagem} onChange={(e) => mudar({ linhagem: e.target.value as FiltroDeLinhagem })}>
              {(Object.keys(ROTULO_LINHAGEM) as FiltroDeLinhagem[]).map((k) => <option key={k} value={k}>{ROTULO_LINHAGEM[k]}</option>)}
            </select>
            <select style={SELECT} aria-label="Status" value={filtros.status} onChange={(e) => mudar({ status: e.target.value as FiltroDeStatusDoRelatorio })}>
              {(["ativas", "concluidas", "encerradas", "todas"] as FiltroDeStatusDoRelatorio[]).map((k) => <option key={k} value={k}>{ROTULO_STATUS[k]}</option>)}
            </select>
            <select style={SELECT} aria-label="Pessoa" value={filtros.pessoa ?? ""} onChange={(e) => mudar({ pessoa: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">Todas as pessoas</option>
              {opcoes.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        )}
        {erro && <div role="alert" style={{ fontSize: 12, borderRadius: 8, padding: "8px 12px", background: "var(--danger-tile)", color: "var(--danger-text)" }}>{erro}</div>}
        {!erro && !res && <div className="tpr-13 tpr-mut">{opcoes ? "Gerando relatório…" : "Carregando os filtros…"}</div>}
        {res && (res.linhas.length === 0
          ? <div className="tpr-13 tpr-mut">Nenhuma certidão com estes filtros.</div>
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
            <button key={f} type="button" className="tpr-btn" style={{ height: 34, fontSize: 13 }} disabled={!!exportando || !res || !spec} onClick={() => void exportar(f)}>
              {exportando === f ? "Gerando…" : `Exportar ${f === "xlsx" ? "Excel" : f.toUpperCase()}`}
            </button>
          ))}
          <button type="button" className="tpr-btn pri" style={{ height: 34, fontSize: 13 }} onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
