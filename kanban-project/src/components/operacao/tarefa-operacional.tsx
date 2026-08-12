// src/components/operacao/tarefa-operacional.tsx
// ============================================================================
// A TAREFA OPERACIONAL — onde o trabalho é executado.
//
// Abre como painel lateral sobre a fila, porque a execução é uma continuação
// do que a pessoa estava olhando, não um lugar novo aonde ela viaja.
//
// ─── O WORKFLOW INTERNO É O CENTRO ──────────────────────────────────────────
// O corpo da tela são as etapas DESTA tarefa: as concluídas com ✓, a corrente
// destacada, as futuras visíveis mas inertes. É a resposta a "em que pé está
// isto?" sem abrir mais nada.
//
// ─── CINCO ETAPAS, UM TRABALHO ──────────────────────────────────────────────
// Concluir "Solicitar certidão" NÃO fecha a tarefa: move o trabalho para a
// etapa seguinte, com o mesmo taskId, o mesmo responsável e o mesmo prazo. Só
// a última etapa encerra — e quem decide qual é a última é o workflow.
//
// ─── ESTA TELA NÃO ESCREVE ──────────────────────────────────────────────────
// Iniciar, concluir etapa, aguardar terceiro e retomar saem todos por
// `POST /api/tarefas/{id}/comando`. Nada aqui toca em Tarefa ou em passo, e
// nada aqui usa a árvore legada de subtarefas.
// ============================================================================
"use client"

import { useCallback, useEffect, useState } from "react"
// O MESMO componente que a Central da Etapa monta. Não é uma cópia nem um
// "modal da fila": é o executor especializado, com os seus canais, evidências
// condicionais e ação terminal. Duas entradas, uma implementação.
import { StepEditorRouter } from "@/src/components/kanban/workflow/StepEditors"
import { stepInstanceStatusToLegacy } from "@/src/lib/process-stage/legacy-status-map"

interface Etapa {
  id: number
  ordem: number
  titulo: string
  stepKey: string
  status: string
  obrigatorio: boolean
  concluidaEm: string | null
  prazo: string | null
  atual: boolean
  /** Qual superfície operacional executa esta etapa — vem do registry. */
  editorKind: string
  /** false = etapa sem operação estruturada; a conclusão genérica basta. */
  especializado: boolean
  documentoId: number | null
}

interface Anexo {
  id: number
  nome: string
  url: string
  classificacao: string | null
  finalidade: string
  autor: string | null
  em: string
  etapaId: number | null
}
interface ProtocoloItem { id: number; numero: string | null; tipo: string | null; em: string }
interface ObservacaoItem { id: number; texto: string; autor: string | null; em: string }
interface FatoDaTimeline { em: string; tipo: string; texto: string; autor: string | null }

interface HistoricoItem {
  id: number
  acao: string
  descricao: string | null
  criadoEm: string
}

export interface TarefaDetalhe {
  taskId: number
  titulo: string
  processoNome: string | null
  pessoaNome: string | null
  faseMacroKey: string | null
  servico: string | null
  statusTarefa: string
  responsavelNome: string | null
  responsavelId: number | null
  prioridade: string
  dataPrazo: string | null
  atrasada: boolean
  etapas: Etapa[]
  documentoId: number | null
  anexos: Anexo[]
  protocolos: ProtocoloItem[]
  observacoes: ObservacaoItem[]
  timeline: FatoDaTimeline[]
  historico: HistoricoItem[]
  tempos: { criadaEm: string | null; atribuidaEm: string | null; iniciadaEm: string | null; concluidaEm: string | null }
}

const auth = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
})

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"
const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"

const ROTULO_STATUS: Record<string, string> = {
  NAO_INICIADA: "Não iniciada",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  AGUARDANDO_CLIENTE: "Aguardando cliente",
  BLOQUEADA: "Bloqueada",
  CONCLUIDO_RECEBIDO: "Concluída",
  CONCLUIDO_NAO_POSSUI: "Concluída",
  CANCELADA: "Cancelada",
  SUPERSEDIDA: "Supersedida",
}
const ROTULO_PRIORIDADE: Record<string, string> = { URGENTE: "Urgente", ALTA: "Alta", MEDIA: "Normal", BAIXA: "Baixa" }
const CONCLUIDOS = ["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"]

