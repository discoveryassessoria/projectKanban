// src/components/kanban/workflow/AndamentoEtapa.tsx
//
// HISTÓRICO DE CONTATOS DA ETAPA — o bloco operacional que toda etapa tem.
//
// Compartilhado pelo EDITOR PADRÃO e pelos editores específicos que precisam do
// mesmo acompanhamento (hoje, "Aguardar retorno do cartório"). Um bloco só, num
// arquivo só — não existe uma segunda implementação de "registrar contato".
//
// Anexos e observações NÃO estão aqui: são registro do DOCUMENTO e têm os
// componentes canônicos em `documento/AbasDocumentais` — os mesmos que as abas
// Anexos e Observações usam, para que a etapa e o documento leiam o mesmo dado.
//
// PERSISTÊNCIA: tudo passa pela rota de ANDAMENTO
// (POST .../workflow/steps/{stepId}/andamento), que é transacional, append-only e
// idempotente. Este arquivo NÃO decide o que pode ser feito: as ações vêm do
// servidor em `acoesPermitidas`.

"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { Loader2, MessageCircle, ExternalLink } from "lucide-react"
import {
  CANAIS_CONTATO,
  RESULTADOS_CONTATO,
  type CanalContato,
  type ResultadoContato,
} from "@/src/lib/process-stage/andamento-etapa"

// ── Vocabulário de tela (rótulos), separado do vocabulário de domínio ────────

export const LABEL_CANAL: Record<CanalContato, string> = {
  LIGACAO: "Ligação",
  EMAIL: "E-mail",
  WHATSAPP: "WhatsApp",
  PRESENCIAL: "Presencial",
  PORTAL: "Portal / sistema",
  CORREIOS: "Correios",
  OUTRO: "Outro",
}

export const LABEL_RESULTADO: Record<ResultadoContato, string> = {
  SEM_RESPOSTA: "Sem resposta",
  EM_ANALISE: "Em análise",
  PRAZO_INFORMADO: "Prazo informado",
  EXIGENCIA: "Exigência",
  PRONTO_PARA_RETIRADA: "Pronto para retirada",
  RETORNO_RECEBIDO: "Retorno recebido",
  OUTRO: "Outro",
}

const PILL_RESULTADO: Record<ResultadoContato, string> = {
  SEM_RESPOSTA: "bg-[#20262e] text-white/70 border-white/15",
  EM_ANALISE: "bg-[#7dd3fc]/20 text-[#7dd3fc] border-[#7dd3fc]/30",
  PRAZO_INFORMADO: "bg-[#d2a948]/20 text-[#d2a948] border-[#d2a948]/30",
  EXIGENCIA: "bg-[#f87171]/20 text-[#f87171] border-[#f87171]/30",
  PRONTO_PARA_RETIRADA: "bg-[#4ade80]/20 text-[#4ade80] border-[#4ade80]/30",
  RETORNO_RECEBIDO: "bg-[#4ade80]/20 text-[#4ade80] border-[#4ade80]/30",
  OUTRO: "bg-[#20262e] text-white/70 border-white/15",
}

// Mesmos tokens visuais dos editores existentes — o painel entra no modal aprovado
// sem alterar largura, altura, densidade ou paleta.
export const campoCls =
  "w-full px-3 py-2 bg-[#161b21] border border-white/10 rounded-md text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/30"

export function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] uppercase font-semibold tracking-wider text-white/55 mb-1.5">
      {children}
    </label>
  )
}

export function TituloBloco({
  icone: Icone,
  children,
  contagem,
}: {
  icone: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  contagem?: number
}) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-white/55 flex items-center gap-1.5 mb-2">
      <Icone className="w-3.5 h-3.5" />
      {children}
      {contagem !== undefined && contagem > 0 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#20262e] text-white/70">
          {contagem}
        </span>
      )}
    </div>
  )
}

// ── Tipos que a tela consome (o servidor é quem os produz) ───────────────────

export interface ContatoView {
  chave: string
  registradoEm: string
  ocorridoEm: string
  autorId: number | null
  canal: CanalContato
  destinatario: string | null
  resultado: ResultadoContato
  observacao: string | null
  proximoAcompanhamento: string | null
  anexoUrl: string | null
  anexoNome: string | null
}

export interface AndamentoView {
  prazoEstimadoDias: number | null
  previsaoRetorno: string | null
  proximoAcompanhamento: string | null
  destinatario: string | null
  canalPreferencial: CanalContato | null
  semRetornoDesde: string | null
  previsaoEfetiva: string | null
  contatos: ContatoView[]
}

export const ANDAMENTO_VIEW_VAZIO: AndamentoView = {
  prazoEstimadoDias: null,
  previsaoRetorno: null,
  proximoAcompanhamento: null,
  destinatario: null,
  canalPreferencial: null,
  semRetornoDesde: null,
  previsaoEfetiva: null,
  contatos: [],
}

