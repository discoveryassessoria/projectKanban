// src/components/gerenciamentoComponents/CapacidadeOperacionalTab.tsx
// ============================================================================
// EQUIPES E CAPACIDADE OPERACIONAL.
//
// O que esta tela responde, por funcionário: de que equipes participa, para que
// trabalho está apto, se está disponível, quanto aguenta e quanto já carrega.
//
// ─── O QUE ELA NÃO É ────────────────────────────────────────────────────────
// Não é ranking e não é produtividade. Não há nota, não há posição, não há
// comparação entre pessoas. Os números são de CARGA — o que cada um tem na mão
// agora —, e existem para decidir quem pode receber mais, não para julgar quem
// trabalha melhor. Ordenar por "quem tem menos" transformaria a mesma tabela
// num placar, e por isso a ordem é alfabética e fixa.
//
// ─── ELA NÃO AUTORIZA NINGUÉM ───────────────────────────────────────────────
// Aptidão, disponibilidade e capacidade só RESTRINGEM quem já tem permissão.
// Quem não pode executar tarefa aparece marcado — e nenhuma configuração aqui
// muda isso, porque autorização se concede em Perfis e Permissões.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

interface Indisponibilidade {
  id: number
  tipo: string
  inicio: string
  fim: string | null
  motivo: string | null
}
interface Linha {
  usuarioId: number
  nome: string
  email: string
  perfil: string
  podeExecutar: boolean
  equipes: Array<{ id: number; code: string | null; nome: string }>
  aptidoes: string[]
  indisponivelPor: Indisponibilidade | null
  indisponibilidades: Indisponibilidade[]
  limiteExecutaveis: number | null
  observacaoCapacidade: string | null
  carga: { ativas: number; executaveis: number; atrasadas: number; urgentes: number; aguardandoTerceiro: number; bloqueadas: number }
}
interface Dados {
  linhas: Linha[]
  fases: Array<{ faseKey: string; label: string }>
  tipos: string[]
}

const ROTULO_TIPO: Record<string, string> = {
  FERIAS: "Férias",
  AFASTAMENTO: "Afastamento",
  AUSENCIA: "Ausência",
  BLOQUEIO_OPERACIONAL: "Bloqueio operacional",
}

const auth = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
})

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"

