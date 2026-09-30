"use client"
// src/components/torre/TorreProcessos.tsx — aba PROCESSOS (Bloco J4).
// Família, Fase, Progresso real (E9), Dias na fase, Bola com, Risco (score do "Precisa de você"), Próximo marco, Foco e Relatório.
import { textoTempoNaFase } from "@/lib/operacional/torre-predicados"

const ORIGEM_NA_FASE: Record<string, string> = { AVANCO_DE_FASE: "último avanço de fase registrado", CADASTRO_DO_PROCESSO: "abertura do processo — nasceu nesta fase", INSTANCIA_DA_FASE: "criação do workflow da fase" }
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { useTorre } from "./torre-base"
import type { ProcessoDaTorre, RiscoDoProcesso } from "./tipos-processos"
import "./torre-radar.css"

const RISCO: Record<RiscoDoProcesso, { txt: string; cls: string }> = {
  critico: { txt: "Crítico", cls: "red" }, atencao: { txt: "Atenção", cls: "amb" }, ok: { txt: "No ritmo", cls: "grn" },
}

export function TorreProcessos({ processos, carregando, erro }: { processos: ProcessoDaTorre[]; carregando: boolean; erro: string | null }) {
  const { abrirFoco, abrirRelatorio } = useTorre()
  const { pode } = usePermissoes()
  const podeRelatorio = pode("relatorios.ver")
  if (erro) return <div className="tor-card pad">{erro}</div>
  if (carregando) return <div className="tor-card pad small">Carregando processos…</div>
  if (processos.length === 0) return <div className="tor-card pad small">Nenhum processo ativo.</div>
  return (
    <div className="tor-card tor-scroll">
      <div className="tor-hd tor-gProc"><span>Família</span><span>Fase</span><span>Progresso real</span><span>Dias na fase</span><span>Bola com</span><span>Risco</span><span>Próximo marco</span><span /></div>
      {processos.map((p) => {
        const r = RISCO[p.risco]
        const n = p.numeros
        return (
          <div key={p.processoId} className="tor-row tor-gProc">
            <div>
              <b>{p.familiaNome}</b>
              <div className="small">{p.pais ?? "—"} · {p.codigo ?? "—"}</div>
              <div className="small">{n.abertas} abertas · {n.vencidas} vencidas · {n.comCartorio} com o cartório · {n.semResponsavel} sem responsável</div>
            </div>
            <div>{p.faseAtual.label ?? "—"}</div>
            <div>
              <div className="tor-bar-p"><i style={{ width: `${Math.min(100, Math.max(0, p.progresso.percentual))}%` }} /></div>
              <div className="small">{p.progresso.recebidas} de {p.progresso.requeridas} certidões recebidas</div>
            </div>
            <div title={p.naFase.desde ? `Na fase desde ${new Date(p.naFase.desde).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (${ORIGEM_NA_FASE[p.naFase.origem ?? ""] ?? "registro"})` : "Sem registro de quando entrou nesta fase"}>{textoTempoNaFase(p.naFase)}</div>
            <div>
              <span className={`tor-p ${p.bola.rotulo === "Nossa" ? "amb" : "blu"}`}>{p.bola.rotulo}</span>
              {p.bola.dias != null && <div className="small">{p.bola.dias === 0 ? "desde hoje" : `há ${p.bola.dias} d`}</div>}
            </div>
            <div><span className={`tor-p ${r.cls}`}>{r.txt}</span></div>
            <div className="small">{p.proximoMarco ?? "—"}</div>
            <div className="flex gap-1">
              <button type="button" className="tor-btn pri" onClick={() => abrirFoco(p.processoId)}>Foco</button>
              {podeRelatorio && (
                <button type="button" className="tor-btn" onClick={() => abrirRelatorio({ processoId: p.processoId, familiaId: p.familiaId, familiaNome: p.familiaNome, codigo: p.codigo })}>Relatório</button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
