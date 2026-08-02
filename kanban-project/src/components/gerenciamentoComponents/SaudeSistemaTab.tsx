"use client"

// SAÚDE DO SISTEMA — motor de auditoria contínua.
//
// A tela não decide nada: ela mostra o veredito do motor. "Saudável" só aparece
// quando o motor devolve SAUDAVEL, e o motor só devolve isso com todas as
// verificações obrigatórias concluídas e sem achados. Diagnóstico incompleto e
// saúde desconhecida são estados próprios, exibidos como tal.

import { useCallback, useMemo, useState } from "react"
import { useApi } from "@/src/lib/dados"

type Estado = "SAUDAVEL" | "ATENCAO" | "DEGRADADO" | "CRITICO" | "DIAGNOSTICO_INCOMPLETO" | "INDISPONIVEL"
type Severidade = "CRITICO" | "ERRO" | "ALERTA" | "INFORMATIVO"

interface Achado {
  id: number; chave: string; codigo: string; dominio: string; modulo: string
  severidade: Severidade; titulo: string; descricao: string
  explicacao: string | null; impacto: string | null
  entidade: string | null; registroId: string | null; registroNome: string | null
  quantidade: number; link: string | null; recomendacao: string | null
  correcaoAutomatica: string | null; evidencia: unknown
  status: string; primeiraDeteccao: string; ultimaDeteccao: string; recorrencias: number
}
interface Execucao {
  id: number; modo: string; estado: Estado; motivoEstado: string; versaoCatalogo: string
  iniciadoEm: string; concluidoEm: string; duracaoMs: number
  totalCatalogo: number; totalElegiveis: number; executadas: number; aprovadas: number
  comAchados: number; falhasTecnicas: number; naoExecutadas: number; coberturaPercentual: number
  criticos: number; erros: number; alertas: number; informativos: number
  execucoes: { codigo: string; status: string; duracaoMs: number; achados: number; erro: string | null; resumo: string | null; metricas: Record<string, unknown> | null }[]
  dominiosSemCobertura: string[]
}
interface CoberturaDominio { dominio: string; total: number; obrigatorias: number; ativas: number }
interface VerificacaoMeta {
  id: string; codigo: string; nome: string; descricao: string; dominio: string; modulo: string
  obrigatoria: boolean; modos: string[]; orientacao: string; rotaCorrecao: string | null
  correcaoAutomatica: string | null; responsavel: string; ativo: boolean
}
interface Resposta {
  execucao: Execucao | null
  estadoAtual: Estado
  motivoEstado: string
  achados: Achado[]
  catalogo: VerificacaoMeta[]
  cobertura: CoberturaDominio[]
  dominiosSemCobertura: string[]
  versaoCatalogo: string
  rotulos: { dominios: Record<string, string>; estados: Record<Estado, string>; severidades: Record<Severidade, string> }
}

const CARD = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
const CORES_ESTADO: Record<Estado, { fundo: string; texto: string; ponto: string }> = {
  SAUDAVEL: { fundo: "bg-green-500/10 border-green-400/30", texto: "text-green-300", ponto: "bg-green-400" },
  ATENCAO: { fundo: "bg-amber-500/10 border-amber-400/30", texto: "text-amber-300", ponto: "bg-amber-400" },
  DEGRADADO: { fundo: "bg-orange-500/10 border-orange-400/30", texto: "text-orange-300", ponto: "bg-orange-400" },
  CRITICO: { fundo: "bg-red-500/10 border-red-400/30", texto: "text-red-300", ponto: "bg-red-400" },
  DIAGNOSTICO_INCOMPLETO: { fundo: "bg-violet-500/10 border-violet-400/30", texto: "text-violet-300", ponto: "bg-violet-400" },
  INDISPONIVEL: { fundo: "bg-white/5 border-white/20", texto: "text-white/70", ponto: "bg-white/40" },
}
const CORES_SEV: Record<Severidade, string> = {
  CRITICO: "bg-red-500/15 text-red-300 border-red-400/30",
  ERRO: "bg-orange-500/15 text-orange-300 border-orange-400/30",
  ALERTA: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  INFORMATIVO: "bg-sky-500/15 text-sky-300 border-sky-400/30",
}
const fmtData = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"
const fmtDur = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}

function Kpi({ valor, label, cor, destaque }: { valor: React.ReactNode; label: string; cor?: string; destaque?: boolean }) {
  return (
    <div className={`${CARD} p-4 ${destaque ? "ring-1 ring-white/20" : ""}`}>
      <div className="text-2xl font-semibold" style={{ color: cor ?? "#fff" }}>{valor}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-white/45">{label}</div>
    </div>
  )
}

