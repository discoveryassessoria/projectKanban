"use client"
// src/components/torre/TerceirosModais.tsx — os três modais da aba TERCEIROS (frente G): "Cobrar · <órgão>" (um pedido),
// "Cobrar todos os vencidos" (lote) e "Contatos · <certidão> · <pessoa>" (histórico do pedido). Textos do protótipo.
// Cobrar GRAVA pela porta única (`registrarCobranca` → `ContatoTerceiro`) e agenda a próxima ("Próxima cobrança em (dias)").
import { useEffect, useState, type ReactNode } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { CANAIS_DE_CONTATO_UI, CANAL_CADASTRADO } from "@/src/components/operacao/RegistrarContatoModal"
import { DIAS_PADRAO_DA_COBRANCA } from "@/lib/operacional/torre-bola"
import type { PedidoDeTerceiro } from "@/lib/operacional/terceiros-pedidos"
import { ddmmHora } from "@/lib/operacional/terceiros-pedidos"
import { api, erroDe, useEscFecha } from "./torre-base"
import "./terceiros.css"

/** O teto da "Próxima cobrança em (dias)" — o mesmo do servidor (`MAX_PROXIMA_COBRANCA_DIAS`). */
const MAX_DIAS = 60

function CascaDoModal({ titulo, onFechar, ocupado, children }: { titulo: string; onFechar: () => void; ocupado?: boolean; children: ReactNode }) {
  useEscFecha(onFechar, !ocupado)
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--overlay-modal)] px-4" style={{ zIndex: LAYER.popover }} onClick={ocupado ? undefined : onFechar}>
      <div role="dialog" aria-label={titulo} className="tor ter-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="ter-modal-titulo">{titulo}</h3>
        {children}
      </div>
    </div>
  )
}

export interface DadosDaCobranca { canal: string | undefined; proximaEmDias: number }

/** O campo "Próxima cobrança em (dias)" e o seletor de canal — iguais nos dois modais de cobrança. */
function useFormularioDeCobranca() {
  const [canal, setCanal] = useState(CANAL_CADASTRADO)
  const [dias, setDias] = useState(String(DIAS_PADRAO_DA_COBRANCA))
  const n = Number(dias)
  const valido = dias.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_DIAS
  const dados = (): DadosDaCobranca => ({ canal: canal === CANAL_CADASTRADO ? undefined : canal, proximaEmDias: n })
  return { canal, setCanal, dias, setDias, valido, dados }
}

function Campos({ f, comCanal }: { f: ReturnType<typeof useFormularioDeCobranca>; comCanal: boolean }) {
  return (
    <>
      {comCanal && (
        <label className="ter-campo">Canal usado
          <select className="tor-in" value={f.canal} onChange={(e) => f.setCanal(e.target.value)}>
            <option value={CANAL_CADASTRADO}>Canal cadastrado do cartório</option>
            {CANAIS_DE_CONTATO_UI.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </label>
      )}
      <label className="ter-campo">Próxima cobrança em (dias)
        <input className="tor-in" type="number" inputMode="numeric" min={1} max={MAX_DIAS} step={1} value={f.dias} onChange={(e) => f.setDias(e.target.value)} />
      </label>
    </>
  )
}

/** "Cobrar · <órgão>" — um pedido. */
export function CobrarPedidoModal({ pedido, onFechar, onEnviar }: {
  pedido: PedidoDeTerceiro; onFechar: () => void; onEnviar: (d: DadosDaCobranca) => Promise<{ ok: boolean; mensagem?: string }>
}) {
  const f = useFormularioDeCobranca()
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await onEnviar(f.dados())
    setEnviando(false)
    if (!r.ok) setErro(r.mensagem ?? "Não foi possível registrar a cobrança.")
  }
  return (
    <CascaDoModal titulo={`Registrar cobrança · ${pedido.orgao ?? "pedido sem órgão vinculado"}`} onFechar={onFechar} ocupado={enviando}>
      <p className="ter-modal-texto">{pedido.certidao} · {pedido.pessoa} · {pedido.familia}. Registra a cobrança no histórico da certidão e marca a próxima. O sistema não envia a mensagem: o canal abaixo é o que você usou.</p>
      <Campos f={f} comCanal />
      {erro && <div className="ter-erro" role="alert">{erro}</div>}
      <div className="ter-rodape">
        <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
        <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando || !f.valido}>{enviando ? "Registrando…" : "Registrar cobrança"}</button>
      </div>
    </CascaDoModal>
  )
}

