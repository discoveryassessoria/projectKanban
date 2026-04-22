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
    return d.toLocaleSt
