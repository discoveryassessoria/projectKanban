"use client"
// src/components/torre/TorreRegras.tsx — aba REGRAS (Bloco H3). SÓ r1, r2 e r3.
// Simular (dados de hoje, sem gravar), Ativar/Desativar (auditado). Sem r4, sem r5, sem "tempo aprendido".
import { useEffect, useState } from "react"
import { api, erroDe, useTorre } from "./torre-base"

interface Regra { chave: "r1" | "r2" | "r3"; nome: string; ativa: boolean; padrao: boolean; descricao: string }
interface Simulacao { chave: string; titulo: string; ativaAgora: boolean; texto: string; itens: Array<{ tarefaId: number | null; texto: string }> }

export function TorreRegras({ versao }: { versao: number }) {
  const { permissoes, avisar } = useTorre()
  const [regras, setRegras] = useState<Regra[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [sim, setSim] = useState<Simulacao | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const permitido = !!permissoes?.equipe
  useEffect(() => {
    if (!permitido) return
    let vivo = true
    void api<{ regras: Regra[] }>("/api/torre/regras").then((r) => {
      if (!vivo) return
      if (r.ok) { setRegras(r.data.regras); setErro(null) } else setErro(erroDe(r.data, "Não foi possível carregar as regras."))
    })
    return () => { vivo = false }
  }, [tick, versao, permitido])

  if (!permitido) return <div className="tor-card pad">As regras exigem a permissão de gerenciar usuários e acessos (<code>usuarios.gerenciar</code>).</div>
  if (erro) return <div className="tor-card pad">{erro}</div>
  if (!regras) return <div className="tor-card pad small">Carregando regras…</div>

  const simular = async (r: Regra) => {
    setOcupado(r.chave)
    const res = await api<Simulacao>(`/api/torre/regras/${r.chave}/simular`, "POST")
    setOcupado(null)
    if (res.ok) setSim(res.data); else avisar(erroDe(res.data))
  }
  const alternar = async (r: Regra, ativa: boolean) => {
    setOcupado(r.chave)
    const res = await api<{ ok?: boolean; erro?: string }>(`/api/torre/regras/${r.chave}/ativar`, "POST", { ativa })
    setOcupado(null)
    if (res.ok && res.data.ok !== false) { avisar(`Regra "${r.nome}" ${ativa ? "ativada" : "desativada"} (gravada no Gerenciamento).`); setSim(null); setTick((n) => n + 1) }
    else avisar(erroDe(res.data))
  }
  const aplicarAgora = async () => {
    setOcupado("r1")
    const res = await api<{ executou?: boolean; atribuidas?: number; seguradas?: number; falhas?: number; motivo?: string }>("/api/torre/regras/r1/executar", "POST")
    setOcupado(null)
    if (res.data?.executou) avisar(`Regra r1 aplicada: ${res.data.atribuidas} atribuída(s), ${res.data.seguradas} segurada(s) pelo limite, ${res.data.falhas} falha(s).`)
    else avisar(res.status === 409 ? "A regra r1 está desligada — nada foi feito." : erroDe(res.data))
  }

  return (
    <div>
      <div className="small mb-2">Tudo aqui é gravado no Gerenciamento. A Torre abre a porta e permite <b>simular</b> antes de ativar. Regra desligada não executa nada.</div>
      {regras.map((r) => (
        <div key={r.chave} className="tor-card pad flex flex-wrap items-center gap-3">
          <div style={{ flex: 1, minWidth: 260 }}><b>{r.chave} · {r.nome}</b><div className="small">{r.descricao}</div></div>
          <span className={`tor-p ${r.ativa ? "grn" : "gry"}`}>{r.ativa ? "ativa" : "inativa"}</span>
          <button className="tor-btn" disabled={ocupado === r.chave} onClick={() => void simular(r)}>Simular</button>
          {r.chave === "r1" && r.ativa && <button className="tor-btn" disabled={ocupado === r.chave} onClick={() => void aplicarAgora()}>Aplicar agora</button>}
          <button className="tor-btn pri" disabled={ocupado === r.chave} onClick={() => void alternar(r, !r.ativa)}>{r.ativa ? "Desativar" : "Ativar"}</button>
        </div>
      ))}
      {sim && (
        <div className="tor-card pad" style={{ borderLeft: "4px solid var(--warning)" }}>
          <h2 className="font-extrabold">Simulação: {sim.titulo}</h2>
          <div className="mt-2 leading-relaxed">{sim.texto}</div>
          {sim.itens.length > 0 && (
            <details className="mt-2"><summary className="small cursor-pointer">Ver {sim.itens.length} item(ns)</summary>
              <ul className="mt-1 space-y-0.5 small">{sim.itens.map((i, n) => <li key={n}>{i.tarefaId != null ? `#${i.tarefaId} · ` : ""}{i.texto}</li>)}</ul>
            </details>
          )}
          <div className="mt-3 flex gap-2">
            {(() => { const r = regras.find((x) => x.chave === sim.chave); return r ? <button className="tor-btn pri" disabled={ocupado === r.chave} onClick={() => void alternar(r, !r.ativa)}>{r.ativa ? "Desativar regra" : "Ativar regra"}</button> : null })()}
            <button className="tor-btn" onClick={() => setSim(null)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}
