"use client"
// src/components/torre/EquipeModais.tsx — os dois modais da aba Equipe: "Marcar ausência" e "Mover carteira" (textos e campos do protótipo).
// O modal NÃO decide nada: chama as portas existentes (capacidade / mover-carteira) e devolve o resultado real.
import { useState, type ReactNode } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { api, erroDe, type Desfazer } from "./torre-base"
import { TIPOS_DE_AUSENCIA, TEXTO_MARCAR_AUSENCIA } from "./equipe-visual"
import type { PessoaDaEquipe } from "./equipe-tipos"
import "./equipe.css"

function ModalDaEquipe({ titulo, texto, ocupado, onFechar, children, cancelar, confirmar }: {
  titulo: string; texto: string; ocupado: boolean; onFechar: () => void; children: ReactNode
  cancelar: string; confirmar: { rotulo: string; ocupado: string; onClick: () => void }
}) {
  return (
    <div className="eqp-fundo" style={{ zIndex: LAYER.popover }} onClick={ocupado ? undefined : onFechar}>
      <div role="dialog" aria-label={titulo} className="eqp-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{titulo}</h3>
        <div className="eqp-modal-txt">{texto}</div>
        {children}
        <div className="eqp-modal-bts">
          <button className="eqp-btn" onClick={onFechar} disabled={ocupado}>{cancelar}</button>
          <button className="eqp-btn pri" onClick={confirmar.onClick} disabled={ocupado}>{ocupado ? confirmar.ocupado : confirmar.rotulo}</button>
        </div>
      </div>
    </div>
  )
}

/** MARCAR AUSÊNCIA — só registra (a porta de capacidade grava e audita; o sucessor é só sugestão). */
export function AusenciaModal({ pessoa, onFechar, onFeito }: { pessoa: PessoaDaEquipe; onFechar: () => void; onFeito: () => void }) {
  const [tipo, setTipo] = useState("FERIAS")
  const [de, setDe] = useState("")
  const [ate, setAte] = useState("")
  const [motivo, setMotivo] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await api("/api/operacao/capacidade", "PATCH", {
      acao: "indisponibilizar", usuarioId: pessoa.usuarioId, tipo,
      ...(de ? { inicio: `${de}T00:00:00-03:00` } : {}), ...(ate ? { fim: `${ate}T23:59:59-03:00` } : {}), motivo: motivo.trim() || undefined,
    })
    setEnviando(false)
    if (r.ok) onFeito(); else setErro(erroDe(r.data))
  }
  return (
    <ModalDaEquipe titulo={`Marcar ausência · ${pessoa.nome}`} texto={TEXTO_MARCAR_AUSENCIA} ocupado={enviando} onFechar={onFechar}
      cancelar="Cancelar" confirmar={{ rotulo: "Marcar", ocupado: "Marcando…", onClick: () => void enviar() }}>
      <label className="eqp-campo">Tipo (Férias · Afastamento · Ausência · Bloqueio operacional)
        <select className="eqp-in" value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS_DE_AUSENCIA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <div className="eqp-campo">De · Até
        <div className="eqp-par">
          <input type="date" aria-label="De" className="eqp-in" value={de} onChange={(e) => setDe(e.target.value)} />
          <input type="date" aria-label="Até" className="eqp-in" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
        </div>
      </div>
      <label className="eqp-campo">Motivo
        <input className="eqp-in" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      {erro && <div className="eqp-erro" role="alert">{erro}</div>}
    </ModalDaEquipe>
  )
}

interface RespostaMover { mensagem?: string; para?: { nome: string }; movidas?: number; total?: number; naoAptas?: number; falhas?: number; desfazer?: Desfazer | null }

/** MOVER CARTEIRA — manual; só vai o que o destino é apto a fazer, a menos que o gestor marque o contrário. */
export function MoverModal({ origem, pessoas, onFechar, onFeito }: {
  origem: PessoaDaEquipe; pessoas: PessoaDaEquipe[]; onFechar: () => void; onFeito: (r: { movidas: number; naoAptas: number; falhas: number; desfazer: Desfazer | null }) => void
}) {
  const [para, setPara] = useState("")
  const [naoAptas, setNaoAptas] = useState("nao")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await api<RespostaMover>("/api/torre/equipe/mover-carteira", "POST", { deUsuarioId: origem.usuarioId, paraUsuarioId: para ? Number(para) : null, incluirNaoAptas: naoAptas === "sim" })
    setEnviando(false)
    if (r.data && typeof r.data.movidas === "number") onFeito({ movidas: r.data.movidas, naoAptas: r.data.naoAptas ?? 0, falhas: r.data.falhas ?? 0, desfazer: r.data.desfazer ?? null })
    else setErro(erroDe(r.data))
  }
  return (
    <ModalDaEquipe titulo={`Mover carteira · ${origem.nome}`} ocupado={enviando} onFechar={onFechar}
      texto={`${origem.ativas} tarefas ativas. Só vai o que o destino é apto a fazer, a não ser que você marque o contrário.`}
      cancelar="Cancelar" confirmar={{ rotulo: "Mover", ocupado: "Movendo…", onClick: () => void enviar() }}>
      <label className="eqp-campo">Destino (padrão: sucessor sugerido)
        <select className="eqp-in" value={para} onChange={(e) => setPara(e.target.value)}>
          <option value="">Sucessor sugerido{origem.ausencia?.sucessorSugerido ? ` (${origem.ausencia.sucessorSugerido.nome})` : ""}</option>
          {pessoas.filter((p) => p.usuarioId !== origem.usuarioId).map((p) => <option key={p.usuarioId} value={p.usuarioId}>{p.nome}</option>)}
        </select>
      </label>
      <label className="eqp-campo">Incluir tarefas para as quais o destino não é apto? (sim/não)
        <select className="eqp-in" value={naoAptas} onChange={(e) => setNaoAptas(e.target.value)}>
          <option value="nao">não</option><option value="sim">sim</option>
        </select>
      </label>
      {erro && <div className="eqp-erro" role="alert">{erro}</div>}
    </ModalDaEquipe>
  )
}
