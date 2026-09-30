"use client"
// src/components/torre/PainelTorreTarefa.tsx
// ============================================================================
// PAINEL ESPELHADO DA TAREFA (Bloco G6) — entra no `DocumentoOperationalDrawer` real
// pela prop `barraSuperiorExtra`. Bola com / prazo / próximo acompanhamento /
// responsável, passos 1/N…N/N e as ações do gestor. Cada botão chama uma porta
// existente (comando da tarefa, /api/torre/*) — e só aparece com a permissão dela.
// ============================================================================
import { useEffect, useState } from "react"
import { RepactuarPrazoModal } from "@/src/components/operacao/RepactuarPrazoModal"
import { acompTxtCompleto } from "@/src/components/operacao/operacao-v3-derivacoes"
import { api, erroDe, Modal, ModalTexto, Campo, useTorre } from "./torre-base"
import { bolaDe, type LinhaTorre } from "./tipos"

const CANAIS_SOLICITACAO = ["CRC", "ECARTORIO", "EMAIL", "WHATSAPP", "BALCAO", "COMUNE", "CORREIOS", "CONSULADO"]
const RESULTADOS_LIGACAO = [
  ["SEM_RESPOSTA", "Sem resposta"], ["CONFIRMOU_PEDIDO", "Confirmou o pedido"], ["PEDIU_DOCUMENTO", "Pediu documento"],
  ["EM_BUSCA", "Em busca"], ["NAO_LOCALIZOU", "Não localizou"], ["ENVIOU", "Enviou (ainda não recebido)"],
]

type Aberto = null | "repactuar" | "bloquear" | "reabrir" | "ligacao" | "canal"

