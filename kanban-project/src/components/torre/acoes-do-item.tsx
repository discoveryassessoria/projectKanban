"use client"
// src/components/torre/acoes-do-item.tsx — EXECUTA a ação de um item do "Precisa de você" (Bloco J4; Torre nova, frente B2).
// Usado pela seção/tabela E pela Revisão do dia: UM só lugar mapeia `acao` → porta. Cada ação já é real e auditada no servidor
// (POST /api/torre/precisa-de-voce/acao); aqui só se coleta o que a porta pede (pessoa, justificativa, canal…) e se mostra o resultado.
//
// O TOAST é o do protótipo: "<botão> · <1ª parte do título>", com "Desfazer" quando o fato é reversível (atribuição, redistribuição,
// desbloqueio, troca de canal — cada um lê o PRÓPRIO LogAuditoria e recusa se algo mudou depois). Avançar fase, reconciliar, registrar
// ligação e cobrar o cliente são fatos acontecidos: o toast confirma, sem "Desfazer".
import { useConfirmarAtribuicao } from "./ConfirmarAtribuicao"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { CANAIS_SOLICITACAO } from "@/src/lib/process-stage/canais-solicitacao"
import { api, erroDe, Campo, useTorre } from "./torre-base"
import { PdvDialogo as Modal } from "./pdv-modal"
import { nome1, type ItemPrecisa } from "./tipos-precisa"
import "./precisa.css"

const RESULTADOS = [
  ["SEM_RESPOSTA", "Sem resposta"], ["CONFIRMOU_PEDIDO", "Confirmou o pedido"], ["PEDIU_DOCUMENTO", "Pediu documento"],
  ["EM_BUSCA", "Em busca"], ["NAO_LOCALIZOU", "Não localizou"], ["ENVIOU", "Enviou (ainda não recebido)"],
]

interface Pendencia { code: string; message: string }
interface RespAcao {
  ok?: boolean; mensagem?: string; erro?: string; error?: string; link?: string
  fontes?: { tarefa: { statusTarefa: string }; passo: { statusPasso: string; stepKey: string } | null; central: { esperado: string | null } }
  itens?: Array<{ tarefaId: number; ok: boolean }>
  tarefaId?: number
  podeForcar?: boolean
  pendencias?: Pendencia[]
}
type Pedido =
  | { tipo: "pessoa"; item: ItemPrecisa; resolver: (r: string | null) => void }
  | { tipo: "justificativa"; item: ItemPrecisa; acao: "ENCERRAR_NAO_DEVIDA" | "IGNORAR_7_DIAS" | "ENCERRAR_FASE_NAO_DEVIDA"; resolver: (r: string | null) => void }
  | { tipo: "forcar"; item: ItemPrecisa; pendencias: Pendencia[]; resolver: (r: string | null) => void }
  | { tipo: "ligacao"; item: ItemPrecisa; resolver: (r: string | null) => void }
  | { tipo: "canal"; item: ItemPrecisa; resolver: (r: string | null) => void }
  | { tipo: "fontes"; fontes: NonNullable<RespAcao["fontes"]>; resolver: (r: string | null) => void }

/** O que o "Desfazer" do toast desfaz — cada tipo é uma reversão que o servidor sabe fazer (e recusa se algo mudou depois). */
type DesfazerPdv = { tipo: "ATRIBUICAO"; tarefaIds: number[] } | { tipo: "DESBLOQUEIO"; tarefaId: number } | { tipo: "CANAL"; tarefaId: number }
interface ToastPdv { msg: string; detalhe?: string; desfazer: DesfazerPdv | null }

/** Resultado de uma execução: o resumo curto da decisão (para a Revisão) ou `null` se cancelou/falhou. */
export type ResultadoAcao = string | null

const idsFeitos = (d: RespAcao): number[] => (d.itens ? d.itens.filter((i) => i.ok).map((i) => i.tarefaId) : d.tarefaId != null ? [d.tarefaId] : [])