export interface UsuarioResumo {
  id: number
  nome: string
}

// ── Traduções de erro: código do domínio → frase operacional ─────────────────
//
// O usuário nunca lê nome de model, de coluna nem "não implementado". Cada código
// que o backend pode devolver tem UMA frase, e códigos desconhecidos caem numa
// frase neutra em vez de vazar o payload.

const MENSAGEM_DO_ERRO: Record<string, string> = {
  STEP_NOT_FOUND: "Esta etapa não existe mais. Feche e abra o documento novamente.",
  STEP_NOT_AVAILABLE: "Esta etapa não aceita esta ação no estado atual.",
  EDITOR_CONFIGURATION_INVALID: "A configuração desta etapa está inconsistente. Avise a equipe responsável.",
  PROTOCOL_NOT_FOUND: "O protocolo da solicitação não foi encontrado.",
  PERMISSION_REQUIRED: "Você não tem permissão para esta ação.",
  CONCURRENT_UPDATE: "Outra pessoa alterou esta etapa enquanto você editava. Recarregue para ver o que mudou.",
  VALIDATION_ERROR: "Confira os dados informados e tente de novo.",
  INTERNAL_ERROR: "Não foi possível concluir a operação agora. Tente novamente.",
}

export function mensagemDoErro(codigo: string | null | undefined): string {
  if (!codigo) return MENSAGEM_DO_ERRO.INTERNAL_ERROR
  return MENSAGEM_DO_ERRO[codigo.split(":")[0]] ?? MENSAGEM_DO_ERRO.INTERNAL_ERROR
}

// ── Canal único de gravação do andamento ─────────────────────────────────────

export interface EntradaAndamentoRequisicao {
  campos?: Record<string, unknown>
  contato?: Record<string, unknown>
}

/**
 * Grava andamento. Uma requisição por ação — e a MESMA ação reenviada (duplo
 * clique, retry) chega com a mesma chave de idempotência e não duplica nada.
 */
export function useAndamento(documentoId: number, stepId: number, lockVersion: number | null) {
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const emVoo = useRef(false)

  const registrar = useCallback(
    async (entrada: EntradaAndamentoRequisicao): Promise<boolean> => {
      // TRAVA DE DUPLO CLIQUE no cliente. A idempotência do servidor é a garantia
      // real; esta trava evita a segunda requisição sair.
      if (emVoo.current) return false
      emVoo.current = true
      setSalvando(true)
      setErro(null)
      try {
        const res = await fetch(`/api/documentos/${documentoId}/workflow/steps/${stepId}/andamento`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
          },
          body: JSON.stringify({ ...entrada, ...(lockVersion !== null ? { lockVersion } : {}) }),
        })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          setErro(mensagemDoErro(json.error))
          return false
        }
        return true
      } catch {
        setErro(mensagemDoErro("INTERNAL_ERROR"))
        return false
      } finally {
        emVoo.current = false
        setSalvando(false)
      }
    },
    [documentoId, stepId, lockVersion],
  )

  return { registrar, salvando, erro, limparErro: () => setErro(null) }
}

// ── Formatação ───────────────────────────────────────────────────────────────

