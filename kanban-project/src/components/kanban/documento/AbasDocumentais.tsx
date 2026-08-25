// src/components/kanban/documento/AbasDocumentais.tsx
//
// ABAS DOCUMENTAIS — Anexos e Observações do documento e da etapa.
//
// Substituem os textos de pendência que estavam em produção ("Requer modelo
// WorkflowStepAttachment no schema.", "Requer modelo WorkflowStepComment..."):
// nenhuma delas pede que o operador digite de novo o que já preencheu em
// "Solicitar certidão" — todas LEEM o registro canônico (DocumentoArquivo /
// DocumentoObservacao).
//
// A aba de ETAPA e a aba de DOCUMENTO são a MESMA consulta com escopo diferente —
// o arquivo aparece nas duas por referência, com um único binário no R2.
//
// A antiga aba PROTOCOLO saiu da interface (os dados dela vivem na etapa
// "Solicitar certidão" e em "Aguardar retorno"), mas os tipos de leitura da
// solicitação continuam aqui: são o contrato que os editores de etapa consomem.

"use client"

import { useMemo, useRef, useState } from "react"
import { useApi } from "@/src/lib/dados"
import {
  Paperclip, ExternalLink, Loader2, Upload, StickyNote, AlertTriangle,
} from "lucide-react"
import { uploadFiles } from "@/src/lib/storage"

// ── Contrato de leitura (espelho dos DTOs do serviço) ───────────────────────

export interface ArquivoDocumentoView {
  id: number
  url: string
  nome: string
  mimeType: string | null
  tamanho: number | null
  hashConteudo: string | null
  /** Finalidade na operação. */
  tipo: string
  /** O que o arquivo É no Cadastro Mestre de Documentos. null = sem exigência configurada. */
  documentoMestre: { id: number; publicCode: string | null; code: string | null; name: string } | null
  origem: "SOLICITACAO" | "ETAPA" | "DOCUMENTO"
  stepInstanceId: number | null
  solicitacaoId: number | null
  protocoloId: number | null
  vigente: boolean
  substituiId: number | null
  substituidoEm: string | null
  motivoSubstituicao: string | null
  criadoPor: { id: number; nome: string } | null
  createdAt: string
}

export interface ProtocoloView {
  id: number
  numero: string | null
  tipo: string | null
  formaEnvio: string | null
  dataProtocolo: string | null
  informadoEm: string
  informadoPor: { id: number; nome: string } | null
  observacoes: string | null
  origem: string
  vigente: boolean
}

export interface SolicitacaoView {
  id: number
  canal: string
  canalLabel: string | null
  destinatarioNome: string | null
  atendente: string | null
  dataEnvio: string
  prazoEsperadoDias: number | null
  previsaoRetorno: string | null
  observacao: string | null
  codigoRastreio: string | null
  linkAcompanhamento: string | null
  custoPago: number | null
  formaPagamento: string | null
  status: string
  criadoPor: { id: number; nome: string } | null
  stepInstanceId: number | null
  createdAt: string
  protocolos: ProtocoloView[]
  arquivos: ArquivoDocumentoView[]
  protocoloObrigatorio: boolean
}

export interface ObservacaoView {
  id: number
  texto: string
  criadoPor: { id: number; nome: string } | null
  createdAt: string
  stepInstanceId: number | null
}

const LABEL_TIPO_ARQUIVO: Record<string, string> = {
  REQUERIMENTO_ENVIADO: "Requerimento enviado",
  COMPROVANTE_PROTOCOLO: "Comprovante de protocolo",
  COMPROVANTE_CONTATO: "Comprovante de contato",
  DOCUMENTO_RECEBIDO: "Documento recebido",
  OUTRO: "Outro",
}

const LABEL_ORIGEM: Record<string, string> = {
  SOLICITACAO: "Solicitação",
  ETAPA: "Etapa do workflow",
  DOCUMENTO: "Documento",
}

