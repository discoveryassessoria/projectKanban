"use client"
// src/components/torre/Torre.tsx — o casco provisório da Torre (Blocos G/H): Tarefas · Terceiros · Equipe · Regras.
// As demais abas (Precisa de você, Radar e Processos) são dos Blocos I/J.
import { useCallback, useEffect, useState } from "react"
import { api, erroDe, TorreProvider, type PermissoesTorre } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import { TorreTarefas } from "./TorreTarefas"
import { TorreTerceiros } from "./TorreTerceiros"
import { TorreEquipe } from "./TorreEquipe"
import { TorreRegras } from "./TorreRegras"
import { TorreIntegridade } from "./TorreIntegridade"
import { TorreAuditoria } from "./TorreAuditoria"
import "./torre.css"

type Aba = "tarefas" | "terceiros" | "equipe" | "regras" | "integridade" | "auditoria"
const ABAS: Array<[Aba, string]> = [["tarefas", "Tarefas"], ["terceiros", "Terceiros"], ["equipe", "Equipe"], ["regras", "Regras"], ["integridade", "Integridade"], ["auditoria", "Auditoria"]]

export function Torre() {
  const [aba, setAba] = useState<Aba>("tarefas")
  const [linhas, setLinhas] = useState<LinhaTorre[] | null>(null)
  const [permissoes, setPermissoes] = useState<PermissoesTorre | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [divergencias, setDivergencias] = useState<number | null>(null)
  const recarregar = useCallback(() => setVersao((n) => n + 1), [])

  useEffect(() => {
    let vivo = true
    void api<{ linhas: LinhaTorre[]; permissoes: PermissoesTorre }>("/api/torre/tarefas").then((r) => {
      if (!vivo) return
      if (r.ok) { setLinhas(r.data.linhas); setPermissoes(r.data.permissoes); setErro(null) }
      else setErro(erroDe(r.data, "Não foi possível carregar a Torre."))
    })
    return () => { vivo = false }
  }, [versao])

  return (
    <TorreProvider permissoes={permissoes} recarregar={recarregar}>
      <div className="tor">
        <div className="tor-faixa">provisório — as demais abas (Precisa de você, Radar e Processos) chegam nos Blocos I e J</div>
        <div className="tor-tabs" role="tablist">
          {ABAS.filter(([k]) => (k !== "integridade" || !permissoes || permissoes.equipe) && (k !== "auditoria" || !permissoes || permissoes.admin)).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={aba === k} className="tor-tab" onClick={() => setAba(k)}>
              {l}{k === "tarefas" && linhas ? <span className="n">{linhas.length}</span> : null}{k === "integridade" && divergencias != null ? <span className="n">{divergencias}</span> : null}
            </button>
          ))}
        </div>
        {aba === "tarefas" && <TorreTarefas linhas={linhas ?? []} carregando={linhas == null && !erro} erro={!!erro} />}
        {aba === "terceiros" && <TorreTerceiros linhas={linhas ?? []} versao={versao} />}
        {aba === "equipe" && <TorreEquipe versao={versao} />}
        {aba === "regras" && <TorreRegras versao={versao} />}
        {aba === "integridade" && (permissoes?.equipe ? <TorreIntegridade onContagem={setDivergencias} /> : <div className="tor-card pad">A Integridade exige a permissão de gerenciar usuários e acessos (<code>usuarios.gerenciar</code>).</div>)}
        {aba === "auditoria" && (permissoes?.admin ? <TorreAuditoria /> : <div className="tor-card pad">A auditoria é só para administradores.</div>)}
        {erro && aba !== "tarefas" && <div className="small mt-2">{erro}</div>}
      </div>
    </TorreProvider>
  )
}