function fmtDataHora(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export function fmtData(iso: string | null): string {
  if (!iso) return "—"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return "—"
  return `${m[3]}/${m[2]}/${m[1]}`
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

function agoraLocalIso(): string {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

function nomeAutor(autorId: number | null, usuarios: UsuarioResumo[]): string {
  if (autorId == null) return "—"
  return usuarios.find((u) => u.id === autorId)?.nome ?? `Usuário ${autorId}`
}

// ── BLOCO: histórico de contatos ─────────────────────────────────────────────

export function BlocoContatos({
  contatos,
  usuarios,
  podeRegistrar,
  onRegistrar,
  salvando,
}: {
  contatos: ContatoView[]
  usuarios: UsuarioResumo[]
  podeRegistrar: boolean
  onRegistrar: (contato: Record<string, unknown>) => Promise<boolean>
  salvando: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [ocorridoEm, setOcorridoEm] = useState(agoraLocalIso())
  const [canal, setCanal] = useState<CanalContato>("LIGACAO")
  const [destinatario, setDestinatario] = useState("")
  const [resultado, setResultado] = useState<ResultadoContato>("SEM_RESPOSTA")
  const [observacao, setObservacao] = useState("")
  const [proximo, setProximo] = useState("")

  // Ordem de leitura: mais recente primeiro (o servidor guarda cronológico).
  const emOrdem = useMemo(() => [...contatos].reverse(), [contatos])

  const enviar = async () => {
    const ok = await onRegistrar({
      ocorridoEm: new Date(ocorridoEm).toISOString(),
      canal,
      destinatario: destinatario.trim() || null,
      resultado,
      observacao: observacao.trim() || null,
      proximoAcompanhamento: proximo || null,
      // Chave derivada do CONTEÚDO: reenviar o mesmo contato não cria um segundo.
      chaveIdempotencia: `${ocorridoEm}|${canal}|${resultado}|${observacao.trim()}`,
    })
    if (ok) {
      setAberto(false)
      setObservacao("")
      setDestinatario("")
      setProximo("")
      setResultado("SEM_RESPOSTA")
      setOcorridoEm(agoraLocalIso())
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <TituloBloco icone={MessageCircle} contagem={contatos.length}>
          Histórico de contatos
        </TituloBloco>
        {podeRegistrar && !aberto && (
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="mb-2 px-2.5 py-1 text-[11px] font-semibold bg-[#20262e] hover:bg-[#252c35] text-white/85 rounded"
          >
            + Registrar contato
          </button>
        )}
      </div>

      {emOrdem.length === 0 ? (
        <div className="px-3 py-4 rounded-md bg-[#161b21] border border-dashed border-white/15 text-center">
          <div className="text-[11.5px] text-white/55 italic">Nenhum contato registrado ainda.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {emOrdem.map((c) => (
            <div key={c.chave} className="rounded-md border border-white/10 bg-[#161b21] p-2.5">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded border bg-[#7dd3fc]/15 text-[#7dd3fc] border-[#7dd3fc]/25">
                  {LABEL_CANAL[c.canal]}
                </span>
                <span
                  className={`text-[10.5px] font-semibold px-2 py-0.5 rounded border ${PILL_RESULTADO[c.resultado]}`}
                >
                  {LABEL_RESULTADO[c.resultado]}
                </span>
                <span className="text-[10.5px] text-white/60 font-mono">{fmtDataHora(c.ocorridoEm)}</span>
                <span className="text-[10px] text-white/40">por {nomeAutor(c.autorId, usuarios)}</span>
              </div>
              {c.destinatario && (
                <div className="text-[11px] text-white/60 mb-0.5">Com: {c.destinatario}</div>
              )}
              {c.observacao && (
                <div className="text-[12.5px] text-white/85 leading-snug whitespace-pre-wrap">{c.observacao}</div>
              )}
              {c.proximoAcompanhamento && (
                <div className="text-[10.5px] text-[#d2a948] mt-1">
                  Próximo acompanhamento: {fmtData(c.proximoAcompanhamento)}
                </div>
              )}
              {c.anexoUrl && (
                <a
                  href={c.anexoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-[#7dd3fc] hover:underline inline-flex items-center gap-1 mt-1"
                >
                  {c.anexoNome || "anexo"}
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {podeRegistrar && aberto && (
        <div className="mt-2.5 rounded-lg border border-white/10 bg-[#161b21] p-3.5">
          <div className="grid grid-cols-2 gap-3 mb-2.5">
            <div>
              <Rotulo>Quando</Rotulo>
              <input
                type="datetime-local"
                value={ocorridoEm}
                max={agoraLocalIso()}
                onChange={(e) => setOcorridoEm(e.target.value)}
                className={campoCls}
              />
            </div>
            <div>
              <Rotulo>Canal</Rotulo>
              <select value={canal} onChange={(e) => setCanal(e.target.value as CanalContato)} className={campoCls}>
                {CANAIS_CONTATO.map((c) => (
                  <option key={c} value={c} className="bg-[#20262e]">
                    {LABEL_CANAL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Rotulo>Com quem falou</Rotulo>
              <input
                type="text"
                value={destinatario}
                onChange={(e) => setDestinatario(e.target.value)}
                placeholder="Atendente, setor, e-mail…"
                className={campoCls}
              />
            </div>
            <div>
              <Rotulo>Resultado</Rotulo>
              <select
                value={resultado}
                onChange={(e) => setResultado(e.target.value as ResultadoContato)}
                className={campoCls}
              >
                {RESULTADOS_CONTATO.map((r) => (
                  <option key={r} value={r} className="bg-[#20262e]">
                    {LABEL_RESULTADO[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-2.5">
            <Rotulo>O que foi dito</Rotulo>
            <textarea
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: atendente pediu 7 dias úteis; retorna até sexta."
              className={`${campoCls} resize-none`}
            />
          </div>
          <div className="mb-2.5 w-1/2">
            <Rotulo>Próximo acompanhamento</Rotulo>
            <input
              type="date"
              value={proximo}
              min={hoje()}
              onChange={(e) => setProximo(e.target.value)}
              className={campoCls}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="px-3 py-1.5 text-[11.5px] font-semibold text-white/70 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={enviar}
              disabled={salvando}
              className="px-3.5 py-1.5 text-[11.5px] font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md inline-flex items-center gap-1.5"
            >
              {salvando && <Loader2 className="w-3 h-3 animate-spin" />}
              Registrar contato
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
