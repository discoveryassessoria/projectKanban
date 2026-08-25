"use client"
// src/components/gerenciamentoComponents/CanaisOperacionaisTab.tsx
//
// OS CANAIS SÃO CADASTRO.
//
// CRC, e-cartório, e-mail, WhatsApp, balcão, comune, correios, consulado viviam num
// array de código: acrescentar "Portal Estadual" era um deploy. Aqui eles são dado,
// com o que cada um exige — protocolo no ato, comprovante, rastreio, observação.
//
// A CHAVE NÃO SE EDITA. Ela é o que as solicitações já enviadas referenciam; trocá-la
// desligaria o histórico do canal que o produziu. O rótulo muda à vontade.

import { useEffect, useState } from "react"
import CanaisPorOrganizacaoPanel from "./CanaisPorOrganizacaoPanel"

interface Canal {
  id: number
  key: string
  label: string
  descricao: string | null
  ordem: number
  ativo: boolean
  protocoloObrigatorio: boolean
  anexoObrigatorioLabel: string | null
  rastreioObrigatorio: boolean
  observacaoObrigatoria: boolean
}

const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--border-default)]"
const lbl = "mb-1 block text-[11px] uppercase tracking-wide text-[var(--text-muted)]"

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

const VAZIO = {
  key: "", label: "", descricao: "", protocoloObrigatorio: false,
  anexoObrigatorioLabel: "", rastreioObrigatorio: false, observacaoObrigatoria: false,
}

