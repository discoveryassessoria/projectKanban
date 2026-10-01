"use client"
// src/components/torre/TarefasModais.tsx — os MODAIS da aba Tarefas (Torre nova). O modelo é UM só (o protótipo, §1.0.2): título,
// texto, campo(s) da ação, "Justificativa (mínimo 5 letras · vai para o histórico)" com o placeholder "Por quê?", o aviso âmbar/verde
// e o botão que só libera com ≥ 5 letras (depois do trim). Não fecha com Esc nem clicando no fundo. A justificativa é zerada a cada
// modal novo (cada modal monta do zero). Cada ação chama a PORTA que já existe — a justificativa vai no campo de motivo da própria
// porta (repactuar, bloquear, desbloquear, reabrir, adiar, cobrar, ligação) ou numa linha `TORRE_JUSTIFICATIVA` (canal, cobrar cliente).
import { useState, type ReactNode } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { diasEntreDiasOperacionais } from "@/lib/operacional/tempo-operacional"
import { diaMesDe, textoDaBola } from "@/lib/operacional/torre-tarefas-tela"
import { docTipoTxt } from "@/src/components/operacao/operacao-v3-derivacoes"
import { api, erroDe, useTorre, type Desfazer } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import type { AcaoComModal } from "./tarefas-tipos"

export const MINIMO_JUSTIFICATIVA = 5
export const AVISO_INVALIDA = "Escreva pelo menos 5 letras para liberar o botão"
export const AVISO_VALIDA = "Justificativa ok · vai para o histórico com seu nome e a hora"

export type RespostaDaAcao = { ok: boolean; mensagem?: string }

/** O modal-padrão: o corpo (campos) é de quem chama; a justificativa, o aviso e o botão são daqui. */
export function TarefasModal({ titulo, texto, botao, children, podeConfirmar = true, onFechar, onConfirmar }: {
  titulo: string; texto?: string; botao: string; children?: ReactNode
  /** Os campos extras da ação estão preenchidos? (o botão só libera com isto E a justificativa). */
  podeConfirmar?: boolean
  onFechar: () => void
  onConfirmar: (justificativa: string) => Promise<RespostaDaAcao>
}) {
  const [just, setJust] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ok = just.trim().length >= MINIMO_JUSTIFICATIVA
  const liberado = ok && podeConfirmar && !enviando
  const confirmar = async () => {
    if (!liberado) return // inerte: o clique não faz nada (como no protótipo)
    setEnviando(true); setErro(null)
    try {
      const r = await onConfirmar(just.trim())
      if (!r.ok) setErro(r.mensagem ?? "Não foi possível concluir a ação.")
    } catch { setErro("Erro de conexão. Nada foi alterado.") }
    finally { setEnviando(false) }
  }
  return (
    <div className="tf-modal-fundo tor" style={{ zIndex: LAYER.popover }}>
      <div className="tf-modal" role="dialog" aria-label={titulo} aria-modal="true">
        <h3>{titulo}</h3>
        {texto && <p className="tx">{texto}</p>}
        {children}
        <label>Justificativa (mínimo 5 letras · vai para o histórico)
          <input type="text" placeholder="Por quê?" value={just} onChange={(e) => setJust(e.target.value)} aria-label="Justificativa" />
        </label>
        <div className={`tf-aviso ${ok ? "ok" : "amb"}`} role="status">{ok ? AVISO_VALIDA : AVISO_INVALIDA}</div>
        {erro && <div className="tf-erro" role="alert">{erro}</div>}
        <div className="tf-modal-rodape">
          <button type="button" onClick={onFechar} disabled={enviando}>Cancelar</button>
          <button type="button" className={`conf ${liberado ? "" : "inerte"}`} aria-disabled={!liberado} onClick={() => void confirmar()}>{enviando ? "Enviando…" : botao}</button>
        </div>
      </div>
    </div>
  )
}

const CANAIS_DA_COBRANCA = [["", "E-mail cadastrado do cartório"], ["EMAIL", "E-mail"], ["TELEFONE", "Telefone"], ["WHATSAPP", "WhatsApp"], ["OFICIO", "Ofício"], ["PRESENCIAL", "Presencial"]] as const
const RESULTADOS_LIGACAO = [
  ["SEM_RESPOSTA", "Sem resposta"], ["CONFIRMOU_PEDIDO", "Confirmou o pedido"], ["PEDIU_DOCUMENTO", "Pediu documento"],
  ["EM_BUSCA", "Em busca"], ["NAO_LOCALIZOU", "Não localizou"], ["ENVIOU", "Enviou (ainda não recebido)"],
] as const
const CANAIS_DA_SOLICITACAO = [["CRC", "CRC"], ["ECARTORIO", "E-cartório"], ["EMAIL", "E-mail"], ["WHATSAPP", "WhatsApp"], ["BALCAO", "Balcão"], ["COMUNE", "Comune"], ["CORREIOS", "Correios"], ["CONSULADO", "Consulado"]] as const