type Aba = "visao" | "problemas" | "dominios" | "cobertura" | "execucao"

export function SaudeSistemaTab() {
  const { dados, carregando, erro: erroApi, recarregar } = useApi<Resposta>("/api/gerenciamento/saude")
  const [aba, setAba] = useState<Aba>("visao")
  const [executando, setExecutando] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [filtroSev, setFiltroSev] = useState<"" | Severidade>("")
  const [filtroDominio, setFiltroDominio] = useState("")

  const executar = useCallback(async (modo: "RAPIDO" | "COMPLETO" | "PROFUNDO") => {
    setExecutando(true)
    setMensagem(`Executando diagnóstico ${modo.toLowerCase()}…`)
    try {
      const res = await fetch("/api/gerenciamento/saude", { method: "POST", headers: authHeaders(), body: JSON.stringify({ modo }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMensagem(j.error ?? "O motor de diagnóstico não conseguiu executar.")
      } else {
        const r = j.resultado as Execucao
        setMensagem(`Diagnóstico concluído em ${fmtDur(r.duracaoMs)} — ${r.executadas}/${r.totalElegiveis} verificações, ${r.criticos} crítico(s), ${r.erros} erro(s), ${r.alertas} alerta(s).`)
        recarregar()
      }
    } catch (e) {
      setMensagem(`Falha ao executar: ${String((e as Error)?.message ?? e)}`)
    } finally {
      setExecutando(false)
    }
  }, [recarregar])

  const achadosFiltrados = useMemo(() => {
    const lista = dados?.achados ?? []
    return lista.filter((a) => (!filtroSev || a.severidade === filtroSev) && (!filtroDominio || a.dominio === filtroDominio))
  }, [dados, filtroSev, filtroDominio])

  if (carregando) return <div className="py-24 text-center text-white/50">Carregando a saúde do sistema…</div>
  if (erroApi || !dados) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
        Não foi possível carregar a saúde do sistema. Isso é, por si só, um sinal: nenhum estado saudável pode ser assumido.
      </div>
    )
  }

  const e = dados.execucao
  const estado = dados.estadoAtual
  const cor = CORES_ESTADO[estado] ?? CORES_ESTADO.INDISPONIVEL
  const rot = dados.rotulos
  const novos = dados.achados.filter((a) => a.recorrencias <= 1).length
  const recorrentes = dados.achados.filter((a) => a.recorrencias > 1).length

  return (
    <div className="space-y-5">
      {/* ── CABEÇALHO: o veredito, sem maquiagem ─────────────────────────── */}
      <div className={`rounded-2xl border p-5 backdrop-blur-sm ${cor.fundo}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${cor.ponto}`} />
              <h2 className={`text-xl font-semibold ${cor.texto}`}>{rot.estados[estado] ?? estado}</h2>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">catálogo v{dados.versaoCatalogo}</span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-white/70">{dados.motivoEstado}</p>
            <p className="mt-1 text-xs text-white/45">
              {e
                ? `Última execução: ${fmtData(e.concluidoEm)} · modo ${e.modo.toLowerCase()} · ${fmtDur(e.duracaoMs)} · cobertura ${e.coberturaPercentual}% (${e.executadas}/${e.totalElegiveis})`
                : "O diagnóstico nunca foi executado neste ambiente."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={executando} onClick={() => executar("RAPIDO")}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/10 disabled:opacity-50">
              Diagnóstico rápido
            </button>
            <button disabled={executando} onClick={() => executar("COMPLETO")}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              Executar diagnóstico completo
            </button>
            <button disabled={executando} onClick={() => executar("PROFUNDO")}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/10 disabled:opacity-50">
              Profundo
            </button>
          </div>
        </div>
        {mensagem && <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70">{mensagem}</div>}
      </div>

      {/* ── CARDS ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi valor={e?.criticos ?? "—"} label="Críticos" cor={(e?.criticos ?? 0) > 0 ? "#f87171" : "#4ade80"} destaque={(e?.criticos ?? 0) > 0} />
        <Kpi valor={e?.erros ?? "—"} label="Erros" cor={(e?.erros ?? 0) > 0 ? "#fb923c" : "#4ade80"} />
        <Kpi valor={e?.alertas ?? "—"} label="Alertas" cor={(e?.alertas ?? 0) > 0 ? "#fbbf24" : "#4ade80"} />
        <Kpi valor={e?.informativos ?? "—"} label="Informativos" cor="#7dd3fc" />
        <Kpi valor={`${e?.coberturaPercentual ?? 0}%`} label="Cobertura" cor={(e?.coberturaPercentual ?? 0) === 100 ? "#4ade80" : "#fbbf24"} />
        <Kpi valor={e?.naoExecutadas ?? "—"} label="Não executadas" cor={(e?.naoExecutadas ?? 0) > 0 ? "#c4b5fd" : "#4ade80"} />
        <Kpi valor={e?.falhasTecnicas ?? "—"} label="Falha técnica" cor={(e?.falhasTecnicas ?? 0) > 0 ? "#f87171" : "#4ade80"} />
        <Kpi valor={novos} label="Problemas novos" />
        <Kpi valor={recorrentes} label="Recorrentes" cor={recorrentes > 0 ? "#fbbf24" : undefined} />
        <Kpi valor={`${dados.catalogo.filter((v) => v.ativo).length}`} label="Verificações no catálogo" />
      </div>

      {/* ── ABAS ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b border-white/10 text-sm">
        {([["visao", "Visão geral"], ["problemas", `Problemas (${dados.achados.length})`], ["dominios", "Domínios"], ["cobertura", "Cobertura"], ["execucao", "Execução"]] as [Aba, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-3 py-2 ${aba === k ? "border-b-2 border-blue-400 font-medium text-white" : "text-white/55 hover:text-white/80"}`}>
            {l}
          </button>
        ))}
      </div>

      {aba === "visao" && (
        <div className="space-y-3">
          {dados.dominiosSemCobertura.length > 0 && (
            <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-100">
              <b>{dados.dominiosSemCobertura.length} domínio(s) obrigatório(s) ainda sem verificação.</b> Enquanto houver lacuna de cobertura,
              o sistema não pode ser declarado saudável — o motor devolve “diagnóstico incompleto” de propósito.
              <div className="mt-1 text-xs text-violet-200/80">
                {dados.dominiosSemCobertura.map((d) => rot.dominios[d] ?? d).join(" · ")}
              </div>
            </div>
          )}
          {dados.achados.slice(0, 8).map((a) => <LinhaAchado key={a.id} a={a} rot={rot} />)}
          {dados.achados.length === 0 && e && (
            <div className={`${CARD} px-4 py-6 text-center text-sm text-white/60`}>
              Nenhum problema aberto nas verificações executadas.
            </div>
          )}
        </div>
      )}

      {aba === "problemas" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={filtroSev} onChange={(ev) => setFiltroSev(ev.target.value as "" | Severidade)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
              <option value="" className="bg-zinc-900">Todas as severidades</option>
              {(["CRITICO", "ERRO", "ALERTA", "INFORMATIVO"] as Severidade[]).map((s) => (
                <option key={s} value={s} className="bg-zinc-900">{rot.severidades[s]}</option>
              ))}
            </select>
            <select value={filtroDominio} onChange={(ev) => setFiltroDominio(ev.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
              <option value="" className="bg-zinc-900">Todos os domínios</option>
              {[...new Set(dados.achados.map((a) => a.dominio))].map((d) => (
                <option key={d} value={d} className="bg-zinc-900">{rot.dominios[d] ?? d}</option>
              ))}
            </select>
            <span className="self-center text-xs text-white/40">{achadosFiltrados.length} problema(s)</span>
          </div>
          {achadosFiltrados.map((a) => <LinhaAchado key={a.id} a={a} rot={rot} detalhado />)}
          {achadosFiltrados.length === 0 && (
            <div className={`${CARD} px-4 py-6 text-center text-sm text-white/60`}>Nenhum problema com estes filtros.</div>
          )}
        </div>
      )}

      {aba === "dominios" && (
        <div className={`${CARD} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-left text-xs text-white/50">
              <tr><th className="px-4 py-3">Domínio</th><th className="px-4 py-3">Problemas</th><th className="px-4 py-3">Pior severidade</th></tr>
            </thead>
            <tbody>
              {[...new Set(dados.achados.map((a) => a.dominio))].map((d) => {
                const doDominio = dados.achados.filter((a) => a.dominio === d)
                const pior = (["CRITICO", "ERRO", "ALERTA", "INFORMATIVO"] as Severidade[]).find((s) => doDominio.some((a) => a.severidade === s))!
                return (
                  <tr key={d} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white">{rot.dominios[d] ?? d}</td>
                    <td className="px-4 py-2.5 text-white/70">{doDominio.length}</td>
                    <td className="px-4 py-2.5"><span className={`rounded border px-1.5 py-0.5 text-[10px] ${CORES_SEV[pior]}`}>{rot.severidades[pior]}</span></td>
                  </tr>
                )
              })}
              {dados.achados.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-xs text-white/40">Nenhum domínio com problema aberto.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {aba === "cobertura" && (
        <div className={`${CARD} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-left text-xs text-white/50">
              <tr><th className="px-4 py-3">Domínio obrigatório</th><th className="px-4 py-3">Verificações</th><th className="px-4 py-3">Obrigatórias</th><th className="px-4 py-3">Situação</th></tr>
            </thead>
            <tbody>
              {dados.cobertura.map((c) => (
                <tr key={c.dominio} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2.5 text-white">{rot.dominios[c.dominio] ?? c.dominio}</td>
                  <td className="px-4 py-2.5 text-white/70">{c.ativas}</td>
                  <td className="px-4 py-2.5 text-white/70">{c.obrigatorias}</td>
                  <td className="px-4 py-2.5">
                    {c.ativas > 0
                      ? <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-300">coberto</span>
                      : <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">sem cobertura</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "execucao" && (
        <div className={`${CARD} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-left text-xs text-white/50">
              <tr><th className="px-4 py-3">Verificação</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Duração</th><th className="px-4 py-3">Resultado</th></tr>
            </thead>
            <tbody>
              {(e?.execucoes ?? []).map((x) => {
                const meta = dados.catalogo.find((v) => v.codigo === x.codigo)
                const cores = x.status === "APROVADA" ? "bg-green-500/15 text-green-300"
                  : x.status === "COM_ACHADOS" ? "bg-amber-500/15 text-amber-300"
                  : x.status === "NAO_EXECUTADA" ? "bg-violet-500/15 text-violet-300"
                  : "bg-red-500/15 text-red-300"
                return (
                  <tr key={x.codigo} className="border-b border-white/5 last:border-0 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-[11px] text-white/50">{x.codigo}</div>
                      <div className="text-white">{meta?.nome ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2.5"><span className={`rounded px-1.5 py-0.5 text-[10px] ${cores}`}>{x.status.replace("_", " ").toLowerCase()}</span></td>
                    <td className="px-4 py-2.5 text-white/60">{fmtDur(x.duracaoMs)}</td>
                    <td className="px-4 py-2.5 text-white/70">
                      {x.erro ? <span className="text-red-300">{x.erro}</span> : x.achados > 0 ? `${x.achados} achado(s)` : (x.resumo ?? "sem achados")}
                    </td>
                  </tr>
                )
              })}
              {!e && <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-white/40">Nenhuma execução registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LinhaAchado({ a, rot, detalhado }: { a: Achado; rot: Resposta["rotulos"]; detalhado?: boolean }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className={`${CARD} overflow-hidden`}>
      <button onClick={() => setAberto((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/5">
        <span className={`mt-0.5 flex-none rounded border px-1.5 py-0.5 text-[10px] ${CORES_SEV[a.severidade]}`}>{rot.severidades[a.severidade]}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white">{a.titulo}</span>
          <span className="mt-0.5 block text-xs text-white/60">{a.descricao}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
            <span className="font-mono">{a.codigo}</span>
            <span>{rot.dominios[a.dominio] ?? a.dominio}</span>
            <span>{a.modulo}</span>
            {a.recorrencias > 1 && <span className="rounded bg-amber-500/15 px-1.5 text-amber-300">recorrente ({a.recorrencias}×)</span>}
            {a.recorrencias <= 1 && <span className="rounded bg-sky-500/15 px-1.5 text-sky-300">novo</span>}
            <span>detectado em {fmtData(a.primeiraDeteccao)}</span>
          </span>
        </span>
      </button>
      {(aberto || detalhado) && (
        <div className="border-t border-white/10 px-4 py-3 text-xs text-white/70">
          {a.explicacao && <p className="mb-2"><b className="text-white/85">Por que:</b> {a.explicacao}</p>}
          {a.impacto && <p className="mb-2"><b className="text-white/85">Impacto:</b> {a.impacto}</p>}
          {a.recomendacao && <p className="mb-2"><b className="text-white/85">Como corrigir:</b> {a.recomendacao}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {a.entidade && <span>Entidade: <span className="text-white/85">{a.entidade}</span>{a.registroNome ? ` — ${a.registroNome}` : ""}</span>}
            <span>Afetados: <span className="text-white/85">{a.quantidade}</span></span>
            <span>Última detecção: <span className="text-white/85">{fmtData(a.ultimaDeteccao)}</span></span>
            {a.correcaoAutomatica && <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-green-300">correção automática disponível</span>}
            {a.link && (
              <a href={a.link} className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white/85 hover:bg-white/10">
                Ir para o registro →
              </a>
            )}
          </div>
          {a.evidencia != null && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-white/10 bg-black/30 p-2 text-[11px] text-white/60">
              {JSON.stringify(a.evidencia, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default SaudeSistemaTab
