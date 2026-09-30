"use client"
// src/components/torre/novas-da-familia.ts — as tarefas "novas" da família (último aviso CHEGOU_TRABALHO): a MESMA leitura da Operação
// (GET /api/operacao/novas?processo=<id>). O cliente só cruza os ids com as linhas que já tem; id sem linha some sozinho.
import { useEffect, useMemo, useState } from "react"
import { api } from "./torre-base"

export function useNovasDaFamilia(processoId: number | null): Set<number> {
  const [estado, setEstado] = useState<{ processoId: number; ids: number[] } | null>(null)
  useEffect(() => {
    if (processoId == null) return
    let vivo = true
    void api<{ tarefaIds?: number[] }>(`/api/operacao/novas?processo=${processoId}`).then((r) => {
      if (vivo) setEstado({ processoId, ids: r.ok ? r.data.tarefaIds ?? [] : [] })
    })
    return () => { vivo = false }
  }, [processoId])
  return useMemo(() => new Set(estado && estado.processoId === processoId ? estado.ids : []), [estado, processoId])
}
