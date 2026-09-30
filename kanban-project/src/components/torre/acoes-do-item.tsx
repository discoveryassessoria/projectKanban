"use client"
// src/components/torre/acoes-do-item.tsx — EXECUTA a ação de um item do "Precisa de você" (Bloco J4).
// Usado pela tabela E pela Revisão do dia: UM só lugar mapeia `acao` → porta. Cada ação já é real e auditada no servidor
// (POST /api/torre/precisa-de-voce/acao); aqui só se coleta o que a porta pede (pessoa, justificativa, canal…) e se mostra o resultado.
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { api, erroDe, Campo, Modal, ModalTexto, useTorre, type Desfazer } from "./torre-base"
import type { ItemPrecisa } from "./tipos-precisa"

const CANAIS = ["CRC", "ECARTORIO", "EMAIL", "WHATSAPP", "BALCAO", "COMUNE", "CORREIOS", "CONSULADO"]
const RESULTADOS = [
  ["SEM_RESPOSTA", "Sem resposta"], ["CONFIRMOU_PEDIDO", "Confirmou o pedido"], ["PEDIU_DOCUMENTO", "Pediu documento"],
  ["EM_BUSCA", "Em busca"], ["NAO_LOCALIZOU", "Não localizou"], ["ENVIOU", "Enviou (ainda não recebido)"],
]

interface RespAcao {
  ok?: boolean; mensagem?: string; erro?: string; error?: string; link?: string
  fontes?: { tarefa: { statusTarefa: string }; passo: { statusPasso: string; stepKey: string } | null; central: { esperado: string | null } }
  itens?: Array<{ tarefaId: number; ok: boolean }>
}
type Pedido =
  | { tipo: "pessoa"; item: ItemPrecisa; resolver: (r: string | null) => void }
  | { tipo: "justificativa"; item: ItemPrecisa; acao: "ENCERRAR_NAO_DEVIDA" | "IGNORAR_7_DIAS"; resolver: (r: string | null) => void }
  | { tipo: "ligacao"; item: ItemPrecisa; resolver: (r: string | null) => void }
  | { tipo: "canal"; item: ItemPrecisa; resolver: (r: string | null) => void }
  | { tipo: "fontes"; fontes: NonNullable<RespAcao["fontes"]>; resolver: (r: string | null) => void }

/** Resultado de uma execução: o resumo curto da decisão (para a Revisão) ou `null` se cancelou/falhou. */
export type ResultadoAcao = string | null

