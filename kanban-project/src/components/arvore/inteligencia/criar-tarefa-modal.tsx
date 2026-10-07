"use client"

// src/components/arvore/inteligencia/criar-tarefa-modal.tsx
// ============================================================================
// "CRIAR TAREFA" A PARTIR DO QUE A ÁRVORE APONTA.
//
// Modal curto, já PREENCHIDO (título, descrição, pessoa e documento vinculados —
// tudo vindo do `RascunhoTarefa`, que sai do dado). Quem decide e grava é a PORTA
// CANÔNICA `POST /api/tarefas/manual` → `criarTarefaManual`: permissão
// `tarefas.criar`, motivo obrigatório, auditoria e aviso de duplicidade. Este
// componente não grava nada por conta própria e não tem regra de negócio.
//
// Fluxo:  editando → enviando → (criada | duplicidade | erro)
//   • criada      — feedback com o número da tarefa e o link para abri-la;
//   • duplicidade — a porta devolveu 409 com a LISTA das tarefas abertas do mesmo
//                   alvo. O modal AVISA e oferece ABRIR a existente; "criar mesmo
//                   assim" existe (é o contrato da porta: pode ser trabalho novo)
//                   mas é a opção secundária;
//   • erro        — a mensagem real da porta (sem permissão, motivo ausente...).
// ============================================================================

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, FileText, Loader2, TriangleAlert, User, X } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"
import { useApi } from "@/src/lib/dados"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { corpoDaCriacao, type RascunhoTarefa } from "@/src/lib/genealogia/operacional/tarefa-do-passo"
import { useAbrirTarefaNaCentral } from "../fila-da-pessoa"
import { CampoDataTexto } from "@/src/components/ui/campo-data-texto"

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return fetch(url, {
    ...options,
    headers: { ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
}

interface Semelhante {
  tarefaId: number
  titulo: string
  statusTarefa: string
}

type Fase =
  | { tipo: "editando" }
  | { tipo: "enviando" }
  | { tipo: "criada"; tarefaId: number }
  | { tipo: "duplicidade"; semelhantes: Semelhante[]; mensagem: string }
  | { tipo: "erro"; mensagem: string }

const CAMPO =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"

export function CriarTarefaModal({
  rascunho,
  processoId,
  onFechar,
  onCriada,
}: {
  rascunho: RascunhoTarefa
  processoId: number
  onFechar: () => void
  /** Chamado depois de criar: o dono da tela invalida os fatos operacionais. */
  onCriada?: (tarefaId: number) => void
}) {
  const { pode } = usePermissoes()
  const abrirTarefa = useAbrirTarefaNaCentral()

  const [titulo, setTitulo] = useState(rascunho.titulo)
  const [motivo, setMotivo] = useState(rascunho.motivo)
  const [responsavelId, setResponsavelId] = useState<number | null>(null)
  const [dataPrazo, setDataPrazo] = useState("")
  const [fase, setFase] = useState<Fase>({ tipo: "editando" })

  // Quem pode receber trabalho: a MESMA rota do seletor de "Atribuir". Só existe
  // para quem pode distribuir (`tarefas.editar`); sem isso o campo some e a
  // tarefa nasce sem responsável — atribuição continua sendo da Torre/Tarefas.
  const podeAtribuir = Boolean(pode("tarefas.editar"))
  const atribuiveis = useApi<{ funcionarios?: Array<{ id: number; nome: string; email?: string | null }> }>(
    podeAtribuir ? "/api/operacao/atribuiveis" : null,
  )

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar()
    }
    document.addEventListener("keydown", aoTeclar)
    return () => document.removeEventListener("keydown", aoTeclar)
  }, [onFechar])

  const invalido = !titulo.trim() || !motivo.trim()
  const ocupado = fase.tipo === "enviando"

  const enviar = useCallback(
    async (confirmarDuplicidade: boolean) => {
      setFase({ tipo: "enviando" })
      try {
        const r = await authFetch("/api/tarefas/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            corpoDaCriacao(rascunho, processoId, {
              titulo,
              motivo,
              responsavelId,
              dataPrazo: dataPrazo || null,
              confirmarDuplicidade,
            }),
          ),
        })
        const corpo = (await r.json().catch(() => ({}))) as {
          tarefaId?: number
          error?: string
          codigo?: string
          semelhantes?: Semelhante[]
        }
        if (r.ok && typeof corpo.tarefaId === "number") {
          setFase({ tipo: "criada", tarefaId: corpo.tarefaId })
          onCriada?.(corpo.tarefaId)
          return
        }
        if (r.status === 409 && corpo.codigo === "CONFLITO") {
          setFase({
            tipo: "duplicidade",
            semelhantes: corpo.semelhantes ?? [],
            mensagem: corpo.error ?? "Já existe trabalho aberto para este contexto.",
          })
          return
        }
        setFase({ tipo: "erro", mensagem: corpo.error ?? "Não foi possível criar a tarefa." })
      } catch {
        setFase({ tipo: "erro", mensagem: "Sem conexão com o servidor. Nada foi criado." })
      }
    },
    [rascunho, processoId, titulo, motivo, responsavelId, dataPrazo, onCriada],
  )

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: LAYER.aboveProcessDrawer }}>
      <div className="absolute inset-0 bg-[var(--overlay-modal)]" onClick={onFechar} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Criar tarefa"
        data-criar-tarefa-modal
        className="relative w-full max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 text-[var(--text-primary)] shadow-[var(--elev-3)]"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Criar tarefa</h2>
            <p className="text-[11px] text-[var(--text-secondary)]">{rascunho.origemRotulo}</p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded p-1 text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {fase.tipo === "criada" ? (
          <div className="mt-4 space-y-3" data-tarefa-criada>
            <p className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" aria-hidden />
              <span>
                Tarefa <strong>#{fase.tarefaId}</strong> criada
                {rascunho.pessoaNome ? ` para ${rascunho.pessoaNome}` : ""}.
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onFechar}
                className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)]"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => abrirTarefa(processoId, fase.tarefaId)}
                className="rounded-md bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)]"
              >
                Abrir tarefa
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {(rascunho.pessoaNome || rascunho.documentoNome) && (
              <div className="flex flex-wrap gap-1.5">
                {rascunho.pessoaNome && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                    <User className="h-3 w-3" aria-hidden /> {rascunho.pessoaNome}
                  </span>
                )}
                {rascunho.documentoNome && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                    <FileText className="h-3 w-3" aria-hidden /> {rascunho.documentoNome}
                  </span>
                )}
              </div>
            )}

            <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
              Título
              <input
                value={titulo}
                maxLength={200}
                onChange={(e) => setTitulo(e.target.value)}
                disabled={ocupado}
                className={`${CAMPO} mt-1`}
              />
            </label>

            <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
              Descrição (por que esta tarefa é necessária)
              <textarea
                value={motivo}
                rows={4}
                onChange={(e) => setMotivo(e.target.value)}
                disabled={ocupado}
                className={`${CAMPO} mt-1 resize-y`}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              {podeAtribuir && (
                <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
                  Responsável (opcional)
                  <select
                    value={responsavelId ?? ""}
                    onChange={(e) => setResponsavelId(e.target.value ? Number(e.target.value) : null)}
                    disabled={ocupado}
                    className={`${CAMPO} mt-1`}
                  >
                    <option value="">Sem responsável</option>
                    {(atribuiveis.dados?.funcionarios ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={`block text-[11px] font-medium text-[var(--text-secondary)] ${podeAtribuir ? "" : "col-span-2"}`}>
                Prazo (opcional)
                <CampoDataTexto
                  value={dataPrazo}
                  onChange={setDataPrazo}
                  disabled={ocupado}
                  className={`${CAMPO} mt-1`}
                  aria-label="Prazo (opcional)"
                />
              </label>
            </div>

            {fase.tipo === "duplicidade" && (
              <div
                role="alert"
                data-aviso-duplicidade
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] p-2.5"
              >
                <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--warning-text)]">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Já existe tarefa aberta para este contexto.
                </p>
                <ul className="mt-1.5 space-y-1">
                  {fase.semelhantes.map((s) => (
                    <li key={s.tarefaId} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate text-[var(--text-secondary)]">
                        #{s.tarefaId} · {s.titulo}
                      </span>
                      <button
                        type="button"
                        onClick={() => abrirTarefa(processoId, s.tarefaId)}
                        className="shrink-0 rounded-md bg-[var(--action-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)]"
                      >
                        Abrir tarefa
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
                  Se for o mesmo trabalho, abra a existente. Se for trabalho novo, crie mesmo assim.
                </p>
              </div>
            )}

            {fase.tipo === "erro" && (
              <p role="alert" className="text-xs text-[var(--danger-text)]">
                {fase.mensagem}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onFechar}
                disabled={ocupado}
                className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] disabled:opacity-50"
              >
                Cancelar
              </button>
              {fase.tipo === "duplicidade" ? (
                <button
                  type="button"
                  onClick={() => void enviar(true)}
                  disabled={invalido || ocupado}
                  className="rounded-md border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  Criar mesmo assim
                </button>
              ) : (
                <button
                  type="button"
                  data-criar-tarefa-enviar
                  onClick={() => void enviar(false)}
                  disabled={invalido || ocupado}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)] disabled:opacity-50"
                >
                  {ocupado && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  Criar tarefa
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
