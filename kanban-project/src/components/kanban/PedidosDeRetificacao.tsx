"use client"

// src/components/kanban/PedidosDeRetificacao.tsx
//
// ABRIR E ACOMPANHAR OS PEDIDOS DE RETIFICAÇÃO DE UM PROCESSO.
//
// ─── POR QUE ESTA TELA PRECISA EXISTIR ──────────────────────────────────────
// Com a retificação passando a operar POR PEDIDO, a fase só materializa etapas para
// os pedidos abertos: zero pedidos, zero trabalho, e o operador vê uma fase vazia sem
// saber o que fazer. Abrir o pedido — e dizer quais divergências vão nele — era uma
// operação que só existia em API.
//
// ─── O QUE ELA NÃO FAZ ──────────────────────────────────────────────────────
// Não agrupa sozinha. Quais divergências entram no mesmo procedimento é decisão de
// quem analisa (normalmente já decidida na Análise Documental, que abre o pedido
// pronto). Agrupar por processo, por pessoa ou por documento acertaria num caso e
// erraria no seguinte.
//
// O modo (judicial/administrativa) é lido do pedido — decidido no passo "Definir
// modo", ou já trazido pronto de quem abriu o pedido. A tela só REFLETE o dado; não
// há `if (pais === "Itália")` nem cópia de tribunal/órgão/advogado para aqui: cada um
// desses fatos é projetado, a cada leitura, do dono canônico (Órgãos e Organizações,
// Profissionais, Protocolo) — ver `contexto-da-retificacao.ts`.
//
// A EXECUÇÃO DE CADA ETAPA é o mesmo motor declarativo de qualquer fase do sistema
// (`PainelDeclarativoDaEtapa`, por `stepInstanceId`): esta tela não sabe o que uma
// etapa pede, só que existe uma etapa ativa e mostra o painel dela.

import { useCallback, useEffect, useState } from "react"
import {
  Loader2, Scale, Landmark, Building2, User, FileText, Clock, ChevronRight, X, HelpCircle,
} from "lucide-react"
import PainelDeclarativoDaEtapa from "./workflow/PainelDeclarativoDaEtapa"

interface Divergencia {
  id: number
  campoLabel: string
  pessoaNome: string
  documentoTitulo: string
  valorArvore: string | null
  valorDocumento: string | null
  severidade: string
}
interface PedidoResumo {
  id: number
  num: string
  tipo: string | null
  status: string
  orgaoId: number | null
  protocoloId: number | null
  divergencias: Divergencia[]
}
interface PassoPedido {
  id: number
  stepKey: string
  status: string
  ordem: number
  obrigatorio: boolean
  prazo: string | null
  startedAt: string | null
  completedAt: string | null
  responsavel: { nome: string } | null
}
interface PedidoDetalhe {
  id: number; num: string; tipo: string | null; status: string
  motivo: string | null; processoNum: string | null
  createdAt: string; updatedAt: string
  orgao: { id: number; name: string; nomeFantasia: string | null; type: string | null; city: string | null; state: string | null; ativo: boolean } | null
  protocolo: { id: number; numeroProtocolo: string | null; numeroProcesso: string | null; dataProtocolo: string | null; setor: string | null; situacao: string } | null
  profissional: { id: number; nome: string; ativo: boolean; categoria: { nome: string } | null; organizacao: { name: string; nomeFantasia: string | null } | null; registros: Array<{ tipo: string; numero: string; jurisdicao: string | null }> } | null
  divergencias: Divergencia[]
}

const PASSO_LABEL: Record<string, string> = {
  definir_modo_de_retificacao: "Definir modo",
  preparar_requerimento_peticao: "Preparar requerimento/petição",
  protocolar_retificacao: "Protocolar",
  acompanhar_decisao: "Acompanhar decisão",
  registrar_averbacao: "Registrar averbação",
  validar_retificacao: "Validar retificação",
}
const rotuloPasso = (key: string) => PASSO_LABEL[key] ?? key
// (Os estados encerrados de um passo já vêm resolvidos pelo servidor em `passoAtualId` —
// aqui só se compara com "CONCLUIDO" para desenhar o check.)

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") ?? localStorage.getItem("authToken") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}
const fmtDia = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")

