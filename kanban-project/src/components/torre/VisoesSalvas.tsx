"use client"
// src/components/torre/VisoesSalvas.tsx — o cartão "VISÃO" + "SALVAS" da aba Tarefas (Torre nova, igual ao protótipo):
// o segmentado com as oito visões e o selo numérico de cada uma, e abaixo as visões SALVAS como chips + "+ Salvar visão atual".
// Guardadas em `RelatorioVisao` (`dominio: torre-tarefas`, sem migration). A visão guarda a PERGUNTA (visão, agrupamento, indicador,
// nacionalidade, busca e TODOS os filtros do painel), nunca o resultado. Clicar num chip APLICA a visão salva (o protótipo só realça).
import { useCallback, useEffect, useState } from "react"
import type { FiltrosTorre } from "@/lib/operacional/torre-filtros"
import { api, erroDe, useTorre } from "./torre-base"
import { TarefasModal } from "./TarefasModais"

export interface SpecDaVisao { visao: string | null; agrupar: string | null; dentro?: string | null; kpi: string | null; pais: string | null; busca: string | null; /** Os filtros do painel (ausente nas visões salvas antes dele = nenhum filtro). */ filtros?: FiltrosTorre | null }
interface Minha { id: number; nome: string; spec: SpecDaVisao; compartilhada: boolean }
interface DaEquipe { id: number; nome: string; spec: SpecDaVisao; donoNome: string }

/** "Da equipe: Priscila · Portugal" — o nome da visão compartilhada pode já trazer o prefixo; nunca duplica. */
export const rotuloDaVisaoDaEquipe = (v: { nome: string; donoNome: string }): string =>
  /^da equipe\b/i.test(v.nome) ? v.nome : `Da equipe: ${v.donoNome} · ${v.nome}`

/** 3.842 — milhar com ponto (sem toLocaleString: nada de formatação dependente do ambiente). */
const fmtN = (n: number | null): string => (n == null ? "…" : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."))

export function VisoesSalvas({ fixas, valor, atual, onEscolherFixa, onAplicar }: {
  /** [chave, rótulo, número] — o número é o tamanho da lista da visão (`null` = ainda carregando). */
  fixas: Array<[string, string, number | null]>
  valor: string
  atual: SpecDaVisao
  onEscolherFixa: (v: string) => void
  onAplicar: (spec: SpecDaVisao, id: string) => void
}) {
  const { avisar } = useTorre()
  const [minhas, setMinhas] = useState<Minha[]>([])
  const [equipe, setEquipe] = useState<DaEquipe[]>([])
  const [salvar, setSalvar] = useState(false)
  const [nome, setNome] = useState("")
  const [comp, setComp] = useState(false)

  const carregar = useCallback(async () => {
    const r = await api<{ minhas: Minha[]; compartilhadas: DaEquipe[] }>("/api/torre/visoes")
    if (r.ok) { setMinhas(r.data.minhas ?? []); setEquipe(r.data.compartilhadas ?? []) }
  }, [])
  useEffect(() => {
    let vivo = true
    void api<{ minhas: Minha[]; compartilhadas: DaEquipe[] }>("/api/torre/visoes").then((r) => { if (vivo && r.ok) { setMinhas(r.data.minhas ?? []); setEquipe(r.data.compartilhadas ?? []) } })
    return () => { vivo = false }
  }, [])

  const escolherSalva = (id: string, spec: SpecDaVisao) => { if (valor === id) onEscolherFixa("todas"); else onAplicar(spec, id) }
  const selecionada = minhas.find((m) => `minha:${m.id}` === valor)

  const alternarComp = async (m: Minha) => {
    const r = await api("/api/torre/visoes", "PATCH", { id: m.id, compartilhada: !m.compartilhada })
    if (r.ok) { avisar(m.compartilhada ? `"${m.nome}" deixou de ser compartilhada.` : `"${m.nome}" agora é compartilhada com a equipe.`); void carregar() } else avisar(erroDe(r.data))
  }
  const excluir = async (m: Minha) => {
    if (typeof window !== "undefined" && !window.confirm(`Excluir a visão "${m.nome}"?`)) return
    const r = await api(`/api/torre/visoes?id=${m.id}`, "DELETE")
    if (r.ok) { avisar(`Visão "${m.nome}" excluída.`); onEscolherFixa("todas"); void carregar() } else avisar(erroDe(r.data))
  }

  return (
    <div className="tf-card">
      <div className="tf-lin">
        <span className="tf-rot">Visão</span>
        <div className="tf-seg" role="group" aria-label="Visão">
          {fixas.map(([v, l, n]) => (
            <button key={v} type="button" aria-pressed={valor === v} onClick={() => onEscolherFixa(v)}>{l}<span className="tf-n">{fmtN(n)}</span></button>
          ))}
        </div>
      </div>
      <div className="tf-lin">
        <span className="tf-rot">Salvas</span>
        <div className="tf-salvas">
          {minhas.map((m) => (
            <button key={m.id} type="button" className="tf-chip" aria-pressed={valor === `minha:${m.id}`} onClick={() => escolherSalva(`minha:${m.id}`, m.spec)}>{m.nome.startsWith("★") ? m.nome : `★ ${m.nome}`}</button>
          ))}
          {equipe.map((m) => (
            <button key={m.id} type="button" className="tf-chip" aria-pressed={valor === `equipe:${m.id}`} onClick={() => escolherSalva(`equipe:${m.id}`, m.spec)}>{rotuloDaVisaoDaEquipe(m)}</button>
          ))}
          {selecionada && (
            <>
              <button type="button" className="tf-link" onClick={() => void alternarComp(selecionada)}>{selecionada.compartilhada ? "Deixar de compartilhar" : "Compartilhar com a equipe"}</button>
              <button type="button" className="tf-link" onClick={() => void excluir(selecionada)}>Excluir visão</button>
            </>
          )}
        </div>
        <button type="button" className="tf-chip tracejado" onClick={() => { setNome(""); setComp(false); setSalvar(true) }}>+ Salvar visão atual</button>
      </div>

      {salvar && (
        <TarefasModal
          titulo="Salvar visão" texto="Guarda visão, agrupamento, filtros, país e busca." botao="Salvar" podeConfirmar={nome.trim().length > 0} onFechar={() => setSalvar(false)}
          onConfirmar={async (just) => {
            const r = await api<{ visao?: { id: number; nome: string } }>("/api/torre/visoes", "POST", { nome: nome.trim(), ...atual, compartilhada: comp, justificativa: just })
            if (!r.ok) return { ok: false, mensagem: erroDe(r.data) }
            setSalvar(false); avisar('Visão salva · aparece em "Salvas"'); void carregar()
            return { ok: true }
          }}
        >
          <label>Nome da visão
            <input type="text" placeholder="Itália · emissão parada" value={nome} maxLength={80} aria-label="Nome da visão" onChange={(e) => setNome(e.target.value)} />
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8, fontWeight: 400 }}>
            <input type="checkbox" style={{ height: 15, width: 15 }} checked={comp} onChange={(e) => setComp(e.target.checked)} /> Compartilhar com a equipe
          </label>
        </TarefasModal>
      )}
    </div>
  )
}
