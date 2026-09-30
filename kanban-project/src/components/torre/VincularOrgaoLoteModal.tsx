"use client"
// src/components/torre/VincularOrgaoLoteModal.tsx — "Vincular órgão nas N": escolhe o órgão (busca no cadastro, <select> com o resultado)
// e chama a MESMA porta da Operação (POST /api/operacao/tarefas/vincular-orgao-lote). Só órgãos já cadastrados (`OrgaoProtocolo`):
// a porta recebe `orgaoId` — cartório da base nacional ainda não promovido não vincula por aqui.
import { useEffect, useState } from "react"
import { api, erroDe, Campo, Modal, useTorre } from "./torre-base"

interface OrgaoBusca { id: number; name: string; nomeFantasia: string | null; city: string | null; state: string | null; origem: "cadastrado" | "cartorio_nacional" }

export function VincularOrgaoLoteModal({ tarefaIds, onFechar, onFeito }: { tarefaIds: number[]; onFechar: () => void; onFeito?: () => void }) {
  const { avisar, recarregar } = useTorre()
  const [q, setQ] = useState("")
  const [orgaos, setOrgaos] = useState<OrgaoBusca[]>([])
  const [buscando, setBuscando] = useState(false)
  const [orgaoId, setOrgaoId] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const termo = q.trim()
    if (termo.length < 2) return
    let vivo = true
    const t = setTimeout(() => {
      setBuscando(true)
      void api<{ orgaos: OrgaoBusca[] }>(`/api/operacao/orgaos/busca?q=${encodeURIComponent(termo)}&limit=30`).then((r) => {
        if (!vivo) return
        setBuscando(false)
        if (r.ok) {
          const lista = (r.data.orgaos ?? []).filter((o) => o.origem === "cadastrado")
          setOrgaos(lista); setOrgaoId((atual) => (lista.some((o) => String(o.id) === atual) ? atual : lista[0] ? String(lista[0].id) : ""))
          setErro(null)
        } else setErro(erroDe(r.data, "Não foi possível buscar os órgãos."))
      })
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [q])

  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await api<{ ok?: boolean; vinculadas?: number; ignoradas?: Array<{ motivo: string }>; mensagem?: string }>("/api/operacao/tarefas/vincular-orgao-lote", "POST", { tarefaIds, orgaoId: Number(orgaoId) })
    setEnviando(false)
    if (!r.ok || !r.data.ok) { setErro(r.data.mensagem ?? erroDe(r.data, "Não foi possível vincular.")); return }
    avisar(`Órgão vinculado (${r.data.vinculadas ?? 0} vinculada(s))${r.data.ignoradas?.length ? ` · ${r.data.ignoradas.length} ignorada(s): ${r.data.ignoradas[0].motivo}` : ""}`)
    recarregar(); onFeito?.(); onFechar()
  }

  return (
    <Modal titulo={`Vincular órgão nas ${tarefaIds.length}`} subtitulo="O órgão emissor é gravado no documento e na tarefa de cada certidão." onFechar={onFechar} ocupado={enviando} rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando || !orgaoId}>{enviando ? "Vinculando…" : "Vincular órgão"}</button>
    </>}>
      <Campo rotulo="Buscar órgão (nome, cidade, UF)"><input className="tor-in w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: Santos" autoFocus /></Campo>
      <Campo rotulo="Órgão">
        <select className="tor-in w-full" value={orgaoId} onChange={(e) => setOrgaoId(e.target.value)} disabled={orgaos.length === 0}>
          {orgaos.length === 0 && <option value="">{buscando ? "Buscando…" : q.trim().length < 2 ? "Digite ao menos 2 letras" : "Nenhum órgão cadastrado encontrado"}</option>}
          {orgaos.map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? ` — ${o.city}${o.state ? `/${o.state}` : ""}` : ""}</option>)}
        </select>
      </Campo>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
    </Modal>
  )
}