export default function CapacidadeOperacionalTab() {
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [aberta, setAberta] = useState<number | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [busca, setBusca] = useState("")

  useEffect(() => {
    let vivo = true
    fetch("/api/operacao/capacidade", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Dados) => { if (vivo) { setDados(d); setErro(null) } })
      .catch((e) => { if (vivo) setErro(String(e).includes("403") ? "Você não tem permissão para esta área." : "Não foi possível carregar.") })
    return () => { vivo = false }
  }, [recarga])

  const salvar = useCallback(async (corpo: Record<string, unknown>) => {
    setOcupado(true)
    setErro(null)
    try {
      const r = await fetch("/api/operacao/capacidade", { method: "PATCH", headers: auth(), body: JSON.stringify(corpo) })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErro(d?.error ?? `Falha (HTTP ${r.status}).`)
        return false
      }
      setRecarga((n) => n + 1)
      return true
    } catch {
      setErro("Não foi possível falar com o servidor.")
      return false
    } finally {
      setOcupado(false)
    }
  }, [])

  // Ordem ALFABÉTICA e fixa: ordenar por carga faria desta tabela um placar.
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (dados?.linhas ?? []).filter((l) =>
      !q || l.nome.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) ||
      l.equipes.some((e) => e.nome.toLowerCase().includes(q)))
  }, [dados, busca])

  if (erro && !dados) {
    return <div className="rounded border border-red-400/25 bg-red-500/10 px-4 py-3 text-[12px] text-red-200/90">{erro}</div>
  }
  if (!dados) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-medium text-white/95">Equipes e capacidade operacional</h2>
        <p className="mt-1 max-w-3xl text-[11px] leading-4 text-white/45">
          Para que trabalho cada pessoa está apta, quando ela não deve receber nada, quanto aguenta e quanto já carrega.
          Nada aqui concede permissão — autorização continua em <span className="text-white/65">Perfis e Permissões</span>.
          Estes números são de carga, não de desempenho.
        </p>
      </div>

      {erro && <div className="rounded border border-red-400/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200/90">{erro}</div>}

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar pessoa ou equipe…"
        className="w-72 rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-white/25 focus:border-white/25 focus:outline-none"
      />

      <div className="overflow-hidden rounded border border-white/[0.08]">
        <table className="w-full border-collapse text-left">
          <thead className="bg-white/[0.03]">
            <tr className="border-b border-white/[0.08]">
              {["Funcionário", "Equipe(s)", "Aptidões", "Disponibilidade", "Capacidade", "Carga ativa", "Executável", "Atrasadas", "Aguardando terceiro", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-white/35">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.usuarioId} className="border-b border-white/[0.05] align-top hover:bg-white/[0.02]">
                <td className="px-3 py-2">
                  <div className="text-[12px] text-white/90">{l.nome}</div>
                  <div className="text-[10px] text-white/35">{l.perfil}</div>
                  {/* A permissão vem primeiro porque sem ela o resto é decorativo. */}
                  {!l.podeExecutar && (
                    <div className="mt-1 inline-flex rounded border border-amber-300/25 bg-amber-400/10 px-1.5 py-[1px] text-[9px] text-amber-200/90">
                      não executa tarefas
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-[11px] text-white/60">
                  {l.equipes.length ? l.equipes.map((e) => e.nome).join(", ") : <span className="text-white/25">—</span>}
                </td>
                <td className="max-w-[220px] px-3 py-2 text-[11px] text-white/60">
                  {l.aptidoes.length ? l.aptidoes.join(", ") : <span className="text-white/25">nenhuma declarada</span>}
                </td>
                <td className="px-3 py-2 text-[11px]">
                  {l.indisponivelPor ? (
                    <span className="text-amber-200/85">
                      {ROTULO_TIPO[l.indisponivelPor.tipo] ?? l.indisponivelPor.tipo}
                      <span className="text-white/35">
                        {l.indisponivelPor.fim ? ` até ${dataCurta(l.indisponivelPor.fim)}` : " (sem retorno)"}
                      </span>
                    </span>
                  ) : (
                    <span className="text-emerald-200/70">disponível</span>
                  )}
                </td>
                <td className="px-3 py-2 text-[11px] tabular-nums text-white/60">
                  {l.limiteExecutaveis == null ? <span className="text-white/25">sem teto</span> : `${l.limiteExecutaveis} executáveis`}
                </td>
                <td className="px-3 py-2 text-[11px] tabular-nums text-white/70">{l.carga.ativas}</td>
                <td className="px-3 py-2 text-[11px] tabular-nums text-white/70">{l.carga.executaveis}</td>
                <td className={`px-3 py-2 text-[11px] tabular-nums ${l.carga.atrasadas > 0 ? "text-red-300/85" : "text-white/50"}`}>{l.carga.atrasadas}</td>
                <td className="px-3 py-2 text-[11px] tabular-nums text-white/50">{l.carga.aguardandoTerceiro}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setAberta(l.usuarioId)}
                    className="rounded border border-white/12 px-2 py-1 text-[10px] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white/90"
                  >
                    Configurar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aberta != null && (
        <PainelConfiguracao
          linha={linhas.find((l) => l.usuarioId === aberta) ?? dados.linhas.find((l) => l.usuarioId === aberta)!}
          fases={dados.fases}
          tipos={dados.tipos}
          ocupado={ocupado}
          aoSalvar={salvar}
          aoFechar={() => setAberta(null)}
        />
      )}
    </div>
  )
}

