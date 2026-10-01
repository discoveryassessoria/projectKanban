"use client"
// src/components/torre/TorreSaudeDaFase.tsx — cartão "Saúde da fase" (aba Processos): no ritmo · atenção · parados · tempo médio real
// (vermelho se passou da meta, verde se não) · barra empilhada · frase da semana. Os números vêm de `saudeDaFase` (lib/operacional/torre-fase.ts).
import { milhar, textoDuracao, type SaudeDaFase } from "@/lib/operacional/torre-fase"
import "./torre-processos.css"

export function TorreSaudeDaFase({ s }: { s: SaudeDaFase }) {
  const tempo = s.tempoMedioDias == null ? "—" : textoDuracao(Math.round(s.tempoMedioDias), null)
  return (
    <section className="tor-pf-cartao" aria-label="Saúde da fase">
      <div className="tor-pf-rotulo">Saúde da fase</div>
      <div className="tor-pf-numeros">
        <div className="tor-pf-numero"><b className="ok">{milhar(s.ok)}</b><span>no ritmo</span></div>
        <div className="tor-pf-numero"><b className="at">{milhar(s.atencao)}</b><span>atenção</span></div>
        <div className="tor-pf-numero"><b className="pa">{milhar(s.parados)}</b><span>parados</span></div>
        <div className="tor-pf-numero">
          <b className={s.acimaDaMeta ? "pa" : "ok"} title={s.tempoMedioDias == null ? "Nenhuma permanência completa registrada nesta fase" : "Média das permanências completas registradas no histórico de fases"}>{tempo}</b>
          <span>tempo médio real · meta {s.metaDias != null ? `${s.metaDias} d` : "—"}</span>
        </div>
      </div>
      <div className="tor-pf-barra" role="img" aria-label={`${s.ok} no ritmo, ${s.atencao} em atenção, ${s.parados} parados`}>
        <i className="ok" style={{ width: `${s.barra.ok}%` }} /><i className="at" style={{ width: `${s.barra.atencao}%` }} /><i className="pa" style={{ width: `${s.barra.parados}%` }} />
      </div>
      <div className="tor-pf-texto">{s.semana}</div>
    </section>
  )
}