/** Meio-dia UTC — nunca meia-noite, que vira o dia anterior no fuso operacional (mesma convenção do modal individual da Operação). */
export const isoDoDia = (aaaaMmDd: string): string => `${aaaaMmDd}T12:00:00.000Z`
const ddmm = (aaaaMmDd: string): string => diaMesDe(isoDoDia(aaaaMmDd)) ?? aaaaMmDd

/** O rótulo "Certidão de óbito · Giuseppe Bertolucci" do modal e do toast. */
export const pessoaDaLinha = (l: Pick<LinhaTorre, "pessoaNome" | "casalNomes">): string => l.pessoaNome ?? l.casalNomes ?? "—"

export function ModalDaAcao({ acao, linha, agora, onFechar, onFeito }: {
  acao: AcaoComModal; linha: LinhaTorre; agora: Date; onFechar: () => void; onFeito?: () => void
}) {
  const { avisar, recarregar } = useTorre()
  const pessoa = pessoaDaLinha(linha)
  const certidao = docTipoTxt(linha)
  const bola = textoDaBola(linha, agora).texto
  const [campo, setCampo] = useState("")
  const [campo2, setCampo2] = useState("")

  const concluir = (msg: string, desfazer?: Desfazer | null) => { onFechar(); avisar(msg, desfazer ?? null); recarregar(); onFeito?.() }
  const comando = (corpo: Record<string, unknown>) => api<{ error?: string; codigo?: string }>(`/api/tarefas/${linha.taskId}/comando`, "POST", corpo)
  const falha = (d: unknown): RespostaDaAcao => ({ ok: false, mensagem: erroDe(d) })

  if (acao === "cobrar") {
    return (
      <TarefasModal titulo="Registrar cobrança · cartório" texto={`${bola} · ${certidao} · ${pessoa}`} botao="Registrar cobrança" onFechar={onFechar} onConfirmar={async (just) => {
        const r = await api<{ ok?: boolean; mensagem?: string; proximoAcompanhamentoEm?: string | null; desfazer?: Desfazer | null }>(`/api/torre/tarefas/${linha.taskId}/cobrar`, "POST", { ...(campo ? { canal: campo } : {}), observacao: just })
        if (!r.ok || !r.data.ok) return { ok: false, mensagem: r.data.mensagem ?? erroDe(r.data) }
        const dias = r.data.proximoAcompanhamentoEm ? diasEntreDiasOperacionais(new Date(r.data.proximoAcompanhamentoEm), agora) : null
        concluir(dias != null && dias > 0 ? `Cobrança registrada · próxima em ${dias} ${dias === 1 ? "dia" : "dias"} · ${pessoa}` : `Cobrança registrada · ${pessoa}`, r.data.desfazer ?? null)
        return { ok: true }
      }}>
        <label>Canal
          <select value={campo} onChange={(e) => setCampo(e.target.value)} aria-label="Canal">{CANAIS_DA_COBRANCA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </TarefasModal>
    )
  }
  if (acao === "cobrarCliente") {
    return (
      <TarefasModal titulo="Registrar cobrança · cliente" texto={`${certidao} · ${pessoa}`} botao="Registrar cobrança" onFechar={onFechar} onConfirmar={async (just) => {
        const r = await api<{ ok?: boolean; mensagem?: string }>(`/api/torre/tarefas/${linha.taskId}/cobrar-cliente`, "POST", { justificativa: just })
        if (!r.ok || !r.data.ok) return { ok: false, mensagem: r.data.mensagem ?? erroDe(r.data) }
        concluir(`Cobrança ao cliente registrada · ${pessoa}`)
        return { ok: true }
      }}>
        <label>Canal
          <select aria-label="Canal" defaultValue="chat"><option value="chat">Chat do processo (mensagem ao cliente)</option></select>
        </label>
      </TarefasModal>
    )
  }
  if (acao === "adiar") {
    const dias = campo ? diasEntreDiasOperacionais(new Date(isoDoDia(campo)), agora) : null
    const diasOk = dias != null && Number.isInteger(dias) && dias >= 1 && dias <= 15
    return (
      <TarefasModal titulo="Adiar a cobrança" texto="O prazo da tarefa não muda; só a data da próxima cobrança." botao="Adiar" podeConfirmar={diasOk} onFechar={onFechar} onConfirmar={async (just) => {
        if (!diasOk || dias == null) return { ok: false, mensagem: "Escolha uma data entre amanhã e 15 dias à frente." }
        const r = await api<{ ok?: boolean; mensagem?: string }>(`/api/operacao/tarefas/${linha.taskId}/adiar-acompanhamento`, "POST", { dias, motivo: `Adiado até ${ddmm(campo)}: ${just}` })
        if (!r.ok || !r.data.ok) return { ok: false, mensagem: r.data.mensagem ?? erroDe(r.data) }
        concluir(`Cobrança adiada para ${ddmm(campo)} · ${pessoa}`)
        return { ok: true }
      }}>
        <label>Nova data
          <input type="date" value={campo} onChange={(e) => setCampo(e.target.value)} aria-label="Nova data" />
        </label>
        {campo && !diasOk && <div className="tf-aviso amb">A próxima cobrança pode ficar de amanhã a 15 dias à frente.</div>}
      </TarefasModal>
    )
  }
  if (acao === "desbloquear") {
    return (
      <TarefasModal titulo="Desbloquear" texto={`${certidao} · ${pessoa}`} botao="Desbloquear" onFechar={onFechar} onConfirmar={async (just) => {
        const r = await comando({ acao: "desbloquear", motivo: just })
        if (!r.ok) return falha(r.data)
        concluir(`Desbloqueada · ${pessoa}`)
        return { ok: true }
      }} />
    )
  }
  if (acao === "repactuar") {
    return (
      <TarefasModal titulo="Repactuar prazo" texto={`${certidao} · ${pessoa}`} botao="Repactuar" podeConfirmar={!!campo} onFechar={onFechar} onConfirmar={async (just) => {
        const r = await comando({ acao: "alterar_prazo", novoPrazo: isoDoDia(campo), motivo: just })
        if (!r.ok) return falha(r.data)
        concluir(`Prazo repactuado para ${ddmm(campo)} · ${pessoa}`, { tipo: "PRAZO", tarefaIds: [linha.taskId] })
        return { ok: true }
      }}>
        <label>Novo prazo
          <input type="date" value={campo} onChange={(e) => setCampo(e.target.value)} aria-label="Novo prazo" />
        </label>
      </TarefasModal>
    )
  }
  if (acao === "bloquear") {
    return (
      <TarefasModal titulo="Bloquear com motivo" texto="O prazo continua contando enquanto bloqueada." botao="Bloquear" podeConfirmar={campo.trim().length > 0} onFechar={onFechar} onConfirmar={async (just) => {
        const r = await comando({ acao: "bloquear", motivo: `${campo.trim()} · Justificativa: ${just}` })
        if (!r.ok) return falha(r.data)
        concluir(`Bloqueada · ${pessoa}`)
        return { ok: true }
      }}>
        <label>Motivo
          <input type="text" placeholder="esperando procuração do cliente" value={campo} onChange={(e) => setCampo(e.target.value)} aria-label="Motivo" />
        </label>
      </TarefasModal>
    )
  }
  if (acao === "reabrir") {
    return (
      <TarefasModal titulo="Reabrir passo" texto={'Volta o passo anterior para "em andamento".'} botao="Reabrir" onFechar={onFechar} onConfirmar={async (just) => {
        const r = await comando({ acao: "reabrir", motivo: just })
        if (!r.ok) return falha(r.data)
        concluir(`Passo reaberto · ${pessoa}`)
        return { ok: true }
      }} />
    )
  }
  if (acao === "ligacao") {
    return (
      <TarefasModal titulo="Registrar ligação" texto={bola} botao="Registrar" onFechar={onFechar} onConfirmar={async (just) => {
        const r = await api<{ ok?: boolean; mensagem?: string; erro?: string }>(`/api/torre/tarefas/${linha.taskId}/ligacao`, "POST", { resultado: campo || "SEM_RESPOSTA", observacao: just })
        if (!r.ok || r.data.ok === false) return { ok: false, mensagem: r.data.erro ?? r.data.mensagem ?? erroDe(r.data) }
        concluir(`Ligação registrada · ${pessoa}`)
        return { ok: true }
      }}>
        <label>Resultado
          <select value={campo} onChange={(e) => setCampo(e.target.value)} aria-label="Resultado">{RESULTADOS_LIGACAO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </TarefasModal>
    )
  }
  // canal
  return (
    <TarefasModal titulo="Trocar canal de cobrança" texto="CRC · e-cartório · e-mail · WhatsApp · balcão · correios" botao="Trocar" podeConfirmar={!!campo2} onFechar={onFechar} onConfirmar={async (just) => {
      const r = await api<{ ok?: boolean; erro?: string }>(`/api/torre/tarefas/${linha.taskId}/canal`, "POST", { canal: campo2, justificativa: just })
      if (!r.ok || r.data.ok === false) return { ok: false, mensagem: r.data.erro ?? erroDe(r.data) }
      concluir(`Canal trocado · ${pessoa}`)
      return { ok: true }
    }}>
      <label>Novo canal
        <select value={campo2} onChange={(e) => setCampo2(e.target.value)} aria-label="Novo canal">
          <option value="">Escolha o canal</option>
          {CANAIS_DA_SOLICITACAO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
    </TarefasModal>
  )
}

/** "Repactuar prazo em lote" — UMA justificativa para todas; cada tarefa grava a sua linha (porta do lote). */
export function ModalRepactuarLote({ n, onFechar, onEnviar }: {
  n: number; onFechar: () => void; onEnviar: (novoPrazoIso: string, justificativa: string, ddmm: string) => Promise<RespostaDaAcao>
}) {
  const [data, setData] = useState("")
  return (
    <TarefasModal titulo="Repactuar prazo em lote" texto={`${n} ${n === 1 ? "tarefa selecionada" : "tarefas selecionadas"}`} botao="Repactuar" podeConfirmar={!!data} onFechar={onFechar}
      onConfirmar={(just) => onEnviar(isoDoDia(data), just, ddmm(data))}>
      <label>Novo prazo
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} aria-label="Novo prazo" />
      </label>
    </TarefasModal>
  )
}
