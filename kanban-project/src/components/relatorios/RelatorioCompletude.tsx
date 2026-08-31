"use client"

// src/components/relatorios/RelatorioCompletude.tsx
//
// COMPLETUDE — as duas leituras da mesma avaliação.
//
//   modo="pessoa"    → "o que falta para o Fulano?"
//   modo="requisito" → "quem está sem RG?"
//
// Nenhuma das duas sabe quais requisitos existem: as duas perguntam ao motor,
// que pergunta ao cadastro. Não há lista de documentos nem de campos aqui — se
// aparecer, é regressão (npm run test:relatorios falha).

import { useCallback, useEffect, useMemo, useState } from "react"

type Requisito = {
  chave: string; natureza: "CADASTRAL" | "DOCUMENTAL"; rotulo: string
  estado: string; bloqueante: boolean
  origem: { fonte: string; id: number; code?: string | null; regraId?: number | null; regraVersao?: number | null; motivo?: string | null; entidade?: string; campo?: string }
}
type LinhaPessoa = {
  requerenteId: number; nome: string
  processoId: number; processoCodigo: string | null; processoNome: string
  familiaId: number | null; familiaNome: string | null; pais: string | null
  aplicaveis: number; satisfeitos: number; pendentes: number; bloqueadores: number
  percentual: number; requisitos: Requisito[]
}
type LinhaRequisito = {
  chave: string; rotulo: string; natureza: string; bloqueante: boolean; quantidade: number
  pessoas: { requerenteId: number; nome: string; processoId: number; estado: string }[]
}

