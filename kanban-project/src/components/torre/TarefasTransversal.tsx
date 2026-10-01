"use client"
// src/components/torre/TarefasTransversal.tsx — o modal "Tarefa transversal" (Torre nova): "Tarefa que não nasce da árvore (ex.: pedir
// procuração, cobrar pagamento)." Campo "Família / processo" com busca ("Digite: Martín…") + a justificativa de 5 letras + "Criar".
// A criação é a MESMA porta da tarefa transversal oficial (POST /api/processos/{id}/tarefas-transversais): ela exige a necessidade a
// atender e a operação oficial referenciada (fase + ação do catálogo) — por isso, escolhida a família, o modal pede esses três campos.
// A justificativa vai como o motivo da tarefa. Nada de tarefa solta: sem a operação oficial a porta recusa e o modal mostra o motivo.
import { useEffect, useMemo, useState } from "react"
import { semAcento } from "@/src/components/operacao/operacao-v3-derivacoes"
import { api, erroDe } from "./torre-base"
import { TarefasModal } from "./TarefasModais"

interface Opcao { id: number; rotulo: string }
interface Necessidade { id: number; pessoaId: number | null; label: string }
interface FaseAcoes { faseCode: string; faseLabel: string; acoes: Array<{ stepKey: string; title: string }> }

export function TarefasTransversal({ opcoes, inicial, onFechar, onCriada }: { opcoes: Opcao[]; inicial: number | null; onFechar: () => void; onCriada: () => void }) {
  const inicialOpcao = opcoes.find((o) => o.id === inicial) ?? null
  const [texto, setTexto] = useState(inicialOpcao?.rotulo ?? "")
  const [escolhido, setEscolhido] = useState<Opcao | null>(inicialOpcao)
  const [necessidades, setNecessidades] = useState<Necessidade[]>([])
  const [fases, setFases] = useState<FaseAcoes[]>([])
  const [necSel, setNecSel] = useState("")
  const [faseRef, setFaseRef] = useState("")
  const [acaoKey, setAcaoKey] = useState("")

  const sugestoes = useMemo(() => {
    const t = semAcento(texto.trim())
    if (escolhido || !t) return []
    return opcoes.filter((o) => semAcento(o.rotulo).includes(t)).slice(0, 8)
  }, [texto, escolhido, opcoes])

  useEffect(() => {
    let vivo = true
    void api<{ fases: FaseAcoes[] }>("/api/tarefas-transversais/acoes").then((r) => { if (vivo && r.ok) setFases(r.data.fases ?? []) })
    return () => { vivo = false }
  }, [])
  useEffect(() => {
    if (!escolhido) return
    let vivo = true
    void api<{ necessidades: Array<{ id: number; pessoaId: number | null; status: string; itemCatalogo?: { name?: string; code?: string } }> }>(`/api/processos/${escolhido.id}/necessidades`).then((r) => {
      if (!vivo) return
      setNecessidades(r.ok ? (r.data.necessidades ?? []).filter((n) => n.status !== "DISPENSADA").map((n) => ({ id: n.id, pessoaId: n.pessoaId ?? null, label: `${n.itemCatalogo?.name ?? n.itemCatalogo?.code ?? "Necessidade"} #${n.id}` })) : [])
    })
    return () => { vivo = false }
  }, [escolhido])

  const acoesDaFase = fases.find((f) => f.faseCode === faseRef)?.acoes ?? []
  const pronto = !!escolhido && !!necSel && !!faseRef && !!acaoKey
  return (
    <TarefasModal
      titulo="Tarefa transversal" texto="Tarefa que não nasce da árvore (ex.: pedir procuração, cobrar pagamento)." botao="Criar" podeConfirmar={pronto} onFechar={onFechar}
      onConfirmar={async (just) => {
        if (!escolhido) return { ok: false, mensagem: "Escolha a família / processo." }
        const nec = necessidades.find((n) => String(n.id) === necSel)
        const r = await api<{ error?: string }>(`/api/processos/${escolhido.id}/tarefas-transversais`, "POST", {
          necessidadeOrigemId: Number(necSel), faseReferenciaCode: faseRef, acaoStepKey: acaoKey, pessoaId: nec?.pessoaId ?? undefined, motivo: just,
        })
        if (!r.ok) return { ok: false, mensagem: erroDe(r.data) }
        onCriada()
        return { ok: true }
      }}
    >
      <label>Família / processo
        <input type="text" placeholder="Digite: Martín…" value={texto} aria-label="Família / processo" autoFocus
          onChange={(e) => { setEscolhido(null); setNecSel(""); setTexto(e.target.value) }} />
      </label>
      {sugestoes.length > 0 && (
        <div className="tf-sug" role="listbox" aria-label="Famílias">
          {sugestoes.map((o) => <button key={o.id} type="button" role="option" aria-selected={false} onClick={() => { setEscolhido(o); setTexto(o.rotulo) }}>{o.rotulo}</button>)}
        </div>
      )}
      {!escolhido && texto.trim() && sugestoes.length === 0 && <span className="tf-peq">Nenhuma família encontrada com esse nome.</span>}
      {escolhido && (
        <>
          <label>Necessidade a atender
            <select value={necSel} onChange={(e) => setNecSel(e.target.value)} aria-label="Necessidade a atender">
              <option value="">{necessidades.length === 0 ? "Nenhuma necessidade ativa neste processo" : "— selecione —"}</option>
              {necessidades.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </label>
          <label>Fase da operação oficial
            <select value={faseRef} onChange={(e) => { setFaseRef(e.target.value); setAcaoKey("") }} aria-label="Fase da operação oficial">
              <option value="">— selecione —</option>
              {fases.map((f) => <option key={f.faseCode} value={f.faseCode}>{f.faseLabel}</option>)}
            </select>
          </label>
          <label>Ação oficial referenciada
            <select value={acaoKey} disabled={!faseRef} onChange={(e) => setAcaoKey(e.target.value)} aria-label="Ação oficial referenciada">
              <option value="">— selecione —</option>
              {acoesDaFase.map((a) => <option key={a.stepKey} value={a.stepKey}>{a.title}</option>)}
            </select>
          </label>
        </>
      )}
    </TarefasModal>
  )
}
