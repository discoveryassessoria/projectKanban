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
type EstadoProntidao = "PRONTO" | "PARCIALMENTE_PRONTO" | "NAO_CONFIGURADO" | "CONFIGURACAO_INVALIDA" | "BLOQUEADO" | "DIAGNOSTICO_INCOMPLETO"
interface DependenciaAvaliada {
  codigo: string; nome: string; tipo: string; obrigatoria: boolean; acao: string
  rota?: string; correcaoAutomatica?: string; ok: boolean; detalhe: string
  quantidade?: number; indeterminada?: boolean; erro?: string
}
interface CapacidadeAvaliada {
  codigo: string; nome: string; descricao: string; modulo: string; operacao: string
  dominio: string; prioridade: number; estado: EstadoProntidao; motivo: string
  dependencias: DependenciaAvaliada[]; faltantes: DependenciaAvaliada[]
}
interface Recomendacao {
  codigo: string; ordem: number; titulo: string; problema: string; causa: string
  impacto: string; acao: string; tipo: string; severidade: Severidade; modulo: string
  destrava: string[]; rota?: string; correcaoAutomatica?: string
  registrosAfetados: number; esforco: string
}
interface CausaRaiz {
  causa: string; tipo: string; severidade: Severidade; ocorrencias: number
  registrosAfetados: number; capacidadesAfetadas: string[]; acao: string; rota?: string
}
interface Contrato {
  cadastro: string; rotulo: string; rota: string; totalAtivos: number
  incompletos: { id: number; rotulo: string; faltando: string[] }[]; requisitos: string[]
}
interface Historico {
  execucoes: { id: number; modo: string; estado: Estado; criadoEm: string; duracaoMs: number; coberturaPercentual: number; criticos: number; erros: number; alertas: number; falhasTecnicas: number }[]
  tendencia: { totalAchados: number; abertos: number; resolvidos: number; recorrentes: number; reincidentes: number; tempoMedioResolucaoHoras: number | null }
  porDominio: { dominio: string; total: number; abertos: number; criticos: number }[]
}
interface Resposta {
  capacidades: CapacidadeAvaliada[]
  contratos: Contrato[]
  plano: Recomendacao[]
  causasRaiz: CausaRaiz[]
  superficie: Record<string, string[]>
  matriz: { modulo: string; capacidades: number; capacidadesProntas: number; verificacoes: number; temTesteFuncional: boolean }[]
  totalCapacidades: number
  execucao: Execucao | null
  estadoAtual: Estado
  motivoEstado: string
  achados: Achado[]
  catalogo: VerificacaoMeta[]
  cobertura: CoberturaDominio[]
  dominiosSemCobertura: string[]
  versaoCatalogo: string
  rotulos: {
    dominios: Record<string, string>; estados: Record<Estado, string>; severidades: Record<Severidade, string>
    prontidao: Record<EstadoProntidao, string>; dependencias: Record<string, string>
  }
}

const CORES_PRONTIDAO: Record<EstadoProntidao, string> = {
  PRONTO: "bg-green-50 text-green-700 border-green-200",
  PARCIALMENTE_PRONTO: "bg-amber-50 text-amber-700 border-amber-200",
  NAO_CONFIGURADO: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIGURACAO_INVALIDA: "bg-amber-50 text-amber-700 border-amber-200",
  BLOQUEADO: "bg-red-50 text-red-700 border-red-200",
  DIAGNOSTICO_INCOMPLETO: "bg-slate-50 text-slate-700 border-slate-200",
}