const auth = () => ({ Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}` })
const CARD = "rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)]"

const ROTULO_ESTADO: Record<string, string> = {
  PENDENTE: "Pendente",
  EM_ATENDIMENTO: "Em atendimento",
  NAO_LOCALIZADA: "Não localizada",
  DISPENSADO: "Dispensado",
  SATISFEITO: "Satisfeito",
}
// NÃO LOCALIZADA não é recusa e não é ausência — cor própria, para o operador
// não sair atrás do que o órgão já disse que não existe.
const corDoEstado = (e: string) =>
  e === "SATISFEITO" ? "var(--success-text)"
  : e === "NAO_LOCALIZADA" ? "var(--danger-text)"
  : e === "DISPENSADO" ? "var(--text-muted)"
  : "var(--warning-text)"

export default function RelatorioCompletude({ paisKey, modo }: { paisKey: string | null; modo: "pessoa" | "requisito" }) {
  const [dados, setDados] = useState<any>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)
  const [soBloqueadores, setSoBloqueadores] = useState(false)

  const consultar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try {
      const q = new URLSearchParams({ modo, pendentes: "1" })
      if (paisKey) q.set("pais", paisKey)
      if (soBloqueadores) q.set("bloqueadores", "1")
      const res = await fetch(`/api/relatorios/completude?${q}`, { headers: auth() })
      const j = await res.json()
      if (!res.ok) { setErro(j.error || "Erro ao gerar o relatório."); setDados(null); return }
      setDados(j)
    } catch {
      setErro("Erro ao gerar o relatório.")
    } finally { setCarregando(false) }
  }, [paisKey, modo, soBloqueadores])

  useEffect(() => { void consultar() }, [consultar])

  const pessoas: LinhaPessoa[] = useMemo(() => (modo === "pessoa" ? dados?.linhas ?? [] : []), [dados, modo])
  const requisitos: LinhaRequisito[] = useMemo(() => (modo === "requisito" ? dados?.requisitos ?? [] : []), [dados, modo])

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-center gap-4 px-5 py-3`}>
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={soBloqueadores}
            onChange={(e) => setSoBloqueadores(e.target.checked)}
            className="h-4 w-4 accent-[var(--action-primary)]"
          />
          Só quem tem bloqueador
        </label>
        <span className="text-xs text-[var(--text-secondary)]">
          {dados ? `${dados.processosAvaliados} processo(s) avaliado(s) · ${dados.granularidade}` : "—"}
        </span>
        <button
          onClick={() => void consultar()}
          disabled={carregando}
          className="ml-auto rounded-md px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          {carregando ? "Consultando…" : "Atualizar"}
        </button>
      </div>

      {erro && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "var(--danger-tile)", color: "var(--danger-text)" }}>
          {erro}
        </div>
      )}

      {modo === "pessoa" ? (
        <div className={`overflow-x-auto ${CARD}`}>
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-3 font-medium">Pessoa</th>
                <th className="px-4 py-3 font-medium">Família</th>
                <th className="px-4 py-3 font-medium">Processo</th>
                <th className="px-4 py-3 font-medium">Completude</th>
                <th className="px-4 py-3 font-medium">Pendências</th>
                <th className="px-4 py-3 font-medium">Bloqueadores</th>
              </tr>
            </thead>
            <tbody>
              {pessoas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
                    {carregando ? "Consultando…" : "Ninguém com pendência — ou nenhum requisito cadastrado ainda."}
                  </td>
                </tr>
              ) : pessoas.map((p) => (
                <>
                  <tr
                    key={p.requerenteId}
                    onClick={() => setAberta(aberta === p.requerenteId ? null : p.requerenteId)}
                    className="cursor-pointer border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-4 py-2.5 text-[var(--text-primary)]">{p.nome}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.familiaNome ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      {p.processoCodigo ?? `#${p.processoId}`} — {p.processoNome}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-primary)]">
                      {p.percentual}% <span className="text-[11px] text-[var(--text-muted)]">({p.satisfeitos}/{p.aplicaveis})</span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.pendentes}</td>
                    <td className="px-4 py-2.5">
                      {p.bloqueadores > 0
                        ? <span className="text-xs font-medium" style={{ color: "var(--danger-text)" }}>{p.bloqueadores}</span>
                        : <span className="text-xs" style={{ color: "var(--success-text)" }}>nenhum</span>}
                    </td>
                  </tr>
                  {aberta === p.requerenteId && (
                    <tr key={`${p.requerenteId}-det`}>
                      <td colSpan={6} className="bg-[var(--surface-secondary)] px-6 py-3">
                        {p.requisitos.length === 0 ? (
                          <p className="text-xs text-[var(--text-muted)]">Nada pendente.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {p.requisitos.map((r) => (
                              <li key={r.chave} className="text-sm">
                                <span className="mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                                      style={{ backgroundColor: "var(--surface-primary)", color: "var(--text-muted)" }}>
                                  {r.natureza === "CADASTRAL" ? "dado" : "documento"}
                                </span>
                                <span className="text-[var(--text-primary)]">{r.rotulo}</span>
                                <span className="ml-2 text-xs" style={{ color: corDoEstado(r.estado) }}>
                                  {ROTULO_ESTADO[r.estado] ?? r.estado}{r.bloqueante ? " · bloqueia" : ""}
                                </span>
                                {/* PROVENIÊNCIA — de onde esta pendência veio. */}
                                <span className="ml-2 text-[11px] text-[var(--text-muted)]">
                                  {r.origem.fonte === "RequisitoCadastral"
                                    ? `requisito ${r.origem.code ?? r.origem.id}${r.origem.campo ? ` · ${r.origem.entidade}.${r.origem.campo}` : ""}`
                                    : `necessidade #${r.origem.id}${r.origem.regraId ? ` · regra ${r.origem.regraId} v${r.origem.regraVersao ?? "?"}` : ""}`}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`overflow-x-auto ${CARD}`}>
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-3 font-medium">Requisito</th>
                <th className="px-4 py-3 font-medium">Natureza</th>
                <th className="px-4 py-3 font-medium">Pessoas</th>
                <th className="px-4 py-3 font-medium">Quem</th>
              </tr>
            </thead>
            <tbody>
              {requisitos.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
                    {carregando ? "Consultando…" : "Nenhuma pendência — ou nenhum requisito cadastrado ainda."}
                  </td>
                </tr>
              ) : requisitos.map((r) => (
                <tr key={r.chave} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="px-4 py-2.5 text-[var(--text-primary)]">
                    {r.rotulo}{r.bloqueante && <span className="ml-2 text-[11px]" style={{ color: "var(--danger-text)" }}>bloqueia</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.natureza === "CADASTRAL" ? "dado" : "documento"}</td>
                  <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{r.quantidade}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    {r.pessoas.slice(0, 6).map((p) => p.nome).join(" · ")}
                    {r.pessoas.length > 6 && ` …+${r.pessoas.length - 6}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