export function useAcoesDoItem({ irParaAba, onFeito }: { irParaAba: (aba: "equipe") => void; onFeito?: (item: ItemPrecisa) => void }) {
  const { recarregar } = useTorre()
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [toast, setToast] = useState<ToastPdv | null>(null)

  // O toast dura 6 s (Decisão 6 do Passo 0) — o mesmo tempo dos demais avisos da Torre.
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(t)
  }, [toast])

  const perguntar = useCallback((p: (resolver: (r: string | null) => void) => Pedido) => new Promise<string | null>((resolve) => {
    setPedido(p((r) => { setPedido(null); resolve(r) }))
  }), [])

  const { postar, modal: modalConfirmacao } = useConfirmarAtribuicao()
  const chamar = useCallback(async (corpo: Record<string, unknown>): Promise<{ ok: boolean; d: RespAcao }> => {
    const r = await postar<RespAcao>("/api/torre/precisa-de-voce/acao", corpo)
    return { ok: r.ok && r.data.ok !== false, d: r.data }
  }, [postar])

  /** O que identifica o item na porta: o PROCESSO (Sem responsável, Fase deixada) e/ou a tarefa. */
  const alvo = (item: ItemPrecisa) => ({ processoId: item.processoId ?? undefined, tarefaId: item.tarefaId ?? undefined })

  const concluir = useCallback((item: ItemPrecisa, botao: string, ok: boolean, d: RespAcao, desfazer: DesfazerPdv | null = null): ResultadoAcao => {
    if (!ok) { setToast({ msg: erroDe(d), desfazer: null }); return null }
    setToast({ msg: `${botao} · ${nome1(item.titulo)}`, detalhe: d.mensagem, desfazer })
    onFeito?.(item)
    recarregar()
    return d.mensagem ?? botao
  }, [recarregar, onFeito])

  const desfazerAgora = useCallback(async () => {
    const d = toast?.desfazer
    if (!d) return
    setToast(null)
    const r = await api<{ total?: number; desfeitas?: number; itens?: Array<{ ok: boolean; mensagem: string }>; ok?: boolean; mensagem?: string }>("/api/torre/precisa-de-voce/desfazer", "POST", d)
    if (typeof r.data.desfeitas === "number") {
      const falha = r.data.itens?.find((i) => !i.ok)
      setToast({ msg: `Desfeito: ${r.data.desfeitas} de ${r.data.total}.${falha ? ` ${falha.mensagem}` : ""}`, desfazer: null })
    } else setToast({ msg: r.ok && r.data.ok !== false ? r.data.mensagem ?? "Desfeito." : erroDe(r.data), desfazer: null })
    recarregar()
  }, [toast, recarregar])

  /** `qual` 1 = ação primária, 2 = a segunda. Devolve o resumo da decisão, ou `null` (cancelou/falhou). */
  const executar = useCallback(async (item: ItemPrecisa, qual: 1 | 2): Promise<ResultadoAcao> => {
    const a = qual === 1 ? item.acao1 : item.acao2
    const tarefaId = item.tarefaId ?? undefined
    switch (a.acao) {
      case "ATRIBUIR_SUGERIDO": {
        const { ok, d } = await chamar({ acao: a.acao, ...alvo(item) })
        const feitas = idsFeitos(d)
        return concluir(item, a.rotulo, ok, d, ok && feitas.length ? { tipo: "ATRIBUICAO", tarefaIds: feitas } : null)
      }
      case "ATRIBUIR_ESCOLHIDO": return perguntar((resolver) => ({ tipo: "pessoa", item, resolver }))
      case "ENCERRAR_NAO_DEVIDA":
      case "IGNORAR_7_DIAS":
      case "ENCERRAR_FASE_NAO_DEVIDA":
        return perguntar((resolver) => ({ tipo: "justificativa", item, acao: a.acao as "ENCERRAR_NAO_DEVIDA" | "IGNORAR_7_DIAS" | "ENCERRAR_FASE_NAO_DEVIDA", resolver }))
      case "AVANCAR_FASE": {
        // A porta canônica do avanço (gate). Se o gate recusa, mostra as pendências e oferece o avanço FORÇADO — com justificativa.
        const { ok, d } = await chamar({ acao: a.acao, processoId: item.processoId })
        if (ok) return concluir(item, a.rotulo, true, d)
        if (d.podeForcar) return perguntar((resolver) => ({ tipo: "forcar", item, pendencias: d.pendencias ?? [], resolver }))
        return concluir(item, a.rotulo, false, d)
      }
      case "RECONCILIAR": { const { ok, d } = await chamar({ acao: a.acao, tarefaId }); return concluir(item, a.rotulo, ok, d) }
      case "VER_3_FONTES": {
        const { ok, d } = await chamar({ acao: a.acao, tarefaId })
        if (!ok || !d.fontes) { setToast({ msg: erroDe(d), desfazer: null }); return null }
        await perguntar((resolver) => ({ tipo: "fontes", fontes: d.fontes!, resolver }))
        return "viu as 3 fontes"
      }
      case "REGISTRAR_LIGACAO": return perguntar((resolver) => ({ tipo: "ligacao", item, resolver }))
      case "TROCAR_CANAL": return perguntar((resolver) => ({ tipo: "canal", item, resolver }))
      case "COBRAR_CLIENTE": { const { ok, d } = await chamar({ acao: a.acao, tarefaId }); return concluir(item, a.rotulo, ok, d) }
      case "DESBLOQUEAR": {
        const { ok, d } = await chamar({ acao: a.acao, tarefaId })
        return concluir(item, a.rotulo, ok, d, ok && tarefaId != null ? { tipo: "DESBLOQUEIO", tarefaId } : null)
      }
      case "REDISTRIBUIR_CARGA": {
        const { ok, d } = await chamar({ acao: a.acao, usuarioId: item.contexto.usuarioId })
        const movidas = idsFeitos(d)
        return concluir(item, a.rotulo, ok, d, ok && movidas.length ? { tipo: "ATRIBUICAO", tarefaIds: movidas } : null)
      }
      case "VER_EQUIPE": irParaAba("equipe"); return "foi para a Equipe"
      case "ABRIR_GERENCIAMENTO": {
        const { ok, d } = await chamar({ acao: a.acao, achadoId: item.contexto.achadoId })
        if (!ok) { setToast({ msg: erroDe(d), desfazer: null }); return null }
        window.open(d.link ?? item.link, "_blank", "noopener")
        return "abriu o Gerenciamento"
      }
      default: setToast({ msg: `Ação desconhecida: ${a.acao}`, desfazer: null }); return null
    }
  }, [chamar, concluir, perguntar, irParaAba])

  const modais: ReactNode = (
    <>
      {pedido && (
        pedido.tipo === "fontes" ? (
          <Modal titulo="As 3 fontes do mesmo trabalho" onFechar={() => pedido.resolver(null)} rodape={<button className="tor-btn" onClick={() => pedido.resolver(null)}>Fechar</button>}>
            <ul className="space-y-1 text-[13px]">
              <li><b>Tarefa:</b> {pedido.fontes.tarefa.statusTarefa}</li>
              <li><b>Passo:</b> {pedido.fontes.passo ? `${pedido.fontes.passo.statusPasso} (${pedido.fontes.passo.stepKey})` : "sem passo vinculado"}</li>
              <li><b>Central (esperado):</b> {pedido.fontes.central.esperado ?? "—"}</li>
            </ul>
          </Modal>
        ) : pedido.tipo === "justificativa" ? (
          <PdvTexto
            titulo={pedido.acao === "IGNORAR_7_DIAS" ? "Ignorar 7 dias" : "Encerrar (não devida)"}
            subtitulo={pedido.item.titulo} rotulo="Justificativa"
            confirmar={pedido.acao === "IGNORAR_7_DIAS" ? "Ignorar por 7 dias" : "Encerrar"}
            onFechar={() => pedido.resolver(null)}
            onEnviar={async (justificativa) => {
              const base = pedido.acao === "ENCERRAR_NAO_DEVIDA" ? { tarefaId: pedido.item.tarefaId }
                : pedido.acao === "ENCERRAR_FASE_NAO_DEVIDA" ? { processoId: pedido.item.processoId }
                : { achadoId: pedido.item.contexto.achadoId }
              const { ok, d } = await chamar({ acao: pedido.acao, ...base, justificativa })
              if (!ok) return { ok: false, mensagem: erroDe(d) }
              pedido.resolver(concluir(pedido.item, pedido.item.acao2.rotulo, true, d))
              return { ok: true }
            }}
          />
        ) : pedido.tipo === "forcar" ? <ModalForcar pedido={pedido} chamar={chamar} concluir={concluir} />
          : pedido.tipo === "pessoa" ? <ModalPessoa pedido={pedido} chamar={chamar} concluir={concluir} alvo={alvo} />
          : pedido.tipo === "ligacao" ? <ModalLigacao pedido={pedido} chamar={chamar} concluir={concluir} />
          : <ModalCanal pedido={pedido} chamar={chamar} concluir={concluir} />
      )}
      {modalConfirmacao}
      {toast && (
        <div className="tor-toast" role="status">
          <span>{toast.msg}{toast.detalhe && toast.detalhe !== toast.msg ? <><br /><span className="pdv-toast-det">{toast.detalhe}</span></> : null}</span>
          {toast.desfazer && <button className="tor-btn" onClick={() => void desfazerAgora()}>Desfazer</button>}
          <button className="tor-btn" aria-label="Fechar aviso" onClick={() => setToast(null)}>✕</button>
        </div>
      )}
    </>
  )
  /** Fecha o aviso aberto (o "Pular" da Revisão não deixa toast nenhum). */
  const limparToast = useCallback(() => setToast(null), [])
  return { executar, modais, limparToast }
}