/**
 * A FINALIDADE DO ARQUIVO EM PORTUGUÊS.
 *
 * Quando o cadastro mestre resolve a classificação, é ela que aparece — é a
 * informação mais precisa ("Requerimento de inteiro teor"). Sem cadastro
 * resolvido, cai na finalidade operacional; mas `REQUERIMENTO_ENVIADO` é
 * vocabulário de banco, e a tela mostra gente.
 */
const ROTULO_FINALIDADE: Record<string, string> = {
  REQUERIMENTO_ENVIADO: "Requerimento enviado",
  COMPROVANTE_PROTOCOLO: "Comprovante de protocolo",
  COMPROVANTE_CONTATO: "Comprovante de contato",
  DOCUMENTO_RECEBIDO: "Documento recebido",
  OUTRO: "Arquivo",
}

/** A cor separa a natureza do fato — quem varre a lista lê antes de ler. */
const TOM_DO_FATO: Record<string, string> = {
  tarefa: "text-white/30",
  etapa: "text-sky-300/60",
  observacao: "text-amber-300/50",
  anexo: "text-emerald-300/50",
  protocolo: "text-violet-300/50",
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-white/35">{rotulo}</div>
      <div className="mt-0.5 truncate text-[12px] text-white/80">{children}</div>
    </div>
  )
}

/**
 * UMA ETAPA DO ROTEIRO.
 *
 * O estado é lido antes do texto: ✓ para o que já foi feito, um ponto cheio
 * para onde o trabalho está, um círculo vazio para o que ainda não chegou. As
 * futuras aparecem porque saber o que vem depois faz parte de entender o
 * trabalho — mas não têm ação, porque a precedência não permite.
 */
function LinhaEtapa({ e, acao }: { e: Etapa; acao?: React.ReactNode }) {
  const concluida = CONCLUIDOS.includes(e.status)
  const marca = concluida ? "✓" : e.atual ? "●" : "○"
  const cor = concluida ? "text-emerald-300/70" : e.atual ? "text-sky-300" : "text-white/25"
  return (
    <div className={`flex items-start gap-3 rounded px-3 py-2.5 ${e.atual ? "bg-sky-400/[0.07] ring-1 ring-inset ring-sky-300/20" : ""}`}>
      <span className={`mt-[1px] w-4 shrink-0 text-center text-[12px] ${cor}`}>{marca}</span>
      <div className="min-w-0 flex-1">
        <div className={`text-[12px] ${concluida ? "text-white/45 line-through decoration-white/20" : e.atual ? "text-white/95" : "text-white/50"}`}>
          {e.ordem}. {e.titulo}
        </div>
        <div className="mt-0.5 text-[10px] text-white/30">
          {concluida ? `Concluída em ${dataHora(e.concluidaEm)}` : e.atual ? "Etapa atual" : "Aguarda as anteriores"}
          {!e.obrigatorio && " · opcional"}
        </div>
      </div>
      {acao}
    </div>
  )
}

