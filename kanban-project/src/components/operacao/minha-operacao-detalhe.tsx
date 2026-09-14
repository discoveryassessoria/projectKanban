// src/components/operacao/minha-operacao-detalhe.tsx
// ============================================================================
// O PAINEL DE DETALHE DE UMA OPERAÇÃO — leitura completa, READ-ONLY.
//
// Busca `GET /api/operacao/tarefas/{tarefaId}` — a MESMA rota que já existia
// (`dossieDaTarefa`, motor canônico), só agora consumida por uma tela. Nada
// aqui executa passo: a única ação é "Abrir no processo" (deep-link), porque
// é lá que a execução acontece.
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpRight, X as XIcon } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { auth, dataCurta, Estado, Etiqueta, ROTULO_PRIORIDADE, ROTULO_STATUS, rotularFase } from "./kit-operacional"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import { humanizarMotivoRisco } from "@/lib/operacional/atencao-operacional"

interface Etapa {
  id: number; ordem: number; titulo: string; stepKey: string; status: string
  obrigatorio: boolean; concluidaEm: string | null; prazo: string | null; atual: boolean
}
interface FatoTimeline { em: string; tipo: string; texto: string; autor: string | null }
interface Anexo {
  id: number; nome: string; url: string; classificacao: string | null; finalidade: string
  tamanho: number | null; mimeType: string | null; autor: string | null; em: string; temProtocolo: boolean
}
interface Protocolo { id: number; numero: string | null; tipo: string | null; em: string }
interface Observacao { id: number; texto: string; autor: string | null; em: string }
interface Historico { id: number; acao: string; usuarioId: number | null; descricao: string | null; criadoEm: string }

interface Dossie {
  taskId: number; titulo: string; processoId: number | null; processoNome: string | null
  pessoaNome: string | null; faseMacroKey: string | null; etapaAtual: string | null
  statusTarefa: string; responsavelId: number | null; responsavelNome: string | null
  prioridade: string; dataPrazo: string | null; atrasada: boolean; rotuloDoPrazo: string
  terceiroNome: string | null; servico: string | null; requerDecisao: boolean; atribuidaEm: string | null
  passoAtual: { ordem: number; total: number } | null
  emRisco: boolean; motivosRisco: string[]
  atrasoInterno: boolean; atrasoTerceiro: boolean; acompanhamentoVencido: boolean; retornoRecebido: boolean
  proximoAcontecimento: { tipo: string; data: string | null; descricao: string } | null
  porQueExisto: { workflowVersao: number | null; justificativa: string | null }
  tempos: { criadaEm: string | null; atribuidaEm: string | null; iniciadaEm: string | null; concluidaEm: string | null }
  etapas: Etapa[]
  timeline: FatoTimeline[]
  anexos: Anexo[]
  protocolos: Protocolo[]
  observacoes: Observacao[]
  historico: Historico[]
}
interface RespostaDossie { tarefa: Dossie; podeExecutar: boolean; podeDistribuir: boolean; podeForcar: boolean }

const ROTULO_TIPO_EVENTO: Record<string, string> = {
  tarefa: "Tarefa", etapa: "Etapa", observacao: "Observação", anexo: "Anexo", protocolo: "Protocolo",
}

function BlocoTitulo({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{children}</h3>
}
function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
      <span className="text-[var(--text-muted)]">{rotulo}</span>
      <span className="text-right text-[var(--text-primary)]">{valor}</span>
    </div>
  )
}

/** O status de um passo, em linguagem de gente — mesmo vocabulário do mandato §25. */
function EtiquetaEtapa({ e }: { e: Etapa }) {
  if (e.status === "CONCLUIDO") return <Etiqueta tom="sucesso">Concluído</Etiqueta>
  if (e.atual) return <Etiqueta tom="acento">Atual</Etiqueta>
  if (e.status === "BLOQUEADO") return <Etiqueta tom="critico">Bloqueado</Etiqueta>
  if (e.status === "CANCELADO" || e.status === "DISPENSADO") return <Etiqueta tom="neutro">Não aplicável</Etiqueta>
  return <Etiqueta tom="neutro">Aguardando</Etiqueta>
}

