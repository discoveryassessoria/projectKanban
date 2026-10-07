"use client"
// src/components/torre/TorreRadar.tsx — aba RADAR ("Radar · cada família em cada fase").
// Matriz família × fases do CADASTRO. A célula da fase atual mostra DE QUEM É A BOLA e HÁ QUANTO TEMPO (dias na fase, de registro
// real; sem registro → "—"); a cor é o RISCO da regra única (`torre-risco.ts`). Filtros (Todas · Precisam de alguém · Bola nossa ·
// Bola com terceiro · Críticas), busca por família, País e Ordenar funcionam de verdade, com contagens reais e paginação real.
// Clicar no nome da família abre o Processo (`/torre/processo/[id]`). Regras puras em `lib/operacional/torre-radar.ts`.
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  FILTROS_DO_RADAR, ORDENS_DO_RADAR, TODOS_OS_PAISES, textoDaCelulaAtual, visaoDoRadar, rodapeDoRadar, rotuloNoRadar,
  type FiltroDoRadar, type OrdemDoRadar,
} from "@/lib/operacional/torre-radar"
import { milhar, opcoesDePais, paginasVisiveis } from "@/lib/operacional/torre-fase"
import type { CelulaDoRadar, ColunaDoRadar, ProcessoDaTorre } from "./tipos-processos"
import { memoriaDoRadar } from "./torre-fase-memoria"
import "./torre-radar.css"

function Celula({ c }: { c: CelulaDoRadar }) {
  if (c.estado === "na") return <div className="tor-rc na" title="O macrofluxo deste tipo de processo não tem esta fase">n/a</div>
  if (c.estado === "feita") return <div className="tor-rc feita" title="Fase concluída"><span aria-label="Fase concluída">✓</span></div>
  if (c.estado === "atual") {
    return (
      <div className={`tor-rc atual ${c.risco ?? "ok"}`} title={c.motivo ?? "Fase atual"}>
        <span>{textoDaCelulaAtual(c.bola, c.dias, c.horas)}</span>
        <small>{rotuloNoRadar(c.nivel ?? "no_ritmo")}</small>
      </div>
    )
  }
  return (
    <div className={`tor-rc futura${c.semPassos ? " sempassos" : ""}`} title={c.semPassos ? "Esta fase não tem passo executável (achado aberto no Saúde)" : undefined}>
      {c.semPassos ? "sem passos" : "—"}
    </div>
  )
}