export default function CanaisOperacionaisTab() {
  const [visao, setVisao] = useState<"tipos" | "organizacoes">("organizacoes")
  const [canais, setCanais] = useState<Canal[] | null>(null)
  const [erro, setErro] = useState("")
  const [form, setForm] = useState<typeof VAZIO | null>(null)
  const [editando, setEditando] = useState<Canal | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    try {
      const r = await fetch("/api/gerenciamento/canais", { headers: headers() })
      const j = await r.json()
      setCanais(j.canais ?? [])
    } catch { setErro("Não foi possível carregar os canais.") }
  }
  useEffect(() => {
    // Ver o comentário equivalente no painel da etapa: a carga sai do corpo do efeito
    // para o primeiro `setState` não cair na mesma passagem de render.
    let vivo = true
    void Promise.resolve().then(() => { if (vivo) return carregar() })
    return () => { vivo = false }
  }, [])

  async function criar() {
    if (!form) return
    setSalvando(true); setErro("")
    try {
      const r = await fetch("/api/gerenciamento/canais", { method: "POST", headers: headers(), body: JSON.stringify(form) })
      const j = await r.json()
      if (!r.ok) setErro(j.error ?? "Não foi possível cadastrar.")
      else { setForm(null); await carregar() }
    } finally { setSalvando(false) }
  }

  async function salvar(c: Canal) {
    setSalvando(true); setErro("")
    try {
      const r = await fetch("/api/gerenciamento/canais", { method: "PUT", headers: headers(), body: JSON.stringify(c) })
      const j = await r.json()
      if (!r.ok) setErro(j.error ?? "Não foi possível salvar.")
      else { setEditando(null); await carregar() }
    } finally { setSalvando(false) }
  }

  if (canais === null) return <div className="p-6 text-sm text-[var(--text-secondary)]">Carregando canais…</div>

  return (
    <div className="space-y-4 p-1">
      <div>
        <h2 className="text-lg font-semibold text-white">Canais de atendimento</h2>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
          Duas perguntas diferentes, dois donos. <b>Tipos</b> é o vocabulário do domínio — quais canais existem
          e o que cada um exige. <b>Por organização</b> é a disponibilidade real: por onde cada cartório atende.
          O workflow não copia nenhuma das duas; ele referencia os canais do fornecedor relacionado.
        </p>
      </div>

      <div className="flex gap-1 border-b border-[var(--border-default)]">
        {(["tipos", "organizacoes"] as const).map((v) => (
          <button key={v} onClick={() => setVisao(v)}
            className={`rounded-t-lg px-3 py-2 text-xs ${visao === v ? "bg-[var(--surface-primary)] text-white" : "text-[var(--text-secondary)] hover:text-white/80"}`}>
            {v === "tipos" ? "Tipos de canal" : "Por organização"}
          </button>
        ))}
      </div>

      {visao === "organizacoes" && <CanaisPorOrganizacaoPanel />}
      {visao === "tipos" && (
      <div className="space-y-4">

      {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-red-700">{erro}</div>}

      <div className="space-y-1.5">
        {canais.length === 0 && (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
            Nenhum canal cadastrado ainda.
          </div>
        )}
        {canais.map((c) => (
          <div key={c.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
            {editando?.id === c.id ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={lbl}>Nome</label>
                    <input className={inp} value={editando.label} onChange={(e) => setEditando({ ...editando, label: e.target.value })} /></div>
                  <div><label className={lbl}>Chave (não editável)</label>
                    <input className={`${inp} opacity-50`} value={editando.key} disabled /></div>
                </div>
                <div><label className={lbl}>Descrição</label>
                  <input className={inp} value={editando.descricao ?? ""} onChange={(e) => setEditando({ ...editando, descricao: e.target.value })} /></div>
                <div><label className={lbl}>Comprovante exigido (vazio = opcional)</label>
                  <input className={inp} value={editando.anexoObrigatorioLabel ?? ""} onChange={(e) => setEditando({ ...editando, anexoObrigatorioLabel: e.target.value })} /></div>
                <div className="flex flex-wrap gap-4 text-xs text-white/70">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={editando.protocoloObrigatorio} onChange={(e) => setEditando({ ...editando, protocoloObrigatorio: e.target.checked })} /> Devolve protocolo no ato</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={editando.rastreioObrigatorio} onChange={(e) => setEditando({ ...editando, rastreioObrigatorio: e.target.checked })} /> Exige rastreio</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={editando.observacaoObrigatoria} onChange={(e) => setEditando({ ...editando, observacaoObrigatoria: e.target.checked })} /> Exige observação</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo</label>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditando(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs text-white/70">Cancelar</button>
                  <button onClick={() => salvar(editando)} disabled={salvando} className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] disabled:opacity-50">Salvar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white">{c.label}</span>
                    <code className="text-[10px] text-[var(--text-muted)]">{c.key}</code>
                    {!c.ativo && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">inativo</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px]">
                    {c.protocoloObrigatorio && <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[var(--text-secondary)]">protocolo no ato</span>}
                    {c.anexoObrigatorioLabel && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">{c.anexoObrigatorioLabel}</span>}
                    {c.rastreioObrigatorio && <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-amber-800">rastreio</span>}
                    {c.observacaoObrigatoria && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">observação</span>}
                  </div>
                </div>
                <button onClick={() => setEditando(c)} className="flex-none rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1 text-xs text-white/70 hover:bg-[var(--surface-hover)]">Editar</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {form ? (
        <div className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Nome do canal</label>
              <input className={inp} autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ex.: Portal Estadual" /></div>
            <div><label className={lbl}>Chave (em branco = derivada do nome)</label>
              <input className={inp} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="PORTAL_ESTADUAL" /></div>
          </div>
          <div><label className={lbl}>Descrição</label>
            <input className={inp} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
          <div><label className={lbl}>Comprovante exigido (vazio = opcional)</label>
            <input className={inp} value={form.anexoObrigatorioLabel} onChange={(e) => setForm({ ...form, anexoObrigatorioLabel: e.target.value })} /></div>
          <div className="flex flex-wrap gap-4 text-xs text-white/70">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.protocoloObrigatorio} onChange={(e) => setForm({ ...form, protocoloObrigatorio: e.target.checked })} /> Devolve protocolo no ato</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.rastreioObrigatorio} onChange={(e) => setForm({ ...form, rastreioObrigatorio: e.target.checked })} /> Exige rastreio</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.observacaoObrigatoria} onChange={(e) => setForm({ ...form, observacaoObrigatoria: e.target.checked })} /> Exige observação</label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setForm(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs text-white/70">Cancelar</button>
            <button onClick={criar} disabled={salvando || !form.label.trim()} className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] disabled:opacity-50">Cadastrar canal</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setForm({ ...VAZIO })} className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">+ Canal</button>
      )}
      </div>
      )}
    </div>
  )
}
