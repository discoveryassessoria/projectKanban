"use client"
// SaudeMetas.tsx — sub-aba METAS de Gerenciamento › Saúde do sistema (Torre nova, Etapa A · M1, 01/10/2026).
// "Metas de tempo por fase e por país": SOMENTE EXIBIÇÃO ("tempo médio real × meta" e a cor do funil da Visão geral).
// NÃO é prazo, NÃO é SLA, não gera atraso nem alerta. Sem meta cadastrada, a Torre mostra "—".
// As fases vêm do Catálogo de Fases (cadastro) e os países do cadastro de países — nada literal aqui.
import { useEffect, useState } from "react"
import { api, erroDe, useTorre } from "@/src/components/torre/torre-base"

interface Meta { id: number; phaseKey: string; faseLabel: string | null; paisId: number | null; paisLabel: string | null; metaDias: number; ativo: boolean; atualizadoEm: string; atualizadoPor: { id: number; nome: string } | null }
interface Fase { phaseKey: string; label: string }
interface Pais { id: number; countryLabel: string; flag: string | null }

const PADRAO = "" // valor do <select> de país = meta padrão da fase

export function SaudeMetas() {
  const { avisar } = useTorre()
  const [dados, setDados] = useState<{ metas: Meta[]; fases: Fase[]; paises: Pais[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [fase, setFase] = useState("")
  const [pais, setPais] = useState(PADRAO)
  const [dias, setDias] = useState("")
  const [edicao, setEdicao] = useState<Record<number, string>>({})

  const [tick, setTick] = useState(0)
  const carregar = () => setTick((n) => n + 1)
  useEffect(() => {
    let vivo = true
    void api<{ metas: Meta[]; fases: Fase[]; paises: Pais[] }>("/api/torre/metas").then((r) => {
      if (!vivo) return
      if (r.ok) { setDados(r.data); setErro(null) } else setErro(erroDe(r.data, "Não foi possível carregar as metas."))
    })
    return () => { vivo = false }
  }, [tick])

  if (erro) return <div className="tor-card pad">{erro}</div>
  if (!dados) return <div className="tor-card pad small">Carregando metas…</div>

  const salvar = async (phaseKey: string, paisId: number | null, metaDias: number, ativo?: boolean) => {
    setOcupado(true)
    const r = await api<{ ok?: boolean; erro?: string }>("/api/torre/metas", "PUT", { phaseKey, paisId, metaDias, ...(ativo === undefined ? {} : { ativo }) })
    setOcupado(false)
    if (r.ok && r.data.ok !== false) { avisar("Meta salva (registrada no histórico)."); carregar(); return true }
    avisar(erroDe(r.data)); return false
  }
  const excluir = async (m: Meta) => {
    setOcupado(true)
    const r = await api<{ ok?: boolean; erro?: string }>(`/api/torre/metas?id=${m.id}`, "DELETE")
    setOcupado(false)
    if (r.ok) { avisar("Meta excluída (registrada no histórico)."); carregar() } else avisar(erroDe(r.data))
  }
  const adicionar = async () => {
    const n = Number(dias)
    if (!fase) { avisar("Escolha a fase."); return }
    if (!Number.isInteger(n) || n < 1) { avisar("A meta tem de ser um número inteiro de dias (1 ou mais)."); return }
    if (await salvar(fase, pais === PADRAO ? null : Number(pais), n)) { setDias(""); setFase("") }
  }

  return (
    <div>
      <div className="tor-card pad">
        <h2 className="font-extrabold">Metas de tempo por fase e por país</h2>
        <p className="small mt-1">
          Servem só para a Torre mostrar o <b>tempo médio real × meta</b> de cada fase. <b>Não são prazo</b>: não criam atraso, alerta nem mudam prazo de tarefa.
          Vale a meta do país; sem ela, a padrão da fase; sem nenhuma, a Torre mostra “—”.
        </p>
      </div>

      <div className="tor-card pad">
        <div className="tor-bar" style={{ marginBottom: 0 }}>
          <select className="tor-in" aria-label="Fase" value={fase} onChange={(e) => setFase(e.target.value)}>
            <option value="">Escolha a fase…</option>
            {dados.fases.map((f) => <option key={f.phaseKey} value={f.phaseKey}>{f.label}</option>)}
          </select>
          <select className="tor-in" aria-label="País" value={pais} onChange={(e) => setPais(e.target.value)}>
            <option value={PADRAO}>Padrão (todos os países)</option>
            {dados.paises.map((p) => <option key={p.id} value={String(p.id)}>{p.flag ? `${p.flag} ` : ""}{p.countryLabel}</option>)}
          </select>
          <input className="tor-in" style={{ width: 120 }} type="number" min={1} step={1} inputMode="numeric" aria-label="Meta em dias" placeholder="Meta (dias)" value={dias} onChange={(e) => setDias(e.target.value)} />
          <button className="tor-btn pri" disabled={ocupado} onClick={() => void adicionar()}>Salvar meta</button>
        </div>
      </div>

      <div className="tor-card">
        {dados.metas.length === 0 ? (
          <div className="pad small" style={{ padding: 14 }}>Nenhuma meta cadastrada — a Torre mostra “—” no lugar da meta.</div>
        ) : (
          <div className="tor-scroll">
            <div className="tor-hd tor-gMeta"><div>Fase</div><div>País</div><div>Meta (dias)</div><div>Atualizada</div><div /></div>
            {dados.metas.map((m) => (
              <div key={m.id} className="tor-row tor-gMeta">
                <div><b>{m.faseLabel ?? m.phaseKey}</b>{!m.ativo && <span className="tor-p gry" style={{ marginLeft: 6 }}>inativa</span>}</div>
                <div>{m.paisLabel ?? "Padrão (todos)"}</div>
                <div>
                  <input className="tor-in" style={{ width: 90 }} type="number" min={1} step={1} aria-label={`Meta de ${m.faseLabel ?? m.phaseKey}`}
                    value={edicao[m.id] ?? String(m.metaDias)} onChange={(e) => setEdicao((x) => ({ ...x, [m.id]: e.target.value }))} />
                </div>
                <div className="small">{new Date(m.atualizadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}{m.atualizadoPor ? ` · ${m.atualizadoPor.nome}` : ""}</div>
                <div className="flex gap-2 justify-end">
                  <button className="tor-btn" disabled={ocupado || edicao[m.id] == null || Number(edicao[m.id]) === m.metaDias}
                    onClick={() => void salvar(m.phaseKey, m.paisId, Number(edicao[m.id]), m.ativo)}>Salvar</button>
                  <button className="tor-btn" disabled={ocupado} onClick={() => void salvar(m.phaseKey, m.paisId, m.metaDias, !m.ativo)}>{m.ativo ? "Desativar" : "Ativar"}</button>
                  <button className="tor-btn" disabled={ocupado} onClick={() => void excluir(m)}>Excluir</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
