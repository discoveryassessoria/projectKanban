"use client"
// src/components/torre/TorreProcessoPagina.tsx — o DETALHE DO PROCESSO (`/torre/processo/[id]`) — Torre nova, frente H.
// Uma só leitura (`GET /api/torre/foco/{id}?detalhe=1`: o MESMO objeto do Foco da família + o que a página precisa) e as portas
// canônicas para agir: distribuir (`/api/torre/processos/{id}/distribuir`), atribuir (`atribuir-sugerido`), pausar/reativar
// (`processo-pausa.ts`), reabrir certidão (`reabrir-certidao`), avanço forçado (`advance/force`), comentários (`/api/comentarios`).
// Nada daqui calcula regra: o servidor entrega os textos e os números; esta página desenha, filtra a tabela e chama as portas.
import { useCallback, useEffect, useRef, useState } from "react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { HistoricoDoProcesso } from "@/src/components/historico/HistoricoDoProcesso"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import type { DetalheDoProcesso } from "@/lib/operacional/torre-foco"
import type { LinhaDaTabela } from "@/lib/operacional/torre-processo-puro"
import { api, erroDe, Modal, ModalTexto, useEscFecha } from "./torre-base"
import { ProcessoRelatorio } from "./ProcessoRelatorio"
import { ProcessoCabecalho } from "./ProcessoCabecalho"
import { ProcessoCaminho } from "./ProcessoCaminho"
import { ProcessoCertidoes } from "./ProcessoCertidoes"
import { VoltarDaTorre } from "./VoltarDaTorre"
import { ProcessoFatos } from "./ProcessoFatos"
import { ProcessoComentarios } from "./ProcessoComentarios"
import "./torre.css"
import "./processo.css"

interface ToastDaPagina { msg: string; acao?: { rotulo: string; fazer: () => void | Promise<void> } }
type DesfazerDeAtribuicao = { tipo: "ATRIBUICAO"; tarefaIds: number[] }

