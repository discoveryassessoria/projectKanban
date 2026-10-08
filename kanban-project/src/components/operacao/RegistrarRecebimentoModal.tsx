"use client"
// src/components/operacao/RegistrarRecebimentoModal.tsx
// ============================================================================
// REGISTRAR RECEBIMENTO (Operação, 07/10/2026) — a certidão chegou do cartório. A janela do PASSO 3 («Receber certidão»), aberta pela gaveta da
// certidão (WorkflowTab, `janelaDaSubtarefa`) — o passo 2 abre a tela de confirmação do pedido: data de recebimento (sugere hoje; pode ser de meses atrás), anexo OPCIONAL, e confirmação com o texto do que vai
// mudar. Só grava depois do «Confirmar». Nada exige anexo: a equipe lança pedidos antigos que não têm comprovante guardado.
//   POST /api/operacao/tarefas/{id}/registrar-recebimento  (sem `confirmado` = prévia; com `confirmado: true` = grava)
// ============================================================================
import { useState } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { auth } from "./kit-operacional"
import { uploadFiles, hashDoArquivo } from "@/src/lib/storage"
import { CampoDataTexto } from "@/src/components/ui/campo-data-texto"

const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())

export function RegistrarRecebimentoModal({
  tarefaId, documentoId, titulo, onFechar, onRegistrado,
}: {
  tarefaId: number
  /** Para o anexo opcional. Sem documento, o campo de anexo não aparece. */
  documentoId: number | null
  /** "Certidão de casamento · Juan Sanchez Diaz" — quem o modal está registrando. */
  titulo?: string
  onFechar: () => void
  /** `texto` = a frase do histórico ("Recebida em 07/10 · registrado por Daniela Brait"); `avisoDoAnexo` = só se o anexo falhou. */
  onRegistrado: (texto: string, avisoDoAnexo?: string) => void
}) {
  const [dia, setDia] = useState(hojeSP())
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [pergunta, setPergunta] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const continuar = async () => {
    setEnviando(true); setErro(null)
    try {
      const r = await fetch(`/api/operacao/tarefas/${tarefaId}/registrar-recebimento`, { method: "POST", headers: auth(), body: JSON.stringify({ recebidaEm: dia }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) { setErro(d.mensagem ?? "Não foi possível conferir a data."); return }
      setPergunta(d.pergunta as string)
    } catch { setErro("Erro de conexão. Nada foi registrado.") }
    finally { setEnviando(false) }
  }

  const confirmar = async () => {
    setEnviando(true); setErro(null)
    try {
      const r = await fetch(`/api/operacao/tarefas/${tarefaId}/registrar-recebimento`, { method: "POST", headers: auth(), body: JSON.stringify({ recebidaEm: dia, confirmado: true }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.ok) { setErro(d.mensagem ?? "Não foi possível registrar o recebimento."); return }
      // O ANEXO (opcional) sobe DEPOIS de o recebimento estar registrado: se falhar, o ato continua valendo — o anexo não pode desfazer um recebimento que aconteceu.
      let aviso: string | undefined
      if (arquivo && documentoId != null) {
        try {
          const [subido] = await uploadFiles([arquivo], { alvo: { dominio: "documento", id: documentoId } })
          const hash = await hashDoArquivo(arquivo)
          const ra = await fetch(`/api/documentos/${documentoId}/arquivos`, {
            method: "POST", headers: auth(),
            body: JSON.stringify({ url: subido.url, nome: subido.name, mimeType: subido.type || null, tamanho: subido.size, hash, tipo: "DOCUMENTO_RECEBIDO" }),
          })
          if (!ra.ok) aviso = "O recebimento foi registrado, mas o anexo não pôde ser salvo. Anexe de novo na aba Anexos."
        } catch { aviso = "O recebimento foi registrado, mas o anexo não pôde ser enviado. Anexe de novo na aba Anexos." }
      }
      onRegistrado(d.texto as string, aviso)
    } catch { setErro("Erro de conexão. Confira se o recebimento foi registrado antes de tentar de novo.") }
    finally { setEnviando(false) }
  }

  const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] px-3 py-2 text-[13px] text-white/95 outline-none"
  const rot = "text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--overlay-modal)] px-4" style={{ zIndex: LAYER.popover }} onClick={enviando ? undefined : onFechar} data-testid="registrar-recebimento">
      <div className="w-full max-w-md rounded-2xl bg-[var(--surface-popover)] shadow-[var(--elev-3)] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-extrabold text-white/95">Registrar recebimento</h3>
        {titulo && <p className="text-[12px] text-[var(--text-secondary)]">{titulo}</p>}

        {pergunta == null ? (
          <>
            <label className="block space-y-1">
              <span className={rot}>Data em que a certidão foi recebida</span>
              <CampoDataTexto max={hojeSP()} value={dia} onChange={setDia} className={inp} aria-label="Data em que a certidão foi recebida" />
              <span className="text-[10.5px] text-[var(--text-muted)]">Pode ser uma data antiga: pedidos de meses atrás também se registram aqui.</span>
            </label>
            {documentoId != null && (
              <label className="block space-y-1">
                <span className={rot}>Anexar a certidão (opcional)</span>
                <input type="file" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className={inp} />
                <span className="text-[10.5px] text-[var(--text-muted)]">Não é obrigatório: dá para registrar sem comprovante.</span>
              </label>
            )}
          </>
        ) : (
          <div className="text-[13px] text-white/90 bg-[var(--surface-secondary)] rounded-lg px-3 py-3">
            {pergunta}
            {arquivo && <div className="mt-2 text-[12px] text-[var(--text-secondary)]">Anexo: {arquivo.name}</div>}
          </div>
        )}

        {erro && <div className="text-[12px] text-red-700 bg-[var(--surface-secondary)] rounded-lg px-3 py-2" role="alert">{erro}</div>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={pergunta == null ? onFechar : () => { setPergunta(null); setErro(null) }} disabled={enviando} className="text-[13px] font-semibold px-3.5 py-2 rounded-lg text-white/68 hover:bg-[var(--surface-tertiary)]">
            {pergunta == null ? "Cancelar" : "Voltar"}
          </button>
          {pergunta == null ? (
            <button onClick={continuar} disabled={enviando || !dia} className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[var(--action-primary)] text-[var(--action-primary-ink)] hover:bg-[var(--action-primary-hover)] disabled:opacity-60">
              {enviando ? "Conferindo…" : "Continuar"}
            </button>
          ) : (
            <button onClick={confirmar} disabled={enviando} className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[var(--action-primary)] text-[var(--action-primary-ink)] hover:bg-[var(--action-primary-hover)] disabled:opacity-60">
              {enviando ? "Registrando…" : "Confirmar"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
