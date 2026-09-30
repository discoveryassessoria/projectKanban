"use client"
// src/components/torre/TorreRadar.tsx — aba RADAR (Bloco J4): família × fases do CADASTRO.
// A célula da fase atual mostra com quem está a bola e há quantos dias; cor = risco (o score do "Precisa de você").
// Clique numa família ou numa célula abre o Foco. Nada fixo no código: as colunas são as fases ativas do cadastro.
import { textoTempoNaFase } from "@/lib/operacional/torre-predicados"
import { useTorre } from "./torre-base"
import type { CelulaDoRadar, ColunaDoRadar, ProcessoDaTorre } from "./tipos-processos"
import "./torre-radar.css"

const ROTULO_RISCO = { ok: "no ritmo", atencao: "atenção", critico: "crítico" } as const

function Celula({ c, onAbrir }: { c: CelulaDoRadar; onAbrir: () => void }) {
  if (c.estado === "na") return <div className="tor-rc na" title="O macrofluxo deste tipo de processo não tem esta fase">n/a</div>
  if (c.estado === "feita") return <button type="button" className="tor-rc feita" onClick={onAbrir} aria-label="Fase concluída — abrir o foco">✓</button>
  if (c.estado === "atual") {
    return (
      <button type="button" className={`tor-rc atual ${c.risco ?? "ok"}`} onClick={onAbrir} title="Fase atual">
        <span>{c.bola ?? "—"} · {textoTempoNaFase({ dias: c.dias ?? null, horas: c.horas ?? null })}</span>
        <small>{ROTULO_RISCO[c.risco ?? "ok"]}</small>
      </button>
    )
  }
  return (
    <button type="button" className={`tor-rc futura ${c.semPassos ? "sempassos" : ""}`} onClick={onAbrir} title={c.semPassos ? "Esta fase não tem passo executável (achado aberto no Saúde)" : undefined}>
      {c.semPassos ? "sem passos" : "—"}
    </button>
  )
}

export function TorreRadar({ colunas, processos, carregando, erro }: { colunas: ColunaDoRadar[]; processos: ProcessoDaTorre[]; carregando: boolean; erro: string | null }) {
  const { abrirFoco } = useTorre()
  if (erro) return <div className="tor-card pad">{erro}</div>
  if (carregando) return <div className="tor-card pad small">Carregando o radar…</div>
  if (processos.length === 0) return <div className="tor-card pad small">Nenhum processo ativo.</div>
  return (
    <div>
      <div className="small mb-2">Família × fase. A célula da fase atual mostra de quem é a bola e há quantos dias. Cor = risco (atraso nosso, cobrança vencida, sem dono). Clique numa família para abrir o foco.</div>
      <div className="tor-card">
        <div className="tor-radar">
          <div className="tor-radar-grid" style={{ gridTemplateColumns: `180px repeat(${colunas.length}, minmax(92px, 1fr))` }}>
            <div />
            {colunas.map((c) => (
              <div key={c.key} className="tor-radar-h">{c.label}{c.condicional ? <small>(cond.)</small> : null}</div>
            ))}
            {processos.map((p) => (
              <RadarLinha key={p.processoId} p={p} n={colunas.length} onAbrir={() => abrirFoco(p.processoId)} />
            ))}
          </div>
        </div>
        <div className="tor-legenda">
          <span className="tor-p grn">no ritmo</span>
          <span className="tor-p amb" title="A mesma pontuação do Precisa de você: sem responsável +3, atrasada +4, acompanhamento vencido +2, 2+ cobranças sem resposta +2, fase deixada +3, divergência +3, bloqueada +2">atenção: pontuação 3 a 5 (ex.: sem responsável, acompanhamento vencido, cobranças sem resposta)</span>
          <span className="tor-p red">crítico: pontuação 6 ou mais (ex.: atraso nosso + sem dono, fase deixada, divergência) ou fase sem passos</span>
          <span className="tor-p gry">fase atual</span>
        </div>
      </div>
    </div>
  )
}

function RadarLinha({ p, n, onAbrir }: { p: ProcessoDaTorre; n: number; onAbrir: () => void }) {
  return (
    <>
      <button type="button" className="tor-radar-fam" onClick={onAbrir} aria-label={`Abrir o foco da família ${p.familiaNome}`}>
        <b>{p.familiaNome}</b>
        <div className="small">{p.pais ?? "—"} · {p.codigo ?? "—"}</div>
      </button>
      {Array.from({ length: n }, (_, i) => <Celula key={i} c={p.celulas[i] ?? { estado: "na" }} onAbrir={onAbrir} />)}
    </>
  )
}
