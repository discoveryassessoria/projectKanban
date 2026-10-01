"use client"
// src/components/torre/adiar-acompanhamento.tsx — "Adiar a cobrança" da Torre: o MESMO modal-padrão da aba Tarefas (`ModalDaAcao`, ação
// "adiar": campo "Nova data" + justificativa de 5 letras) sobre a MESMA porta da Operação (POST /api/operacao/tarefas/{id}/adiar-acompanhamento).
// O prazo da tarefa NÃO muda — só a data da próxima cobrança. Este gancho serve às telas que adiam a partir de uma linha (painel do trabalho).
import { useState, type ReactNode } from "react"
import { ModalDaAcao } from "./TarefasModais"
import type { LinhaTorre } from "./tipos"

export function useAdiarAcompanhamento(agora: Date): { abrir: (linha: LinhaTorre) => void; modal: ReactNode } {
  const [linha, setLinha] = useState<LinhaTorre | null>(null)
  const modal = linha == null ? null : <ModalDaAcao acao="adiar" linha={linha} agora={agora} onFechar={() => setLinha(null)} />
  return { abrir: setLinha, modal }
}