const CARD = "rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm"
const CORES_ESTADO: Record<Estado, { fundo: string; texto: string; ponto: string }> = {
  SAUDAVEL: { fundo: "bg-green-50 border-green-200", texto: "text-green-700", ponto: "bg-green-400" },
  ATENCAO: { fundo: "bg-amber-50 border-amber-200", texto: "text-amber-700", ponto: "bg-amber-400" },
  DEGRADADO: { fundo: "bg-amber-50 border-amber-200", texto: "text-amber-700", ponto: "bg-amber-400" },
  CRITICO: { fundo: "bg-red-50 border-red-200", texto: "text-red-700", ponto: "bg-red-400" },
  DIAGNOSTICO_INCOMPLETO: { fundo: "bg-slate-50 border-slate-200", texto: "text-slate-700", ponto: "bg-slate-400" },
  INDISPONIVEL: { fundo: "bg-[var(--surface-primary)] border-[var(--border-strong)]", texto: "text-white/70", ponto: "bg-[var(--surface-elevated)]" },
}
const CORES_SEV: Record<Severidade, string> = {
  CRITICO: "bg-red-50 text-red-700 border-red-200",
  ERRO: "bg-amber-50 text-amber-700 border-amber-200",
  ALERTA: "bg-amber-50 text-amber-700 border-amber-200",
  INFORMATIVO: "bg-sky-50 text-sky-700 border-sky-200",
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
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}

type Aba = "visao" | "prontidao" | "falta" | "plano" | "problemas" | "capacidades" | "dominios" | "cobertura" | "execucao" | "historico"

