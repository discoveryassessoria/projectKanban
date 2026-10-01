"use client"
// src/components/torre/EquipePrevisao.tsx — "Previsão de carga · próximas 4 semanas": 4 semanas + Vencidas + Depois + Sem prazo = Abertas.
// Cada tarefa aberta cai em UM balde (`distribuirNaPrevisao`); a soma da linha é o total de abertas da pessoa.
import { COLUNAS_DA_PREVISAO, NOTA_PREVISAO, SUBTITULO_PREVISAO, TITULO_PREVISAO, classeDaCelula, rotuloDaSemana, textoDaCelula } from "./equipe-visual"
import type { PessoaDaEquipe, Previsao } from "./equipe-tipos"
import "./equipe.css"

export function EquipePrevisao({ previsao, pessoas }: { previsao: Previsao; pessoas: PessoaDaEquipe[] }) {
  const fechaDe = new Map(pessoas.map((p) => [p.usuarioId, p.carga.fechaPorSemana]))
  return (
    <div className="eqp-card eqp-prev">
      <div className="eqp-prev-tit"><b>{TITULO_PREVISAO}</b><span>{SUBTITULO_PREVISAO}</span></div>
      <div className="eqp-scroll">
        <div className="eqp-pgrade" style={{ marginBottom: 8 }}>
          <div />
          {previsao.semanas.map((s) => <div key={s.inicio} className="eqp-ph">{rotuloDaSemana(s)}</div>)}
          {COLUNAS_DA_PREVISAO.map((c) => <div key={c} className={`eqp-ph${c === "Abertas" ? " forte" : ""}`}>{c}</div>)}
        </div>
        {previsao.linhas.map((l) => {
          const semDono = l.usuarioId == null
          // "Sem responsável" não fecha nada: qualquer semana com prazo é vermelha (fecha = 0).
          const fecha = semDono ? 0 : fechaDe.get(l.usuarioId as number) ?? 0
          const valores = [...l.porSemana.map((s) => s.n), l.vencidas, l.depois, l.semPrazo]
          return (
            <div key={l.usuarioId ?? "sem"} className="eqp-pgrade" style={{ marginBottom: 8 }}>
              <div className={`eqp-nome${semDono ? " sem" : ""}`}>{l.nome}</div>
              {valores.map((v, i) => <div key={i} className={`eqp-cel ${classeDaCelula(i, v, fecha)}`}>{textoDaCelula(v)}</div>)}
              <div className="eqp-cel total">{l.total}</div>
            </div>
          )
        })}
      </div>
      <div className="eqp-nota" style={{ fontSize: 12 }}>{NOTA_PREVISAO}</div>
    </div>
  )
}
