"use client"

// src/components/gerenciamentoComponents/RelatorioProtocolosTab.tsx
//
// RELATÓRIO DE PROTOCOLOS — a leitura que a operação pede, com uma face.
//
// "Tudo que foi protocolado no Consulado de São Paulo em agosto", "todos os
// requerimentos da família X", "o que está com exigência vencendo". As três são
// a MESMA consulta com filtros diferentes, e valem igual para Espanha e Itália —
// nenhuma linha aqui sabe de país. Isso só ficou possível quando o órgão virou
// FK para Órgãos e Organizações e o escopo virou tabela: antes, o tribunal
// morava num enum do schema e o número do processo numa tabela só da Itália.
//
// SOMENTE LEITURA. O total e o agregado por órgão vêm da MESMA resposta da
// lista — somar na tela produziria um número que a lista não confirma.

import { useEffect, useMemo, useState } from "react"

type Linha = {
  id: number
  publicCode: string | null
  numeroProtocolo: string | null
  numeroProcesso: string | null
  dataProtocolo: string | null
  finalidade: string
  situacao: string
  orgao: { id: number; publicCode: string | null; name: string; type: string | null; city: string | null; country: string | null } | null
  responsavel: { id: number; nome: string } | null
  processo: {
    id: number; codigo: string | null; nome: string; pais: string
    familia: { id: number; nome: string } | null
    enquadramentoLegal: { nome: string; modalidadeLegal: { nome: string; cardinalidadeRequerimento: string } | null } | null
  } | null
  requerentes: { id: number; publicCode: string | null; nome: string }[]
  exigencias: { id: number; descricao: string; prazo: string | null; cumpridaEm: string | null }[]
  exigenciasAbertas: number
}
type Resposta = {
  total: number
  truncado: boolean
  porOrgao: { orgaoId: number | null; nome: string; tipo: string | null; pais: string | null; total: number; requerentes: number }[]
  protocolos: Linha[]
}

const ROTULO_FINALIDADE: Record<string, string> = {
  REQUERIMENTO: "Requerimento", RETIFICACAO: "Retificação", CERTIDAO: "Certidão",
  COMPLEMENTACAO: "Complementação", RECURSO: "Recurso", OUTRO: "Outro",
}
const ROTULO_SITUACAO: Record<string, string> = {
  PROTOCOLADO: "Protocolado", EM_ANALISE: "Em análise", EXIGENCIA: "Em exigência",
  DEFERIDO: "Deferido", INDEFERIDO: "Indeferido", ARQUIVADO: "Arquivado",
}
const corDaSituacao = (v: string) =>
  v === "DEFERIDO" ? "var(--success-text)"
  : v === "INDEFERIDO" ? "var(--danger-text)"
  : v === "EXIGENCIA" ? "var(--warning-text)"
  : "var(--info-text)"

