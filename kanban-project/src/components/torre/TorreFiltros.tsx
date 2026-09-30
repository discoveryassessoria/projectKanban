"use client"
// src/components/torre/TorreFiltros.tsx — a BARRA DE FILTROS da aba Tarefas (Seção 3, 30/09/2026).
// Só desenha e devolve o estado: TODA regra (predicados, AND/OR, chips, "Mostrando N de M", contadores) mora em
// lib/operacional/torre-filtros.ts — a mesma função que a tabela usa. Visíveis: Responsável · Prazo · Família · Status ·
// Certidão · Cartório · Risco · Ordenar. O resto fica em "Mais filtros". Funciona a 400 px: a barra quebra em linhas e o
// menu de cada filtro abre na largura da própria barra (nunca empurra a página para o lado).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { rotularFase, useRotulosDeFaseProntos } from "@/src/components/operacao/kit-operacional"
import {
  ACOMPS_TORRE, CERTIDOES_TORRE, COBRANCAS_TORRE, ORDENS_TORRE, PRAZOS_TORRE, PRIORIDADES_TORRE, QUANDOS_TORRE, RISCOS_TORRE,
  ROTULO_ACOMP_TORRE, ROTULO_CERTIDAO_TORRE, ROTULO_COBRANCA_TORRE, ROTULO_ORDEM_TORRE, ROTULO_PRAZO_TORRE, ROTULO_PRIORIDADE_TORRE,
  ROTULO_QUANDO_TORRE, ROTULO_RISCO_TORRE, chipsDoFiltro, contarEmMaisFiltros, contarFiltrosAtivos, contarPorPrazo, opcoesDosFiltros,
  removerChip, sugestoesDeFamilia, textoMostrando, type ContextoDeFiltro, type FiltrosTorre, type OrdemTorre, type QuandoTorre,
} from "@/lib/operacional/torre-filtros"
import { ROTULO_STATUS } from "@/src/lib/home/rotulo-status-tarefa"
import type { LinhaTorre } from "./tipos"

type ListaChave = "responsavel" | "prazo" | "status" | "certidao" | "fase" | "passo" | "orgao" | "prioridade" | "risco" | "acomp" | "cobranca"

function MultiEscolha({ rotulo, opcoes, valores, onChange, rodape }: {
  rotulo: string
  opcoes: Array<{ valor: string; texto: string; n?: number }>
  valores: string[]
  onChange: (v: string[]) => void
  rodape?: ReactNode
}) {
  const alternar = (v: string) => onChange(valores.includes(v) ? valores.filter((x) => x !== v) : [...valores, v])
  return (
    <details className="tor-fx">
      <summary className={`tor-btn ${valores.length ? "on" : ""}`} aria-label={`Filtro ${rotulo}`}>{rotulo}{valores.length ? ` · ${valores.length}` : ""} ▾</summary>
      <div className="tor-fx-pop" role="group" aria-label={rotulo}>
        {opcoes.length === 0 && <div className="small">Nenhuma opção nas tarefas abertas.</div>}
        {opcoes.map((o) => (
          <label key={o.valor} className="tor-fx-op">
            <input type="checkbox" checked={valores.includes(o.valor)} onChange={() => alternar(o.valor)} />
            <span>{o.texto}</span>{o.n != null && <span className="small">{o.n}</span>}
          </label>
        ))}
        {rodape}
      </div>
    </details>
  )
}

function Intervalo({ de, ate, onChange, rotulo }: { de: string | null; ate: string | null; onChange: (de: string | null, ate: string | null) => void; rotulo: string }) {
  return (
    <div className="tor-fx-int">
      <label className="small">{rotulo} de<input type="date" className="tor-in" value={de ?? ""} max={ate ?? undefined} onChange={(e) => onChange(e.target.value || null, ate)} /></label>
      <label className="small">até<input type="date" className="tor-in" value={ate ?? ""} min={de ?? undefined} onChange={(e) => onChange(de, e.target.value || null)} /></label>
    </div>
  )
}

