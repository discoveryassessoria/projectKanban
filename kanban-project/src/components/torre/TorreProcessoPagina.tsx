"use client"
// src/components/torre/TorreProcessoPagina.tsx — o DETALHE DO PROCESSO (`/torre/processo/[id]`) — Torre nova, frente H.
// Uma só leitura (`GET /api/torre/foco/{id}?detalhe=1`: o MESMO objeto do Foco da família + o que a página precisa) e as portas
// canônicas para agir: distribuir (`/api/torre/processos/{id}/distribuir`), atribuir (`atribuir-sugerido`), pausar/reativar
// (`processo-pausa.ts`), reabrir certidão (`reabrir-certidao`), avanço forçado (`advance/force`), comentários (`/api/comentarios`).
// Nada daqui calcula regra: o servidor entrega os textos e os números; esta página desenha, filtra a tabela e chama as portas.
import { useConfirmarAtribuicao } from "./ConfirmarAtribuicao"
import { useLoteDeAtribuicao } from "./lote-atribuicao"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { HistoricoLinhaDoTempo } from "./HistoricoLinhaDoTempo"
import type { CertidaoDoFiltro } from "@/lib/operacional/historico-linha-do-tempo"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import type { DetalheDoProcesso } from "@/lib/operacional/torre-foco"
import type { LinhaDaTabela } from "@/lib/operacional/torre-processo-puro"
import { api, erroDe, Modal, ModalTexto, useEscFecha } from "./torre-base"
import { SeletorResponsavel } from "@/src/components/operacao/kit-operacional"
import { ProcessoRelatorio } from "./ProcessoRelatorio"
import { ProcessoCabecalho } from "./ProcessoCabecalho"
import { ProcessoCaminho } from "./ProcessoCaminho"
import { ProcessoCertidoes } from "./ProcessoCertidoes"
import { VoltarDaTorre } from "./VoltarDaTorre"
import { escreverRelatorioNaUrl, lerRelatorioDaUrl, type FiltrosDoRelatorio } from "@/lib/operacional/torre-relatorio-filtros"
import type { FiltroDeStatusDaTabela } from "@/lib/operacional/torre-processo-puro"
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
  // O RELATÓRIO VIVE NA URL (`?relatorio=1&rel_fase=…`): um link copiado abre a janela já filtrada; sem parâmetros, os padrões. `replace` (não empilha
  // histórico): o "voltar" do navegador e o botão Voltar continuam levando à página de onde a pessoa veio.
  const router = useRouter()
  const caminhoAtual = usePathname()
  const paramsUrl = useSearchParams()
  const relatorioDaUrl = lerRelatorioDaUrl(paramsUrl)
  const gravarRelatorio = useCallback((aberto: boolean, filtros: FiltrosDoRelatorio) => {
    const q = escreverRelatorioNaUrl(new URLSearchParams(window.location.search), { aberto, filtros }).toString()
    router.replace(q ? `${caminhoAtual}?${q}` : caminhoAtual, { scroll: false })
  }, [router, caminhoAtual])
  // O estado da lista de certidões: o padrão é só as ATIVAS; o bloco "Cancelada / não exigida" e o select de Status mexem neste mesmo estado.
  const [faseSelecionada, setFaseSelecionada] = useState<string | null>(null)
  const [statusDaLista, setStatusDaLista] = useState<FiltroDeStatusDaTabela>("ATIVAS")
  const [ocupado, setOcupado] = useState(false)
  const [toast, setToast] = useState<ToastDaPagina | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [modal, setModal] = useState<
    | null | { tipo: "pausar" } | { tipo: "forcar" } | { tipo: "historico"; certidao: CertidaoDoFiltro | null }
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

  const { postar: postarComConfirmacao, modal: modalConfirmacao } = useConfirmarAtribuicao()
  // As ações em lote da tabela (Atribuir a…, Remover responsável, Atribuir às sugeridas) são as MESMAS da aba Tarefas (lote-atribuicao.tsx).
  const lote = useLoteDeAtribuicao({
    podeEditar: perm.editar, preEscolher: false,
    onResultado: (msg, desfazer) => { avisar(msg, desfazer ? { rotulo: "Desfazer", fazer: desfazerAtribuicao(desfazer as DesfazerDeAtribuicao) } : undefined); recarregar() },
  })
  const distribuir = async () => {
    setOcupado(true)
    const r = await postarComConfirmacao<{ ok: boolean; mensagem: string; desfazer: DesfazerDeAtribuicao | null; error?: string }>(`/api/torre/processos/${processoId}/distribuir`)
    setOcupado(false)
    if (r.data?.mensagem) avisar(r.data.mensagem, r.data.desfazer ? { rotulo: "Desfazer", fazer: desfazerAtribuicao(r.data.desfazer) } : undefined)
    else avisar(erroDe(r.data))
    recarregar()
  }

  // ATRIBUIR abre a ESCOLHA do funcionário (a mesma lista da Operação) — nunca atribui sozinho à sugestão. Atribuir automaticamente é o botão «Distribuir».
  const [escolha, setEscolha] = useState<number[] | null>(null)
  const [erroEscolha, setErroEscolha] = useState<string | null>(null)
  const atribuir = (tarefaId: number) => { setErroEscolha(null); setEscolha([tarefaId]) }
  const atribuirA = async (ids: number[], responsavelId: number) => {
    setOcupado(true); setErroEscolha(null)
    const feitas: number[] = []
    let primeiraFalha: string | null = null
    for (const id of ids) {
      const r = await api<{ ok?: boolean; erro?: string }>(`/api/tarefas/${id}/comando`, "POST", { acao: "atribuir", responsavelId })
      if (r.ok) feitas.push(id); else primeiraFalha = primeiraFalha ?? erroDe(r.data)
    }
    setOcupado(false)
    if (feitas.length === 0) { setErroEscolha(primeiraFalha ?? "Não foi possível atribuir."); return } // a escolha continua aberta
    setEscolha(null)
    avisar(
      ids.length === 1 ? "Responsável atribuído · fica no histórico" : `${feitas.length} de ${ids.length} atribuídas · fica no histórico${primeiraFalha ? ` · ${ids.length - feitas.length} não passou(aram): ${primeiraFalha}` : ""}`,
      { rotulo: "Desfazer", fazer: desfazerAtribuicao({ tipo: "ATRIBUICAO", tarefaIds: feitas }) },
    )
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
      {modalConfirmacao}
      <div className="tor">
        <div className="tpr">
          <VoltarDaTorre />
          <ProcessoCabecalho
            d={d} agora={agora} perm={perm} ocupado={ocupado}
            onDistribuir={() => void distribuir()} onRelatorio={() => gravarRelatorio(true, relatorioDaUrl.filtros)} onHistorico={() => setModal({ tipo: "historico", certidao: null })}
            onPausar={() => setModal({ tipo: "pausar" })} onReativar={() => void reativar(false)} onForcar={() => setModal({ tipo: "forcar" })}
          />
          <ProcessoCaminho d={d} agora={agora} encerradasNaLista={statusDaLista === "TODOS" || statusDaLista === "ENCERRADAS"} onAlternarEncerradas={() => setStatusDaLista((s) => (s === "TODOS" || s === "ENCERRADAS" ? "ATIVAS" : "TODOS"))} faseSelecionada={faseSelecionada} onFase={setFaseSelecionada} />
          <ProcessoCertidoes
            status={statusDaLista} onStatus={setStatusDaLista}
            d={d} agora={agora} podeAtribuir={perm.editar} ocupado={ocupado}
            onHistorico={(l) => setModal({ tipo: "historico", certidao: { documentoId: l.documentoId, tarefaId: l.tarefaId, rotulo: [l.titulo, l.pessoa].filter(Boolean).join(" · ") } })}
            onAtribuir={atribuir} lote={lote} faseSelecionada={faseSelecionada} onFase={setFaseSelecionada}
            onMotivo={(l) => setModal({ tipo: "motivo", linha: l })} onReabrir={(l) => setModal({ tipo: "reabrir", linha: l })}
            onVerHistorico={() => setModal({ tipo: "historico", certidao: null })}
          />
          {escolha && (
            <SeletorResponsavel
              titulo={escolha.length === 1 ? "Atribuir tarefa" : `Atribuir ${escolha.length} tarefas`}
              atual={null} ocupado={ocupado} erro={erroEscolha}
              aoFechar={() => { setEscolha(null); setErroEscolha(null) }}
              aoEscolher={(id) => void atribuirA(escolha, id)}
            />
          )}
          <ProcessoFatos processoId={processoId} agora={agora} versao={versao} onVerTudo={() => setModal({ tipo: "historico", certidao: null })} />
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
        {relatorioDaUrl.aberto && perm.relatorio && (
          <ProcessoRelatorio processoId={d.processoId} processoRotulo={d.codigo ?? d.familiaNome} familiaId={d.familiaId} familiaNome={d.familiaNome}
            filtrosIniciais={relatorioDaUrl.filtros} onFiltros={(f) => gravarRelatorio(true, f)} onFechar={() => gravarRelatorio(false, relatorioDaUrl.filtros)} avisar={avisarSimples} />
        )}
        {modal?.tipo === "historico" && (<HistoricoEsc onFechar={() => setModal(null)} />)}
        {modal?.tipo === "historico" && (
          <div className="tpr-modal" style={{ zIndex: 10050 }} onClick={() => setModal(null)}>
            <div role="dialog" aria-label="Histórico completo" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>Histórico completo · {d.familiaNome}</div>
                <button type="button" aria-label="Fechar" className="tpr-linkbtn" style={{ marginLeft: "auto", fontSize: 20, textDecoration: "none" }} onClick={() => setModal(null)}>✕</button>
              </div>
              <HistoricoLinhaDoTempo processoId={d.processoId} url={`/api/torre/foco/${d.processoId}/historico`} certidaoInicial={modal.certidao} />
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
