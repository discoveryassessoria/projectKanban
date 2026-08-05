"use client"

// AÇÃO CONTEXTUAL "GERAR PROCURAÇÃO" DENTRO DO PROCESSO.
//
// NÃO é um segundo gerador. É a MESMA tela do cadastro do cliente, montada com
// o processo já preenchido — o que muda é só de onde o operador chegou. Se a
// regra de geração mudar, ela muda nos dois lugares porque o componente é um só.
//
// O que o processo acrescenta é a escolha do OUTORGANTE entre os participantes:
// no cadastro do cliente o outorgante é óbvio (é o dono da ficha); aqui um
// processo tem contratantes e requerentes, e quem outorga precisa ser dito.

import { useState } from "react"
import { Stamp } from "lucide-react"
import { DocumentosGeradosTab } from "@/src/components/contratantesComponents/DocumentosGeradosTab"

export interface ParticipanteProcesso {
  id: number
  nome: string
  publicCode?: string | null
}

export interface ProcuracaoDoProcessoProps {
  processoId: number
  processoRotulo: string
  contratantes: ParticipanteProcesso[]
  requerentes: ParticipanteProcesso[]
  podeGerar?: boolean
}

export function ProcuracaoDoProcesso({
  processoId,
  processoRotulo,
  contratantes,
  requerentes,
  podeGerar = true,
}: ProcuracaoDoProcessoProps) {
  const participantes = [
    ...contratantes.map((c) => ({ ...c, papel: "contratante" as const })),
    ...requerentes.map((r) => ({ ...r, papel: "requerente" as const })),
  ]

  const [selecionado, setSelecionado] = useState<string>(
    participantes.length === 1 ? `${participantes[0].papel}:${participantes[0].id}` : "",
  )

  const escolhido = participantes.find((p) => `${p.papel}:${p.id}` === selecionado) ?? null

  return (
    <div className="space-y-4">
      {/* Cor própria na raiz: superfície clara dentro da subárvore que recebe
          `text-white/80` quando `finDark` está ligado (atividade-details-modal).
          Sem isto, qualquer texto sem `text-` explícito aqui sai branco no branco. */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-gray-900 shadow-sm">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Stamp className="h-4 w-4 text-indigo-600" />
          Gerar procuração
        </h3>
        <p className="mb-4 text-xs text-gray-500">
          Mesma geração do cadastro do cliente, já vinculada a {processoRotulo}.
        </p>

        {participantes.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Este processo ainda não tem contratante nem requerente. O outorgante vem do cadastro do
            cliente — vincule um participante ao processo primeiro.
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Outorgante *</label>
            <select
              value={selecionado}
              onChange={(e) => setSelecionado(e.target.value)}
              className="w-full max-w-md rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Selecione quem concede a procuração…</option>
              {participantes.map((p) => (
                <option key={`${p.papel}:${p.id}`} value={`${p.papel}:${p.id}`}>
                  {p.nome} · {p.papel === "contratante" ? "contratante" : "requerente"}
                  {p.publicCode ? ` (${p.publicCode})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {escolhido && (
        <DocumentosGeradosTab
          key={selecionado}
          papel={escolhido.papel}
          clienteId={escolhido.id}
          clienteNome={escolhido.nome}
          processoIdInicial={processoId}
          processos={[{ id: processoId, codigo: processoRotulo, nome: "" }]}
          podeGerar={podeGerar}
        />
      )}
    </div>
  )
}

export default ProcuracaoDoProcesso
