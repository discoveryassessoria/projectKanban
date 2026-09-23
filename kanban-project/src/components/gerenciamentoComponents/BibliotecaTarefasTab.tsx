"use client"
// src/components/gerenciamentoComponents/BibliotecaTarefasTab.tsx
//
// BIBLIOTECA DE TAREFAS DOS WORKFLOWS INTERNOS (mandato 22/09/2026) — tela
// administrativa do MODELO (identidade + versão publicada). Nesta entrega,
// deliberadamente, NÃO existe vínculo a fase/tipo/modalidade aqui: criar,
// editar e publicar um Modelo nunca cria Tarefa, nunca altera um Processo e
// nunca muda outro Workflow — só a definição reutilizável em si.
//
// Reaproveita 100% o editor existente do Workflow Interno
// (ConfiguracaoDoPassoModal) e a porta de salvar (`PUT
// /api/gerenciamento/workflows-fase/[workflowId]`) — o Modelo é armazenado
// como a "casca" de um PhaseInternalWorkflow com exatamente um passo. A
// publicação, porém, passa pela porta PRÓPRIA do Modelo
// (`/api/gerenciamento/biblioteca-tarefas/modelos/[id]/publicar`), que é
// quem mantém `BibliotecaModeloTarefa.status`/`versaoPublicada` em sincronia
// com a versão congelada do workflow.

import { useEffect, useState, useCallback } from "react"
import ConfiguracaoDoPassoModal, { type PassoConfiguravel } from "./ConfiguracaoDoPassoModal"

// ============================================================
// Tipos
// ============================================================
interface ModeloPasso {
  id: number
  key: string
  label: string
  regraDeConclusao?: string | null
  _count: { subtarefas: number }
}
interface Modelo {
  id: number
  chave: string
  nome: string
  descricao: string | null
  status: "RASCUNHO" | "PUBLICADO" | "INATIVO"
  versaoPublicada: number | null
  ativo: boolean
  workflowId: number
  temAlteracaoNaoPublicada: boolean
  passo: ModeloPasso | null
  usadoEm: Array<{ stepId: number; stepKey: string; versaoSelecionada: number | null; workflowId: number; phaseKey: string; tipoProcessoId: number | null; workflowNome: string }>
  criadoEm: string
  atualizadoEm: string
}
interface Preview {
  versaoAtual: number
  versaoNova: number
  temRascunho: boolean
  mudancas: Array<{ escopo: string; tipo: string; passo: string; alvo: string; detalhe: string }>
  problemas: Array<{ codigo: string; stepKey: string | null; mensagem: string }>
  podePublicar: boolean
  aviso: string
}

