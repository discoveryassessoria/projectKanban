"use client"
// src/components/torre/VisoesSalvas.tsx — VISÕES SALVAS da aba Tarefas (Bloco J4). Guardadas em `RelatorioVisao`
// (`dominio: torre-tarefas`, sem migration). A visão guarda a PERGUNTA (visão, agrupamento, KPI, país, busca), nunca o resultado.
import { useCallback, useEffect, useState } from "react"
import { api, erroDe, Campo, Modal, useTorre } from "./torre-base"

export interface SpecDaVisao { visao: string | null; agrupar: string | null; dentro?: string | null; kpi: string | null; pais: string | null; busca: string | null }
interface Minha { id: number; nome: string; spec: SpecDaVisao; compartilhada: boolean }
interface DaEquipe { id: number; nome: string; spec: SpecDaVisao; donoNome: string }

export function VisoesSalvas({ fixas, valor, atual, onEscolherFixa, onAplicar }: {
  fixas: Array<[string, string]>
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
  const [env, setEnv] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await api<{ minhas: Minha[]; compartilhadas: DaEquipe[] }>("/api/torre/visoes")
    if (r.ok) { setMinhas(r.data.minhas ?? []); setEquipe(r.data.compartilhadas ?? []) }
  }, [])
  useEffect(() => {
    let vivo = true
    void api<{ minhas: Minha[]; compartilhadas: DaEquipe[] }>("/api/torre/visoes").then((r) => { if (vivo && r.ok) { setMinhas(r.data.minhas ?? []); setEquipe(r.data.compartilhadas ?? []) } })
    return () => { vivo = false }
  }, [])

  const escolher = (v: string) => {
    if (v.startsWith("minha:")) { const x = minhas.find((m) => `minha:${m.id}` === v); if (x) onAplicar(x.spec, v); return }
    if (v.startsWith("equipe:")) { const x = equipe.find((m) => `equipe:${m.id}` === v); if (x) onAplicar(x.spec, v); return }
    onEscolherFixa(v)
  }
  const selecionada = minhas.find((m) => `minha:${m.id}` === valor)

  const gravar = async () => {
    setEnv(true); setErro(null)
    const r = await api<{ visao?: { id: number; nome: string } }>("/api/torre/visoes", "POST", { nome: nome.trim(), ...atual, compartilhada: comp })
    setEnv(false)
    if (!r.ok) { setErro(erroDe(r.data)); return }
    setSalvar(false); setNome(""); setComp(false); avisar(`Visão "${r.data.visao?.nome ?? nome}" salva${comp ? " e compartilhada com a equipe" : ""}.`); void carregar()
  }
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
    <>
      <label className="flex items-center gap-1.5 small">Visão
        <select className="tor-in" aria-label="Visão salva" value={valor} onChange={(e) => escolher(e.target.value)}>
          {fixas.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {minhas.length > 0 && <optgroup label="Minhas visões">{minhas.map((m) => <option key={m.id} value={`minha:${m.id}`}>{m.nome}{m.compartilhada ? " (compartilhada)" : ""}</option>)}</optgroup>}
          {equipe.length > 0 && <optgroup label="Da equipe">{equipe.map((m) => <option key={m.id} value={`equipe:${m.id}`}>{m.nome} — {m.donoNome}</option>)}</optgroup>}
        </select>
      </label>
      <button className="tor-btn" onClick={() => setSalvar(true)}>Salvar visão</button>
      {selecionada && (
        <>
          <button className="tor-btn" onClick={() => void alternarComp(selecionada)}>{selecionada.compartilhada ? "Deixar de compartilhar" : "Compartilhar com a equipe"}</button>
          <button className="tor-btn" onClick={() => void excluir(selecionada)}>Excluir visão</button>
        </>
      )}
      {salvar && (
        <Modal titulo="Salvar visão" subtitulo="Guarda os filtros de agora (visão, agrupamento, indicador, nacionalidade e busca) — nunca o resultado." onFechar={() => setSalvar(false)} ocupado={env} rodape={<>
          <button className="tor-btn" onClick={() => setSalvar(false)} disabled={env}>Cancelar</button>
          <button className="tor-btn pri" onClick={() => void gravar()} disabled={env || !nome.trim()}>{env ? "Salvando…" : "Salvar"}</button>
        </>}>
          <Campo rotulo="Nome da visão"><input className="tor-in w-full" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} /></Campo>
          <label className="flex items-center gap-2 small"><input type="checkbox" checked={comp} onChange={(e) => setComp(e.target.checked)} /> Compartilhar com a equipe</label>
          {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
        </Modal>
      )}
    </>
  )
}
