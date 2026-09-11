// src/components/operacao/processo-expandido.tsx
// ============================================================================
// A EXPANSÃO DE UM PROCESSO DENTRO DE TAREFAS E PROJETOS.
//
// Tudo aqui é LEITURA de rotas que já existem — nada é recalculado, nada é
// uma segunda fonte:
//
//   Visão Geral / Tarefas    → GET /api/operacao/visao-global?processo={id}
//   Status do Processo       → GET /api/processos/{id}/phase (resolveOperationalProjection)
//   Documentos                → GET /api/processos/{id}/documentos
//   Histórico de Atividades   → GET /api/processos/{id}/atividades (LogAuditoria + PhaseAdvanceLog + observações/anexos)
//   Observações                → o mesmo /atividades, filtrado por tipo
//
// A ÚNICA escrita possível daqui é reatribuir a fase atual — e sai pela MESMA
// porta de sempre (`redistribuirTarefas`, `/api/tarefas/redistribuir`).
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { auth, dataCurta, Estado, rotularFase, ROTULO_STATUS, SeletorResponsavel, type LinhaDeFila } from "./kit-operacional"
import type { ProcessoAgrupado } from "@/lib/operacional/tarefa-projecoes"

type Aba = "visao" | "tarefas" | "documentos" | "historico" | "observacoes" | "dados"

const ABAS: Array<{ chave: Aba; rotulo: (n: { tarefas: number; documentos: number }) => string }> = [
  { chave: "visao", rotulo: () => "Visão Geral" },
  { chave: "tarefas", rotulo: (n) => `Tarefas (${n.tarefas})` },
  { chave: "documentos", rotulo: (n) => `Documentos (${n.documentos})` },
  { chave: "historico", rotulo: () => "Histórico de Atividades" },
  { chave: "observacoes", rotulo: () => "Observações" },
  { chave: "dados", rotulo: () => "Dados do Processo" },
]

interface FaseProjecao {
  percent: number
  done: number
  total: number
  label: string
}
interface DocCompact {
  id: number
  tipo: string | null
  tipoShort: string
  status: string
  statusShort: string
  arquivoNome: string | null
}
interface Atividade {
  em: string
  tipo: "marco" | "tarefa" | "etapa" | "observacao" | "anexo"
  texto: string
  autor: string | null
}

function horaCurta(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const mesmoDia = d.toDateString() === hoje.toDateString()
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  return mesmoDia ? `Hoje, ${hora}` : `${dataCurta(iso)}, ${hora}`
}

const ICONE_ATIVIDADE: Record<Atividade["tipo"], string> = {
  marco: "◆", tarefa: "✓", etapa: "›", observacao: "✎", anexo: "📎",
}

