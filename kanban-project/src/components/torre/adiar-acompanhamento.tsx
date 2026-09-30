"use client"
// src/components/torre/adiar-acompanhamento.tsx — "Adiar acompanhamento" da Torre: a MESMA porta e o MESMO modal da Operação
// (`AdiarAcompanhamentoModal` + POST /api/operacao/tarefas/{id}/adiar-acompanhamento). O prazo da tarefa não muda.
import { useState, type ReactNode } from "react"
import { AdiarAcompanhamentoModal } from "@/src/components/operacao/AdiarAcompanhamentoModal"
import { api, useTorre } from "./torre-base"

export function useAdiarAcompanhamento(): { abrir: (taskId: number) => void; modal: ReactNode } {
  const { avisar, recarregar } = useTorre()
  const [taskId, setTaskId] = useState<number | null>(null)
  const modal = taskId == null ? null : (
    <AdiarAcompanhamentoModal
      onFechar={() => setTaskId(null)}
      onEnviar={async (dados) => {
        const r = await api<{ ok?: boolean; mensagem?: string }>(`/api/operacao/tarefas/${taskId}/adiar-acompanhamento`, "POST", dados)
        if (!r.ok || !r.data.ok) return { ok: false, mensagem: r.data.mensagem }
        setTaskId(null)
        avisar(`Acompanhamento adiado ${dados.dias} dia(s). O prazo da tarefa não muda.`)
        recarregar()
        return { ok: true }
      }}
    />
  )
  return { abrir: setTaskId, modal }
}