export function PedidosDeRetificacao({ processoId, aoMudar }: { processoId: number; aoMudar?: () => void }) {
  const [pedidos, setPedidos] = useState<PedidoResumo[]>([])
  const [disponiveis, setDisponiveis] = useState<Divergencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  const [motivo, setMotivo] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [pedidoAberto, setPedidoAberto] = useState<number | null>(null)

  const [recarga, setRecarga] = useState(0)
  const carregar = useCallback(() => setRecarga((n) => n + 1), [])

  useEffect(() => {
    let vivo = true
    Promise.all([
      fetch(`/api/processos/${processoId}/retificacoes`, { headers: headers() }).then(async (r) => ({ ok: r.ok, j: await r.json() })),
      fetch(`/api/processos/${processoId}/retificacoes/divergencias`, { headers: headers() })
        .then(async (r) => (r.ok ? await r.json() : { divergencias: [] }))
        .catch(() => ({ divergencias: [] })),
    ])
      .then(([ped, div]) => {
        if (!vivo) return
        if (!ped.ok) { setErro(ped.j.mensagem || ped.j.error || "Não foi possível carregar os pedidos."); return }
        setPedidos(ped.j.pacotes ?? [])
        setDisponiveis((div as { divergencias?: Divergencia[] }).divergencias ?? [])
        setErro(null)
      })
      .catch(() => { if (vivo) setErro("Erro ao carregar.") })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [processoId, recarga])

  async function abrirPedido() {
    setSalvando(true); setErro(null)
    try {
      const r = await fetch(`/api/processos/${processoId}/retificacoes`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ divergenciaIds: [...selecionadas], motivo: motivo.trim() || null }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.mensagem || j.error || "Não foi possível abrir o pedido.")
      setAbrindo(false); setSelecionadas(new Set()); setMotivo("")
      carregar()
      aoMudar?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao abrir o pedido.")
    } finally {
      setSalvando(false)
    }
  }

  const alternar = (id: number) =>
    setSelecionadas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const judiciais = pedidos.filter((p) => p.tipo === "judicial")
  const administrativos = pedidos.filter((p) => p.tipo === "administrativa")
  const semModo = pedidos.filter((p) => p.tipo == null)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white">Retificação de Registros</h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Cada pedido é um procedimento independente: tem o próprio órgão, protocolo, responsável e
            etapas. Concluir ou reabrir um não mexe nos outros.
          </p>
        </div>
        <button
          onClick={() => { setErro(null); setAbrindo(true) }}
          disabled={disponiveis.length === 0}
          title={disponiveis.length === 0 ? "Não há divergência marcada para retificação e ainda sem pedido." : undefined}
          className="whitespace-nowrap rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs text-white hover:bg-[var(--surface-hover)] disabled:opacity-40"
        >+ Abrir pedido</button>
      </div>

      {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-amber-800">{erro}</div>}

      {carregando ? (
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">Carregando…</p>
      ) : pedidos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border-default)] p-6 text-center text-xs text-[var(--text-muted)]">
          Nenhum pedido aberto. A fase só cria etapas depois que existir um — abra o pedido com as
          divergências que vão no mesmo procedimento.
        </p>
      ) : (
        <div className="space-y-5">
          {judiciais.length > 0 && (
            <Secao icone={<Scale className="w-4 h-4" />} titulo="Via Judicial" subtitulo="Execução da retificação de todos os documentos do pedido por meio de um único processo judicial.">
              <div className="space-y-3">
                {judiciais.map((p) => <CardJudicial key={p.id} pedido={p} onAbrir={() => setPedidoAberto(p.id)} />)}
              </div>
            </Secao>
          )}

          {administrativos.length > 0 && (
            <Secao icone={<Landmark className="w-4 h-4" />} titulo="Via Administrativa" subtitulo="Execução da retificação de cada documento, individualmente, junto ao respectivo órgão competente.">
              <TabelaAdministrativa pedidos={administrativos} onAbrir={setPedidoAberto} />
            </Secao>
          )}

          {semModo.length > 0 && (
            <Secao icone={<HelpCircle className="w-4 h-4" />} titulo="Modo a definir" subtitulo="O pedido foi agrupado; falta decidir se o caminho é judicial ou administrativo.">
              <div className="space-y-2">
                {semModo.map((p) => (
                  <button key={p.id} onClick={() => setPedidoAberto(p.id)} className="w-full text-left rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3 hover:bg-[var(--surface-hover)] flex items-center justify-between">
                    <div>
                      <span className="text-sm text-white/90">{p.num}</span>
                      <span className="ml-2 text-xs text-[var(--text-muted)]">{p.divergencias.length} divergência(s)</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            </Secao>
          )}
        </div>
      )}

      {abrindo && (
        <ModalAbrirPedido
          disponiveis={disponiveis} selecionadas={selecionadas} motivo={motivo}
          salvando={salvando}
          onAlternar={alternar} onMotivo={setMotivo}
          onCancelar={() => setAbrindo(false)} onConfirmar={abrirPedido}
        />
      )}

      {pedidoAberto != null && (
        <ModalDetalhePedido
          processoId={processoId} pacoteId={pedidoAberto}
          onClose={() => setPedidoAberto(null)}
          onMudou={() => { carregar(); aoMudar?.() }}
        />
      )}
    </div>
  )
}

