"use client"
// SaudeIntegridade.tsx — sub-aba INTEGRIDADE de Gerenciamento › Saúde do sistema (era a aba Integridade da Torre, Bloco I1; movida 01/10/2026). O MESMO motor do painel de Saúde
// (/api/torre/integridade lê SaudeAchado); "Rodar diagnóstico agora" chama a rota de execução do Saúde.
import { useCallback, useEffect, useState } from "react"
import { api, erroDe, fmtDia, ModalTexto, useTorre } from "@/src/components/torre/torre-base"

interface Item {
  id: number; chave: string; codigo: string; severidade: string; titulo: string; achado: string; efeito: string | null
  acao: { link: string | null; recomendacao: string | null; correcao: { id: string; nome: string; descricao: string } | null }
  quantidade: number; status: string; recorrencias: number; primeiraDeteccao: string; ultimaDeteccao: string
  ignorado: { ate: string; por: string | null; justificativa: string | null } | null; voltouDeIgnorado: boolean
}
interface Quadro {
  frase: string; divergencias: number; informativos: number; ignorados: number; itens: Item[]; itensIgnorados: Item[]
  execucao: { modo: string; estado: string; motivoEstado: string; criadoEm: string; coberturaPercentual: number; falhasTecnicas: number } | null
}
const SEV: Record<string, [string, "red" | "amb" | "gry"]> = { CRITICO: ["Crítico", "red"], ERRO: ["Erro", "red"], ALERTA: ["Alerta", "amb"], INFORMATIVO: ["Informativo", "gry"] }
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })

