"use client"

// src/components/gerenciamentoComponents/CatalogoFasesTab.tsx
// PROCESSOS → ESTRUTURA → FASES.
// Cadastro ÚNICO das fases do sistema (CatalogoFase). O Workflow Macro só
// REFERENCIA estas fases ao montar a sequência de cada processo — nenhum outro
// módulo cadastra fase.
// Backend: /api/gerenciamento/catalogo-fases (GET/POST) + /[id] (PUT/DELETE)

import { useEffect, useState, useCallback } from "react"
import { useApi } from "@/src/lib/dados"

interface EfeitoCat { key: string; label: string; descricao: string; competencia: string }

interface Fase {
  id: number
  phaseKey: string
  label: string
  descricao: string | null
  escopo: Escopo | null
  /** Efeitos que os passos desta fase podem executar. null = sem restrição declarada. */
  efeitosPermitidos?: string[] | null
  ordemPadrao: number
  requiredPadrao: boolean
  conditionalPadrao: boolean
  slaDiasPadrao: number
  ativo: boolean
  usos: number
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"
const IEdit = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

/**
 * SOBRE O QUE A FASE OPERA. É o que decide sobre quantas entidades os passos se
 * multiplicam quando a fase é materializada — um roteiro por certidão, por pessoa,
 * por registro a localizar, ou um só para o processo inteiro. Sem esta escolha a
 * fase existe no cadastro e não pode compor fluxo nenhum.
 */
type Escopo = "PROCESSO" | "PESSOA" | "NECESSIDADE" | "DOCUMENTO"
const ESCOPOS: Array<{ v: Escopo; nome: string; ajuda: string }> = [
  { v: "PROCESSO", nome: "Processo", ajuda: "um roteiro único para o processo inteiro" },
  { v: "PESSOA", nome: "Pessoa", ajuda: "um roteiro por pessoa da árvore" },
  { v: "NECESSIDADE", nome: "Registro a localizar", ajuda: "um roteiro por certidão que precisa ser encontrada" },
  { v: "DOCUMENTO", nome: "Documento", ajuda: "um roteiro por documento materializado" },
]

type Form = {
  id?: number
  phaseKey: string
  label: string
  descricao: string
  escopo: Escopo | ""
  efeitosPermitidos: string[] | null
  ordemPadrao: number
  requiredPadrao: boolean
  conditionalPadrao: boolean
  slaDiasPadrao: number
  ativo: boolean
}

const vazio = (ordem: number): Form => ({
  phaseKey: "", label: "", descricao: "", escopo: "", efeitosPermitidos: null, ordemPadrao: ordem, requiredPadrao: true,
  conditionalPadrao: false, slaDiasPadrao: 30, ativo: true,
})

export default function CatalogoFasesTab() {
  // O catálogo de efeitos vem do SERVIDOR. Escrevê-lo aqui faria a tela oferecer
  // competências que o motor não conhece — o mesmo erro, noutro lugar.
  const [efeitos, setEfeitos] = useState<EfeitoCat[]>([])
  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("token") : null
    fetch("/api/gerenciamento/catalogo-execucao", { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(r => (r.ok ? r.json() : null))
      .then(d => d?.efeitos && setEfeitos(d.efeitos))
      .catch(() => setEfeitos([]))
  }, [])

  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")
  // Erro de ESCRITA continua em estado; o de LEITURA vem da consulta.
  const [erroEscrita, setErroEscrita] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)

