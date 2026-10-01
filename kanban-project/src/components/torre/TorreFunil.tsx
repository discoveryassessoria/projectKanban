"use client"
// src/components/torre/TorreFunil.tsx — o FUNIL POR FASE da Visão geral (Torre nova, frente B1, 01/10/2026).
// Toda a conta mora em `lib/operacional/torre-funil-puro.ts` (a tela só desenha): total e barra vêm da lista de processos (o risco é o do
// Radar), tempo médio real e meta da rota `/api/torre/funil`, gargalo das linhas de tarefa. Clicar numa fase abre Processos naquela fase.
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { sentidoDoBacklog, hrefDaFase, type Funil, type SemanaDoFunil } from "@/lib/operacional/torre-funil-puro"
import { milhar } from "@/lib/operacional/torre-topo"
import { ROTULO_AGUARDANDO_FECHAMENTO } from "@/src/lib/process-stage/fase-pre-contrato"

const SENTIDO_TEXTO = { cresce: "cresce", diminui: "diminui", estavel: "se mantém" } as const

export function TorreFunil({ funil, semana, carregandoDados, erroDados, aguardandoFechamento }: {
  funil: Funil | null; semana: SemanaDoFunil | null; carregandoDados: boolean; erroDados: string | null
  /** Processos em "Aguardando fechamento" (escopo atual) — linha PRÓPRIA, fora do total e da barra de risco; `null` = ainda sem dado. */
  aguardandoFechamento: number | null
}) {
  const url = useSearchParams()
  const manter = { pais: url.get("pais"), q: url.get("q") }
  const sentido = semana ? sentidoDoBacklog({ tarefasAbertas: semana.tarefasAbertas, tarefasFechadas: semana.tarefasFechadas }) : null
  return (
    <section className="tvg-funil" aria-label="Funil por fase" data-testid="torre-funil">
      <div className="tvg-funil-hd">
        <h2>Funil por fase</h2>
        <p>
          {semana ? (
            <>
              Semana: <b>{semana.processosAbertos === 1 ? "1 processo aberto" : `${milhar(semana.processosAbertos)} processos abertos`} · {semana.protocolados === 1 ? "1 protocolado" : `${milhar(semana.protocolados)} protocolados`}</b>
              {" · "}backlog de tarefas <b className={`tvg-sentido ${sentido}`}>{sentido ? SENTIDO_TEXTO[sentido] : ""}</b> (abre {milhar(semana.tarefasAbertas)}, fecha {milhar(semana.tarefasFechadas)}). Clique numa fase.
            </>
          ) : <>{carregandoDados ? "Carregando a semana…" : erroDados ?? ""} Clique numa fase.</>}
        </p>
        <div className="tvg-legenda" aria-hidden="true">
          <span><i className="ok" />no ritmo</span><span><i className="at" />atenção</span><span><i className="pa" />parado</span>
        </div>
      </div>

      <div className="tvg-funil-scroll">
        <div className="tvg-funil-grid tvg-funil-cab">
          <div>Fase</div><div className="dir">Processos</div><div>Situação</div><div>Tempo médio</div><div>Meta</div><div>Maior gargalo</div>
        </div>
        {funil == null ? <div className="tvg-funil-vazio">Carregando as fases…</div> : funil.linhas.map((f) => (
          <Link key={f.key} href={hrefDaFase(f.key, manter)} prefetch={false} className="tvg-funil-grid tvg-funil-lin" data-fase={f.key} aria-label={`${f.label}: ${f.total} processos. Abrir Processos nesta fase.`}>
            <div className="tvg-fase"><span className="tvg-fase-n">{f.n}</span><span className="tvg-fase-nome">{f.label}</span></div>
            <div className="dir tvg-fase-total">{milhar(f.total)}</div>
            <div className="tvg-sit">
              <div className="tvg-barra" role="img" aria-label={`${f.ritmo} no ritmo, ${f.atencao} atenção, ${f.parados} parados`}>
                <i className="ok" style={{ width: f.pctRitmo }} /><i className="at" style={{ width: f.pctAtencao }} /><i className="pa" style={{ width: f.pctParados }} />
              </div>
              <div className="tvg-sit-txt">{f.ritmo} no ritmo · {f.atencao} atenção · <span className={f.parados > 0 ? "tvg-parados" : ""}>{f.parados} parados</span></div>
            </div>
            <div className={`tvg-tempo ${f.estourou ? "estourou" : ""}`}>{carregandoDados ? "…" : f.tempoTexto}</div>
            <div className="tvg-meta">{carregandoDados ? "…" : f.metaTexto}</div>
            <div className="tvg-gargalo">{f.gargaloTexto}</div>
          </Link>
        ))}
      </div>
      {aguardandoFechamento != null && (
        <p className="tvg-funil-nota" data-testid="torre-funil-aguardando-fechamento">
          <b>{ROTULO_AGUARDANDO_FECHAMENTO}: {milhar(aguardandoFechamento)}</b> — ainda sem tarefas; fora do total e do risco acima.
        </p>
      )}
      {funil && funil.foraDoFunil > 0 && (
        <p className="tvg-funil-nota">{funil.foraDoFunil === 1 ? "1 processo ativo está" : `${funil.foraDoFunil} processos ativos estão`} numa fase fora desta lista e não aparece acima.</p>
      )}
      {erroDados && semana == null && !carregandoDados ? <p className="tvg-funil-nota">{erroDados}</p> : null}
    </section>
  )
}
