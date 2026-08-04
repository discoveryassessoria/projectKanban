// src/components/kanban/documento/AbasDocumentais.tsx
//
// ABAS DOCUMENTAIS — Protocolo, Anexos e Observações do documento.
//
// Substituem os três textos de pendência que estavam em produção ("Requer modelo
// WorkflowStepAttachment no schema.", "Requer modelo WorkflowStepComment...", "O
// modelo Protocolo existe, mas está vinculado a Processo..."). Nenhuma delas
// pede que o operador digite de novo o que já preencheu em "Solicitar certidão":
// todas LEEM o registro canônico (SolicitacaoDocumento / Protocolo /
// DocumentoArquivo / DocumentoObservacao).
//
// A aba de ETAPA e a aba de DOCUMENTO são a MESMA consulta com escopo diferente —
// o arquivo aparece nas duas por referência, com um único binário no R2.

"use client"

import { useMemo, useRef, useState } from "react"
import { useApi } from "@/src/lib/dados"
import {
  Paperclip, ExternalLink, Loader2, Upload, StickyNote, FileText, Hash, AlertTriangle,
} from "lucide-react"
import { uploadFiles } from "@/src/lib/storage"

// ── Contrato de leitura (espelho dos DTOs do serviço) ───────────────────────

export interface ArquivoDocumentoView {
  id: number
  url: string
  nome: string
  mimeType: string | null
  tamanho: number | null
  tipo: string
  origem: "SOLICITACAO" | "ETAPA" | "DOCUMENTO"
  stepInstanceId: number | null
  solicitacaoId: number | null
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

const LABEL_STATUS_SOLICITACAO: Record<string, string> = {
  AGUARDANDO_PROTOCOLO: "Aguardando protocolo",
  PROTOCOLADA: "Protocolada",
  RESPONDIDA: "Respondida",
  CANCELADA: "Cancelada",
}

const PILL_STATUS: Record<string, string> = {
  AGUARDANDO_PROTOCOLO: "bg-[#d2a948]/20 text-[#d2a948] border-[#d2a948]/40",
  PROTOCOLADA: "bg-[#4ade80]/20 text-[#4ade80] border-[#4ade80]/40",
  RESPONDIDA: "bg-[#7dd3fc]/20 text-[#7dd3fc] border-[#7dd3fc]/40",
  CANCELADA: "bg-[#20262e] text-white/50 border-white/15",
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

function Campo({ label, valor, mono }: { label: string; valor: string | null; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">{label}</div>
      <div className={`text-[12px] ${mono ? "font-mono" : ""} ${valor ? "text-white/90" : "text-white/30 italic"}`}>
        {valor || "—"}
      </div>
    </div>
  )
}

function Vazio({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="py-10 text-center">
      <div className="text-[13px] font-semibold text-white/70 mb-1">{titulo}</div>
      <div className="text-[12px] text-white/45 max-w-md mx-auto leading-relaxed">{descricao}</div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ABA PROTOCOLO DO DOCUMENTO
// ════════════════════════════════════════════════════════════════════════════

export function AbaProtocoloDocumento({ documentoId }: { documentoId: number | null }) {
  const req = useApi<{ resumo?: { solicitacoes: SolicitacaoView[]; vigenteId: number | null } }>(
    documentoId ? `/api/documentos/${documentoId}/solicitacoes` : null,
  )
  const solicitacoes = req.dados?.resumo?.solicitacoes ?? []
  const vigenteId = req.dados?.resumo?.vigenteId ?? null

  if (req.carregando) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-white/50" />
      </div>
    )
  }

  if (req.erro) {
    return (
      <div className="py-10 text-center text-[12px] text-[#f87171]">
        Não foi possível carregar o protocolo agora.
        <button onClick={() => void req.recarregar()} className="ml-2 underline hover:text-white">
          Tentar novamente
        </button>
      </div>
    )
  }

  if (solicitacoes.length === 0 || documentoId == null) {
    return (
      <Vazio
        titulo="Nenhuma solicitação registrada"
        descricao="Quando a etapa “Solicitar certidão” for concluída, o canal, o destinatário, o protocolo e o requerimento enviado aparecem aqui automaticamente — sem precisar digitar de novo."
      />
    )
  }

  return (
    <div className="space-y-4">
      {solicitacoes.map((s) => (
        <CartaoSolicitacao
          key={s.id}
          solicitacao={s}
          documentoId={documentoId}
          vigente={s.id === vigenteId}
          onMudou={() => void req.recarregar()}
        />
      ))}
    </div>
  )
}

function CartaoSolicitacao({
  solicitacao: s,
  documentoId,
  vigente,
  onMudou,
}: {
  solicitacao: SolicitacaoView
  documentoId: number
  vigente: boolean
  onMudou: () => void
}) {
  const [informando, setInformando] = useState(false)
  const [numero, setNumero] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const semProtocolo = s.protocolos.length === 0

  const informar = async () => {
    if (!numero.trim() || salvando) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/documentos/${documentoId}/solicitacoes/${s.id}/protocolos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ numeroProtocolo: numero.trim() }),
      })
      if (!res.ok) {
        setErro(res.status === 403 ? "Você não tem permissão para registrar protocolo." : "Não foi possível registrar agora.")
        return
      }
      setNumero("")
      setInformando(false)
      onMudou()
    } catch {
      setErro("Não foi possível registrar agora.")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className={`rounded-lg border bg-[#161b21] overflow-hidden ${vigente ? "border-[#7dd3fc]/30" : "border-white/10"}`}>
      <div className="px-3.5 py-2 bg-[#1b2027] border-b border-white/10 flex items-center gap-2 flex-wrap">
        <FileText className="w-3.5 h-3.5 text-[#7dd3fc]" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">
          Solicitação · {s.canalLabel ?? s.canal}
        </span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PILL_STATUS[s.status] ?? PILL_STATUS.CANCELADA}`}>
          {LABEL_STATUS_SOLICITACAO[s.status] ?? s.status}
        </span>
        {vigente && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-[#7dd3fc]/15 text-[#7dd3fc] border-[#7dd3fc]/30">
            vigente
          </span>
        )}
        <span className="ml-auto text-[10.5px] text-white/45 font-mono">{fmtDataHora(s.dataEnvio)}</span>
      </div>

      <div className="p-3.5 grid grid-cols-3 gap-x-4 gap-y-2.5">
        <Campo label="Cartório / destinatário" valor={s.destinatarioNome} />
        <Campo label="Canal" valor={s.canalLabel ?? s.canal} />
        <Campo label="Atendente" valor={s.atendente} />
        <Campo label="Data de envio" valor={fmtDataHora(s.dataEnvio)} />
        <Campo
          label="Prazo esperado"
          valor={s.prazoEsperadoDias != null ? `${s.prazoEsperadoDias} dia(s)` : null}
        />
        <Campo label="Registrado por" valor={s.criadoPor?.nome ?? null} />
        {s.codigoRastreio && <Campo label="Código de rastreio" valor={s.codigoRastreio} mono />}
        {s.custoPago != null && (
          <Campo
            label="Custo pago"
            valor={`R$ ${s.custoPago.toFixed(2).replace(".", ",")}${s.formaPagamento ? ` · ${s.formaPagamento}` : ""}`}
          />
        )}
        {s.observacao && (
          <div className="col-span-3">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-white/45 mb-0.5">Observação do envio</div>
            <div className="text-[12px] text-white/80 italic">&ldquo;{s.observacao}&rdquo;</div>
          </div>
        )}
      </div>

      {/* ── PROTOCOLOS — histórico; o mais recente é o vigente ─────────── */}
      <div className="px-3.5 pb-3.5">
        <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1.5 flex items-center gap-1.5">
          <Hash className="w-3 h-3" />
          Protocolo
        </div>

        {semProtocolo ? (
          <div className="rounded-md border border-dashed border-white/15 bg-[#12161c] px-3 py-2.5">
            <div className="text-[11.5px] text-white/60">
              {s.protocoloObrigatorio
                ? "Este canal devolve protocolo no envio, mas nenhum número foi registrado."
                : "Este canal pode não devolver protocolo no envio. Registre o número quando o cartório informar."}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {s.protocolos.map((p) => (
              <div
                key={p.id}
                className={`rounded-md border px-3 py-2 ${p.vigente ? "border-[#4ade80]/30 bg-[#4ade80]/5" : "border-white/10 bg-[#12161c]"}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12.5px] font-mono text-white/90">{p.numero ?? "—"}</span>
                  {p.vigente && (
                    <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded bg-[#4ade80]/20 text-[#4ade80]">
                      vigente
                    </span>
                  )}
                  <span className="text-[10.5px] text-white/45">
                    informado em {fmtDataHora(p.informadoEm)}
                    {p.informadoPor ? ` por ${p.informadoPor.nome}` : ""}
                  </span>
                </div>
                {p.observacoes && <div className="text-[11px] text-white/60 mt-0.5">{p.observacoes}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Complementar o protocolo depois — atualiza a solicitação existente,
            acrescenta ao histórico e nunca cria uma segunda solicitação. */}
        {!informando ? (
          <button
            onClick={() => setInformando(true)}
            className="mt-2 px-2.5 py-1 text-[11px] font-semibold bg-[#20262e] hover:bg-[#252c35] text-white/85 rounded"
          >
            {semProtocolo ? "+ Informar protocolo" : "+ Informar novo protocolo"}
          </button>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="Número do protocolo"
              autoFocus
              className="flex-1 px-2.5 py-1.5 bg-[#12161c] border border-white/10 rounded text-[12px] text-white placeholder-white/30 focus:outline-none focus:border-[#7dd3fc]/50 font-mono"
            />
            <button
              onClick={informar}
              disabled={salvando || !numero.trim()}
              className="px-3 py-1.5 text-[11px] font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 text-white rounded inline-flex items-center gap-1.5"
            >
              {salvando && <Loader2 className="w-3 h-3 animate-spin" />}
              Registrar
            </button>
            <button
              onClick={() => { setInformando(false); setNumero(""); setErro(null) }}
              className="px-2 py-1.5 text-[11px] text-white/60 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        )}
        {erro && <div className="mt-1.5 text-[11px] text-[#f87171]">{erro}</div>}
      </div>

      {/* ── ARQUIVOS DA SOLICITAÇÃO ─────────────────────────────────────── */}
      {s.arquivos.length > 0 && (
        <div className="px-3.5 pb-3.5">
          <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1.5 flex items-center gap-1.5">
            <Paperclip className="w-3 h-3" />
            Requerimento e comprovantes
          </div>
          <div className="space-y-1.5">
            {s.arquivos.map((a) => (
              <LinhaArquivo key={a.id} arquivo={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ANEXOS (documento e etapa — mesma consulta, escopo diferente)
// ════════════════════════════════════════════════════════════════════════════

function LinhaArquivo({ arquivo: a }: { arquivo: ArquivoDocumentoView }) {
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 rounded-md border border-white/10 bg-[#12161c] px-2.5 py-2 hover:bg-[#1b2027] transition-colors"
    >
      <Paperclip className="w-3.5 h-3.5 text-white/50 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-white/90 truncate">{a.nome}</div>
        <div className="text-[10px] text-white/45">
          {LABEL_TIPO_ARQUIVO[a.tipo] ?? a.tipo}
          {" · "}
          {LABEL_ORIGEM[a.origem] ?? a.origem}
          {a.tamanho != null ? ` · ${fmtTamanho(a.tamanho)}` : ""}
          {" · "}
          {a.criadoPor?.nome ?? "—"} em {fmtDataHora(a.createdAt)}
        </div>
      </div>
      <ExternalLink className="w-3 h-3 text-white/40 flex-shrink-0" />
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
        <Loader2 className="w-5 h-5 animate-spin text-white/50" />
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
            <div className="text-[10px] uppercase font-bold tracking-wider text-white/45 mb-1.5">
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
            className="w-full px-3 py-2.5 bg-[#161b21] border border-dashed border-white/15 rounded-md text-left hover:bg-[#20262e] transition-colors disabled:opacity-50"
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
        <Loader2 className="w-5 h-5 animate-spin text-white/50" />
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
            <div key={o.id} className="rounded-md border border-white/10 bg-[#161b21] p-2.5">
              <div className="text-[10px] text-white/45 mb-0.5 flex items-center gap-1.5">
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
            className="w-full px-3 py-2 bg-[#161b21] border border-white/10 rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#7dd3fc]/50 resize-none"
          />
          <div className="flex justify-end mt-1.5">
            <button
              onClick={registrar}
              disabled={salvando || !texto.trim()}
              className="px-3 py-1.5 text-[11.5px] font-semibold bg-[#20262e] hover:bg-[#252c35] disabled:opacity-50 text-white rounded-md inline-flex items-center gap-1.5"
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