export function ProcessoExpandido({
  processo, podeAtribuir, aoAbrirTarefa,
}: {
  processo: ProcessoAgrupado
  podeAtribuir: boolean
  aoAbrirTarefa: (taskId: number, processoId: number) => void
}) {
  const [aba, setAba] = useState<Aba>("visao")
  const [tarefas, setTarefas] = useState<{ chave: number; d: LinhaDeFila[] | null } | null>(null)
  const [faseProjecao, setFaseProjecao] = useState<FaseProjecao | null>(null)
  const [documentos, setDocumentos] = useState<{ chave: number; d: DocCompact[] | null } | null>(null)
  const [atividades, setAtividades] = useState<{ chave: number; d: Atividade[] | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [atribuindo, setAtribuindo] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // TUDO CARREGA UMA VEZ, na hora em que a linha abre — não uma vez por aba
  // clicada. É a MESMA leitura que a Central Operacional já faz para este
  // processo; a expansão só lê de novo, nunca outra coisa.
  useEffect(() => {
    let vivo = true
    const chave = recarga
    fetch(`/api/operacao/visao-global?processo=${processo.processoId}&porPagina=500&incluirEncerradas=1`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { linhas: LinhaDeFila[] }) => { if (vivo) setTarefas({ chave, d: d.linhas }) })
      .catch(() => { if (vivo) setTarefas({ chave, d: null }) })
    fetch(`/api/processos/${processo.processoId}/phase`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { percent: number; done: number; total: number; label: string }) => {
        if (vivo) setFaseProjecao({ percent: d.percent, done: d.done, total: d.total, label: d.label })
      })
      .catch(() => { if (vivo) setFaseProjecao(null) })
    fetch(`/api/processos/${processo.processoId}/documentos`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { documentos?: DocCompact[] } | DocCompact[]) => {
        const lista = Array.isArray(d) ? d : d.documentos ?? []
        if (vivo) setDocumentos({ chave, d: lista })
      })
      .catch(() => { if (vivo) setDocumentos({ chave, d: null }) })
    fetch(`/api/processos/${processo.processoId}/atividades?limite=200`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { atividades: Atividade[] }) => { if (vivo) setAtividades({ chave, d: d.atividades }) })
      .catch(() => { if (vivo) setAtividades({ chave, d: null }) })
    return () => { vivo = false }
  }, [processo.processoId, recarga])

  const listaTarefas = tarefas?.chave === recarga ? tarefas.d : null
  const listaDocumentos = documentos?.chave === recarga ? documentos.d : null
  const listaAtividades = atividades?.chave === recarga ? atividades.d : null

  const proximasTarefas = (listaTarefas ?? [])
    .filter((t) => t.statusTarefa === "NAO_INICIADA")
    .sort((a, b) => (a.dataPrazo ?? "9999").localeCompare(b.dataPrazo ?? "9999"))
    .slice(0, 5)

  const atribuirFaseAtual = async (novoResponsavelId: number) => {
    if (!processo.faseAtualKey) return
    setOcupado(true); setErro(null)
    try {
      const idsSemDono = (listaTarefas ?? [])
        .filter((t) => t.faseMacroKey === processo.faseAtualKey && t.responsavelId == null && t.statusTarefa !== "CANCELADA" && t.statusTarefa !== "SUPERSEDIDA")
        .map((t) => t.taskId)
      if (idsSemDono.length === 0) { setErro("Nenhuma tarefa sem responsável nesta fase."); return }
      const r = await fetch("/api/tarefas/redistribuir", {
        method: "POST", headers: auth(),
        body: JSON.stringify({ tarefaIds: idsSemDono, novoResponsavelId }),
      })
      if (!r.ok && r.status !== 207) { setErro(`Falha ao atribuir (HTTP ${r.status}).`); return }
      const d = await r.json().catch(() => ({}))
      setAviso(`${d.ok ?? idsSemDono.length} tarefa${idsSemDono.length === 1 ? "" : "s"} atribuída${idsSemDono.length === 1 ? "" : "s"}.`)
      setAtribuindo(false)
      setRecarga((n) => n + 1)
    } catch {
      setErro("Não foi possível falar com o servidor.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="border-b border-white/[0.05] bg-[var(--surface-primary)]/30 px-4 py-3">
      {/* ── ABAS + AÇÕES ── */}
      <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.06] pb-2">
        {ABAS.map((a) => (
          <button
            key={a.chave}
            onClick={() => setAba(a.chave)}
            className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
              aba === a.chave ? "bg-[var(--surface-secondary)] text-white/90" : "text-[var(--text-secondary)] hover:text-white/75"
            }`}
          >
            {a.rotulo({ tarefas: listaTarefas?.length ?? processo.total, documentos: listaDocumentos?.length ?? 0 })}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {podeAtribuir && processo.faseAtualKey && (
            <button
              onClick={() => setAtribuindo(true)}
              className="rounded border border-[var(--border-default)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-white/90"
            >
              Atribuir fase atual
            </button>
          )}
          <Link
            href={`/processos/${processo.processoId}`}
            className="rounded border border-[var(--border-default)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-white/90"
          >
            Abrir processo →
          </Link>
        </div>
      </div>

      {(erro || aviso) && (
        <div className={`mt-2 rounded border px-2.5 py-1.5 text-[11px] ${erro ? "border-[var(--border-default)] text-red-700/90" : "border-[var(--border-default)] text-green-800/90"}`}>
          {erro ?? aviso}
        </div>
      )}

      {/* ── CONTEÚDO + PAINÉIS ── */}
      <div className="mt-3 flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {aba === "visao" && <AbaVisaoGeral processo={processo} faseProjecao={faseProjecao} />}
          {aba === "tarefas" && (
            <AbaTarefas linhas={listaTarefas} aoAbrir={(id) => aoAbrirTarefa(id, processo.processoId)} />
          )}
          {aba === "documentos" && <AbaDocumentos documentos={listaDocumentos} />}
          {aba === "historico" && <AbaAtividades atividades={listaAtividades} filtro={null} />}
          {aba === "observacoes" && <AbaAtividades atividades={listaAtividades} filtro="observacao" />}
          {aba === "dados" && <AbaDados processo={processo} />}
        </div>

        {/* PAINÉIS LATERAIS — o mesmo contexto em toda aba: onde o processo
            está agora, e o que vem a seguir. */}
        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-64">
          <PainelStatusDoProcesso processo={processo} faseProjecao={faseProjecao} />
          <PainelProximasTarefas linhas={proximasTarefas} />
        </div>
      </div>

      {atribuindo && (
        <SeletorResponsavel
          titulo={`Atribuir ${rotularFase(processo.faseAtualKey) ?? "fase atual"}`}
          atual={null}
          ocupado={ocupado}
          erro={erro}
          aoFechar={() => { setAtribuindo(false); setErro(null) }}
          aoEscolher={atribuirFaseAtual}
        />
      )}
    </div>
  )
}

function PainelStatusDoProcesso({ processo, faseProjecao }: { processo: ProcessoAgrupado; faseProjecao: FaseProjecao | null }) {
  const responsavel = processo.ultimoMarco?.faseNovaMaterializada
    ? processo.ultimoMarco.responsavelNovo
    : null
  return (
    <div className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Status do Processo</h3>
      <div className="mt-2 inline-flex items-center rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] text-white/85">
        {rotularFase(processo.faseAtualKey) ?? "—"}
      </div>
      {processo.statusProcesso === "CONCLUIDO" && (
        <div className="mt-1 text-[10px] text-green-800/90">Processo concluído</div>
      )}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
          <span>Progresso</span>
          <span className="tabular-nums text-white/80">{faseProjecao ? `${faseProjecao.percent}%` : "—"}</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-secondary)]">
          <div className="h-full rounded-full bg-[var(--action-primary)]" style={{ width: `${faseProjecao?.percent ?? 0}%` }} />
        </div>
        {faseProjecao && (
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">{faseProjecao.done} de {faseProjecao.total} tarefas concluídas</p>
        )}
      </div>
      {processo.aguardandoAtribuicao ? (
        <div className="mt-3 rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-800/90">
          Aguardando atribuição
        </div>
      ) : responsavel && typeof responsavel === "object" ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Responsável</div>
          <div className="mt-1 text-[11px] text-white/85">{responsavel.nome}</div>
        </div>
      ) : null}
    </div>
  )
}

function PainelProximasTarefas({ linhas }: { linhas: LinhaDeFila[] }) {
  return (
    <div className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Próximas Tarefas</h3>
      {linhas.length === 0 && <p className="mt-2 text-[10px] text-[var(--text-muted)]">Nada a fazer nesta fase.</p>}
      <ul className="mt-2 space-y-2">
        {linhas.map((t) => (
          <li key={t.taskId} className="flex items-start gap-2">
            <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--border-strong)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] text-white/85">{t.titulo}</span>
              <span className="block text-[10px] text-[var(--text-muted)]">{rotularFase(t.faseMacroKey) ?? "—"}</span>
            </span>
            <span className={`shrink-0 text-[10px] tabular-nums ${t.atrasada ? "text-red-700/90" : "text-[var(--text-muted)]"}`}>
              {dataCurta(t.dataPrazo)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AbaVisaoGeral({ processo, faseProjecao }: { processo: ProcessoAgrupado; faseProjecao: FaseProjecao | null }) {
  const marco = processo.ultimoMarco
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([
          ["Tarefas", processo.total], ["A fazer", processo.aFazer], ["Concluídas", processo.concluidas],
          ["Atrasadas", processo.atrasadas], ["Vencem em 7 dias", processo.venceEm7Dias],
        ] as const).map(([r, v]) => (
          <div key={r} className="rounded border border-[var(--border-default)] px-2.5 py-1.5">
            <div className="text-[14px] font-medium tabular-nums text-white/85">{v}</div>
            <div className="text-[10px] text-[var(--text-muted)]">{r}</div>
          </div>
        ))}
      </div>
      {marco && (
        <div className="rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
          <div className="text-[11px] font-medium text-white/90">
            {rotularFase(marco.faseAnteriorKey) ?? marco.faseAnteriorKey} concluída → {marco.faseNovaLabel ?? "—"}
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">
            {marco.concluidasNaFaseAnterior}/{marco.totalNaFaseAnterior} tarefas concluídas
            {marco.responsavelAnterior && typeof marco.responsavelAnterior === "object" && ` · ${marco.responsavelAnterior.nome}`}
            {" · "}{horaCurta(marco.em)}
          </div>
        </div>
      )}
      {faseProjecao?.total === 0 && (
        <p className="text-[11px] text-[var(--text-muted)]">Sem itens obrigatórios nesta fase.</p>
      )}
    </div>
  )
}

function AbaTarefas({ linhas, aoAbrir }: { linhas: LinhaDeFila[] | null; aoAbrir: (id: number) => void }) {
  if (linhas == null) return <Estado tipo="carregando" mensagem="Carregando tarefas…" />
  if (linhas.length === 0) return <Estado tipo="vazio" mensagem="Nenhuma tarefa neste processo." />
  return (
    <div className="max-h-80 overflow-y-auto rounded border border-[var(--border-default)]">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 bg-[var(--surface-overlay)]">
          <tr className="[&>th]:px-2.5 [&>th]:py-1.5 [&>th]:text-[10px] [&>th]:uppercase [&>th]:text-[var(--text-muted)]">
            <th>Tarefa</th><th>Fase</th><th>Status</th><th>Responsável</th><th>Prazo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((t) => (
            <tr key={t.taskId} onClick={() => aoAbrir(t.taskId)} className="cursor-pointer border-t border-white/[0.05] hover:bg-[var(--surface-primary)] [&>td]:px-2.5 [&>td]:py-1.5">
              <td className="max-w-0 truncate text-[11px] text-white/85">{t.titulo}</td>
              <td className="text-[11px] text-[var(--text-secondary)]">{rotularFase(t.faseMacroKey) ?? "—"}</td>
              <td className="text-[11px] text-[var(--text-secondary)]">{ROTULO_STATUS[t.statusTarefa] ?? t.statusTarefa}</td>
              <td className="text-[11px] text-[var(--text-secondary)]">{t.responsavelNome ?? "Sem responsável"}</td>
              <td className={`text-[11px] tabular-nums ${t.atrasada ? "text-red-700/90" : "text-[var(--text-secondary)]"}`}>{dataCurta(t.dataPrazo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AbaDocumentos({ documentos }: { documentos: DocCompact[] | null }) {
  if (documentos == null) return <Estado tipo="carregando" mensagem="Carregando documentos…" />
  if (documentos.length === 0) return <Estado tipo="vazio" mensagem="Nenhum documento neste processo." />
  return (
    <div className="max-h-80 space-y-1.5 overflow-y-auto">
      {documentos.map((d) => (
        <div key={d.id} className="flex items-center justify-between rounded border border-[var(--border-default)] px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[11px] text-white/85">{d.tipo ?? d.tipoShort}</span>
          <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{d.statusShort ?? d.status}</span>
        </div>
      ))}
    </div>
  )
}

function AbaAtividades({ atividades, filtro }: { atividades: Atividade[] | null; filtro: Atividade["tipo"] | null }) {
  if (atividades == null) return <Estado tipo="carregando" mensagem="Carregando atividades…" />
  const filtradas = filtro ? atividades.filter((a) => a.tipo === filtro) : atividades
  if (filtradas.length === 0) {
    return <Estado tipo="vazio" mensagem={filtro === "observacao" ? "Nenhuma observação registrada." : "Nenhuma atividade registrada."} />
  }
  return (
    <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
      {filtradas.map((a, i) => (
        <div key={i} className="flex gap-2.5">
          <div className="flex w-14 shrink-0 flex-col items-end pt-0.5 text-[10px] tabular-nums text-[var(--text-muted)]">
            {horaCurta(a.em)}
          </div>
          <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full text-center text-[9px] leading-4 ${
            a.tipo === "marco" ? "bg-[var(--action-primary)] text-white" : "border border-[var(--border-strong)] text-[var(--text-secondary)]"
          }`}>
            {ICONE_ATIVIDADE[a.tipo]}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <p className={`text-[11px] ${a.tipo === "marco" ? "font-medium text-white/95" : "text-white/85"}`}>{a.texto}</p>
            {a.autor && <p className="text-[10px] text-[var(--text-muted)]">{a.autor}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function AbaDados({ processo }: { processo: ProcessoAgrupado }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
      <dt className="text-[var(--text-muted)]">Processo</dt><dd className="text-white/85">{processo.nomeProcesso}</dd>
      <dt className="text-[var(--text-muted)]">ID</dt><dd className="tabular-nums text-white/85">#{processo.processoId}</dd>
      <dt className="text-[var(--text-muted)]">Fase atual</dt><dd className="text-white/85">{rotularFase(processo.faseAtualKey) ?? "—"}</dd>
      <dt className="text-[var(--text-muted)]">Status do processo</dt>
      <dd className="text-white/85">{processo.statusProcesso === "CONCLUIDO" ? "Concluído" : "Ativo"}</dd>
    </dl>
  )
}
