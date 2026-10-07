"use client"
// src/components/operacao/RegistrarContatoModal.tsx
// ============================================================================
// REGISTRAR CONTATO — mini-formulário único (Torre de Controle, Bloco B,
// 29/09/2026): canal, resultado, observação e data. Substitui os disparos
// mudos de "Cobrar" (canal fixo em EMAIL, sem resultado) e o `window.prompt`
// de "Adiar". Usado por três portas, sempre a mesma gravação
// (`registrarCobranca`, `src/services/subtarefas-da-etapa.ts`):
//   • DocumentoOperationalDrawer → WorkflowTab (bloco "Contato com o cartório")
//   • Operação v3, aba Acompanhamento → botão "Cobrar"
//   • Operação v3, aba Acompanhamento → "Cobrar todos os vencidos" (lote)
//
// Vocabulário fechado — espelha `CANAIS_DE_CONTATO`/`RESULTADOS_DE_CONTATO`
// (`src/services/subtarefas-da-etapa.ts`, só server). Cópia client-side de
// rótulo, não de regra: a validação real continua na porta.
// ============================================================================

import { useState } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { CampoDataHoraTexto } from "@/src/components/ui/campo-data-texto"

export const CANAIS_DE_CONTATO_UI = [
  { v: "EMAIL", l: "E-mail" },
  { v: "TELEFONE", l: "Telefone" },
  { v: "WHATSAPP", l: "WhatsApp" },
  { v: "OFICIO", l: "Ofício" },
  { v: "PRESENCIAL", l: "Presencial" },
] as const

export const RESULTADOS_DE_CONTATO_UI = [
  { v: "SEM_RESPOSTA", l: "Sem resposta" },
  { v: "CONFIRMOU_PEDIDO", l: "Confirmou o pedido" },
  { v: "PEDIU_DOCUMENTO", l: "Pediu documento" },
  { v: "EM_BUSCA", l: "Em busca" },
  { v: "NAO_LOCALIZOU", l: "Não localizou" },
  { v: "ENVIOU", l: "Enviou (ainda não recebido)" },
] as const

/** Valor especial do seletor de canal: "use o canal cadastrado" — o chamador o OMITE do corpo da requisição. */
export const CANAL_CADASTRADO = "CADASTRADO"

export interface DadosDeContato {
  canal: string
  resultado: string
  observacao: string | null
  dataContato: string | null
}

export function RegistrarContatoModal({
  titulo, subtitulo, canalInicial, resultadoInicial = "SEM_RESPOSTA", opcaoCanalCadastrado = false,
  onFechar, onEnviar,
}: {
  titulo: string
  subtitulo?: string
  canalInicial?: string
  /** Cobrança em lote/por órgão (Torre, Bloco G): oferece "Canal cadastrado de cada pedido" — o servidor resolve
   *  o canal de CADA tarefa (solicitação → cadastro do órgão). Chega ao chamador como `canal: CANAL_CADASTRADO`. */
  opcaoCanalCadastrado?: boolean
  resultadoInicial?: string
  onFechar: () => void
  onEnviar: (dados: DadosDeContato) => Promise<{ ok: boolean; mensagem?: string }>
}) {
  const [canal, setCanal] = useState(canalInicial ?? (opcaoCanalCadastrado ? CANAL_CADASTRADO : "EMAIL"))
  const [resultado, setResultado] = useState(resultadoInicial)
  const [observacao, setObservacao] = useState("")
  const [dataContato, setDataContato] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const confirmar = async () => {
    setEnviando(true); setErro(null)
    try {
      const r = await onEnviar({
        canal, resultado,
        observacao: observacao.trim() || null,
        dataContato: dataContato ? new Date(dataContato).toISOString() : null,
      })
      if (!r.ok) { setErro(r.mensagem ?? "Não foi possível registrar o contato."); return }
    } catch { setErro("Erro de conexão. O contato não foi registrado.") }
    finally { setEnviando(false) }
  }

  const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-[13px] text-white/95 outline-none focus:border-[var(--border-default)]"
  const rot = "text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--overlay-modal)] px-4" style={{ zIndex: LAYER.popover }} onClick={enviando ? undefined : onFechar}>
      <div className="w-full max-w-md rounded-2xl bg-[var(--surface-popover)] shadow-[var(--elev-3)] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-[15px] font-extrabold text-white/95">{titulo}</h3>
          {subtitulo && <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">{subtitulo}</p>}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className={rot}>Canal</span>
            <select value={canal} onChange={(e) => setCanal(e.target.value)} className={inp}>
              {opcaoCanalCadastrado && <option value={CANAL_CADASTRADO}>Canal cadastrado de cada pedido</option>}
              {CANAIS_DE_CONTATO_UI.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className={rot}>Resultado</span>
            <select value={resultado} onChange={(e) => setResultado(e.target.value)} className={inp}>
              {RESULTADOS_DE_CONTATO_UI.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className={rot}>Observação (opcional)</span>
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className={inp} placeholder="O que foi dito/combinado, se houver" />
        </label>

        <label className="block space-y-1">
          <span className={rot}>Quando aconteceu (opcional — padrão agora)</span>
          <CampoDataHoraTexto value={dataContato} onChange={setDataContato} className={inp} aria-label="Quando aconteceu" />
        </label>

        {erro && <div className="text-[12px] text-red-700 bg-[var(--surface-secondary)] rounded-lg px-3 py-2">{erro}</div>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onFechar} disabled={enviando} className="text-[13px] font-semibold px-3.5 py-2 rounded-lg text-white/68 hover:bg-[var(--surface-tertiary)]">Cancelar</button>
          <button onClick={confirmar} disabled={enviando} className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[var(--action-primary)] text-[var(--action-primary-ink)] hover:bg-[var(--action-primary-hover)] disabled:opacity-60">
            {enviando ? "Registrando…" : "Registrar contato"}
          </button>
        </div>
      </div>
    </div>
  )
}