export function PainelTorreTarefa({ linha }: { linha: LinhaTorre }) {
  const { permissoes, avisar, recarregar } = useTorre()
  const [sugerido, setSugerido] = useState<{ usuarioId: number; nome: string; motivo: string } | null>(null)
  const [aberto, setAberto] = useState<Aberto>(null)
  const [ocupado, setOcupado] = useState(false)
  const bola = bolaDe(linha)

  useEffect(() => {
    let vivo = true
    if (permissoes?.editar && !linha.responsavelId) {
      void api<{ sugestao: { usuarioId: number; nome: string; motivo: string } | null }>(`/api/torre/tarefas/${linha.taskId}/sugestao`)
        .then((r) => { if (vivo) setSugerido(r.ok ? r.data.sugestao : null) })
    }
    return () => { vivo = false }
  }, [linha.taskId, linha.responsavelId, permissoes?.editar])

  const comando = async (corpo: Record<string, unknown>) => {
    const r = await api<{ error?: string }>(`/api/tarefas/${linha.taskId}/comando`, "POST", corpo)
    if (r.ok) { recarregar(); return { ok: true as const } }
    return { ok: false as const, mensagem: erroDe(r.data) }
  }

  const atribuirSugerido = async () => {
    setOcupado(true)
    const r = await api<{ ok?: boolean; mensagem?: string; desfazer?: { tipo: "ATRIBUICAO"; tarefaIds: number[] } }>(`/api/torre/tarefas/${linha.taskId}/atribuir-sugerido`, "POST")
    setOcupado(false)
    if (r.ok) { avisar(r.data.mensagem ?? "Atribuída.", r.data.desfazer ?? null); recarregar() } else avisar(erroDe(r.data))
  }

  const passos = linha.passoAtual
  return (
    <div className="tor tor-painel" data-testid="painel-torre">
      <div className="tor-kv">
        <div><b>Bola com</b><span className={`tor-p ${bola.cls}`}>{bola.txt}</span></div>
        <div><b>Prazo da tarefa</b>{linha.rotuloDoPrazo || "—"}</div>
        <div><b>Próximo acompanhamento</b>{acompTxtCompleto(linha.acompanhamentoPasso)}</div>
        <div><b>Responsável</b>{linha.responsavelNome ?? "sem responsável"}</div>
      </div>
      {passos && (
        <div className="tor-passos" aria-label="Passos da tarefa">
          {Array.from({ length: passos.total }, (_, i) => (
            <div key={i} className={`tor-passo ${i < passos.ordem ? "done" : i === passos.ordem ? "cur" : ""}`}>
              {i + 1}/{passos.total}{i === passos.ordem && linha.passoCorrente ? ` · ${linha.passoCorrente.label}` : ""}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {permissoes?.editar && !linha.responsavelId && sugerido && (
          <button className="tor-btn pri" disabled={ocupado} onClick={() => void atribuirSugerido()} title={sugerido.motivo}>Atribuir a {sugerido.nome}</button>
        )}
        {permissoes?.editar && <button className="tor-btn" onClick={() => setAberto("repactuar")}>Repactuar prazo</button>}
        {permissoes?.bloquear && linha.statusTarefa !== "BLOQUEADA" && <button className="tor-btn" onClick={() => setAberto("bloquear")}>Bloquear com motivo</button>}
        {permissoes?.editar && <button className="tor-btn" onClick={() => setAberto("reabrir")}>Reabrir passo</button>}
        <button className="tor-btn" onClick={() => setAberto("ligacao")}>Registrar ligação</button>
        {permissoes?.editar && <button className="tor-btn" onClick={() => setAberto("canal")}>Trocar canal</button>}
      </div>

      {aberto === "repactuar" && (
        <RepactuarPrazoModal
          prazoAtualIso={linha.dataPrazo} onFechar={() => setAberto(null)}
          onEnviar={async ({ novoPrazo, motivo }) => {
            const r = await comando({ acao: "alterar_prazo", novoPrazo, motivo })
            if (r.ok) { setAberto(null); avisar("Prazo repactuado (auditado).") }
            return r
          }}
        />
      )}
      {aberto === "bloquear" && (
        <ModalTexto titulo="Bloquear com motivo" subtitulo="O prazo continua contando." rotulo="Motivo" confirmar="Bloquear" onFechar={() => setAberto(null)}
          onEnviar={async (motivo) => { const r = await comando({ acao: "bloquear", motivo }); if (r.ok) { setAberto(null); avisar("Tarefa bloqueada. O prazo continua contando.") } return r }} />
      )}
      {aberto === "reabrir" && (
        <ModalTexto titulo="Reabrir passo" subtitulo="Volta o passo concluído para execução, pelo motor." rotulo="Justificativa" confirmar="Reabrir" onFechar={() => setAberto(null)}
          onEnviar={async (motivo) => { const r = await comando({ acao: "reabrir", motivo }); if (r.ok) { setAberto(null); avisar("Passo reaberto (auditado).") } return r }} />
      )}
      {aberto === "ligacao" && <LigacaoModal taskId={linha.taskId} onFechar={() => setAberto(null)} />}
      {aberto === "canal" && <CanalModal taskId={linha.taskId} onFechar={() => setAberto(null)} />}
    </div>
  )
}

function LigacaoModal({ taskId, onFechar }: { taskId: number; onFechar: () => void }) {
  const { avisar, recarregar } = useTorre()
  const [resultado, setResultado] = useState("SEM_RESPOSTA")
  const [observacao, setObservacao] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await api<{ mensagem?: string }>(`/api/torre/tarefas/${taskId}/ligacao`, "POST", { resultado, observacao })
    setEnviando(false)
    if (r.ok) { avisar("Ligação registrada no histórico da tarefa e do órgão."); recarregar(); onFechar() } else setErro(erroDe(r.data))
  }
  return (
    <Modal titulo="Registrar ligação" subtitulo="Fica no histórico da tarefa e do órgão — um só registro." onFechar={onFechar} ocupado={enviando} rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando}>{enviando ? "Registrando…" : "Registrar ligação"}</button>
    </>}>
      <Campo rotulo="Resultado"><select className="tor-in w-full" value={resultado} onChange={(e) => setResultado(e.target.value)}>{RESULTADOS_LIGACAO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
      <Campo rotulo="Observação (opcional)"><textarea className="tor-in w-full" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} /></Campo>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
    </Modal>
  )
}

function CanalModal({ taskId, onFechar }: { taskId: number; onFechar: () => void }) {
  const { avisar, recarregar } = useTorre()
  const [canal, setCanal] = useState("EMAIL")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await api(`/api/torre/tarefas/${taskId}/canal`, "POST", { canal })
    setEnviando(false)
    if (r.ok) { avisar(`Canal da solicitação trocado para ${canal}.`); recarregar(); onFechar() } else setErro(erroDe(r.data))
  }
  return (
    <Modal titulo="Trocar canal" subtitulo="Grava na solicitação e no histórico da tarefa e do órgão." onFechar={onFechar} ocupado={enviando} rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando}>{enviando ? "Trocando…" : "Trocar canal"}</button>
    </>}>
      <Campo rotulo="Novo canal"><select className="tor-in w-full" value={canal} onChange={(e) => setCanal(e.target.value)}>{CANAIS_SOLICITACAO.map((c) => <option key={c} value={c}>{c}</option>)}</select></Campo>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
    </Modal>
  )
}
