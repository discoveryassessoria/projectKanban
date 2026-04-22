// src/components/HistoricoAuditoria.tsx
// ============================================================
// Componente de visualização do histórico/auditoria.
//
// ⚠️ COMPONENTE DORMENTE: não é renderizado em lugar nenhum
// ainda. Para ativar, basta importar e incluir no modal desejado:
//
//   import { HistoricoAuditoria } from "@/src/components/HistoricoAuditoria"
//   ...
//   <HistoricoAuditoria entidade="PAGAMENTO" entidadeId={pagamento.id} />
//
// Depende da API /api/logs existente (já mapeada no sistema).
// Se a API /api/logs ainda não aceitar filtros por entidade/entidadeId,
// ajustar o fetch abaixo ou criar /api/logs/[entidade]/[id].
// ============================================================

"use client"

import { useEffect, useState } from "react"

// ============================================================
// TIPOS
// ============================================================

export type EntidadeAuditoria =
  | "PROCESSO"
  | "TAREFA"
  | "CONTRATANTE"
  | "REQUERENTE"
  | "PESSOA"
  | "DOCUMENTO"
  | "PROTOCOLO"
  | "PAGAMENTO"
  | "FATURA"
  | "RECIBO"
  | "CONTA_PAGAR"
  | "TRANSACAO"
  | "FORNECEDOR"
  | "CATEGORIA_FINANCEIRA"
  | "CONTA_BANCARIA"

interface LogEntry {
  id: number
  acao: string
  entidade: string
  entidadeId: number | null
  descricao: string
  detalhes: Record<string, any> | null
  usuarioId: number | null
  usuario?: { id: number; nome: string; email: string } | null
  criadoEm: string
}

interface HistoricoAuditoriaProps {
  entidade: EntidadeAuditoria
  entidadeId: number
  /** Título exibido no cabeçalho (opcional). Default: "Registro de atividades" */
  titulo?: string
  /** Inicia expandido? Default: false (colapsado) */
  expandidoInicial?: boolean
  /** Classe CSS extra no container */
  className?: string
}

// ============================================================
// HELPERS
// ============================================================

function formatarData(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function iconeAcao(acao: string): string {
  switch (acao) {
    case "criou":
      return "➕"
    case "editou":
      return "✏️"
    case "excluiu":
      return "🗑️"
    case "moveu":
      return "↔️"
    case "concluiu":
      return "✅"
    case "reabriu":
      return "🔄"
    default:
      return "•"
  }
}

// ============================================================
// COMPONENTE
// ============================================================

export function HistoricoAuditoria({
  entidade,
  entidadeId,
  titulo = "Registro de atividades",
  expandidoInicial = false,
  className = "",
}: HistoricoAuditoriaProps) {
  const [expandido, setExpandido] = useState(expandidoInicial)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!expandido) return
    if (logs.length > 0) return // já carregado

    setCarregando(true)
    setErro(null)

    // Tenta a rota genérica /api/logs com filtros.
    // Se o backend usar outra convenção, ajustar aqui.
    const url = `/api/logs?entidade=${encodeURIComponent(
      entidade
    )}&entidadeId=${entidadeId}`

    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("authToken") || ""
        : ""

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((data) => {
        // Aceita tanto { logs: [...] } quanto [...] direto
        const lista: LogEntry[] = Array.isArray(data)
          ? data
          : data.logs || data.itens || []
        setLogs(lista)
      })
      .catch((e) => {
        console.error("[HistoricoAuditoria] erro ao carregar:", e)
        setErro("Não foi possível carregar o histórico.")
      })
      .finally(() => setCarregando(false))
  }, [expandido, entidade, entidadeId, logs.length])

  return (
    <div
      className={`hist-auditoria border rounded-lg overflow-hidden ${className}`}
      style={{ fontSize: "14px" }}
    >
      {/* Cabeçalho clicável */}
      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
      >
        <span className="font-semibold text-gray-700">
          {titulo}
          {logs.length > 0 && (
            <span className="ml-2 inline-block px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-700">
              {logs.length}
            </span>
          )}
        </span>
        <span className="text-gray-500">{expandido ? "▲" : "▼"}</span>
      </button>

      {/* Conteúdo */}
      {expandido && (
        <div className="p-4 bg-white">
          {carregando && (
            <div className="text-gray-500 text-center py-4">
              Carregando...
            </div>
          )}

          {erro && (
            <div className="text-red-600 text-center py-4">{erro}</div>
          )}

          {!carregando && !erro && logs.length === 0 && (
            <div className="text-gray-500 text-center py-4">
              Nenhum registro encontrado.
            </div>
          )}

          {!carregando && !erro && logs.length > 0 && (
            <ul className="space-y-2">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className="flex gap-3 items-start border-b border-gray-100 pb-2 last:border-0"
                >
                  <span className="text-lg">{iconeAcao(log.acao)}</span>
                  <div className="flex-1">
                    <div className="text-gray-800">{log.descricao}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {log.usuario?.nome
                        ? `${log.usuario.nome} · `
                        : log.usuarioId
                        ? `Usuário #${log.usuarioId} · `
                        : "Sistema · "}
                      {formatarData(log.criadoEm)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