export function SaudeSistemaTab() {
  const { dados, carregando, erro: erroApi, recarregar } = useApi<Resposta>("/api/gerenciamento/saude")
  const [aba, setAba] = useState<Aba>("visao")
  const [executando, setExecutando] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [filtroSev, setFiltroSev] = useState<"" | Severidade>("")
  const [filtroDominio, setFiltroDominio] = useState("")
  const [corrigindo, setCorrigindo] = useState<string | null>(null)
  const historicoReq = useApi<Historico>("/api/gerenciamento/saude/historico")

  // CORREÇÃO AUTOMÁTICA — só existe para o que o catálogo declara seguro. O
  // resultado NÃO se autodeclara resolvido: o achado vai para "em correção" e a
  // próxima execução do diagnóstico é que decide.
  const corrigir = useCallback(async (a: Achado) => {
    if (!a.correcaoAutomatica) return
    setCorrigindo(a.chave)
    setMensagem(`Executando correção "${a.correcaoAutomatica}"…`)
    try {
      const res = await fetch("/api/gerenciamento/saude/corrigir", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ correcao: a.correcaoAutomatica, chaveAchado: a.chave }),
      })
      const j = await res.json().catch(() => ({}))
      setMensagem(res.ok
        ? `${j.correcao?.nome ?? "Correção"}: ${j.resultado?.mensagem ?? "concluída"} — rode o diagnóstico para confirmar a resolução.`
        : (j.error ?? "A correção falhou."))
      if (res.ok) recarregar()
    } catch (e) {
      setMensagem(`Falha ao corrigir: ${String((e as Error)?.message ?? e)}`)
    } finally {
      setCorrigindo(null)
    }
  }, [recarregar])

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

  if (carregando) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando a saúde do sistema…</div>
  if (erroApi || !dados) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
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
              <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">catálogo v{dados.versaoCatalogo}</span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-white/70">{dados.motivoEstado}</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {e
                ? `Última execução: ${fmtData(e.concluidoEm)} · modo ${e.modo.toLowerCase()} · ${fmtDur(e.duracaoMs)} · cobertura ${e.coberturaPercentual}% (${e.executadas}/${e.totalElegiveis})`
                : "O diagnóstico nunca foi executado neste ambiente."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={executando} onClick={() => executar("RAPIDO")}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs font-medium text-white/85 hover:bg-[var(--surface-hover)] disabled:opacity-50">
              Diagnóstico rápido
            </button>
            <button disabled={executando} onClick={() => executar("COMPLETO")}
              className="rounded-lg bg-[var(--action-primary)] px-3 py-2 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">
              Executar diagnóstico completo
            </button>
            <button disabled={executando} onClick={() => executar("PROFUNDO")}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs font-medium text-white/85 hover:bg-[var(--surface-hover)] disabled:opacity-50">
              Profundo
            </button>
          </div>
        </div>
        {mensagem && <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-black/20 px-3 py-2 text-xs text-white/70">{mensagem}</div>}
      </div>

      {/* ── CARDS ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi valor={e?.criticos ?? "—"} label="Críticos" cor={(e?.criticos ?? 0) > 0 ? "#f87171" : "#4ade80"} destaque={(e?.criticos ?? 0) > 0} />
        <Kpi valor={e?.erros ?? "—"} label="Erros" cor={(e?.erros ?? 0) > 0 ? "#fb923c" : "#4ade80"} />
        <Kpi valor={e?.alertas ?? "—"} label="Alertas" cor={(e?.alertas ?? 0) > 0 ? "#fbbf24" : "#4ade80"} />
        <Kpi valor={e?.informativos ?? "—"} label="Informativos" cor="#0369a1" />
        <Kpi valor={`${e?.coberturaPercentual ?? 0}%`} label="Cobertura" cor={(e?.coberturaPercentual ?? 0) === 100 ? "#4ade80" : "#fbbf24"} />
        <Kpi valor={e?.naoExecutadas ?? "—"} label="Não executadas" cor={(e?.naoExecutadas ?? 0) > 0 ? "#c4b5fd" : "#4ade80"} />
        <Kpi valor={e?.falhasTecnicas ?? "—"} label="Falha técnica" cor={(e?.falhasTecnicas ?? 0) > 0 ? "#f87171" : "#4ade80"} />
        <Kpi valor={novos} label="Problemas novos" />
        <Kpi valor={recorrentes} label="Recorrentes" cor={recorrentes > 0 ? "#fbbf24" : undefined} />
        <Kpi valor={`${dados.catalogo.filter((v) => v.ativo).length}`} label="Verificações no catálogo" />
      </div>

      {/* ── ABAS ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--border-default)] text-sm">
        {([
          ["visao", "Visão geral"],
          ["prontidao", `Prontidão (${dados.capacidades.filter(c => c.estado === "PRONTO").length}/${dados.capacidades.length})`],
          ["falta", `O que falta (${dados.plano.length})`],
          ["plano", "Plano de correção"],
          ["problemas", `Problemas (${dados.achados.length})`],
          ["capacidades", "Capacidades"],
          ["dominios", "Domínios"],
          ["cobertura", "Cobertura"],
          ["execucao", "Execução"],
          ["historico", "Histórico"],
        ] as [Aba, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-3 py-2 ${aba === k ? "border-b-2 border-blue-400 font-medium text-white" : "text-[var(--text-secondary)] hover:text-white/80"}`}>
            {l}
          </button>
        ))}
      </div>

      {aba === "visao" && (
        <div className="space-y-3">
          {dados.dominiosSemCobertura.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-100">
              <b>{dados.dominiosSemCobertura.length} domínio(s) obrigatório(s) ainda sem verificação.</b> Enquanto houver lacuna de cobertura,
              o sistema não pode ser declarado saudável — o motor devolve “diagnóstico incompleto” de propósito.
              <div className="mt-1 text-xs text-slate-700/80">
                {dados.dominiosSemCobertura.map((d) => rot.dominios[d] ?? d).join(" · ")}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ["Capacidades prontas", `${dados.capacidades.filter((c) => c.estado === "PRONTO").length}/${dados.capacidades.length}`],
              ["Capacidades bloqueadas", String(dados.capacidades.filter((c) => c.estado === "BLOQUEADO").length)],
              ["Ações no plano", String(dados.plano.length)],
              ["Causas raiz", String(dados.causasRaiz.length)],
            ] as [string, string][]).map(([rotulo, valor]) => (
              <div key={rotulo} className={`${CARD} px-4 py-3`}>
                <div className="text-xs text-[var(--text-secondary)]">{rotulo}</div>
                <div className="mt-0.5 text-xl font-semibold text-white">{valor}</div>
              </div>
            ))}
          </div>
          {dados.capacidades.some((c) => c.estado === "BLOQUEADO") && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-100">
              <b>Há capacidade operacional bloqueada.</b> Enquanto uma operação essencial não puder ser executada de ponta a ponta,
              o sistema não é declarado saudável, mesmo sem erro técnico aparente.
              <div className="mt-1 text-xs text-red-700/80">
                {dados.capacidades.filter((c) => c.estado === "BLOQUEADO").map((c) => c.nome).join(" · ")}
              </div>
            </div>
          )}
          {dados.achados.slice(0, 8).map((a) => <LinhaAchado key={a.id} a={a} rot={rot} onCorrigir={corrigir} corrigindo={corrigindo === a.chave} />)}
          {dados.achados.length === 0 && e && (
            <div className={`${CARD} px-4 py-6 text-center text-sm text-[var(--text-secondary)]`}>
              Nenhum problema aberto nas verificações executadas.
            </div>
          )}
        </div>
      )}

      {aba === "prontidao" && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Prontidão operacional responde a uma pergunta diferente de “há erro?”: pergunta se cada operação essencial
            <b className="text-white/70"> pode ser executada hoje, de ponta a ponta</b>, com os cadastros, configurações e vínculos que existem.
          </p>
          {dados.capacidades.map((c) => (
            <div key={c.codigo} className={`${CARD} px-4 py-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${CORES_PRONTIDAO[c.estado]}`}>{rot.prontidao[c.estado] ?? c.estado}</span>
                <span className="font-medium text-white">{c.nome}</span>
                <span className="text-xs text-[var(--text-muted)]">{c.codigo} · {c.modulo}</span>
              </div>
              <div className="mt-1 text-sm text-white/70">{c.motivo}</div>
              <div className="mt-2 grid gap-1">
                {c.dependencias.map((d) => (
                  <div key={d.codigo} className="flex items-start gap-2 text-xs">
                    <span className={d.indeterminada ? "text-slate-700" : d.ok ? "text-green-700" : d.obrigatoria ? "text-red-700" : "text-amber-700"}>
                      {d.indeterminada ? "?" : d.ok ? "✓" : "✕"}
                    </span>
                    <span className="text-[var(--text-secondary)]">{rot.dependencias[d.tipo] ?? d.tipo}</span>
                    <span className="text-white/70">{d.nome}</span>
                    <span className="text-[var(--text-muted)]">— {d.detalhe}</span>
                    {!d.obrigatoria && <span className="text-[var(--text-muted)]">(recomendada)</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {aba === "falta" && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            O que está faltando para o sistema operar — cadastros, configurações, vínculos e automações ausentes. Nada aqui é excluído
            ou corrigido sozinho: o motor aponta, quem decide é você.
          </p>
          {dados.causasRaiz.length > 0 && (
            <div className={`${CARD} px-4 py-3`}>
              <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Causas raiz</div>
              <div className="mt-2 space-y-1.5">
                {dados.causasRaiz.map((c) => (
                  <div key={c.causa} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${CORES_SEV[c.severidade]}`}>{rot.severidades[c.severidade]}</span>
                    <span className="text-white">{c.causa}</span>
                    <span className="text-xs text-[var(--text-secondary)]">{c.ocorrencias} ocorrência(s) · {c.registrosAfetados} registro(s)</span>
                    {c.capacidadesAfetadas.length > 0 && (
                      <span className="text-xs text-[var(--text-muted)]">afeta: {c.capacidadesAfetadas.join(", ")}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {dados.contratos.map((c) => (
            <div key={c.cadastro} className={`${CARD} px-4 py-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-white">{c.rotulo}</span>
                <span className="text-xs text-[var(--text-muted)]">{c.totalAtivos} ativo(s)</span>
                {c.incompletos.length === 0
                  ? <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">contrato mínimo cumprido</span>
                  : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{c.incompletos.length} incompleto(s)</span>}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">Exige: {c.requisitos.join(" · ")}</div>
              {c.incompletos.slice(0, 8).map((i) => (
                <div key={i.id} className="mt-1 text-xs text-[var(--text-secondary)]">
                  <span className="text-white/80">{i.rotulo}</span> — falta {i.faltando.join(", ")}
                </div>
              ))}
              {c.incompletos.length > 8 && <div className="mt-1 text-xs text-[var(--text-muted)]">e mais {c.incompletos.length - 8}…</div>}
            </div>
          ))}
          {dados.plano.length === 0 && dados.contratos.every((c) => !c.incompletos.length) && (
            <div className={`${CARD} px-4 py-6 text-center text-sm text-[var(--text-secondary)]`}>
              Nenhuma lacuna de configuração detectada nas capacidades declaradas.
            </div>
          )}
        </div>
      )}

      {aba === "plano" && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Plano ordenado: cada ação aparece depois daquilo de que ela depende. Resolver na ordem evita trabalho perdido.
          </p>
          {dados.plano.map((r) => (
            <div key={r.codigo} className={`${CARD} px-4 py-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-white/70">{r.ordem}º</span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${CORES_SEV[r.severidade]}`}>{rot.severidades[r.severidade]}</span>
                <span className="font-medium text-white">{r.titulo}</span>
                <span className="text-xs text-[var(--text-muted)]">{rot.dependencias[r.tipo] ?? r.tipo} · esforço {r.esforco.toLowerCase()}</span>
              </div>
              <div className="mt-1 grid gap-0.5 text-xs">
                <div className="text-white/70"><span className="text-[var(--text-muted)]">Problema: </span>{r.problema}</div>
                <div className="text-white/70"><span className="text-[var(--text-muted)]">Causa: </span>{r.causa}</div>
                <div className="text-white/70"><span className="text-[var(--text-muted)]">Impacto: </span>{r.impacto}</div>
                <div className="text-white/85"><span className="text-[var(--text-muted)]">Ação: </span>{r.acao}</div>
                {r.destrava.length > 0 && <div className="text-[var(--text-secondary)]">Destrava: {r.destrava.join(", ")}</div>}
              </div>
              {r.rota && (
                <a href={r.rota} className="mt-2 inline-block rounded-lg border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/80 hover:bg-[var(--surface-hover)]">
                  Abrir cadastro
                </a>
              )}
            </div>
          ))}
          {dados.plano.length === 0 && (
            <div className={`${CARD} px-4 py-6 text-center text-sm text-[var(--text-secondary)]`}>Nada pendente no plano de correção.</div>
          )}
        </div>
      )}

      {aba === "capacidades" && (
        <div className={`${CARD} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
              <tr>
                <th className="px-4 py-3">Capacidade</th><th className="px-4 py-3">Módulo</th>
                <th className="px-4 py-3">Dependências</th><th className="px-4 py-3">Faltando</th><th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {dados.capacidades.map((c) => (
                <tr key={c.codigo} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="px-4 py-2.5 text-white">{c.nome}<div className="text-[10px] text-[var(--text-muted)]">{c.codigo}</div></td>
                  <td className="px-4 py-2.5 text-white/70">{c.modulo}</td>
                  <td className="px-4 py-2.5 text-white/70">{c.dependencias.length}</td>
                  <td className="px-4 py-2.5 text-white/70">{c.faltantes.length}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${CORES_PRONTIDAO[c.estado]}`}>{rot.prontidao[c.estado] ?? c.estado}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aba === "problemas" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={filtroSev} onChange={(ev) => setFiltroSev(ev.target.value as "" | Severidade)}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white">
              <option value="" className="bg-zinc-900">Todas as severidades</option>
              {(["CRITICO", "ERRO", "ALERTA", "INFORMATIVO"] as Severidade[]).map((s) => (
                <option key={s} value={s} className="bg-zinc-900">{rot.severidades[s]}</option>
              ))}
            </select>
            <select value={filtroDominio} onChange={(ev) => setFiltroDominio(ev.target.value)}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white">
              <option value="" className="bg-zinc-900">Todos os domínios</option>
              {[...new Set(dados.achados.map((a) => a.dominio))].map((d) => (
                <option key={d} value={d} className="bg-zinc-900">{rot.dominios[d] ?? d}</option>
              ))}
            </select>
            <span className="self-center text-xs text-[var(--text-muted)]">{achadosFiltrados.length} problema(s)</span>
          </div>
          {achadosFiltrados.map((a) => <LinhaAchado key={a.id} a={a} rot={rot} detalhado onCorrigir={corrigir} corrigindo={corrigindo === a.chave} />)}
          {achadosFiltrados.length === 0 && (
            <div className={`${CARD} px-4 py-6 text-center text-sm text-[var(--text-secondary)]`}>Nenhum problema com estes filtros.</div>
          )}
        </div>
      )}

      {aba === "dominios" && (
        <div className={`${CARD} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
              <tr><th className="px-4 py-3">Domínio</th><th className="px-4 py-3">Problemas</th><th className="px-4 py-3">Pior severidade</th></tr>
            </thead>
            <tbody>
              {[...new Set(dados.achados.map((a) => a.dominio))].map((d) => {
                const doDominio = dados.achados.filter((a) => a.dominio === d)
                const pior = (["CRITICO", "ERRO", "ALERTA", "INFORMATIVO"] as Severidade[]).find((s) => doDominio.some((a) => a.severidade === s))!
                return (
                  <tr key={d} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="px-4 py-2.5 text-white">{rot.dominios[d] ?? d}</td>
                    <td className="px-4 py-2.5 text-white/70">{doDominio.length}</td>
                    <td className="px-4 py-2.5"><span className={`rounded border px-1.5 py-0.5 text-[10px] ${CORES_SEV[pior]}`}>{rot.severidades[pior]}</span></td>
                  </tr>
                )
              })}
              {dados.achados.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Nenhum domínio com problema aberto.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {aba === "cobertura" && (
        <div className="space-y-3">
        <div className={`${CARD} overflow-hidden`}>
          <div className="border-b border-[var(--border-default)] px-4 py-2.5 text-xs uppercase tracking-wide text-[var(--text-muted)]">Matriz por módulo</div>
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
              <tr><th className="px-4 py-3">Módulo</th><th className="px-4 py-3">Capacidades prontas</th><th className="px-4 py-3">Verificações</th><th className="px-4 py-3">Situação</th></tr>
            </thead>
            <tbody>
              {dados.matriz.map((m) => (
                <tr key={m.modulo} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="px-4 py-2.5 text-white">{m.modulo}</td>
                  <td className="px-4 py-2.5 text-white/70">{m.capacidades ? `${m.capacidadesProntas}/${m.capacidades}` : "—"}</td>
                  <td className="px-4 py-2.5 text-white/70">{m.verificacoes}</td>
                  <td className="px-4 py-2.5">
                    {m.capacidades === 0
                      ? <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700">sem capacidade declarada</span>
                      : m.capacidadesProntas === m.capacidades
                        ? <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">operacional</span>
                        : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">parcial</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`${CARD} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
              <tr><th className="px-4 py-3">Domínio obrigatório</th><th className="px-4 py-3">Verificações</th><th className="px-4 py-3">Obrigatórias</th><th className="px-4 py-3">Situação</th></tr>
            </thead>
            <tbody>
              {dados.cobertura.map((c) => (
                <tr key={c.dominio} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="px-4 py-2.5 text-white">{rot.dominios[c.dominio] ?? c.dominio}</td>
                  <td className="px-4 py-2.5 text-white/70">{c.ativas}</td>
                  <td className="px-4 py-2.5 text-white/70">{c.obrigatorias}</td>
                  <td className="px-4 py-2.5">
                    {c.ativas > 0
                      ? <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700">coberto</span>
                      : <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700">sem cobertura</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {aba === "historico" && (
        <div className="space-y-4">
          {(() => {
            const h = historicoReq.dados
            if (historicoReq.carregando) return <div className="py-10 text-center text-[var(--text-secondary)]">Carregando histórico…</div>
            if (!h) return <div className={`${CARD} px-4 py-6 text-center text-sm text-[var(--text-secondary)]`}>Sem histórico disponível.</div>
            return (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Kpi valor={h.tendencia.totalAchados} label="Achados no histórico" />
                  <Kpi valor={h.tendencia.abertos} label="Abertos" cor={h.tendencia.abertos > 0 ? "#fbbf24" : "#4ade80"} />
                  <Kpi valor={h.tendencia.resolvidos} label="Resolvidos" cor="#15803d" />
                  <Kpi valor={h.tendencia.recorrentes} label="Recorrentes" />
                  <Kpi valor={h.tendencia.reincidentes} label="Reincidentes" cor={h.tendencia.reincidentes > 0 ? "#f87171" : undefined} />
                  <Kpi valor={h.tendencia.tempoMedioResolucaoHoras != null ? `${h.tendencia.tempoMedioResolucaoHoras}h` : "—"} label="Tempo médio de resolução" />
                </div>

                <div className={`${CARD} overflow-hidden`}>
                  <div className="border-b border-[var(--border-default)] px-4 py-3 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Execuções (mais recente por último)</div>
                  <table className="w-full text-sm">
                    <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
                      <tr><th className="px-4 py-3">Quando</th><th className="px-4 py-3">Modo</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Cobertura</th><th className="px-4 py-3">Achados</th><th className="px-4 py-3">Duração</th></tr>
                    </thead>
                    <tbody>
                      {h.execucoes.map((x) => {
                        const c = CORES_ESTADO[x.estado] ?? CORES_ESTADO.INDISPONIVEL
                        return (
                          <tr key={x.id} className="border-b border-[var(--border-subtle)] last:border-0">
                            <td className="px-4 py-2.5 text-white/70">{fmtData(x.criadoEm)}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{x.modo.toLowerCase()}</td>
                            <td className="px-4 py-2.5"><span className={`rounded px-1.5 py-0.5 text-[10px] ${c.texto}`}>{rot.estados[x.estado] ?? x.estado}</span></td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{x.coberturaPercentual}%</td>
                            <td className="px-4 py-2.5 text-white/70">{x.criticos}C · {x.erros}E · {x.alertas}A{x.falhasTecnicas ? ` · ${x.falhasTecnicas} falha(s)` : ""}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDur(x.duracaoMs)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className={`${CARD} overflow-hidden`}>
                  <div className="border-b border-[var(--border-default)] px-4 py-3 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Domínios que mais falham</div>
                  <table className="w-full text-sm">
                    <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
                      <tr><th className="px-4 py-3">Domínio</th><th className="px-4 py-3">Abertos</th><th className="px-4 py-3">Total histórico</th><th className="px-4 py-3">Críticos</th></tr>
                    </thead>
                    <tbody>
                      {h.porDominio.slice(0, 15).map((d) => (
                        <tr key={d.dominio} className="border-b border-[var(--border-subtle)] last:border-0">
                          <td className="px-4 py-2.5 text-white">{rot.dominios[d.dominio] ?? d.dominio}</td>
                          <td className="px-4 py-2.5 text-white/70">{d.abertos}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{d.total}</td>
                          <td className="px-4 py-2.5 text-white/70">{d.criticos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {aba === "execucao" && (
        <div className={`${CARD} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
              <tr><th className="px-4 py-3">Verificação</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Duração</th><th className="px-4 py-3">Resultado</th></tr>
            </thead>
            <tbody>
              {(e?.execucoes ?? []).map((x) => {
                const meta = dados.catalogo.find((v) => v.codigo === x.codigo)
                const cores = x.status === "APROVADA" ? "bg-green-50 text-green-700"
                  : x.status === "COM_ACHADOS" ? "bg-amber-50 text-amber-700"
                  : x.status === "NAO_EXECUTADA" ? "bg-slate-50 text-slate-700"
                  : "bg-red-50 text-red-700"
                return (
                  <tr key={x.codigo} className="border-b border-[var(--border-subtle)] last:border-0 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-[11px] text-[var(--text-secondary)]">{x.codigo}</div>
                      <div className="text-white">{meta?.nome ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2.5"><span className={`rounded px-1.5 py-0.5 text-[10px] ${cores}`}>{x.status.replace("_", " ").toLowerCase()}</span></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDur(x.duracaoMs)}</td>
                    <td className="px-4 py-2.5 text-white/70">
                      {x.erro ? <span className="text-red-700">{x.erro}</span> : x.achados > 0 ? `${x.achados} achado(s)` : (x.resumo ?? "sem achados")}
                    </td>
                  </tr>
                )
              })}
              {!e && <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Nenhuma execução registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LinhaAchado({ a, rot, detalhado, onCorrigir, corrigindo }: {
  a: Achado; rot: Resposta["rotulos"]; detalhado?: boolean
  onCorrigir?: (a: Achado) => void; corrigindo?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className={`${CARD} overflow-hidden`}>
      <button onClick={() => setAberto((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--surface-hover)]">
        <span className={`mt-0.5 flex-none rounded border px-1.5 py-0.5 text-[10px] ${CORES_SEV[a.severidade]}`}>{rot.severidades[a.severidade]}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white">{a.titulo}</span>
          <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{a.descricao}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <span className="font-mono">{a.codigo}</span>
            <span>{rot.dominios[a.dominio] ?? a.dominio}</span>
            <span>{a.modulo}</span>
            {a.recorrencias > 1 && <span className="rounded bg-amber-50 px-1.5 text-amber-700">recorrente ({a.recorrencias}×)</span>}
            {a.recorrencias <= 1 && <span className="rounded bg-sky-50 px-1.5 text-sky-700">novo</span>}
            <span>detectado em {fmtData(a.primeiraDeteccao)}</span>
          </span>
        </span>
      </button>
      {(aberto || detalhado) && (
        <div className="border-t border-[var(--border-default)] px-4 py-3 text-xs text-white/70">
          {a.explicacao && <p className="mb-2"><b className="text-white/85">Por que:</b> {a.explicacao}</p>}
          {a.impacto && <p className="mb-2"><b className="text-white/85">Impacto:</b> {a.impacto}</p>}
          {a.recomendacao && <p className="mb-2"><b className="text-white/85">Como corrigir:</b> {a.recomendacao}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {a.entidade && <span>Entidade: <span className="text-white/85">{a.entidade}</span>{a.registroNome ? ` — ${a.registroNome}` : ""}</span>}
            <span>Afetados: <span className="text-white/85">{a.quantidade}</span></span>
            <span>Última detecção: <span className="text-white/85">{fmtData(a.ultimaDeteccao)}</span></span>
            {a.correcaoAutomatica && onCorrigir && (
              <button disabled={corrigindo} onClick={() => onCorrigir(a)}
                className="rounded-lg border border-green-200 bg-green-50 px-2 py-1 font-medium text-green-700 hover:bg-green-50 disabled:opacity-50">
                {corrigindo ? "Corrigindo…" : "Corrigir automaticamente"}
              </button>
            )}
            {a.link && (
              <a href={a.link} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1 text-white/85 hover:bg-[var(--surface-hover)]">
                Ir para o registro →
              </a>
            )}
          </div>
          {a.evidencia != null && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-[var(--border-default)] bg-black/30 p-2 text-[11px] text-[var(--text-secondary)]">
              {JSON.stringify(a.evidencia, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default SaudeSistemaTab