function PainelConfiguracao({
  linha, fases, tipos, ocupado, aoSalvar, aoFechar,
}: {
  linha: Linha
  fases: Array<{ faseKey: string; label: string }>
  tipos: string[]
  ocupado: boolean
  aoSalvar: (corpo: Record<string, unknown>) => Promise<boolean>
  aoFechar: () => void
}) {
  // A tela mostra o RÓTULO da fase; o que se grava é a chave publicada.
  const chaveDe = (rotulo: string) => fases.find((f) => f.label === rotulo)?.faseKey
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(linha.aptidoes.map(chaveDe).filter((k): k is string => !!k)),
  )
  const [limite, setLimite] = useState(linha.limiteExecutaveis == null ? "" : String(linha.limiteExecutaveis))
  const [tipo, setTipo] = useState(tipos[0] ?? "FERIAS")
  const [inicio, setInicio] = useState(new Date().toISOString().slice(0, 10))
  const [fim, setFim] = useState("")
  const [motivo, setMotivo] = useState("")

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={aoFechar}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0d0f13] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-[14px] font-medium text-white/95">{linha.nome}</h2>
          <p className="mt-0.5 text-[11px] text-white/40">
            {linha.perfil}
            {linha.equipes.length > 0 && ` · ${linha.equipes.map((e) => e.nome).join(", ")}`}
          </p>
          {!linha.podeExecutar && (
            <p className="mt-1.5 rounded border border-amber-300/25 bg-amber-400/10 px-2 py-1 text-[10px] leading-4 text-amber-200/85">
              Esta pessoa não tem permissão de executar tarefa. Nada configurado aqui a torna elegível —
              a permissão se concede em Perfis e Permissões.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {/* ── APTIDÃO ── */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wide text-white/35">Aptidões</h3>
            <p className="mt-1 text-[10px] leading-4 text-white/40">
              Para que fases esta pessoa está apta. Enquanto ninguém for declarado apto para uma fase, ela não restringe
              ninguém — a primeira declaração é que liga a regra.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {fases.map((f) => (
                <label key={f.faseKey} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-white/70 hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    checked={marcadas.has(f.faseKey)}
                    onChange={(e) => setMarcadas((s) => {
                      const n = new Set(s)
                      if (e.target.checked) n.add(f.faseKey); else n.delete(f.faseKey)
                      return n
                    })}
                    className="h-3 w-3 accent-sky-400"
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <button
              disabled={ocupado}
              onClick={() => aoSalvar({ acao: "aptidoes", usuarioId: linha.usuarioId, faseKeys: [...marcadas] })}
              className="mt-2 rounded border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/85 disabled:opacity-40"
            >
              Salvar aptidões
            </button>
          </section>

          {/* ── CAPACIDADE ── */}
          <section className="border-t border-white/[0.06] pt-3">
            <h3 className="text-[10px] uppercase tracking-wide text-white/35">Capacidade</h3>
            <p className="mt-1 text-[10px] leading-4 text-white/40">
              Teto de trabalho EXECUTÁVEL simultâneo. Vazio = sem teto: a comparação segue relativa à carga real.
              Tarefa aguardando terceiro não ocupa lugar.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={limite}
                onChange={(e) => setLimite(e.target.value)}
                placeholder="sem teto"
                className="w-28 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[12px] text-white/85 placeholder:text-white/25 focus:outline-none"
              />
              <span className="text-[11px] text-white/40">executáveis · hoje carrega {linha.carga.executaveis}</span>
              <button
                disabled={ocupado}
                onClick={() => aoSalvar({ acao: "capacidade", usuarioId: linha.usuarioId, limiteExecutaveis: limite === "" ? null : Number(limite) })}
                className="ml-auto rounded border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/85 disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
          </section>

          {/* ── DISPONIBILIDADE ── */}
          <section className="border-t border-white/[0.06] pt-3">
            <h3 className="text-[10px] uppercase tracking-wide text-white/35">Disponibilidade</h3>
            <p className="mt-1 text-[10px] leading-4 text-white/40">
              Período em que a pessoa não deve receber trabalho novo. Sem data de fim = em aberto.
              Encerrar preenche a data; o registro fica, para que o histórico continue explicável.
            </p>

            {linha.indisponibilidades.length > 0 && (
              <div className="mt-2 space-y-1">
                {linha.indisponibilidades.map((i) => {
                  const vigente = linha.indisponivelPor?.id === i.id
                  return (
                    <div key={i.id} className={`flex items-center gap-2 rounded border px-2 py-1.5 text-[11px] ${
                      vigente ? "border-amber-300/25 bg-amber-400/[0.07]" : "border-white/[0.07]"
                    }`}>
                      <span className={vigente ? "text-amber-200/90" : "text-white/50"}>
                        {ROTULO_TIPO[i.tipo] ?? i.tipo}
                      </span>
                      <span className="text-white/35">
                        {dataCurta(i.inicio)} → {i.fim ? dataCurta(i.fim) : "em aberto"}
                      </span>
                      {i.motivo && <span className="truncate text-white/30">{i.motivo}</span>}
                      {vigente && (
                        <button
                          disabled={ocupado}
                          onClick={() => aoSalvar({ acao: "encerrar_indisponibilidade", usuarioId: linha.usuarioId, indisponibilidadeId: i.id })}
                          className="ml-auto rounded border border-white/12 px-2 py-0.5 text-[10px] text-white/60 hover:text-white/90 disabled:opacity-40"
                        >
                          Encerrar agora
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}
                className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none">
                {tipos.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t] ?? t}</option>)}
              </select>
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)}
                className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none" />
              <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} placeholder="fim"
                className="rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/80 focus:outline-none" />
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="motivo (opcional)"
                className="min-w-[140px] flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-white/80 placeholder:text-white/25 focus:outline-none" />
              <button
                disabled={ocupado}
                onClick={() => aoSalvar({
                  acao: "indisponibilizar", usuarioId: linha.usuarioId, tipo,
                  inicio: new Date(`${inicio}T12:00:00`).toISOString(),
                  fim: fim ? new Date(`${fim}T12:00:00`).toISOString() : null,
                  motivo: motivo || null,
                })}
                className="rounded border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/85 disabled:opacity-40"
              >
                Registrar
              </button>
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t border-white/[0.08] px-4 py-2.5">
          <button onClick={aoFechar} className="rounded px-3 py-1.5 text-[11px] text-white/50 hover:text-white/80">Fechar</button>
        </div>
      </div>
    </div>
  )
}