export function SaudeIntegridade({ onContagem }: { onContagem?: (n: number) => void }) {
  const { avisar } = useTorre()
  const [q, setQ] = useState<Quadro | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [rodando, setRodando] = useState(false)
  const [ignorar, setIgnorar] = useState<Item | null>(null)
  const [ocupado, setOcupado] = useState<number | null>(null)
  const [verIgnorados, setVerIgnorados] = useState(false)
  const recarregar = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let vivo = true
    void api<Quadro>("/api/torre/integridade").then((r) => {
      if (!vivo) return
      if (r.ok) { setQ(r.data); setErro(null); onContagem?.(r.data.divergencias) } else setErro(erroDe(r.data, "Não foi possível carregar a integridade."))
    })
    return () => { vivo = false }
  }, [tick, onContagem])

  const rodar = async () => {
    setRodando(true)
    const r = await api<{ resultado?: { estado: string; criticos: number; erros: number; alertas: number; executadas: number; totalElegiveis: number }; persistencia?: { novos: number; resolvidos: number } }>("/api/gerenciamento/saude", "POST", { modo: "COMPLETO" })
    setRodando(false)
    if (r.ok && r.data.resultado) {
      const x = r.data.resultado
      avisar(`Diagnóstico concluído (${x.executadas}/${x.totalElegiveis} verificações): ${x.criticos} crítico(s), ${x.erros} erro(s), ${x.alertas} alerta(s)${r.data.persistencia ? ` · ${r.data.persistencia.novos} novo(s), ${r.data.persistencia.resolvidos} resolvido(s)` : ""}.`)
      recarregar()
    } else avisar(erroDe(r.data, "O diagnóstico não conseguiu executar."))
  }
  const corrigir = async (i: Item) => {
    const c = i.acao.correcao
    if (!c || !window.confirm(`${c.nome}\n\n${c.descricao}\n\nExecutar esta correção?`)) return
    setOcupado(i.id)
    const r = await api<{ resultado?: { mensagem: string } }>("/api/gerenciamento/saude/corrigir", "POST", { correcao: c.id, chaveAchado: i.chave })
    setOcupado(null)
    if (r.ok) { avisar(r.data.resultado?.mensagem ?? "Correção executada."); recarregar() } else avisar(erroDe(r.data))
  }

  if (erro) return <div className="tor-card pad">{erro}</div>
  if (!q) return <div className="tor-card pad small">Carregando integridade…</div>
  const e = q.execucao
  return (
    <div>
      <div className="tor-bar">
        <div><b style={{ fontSize: 15 }}>{q.frase}</b>
          <div className="small">{q.divergencias} divergência(s) · {q.informativos} informativo(s) · {q.ignorados} ignorado(s)
            {e ? ` · última execução: ${e.modo.toLowerCase()}, ${e.estado.toLowerCase().replace(/_/g, " ")}, ${quando(e.criadoEm)}, cobertura ${e.coberturaPercentual}%${e.falhasTecnicas ? `, ${e.falhasTecnicas} falha(s) técnica(s)` : ""}` : " · o diagnóstico nunca foi executado"}</div></div>
        <div style={{ flexGrow: 1 }} />
        <button className="tor-btn pri" disabled={rodando} onClick={() => void rodar()}>{rodando ? "Executando…" : "Rodar diagnóstico agora"}</button>
      </div>
      <div className="tor-card tor-scroll">
        <div className="tor-hd tor-gI"><span>Gravidade</span><span>Achado</span><span>Efeito</span><span>Ação</span></div>
        {q.itens.length === 0 && <div className="p-4 small">Nenhuma divergência. Meta cumprida.</div>}
        {q.itens.map((i) => {
          const [rot, cls] = SEV[i.severidade] ?? [i.severidade, "gry" as const]
          return (
            <div key={i.id} className="tor-row tor-gI">
              <div><span className={`tor-p ${cls}`}>{rot}</span></div>
              <div><b>{i.codigo} · {i.titulo}</b>{i.quantidade > 1 ? ` (${i.quantidade})` : ""}
                <div className="small">{i.achado}</div>
                <div className="small">desde {fmtDia(i.primeiraDeteccao)}{i.recorrencias > 1 ? ` · ${i.recorrencias} detecções` : ""}{i.voltouDeIgnorado ? " · voltou (o prazo de ignorar venceu)" : ""}</div></div>
              <div className="small">{i.efeito ?? "—"}</div>
              <div className="flex flex-wrap gap-1 items-center">
                {i.acao.link && <a className="tor-btn" href={i.acao.link}>Abrir no Gerenciamento</a>}
                {i.acao.correcao && <button className="tor-btn pri" disabled={ocupado === i.id} title={i.acao.correcao.descricao} onClick={() => void corrigir(i)}>Corrigir</button>}
                <button className="tor-btn" onClick={() => setIgnorar(i)}>Ignorar 7 d</button>
                {i.acao.recomendacao && <div className="small" style={{ flexBasis: "100%" }}>{i.acao.recomendacao}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {q.itensIgnorados.length > 0 && (
        <div className="tor-card pad">
          <button className="tor-btn" aria-expanded={verIgnorados} onClick={() => setVerIgnorados((v) => !v)}>Ignorados ({q.itensIgnorados.length}) {verIgnorados ? "▲" : "▼"}</button>
          {verIgnorados && <ul className="mt-2 space-y-1 small">{q.itensIgnorados.map((i) => (
            <li key={i.id}>{i.codigo} · {i.titulo} — por {i.ignorado?.por ?? "—"} até {fmtDia(i.ignorado?.ate)}{i.ignorado?.justificativa ? ` — ${i.ignorado.justificativa}` : ""}</li>
          ))}</ul>}
        </div>
      )}
      {ignorar && (
        <ModalTexto titulo="Ignorar por 7 dias" subtitulo={`${ignorar.codigo} · ${ignorar.titulo} — o achado continua visível no painel de Saúde; aqui ele volta sozinho quando o prazo vencer.`}
          rotulo="Justificativa" confirmar="Ignorar 7 d" onFechar={() => setIgnorar(null)}
          onEnviar={async (justificativa) => {
            const r = await api<{ ok?: boolean; mensagem?: string; erro?: string }>("/api/torre/integridade/ignorar", "POST", { achadoId: ignorar.id, justificativa })
            if (!r.ok || r.data.ok === false) return { ok: false, mensagem: erroDe(r.data) }
            setIgnorar(null); avisar(r.data.mensagem ?? "Achado ignorado por 7 dias."); recarregar()
            return { ok: true }
          }} />
      )}
    </div>
  )
}