const auth = () => ({ Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}` })
const INPUT = "w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)]"
const CARD = "rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)]"
const dataBR = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")

export default function RelatorioProtocolosTab({ paisKey = null }: { paisKey?: string | null } = {}) {
  const [orgaos, setOrgaos] = useState<{ id: number; name: string; type: string | null; country: string | null }[]>([])
  const [familias, setFamilias] = useState<{ id: number; nome: string }[]>([])
  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [f, setF] = useState({
    orgaoId: "", orgaoTipo: "", familiaId: "", finalidade: "", situacao: "",
    de: "", ate: "", exigenciaAberta: false,
  })

  useEffect(() => {
    void (async () => {
      const [ro, rf] = await Promise.all([
        fetch("/api/gerenciamento/orgaos-protocolo", { headers: auth() }).catch(() => null),
        fetch("/api/familias", { headers: auth() }).catch(() => null),
      ])
      if (ro?.ok) { const j = await ro.json(); setOrgaos(j.orgaos ?? j.registros ?? []) }
      if (rf?.ok) { const j = await rf.json(); setFamilias(j.familias ?? j.registros ?? []) }
    })()
  }, [])

  async function consultar() {
    setCarregando(true); setErro(null)
    try {
      const q = new URLSearchParams()
      if (f.orgaoId) q.set("orgaoId", f.orgaoId)
      if (f.orgaoTipo) q.set("orgaoTipo", f.orgaoTipo)
      if (f.familiaId) q.set("familiaId", f.familiaId)
      if (f.finalidade) q.set("finalidade", f.finalidade)
      if (f.situacao) q.set("situacao", f.situacao)
      if (f.de) q.set("de", f.de)
      if (f.ate) q.set("ate", f.ate)
      if (f.exigenciaAberta) q.set("exigenciaAberta", "1")
      // NACIONALIDADE É CONTEXTO: ela chega de fora (da navegação) e entra como
      // filtro do MESMO relatório. Não existe relatório de protocolos por país.
      if (paisKey) q.set("pais", paisKey)
      const res = await fetch(`/api/relatorios/protocolos?${q}`, { headers: auth() })
      const j = await res.json()
      if (!res.ok) { setErro(j.error || "Erro ao gerar o relatório."); setDados(null); return }
      setDados(j)
    } catch {
      setErro("Erro ao gerar o relatório.")
    } finally { setCarregando(false) }
  }

  useEffect(() => { void consultar() }, [paisKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const tiposDeOrgao = useMemo(
    () => Array.from(new Set(orgaos.map((o) => o.type).filter((t): t is string => !!t))).sort(),
    [orgaos],
  )

  /**
   * CSV a partir do que está NA TELA — o mesmo recorte que o operador conferiu.
   * Exportar reconsultando o servidor abriria a chance de o arquivo trazer linha
   * que a tela não mostrou.
   */
  function exportarCsv() {
    if (!dados) return
    const cab = ["Data", "Protocolo", "Nº do processo", "Órgão", "Cidade", "País do órgão", "Processo", "Família", "Requerentes", "Finalidade", "Situação", "Exigências abertas"]
    const linhas = dados.protocolos.map((p) => [
      dataBR(p.dataProtocolo), p.numeroProtocolo ?? "", p.numeroProcesso ?? "",
      p.orgao?.name ?? "", p.orgao?.city ?? "", p.orgao?.country ?? "",
      p.processo ? `${p.processo.codigo ?? p.processo.id} — ${p.processo.nome}` : "",
      p.processo?.familia?.nome ?? "", p.requerentes.map((r) => r.nome).join(" | "),
      ROTULO_FINALIDADE[p.finalidade] ?? p.finalidade, ROTULO_SITUACAO[p.situacao] ?? p.situacao,
      String(p.exigenciasAbertas),
    ])
    const csv = [cab, ...linhas]
      .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n")
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `protocolos-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className={`${CARD} p-5`}>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Relatório de Protocolos</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Tudo o que foi protocolado, em qualquer órgão e em qualquer rota. O consulado espanhol, onde cada
          requerente tem o seu expediente, e o tribunal italiano, onde um ricorso cobre a família inteira,
          respondem à mesma pergunta pela mesma consulta.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Órgão (consulado, tribunal…)</label>
            <select value={f.orgaoId} onChange={(e) => setF({ ...f, orgaoId: e.target.value })} className={INPUT}>
              <option value="">Todos os órgãos</option>
              {orgaos.map((o) => (
                <option key={o.id} value={String(o.id)}>{o.name}{o.country ? ` · ${o.country}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Tipo de órgão</label>
            <select value={f.orgaoTipo} onChange={(e) => setF({ ...f, orgaoTipo: e.target.value })} className={INPUT}>
              <option value="">Todos os tipos</option>
              {tiposDeOrgao.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Família</label>
            <select value={f.familiaId} onChange={(e) => setF({ ...f, familiaId: e.target.value })} className={INPUT}>
              <option value="">Todas as famílias</option>
              {familias.map((x) => <option key={x.id} value={String(x.id)}>{x.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Finalidade</label>
            <select value={f.finalidade} onChange={(e) => setF({ ...f, finalidade: e.target.value })} className={INPUT}>
              <option value="">Todas</option>
              {Object.entries(ROTULO_FINALIDADE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Situação no órgão</label>
            <select value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })} className={INPUT}>
              <option value="">Todas</option>
              {Object.entries(ROTULO_SITUACAO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Protocolado de</label>
            <input type="date" value={f.de} onChange={(e) => setF({ ...f, de: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">até</label>
            <input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} className={INPUT} />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={f.exigenciaAberta}
                onChange={(e) => setF({ ...f, exigenciaAberta: e.target.checked })}
                className="h-4 w-4 accent-[var(--action-primary)]"
              />
              Só com exigência em aberto
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void consultar()}
            disabled={carregando}
            className="rounded-md px-4 py-2 text-sm font-semibold text-[var(--action-primary-ink)] disabled:opacity-60"
            style={{ backgroundColor: "var(--action-primary)" }}
          >
            {carregando ? "Consultando…" : "Consultar"}
          </button>
          <button
            onClick={() => { setF({ orgaoId: "", orgaoTipo: "", familiaId: "", finalidade: "", situacao: "", de: "", ate: "", exigenciaAberta: false }) }}
            className="rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            Limpar filtros
          </button>
          <button
            onClick={exportarCsv}
            disabled={!dados || dados.protocolos.length === 0}
            className="ml-auto rounded-md border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {erro && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: "var(--danger-tile)", color: "var(--danger-text)" }}>
          {erro}
        </div>
      )}

      {dados && dados.porOrgao.length > 0 && (
        <div className={`${CARD} p-5`}>
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Por órgão</h3>
          <div className="flex flex-wrap gap-2">
            {dados.porOrgao.map((o) => (
              <div key={String(o.orgaoId)} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3 py-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">{o.nome}</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {o.total} protocolo(s) · {o.requerentes} requerente(s){o.pais ? ` · ${o.pais}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`overflow-x-auto ${CARD}`}>
        <div className="flex items-center justify-between px-4 py-3 text-xs text-[var(--text-secondary)]">
          <span>{dados ? `${dados.total} protocolo(s)` : "—"}</span>
          {dados?.truncado && <span style={{ color: "var(--warning-text)" }}>Mostrando os 2.000 mais recentes — refine os filtros.</span>}
        </div>
        <table className="w-full text-sm">
          <thead className="border-y border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Órgão</th>
              <th className="px-4 py-3 font-medium">Protocolo</th>
              <th className="px-4 py-3 font-medium">Nº do processo</th>
              <th className="px-4 py-3 font-medium">Processo · Família</th>
              <th className="px-4 py-3 font-medium">Requerentes</th>
              <th className="px-4 py-3 font-medium">Finalidade</th>
              <th className="px-4 py-3 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {!dados || dados.protocolos.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
                  {carregando ? "Consultando…" : "Nenhum protocolo para estes filtros."}
                </td>
              </tr>
            ) : dados.protocolos.map((p) => (
              <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dataBR(p.dataProtocolo)}</td>
                <td className="px-4 py-2.5 text-[var(--text-primary)]">
                  {p.orgao?.name ?? "—"}
                  {p.orgao?.city && <span className="block text-[11px] text-[var(--text-muted)]">{p.orgao.city}</span>}
                </td>
                <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">{p.numeroProtocolo ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--text-primary)]">{p.numeroProcesso ?? "—"}</td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                  {p.processo ? `${p.processo.codigo ?? `#${p.processo.id}`} — ${p.processo.nome}` : "—"}
                  {p.processo?.familia && <span className="block text-[11px] text-[var(--text-muted)]">{p.processo.familia.nome}</span>}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                  {p.requerentes.length === 0 ? "—" : p.requerentes.map((r) => r.nome).join(" · ")}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{ROTULO_FINALIDADE[p.finalidade] ?? p.finalidade}</td>
                <td className="px-4 py-2.5">
                  <span className="text-xs font-medium" style={{ color: corDaSituacao(p.situacao) }}>
                    {ROTULO_SITUACAO[p.situacao] ?? p.situacao}
                  </span>
                  {p.exigenciasAbertas > 0 && (
                    <span className="block text-[11px]" style={{ color: "var(--warning-text)" }}>
                      {p.exigenciasAbertas} exigência(s) em aberto
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