type Chamar = (c: Record<string, unknown>) => Promise<{ ok: boolean; d: RespAcao }>
type Concluir = (item: ItemPrecisa, botao: string, ok: boolean, d: RespAcao, df?: DesfazerPdv | null) => ResultadoAcao
const Erro = ({ t }: { t: string | null }) => (t ? <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{t}</div> : null)

function ModalForcar({ pedido, chamar, concluir }: { pedido: Extract<Pedido, { tipo: "forcar" }>; chamar: Chamar; concluir: Concluir }) {
  const [texto, setTexto] = useState("")
  const [env, setEnv] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnv(true); setErro(null)
    const { ok, d } = await chamar({ acao: "AVANCAR_FASE_FORCADO", processoId: pedido.item.processoId, justificativa: texto.trim() })
    setEnv(false)
    if (!ok) { setErro(erroDe(d)); return }
    pedido.resolver(concluir(pedido.item, "Avançar fase", true, d))
  }
  return (
    <Modal titulo="O avanço está bloqueado" subtitulo={pedido.item.titulo} ocupado={env} justificativa onFechar={() => pedido.resolver(null)} rodape={<>
      <button className="tor-btn" onClick={() => pedido.resolver(null)} disabled={env}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={env || texto.trim().length < 5}>{env ? "Avançando…" : "Avançar mesmo assim"}</button>
    </>}>
      <div className="text-[13px]">A fase ainda tem pendências obrigatórias:</div>
      {pedido.pendencias.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5 text-[13px]">{pedido.pendencias.map((p, i) => <li key={`${p.code}-${i}`}>{p.message}</li>)}</ul>
      )}
      <div className="small">Avançar assim fica no histórico do processo como avanço forçado, com a sua justificativa.</div>
      <Campo rotulo="Justificativa (obrigatório, mínimo de 5 letras)">
        <textarea className="tor-in w-full" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </Campo>
      <Erro t={erro} />
    </Modal>
  )
}