export function TorreRadar({ colunas, processos, carregando, erro }: { colunas: ColunaDoRadar[]; processos: ProcessoDaTorre[]; carregando: boolean; erro: string | null }) {
  const [filtro, setFiltro] = useState<FiltroDoRadar>(memoriaDoRadar.filtro)
  const [busca, setBusca] = useState(memoriaDoRadar.busca)
  const [pais, setPais] = useState(memoriaDoRadar.pais)
  const [ordem, setOrdem] = useState<OrdemDoRadar>(memoriaDoRadar.ordem)
  const [pagina, setPagina] = useState(1)

  // O estado da tela persiste ao trocar de aba e volta (o F5 zera) — T012.
  useEffect(() => { memoriaDoRadar.filtro = filtro; memoriaDoRadar.busca = busca; memoriaDoRadar.pais = pais; memoriaDoRadar.ordem = ordem }, [filtro, busca, pais, ordem])

  const paisesDisponiveis = useMemo(() => opcoesDePais(processos), [processos])
  // País que deixou de existir na lista (ex.: o cabeçalho passou a filtrar outro país): volta a "Todos os países".
  const paisEfetivo = paisesDisponiveis.includes(pais) ? pais : TODOS_OS_PAISES
  const v = useMemo(() => visaoDoRadar(processos, { filtro, pais: paisEfetivo, busca, ordem, pagina }), [processos, filtro, paisEfetivo, busca, ordem, pagina])

  const trocar = <T,>(set: (x: T) => void) => (x: T) => { set(x); setPagina(1) }
  const nCol = colunas.length
  const grade = { gridTemplateColumns: `150px repeat(${Math.max(nCol, 1)}, minmax(88px, 1fr))` }

  return (
    <div className="tor-pg">
      <div className="tor-pg-cab">
        <div>
          <div className="tor-pg-trilha"><Link href="/torre?aba=hoje">Torre de Controle</Link> › <b>Radar</b></div>
          <h2 className="tor-pg-titulo">Radar · cada família em cada fase</h2>
        </div>
      </div>

      {erro ? <div className="tor-card pad">{erro}</div> : carregando ? <div className="tor-card pad small">Carregando o radar…</div> : (
        <>
          <div className="tor-pg-barra">
            <div className="tor-pg-chips" role="group" aria-label="Filtro do Radar">
              {FILTROS_DO_RADAR.map((f) => (
                <button key={f.chave} type="button" className="tor-pg-chip" aria-pressed={filtro === f.chave} onClick={() => trocar(setFiltro)(f.chave)}>
                  {f.rotulo} {milhar(v.contagens[f.chave])}
                </button>
              ))}
            </div>
            <div className="tor-pg-campos">
              <input type="text" aria-label="Buscar família" placeholder="Buscar família…" value={busca} onChange={(e) => trocar(setBusca)(e.target.value)} className="tor-pg-in" style={{ width: 200 }} />
              <select aria-label="País" value={paisEfetivo} onChange={(e) => trocar(setPais)(e.target.value)} className="tor-pg-in">
                {paisesDisponiveis.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select aria-label="Ordenar" value={ordem} onChange={(e) => trocar(setOrdem)(e.target.value as OrdemDoRadar)} className="tor-pg-in">
                {ORDENS_DO_RADAR.map((o) => <option key={o.chave} value={o.chave}>{o.rotulo}</option>)}
              </select>
            </div>
          </div>

          <div className="tor-pg-explica">A célula da fase atual diz <b>quem é aguardado</b> (Equipe, Cartório, Cliente, Tradutor, Juízo, Consulado) e há quanto tempo. Cor = risco. Clique na família para abrir o processo.</div>

          <div className="tor-radar-card">
            <div className="tor-radar-rolagem">
              <div className="tor-radar-linha cab" style={grade}>
                <div>Família</div>
                {colunas.map((c) => <div key={c.key}>{c.label}{c.condicional ? <> <small>(cond.)</small></> : null}</div>)}
              </div>
              {v.pagina.itens.map((p) => (
                <div key={p.processoId} className="tor-radar-linha" style={grade}>
                  <Link href={`/torre/processo/${p.processoId}`} className="tor-radar-fam" aria-label={`Abrir o processo da família ${p.familiaNome}`}>
                    <b>{p.familiaNome}</b>
                    <span>{p.pais ?? "—"} · {p.codigo ?? "—"}</span>
                  </Link>
                  {colunas.map((c, i) => <Celula key={c.key} c={p.celulas[i] ?? { estado: "na" }} />)}
                </div>
              ))}
            </div>
            <div className="tor-radar-rodape">
              <span>{rodapeDoRadar(v.pagina.itens.length, v.pagina.total, ordem)}</span>
              {v.pagina.totalPaginas > 1 && (
                <nav className="tor-pg-pags" aria-label="Páginas do Radar">
                  {paginasVisiveis(v.pagina.pagina, v.pagina.totalPaginas).map((n, i) => n === "…"
                    ? <span key={`r${i}`} className="tor-pg-pag-reticencias">…</span>
                    : <button key={n} type="button" className="tor-pg-pag" aria-current={n === v.pagina.pagina ? "page" : undefined} onClick={() => setPagina(n)}>{n}</button>)}
                </nav>
              )}
            </div>
          </div>

          <div className="tor-radar-legenda">
            <span className="feita">✓ fase concluída</span>
            <span className="ritmo">no ritmo</span>
            <span className="atencao" title="Pontuação de risco 3 a 5, cobrança vencida, prazo hoje/amanhã ou passou da meta de tempo da fase">atenção: sem responsável, cobrança vencida, perto do prazo</span>
            <span className="critico" title="Pontuação de risco 6 ou mais, ou aguardando terceiro há 15+ dias sem cobrança em dia">crítico: atraso nosso + sem dono, divergência, parado 15+ dias</span>
            <span className="na">n/a: fase que essa família não precisa</span>
          </div>
        </>
      )}
    </div>
  )
}