function fmtDataHora(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

function fmtTamanho(bytes: number | null): string {
  if (bytes == null || bytes < 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const authHeader = () => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
})

function Vazio({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="py-10 text-center">
      <div className="text-[13px] font-semibold text-white/70 mb-1">{titulo}</div>
      <div className="text-[12px] text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">{descricao}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ANEXOS (documento e etapa — mesma consulta, escopo diferente)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Uma linha por ARQUIVO. O tipo mestre (o que o documento É no cadastro) vem
 * antes da finalidade: "Requerimento inteiro teor · DOC21" é a identidade; a
 * finalidade só diz o papel dele naquele envio. Sem classificação, mostra a
 * finalidade sozinha — nunca um código inventado.
 */
function LinhaArquivo({ arquivo: a }: { arquivo: ArquivoDocumentoView }) {
  const mestre = a.documentoMestre
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 transition-colors ${
        a.vigente
          ? "border-[var(--border-default)] bg-[var(--app-background)] hover:bg-[var(--surface-popover)]"
          : "border-[var(--border-subtle)] bg-[var(--surface-overlay)] hover:bg-[var(--surface-overlay)] opacity-60"
      }`}
    >
      <Paperclip className="w-3.5 h-3.5 text-[var(--text-secondary)] flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12px] text-white/90 truncate">{a.nome}</span>
          {!a.vigente && (
            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--surface-primary)] text-[var(--text-secondary)] flex-shrink-0">
              substituído
            </span>
          )}
        </div>
        {mestre && (
          <div className="text-[10.5px] text-[#7dd3fc]/85 truncate">
            {mestre.name}
            {mestre.publicCode ? ` · ${mestre.publicCode}` : ""}
          </div>
        )}
        <div className="text-[10px] text-[var(--text-secondary)]">
          {LABEL_TIPO_ARQUIVO[a.tipo] ?? a.tipo}
          {" · "}
          {LABEL_ORIGEM[a.origem] ?? a.origem}
          {a.tamanho != null ? ` · ${fmtTamanho(a.tamanho)}` : ""}
          {a.solicitacaoId ? ` · solicitação #${a.solicitacaoId}` : ""}
          {a.protocoloId ? ` · protocolo #${a.protocoloId}` : ""}
          {" · "}
          {a.criadoPor?.nome ?? "—"} em {fmtDataHora(a.createdAt)}
          {!a.vigente && a.substituidoEm ? ` · substituído em ${fmtDataHora(a.substituidoEm)}` : ""}
        </div>
      </div>
      <ExternalLink className="w-3 h-3 text-[var(--text-muted)] flex-shrink-0" />
    </a>
  )
}

/**
 * Anexos do DOCUMENTO (sem stepInstanceId) ou da ETAPA (com). O mesmo arquivo
 * nunca aparece duas vezes: a unicidade é do banco, não da tela.
 */
export function AbaAnexosDocumentais({
  documentoId,
  stepInstanceId,
  podeAnexar = false,
  tipoPadrao = "OUTRO",
}: {
  documentoId: number | null
  stepInstanceId?: number | null
  podeAnexar?: boolean
  tipoPadrao?: string
}) {
  const url = documentoId
    ? `/api/documentos/${documentoId}/arquivos${stepInstanceId ? `?stepInstanceId=${stepInstanceId}` : ""}`
    : null
  const req = useApi<{ arquivos?: ArquivoDocumentoView[] }>(url)
  const arquivos = useMemo(() => req.dados?.arquivos ?? [], [req.dados])
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Agrupamento por ORIGEM/etapa — a aba do documento mostra de onde cada arquivo veio.
  const grupos = useMemo(() => {
    const m = new Map<string, ArquivoDocumentoView[]>()
    for (const a of arquivos) {
      const chave = LABEL_ORIGEM[a.origem] ?? a.origem
      const lista = m.get(chave) ?? []
      lista.push(a)
      m.set(chave, lista)
    }
    return [...m.entries()]
  }, [arquivos])

  const enviar = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setEnviando(true)
    setErro(null)
    try {
      const subidos = await uploadFiles(Array.from(files), { prefix: `documentos/${documentoId}/anexos` })
      for (const f of subidos) {
        const res = await fetch(`/api/documentos/${documentoId}/arquivos`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({
            url: f.url, nome: f.name, mimeType: f.type, tamanho: f.size,
            tipo: tipoPadrao, stepInstanceId: stepInstanceId ?? null,
          }),
        })
        if (!res.ok) {
          setErro(res.status === 403 ? "Você não tem permissão para anexar." : "Não foi possível vincular o arquivo.")
          return
        }
      }
      void req.recarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar o arquivo.")
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  if (req.carregando) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {arquivos.length === 0 ? (
        <Vazio
          titulo="Nenhum anexo"
          descricao={
            stepInstanceId
              ? "Os arquivos enviados nesta etapa aparecem aqui — o requerimento anexado ao solicitar a certidão, comprovantes de contato e o que mais for anexado."
              : "Os arquivos de toda a operação deste documento aparecem aqui, agrupados pela origem."
          }
        />
      ) : (
        grupos.map(([origem, lista]) => (
          <div key={origem}>
            <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-secondary)] mb-1.5">
              {origem} · {lista.length}
            </div>
            <div className="space-y-1.5">
              {lista.map((a) => (
                <LinhaArquivo key={a.id} arquivo={a} />
              ))}
            </div>
          </div>
        ))
      )}

      {podeAnexar && (
        <>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void enviar(e.target.files)} />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className="w-full px-3 py-2.5 bg-[var(--surface-overlay)] border border-dashed border-[var(--border-default)] rounded-md text-left hover:bg-[var(--surface-secondary)] transition-colors disabled:opacity-50"
          >
            <div className="flex items-center gap-2.5">
              {enviando ? <Loader2 className="w-4 h-4 animate-spin text-white/60" /> : <Upload className="w-4 h-4 text-white/60" />}
              <span className="text-[12px] text-white/85 font-medium">{enviando ? "Enviando…" : "Anexar arquivo"}</span>
            </div>
          </button>
        </>
      )}
      {erro && (
        <div className="text-[11px] text-[#f87171] flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          {erro}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// OBSERVAÇÕES
// ════════════════════════════════════════════════════════════════════════════

export function AbaObservacoesDocumentais({
  documentoId,
  stepInstanceId,
  podeRegistrar = false,
}: {
  documentoId: number | null
  stepInstanceId?: number | null
  podeRegistrar?: boolean
}) {
  const url = documentoId
    ? `/api/documentos/${documentoId}/observacoes${stepInstanceId ? `?stepInstanceId=${stepInstanceId}` : ""}`
    : null
  const req = useApi<{ observacoes?: ObservacaoView[] }>(url)
  const observacoes = req.dados?.observacoes ?? []
  const [texto, setTexto] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const registrar = async () => {
    const t = texto.trim()
    if (!t || salvando) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/documentos/${documentoId}/observacoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ texto: t, stepInstanceId: stepInstanceId ?? null }),
      })
      if (!res.ok) {
        setErro(res.status === 403 ? "Você não tem permissão para registrar observação." : "Não foi possível registrar agora.")
        return
      }
      setTexto("")
      void req.recarregar()
    } catch {
      setErro("Não foi possível registrar agora.")
    } finally {
      setSalvando(false)
    }
  }

  if (req.carregando) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {observacoes.length === 0 ? (
        <Vazio
          titulo="Nenhuma observação"
          descricao="As observações registradas ao solicitar a certidão e ao acompanhar a operação aparecem aqui, com autor e data. Nenhuma sobrescreve a anterior."
        />
      ) : (
        <div className="space-y-1.5">
          {observacoes.map((o) => (
            <div key={o.id} className="rounded-md border border-[var(--border-default)] bg-[var(--surface-overlay)] p-2.5">
              <div className="text-[10px] text-[var(--text-secondary)] mb-0.5 flex items-center gap-1.5">
                <StickyNote className="w-3 h-3" />
                {o.criadoPor?.nome ?? "—"} · {fmtDataHora(o.createdAt)}
              </div>
              <div className="text-[12.5px] text-white/85 leading-snug whitespace-pre-wrap">{o.texto}</div>
            </div>
          ))}
        </div>
      )}

      {podeRegistrar && (
        <div>
          <textarea
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Anote algo relevante sobre este documento…"
            className="w-full px-3 py-2 bg-[var(--surface-overlay)] border border-[var(--border-default)] rounded-md text-sm text-[#fff] placeholder-white/30 focus:outline-none focus:border-[#7dd3fc]/50 resize-none"
          />
          <div className="flex justify-end mt-1.5">
            <button
              onClick={registrar}
              disabled={salvando || !texto.trim()}
              className="px-3 py-1.5 text-[11.5px] font-semibold bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] disabled:opacity-50 text-[#fff] rounded-md inline-flex items-center gap-1.5"
            >
              {salvando && <Loader2 className="w-3 h-3 animate-spin" />}
              Adicionar observação
            </button>
          </div>
        </div>
      )}
      {erro && <div className="text-[11px] text-[#f87171]">{erro}</div>}
    </div>
  )
}