export function TorreFiltros({ linhasTodas, linhasBase, filtros, onFiltros, ctx, mostrando, total, paisRotulo, onLimparPais, busca, onLimparBusca, onLimparTudo }: {
  /** As tarefas abertas da nacionalidade — de onde saem as OPÇÕES (só o que existe em tarefa aberta) e as sugestões de família. */
  linhasTodas: LinhaTorre[]
  /** A lista base (indicador + visão + busca já aplicados): sobre ela se contam os chips de prazo. */
  linhasBase: LinhaTorre[]
  filtros: FiltrosTorre
  onFiltros: (f: FiltrosTorre) => void
  ctx: ContextoDeFiltro
  /** Do `aplicarFiltros` — o MESMO número que a tabela desenha. */
  mostrando: number
  total: number
  paisRotulo: string | null
  onLimparPais: () => void
  busca: string
  onLimparBusca: () => void
  onLimparTudo: () => void
}) {
  useRotulosDeFaseProntos()
  const barra = useRef<HTMLDivElement>(null)
  const [mais, setMais] = useState(false)
  const opcoes = useMemo(() => opcoesDosFiltros(linhasTodas), [linhasTodas])
  const porPrazo = useMemo(() => contarPorPrazo(linhasBase, ctx), [linhasBase, ctx])
  const sugestoes = useMemo(() => sugestoesDeFamilia(linhasTodas, filtros.familia ?? ""), [linhasTodas, filtros.familia])

  // Menu aberto fecha ao clicar fora (um só aberto por vez fica a cargo do usuário; o clique fora fecha todos).
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      const b = barra.current; if (!b) return
      b.querySelectorAll<HTMLDetailsElement>("details.tor-fx[open]").forEach((d) => { if (!d.contains(e.target as Node)) d.open = false })
    }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [])

  const set = <K extends keyof FiltrosTorre>(k: K, v: FiltrosTorre[K]) => onFiltros({ ...filtros, [k]: v })
  const lista = (k: ListaChave) => (v: string[]) => onFiltros({ ...filtros, [k]: v } as FiltrosTorre)

  const nomeDaPessoa = (id: string) => opcoes.pessoas.find((p) => p.id === id)?.nome ?? null
  const nomeDoOrgao = (id: string) => opcoes.orgaos.find((o) => o.id === id)?.nome ?? null
  const chips = chipsDoFiltro(filtros, { pessoa: nomeDaPessoa, fase: (k) => rotularFase(k), orgao: nomeDoOrgao })
  const nAtivos = contarFiltrosAtivos(filtros)
  const nMais = contarEmMaisFiltros(filtros)
  const algoParaLimpar = nAtivos > 0 || !!paisRotulo || !!busca.trim()

  return (
    <div className="tor-fxbar" ref={barra} role="search" aria-label="Filtros das tarefas">
      <div className="tor-fxrow">
        <MultiEscolha rotulo="Responsável" valores={filtros.responsavel} onChange={lista("responsavel")} opcoes={[
          { valor: "eu", texto: "Eu" }, { valor: "sem", texto: "Sem responsável" }, ...opcoes.pessoas.map((p) => ({ valor: p.id, texto: p.nome })),
        ]} />
        <details className="tor-fx">
          <summary className={`tor-btn ${filtros.prazo.length || filtros.prazoDe || filtros.prazoAte ? "on" : ""}`} aria-label="Filtro Prazo">
            Prazo{filtros.prazo.length + (filtros.prazoDe || filtros.prazoAte ? 1 : 0) ? ` · ${filtros.prazo.length + (filtros.prazoDe || filtros.prazoAte ? 1 : 0)}` : ""} ▾
          </summary>
          <div className="tor-fx-pop" role="group" aria-label="Prazo">
            {PRAZOS_TORRE.map((p) => (
              <label key={p} className="tor-fx-op">
                <input type="checkbox" checked={filtros.prazo.includes(p)} onChange={() => set("prazo", filtros.prazo.includes(p) ? filtros.prazo.filter((x) => x !== p) : [...filtros.prazo, p])} />
                <span>{ROTULO_PRAZO_TORRE[p]}</span><span className="small">{porPrazo[p]}</span>
              </label>
            ))}
            <Intervalo rotulo="Prazo" de={filtros.prazoDe} ate={filtros.prazoAte} onChange={(de, ate) => onFiltros({ ...filtros, prazoDe: de, prazoAte: ate })} />
            <div className="small">Dia no fuso de São Paulo. O intervalo soma-se aos botões e deixa de fora quem não tem prazo.</div>
          </div>
        </details>
        <label className="tor-fam">
          <input className="tor-in" list="tor-familias" aria-label="Família" placeholder="Família…" value={filtros.familia ?? ""} maxLength={80}
            onChange={(e) => set("familia", e.target.value.trim() ? e.target.value : null)} />
          <datalist id="tor-familias">{sugestoes.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <MultiEscolha rotulo="Status" valores={filtros.status} onChange={lista("status")} opcoes={opcoes.status.map((s) => ({ valor: s, texto: ROTULO_STATUS[s] ?? s }))} />
        <MultiEscolha rotulo="Certidão" valores={filtros.certidao} onChange={lista("certidao")} opcoes={CERTIDOES_TORRE.map((c) => ({ valor: c, texto: ROTULO_CERTIDAO_TORRE[c] }))} />
        <MultiEscolha rotulo="Cartório" valores={filtros.orgao} onChange={lista("orgao")} opcoes={[{ valor: "sem", texto: "Sem cartório" }, ...opcoes.orgaos.map((o) => ({ valor: o.id, texto: o.nome }))]} />
        <MultiEscolha rotulo="Risco" valores={filtros.risco} onChange={lista("risco")} opcoes={RISCOS_TORRE.map((r) => ({ valor: r, texto: ROTULO_RISCO_TORRE[r] }))} />
        <label className="flex items-center gap-1.5 small">Ordenar por
          <select className="tor-in" aria-label="Ordenar por" value={filtros.ordenar ?? ""} onChange={(e) => set("ordenar", (e.target.value || null) as OrdemTorre | null)}>
            <option value="">Ordem padrão</option>
            {ORDENS_TORRE.map((o) => <option key={o} value={o}>{ROTULO_ORDEM_TORRE[o]}</option>)}
          </select>
        </label>
        <button className={`tor-btn ${nMais ? "on" : ""}`} aria-expanded={mais} onClick={() => setMais((m) => !m)}>Mais filtros{nMais ? ` · ${nMais}` : ""} {mais ? "▴" : "▾"}</button>
      </div>

      {mais && (
        <div className="tor-fxrow" aria-label="Mais filtros">
          <div className="tor-fx-quando">
            <label className="flex items-center gap-1.5 small">Quando
              <select className="tor-in" aria-label="Quando" value={filtros.quando ?? ""} onChange={(e) => onFiltros({ ...filtros, quando: (e.target.value || null) as QuandoTorre | null, ...(e.target.value ? {} : { quandoDe: null, quandoAte: null }) })}>
                <option value="">—</option>
                {QUANDOS_TORRE.map((q) => <option key={q} value={q}>{ROTULO_QUANDO_TORRE[q]}</option>)}
              </select>
            </label>
            {filtros.quando && <Intervalo rotulo={ROTULO_QUANDO_TORRE[filtros.quando]} de={filtros.quandoDe} ate={filtros.quandoAte} onChange={(de, ate) => onFiltros({ ...filtros, quandoDe: de, quandoAte: ate })} />}
          </div>
          <MultiEscolha rotulo="Fase" valores={filtros.fase} onChange={lista("fase")} opcoes={opcoes.fases.map((f) => ({ valor: f, texto: rotularFase(f) ?? f }))} />
          <MultiEscolha rotulo="Passo atual" valores={filtros.passo} onChange={lista("passo")} opcoes={opcoes.passos.map((p) => ({ valor: p, texto: p }))} />
          <MultiEscolha rotulo="Prioridade" valores={filtros.prioridade} onChange={lista("prioridade")} opcoes={PRIORIDADES_TORRE.map((p) => ({ valor: p, texto: ROTULO_PRIORIDADE_TORRE[p] }))} />
          <label className="tor-fx-op small"><input type="checkbox" checked={filtros.linhaReta} onChange={(e) => set("linhaReta", e.target.checked)} /> Só linha reta</label>
          <MultiEscolha rotulo="Acompanhamento" valores={filtros.acomp} onChange={lista("acomp")} opcoes={ACOMPS_TORRE.map((a) => ({ valor: a, texto: ROTULO_ACOMP_TORRE[a] }))} />
          <MultiEscolha rotulo="Cobrança" valores={filtros.cobranca} onChange={lista("cobranca")} opcoes={COBRANCAS_TORRE.map((c) => ({ valor: c, texto: ROTULO_COBRANCA_TORRE[c] }))} />
        </div>
      )}

      <div className="tor-fxrow tor-fxchips">
        {paisRotulo && <span className="tor-p blu tor-chip" title="A nacionalidade vale para a Torre inteira (seletor do topo)">Nacionalidade: {paisRotulo}<button className="tor-x" aria-label="Limpar a nacionalidade" onClick={onLimparPais}>✕</button></span>}
        {busca.trim() && <span className="tor-p blu tor-chip">Busca: {busca.trim()}<button className="tor-x" aria-label="Limpar a busca" onClick={onLimparBusca}>✕</button></span>}
        {chips.map((c) => (
          <span key={`${c.chave}:${c.valor ?? ""}`} className="tor-p blu tor-chip">{c.rotulo}
            <button className="tor-x" aria-label={`Remover o filtro ${c.rotulo}`} onClick={() => onFiltros(removerChip(filtros, c))}>✕</button>
          </span>
        ))}
        {algoParaLimpar && <button className="tor-btn" onClick={onLimparTudo}>Limpar filtros</button>}
        <span className="small tor-fx-cont" role="status" aria-live="polite">{textoMostrando({ mostrando, total })}</span>
      </div>
    </div>
  )
}
