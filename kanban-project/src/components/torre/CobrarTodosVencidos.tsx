"use client"
// "Cobrar todos os vencidos (N)" — o MESMO botão nas abas Tarefas e Terceiros. N é a contagem do
// predicado `cobravelVencida` sobre a lista carregada (o mesmo do filtro "Cobranças vencidas"), e a
// cobrança reaproveita a rota existente `cobrar-todos-vencidos` (Bloco G3).
import { useState } from "react"
import { RegistrarContatoModal, CANAL_CADASTRADO } from "@/src/components/operacao/RegistrarContatoModal"
import { api, useTorre } from "./torre-base"
import type { LinhaTorre } from "./tipos"

export function CobrarTodosVencidos({ linhas }: { linhas: LinhaTorre[] }) {
  const { avisar, recarregar } = useTorre()
  const [aberto, setAberto] = useState(false)
  const ids = linhas.filter((l) => l.cobravelVencida).map((l) => l.taskId)
  return (
    <>
      <button className="tor-btn pri" onClick={() => (ids.length ? setAberto(true) : avisar("Nenhum acompanhamento vencido de terceiro."))}>
        Cobrar todos os vencidos ({ids.length})
      </button>
      {aberto && (
        <RegistrarContatoModal
          titulo={`Cobrar todos os vencidos (${ids.length})`} subtitulo="Um contato registrado por tarefa vencida, pelo canal cadastrado de cada uma." opcaoCanalCadastrado
          onFechar={() => setAberto(false)}
          onEnviar={async (dados) => {
            const r = await api<{ ok?: boolean; cobradas?: number; ignoradas?: Array<{ motivo: string }>; mensagem?: string }>("/api/operacao/tarefas/cobrar-todos-vencidos", "POST", { ...dados, canal: dados.canal === CANAL_CADASTRADO ? undefined : dados.canal, tarefaIds: ids })
            if (!r.ok || !r.data.ok) return { ok: false, mensagem: r.data.mensagem ?? "Não foi possível cobrar." }
            setAberto(false)
            avisar(`${r.data.cobradas} contato(s) registrado(s).${r.data.ignoradas?.length ? ` (${r.data.ignoradas.length} ignorada(s): ${r.data.ignoradas[0].motivo})` : ""}`)
            recarregar()
            return { ok: true }
          }}
        />
      )}
    </>
  )
}