function ModalPessoa({ pedido, chamar, concluir, alvo }: { pedido: Extract<Pedido, { tipo: "pessoa" }>; chamar: Chamar; concluir: Concluir; alvo: (i: ItemPrecisa) => Record<string, unknown> }) {
  const [pessoas, setPessoas] = useState<Array<{ id: number; nome: string }> | null>(null)
  const [sel, setSel] = useState("")
  const [env, setEnv] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => { void api<{ funcionarios: Array<{ id: number; nome: string }> }>("/api/operacao/atribuiveis").then((r) => setPessoas(r.ok ? r.data.funcionarios ?? [] : [])) }, [])
  const enviar = async () => {
    setEnv(true); setErro(null)
    const { ok, d } = await chamar({ acao: "ATRIBUIR_ESCOLHIDO", ...alvo(pedido.item), responsavelId: Number(sel) })
    setEnv(false)
    if (!ok) { setErro(erroDe(d)); return }
    const feitas = idsFeitos(d)
    pedido.resolver(concluir(pedido.item, `Atribuir a ${pessoas?.find((p) => String(p.id) === sel)?.nome ?? "outro"}`, true, d, feitas.length ? { tipo: "ATRIBUICAO", tarefaIds: feitas } : null))
  }
  return (
    <Modal titulo="Escolher outro responsável" subtitulo={pedido.item.titulo} ocupado={env} onFechar={() => pedido.resolver(null)} rodape={<>
      <button className="tor-btn" onClick={() => pedido.resolver(null)} disabled={env}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={env || !sel}>{env ? "Atribuindo…" : "Atribuir"}</button>
    </>}>
      <Campo rotulo="Pessoa">
        <select className="tor-in w-full" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">{pessoas == null ? "Carregando…" : "Escolha…"}</option>
          {(pessoas ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </Campo>
      <Erro t={erro} />
    </Modal>
  )
}

function ModalLigacao({ pedido, chamar, concluir }: { pedido: Extract<Pedido, { tipo: "ligacao" }>; chamar: Chamar; concluir: Concluir }) {
  const [resultado, setResultado] = useState("SEM_RESPOSTA")
  const [observacao, setObservacao] = useState("")
  const [env, setEnv] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnv(true); setErro(null)
    const { ok, d } = await chamar({ acao: "REGISTRAR_LIGACAO", tarefaId: pedido.item.tarefaId, resultado, observacao: observacao.trim() || undefined })
    setEnv(false)
    if (!ok) { setErro(erroDe(d)); return }
    pedido.resolver(concluir(pedido.item, "Registrar ligação", true, d))
  }
  return (
    <Modal titulo="Registrar ligação" subtitulo={pedido.item.titulo} ocupado={env} onFechar={() => pedido.resolver(null)} rodape={<>
      <button className="tor-btn" onClick={() => pedido.resolver(null)} disabled={env}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={env}>{env ? "Registrando…" : "Registrar ligação"}</button>
    </>}>
      <Campo rotulo="Resultado"><select className="tor-in w-full" value={resultado} onChange={(e) => setResultado(e.target.value)}>{RESULTADOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
      <Campo rotulo="Observação (opcional)"><textarea className="tor-in w-full" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} /></Campo>
      <Erro t={erro} />
    </Modal>
  )
}

