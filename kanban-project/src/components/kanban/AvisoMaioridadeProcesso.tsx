"use client"

// Faixa de aviso do processo: quem da árvore completou (ou está para completar)
// 18 anos com o processo em andamento. Derivada na leitura — não há tabela de aviso.

import { formatarDataPura } from "@/src/lib/datas-br"
import { useApi } from "@/src/lib/dados"
import { AlertTriangle } from "lucide-react"

interface Aviso {
  pessoaId: number
  nome: string
  requerente: boolean
  tipo: "COMPLETOU" | "COMPLETARA"
  quando: string
}

const dataBR = (iso: string) => formatarDataPura(iso)

export function AvisoMaioridadeProcesso({ processoId }: { processoId: number }) {
  const { dados } = useApi<{ avisos?: Aviso[] }>(`/api/processos/${processoId}/avisos-maioridade`)
  const avisos = dados?.avisos ?? []
  if (avisos.length === 0) return null
  return (
    <div role="status" className="flex flex-shrink-0 items-start gap-2 border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-6 py-2 text-sm text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <ul className="space-y-0.5">
        {avisos.map((a) => (
          <li key={a.pessoaId}>
            <span className="font-medium">{a.nome}</span>
            {a.requerente ? " (requerente)" : ""}
            {a.tipo === "COMPLETOU"
              ? ` completou 18 anos em ${dataBR(a.quando)}, depois da abertura do processo — confira a documentação exigida de adulto.`
              : ` completa 18 anos em ${dataBR(a.quando)} — a documentação exigida passa a ser a de adulto.`}
          </li>
        ))}
      </ul>
    </div>
  )
}