/** "Cobrar todos os vencidos" — o lote. `cartorios` = órgãos distintos entre os pedidos. */
export function CobrarTodosModal({ n, cartorios, onFechar, onEnviar }: {
  n: number; cartorios: number; onFechar: () => void; onEnviar: (d: DadosDaCobranca) => Promise<{ ok: boolean; mensagem?: string }>
}) {
  const f = useFormularioDeCobranca()
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await onEnviar(f.dados())
    setEnviando(false)
    if (!r.ok) setErro(r.mensagem ?? "Não foi possível registrar as cobranças.")
  }
  return (
    <CascaDoModal titulo="Cobrar todos os vencidos" onFechar={onFechar} ocupado={enviando}>
      <p className="ter-modal-texto">
        {n} {n === 1 ? "pedido com data" : "pedidos com data"} de cobrança vencida ou de hoje, em {cartorios} {cartorios === 1 ? "cartório" : "cartórios"}.
        Registra uma cobrança em cada certidão, pelo canal cadastrado dela. O sistema não envia a mensagem.
      </p>
      <Campos f={f} comCanal={false} />
      {erro && <div className="ter-erro" role="alert">{erro}</div>}
      <div className="ter-rodape">
        <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
        <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando || !f.valido}>{enviando ? "Registrando…" : `Registrar ${n} ${n === 1 ? "cobrança" : "cobranças"}`}</button>
      </div>
    </CascaDoModal>
  )
}

interface ContatoDoPedido { id: string; tipo: "PEDIDO" | "CONTATO" | "CANAL_ALTERADO"; quando: string; texto: string; estornado?: boolean }

/** "Contatos · <certidão> · <pessoa>" — o histórico do pedido (cobranças, ligações, trocas de canal e o envio do pedido). */
export function ContatosDoPedidoModal({ pedido, onFechar }: { pedido: PedidoDeTerceiro; onFechar: () => void }) {
  const [lista, setLista] = useState<ContatoDoPedido[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void api<{ contatos: ContatoDoPedido[] }>(`/api/torre/terceiros/pedidos/${pedido.taskId}/contatos`).then((r) => {
      if (!vivo) return
      if (r.ok) setLista(r.data.contatos); else setErro(erroDe(r.data, "Não foi possível carregar os contatos."))
    })
    return () => { vivo = false }
  }, [pedido.taskId])
  return (
    <CascaDoModal titulo={`Contatos · ${pedido.certidao} · ${pedido.pessoa}`} onFechar={onFechar}>
      <p className="ter-modal-texto">{pedido.orgao ? `Pedido a ${pedido.orgao}` : "Pedido sem órgão vinculado"} · {pedido.cobrancas} até agora</p>
      {erro && <div className="ter-erro" role="alert">{erro}</div>}
      {!erro && lista == null && <div className="small">Carregando…</div>}
      {lista?.length === 0 && <div className="small">Nenhum contato registrado para este pedido ainda.</div>}
      {lista && lista.length > 0 && (
        <ul className="ter-contatos">
          {lista.map((c) => <li key={c.id}><span className="quando">{ddmmHora(c.quando)}</span><span style={c.estornado ? { textDecoration: "line-through", opacity: 0.7 } : undefined}>{c.texto}{c.estornado ? " · desfeita" : ""}</span></li>)}
        </ul>
      )}
      <div className="ter-rodape"><button className="tor-btn" onClick={onFechar}>Fechar</button></div>
    </CascaDoModal>
  )
}