export function TorreProcessoPagina({ processoId }: { processoId: number }) {
  const { pode, isAdmin, carregando: carregandoPerm } = usePermissoes()
  const [d, setD] = useState<DetalheDoProcesso | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [toast, setToast] = useState<ToastDaPagina | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [modal, setModal] = useState<
    | null | { tipo: "pausar" } | { tipo: "forcar" } | { tipo: "relatorio" } | { tipo: "historico" }
    | { tipo: "reabrir"; linha: LinhaDaTabela } | { tipo: "motivo"; linha: LinhaDaTabela }
  >(null)

  const avisar = useCallback((msg: string, acao?: ToastDaPagina["acao"]) => {
    setToast({ msg, acao })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 6000)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const avisarSimples = useCallback((msg: string) => avisar(msg), [avisar])

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  useEffect(() => {
    let vivo = true
    void api<DetalheDoProcesso>(`/api/torre/foco/${processoId}?detalhe=1`).then((r) => {
      if (!vivo) return
      if (r.ok) { setD(r.data); setErro(null) }
      else setErro(r.status === 404 ? "Processo não encontrado." : erroDe(r.data, "Não foi possível abrir o processo."))
    })
    return () => { vivo = false }
  }, [processoId, versao])

  const perm = {
    editar: isAdmin || pode("tarefas.editar"),
    bloquear: isAdmin || pode("tarefas.bloquear"),
    relatorio: isAdmin || pode("relatorios.ver"),
    forcarAvanco: isAdmin || pode("workflow.forcarAvanco"),
  }

  // O DESFAZER de atribuição: a porta existente da Torre (janela de 30 s, só do autor).
  const desfazerAtribuicao = useCallback((desfazer: DesfazerDeAtribuicao) => async () => {
    setToast(null)
    const r = await api<{ total: number; desfeitas: number; itens: Array<{ ok: boolean; mensagem: string }> }>("/api/torre/tarefas/desfazer", "POST", desfazer)
    if (r.data && typeof r.data.desfeitas === "number") {
      const falha = r.data.itens?.find((i) => !i.ok)
      avisar(`Desfeito: ${r.data.desfeitas} de ${r.data.total}.${falha ? ` ${falha.mensagem}` : ""}`)
    } else avisar(erroDe(r.data))
    recarregar()
  }, [avisar, recarregar])

  const distribuir = async () => {
    setOcupado(true)
    const r = await api<{ ok: boolean; mensagem: string; desfazer: DesfazerDeAtribuicao | null; error?: string }>(`/api/torre/processos/${processoId}/distribuir`, "POST")
    setOcupado(false)
    if (r.data?.mensagem) avisar(r.data.mensagem, r.data.desfazer ? { rotulo: "Desfazer", fazer: desfazerAtribuicao(r.data.desfazer) } : undefined)
    else avisar(erroDe(r.data))
    recarregar()
  }

  const nomeAtribuido = (mensagem: unknown): string => String(mensagem ?? "").replace(/^Atribuída a /, "").replace(/\.$/, "")
  const atribuir = async (tarefaId: number) => {
    setOcupado(true)
    const r = await api<{ ok?: boolean; mensagem?: string; erro?: string; desfazer?: DesfazerDeAtribuicao }>(`/api/torre/tarefas/${tarefaId}/atribuir-sugerido`, "POST")
    setOcupado(false)
    if (r.ok && r.data.desfazer) avisar(`Responsável atribuído · ${nomeAtribuido(r.data.mensagem)} · fica no histórico`, { rotulo: "Desfazer", fazer: desfazerAtribuicao(r.data.desfazer) })
    else avisar(erroDe(r.data))
    recarregar()
  }
  const atribuirVarias = async (ids: number[]) => {
    setOcupado(true)
    const feitas: number[] = []
    let primeiraFalha: string | null = null
    for (const id of ids) {
      const r = await api<{ ok?: boolean; erro?: string }>(`/api/torre/tarefas/${id}/atribuir-sugerido`, "POST")
      if (r.ok) feitas.push(id); else primeiraFalha = primeiraFalha ?? erroDe(r.data)
    }
    setOcupado(false)
    avisar(`${feitas.length} de ${ids.length} atribuídas às sugeridas · fica no histórico${primeiraFalha ? ` · ${ids.length - feitas.length} não passou(aram): ${primeiraFalha}` : ""}`,
      feitas.length ? { rotulo: "Desfazer", fazer: desfazerAtribuicao({ tipo: "ATRIBUICAO", tarefaIds: feitas }) } : undefined)
    recarregar()
  }

  const reativar = useCallback(async (desfazer: boolean) => {
    setOcupado(true)
    const r = await api<{ ok: boolean; erro?: string }>(`/api/torre/processos/${processoId}/reativar`, "POST", { desfazer })
    setOcupado(false)
    avisar(r.ok ? (desfazer ? "Pausa desfeita · o processo voltou ao Radar e às contagens da Torre" : "Processo reativado · voltou ao Radar e às contagens da Torre · fica no histórico") : erroDe(r.data))
    recarregar()
  }, [processoId, avisar, recarregar])

  const pausar = async (motivo: string): Promise<{ ok: boolean; mensagem?: string }> => {
    const r = await api<{ ok: boolean; erro?: string }>(`/api/torre/processos/${processoId}/pausar`, "POST", { justificativa: motivo })
    if (!r.ok) return { ok: false, mensagem: erroDe(r.data) }
    setModal(null)
    avisar("Processo pausado com motivo · sai do Radar e das contagens, volta quando você reativar", { rotulo: "Desfazer", fazer: () => reativar(true) })
    recarregar()
    return { ok: true }
  }

  const reabrir = async (linha: LinhaDaTabela, motivo: string): Promise<{ ok: boolean; mensagem?: string }> => {
    const r = await api<{ ok?: boolean; error?: string; mensagem?: string }>(`/api/processos/${processoId}/reabrir-certidao`, "POST", { tarefaId: linha.tarefaId, motivo })
    if (!r.ok) return { ok: false, mensagem: erroDe(r.data) }
    setModal(null)
    avisar("Certidão reaberta · volta para A iniciar e entra de novo na contagem · fica no histórico")
    recarregar()
    return { ok: true }
  }

  const forcar = async (justificativa: string): Promise<{ ok: boolean; mensagem?: string }> => {
    const r = await api<{ success?: boolean; message?: string; error?: string; code?: string }>(`/api/processos/${processoId}/advance/force`, "POST", { justificativa, motivoCodigo: "AVANCO_FORCADO_PELA_TORRE" })
    if (!r.ok || r.data.success === false) return { ok: false, mensagem: erroDe(r.data, "O avanço forçado foi recusado.") }
    setModal(null)
    avisar("Fase avançada na marra · a justificativa ficou no histórico (avanço forçado)")
    recarregar()
    return { ok: true }
  }

  if (erro) return <div className="tor"><div className="tpr"><VoltarDaTorre /><div className="tor-card pad">{erro}</div></div></div>
  if (!d || carregandoPerm) return <div className="tor"><div className="tpr"><VoltarDaTorre /><div className="tor-card pad small">Carregando o processo…</div></div></div>

  const agora = new Date(d.geradoEm)

  return (
    <>
      <div className="tor">
        <div className="tpr">
          <VoltarDaTorre />
          <ProcessoCabecalho
            d={d} agora={agora} perm={perm} ocupado={ocupado}
            onDistribuir={() => void distribuir()} onRelatorio={() => setModal({ tipo: "relatorio" })} onHistorico={() => setModal({ tipo: "historico" })}
            onPausar={() => setModal({ tipo: "pausar" })} onReativar={() => void reativar(false)} onForcar={() => setModal({ tipo: "forcar" })}
          />
          <ProcessoCaminho d={d} agora={agora} />
          <ProcessoCertidoes
            d={d} agora={agora} podeAtribuir={perm.editar} ocupado={ocupado}
            onAtribuir={(id) => void atribuir(id)} onAtribuirVarias={(ids) => void atribuirVarias(ids)}
            onMotivo={(l) => setModal({ tipo: "motivo", linha: l })} onReabrir={(l) => setModal({ tipo: "reabrir", linha: l })}
            onVerHistorico={() => setModal({ tipo: "historico" })}
          />
          <ProcessoFatos processoId={processoId} agora={agora} versao={versao} onVerTudo={() => setModal({ tipo: "historico" })} />
          <ProcessoComentarios processoId={processoId} familiaId={d.familiaId} agora={agora} podeComentar={perm.editar} avisar={avisarSimples} />
        </div>

        {modal?.tipo === "pausar" && (
          <ModalTexto titulo={`Pausar processo · ${d.familiaNome}`} subtitulo="Sai do Radar e das contagens da Torre até você reativar. As tarefas continuam com quem as tem e os prazos não mudam. O motivo vai para o histórico."
            rotulo="Motivo da pausa" confirmar="Pausar processo" onFechar={() => setModal(null)} onEnviar={pausar} />
        )}
        {modal?.tipo === "forcar" && d.trava && (
          <ModalTexto titulo={`Avançar na marra · ${d.familiaNome}`}
            subtitulo={`Ignora a trava (${d.trava.titulo}) e leva o processo à próxima fase. Exige justificativa e fica no histórico como avanço forçado.`}
            rotulo="Justificativa" confirmar="Avançar na marra" onFechar={() => setModal(null)} onEnviar={forcar} />
        )}
        {modal?.tipo === "reabrir" && (
          <ModalTexto titulo={`Reabrir ${modal.linha.titulo}`} subtitulo={`${modal.linha.pessoa ?? "Processo inteiro"} — a mesma tarefa volta (taskId preservado), o histórico anterior fica. Explique por que reabrir.`}
            rotulo="Motivo" confirmar="Reabrir certidão" onFechar={() => setModal(null)} onEnviar={(t) => reabrir(modal.linha, t)} />
        )}
        {modal?.tipo === "motivo" && (
          <Modal titulo={`${modal.linha.titulo} · ${modal.linha.statusRotulo}`} subtitulo={modal.linha.pessoa ?? undefined} onFechar={() => setModal(null)}
            rodape={<button className="tor-btn pri" onClick={() => setModal(null)}>Fechar</button>}>
            <p>{modal.linha.motivoTexto ?? "Sem motivo registrado."}</p>
            {modal.linha.tarefaId != null && <a className="small" href={urlOperacionalDaTarefa({ taskId: modal.linha.tarefaId, processoId })}>Abrir a tarefa</a>}
          </Modal>
        )}
        {modal?.tipo === "relatorio" && (
          <ProcessoRelatorio processoId={d.processoId} processoRotulo={d.codigo ?? d.familiaNome} familiaId={d.familiaId} familiaNome={d.familiaNome} onFechar={() => setModal(null)} avisar={avisarSimples} />
        )}
        {modal?.tipo === "historico" && (<HistoricoEsc onFechar={() => setModal(null)} />)}
        {modal?.tipo === "historico" && (
          <div className="tpr-modal" style={{ zIndex: 10050 }} onClick={() => setModal(null)}>
            <div role="dialog" aria-label="Histórico completo" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>Histórico completo · {d.familiaNome}</div>
                <button type="button" aria-label="Fechar" className="tpr-linkbtn" style={{ marginLeft: "auto", fontSize: 20, textDecoration: "none" }} onClick={() => setModal(null)}>✕</button>
              </div>
              <HistoricoDoProcesso processoId={d.processoId} url={`/api/torre/foco/${d.processoId}/historico`} onMudou={recarregar}
                onAbrirCertidao={(l) => { if (l.tarefaId != null) window.location.assign(urlOperacionalDaTarefa({ taskId: l.tarefaId, processoId: d.processoId })) }} />
            </div>
          </div>
        )}

        {toast && (
          <div className="tpr-toast" role="status">
            <span>{toast.msg}</span>
            {toast.acao && <button className="tor-btn" onClick={() => void toast.acao!.fazer()}>{toast.acao.rotulo}</button>}
            <button className="tor-btn" aria-label="Fechar aviso" onClick={() => setToast(null)}>✕</button>
          </div>
        )}
      </div>
    </>
  )
}

/** Esc fecha o modal "Histórico completo" (T015). */
function HistoricoEsc({ onFechar }: { onFechar: () => void }) { useEscFecha(onFechar); return null }
