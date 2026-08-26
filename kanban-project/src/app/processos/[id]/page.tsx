// ============================================================================
// PROCESSO COMO PÁGINA — /processos/[id]
//
// A tela de processo existia só como MODAL sobre o Kanban. O mockup aprovado a
// mostra como página, com trilha "Processos › Nome · País". Esta rota é
// ADITIVA: o modal continua funcionando exatamente como antes, e quem chega
// por link direto (a tabela da Home, por exemplo) ganha uma URL de verdade —
// com botão voltar, histórico e possibilidade de compartilhar.
//
// O CONTEÚDO é o mesmo componente. Duplicar a tela para ter duas aparências
// seria criar uma segunda verdade sobre o processo.
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronRight, Loader2 } from "lucide-react"
import { ProcessoDetailsModal } from "@/src/components/kanban/atividade-details-modal"
import type { Processo } from "@/src/types/kanban"

export default function ProcessoPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = Number(params?.id)

  // "id inválido" não é um estado que se descobre depois — dá para saber na
  // primeira renderização. Decidir isso num efeito custaria um setState
  // síncrono e uma renderização em cascata.
  const idValido = Number.isFinite(id)
  const [processo, setProcesso] = useState<Processo | null>(null)
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">(
    idValido ? "carregando" : "erro",
  )

  useEffect(() => {
    if (!idValido) return
    const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
    fetch(`/api/processos/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { setProcesso(j.processo ?? j); setEstado("ok") })
      .catch(() => setEstado("erro"))
  }, [id, idValido])

  if (estado === "carregando") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando processo…</span>
      </div>
    )
  }

  if (estado === "erro" || !processo) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-6 py-10">
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center">
          <p className="text-[15px] font-medium text-[var(--text-primary)]">Processo não encontrado</p>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Ele pode ter sido excluído, ou você pode não ter acesso a ele.
          </p>
          <Link href="/kanban" className="mt-4 inline-flex text-[13px] font-medium text-[var(--accent-text)] hover:underline">
            Voltar para Processos
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Trilha — o que a página tem e o modal não: lugar no sistema. */}
      <nav aria-label="Trilha" className="flex items-center gap-1.5 px-6 pt-5 text-[13px]">
        <Link href="/kanban" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          Processos
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden />
        <span className="font-medium text-[var(--text-primary)]">{processo.nome}</span>
        {processo.pais && (
          <>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="capitalize text-[var(--text-secondary)]">{processo.pais}</span>
          </>
        )}
      </nav>

      {/* Mesmo componente do modal. Fechar aqui significa VOLTAR, não sumir. */}
      <ProcessoDetailsModal
        processo={processo}
        isOpen
        onClose={() => router.push("/kanban")}
      />
    </div>
  )
}
