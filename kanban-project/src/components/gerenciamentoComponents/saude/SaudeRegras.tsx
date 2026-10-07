"use client"
// SaudeRegras.tsx — sub-aba REGRAS de Gerenciamento › Saúde do sistema (era a aba Regras da Torre, Bloco H3; movida 01/10/2026). SÓ r1, r2 e r3.
// Simular (dados de hoje, sem gravar), Ativar/Desativar (auditado). Sem r4, sem r5, sem "tempo aprendido".
import { useEffect, useState } from "react"
import { api, erroDe, useTorre } from "@/src/components/torre/torre-base"

interface Regra { chave: "r1" | "r2" | "r3"; nome: string; ativa: boolean; padrao: boolean; descricao: string }
interface Simulacao { chave: string; titulo: string; ativaAgora: boolean; texto: string; itens: Array<{ tarefaId: number | null; texto: string }> }

interface Cobranca { padraoDias: number; vigenteDesde: string; porOrgao: Array<{ orgaoId: number; nome: string; dias: number }>; orgaos: Array<{ id: number; name: string }> }

/** «Cobrar a partir de»: dias ÚTEIS, padrão e ajuste por cartório. Só um lembrete — não trava nada. */
function PrazoDeCobranca({ versao }: { versao: number }) {
  const { avisar } = useTorre()
  const [c, setC] = useState<Cobranca | null>(null)
  const [padrao, setPadrao] = useState("")
  const [orgaoId, setOrgaoId] = useState("")
  const [diasOrgao, setDiasOrgao] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let vivo = true
    void api<Cobranca>("/api/torre/cobranca").then((r) => { if (vivo && r.ok) { setC(r.data); setPadrao(String(r.data.padraoDias)) } })
    return () => { vivo = false }
  }, [tick, versao])
  if (!c) return null
  const gravar = async (corpo: Record<string, unknown>, ok: string) => {
    setSalvando(true)
    const res = await api<{ ok?: boolean }>("/api/torre/cobranca", "PUT", corpo)
    setSalvando(false)
    if (res.ok) { avisar(ok); setTick((n) => n + 1) } else avisar(erroDe(res.data, "Não foi possível salvar."))
  }
  const desde = new Date(c.vigenteDesde).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
  return (
    <div className="tor-card pad" data-testid="prazo-de-cobranca">
      <b>Prazo de cobrança — «cobrar a partir de»</b>
      <div className="small">Contado em dias <b>úteis</b> (sem sábado, domingo e feriado nacional) a partir do envio do requerimento. É só um lembrete: não trava nada. Vale para pedidos enviados a partir de {desde}; os anteriores mantêm a data que já tinham.</div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <label className="small" htmlFor="cobr-padrao">Padrão (dias úteis)</label>
        <input id="cobr-padrao" type="number" min={1} max={90} value={padrao} onChange={(e) => setPadrao(e.target.value)} style={{ width: 70 }} />
        <button className="tor-btn pri" disabled={salvando || Number(padrao) === c.padraoDias} onClick={() => void gravar({ padraoDias: Number(padrao) }, "Prazo de cobrança padrão salvo (auditado).")}>Salvar padrão</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <label className="small" htmlFor="cobr-orgao">Ajuste por cartório</label>
        <select id="cobr-orgao" value={orgaoId} onChange={(e) => { setOrgaoId(e.target.value); const j = c.porOrgao.find((o) => String(o.orgaoId) === e.target.value); setDiasOrgao(j ? String(j.dias) : "") }}>
          <option value="">— escolher cartório —</option>
          {c.orgaos.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <input type="number" min={1} max={90} placeholder="dias" value={diasOrgao} onChange={(e) => setDiasOrgao(e.target.value)} style={{ width: 70 }} aria-label="Dias úteis do cartório" />
        <button className="tor-btn pri" disabled={salvando || !orgaoId || !diasOrgao} onClick={() => void gravar({ orgaoId: Number(orgaoId), dias: Number(diasOrgao) }, "Prazo do cartório salvo (auditado).")}>Salvar ajuste</button>
        <button className="tor-btn" disabled={salvando || !orgaoId || !c.porOrgao.some((o) => String(o.orgaoId) === orgaoId)} onClick={() => void gravar({ orgaoId: Number(orgaoId), dias: null }, "Cartório voltou ao prazo padrão.")}>Voltar ao padrão</button>
      </div>
      {c.porOrgao.length > 0 && <div className="small mt-2">Ajustes: {c.porOrgao.map((o) => `${o.nome} ${o.dias}d`).join(" · ")}</div>}
    </div>
  )
}

export function SaudeRegras({ versao }: { versao: number }) {
  const { avisar } = useTorre()
  const [regras, setRegras] = useState<Regra[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [sim, setSim] = useState<Simulacao | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let vivo = true
    void api<{ regras: Regra[] }>("/api/torre/regras").then((r) => {
      if (!vivo) return
      if (r.ok) { setRegras(r.data.regras); setErro(null) } else setErro(erroDe(r.data, "Não foi possível carregar as regras."))
    })
    return () => { vivo = false }
  }, [tick, versao])

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
    if (res.ok && res.data.ok !== false) { avisar(`Regra "${r.nome}" ${ativa ? "ativada" : "desativada"} (auditado).`); setSim(null); setTick((n) => n + 1) }
    else avisar(erroDe(res.data))
  }
  const aplicarAgora = async () => {
    setOcupado("r1")
    const res = await api<{ executou?: boolean; atribuidas?: number; seguradas?: number; semApto?: number; falhas?: number; motivo?: string }>("/api/torre/regras/r1/executar", "POST")
    setOcupado(null)
    if (res.data?.executou) avisar(`Regra r1 aplicada: ${res.data.atribuidas} atribuída(s), ${res.data.seguradas} segurada(s) pelo limite, ${res.data.semApto ?? 0} sem apto (ficam no Precisa de você), ${res.data.falhas} falha(s).`)
    else avisar(res.status === 409 ? "A regra r1 está desligada — nada foi feito." : erroDe(res.data))
  }

  return (
    <div>
      <div className="small mb-2">Tudo aqui é gravado no Gerenciamento e vale para a Torre. Dá para <b>simular</b> antes de ativar. Regra desligada não executa nada.</div>
      <PrazoDeCobranca versao={versao} />
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
