"use client"
// src/components/torre/VincularOrgaoLoteModal.tsx — "Vincular órgão nas N certidões" (faixa Bloqueio) e "Vincular órgão" (barra de lote).
// Campo "Cartório" com busca (mínimo 2 letras) SÓ em órgãos cadastrados (`OrgaoProtocolo`) + a justificativa de 5 letras do modal-padrão.
// O vínculo é da MESMA porta da Operação (POST /api/operacao/tarefas/vincular-orgao-lote); a justificativa vai para o histórico de cada
// tarefa vinculada (POST /api/torre/tarefas/vincular-orgao — só grava a auditoria, depois de conferir o vínculo no banco).
import { useEffect, useState } from "react"
import { api, erroDe, useTorre } from "./torre-base"
import { TarefasModal } from "./TarefasModais"

interface OrgaoBusca { id: number; name: string; nomeFantasia: string | null; city: string | null; state: string | null; origem: "cadastrado" | "cartorio_nacional" }
const rotuloDoOrgao = (o: OrgaoBusca): string => `${o.name}${o.city ? ` — ${o.city}${o.state ? `/${o.state}` : ""}` : ""}`

export function VincularOrgaoLoteModal({ tarefaIds, variante = "certidoes", onFechar, onFeito }: {
  tarefaIds: number[]
  /** "certidoes": o aviso Bloqueio ("…nas N certidões", toast "em N certidões"); "lote": a barra de lote ("Vincular órgão", toast "em N tarefas"). */
  variante?: "certidoes" | "lote"
  onFechar: () => void
  onFeito?: () => void
}) {
  const { avisar, recarregar } = useTorre()
  const [q, setQ] = useState("")
  const [orgaos, setOrgaos] = useState<OrgaoBusca[]>([])
  const [escolhido, setEscolhido] = useState<OrgaoBusca | null>(null)
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    const termo = q.trim()
    if (termo.length < 2 || escolhido) return
    let vivo = true
    const t = setTimeout(() => {
      setBuscando(true)
      void api<{ orgaos: OrgaoBusca[] }>(`/api/operacao/orgaos/busca?q=${encodeURIComponent(termo)}&limit=30`).then((r) => {
        if (!vivo) return
        setBuscando(false)
        setOrgaos(r.ok ? (r.data.orgaos ?? []).filter((o) => o.origem === "cadastrado") : [])
      })
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [q, escolhido])

  const n = tarefaIds.length
  const titulo = variante === "lote" ? "Vincular órgão" : `Vincular órgão nas ${n} certidões`
  return (
    <TarefasModal
      titulo={titulo} texto="Busca só em órgãos cadastrados (mínimo 2 letras)." botao="Vincular" podeConfirmar={!!escolhido} onFechar={onFechar}
      onConfirmar={async (just) => {
        if (!escolhido) return { ok: false, mensagem: "Escolha um órgão da lista." }
        const r = await api<{ ok?: boolean; vinculadas?: number; ignoradas?: Array<{ motivo: string }>; mensagem?: string }>("/api/operacao/tarefas/vincular-orgao-lote", "POST", { tarefaIds, orgaoId: escolhido.id })
        if (!r.ok || !r.data.ok) return { ok: false, mensagem: r.data.mensagem ?? erroDe(r.data, "Não foi possível vincular.") }
        const feitas = r.data.vinculadas ?? 0
        if (feitas > 0) await api("/api/torre/tarefas/vincular-orgao", "POST", { tarefaIds, orgaoId: escolhido.id, justificativa: just })
        const ign = r.data.ignoradas?.length ?? 0
        avisar(`Órgão vinculado em ${feitas} ${variante === "lote" ? (feitas === 1 ? "tarefa" : "tarefas") : (feitas === 1 ? "certidão" : "certidões")}${ign ? ` · ${ign} não passou(aram): ${r.data.ignoradas![0].motivo}` : ""}`)
        recarregar(); onFeito?.(); onFechar()
        return { ok: true }
      }}
    >
      <label>Cartório
        <input type="text" placeholder="Digite: Caxias…" value={escolhido ? rotuloDoOrgao(escolhido) : q} aria-label="Cartório" autoFocus
          onChange={(e) => { setEscolhido(null); setQ(e.target.value) }} />
      </label>
      {!escolhido && q.trim().length >= 2 && (
        <div className="tf-sug" role="listbox" aria-label="Órgãos cadastrados">
          {orgaos.length === 0 && <span className="tf-peq" style={{ padding: "6px 10px" }}>{buscando ? "Buscando…" : "Nenhum órgão cadastrado encontrado"}</span>}
          {orgaos.map((o) => <button key={o.id} type="button" role="option" aria-selected={false} onClick={() => { setEscolhido(o); setOrgaos([]) }}>{rotuloDoOrgao(o)}</button>)}
        </div>
      )}
    </TarefasModal>
  )
}