function Secao({ icone, titulo, subtitulo, children }: { icone: React.ReactNode; titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-white/90">
        {icone}
        <h4 className="text-sm font-semibold">{titulo}</h4>
      </div>
      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitulo}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function BarraProgresso({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-[var(--surface-tertiary)] overflow-hidden">
      <div className="h-full bg-[var(--action-primary)]" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Carrega o detalhe (passos/progresso) de um pedido — usado tanto no card judicial quanto na linha administrativa. */
function useDetalhePedido(processoId: number, pacoteId: number) {
  const [detalhe, setDetalhe] = useState<{ pacote: PedidoDetalhe; passos: PassoPedido[]; passoAtualId: number | null; progresso: number } | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const recarregar = useCallback(() => setRecarga((n) => n + 1), [])

  useEffect(() => {
    let vivo = true
    // Deferido: nenhum setState roda na passagem síncrona do efeito, só depois do
    // primeiro `await` — evita o encadeamento de render que `setCarregando(true)`
    // direto no corpo do efeito provocaria.
    void Promise.resolve().then(async () => {
      if (!vivo) return
      setCarregando(true)
      try {
        const r = await fetch(`/api/processos/${processoId}/retificacoes/${pacoteId}`, { headers: headers() })
        if (!r.ok) throw new Error("Erro ao carregar o pedido.")
        const j = await r.json()
        if (vivo) { setDetalhe(j); setErro(null) }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Erro ao carregar o pedido.")
      } finally {
        if (vivo) setCarregando(false)
      }
    })
    return () => { vivo = false }
  }, [processoId, pacoteId, recarga])

  return { detalhe, carregando, erro, recarregar }
}

function CardJudicial({ pedido, onAbrir }: { pedido: PedidoResumo; onAbrir: () => void }) {
  return (
    <button onClick={onAbrir} className="w-full text-left rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 hover:bg-[var(--surface-hover)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white/95">{pedido.num}</span>
            <span className="text-xs text-[var(--text-muted)]">{pedido.status}</span>
          </div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">{pedido.divergencias.length} divergência(s) cobertas por este processo</div>
        </div>
        <ChevronRight className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />
      </div>
      <ul className="mt-2 space-y-0.5">
        {pedido.divergencias.slice(0, 3).map((d) => (
          <li key={d.id} className="text-xs text-[var(--text-secondary)]">
            <span className="text-white/75">{d.campoLabel}</span> — {d.valorDocumento ?? "—"} → {d.valorArvore ?? "—"}
            <span className="ml-2 text-[var(--text-muted)]">{d.pessoaNome} · {d.documentoTitulo}</span>
          </li>
        ))}
        {pedido.divergencias.length > 3 && <li className="text-xs text-[var(--text-muted)]">+ {pedido.divergencias.length - 3} outra(s)</li>}
      </ul>
    </button>
  )
}

function TabelaAdministrativa({ pedidos, onAbrir }: { pedidos: PedidoResumo[]; onAbrir: (id: number) => void }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] bg-[var(--surface-secondary)]">
            {["Pedido", "Documento(s)", "Pessoa", "Status"].map((h) => <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>)}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {pedidos.map((p) => (
            <tr key={p.id} onClick={() => onAbrir(p.id)} className="cursor-pointer hover:bg-[var(--surface-secondary)]">
              <td className="px-3 py-2.5 text-white/90 font-medium">{p.num}</td>
              <td className="px-3 py-2.5 text-white/80">{[...new Set(p.divergencias.map((d) => d.documentoTitulo))].join(", ") || "—"}</td>
              <td className="px-3 py-2.5 text-white/80">{[...new Set(p.divergencias.map((d) => d.pessoaNome))].join(", ") || "—"}</td>
              <td className="px-3 py-2.5 text-[var(--text-secondary)]">{p.status}</td>
              <td className="px-3 py-2.5 text-right"><ChevronRight className="w-4 h-4 text-[var(--text-muted)]" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ModalAbrirPedido({ disponiveis, selecionadas, motivo, salvando, onAlternar, onMotivo, onCancelar, onConfirmar }: {
  disponiveis: Divergencia[]; selecionadas: Set<number>; motivo: string; salvando: boolean
  onAlternar: (id: number) => void; onMotivo: (v: string) => void
  onCancelar: () => void; onConfirmar: () => void
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={onCancelar}>
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-medium text-white">Abrir pedido de retificação</h3>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Marque as divergências que vão no MESMO procedimento. As que ficarem de fora podem ir num
          pedido separado — e o modo judicial ou administrativo é decidido na primeira etapa.
        </p>

        <div className="mt-4 space-y-1.5">
          {disponiveis.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">Nenhuma divergência disponível para agrupar.</p>
          )}
          {disponiveis.map((d) => (
            <label key={d.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
              <input type="checkbox" className="mt-0.5" checked={selecionadas.has(d.id)} onChange={() => onAlternar(d.id)} />
              <span className="text-xs text-white/70">
                <b className="text-white/90">{d.campoLabel}</b> — {d.valorDocumento ?? "—"} → {d.valorArvore ?? "—"}
                <span className="block text-[var(--text-muted)]">{d.pessoaNome} · {d.documentoTitulo} · {d.severidade}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Motivo (opcional)</label>
          <textarea rows={2} value={motivo} onChange={(e) => onMotivo(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white outline-none focus:border-white/20" />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancelar} className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm text-white/70 hover:bg-[var(--surface-hover)]">Cancelar</button>
          <button onClick={onConfirmar} disabled={salvando || selecionadas.size === 0}
            className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white hover:bg-[var(--surface-hover)] disabled:opacity-40">
            {salvando ? "Abrindo…" : `Abrir com ${selecionadas.size} divergência(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalDetalhePedido({ processoId, pacoteId, onClose, onMudou }: {
  processoId: number; pacoteId: number; onClose: () => void; onMudou: () => void
}) {
  const { detalhe, carregando, erro, recarregar } = useDetalhePedido(processoId, pacoteId)
  const [passoAberto, setPassoAberto] = useState<number | null>(null)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5" onClick={(e) => e.stopPropagation()}>
        {carregando ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" /></div>
        ) : erro || !detalhe ? (
          <div className="text-sm text-red-700">{erro ?? "Pedido não encontrado."}</div>
        ) : passoAberto != null ? (
          <div>
            <button onClick={() => setPassoAberto(null)} className="mb-3 text-xs text-[var(--text-muted)] hover:text-white/80">← Voltar ao pedido</button>
            <PainelDeclarativoDaEtapa stepInstanceId={passoAberto} onExecutado={() => { recarregar(); onMudou() }} />
          </div>
        ) : (
          <DetalhePedidoConteudo detalhe={detalhe} onAbrirPasso={setPassoAberto} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

function DetalhePedidoConteudo({ detalhe, onAbrirPasso, onClose }: {
  detalhe: { pacote: PedidoDetalhe; passos: PassoPedido[]; passoAtualId: number | null; progresso: number }
  onAbrirPasso: (stepInstanceId: number) => void
  onClose: () => void
}) {
  const { pacote, passos, passoAtualId, progresso } = detalhe
  const jud = pacote.tipo === "judicial"

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {jud ? <Scale className="w-4 h-4 text-white/70" /> : pacote.tipo === "administrativa" ? <Landmark className="w-4 h-4 text-white/70" /> : <HelpCircle className="w-4 h-4 text-white/70" />}
            <h3 className="text-base font-semibold text-white/95">{pacote.num}</h3>
            <span className="text-xs text-[var(--text-muted)]">{pacote.tipo ?? "modo a definir"}</span>
          </div>
          {pacote.motivo && <p className="mt-1 text-xs text-[var(--text-secondary)]">{pacote.motivo}</p>}
        </div>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white/80 p-1"><X className="w-5 h-5" /></button>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-1">
          <span>Progresso</span><span>{progresso}%</span>
        </div>
        <BarraProgresso pct={progresso} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {jud && (
          <Info icone={<FileText className="w-3.5 h-3.5" />} rotulo="Processo judicial" valor={pacote.processoNum ?? "a informar"} />
        )}
        {pacote.orgao && (
          <Info icone={<Building2 className="w-3.5 h-3.5" />} rotulo="Órgão" valor={pacote.orgao.nomeFantasia || pacote.orgao.name}
            detalhe={[pacote.orgao.type, [pacote.orgao.city, pacote.orgao.state].filter(Boolean).join(" · ")].filter(Boolean).join(" — ")} />
        )}
        {pacote.profissional && (
          <Info icone={<User className="w-3.5 h-3.5" />} rotulo="Profissional responsável" valor={pacote.profissional.nome}
            detalhe={pacote.profissional.registros[0] ? `${pacote.profissional.registros[0].tipo} ${pacote.profissional.registros[0].numero}` : pacote.profissional.categoria?.nome} />
        )}
        {pacote.protocolo && (
          <Info icone={<FileText className="w-3.5 h-3.5" />} rotulo="Protocolo" valor={pacote.protocolo.numeroProtocolo ?? "—"} detalhe={fmtDia(pacote.protocolo.dataProtocolo)} />
        )}
      </div>

      <div>
        <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Documentos / divergências abrangidas ({pacote.divergencias.length})</div>
        <ul className="space-y-1">
          {pacote.divergencias.map((d) => (
            <li key={d.id} className="text-xs text-white/80 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5">
              <b>{d.campoLabel}</b> — {d.valorDocumento ?? "—"} → {d.valorArvore ?? "—"}
              <span className="block text-[var(--text-muted)]">{d.pessoaNome} · {d.documentoTitulo}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Etapas</div>
        <ol className="space-y-1">
          {passos.slice().sort((a, b) => a.ordem - b.ordem).map((p) => {
            const concluida = p.status === "CONCLUIDO"
            const ativa = p.id === passoAtualId
            const disponivel = concluida || ativa
            return (
              <li key={p.id}>
                <button
                  disabled={!disponivel}
                  onClick={() => onAbrirPasso(p.id)}
                  className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs ${
                    ativa ? "border-[var(--action-primary)] bg-[var(--surface-secondary)]"
                    : concluida ? "border-[var(--border-default)] text-[var(--text-secondary)]"
                    : "border-[var(--border-default)] opacity-50 cursor-not-allowed"}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${concluida ? "bg-green-700 text-white" : ativa ? "bg-[var(--action-primary)] text-white" : "bg-[var(--surface-tertiary)] text-white/60"}`}>
                      {concluida ? "✓" : p.ordem}
                    </span>
                    <span className="text-white/90">{rotuloPasso(p.stepKey)}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[var(--text-muted)]">
                    {p.prazo && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDia(p.prazo)}</span>}
                    {p.responsavel?.nome}
                  </span>
                </button>
              </li>
            )
          })}
          {passos.length === 0 && <li className="text-xs text-[var(--text-muted)]">As etapas deste pedido ainda não foram materializadas.</li>}
        </ol>
      </div>
    </div>
  )
}

function Info({ icone, rotulo, valor, detalhe }: { icone: React.ReactNode; rotulo: string; valor: string; detalhe?: string | null }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{icone}{rotulo}</div>
      <div className="text-sm text-white/90 mt-0.5">{valor}</div>
      {detalhe && <div className="text-[11px] text-[var(--text-secondary)]">{detalhe}</div>}
    </div>
  )
}