export function MinhaOperacaoDetalhe({ taskId, aoFechar }: { taskId: number; aoFechar: () => void }) {
  const router = useRouter()
  const [resultado, setResultado] = useState<{ chave: number; d: RespostaDossie | null } | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas/${taskId}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RespostaDossie) => { if (vivo) setResultado({ chave: taskId, d }) })
      .catch(() => { if (vivo) setResultado({ chave: taskId, d: null }) })
    return () => { vivo = false }
  }, [taskId])

  const carregando = resultado?.chave !== taskId
  const d = carregando ? null : resultado?.d ?? null
  const falhou = !carregando && d == null

  const abrirNoProcesso = () => {
    if (!d) return
    router.push(urlOperacionalDaTarefa({ taskId: d.tarefa.taskId, processoId: d.tarefa.processoId }))
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {carregando && <Estado tipo="carregando" mensagem="Carregando operação…" />}
      {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar esta operação." />}
      {d && (
        <>
          {/* ── CABEÇALHO — item 22 do mandato ── */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{d.tarefa.titulo}</h2>
                  {d.tarefa.requerDecisao && <Etiqueta tom="alerta">Ação necessária</Etiqueta>}
                  {d.tarefa.atribuidaEm && Date.now() - new Date(d.tarefa.atribuidaEm).getTime() <= 48 * 3600_000 && (
                    <Etiqueta tom="acento">Nova</Etiqueta>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                  {[d.tarefa.pessoaNome, d.tarefa.processoNome, rotularFase(d.tarefa.faseMacroKey)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button onClick={aoFechar} aria-label="Fechar" className="shrink-0 rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]">
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <Tabs defaultValue="geral" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0 justify-start rounded-none border-b border-[var(--border-subtle)] bg-transparent px-3">
              <TabsTrigger value="geral">Visão geral</TabsTrigger>
              <TabsTrigger value="passos">Passos</TabsTrigger>
              <TabsTrigger value="prazos">Prazos e acompanhamentos</TabsTrigger>
              <TabsTrigger value="documentos">Documentos</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
              <TabsTrigger value="observacoes">Observações</TabsTrigger>
            </TabsList>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {/* ── VISÃO GERAL — item 24 ── */}
              <TabsContent value="geral" className="mt-0 space-y-4">
                {d.tarefa.proximoAcontecimento && (
                  <div className="rounded-lg border border-[var(--border-default)] bg-[var(--info-tile)] px-3 py-2.5">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--info-text)]">Próximo acontecimento</div>
                    <div className="mt-0.5 text-[13px] text-[var(--info-text)]">{d.tarefa.proximoAcontecimento.descricao}</div>
                    {d.tarefa.proximoAcontecimento.data && (
                      <div className="mt-0.5 text-[11px] text-[var(--info-text)]/80">{dataCurta(d.tarefa.proximoAcontecimento.data)}</div>
                    )}
                  </div>
                )}
                <div>
                  <BlocoTitulo>Resumo da operação</BlocoTitulo>
                  <div className="rounded-lg border border-[var(--border-subtle)] px-3 divide-y divide-[var(--border-subtle)]">
                    <Linha rotulo="Fase" valor={rotularFase(d.tarefa.faseMacroKey) ?? "—"} />
                    <Linha rotulo="Passo atual" valor={d.tarefa.passoAtual ? `${d.tarefa.passoAtual.ordem}/${d.tarefa.passoAtual.total} — ${d.tarefa.etapaAtual ?? "—"}` : d.tarefa.etapaAtual ?? "—"} />
                    <Linha rotulo="Estado" valor={ROTULO_STATUS[d.tarefa.statusTarefa] ?? d.tarefa.statusTarefa} />
                    <Linha rotulo="Responsável" valor={d.tarefa.responsavelNome ?? "Sem responsável"} />
                    <Linha rotulo="Prioridade" valor={ROTULO_PRIORIDADE[d.tarefa.prioridade] ?? d.tarefa.prioridade} />
                    {d.tarefa.terceiroNome && <Linha rotulo="Terceiro" valor={d.tarefa.terceiroNome} />}
                  </div>
                </div>
                {d.tarefa.emRisco && d.tarefa.motivosRisco.length > 0 && (
                  <div>
                    <BlocoTitulo>Pontos de atenção</BlocoTitulo>
                    <ul className="list-inside list-disc space-y-1 text-[12px] text-[var(--warning-text)]">
                      {d.tarefa.motivosRisco.map((m, i) => {
                        const h = humanizarMotivoRisco(m)
                        return (
                          <li key={i} title={`Código técnico: ${h.codigo}`}>{h.texto}</li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </TabsContent>

              {/* ── PASSOS — item 25, READ-ONLY ── */}
              <TabsContent value="passos" className="mt-0">
                <div className="space-y-1.5">
                  {d.tarefa.etapas.map((e) => (
                    <div key={e.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${e.atual ? "border-[var(--border-strong)] bg-[var(--surface-secondary)]" : "border-[var(--border-subtle)]"}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">{e.ordem}/{d.tarefa.etapas.length}</span>
                        <span className="truncate text-[12px] text-[var(--text-primary)]">{e.titulo}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {e.concluidaEm && <span className="text-[10px] tabular-nums text-[var(--text-muted)]">{dataCurta(e.concluidaEm)}</span>}
                        <EtiquetaEtapa e={e} />
                      </div>
                    </div>
                  ))}
                  {d.tarefa.etapas.length === 0 && <p className="text-[12px] text-[var(--text-muted)]">Sem passos de workflow para esta operação.</p>}
                </div>
              </TabsContent>

              {/* ── PRAZOS E ACOMPANHAMENTOS — item 26 ── */}
              <TabsContent value="prazos" className="mt-0 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Prazo da operação</div>
                    <div className={`mt-1 text-[13px] font-medium ${d.tarefa.atrasada ? "text-[var(--danger-text)]" : "text-[var(--text-primary)]"}`}>{d.tarefa.rotuloDoPrazo}</div>
                    <div className="text-[11px] tabular-nums text-[var(--text-muted)]">{dataCurta(d.tarefa.dataPrazo)}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--border-subtle)] p-3">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Previsão / acompanhamento</div>
                    <div className="mt-1 text-[13px] text-[var(--text-primary)]">{d.tarefa.proximoAcontecimento?.descricao ?? "Sem previsão"}</div>
                    {d.tarefa.proximoAcontecimento?.data && <div className="text-[11px] tabular-nums text-[var(--text-muted)]">{dataCurta(d.tarefa.proximoAcontecimento.data)}</div>}
                  </div>
                </div>
                <div>
                  <BlocoTitulo>Condição</BlocoTitulo>
                  <div className="flex flex-wrap gap-1.5">
                    {d.tarefa.atrasoInterno && <Etiqueta tom="critico">Atraso interno</Etiqueta>}
                    {d.tarefa.atrasoTerceiro && <Etiqueta tom="alerta">Terceiro atrasado</Etiqueta>}
                    {d.tarefa.acompanhamentoVencido && <Etiqueta tom="alerta">Acompanhar hoje</Etiqueta>}
                    {d.tarefa.retornoRecebido && <Etiqueta tom="acento">Retorno recebido</Etiqueta>}
                    {d.tarefa.emRisco && <Etiqueta tom="alerta">Em risco</Etiqueta>}
                    {!d.tarefa.atrasoInterno && !d.tarefa.atrasoTerceiro && !d.tarefa.acompanhamentoVencido && !d.tarefa.retornoRecebido && !d.tarefa.emRisco && (
                      <span className="text-[12px] text-[var(--text-muted)]">Nenhuma condição de atenção no momento.</span>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* ── DOCUMENTOS — item 27 ── */}
              <TabsContent value="documentos" className="mt-0 space-y-3">
                {d.tarefa.anexos.length === 0 && <p className="text-[12px] text-[var(--text-muted)]">Nenhum documento anexado ainda.</p>}
                {d.tarefa.anexos.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] text-[var(--text-primary)]">{a.nome}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{a.classificacao ?? a.finalidade} · {dataCurta(a.em)}{a.autor ? ` · ${a.autor}` : ""}</div>
                    </div>
                    {a.temProtocolo && <Etiqueta tom="neutro">Protocolado</Etiqueta>}
                  </div>
                ))}
                {d.tarefa.protocolos.length > 0 && (
                  <div>
                    <BlocoTitulo>Protocolos</BlocoTitulo>
                    {d.tarefa.protocolos.map((p) => (
                      <Linha key={p.id} rotulo={p.tipo ?? "Protocolo"} valor={`${p.numero ?? "—"} · ${dataCurta(p.em)}`} />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── HISTÓRICO — item 28, READ-ONLY, cronológico ── */}
              <TabsContent value="historico" className="mt-0">
                <div className="space-y-2.5 border-l border-[var(--border-subtle)] pl-3">
                  {d.tarefa.timeline.map((f, i) => (
                    <div key={i} className="relative">
                      <div className="absolute -left-[15px] top-1 h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" />
                      <div className="text-[12px] text-[var(--text-primary)]">{f.texto}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {ROTULO_TIPO_EVENTO[f.tipo] ?? f.tipo} · {dataCurta(f.em)}{f.autor ? ` · ${f.autor}` : ""}
                      </div>
                    </div>
                  ))}
                  {d.tarefa.timeline.length === 0 && <p className="text-[12px] text-[var(--text-muted)]">Sem histórico registrado.</p>}
                </div>
              </TabsContent>

              {/* ── OBSERVAÇÕES — item 29, reaproveita DocumentoObservacao ── */}
              <TabsContent value="observacoes" className="mt-0 space-y-2">
                {d.tarefa.observacoes.length === 0 && <p className="text-[12px] text-[var(--text-muted)]">Nenhuma observação registrada.</p>}
                {d.tarefa.observacoes.map((o) => (
                  <div key={o.id} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2">
                    <p className="text-[12px] text-[var(--text-primary)]">{o.texto}</p>
                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">{o.autor ?? "—"} · {dataCurta(o.em)}</p>
                  </div>
                ))}
              </TabsContent>
            </div>
          </Tabs>

          {/* ── CTA — item 30, deep-link exato ── */}
          <div className="shrink-0 border-t border-[var(--border-subtle)] px-4 py-3">
            <button
              onClick={abrirNoProcesso}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--action-primary)] px-3 py-2 text-[12px] font-medium text-[var(--action-primary-ink)] transition-colors hover:bg-[var(--action-primary-hover)]"
            >
              Abrir no processo <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