export function useAcoesDoItem({ irParaAba }: { irParaAba: (aba: "equipe") => void }) {
  const { avisar, recarregar } = useTorre()
  const [pedido, setPedido] = useState<Pedido | null>(null)

  const perguntar = useCallback((p: (resolver: (r: string | null) => void) => Pedido) => new Promise<string | null>((resolve) => {
    setPedido(p((r) => { setPedido(null); resolve(r) }))
  }), [])

  const chamar = useCallback(async (corpo: Record<string, unknown>): Promise<{ ok: boolean; d: RespAcao }> => {
    const r = await api<RespAcao>("/api/torre/precisa-de-voce/acao", "POST", corpo)
    return { ok: r.ok && r.data.ok !== false, d: r.data }
  }, [])

  const concluir = useCallback((ok: boolean, d: RespAcao, resumoOk: string, desfazer: Desfazer | null = null): ResultadoAcao => {
    if (!ok) { avisar(erroDe(d)); return null }
    avisar(d.mensagem ?? resumoOk, desfazer); recarregar()
    return d.mensagem ?? resumoOk
  }, [avisar, recarregar])

  /** `qual` 1 = ação primária, 2 = a segunda. Devolve o resumo da decisão, ou `null` (cancelou/falhou). */
  const executar = useCallback(async (item: ItemPrecisa, qual: 1 | 2): Promise<ResultadoAcao> => {
    const a = qual === 1 ? item.acao1 : item.acao2
    const tarefaId = item.tarefaId ?? undefined
    switch (a.acao) {
      case "ATRIBUIR_SUGERIDO": {
        const { ok, d } = await chamar({ acao: a.acao, tarefaId })
        return concluir(ok, d, "Atribuída.", ok && tarefaId != null ? { tipo: "ATRIBUICAO", tarefaIds: [tarefaId] } : null)
      }
      case "ATRIBUIR_ESCOLHIDO": {
        const r = await perguntar((resolver) => ({ tipo: "pessoa", item, resolver }))
        return r
      }
      case "ENCERRAR_NAO_DEVIDA":
      case "IGNORAR_7_DIAS":
        return perguntar((resolver) => ({ tipo: "justificativa", item, acao: a.acao as "ENCERRAR_NAO_DEVIDA" | "IGNORAR_7_DIAS", resolver }))
      case "RECONCILIAR": { const { ok, d } = await chamar({ acao: a.acao, tarefaId }); return concluir(ok, d, "Reconciliada.") }
      case "VER_3_FONTES": {
        const { ok, d } = await chamar({ acao: a.acao, tarefaId })
        if (!ok || !d.fontes) { avisar(erroDe(d)); return null }
        await perguntar((resolver) => ({ tipo: "fontes", fontes: d.fontes!, resolver }))
        return "viu as 3 fontes"
      }
      case "REGISTRAR_LIGACAO": return perguntar((resolver) => ({ tipo: "ligacao", item, resolver }))
      case "TROCAR_CANAL": return perguntar((resolver) => ({ tipo: "canal", item, resolver }))
      case "COBRAR_CLIENTE": { const { ok, d } = await chamar({ acao: a.acao, tarefaId }); return concluir(ok, d, "Cobrança enviada.") }
      case "DESBLOQUEAR": { const { ok, d } = await chamar({ acao: a.acao, tarefaId }); return concluir(ok, d, "Desbloqueada.") }
      case "REDISTRIBUIR_CARGA": {
        const { ok, d } = await chamar({ acao: a.acao, usuarioId: item.contexto.usuarioId })
        const movidas = (d.itens ?? []).filter((i) => i.ok).map((i) => i.tarefaId)
        return concluir(ok, d, "Carga redistribuída.", ok && movidas.length ? { tipo: "ATRIBUICAO", tarefaIds: movidas } : null)
      }
      case "VER_EQUIPE": irParaAba("equipe"); return "foi para a Equipe"
      case "ABRIR_GERENCIAMENTO": {
        const { ok, d } = await chamar({ acao: a.acao, achadoId: item.contexto.achadoId })
        if (!ok) { avisar(erroDe(d)); return null }
        window.open(d.link ?? item.link, "_blank", "noopener")
        return "abriu o Gerenciamento"
      }
      default: avisar(`Ação desconhecida: ${a.acao}`); return null
    }
  }, [chamar, concluir, perguntar, avisar, irParaAba])

  const modais: ReactNode = pedido && (
    pedido.tipo === "fontes" ? (
      <Modal titulo="As 3 fontes do mesmo trabalho" onFechar={() => pedido.resolver(null)} rodape={<button className="tor-btn" onClick={() => pedido.resolver(null)}>Fechar</button>}>
        <ul className="space-y-1 text-[13px]">
          <li><b>Tarefa:</b> {pedido.fontes.tarefa.statusTarefa}</li>
          <li><b>Passo:</b> {pedido.fontes.passo ? `${pedido.fontes.passo.statusPasso} (${pedido.fontes.passo.stepKey})` : "sem passo vinculado"}</li>
          <li><b>Central (esperado):</b> {pedido.fontes.central.esperado ?? "—"}</li>
        </ul>
      </Modal>
    ) : pedido.tipo === "justificativa" ? (
      <ModalTexto
        titulo={pedido.acao === "ENCERRAR_NAO_DEVIDA" ? "Encerrar (não devida)" : "Ignorar 7 dias"}
        subtitulo={pedido.item.titulo} rotulo="Justificativa" confirmar={pedido.acao === "ENCERRAR_NAO_DEVIDA" ? "Encerrar" : "Ignorar 7 d"}
        onFechar={() => pedido.resolver(null)}
        onEnviar={async (justificativa) => {
          const corpo = pedido.acao === "ENCERRAR_NAO_DEVIDA" ? { acao: pedido.acao, tarefaId: pedido.item.tarefaId, justificativa } : { acao: pedido.acao, achadoId: pedido.item.contexto.achadoId, justificativa }
          const { ok, d } = await chamar(corpo)
          if (!ok) return { ok: false, mensagem: erroDe(d) }
          const msg = concluir(true, d, pedido.acao === "ENCERRAR_NAO_DEVIDA" ? "Encerrada como não devida." : "Ignorado por 7 dias.")
          pedido.resolver(msg)
          return { ok: true }
        }}
      />
    ) : pedido.tipo === "pessoa" ? <ModalPessoa pedido={pedido} chamar={chamar} concluir={concluir} />
      : pedido.tipo === "ligacao" ? <ModalLigacao pedido={pedido} chamar={chamar} concluir={concluir} />
      : <ModalCanal pedido={pedido} chamar={chamar} concluir={concluir} />
  )
  return { executar, modais }
}

type Chamar = (c: Record<string, unknown>) => Promise<{ ok: boolean; d: RespAcao }>
type Concluir = (ok: boolean, d: RespAcao, r: string, df?: Desfazer | null) => ResultadoAcao
const Erro = ({ t }: { t: string | null }) => (t ? <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{t}</div> : null)

function ModalPessoa({ pedido, chamar, concluir }: { pedido: Extract<Pedido, { tipo: "pessoa" }>; chamar: Chamar; concluir: Concluir }) {
  const [pessoas, setPessoas] = useState<Array<{ id: number; nome: string }> | null>(null)
  const [sel, setSel] = useState("")
  const [env, setEnv] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => { void api<{ funcionarios: Array<{ id: number; nome: string }> }>("/api/operacao/atribuiveis").then((r) => setPessoas(r.ok ? r.data.funcionarios ?? [] : [])) }, [])
  const enviar = async () => {
    setEnv(true); setErro(null)
    const { ok, d } = await chamar({ acao: "ATRIBUIR_ESCOLHIDO", tarefaId: pedido.item.tarefaId, responsavelId: Number(sel) })
    setEnv(false)
    if (!ok) { setErro(erroDe(d)); return }
    pedido.resolver(concluir(true, d, "Atribuída.", pedido.item.tarefaId != null ? { tipo: "ATRIBUICAO", tarefaIds: [pedido.item.tarefaId] } : null))
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
    pedido.resolver(concluir(true, d, "Ligação registrada."))
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
    pedido.resolver(concluir(true, d, `Canal trocado para ${canal}.`))
  }
  return (
    <Modal titulo="Trocar canal" subtitulo={pedido.item.titulo} ocupado={env} onFechar={() => pedido.resolver(null)} rodape={<>
      <button className="tor-btn" onClick={() => pedido.resolver(null)} disabled={env}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={env}>{env ? "Trocando…" : "Trocar canal"}</button>
    </>}>
      <Campo rotulo="Novo canal"><select className="tor-in w-full" value={canal} onChange={(e) => setCanal(e.target.value)}>{CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Campo>
      <Erro t={erro} />
    </Modal>
  )
}