function ModalCanal({ pedido, chamar, concluir }: { pedido: Extract<Pedido, { tipo: "canal" }>; chamar: Chamar; concluir: Concluir }) {
  const [canal, setCanal] = useState("EMAIL")
  const [env, setEnv] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnv(true); setErro(null)
    const { ok, d } = await chamar({ acao: "TROCAR_CANAL", tarefaId: pedido.item.tarefaId, canal })
    setEnv(false)
    if (!ok) { setErro(erroDe(d)); return }
    pedido.resolver(concluir(pedido.item, "Trocar canal", true, d, pedido.item.tarefaId != null ? { tipo: "CANAL", tarefaId: pedido.item.tarefaId } : null))
  }
  return (
    <Modal titulo="Trocar canal" subtitulo={pedido.item.titulo} ocupado={env} onFechar={() => pedido.resolver(null)} rodape={<>
      <button className="tor-btn" onClick={() => pedido.resolver(null)} disabled={env}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={env}>{env ? "Trocando…" : "Trocar canal"}</button>
    </>}>
      <Campo rotulo="Novo canal"><select className="tor-in w-full" value={canal} onChange={(e) => setCanal(e.target.value)}>{CANAIS_SOLICITACAO.map((c) => <option key={c.canal} value={c.canal}>{c.label}</option>)}</select></Campo>
      <Erro t={erro} />
    </Modal>
  )
}

/** Um campo de justificativa obrigatória (mínimo de 5 letras) + confirmar. */
function PdvTexto({ titulo, subtitulo, rotulo, confirmar, onFechar, onEnviar }: {
  titulo: string; subtitulo?: string; rotulo: string; confirmar: string
  onFechar: () => void; onEnviar: (texto: string) => Promise<{ ok: boolean; mensagem?: string }>
}) {
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await onEnviar(texto.trim())
    setEnviando(false)
    if (!r.ok) setErro(r.mensagem ?? "Não foi possível concluir.")
  }
  return (
    <Modal titulo={titulo} subtitulo={subtitulo} onFechar={onFechar} ocupado={enviando} justificativa rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando || texto.trim().length < 5}>{enviando ? "Enviando…" : confirmar}</button>
    </>}>
      <Campo rotulo={`${rotulo} (obrigatório, mínimo de 5 letras)`}>
        <textarea className="tor-in w-full" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </Campo>
      <Erro t={erro} />
    </Modal>
  )
}