// ============================================================
// Helpers
// ============================================================
function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` }
           : { "Content-Type": "application/json" }
}
function slug(s: string) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"
const btnPrimary = "rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
const btnSecondary = "rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs text-white/80 hover:bg-white/5 disabled:opacity-40"

const STATUS_BADGE: Record<Modelo["status"], string> = {
  RASCUNHO: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  PUBLICADO: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  INATIVO: "bg-white/5 text-white/40 border-white/10",
}

// ============================================================
// Componente
// ============================================================
export default function BibliotecaTarefasTab() {
  const [modelos, setModelos] = useState<Modelo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")

  const [criando, setCriando] = useState(false)
  const [novaChave, setNovaChave] = useState("")
  const [novoNome, setNovoNome] = useState("")
  const [novaDescricao, setNovaDescricao] = useState("")

  const [duplicandoDe, setDuplicandoDe] = useState<Modelo | null>(null)
  const [dupChave, setDupChave] = useState("")
  const [dupNome, setDupNome] = useState("")

  const [editando, setEditando] = useState<{ modelo: Modelo; passo: PassoConfiguravel } | null>(null)
  const [problemas, setProblemas] = useState<Array<{ codigo: string; stepKey: string | null; mensagem: string }>>([])

  const [publicando, setPublicando] = useState<Modelo | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [carregandoPreview, setCarregandoPreview] = useState(false)

  function showFlash(msg: string) { setFlash(msg); setTimeout(() => setFlash(""), 4000) }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/biblioteca-tarefas/modelos", { headers: authHeaders() })
      const j = await res.json().catch(() => ({}))
      if (res.ok) setModelos(j.modelos ?? [])
      else showFlash(j.error || "Erro ao carregar a Biblioteca de Tarefas.")
    } catch { showFlash("Erro de conexão ao carregar a Biblioteca de Tarefas.") }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // ---------- criar ----------
  async function criarModelo() {
    if (!novoNome.trim()) { showFlash("Informe o nome do modelo."); return }
    setBusy(true)
    try {
      const chave = novaChave.trim() ? slug(novaChave) : slug(novoNome)
      const res = await fetch("/api/gerenciamento/biblioteca-tarefas/modelos", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ chave, nome: novoNome.trim(), descricao: novaDescricao.trim() || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        showFlash(`Modelo "${novoNome}" criado (rascunho).`)
        setCriando(false); setNovaChave(""); setNovoNome(""); setNovaDescricao("")
        await load()
      } else showFlash(j.error || "Erro ao criar o modelo.")
    } catch { showFlash("Erro de conexão ao criar o modelo.") }
    finally { setBusy(false) }
  }

  // ---------- duplicar ----------
  async function confirmarDuplicar() {
    if (!duplicandoDe) return
    if (!dupNome.trim()) { showFlash("Informe o nome da cópia."); return }
    setBusy(true)
    try {
      const chave = dupChave.trim() ? slug(dupChave) : slug(`${duplicandoDe.chave}_copia`)
      const res = await fetch("/api/gerenciamento/biblioteca-tarefas/modelos", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ duplicarDeModeloId: duplicandoDe.id, chave, nome: dupNome.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        showFlash(`"${duplicandoDe.nome}" duplicado como "${dupNome}" (rascunho, conteúdo copiado).`)
        setDuplicandoDe(null); setDupChave(""); setDupNome("")
        await load()
      } else showFlash(j.error || "Erro ao duplicar.")
    } catch { showFlash("Erro de conexão ao duplicar.") }
    finally { setBusy(false) }
  }

  // ---------- inativar / reativar ----------
  async function alternarAtivo(m: Modelo) {
    setBusy(true)
    try {
      const acao = m.status === "INATIVO" ? "reativar" : "inativar"
      const res = await fetch(`/api/gerenciamento/biblioteca-tarefas/modelos/${m.id}`, {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ acao }),
      })
      if (res.ok) { showFlash(acao === "inativar" ? `"${m.nome}" inativado.` : `"${m.nome}" reativado.`); await load() }
      else { const j = await res.json().catch(() => ({})); showFlash(j.error || "Erro ao alterar o modelo.") }
    } catch { showFlash("Erro de conexão.") }
    finally { setBusy(false) }
  }

  // ---------- abrir editor (reaproveita ConfiguracaoDoPassoModal) ----------
  async function abrirEditor(m: Modelo) {
    setBusy(true)
    try {
      const res = await fetch(`/api/gerenciamento/workflows-fase/${m.workflowId}`, { headers: authHeaders() })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.workflow) { showFlash(j.error || "Erro ao abrir o modelo."); return }
      const passo = j.workflow.passos?.[0]
      if (!passo) { showFlash("Modelo sem passo — cadastro inconsistente."); return }
      setEditando({ modelo: m, passo: passo as PassoConfiguravel })
      setProblemas([])
    } catch { showFlash("Erro de conexão ao abrir o modelo.") }
    finally { setBusy(false) }
  }

  async function salvarPasso(p: PassoConfiguravel) {
    if (!editando) return
    setBusy(true)
    try {
      const res = await fetch(`/api/gerenciamento/workflows-fase/${editando.modelo.workflowId}`, {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ steps: [p] }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.workflow) {
        setProblemas([])
        showFlash("Conteúdo salvo (rascunho) — publique para valer.")
        setEditando(null)
        await load()
      } else if (Array.isArray(j.problemas)) {
        setProblemas(j.problemas)
        showFlash("Não foi possível salvar — veja os motivos abaixo.")
      } else showFlash(j.error || "Erro ao salvar o modelo.")
    } catch { showFlash("Erro de conexão ao salvar o modelo.") }
    finally { setBusy(false) }
  }

  // ---------- publicar ----------
  async function abrirPublicar(m: Modelo) {
    setPublicando(m); setPreview(null); setCarregandoPreview(true)
    try {
      const res = await fetch(`/api/gerenciamento/workflows-fase/${m.workflowId}?preview=1`, { headers: authHeaders() })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.preview) setPreview(j.preview)
      else showFlash(j.error || "Erro ao carregar a prévia de publicação.")
    } catch { showFlash("Erro de conexão ao carregar a prévia.") }
    finally { setCarregandoPreview(false) }
  }
  async function confirmarPublicar() {
    if (!publicando) return
    setBusy(true)
    try {
      const res = await fetch(`/api/gerenciamento/biblioteca-tarefas/modelos/${publicando.id}/publicar`, {
        method: "POST", headers: authHeaders(),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        // PROPAGAÇÃO AUTOMÁTICA (decisão definitiva 23/09/2026) — publicar o
        // Modelo já atualiza toda fase real que o selecionou, aplicando o
        // que é seguro aos processos em andamento. O admin precisa VER isso
        // acontecer, não só confiar que aconteceu.
        const fasesAtualizadas: number = j.fasesAtualizadas ?? 0
        const fasesComErro: Array<{ phaseKey: string; erro: string }> = j.fasesComErro ?? []
        const resumoFases = fasesAtualizadas > 0 ? ` Propagado para ${fasesAtualizadas} fase(s) em uso.` : ""
        const resumoErros = fasesComErro.length > 0
          ? ` ATENÇÃO: ${fasesComErro.length} fase(s) não puderam ser atualizadas (${fasesComErro.map((f) => f.phaseKey).join(", ")}) — confira o Workflow Interno delas.`
          : ""
        showFlash(`"${publicando.nome}" publicado — v${j.versaoNova}.${resumoFases}${resumoErros}`)
        setPublicando(null); setPreview(null)
        await load()
      } else showFlash(j.error || j.mensagem || "Erro ao publicar.")
    } catch { showFlash("Erro de conexão ao publicar.") }
    finally { setBusy(false) }
  }

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Biblioteca de Tarefas</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Modelos reutilizáveis de tarefa — identidade, conteúdo (subtarefas, campos, ações, dependências) e versão.
            Vincular um modelo a uma fase de um Workflow Interno é uma entrega separada; criar ou publicar um modelo
            aqui não cria tarefa, não altera processo e não muda nenhum outro Workflow.
          </p>
        </div>
        <button className={btnPrimary} disabled={busy} onClick={() => setCriando(true)}>+ Novo modelo</button>
      </div>

      {flash && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/90">{flash}</div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-[var(--text-muted)]">Carregando…</div>
      ) : !modelos || modelos.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center text-sm text-[var(--text-muted)]">
          Nenhum modelo cadastrado ainda.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-default)]">
          {/* `overflow-x-auto` aqui, nunca `overflow-hidden` — a coluna de
              ações (4 botões) é mais larga do que o espaço restante. Sem
              rolagem própria, os botões da direita ficavam cortados/
              invisíveis em vez de aparecerem numa barra de rolagem do
              PRÓPRIO bloco (nunca a janela inteira — ver
              faixa-de-topo-nao-recorta). */}
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Versão publicada</th>
                <th className="px-4 py-2">Subtarefas</th>
                <th className="px-4 py-2">Selecionado em</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {modelos.map((m) => (
                <tr key={m.id} className="border-t border-[var(--border-default)]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{m.nome}</div>
                    <div className="text-xs text-[var(--text-muted)]">{m.chave}</div>
                    {m.descricao && <div className="mt-0.5 max-w-md text-xs text-[var(--text-secondary)]">{m.descricao}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[m.status]}`}>{m.status}</span>
                    {m.temAlteracaoNaoPublicada && (
                      <div className="mt-1 text-[11px] text-amber-300">rascunho com alteração não publicada</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/80">{m.versaoPublicada ?? "—"}</td>
                  <td className="px-4 py-3 text-white/80">{m.passo?._count.subtarefas ?? 0}</td>
                  <td className="px-4 py-3 text-white/80">
                    {m.usadoEm.length === 0
                      ? <span className="text-[var(--text-muted)]">nenhuma fase ainda</span>
                      : (
                        <div className="space-y-0.5">
                          {m.usadoEm.map((u) => (
                            <div key={u.stepId} className="text-xs">
                              {u.phaseKey} <span className="text-[var(--text-muted)]">(v{u.versaoSelecionada})</span>
                            </div>
                          ))}
                        </div>
                      )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button className={`${btnSecondary} flex-none`} disabled={busy} onClick={() => abrirEditor(m)}>Editar conteúdo</button>
                      <button className={`${btnSecondary} flex-none`} disabled={busy || m.status === "INATIVO"} onClick={() => abrirPublicar(m)}>Publicar</button>
                      <button className={`${btnSecondary} flex-none`} disabled={busy}
                        onClick={() => { setDuplicandoDe(m); setDupNome(`${m.nome} (cópia)`); setDupChave(`${m.chave}_copia`) }}>
                        Duplicar
                      </button>
                      <button className={`${btnSecondary} flex-none`} disabled={busy} onClick={() => alternarAtivo(m)}>
                        {m.status === "INATIVO" ? "Reativar" : "Inativar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- criar ---------- */}
      {criando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Novo modelo</h3>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Nome</label>
                <input className={inputCls} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Solicitar certidão" />
              </div>
              <div>
                <label className={labelCls}>Identidade (chave) — opcional, gerada do nome</label>
                <input className={inputCls} value={novaChave} onChange={(e) => setNovaChave(e.target.value)} placeholder={slug(novoNome) || "solicitar_certidao"} />
              </div>
              <div>
                <label className={labelCls}>Descrição (opcional)</label>
                <textarea className={inputCls} rows={2} value={novaDescricao} onChange={(e) => setNovaDescricao(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className={btnSecondary} disabled={busy} onClick={() => setCriando(false)}>Cancelar</button>
              <button className={btnPrimary} disabled={busy} onClick={criarModelo}>Criar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- duplicar ---------- */}
      {duplicandoDe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Duplicar "{duplicandoDe.nome}"</h3>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Nome da cópia</label>
                <input className={inputCls} value={dupNome} onChange={(e) => setDupNome(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Identidade (chave) da cópia</label>
                <input className={inputCls} value={dupChave} onChange={(e) => setDupChave(e.target.value)} />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Copia o conteúdo (subtarefas, campos, ações, dependências) para uma identidade nova.
                Nunca copia o histórico de versões nem os vínculos do original.
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className={btnSecondary} disabled={busy} onClick={() => setDuplicandoDe(null)}>Cancelar</button>
              <button className={btnPrimary} disabled={busy} onClick={confirmarDuplicar}>Duplicar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- editor (reaproveitado do Workflow Interno) ---------- */}
      {editando && (
        <ConfiguracaoDoPassoModal
          passo={editando.passo}
          irmaos={[]}
          phaseKey="biblioteca"
          faseLabel={`Biblioteca de Tarefas — ${editando.modelo.nome}`}
          onFechar={() => setEditando(null)}
          onSalvar={salvarPasso}
          problemas={problemas}
        />
      )}

      {/* ---------- publicar ---------- */}
      {publicando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Publicar "{publicando.nome}"</h3>
            {carregandoPreview ? (
              <div className="py-6 text-center text-sm text-[var(--text-muted)]">Carregando prévia…</div>
            ) : preview ? (
              <div className="space-y-3">
                <p className="text-sm text-white/80">{preview.aviso}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Versão atual: {preview.versaoAtual} → versão nova: {preview.versaoNova}. {preview.mudancas.length} alteração(ões).
                </p>
                {preview.problemas.length > 0 && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                    {preview.problemas.map((p, i) => <div key={i}>• {p.mensagem}</div>)}
                  </div>
                )}
                {!preview.temRascunho && (
                  <p className="text-xs text-amber-300">Não há alteração para publicar.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-red-300">Não foi possível carregar a prévia.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className={btnSecondary} disabled={busy} onClick={() => { setPublicando(null); setPreview(null) }}>Cancelar</button>
              <button className={btnPrimary} disabled={busy || !preview?.podePublicar || !preview?.temRascunho} onClick={confirmarPublicar}>
                Publicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