  // Leitura pela camada oficial: cache, dedupe e revalidação únicos, em lugar do
  // `load` + `useEffect(() => load(), [load])` que cada aba reimplementava.
  const consulta = useApi<{ fases?: Fase[] }>("/api/gerenciamento/catalogo-fases")
  const rows = consulta.dados?.fases ?? []
  const loading = consulta.carregando
  // A mensagem original era a mesma para falha de rede e para erro do servidor.
  const erro = erroEscrita ?? (consulta.erro ? consulta.erro.message : null)
  const setErro = setErroEscrita
  const load = consulta.recarregar
  // As telas atualizavam a lista na mão depois de salvar/excluir, com a entidade
  // que o servidor devolveu. Isso continua: a mesma transformação entra no cache
  // como dado otimista e o SWR confirma com o servidor em seguida — a tela responde
  // na hora e não fica divergindo do banco.
  const atualizarLista = (fn: (rs: Fase[]) => Fase[]) => { void consulta.recarregar({ fases: fn(rows) }) }

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3000) }

  async function save() {
    if (!form) return
    if (!form.label.trim()) { showFlash("Informe o nome da fase."); return }
    setBusy(true)
    try {
      const url = form.id ? `/api/gerenciamento/catalogo-fases/${form.id}` : "/api/gerenciamento/catalogo-fases"
      const res = await fetch(url, { method: form.id ? "PUT" : "POST", headers: authHeaders(), body: JSON.stringify(form) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.fase) {
        atualizarLista(rs => {
          const i = rs.findIndex(x => x.id === j.fase.id)
          const next = i < 0 ? [...rs, j.fase] : rs.map(x => (x.id === j.fase.id ? j.fase : x))
          return next.sort((x, y) => x.ordemPadrao - y.ordemPadrao || x.label.localeCompare(y.label))
        })
        setForm(null); showFlash("Fase salva.")
      } else showFlash(j.error || "Erro ao salvar a fase.")
    } finally { setBusy(false) }
  }

  async function del(f: Fase) {
    if (f.usos > 0) { showFlash(`"${f.label}" é usada em ${f.usos} fluxo(s). Inative em vez de excluir.`); return }
    if (!confirm(`Excluir a fase "${f.label}" do catálogo? Só é possível porque nenhum fluxo a utiliza.`)) return
    const res = await fetch(`/api/gerenciamento/catalogo-fases/${f.id}`, { method: "DELETE", headers: authHeaders() })
    const j = await res.json().catch(() => ({}))
    if (res.ok) { atualizarLista(rs => rs.filter(x => x.id !== f.id)); showFlash("Fase excluída.") }
    else showFlash(j.error || "Erro ao excluir a fase.")
  }

  async function toggleAtivo(f: Fase) {
    const res = await fetch(`/api/gerenciamento/catalogo-fases/${f.id}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ ativo: !f.ativo }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.fase) { atualizarLista(rs => rs.map(x => (x.id === f.id ? j.fase : x))); showFlash(j.fase.ativo ? "Fase ativada." : "Fase inativada.") }
    else showFlash(j.error || "Erro ao alterar a fase.")
  }

  const proximaOrdem = rows.length ? Math.max(...rows.map(r => r.ordemPadrao)) + 10 : 10

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-green-700">{flash}</div>}
      {erro && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-red-700">
          {erro} <button onClick={() => { void load() }} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Fases</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
              Cadastro único das fases do sistema. O Workflow apenas referencia estas fases ao montar a
              sequência de cada processo — nenhum outro módulo cadastra fases.
            </p>
          </div>
          <button
            onClick={() => setForm(vazio(proximaOrdem))}
            className="flex-none rounded-lg bg-[var(--action-primary)] px-3 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]"
          >
            + Nova fase
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-3 font-medium">Ordem</th>
              <th className="px-4 py-3 font-medium">Fase</th>
              <th className="px-4 py-3 font-medium">Chave</th>
              <th className="px-4 py-3 font-medium">Padrões</th>
              <th className="px-4 py-3 font-medium">SLA</th>
              <th className="px-4 py-3 font-medium">Usada em</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">Nenhuma fase no catálogo. Cadastre a primeira em “+ Nova fase”.</td></tr>
            ) : rows.map(f => (
              <tr key={f.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{f.ordemPadrao}</td>
                <td className="px-4 py-2.5 text-white">{f.label}</td>
                <td className="px-4 py-2.5"><code className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[11px] text-white/70">{f.phaseKey}</code></td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1 text-[10px]">
                    {f.requiredPadrao && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-white/70">obrigatória</span>}
                    {f.conditionalPadrao && <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-amber-700">condicional</span>}
                    {!f.requiredPadrao && !f.conditionalPadrao && <span className="text-[var(--text-muted)]">—</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-white/70">{f.slaDiasPadrao} d</td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{f.usos ? `${f.usos} fluxo(s)` : "—"}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => toggleAtivo(f)}
                    title={f.ativo ? "Inativar (some do seletor de fases, sem apagar)" : "Ativar"}
                    className={`rounded-full px-2 py-0.5 text-[10px] ${f.ativo ? "bg-[var(--surface-secondary)] text-green-700" : "bg-[var(--surface-primary)] text-[var(--text-secondary)]"}`}
                  >
                    {f.ativo ? "Ativa" : "Inativa"}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-0.5 text-[var(--text-secondary)]">
                    <button
                      title="Editar" aria-label="Editar"
                      onClick={() => setForm({
                        id: f.id, phaseKey: f.phaseKey, label: f.label, ordemPadrao: f.ordemPadrao,
                        descricao: f.descricao ?? "", escopo: f.escopo ?? "",
                        efeitosPermitidos: f.efeitosPermitidos ?? null,
                        requiredPadrao: f.requiredPadrao, conditionalPadrao: f.conditionalPadrao,
                        slaDiasPadrao: f.slaDiasPadrao, ativo: f.ativo,
                      })}
                      className="rounded p-1 hover:bg-[var(--surface-hover)] hover:text-white"
                    ><IEdit /></button>
                    <button
                      title={f.usos > 0 ? `Em uso em ${f.usos} fluxo(s) — inative em vez de excluir` : "Excluir"}
                      aria-label="Excluir"
                      disabled={f.usos > 0}
                      onClick={() => del(f)}
                      className="rounded p-1 text-red-700/70 hover:bg-[var(--surface-secondary)] hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30"
                    ><ITrash /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setForm(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]" onClick={e => e.stopPropagation()}>
            <div className="border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="font-semibold text-white">{form.id ? "Editar fase" : "Nova fase"}</h3>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Os padrões abaixo são sugeridos ao adicionar a fase a um fluxo — cada fluxo pode ajustá-los.</p>
            </div>
            <div className="space-y-3 px-6 py-4">
              <div>
                <label className={labelCls}>Nome da fase *</label>
                <input value={form.label} onChange={e => setForm(f => f && { ...f, label: e.target.value })} className={inputCls} placeholder="Ex.: Emissão de Certidões" />
              </div>
              <div>
                <label className={labelCls}>Chave {form.id ? "(imutável)" : "(gerada do nome se vazia)"}</label>
                <input
                  value={form.phaseKey}
                  disabled={!!form.id}
                  onChange={e => setForm(f => f && { ...f, phaseKey: e.target.value })}
                  className={`${inputCls} disabled:opacity-50`}
                  placeholder="emissao_certidoes"
                />
                {form.id && <p className="mt-1 text-[11px] text-[var(--text-muted)]">A chave é o vínculo com fluxos, automações e runtime — não pode ser alterada.</p>}
              </div>
              <div className="mt-3">
                <label className={labelCls}>Descrição</label>
                <textarea
                  value={form.descricao}
                  onChange={e => setForm(f => f && { ...f, descricao: e.target.value })}
                  rows={2}
                  className={inputCls}
                  placeholder="O que acontece nesta fase, em uma frase."
                />
              </div>

              {/* ESCOPO — a escolha que torna a fase utilizável. Fica junto do nome
                  de propósito: é decisão estrutural, não configuração fina. */}
              <div className="mt-3">
                <label className={labelCls}>Opera sobre *{form.id ? " (imutável enquanto a fase estiver em uso)" : ""}</label>
                <select
                  value={form.escopo}
                  onChange={e => setForm(f => f && { ...f, escopo: e.target.value as Escopo })}
                  className={inputCls}
                >
                  <option value="" className="bg-zinc-900">— escolher —</option>
                  {ESCOPOS.map(e => (
                    <option key={e.v} value={e.v} className="bg-zinc-900">{e.nome} — {e.ajuda}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Decide quantos roteiros a fase cria: um por documento, por pessoa, por registro — ou um só para o processo.
                </p>
              </div>

              {/* COMPETÊNCIA — o que os passos desta fase podem FAZER.
                  Sem isto declarado, qualquer fase podia disparar qualquer efeito, e foi
                  por aí que a decisão de retificar — que é da Análise — passou a poder
                  ser tomada na Emissão. */}
              <div className="mt-3">
                <label className={labelCls}>Esta fase pode</label>
                {efeitos.length === 0 && <p className="text-[11px] text-[var(--text-muted)]">Carregando o catálogo de efeitos…</p>}
                <div className="mt-1 max-h-52 space-y-1 overflow-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-2">
                  {efeitos.map(ef => {
                    const lista = form.efeitosPermitidos
                    const marcado = lista === null ? true : lista.includes(ef.key)
                    return (
                      <label key={ef.key} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-[var(--surface-hover)]">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={marcado}
                          onChange={() => {
                            const base = lista === null ? efeitos.map(e => e.key) : lista
                            const nova = marcado ? base.filter(k => k !== ef.key) : [...base, ef.key]
                            setForm(f => f && { ...f, efeitosPermitidos: nova })
                          }}
                        />
                        <span className="min-w-0">
                          <span className="text-xs text-white">{ef.label}</span>
                          <span className="ml-1.5 rounded bg-[var(--surface-primary)] px-1 py-0.5 text-[10px] text-[var(--text-secondary)]">{ef.competencia}</span>
                          <span className="block text-[11px] text-[var(--text-muted)]">{ef.descricao}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  A publicação de um workflow desta fase recusa qualquer resultado cujo efeito não esteja marcado aqui.
                  {form.efeitosPermitidos === null && " Hoje esta fase não declara nada — ela pode tudo."}
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Ordem padrão <span className="text-[var(--text-muted)]">(só sugestão ao criar fluxo novo)</span></label>
                  <input type="number" value={form.ordemPadrao} onChange={e => setForm(f => f && { ...f, ordemPadrao: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>SLA padrão (dias)</label>
                  <input type="number" min="0" value={form.slaDiasPadrao} onChange={e => setForm(f => f && { ...f, slaDiasPadrao: Number(e.target.value) })} className={inputCls} />
                </div>
              </div>
              <div className="space-y-1.5 border-t border-[var(--border-default)] pt-3">
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" checked={form.requiredPadrao} onChange={e => setForm(f => f && { ...f, requiredPadrao: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                  Obrigatória por padrão
                </label>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" checked={form.conditionalPadrao} onChange={e => setForm(f => f && { ...f, conditionalPadrao: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                  Condicional por padrão
                </label>
                <label className="flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" checked={form.ativo} onChange={e => setForm(f => f && { ...f, ativo: e.target.checked })} className="h-3.5 w-3.5 accent-blue-500" />
                  Ativa (aparece no seletor de fases dos fluxos)
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setForm(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/80 hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button disabled={busy} onClick={save} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