export function TarefaOperacional({ taskId, aoFechar, aoMudar }: { taskId: number; aoFechar: () => void; aoMudar: () => void }) {
  const [dados, setDados] = useState<{ chave: number; t: TarefaDetalhe | null; podeExecutar: boolean; podeForcar: boolean } | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [motivo, setMotivo] = useState("")
  const [pedindoMotivo, setPedindoMotivo] = useState<null | "aguardar" | "retomar">(null)
  /** Etapa cujo executor especializado está montado. */
  const [executando, setExecutando] = useState<Etapa | null>(null)
  const [novaObservacao, setNovaObservacao] = useState("")

  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas/${taskId}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivo) setDados({ chave: recarga, t: d.tarefa, podeExecutar: !!d.podeExecutar, podeForcar: !!d.podeForcar }) })
      .catch(() => { if (vivo) setDados({ chave: recarga, t: null, podeExecutar: false, podeForcar: false }) })
    return () => { vivo = false }
  }, [taskId, recarga])

  const carregando = dados?.chave !== recarga
  const t = carregando ? null : dados?.t ?? null
  const falhou = !carregando && t == null

  const comandar = useCallback(
    async (corpo: Record<string, unknown>) => {
      setOcupado(true)
      setErro(null)
      try {
        const r = await fetch(`/api/tarefas/${taskId}/comando`, { method: "POST", headers: auth(), body: JSON.stringify(corpo) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          setErro(r.status === 409 ? "Esta tarefa foi alterada por outro usuário. Recarregando." : (d.error ?? "Não foi possível concluir a ação."))
          setRecarga((n) => n + 1)
          return
        }
        setPedindoMotivo(null)
        setMotivo("")
        setRecarga((n) => n + 1)
        // A fila atrás também muda: a etapa corrente é o que ela mostra.
        aoMudar()
      } catch {
        setErro("Falha de rede. Tente novamente.")
      } finally {
        setOcupado(false)
      }
    },
    [taskId, aoMudar],
  )

  /**
   * ANOTAR PASSA PELA PORTA DOCUMENTAL QUE JÁ EXISTE.
   *
   * `POST /api/documentos/{id}/observacoes` já valida permissão, escopo da
   * etapa e idempotência, e grava em `DocumentoObservacao` com autor e hora.
   * Uma rota de observação "da tarefa" seria a segunda fonte sobre o mesmo
   * fato — e as duas discordariam no primeiro dia.
   */
  const anotar = useCallback(async () => {
    const texto = novaObservacao.trim()
    if (!texto || !t?.documentoId) return
    setOcupado(true)
    setErro(null)
    try {
      const r = await fetch(`/api/documentos/${t.documentoId}/observacoes`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ texto, stepInstanceId: t.etapas.find((e) => e.atual)?.id ?? null }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErro(r.status === 403 ? "Você não tem permissão para anotar neste trabalho." : (d.error ?? "Não foi possível anotar."))
        return
      }
      setNovaObservacao("")
      setRecarga((n) => n + 1)
    } catch {
      setErro("Falha de rede. Tente novamente.")
    } finally {
      setOcupado(false)
    }
  }, [novaObservacao, t])

  const etapaAtual = t?.etapas.find((e) => e.atual) ?? t?.etapas.find((e) => !CONCLUIDOS.includes(e.status))
  const terminal = t ? ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"].includes(t.statusTarefa) : false
  const naoIniciada = t?.statusTarefa === "NAO_INICIADA"
  const aguardando = t?.statusTarefa === "AGUARDANDO_TERCEIRO"

  return (
    <>
    {/* O FUNDO FECHA O PAINEL — mas só ele.
        Este `onClick` já esteve no elemento que ENVOLVIA o executor, e engolia
        os cliques dele: o executor é montado por `createPortal`, e no React o
        evento sobe pela árvore de COMPONENTES, não pela do DOM. Resultado: o
        operador marcava "Digital (PDF eletrônico)" dentro do modal e o painel
        inteiro fechava por baixo dele. Agora o executor é IRMÃO deste overlay,
        não filho. */}
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50" onClick={aoFechar}>
      <aside
        className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-white/10 bg-[#0b0d10] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── CABEÇALHO: o que é este trabalho ─────────────────────────── */}
        <header className="border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-white/30">Tarefa</div>
              <h2 className="mt-0.5 truncate text-[15px] font-medium text-white/95">{t?.titulo ?? "Carregando…"}</h2>
            </div>
            <button onClick={aoFechar} className="shrink-0 rounded px-2 py-1 text-[11px] text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/80">
              Fechar
            </button>
          </div>

          {t && (
            <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3">
              <Campo rotulo="Pessoa">{t.pessoaNome ?? "—"}</Campo>
              <Campo rotulo="Processo">{t.processoNome ?? "—"}</Campo>
              <Campo rotulo="Fase">{t.faseMacroKey?.replace(/_/g, " ") ?? "—"}</Campo>
              <Campo rotulo="Responsável">{t.responsavelNome ?? "Sem responsável"}</Campo>
              <Campo rotulo="Status">{ROTULO_STATUS[t.statusTarefa] ?? t.statusTarefa}</Campo>
              <Campo rotulo="Prioridade">{ROTULO_PRIORIDADE[t.prioridade] ?? t.prioridade}</Campo>
              <Campo rotulo="Prazo">
                <span className={t.atrasada ? "text-red-300/90" : ""}>{dataCurta(t.dataPrazo)}</span>
              </Campo>
              <Campo rotulo="Serviço">{t.servico ?? "—"}</Campo>
              <Campo rotulo="Iniciada">{dataCurta(t.tempos.iniciadaEm)}</Campo>
            </div>
          )}
        </header>

        {erro && <div className="border-b border-red-400/20 bg-red-500/10 px-5 py-2 text-[11px] text-red-200/90">{erro}</div>}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {carregando && (
            <div className="flex justify-center py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-transparent" />
            </div>
          )}
          {falhou && <p className="py-16 text-center text-[12px] text-white/45">Não foi possível carregar a tarefa.</p>}

          {t && (
            <>
              {/* ─── O WORKFLOW INTERNO ────────────────────────────────── */}
              <section>
                <h3 className="mb-2 text-[10px] uppercase tracking-wide text-white/35">
                  Workflow interno · {t.etapas.length} etapa{t.etapas.length === 1 ? "" : "s"}
                </h3>
                <div className="overflow-hidden rounded border border-white/[0.07] bg-white/[0.015]">
                  {t.etapas.length === 0 && (
                    <p className="px-3 py-6 text-center text-[11px] text-white/35">Esta tarefa não tem workflow interno.</p>
                  )}
                  {t.etapas.map((e) => (
                    <LinhaEtapa
                      key={e.id}
                      e={e}
                      acao={
                        // ETAPA CONCLUÍDA continua consultável — em modo leitura,
                        // pelo mesmo executor. Reenviar a operação exige reabertura
                        // canônica, não um segundo clique.
                        CONCLUIDOS.includes(e.status) && e.especializado && e.documentoId != null ? (
                          <button
                            onClick={() => setExecutando(e)}
                            className="shrink-0 rounded px-2 py-1 text-[11px] text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                          >
                            Ver
                          </button>
                        ) : e.atual && dados?.podeExecutar && !terminal && !naoIniciada && !aguardando ? (
                          e.especializado && e.documentoId != null ? (
                            // O TRABALHO DA ETAPA NÃO CABE NUM BOTÃO DE CONCLUSÃO.
                            //
                            // "Solicitar certidão" é escolher canal, reunir as
                            // evidências que aquele canal exige, anexar o
                            // requerimento, registrar cartório, atendente, custo e
                            // forma de pagamento. Oferecer "Concluir etapa" aqui
                            // seria pedir que alguém declarasse feito um trabalho
                            // que o sistema não viu acontecer.
                            <button
                              onClick={() => setExecutando(e)}
                              className="shrink-0 rounded border border-sky-300/30 bg-sky-400/10 px-2.5 py-1 text-[11px] text-sky-100/90 transition-colors hover:bg-sky-400/20"
                            >
                              {e.status === "EM_ANDAMENTO" ? "Continuar etapa" : "Abrir etapa"}
                            </button>
                          ) : (
                            // Etapa SIMPLES: sem operação estruturada a executar, a
                            // conclusão direta é a ação honesta.
                            <button
                              disabled={ocupado}
                              onClick={() => void comandar({ acao: "concluir_etapa", etapaId: e.id })}
                              className="shrink-0 rounded border border-sky-300/30 bg-sky-400/10 px-2.5 py-1 text-[11px] text-sky-100/90 transition-colors hover:bg-sky-400/20 disabled:opacity-40"
                            >
                              Concluir etapa
                            </button>
                          )
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </section>

              {/* ─── O QUE ESTE TRABALHO PRODUZIU ──────────────────────────
                  Anexo, protocolo e observação NÃO são guardados pela Tarefa:
                  vivem em `DocumentoArquivo`, `Protocolo` e
                  `DocumentoObservacao`, com autor, data e vínculos próprios.
                  Aqui eles são LIDOS — a tarefa reúne num lugar o que hoje
                  exigiria abrir a Central e caçar por documento. */}
              {(t.anexos.length > 0 || t.protocolos.length > 0) && (
                <section className="mt-6 grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="mb-2 text-[10px] uppercase tracking-wide text-white/35">
                      Anexos · {t.anexos.length}
                    </h3>
                    <div className="space-y-1">
                      {t.anexos.length === 0 && <p className="text-[11px] text-white/30">Nenhum arquivo ainda.</p>}
                      {t.anexos.map((a) => (
                        <a
                          key={a.id}
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded border border-white/[0.07] px-2.5 py-1.5 transition-colors hover:border-white/20 hover:bg-white/[0.03]"
                        >
                          <div className="truncate text-[11px] text-white/80">{a.nome}</div>
                          <div className="mt-0.5 truncate text-[10px] text-white/35">
                            {a.classificacao ?? ROTULO_FINALIDADE[a.finalidade] ?? "Arquivo"}
                            {a.autor && ` · ${a.autor}`} · {dataHora(a.em)}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-[10px] uppercase tracking-wide text-white/35">
                      Protocolo{t.protocolos.length === 1 ? "" : "s"} · {t.protocolos.length}
                    </h3>
                    <div className="space-y-1">
                      {t.protocolos.length === 0 && <p className="text-[11px] text-white/30">Sem protocolo registrado.</p>}
                      {t.protocolos.map((p) => (
                        <div key={p.id} className="rounded border border-white/[0.07] px-2.5 py-1.5">
                          <div className="truncate font-mono text-[11px] text-white/85">{p.numero}</div>
                          <div className="mt-0.5 text-[10px] text-white/35">{dataHora(p.em)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {/* ─── OBSERVAÇÕES ───────────────────────────────────────────
                  Append-only: cada anotação é uma linha nova, com autor e hora.
                  Nunca sobrescrever a anterior — o que alguém escreveu sobre o
                  trabalho continua valendo mesmo quando outra pessoa discorda. */}
              <section className="mt-6">
                <h3 className="mb-2 text-[10px] uppercase tracking-wide text-white/35">
                  Observações · {t.observacoes.length}
                </h3>
                {t.documentoId != null && dados?.podeExecutar && !terminal && (
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      value={novaObservacao}
                      onChange={(e) => setNovaObservacao(e.target.value)}
                      placeholder="Anotar algo sobre este trabalho…"
                      className="min-w-0 flex-1 rounded border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/85 outline-none placeholder:text-white/25 focus:border-sky-300/40"
                    />
                    <button
                      disabled={ocupado || !novaObservacao.trim()}
                      onClick={() => void anotar()}
                      className="rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                    >
                      Anotar
                    </button>
                  </div>
                )}
                <div className="space-y-1.5">
                  {t.observacoes.length === 0 && <p className="text-[11px] text-white/30">Nenhuma observação.</p>}
                  {t.observacoes.map((o) => (
                    <div key={o.id} className="rounded border border-white/[0.06] px-2.5 py-1.5">
                      <div className="text-[11px] text-white/75">{o.texto}</div>
                      <div className="mt-0.5 text-[10px] text-white/30">
                        {o.autor ?? "—"} · {dataHora(o.em)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ─── A HISTÓRIA DO TRABALHO ────────────────────────────────
                  Projeção de quatro fontes (auditoria da tarefa, eventos do
                  workflow, observações e arquivos) numa ordem só. Não existe
                  tabela de timeline — existiria a divergência de sempre. */}
              <section className="mt-6">
                <h3 className="mb-2 text-[10px] uppercase tracking-wide text-white/35">Histórico</h3>
                <div className="space-y-1.5">
                  {t.timeline.length === 0 && <p className="text-[11px] text-white/35">Sem registros ainda.</p>}
                  {t.timeline.map((f, i) => (
                    <div key={`${f.em}-${i}`} className="flex gap-3 text-[11px]">
                      <span className="shrink-0 tabular-nums text-white/30">{dataHora(f.em)}</span>
                      <span className={`shrink-0 ${TOM_DO_FATO[f.tipo] ?? "text-white/30"}`}>●</span>
                      <span className="min-w-0 text-white/55">
                        {f.texto}
                        {f.autor && <span className="text-white/30"> — {f.autor}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        {/* ─── AÇÕES: só o que faz sentido no estado atual ─────────────── */}
        {t && dados?.podeExecutar && !terminal && (
          <footer className="border-t border-white/[0.08] px-5 py-3">
            {pedindoMotivo ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={pedindoMotivo === "aguardar" ? "Do que se está esperando?" : "O que mudou?"}
                  className="min-w-0 flex-1 rounded border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/85 outline-none placeholder:text-white/25 focus:border-sky-300/40"
                />
                <button
                  disabled={ocupado || !motivo.trim()}
                  onClick={() => void comandar({ acao: pedindoMotivo === "aguardar" ? "aguardar_terceiro" : "retomar_espera", motivo })}
                  className="rounded border border-white/15 px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                >
                  Confirmar
                </button>
                <button onClick={() => { setPedindoMotivo(null); setMotivo("") }} className="px-2 py-1.5 text-[11px] text-white/40 hover:text-white/70">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {naoIniciada && (
                  <button
                    disabled={ocupado}
                    onClick={() => void comandar({ acao: "iniciar" })}
                    className="rounded border border-sky-300/30 bg-sky-400/10 px-3 py-1.5 text-[12px] text-sky-100/90 transition-colors hover:bg-sky-400/20 disabled:opacity-40"
                  >
                    Iniciar tarefa
                  </button>
                )}
                {aguardando ? (
                  <button
                    disabled={ocupado}
                    onClick={() => setPedindoMotivo("retomar")}
                    className="rounded border border-white/15 px-3 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                  >
                    Registrar retorno
                  </button>
                ) : (
                  !naoIniciada && (
                    <button
                      disabled={ocupado}
                      onClick={() => setPedindoMotivo("aguardar")}
                      className="rounded border border-white/15 px-3 py-1.5 text-[12px] text-white/70 transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                    >
                      Aguardar terceiro
                    </button>
                  )
                )}
                {etapaAtual && (
                  <span className="ml-auto truncate text-[11px] text-white/35">Etapa atual: {etapaAtual.titulo}</span>
                )}
              </div>
            )}
          </footer>
        )}
      </aside>
    </div>

      {/* O EXECUTOR ESPECIALIZADO — o mesmo da Central, com contexto canônico.
          `stepId` É o stepInstanceId; o documento vem da etapa, não de estado
          global. Ao salvar, quem concluiu o passo foi a porta canônica lá
          dentro: aqui só recarregamos a tarefa e a fila. */}
      {executando?.documentoId != null && (
        <StepEditorRouter
          stepKey={executando.stepKey}
          editorKind={executando.editorKind as never}
          stepTitle={executando.titulo}
          documentoId={executando.documentoId}
          stepId={executando.id}
          // O EXECUTOR FALA O VOCABULÁRIO LEGADO DO PASSO.
          //
          // `stepStatus` é comparado lá dentro contra "concluida" para decidir
          // modo leitura. Passar o status CANÔNICO ("CONCLUIDO") faria a
          // comparação falhar sempre: uma etapa concluída abriria editável, e
          // reenviar a solicitação seria um clique — exatamente o que a
          // reabertura canônica existe para impedir. A conversão é a oficial,
          // a mesma que a Central usa para servir esse contrato.
          stepStatus={stepInstanceStatusToLegacy(executando.status as never)}
          isOpen
          onClose={() => setExecutando(null)}
          onSaved={() => {
            setExecutando(null)
            setRecarga((n) => n + 1)
            aoMudar()
          }}
        />
      )}
    </>
  )
}
