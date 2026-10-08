"use client"
// src/components/torre/TorreProcessos.tsx — aba PROCESSOS, POR FASE ("<fase> · N processos").
// Botões de fase com contagem · Saúde da fase · Onde estão as certidões desta fase por passo · filtros Todos/Precisam de alguém/Atenção/
// Parados ou sem dono · País, Responsável, Ordenar e busca (combinam em E) · tabela com paginação real · Foco (abre o Processo) e
// Relatório (modal com exportação CSV/Excel/PDF reais). Todas as regras são puras (`lib/operacional/torre-fase.ts`); o risco é a regra
// única `torre-risco.ts`; a próxima ação é DERIVADA das tarefas abertas (`torre-proxima-acao.ts`); "certidões prontas" é a fonte única
// `documentacaoRequeridaDoProcesso`, pedida só para as linhas da página.
import { BOLA_NOSSA } from "@/lib/operacional/torre-bola"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import {
  FILTROS_DE_PROCESSOS, ORDENS_DE_PROCESSOS, ITENS_POR_PAGINA, TODOS_OS_PAISES, TODOS_OS_RESPONSAVEIS, SEM_RESPONSAVEL,
  aplicarPaisRespBusca, botoesDeFase, milhar, contagensDosFiltros, metaDaVisao, opcoesDePais, opcoesDeResponsavel, ordenarProcessos, paginar, paginasVisiveis,
  passaNoFiltro, passosDaFase, rodapeDeProcessos, saudeDaFase, textoNaFase, tomDosDias, escolherFaseInicial,
  type FiltroDeProcessos, type OrdemDeProcessos,
} from "@/lib/operacional/torre-fase"
import { ROTULO_DA_SITUACAO } from "@/lib/operacional/torre-risco"
import type { ColunaDoRadar, ProcessoDaTorre } from "./tipos-processos"
import { api, useTorre } from "./torre-base"
import { memoriaDeProcessos } from "./torre-fase-memoria"
import { TorreSaudeDaFase } from "./TorreSaudeDaFase"
import { TorrePassosDaFase } from "./TorrePassosDaFase"
import "./torre-radar.css"
import "./torre-processos.css"

const ORIGEM_NA_FASE: Record<string, string> = { AVANCO_DE_FASE: "último avanço de fase registrado", CADASTRO_DO_PROCESSO: "abertura do processo — nasceu nesta fase", INSTANCIA_DA_FASE: "criação do workflow da fase" }

interface ResumoDasFases {
  colunas: ColunaDoRadar[]
  tempos: Record<string, { mediaDias: number; amostras: number }>
  metaPadrao: Record<string, number | null>
  fluxo: Record<string, { phaseKey: string; entraram: number; sairam: Array<{ para: string; n: number }> }>
}
interface Certidoes { processoId: number; aplicavel: boolean; recebidas: number; requeridas: number; percentual: number }

/** "12/08" (e "12/08 14:30" quando entrou há menos de 1 dia) — no fuso operacional, nunca no do navegador. */
const desdeTexto = (iso: string, dias: number | null): string => {
  const d = new Date(iso)
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })
  return dias === 0 ? `${dia} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}` : dia
}

export function TorreProcessos({ processos, carregando, erro }: { processos: ProcessoDaTorre[]; carregando: boolean; erro: string | null; backlog?: { abertas: number; fechadas: number } | null }) {
  const { abrirRelatorio } = useTorre()
  const { pode } = usePermissoes()
  const podeRelatorio = pode("relatorios.ver")

  const [fase, setFase] = useState<string | null>(memoriaDeProcessos.fase)
  const [filtro, setFiltro] = useState<FiltroDeProcessos>(memoriaDeProcessos.filtro)
  const [pais, setPais] = useState(memoriaDeProcessos.pais)
  const [resp, setResp] = useState(memoriaDeProcessos.resp)
  const [ordem, setOrdem] = useState<OrdemDeProcessos>(memoriaDeProcessos.ordem)
  const [busca, setBusca] = useState(memoriaDeProcessos.busca)
  const [pagina, setPagina] = useState(1)
  useEffect(() => { Object.assign(memoriaDeProcessos, { fase, filtro, pais, resp, ordem, busca }) }, [fase, filtro, pais, resp, ordem, busca])

  // ── o resumo por fase (botões, tempo médio, meta, fluxo da semana): um pedido por conjunto de processos ──
  const [resumo, setResumo] = useState<{ chave: string; dados: ResumoDasFases } | null>(null)
  const [erroResumo, setErroResumo] = useState<string | null>(null)
  const chaveIds = useMemo(() => processos.map((p) => p.processoId).join(","), [processos])
  useEffect(() => {
    if (carregando || erro) return
    let vivo = true
    void api<ResumoDasFases>("/api/torre/processos/fases", "POST", { processoIds: chaveIds.split(",").filter(Boolean).map(Number) }).then((r) => {
      if (!vivo) return
      if (r.ok) { setResumo({ chave: chaveIds, dados: r.data }); setErroResumo(null) } else setErroResumo("Não foi possível carregar as fases.")
    })
    return () => { vivo = false }
  }, [chaveIds, carregando, erro])

  const colunas = useMemo(() => resumo?.dados.colunas ?? [], [resumo])
  const botoes = useMemo(() => botoesDeFase(colunas, processos), [colunas, processos])
  const faseAtiva = fase && botoes.some((b) => b.key === fase) ? fase : escolherFaseInicial(botoes)
  const botaoAtivo = botoes.find((b) => b.key === faseAtiva) ?? null
  const rotuloDaFase = useCallback((k: string) => colunas.find((c) => c.key === k)?.label ?? k, [colunas])

  const linhasDaFase = useMemo(() => processos.filter((p) => p.faseAtual.key === faseAtiva), [processos, faseAtiva])
  const paisesDisponiveis = useMemo(() => opcoesDePais(linhasDaFase), [linhasDaFase])
  const respsDisponiveis = useMemo(() => opcoesDeResponsavel(linhasDaFase), [linhasDaFase])
  const paisEfetivo = paisesDisponiveis.includes(pais) ? pais : TODOS_OS_PAISES
  const respEfetivo = respsDisponiveis.includes(resp) ? resp : TODOS_OS_RESPONSAVEIS
  const base = useMemo(() => aplicarPaisRespBusca(linhasDaFase, { pais: paisEfetivo, resp: respEfetivo, busca }), [linhasDaFase, paisEfetivo, respEfetivo, busca])
  // Os números dos botões são os da FASE (não mexem com busca/País/Responsável, como no protótipo); o rodapé diz quantos o recorte tem.
  const contagens = useMemo(() => contagensDosFiltros(linhasDaFase), [linhasDaFase])
  const filtradas = useMemo(() => ordenarProcessos(base.filter((p) => passaNoFiltro(p, filtro)), ordem), [base, filtro, ordem])
  const pg = useMemo(() => paginar(filtradas, pagina, ITENS_POR_PAGINA), [filtradas, pagina])

  const metaPadrao = faseAtiva ? resumo?.dados.metaPadrao[faseAtiva] ?? null : null
  const meta = metaDaVisao(linhasDaFase, metaPadrao)
  const saude = useMemo(() => saudeDaFase(linhasDaFase, {
    tempoMedioDias: faseAtiva ? resumo?.dados.tempos[faseAtiva]?.mediaDias ?? null : null, metaDias: meta,
    fluxo: faseAtiva ? resumo?.dados.fluxo[faseAtiva] ?? null : null, rotuloDaFase,
  }), [linhasDaFase, faseAtiva, resumo, meta, rotuloDaFase])
  const passos = useMemo(() => passosDaFase(linhasDaFase, meta), [linhasDaFase, meta])

  // ── o "a de b" das certidões das linhas da página (fonte única, pedida só para quem aparece) ──
  // A chave da linha carrega o que muda o resultado (tarefas abertas/concluídas, fase): depois de uma recarga com dados novos a chave
  // muda e o número é pedido de novo; com os mesmos dados, nada é pedido.
  const [certidoes, setCertidoes] = useState<Record<string, Certidoes>>({})
  const chaveDaLinha = (p: ProcessoDaTorre) => `${p.processoId}:${p.faseAtual.key}:${p.tarefasDaFase.abertas}:${p.tarefasDaFase.concluidas}`
  const faltam = pg.itens.filter((p) => certidoes[chaveDaLinha(p)] == null)
  const pedido = faltam.map((p) => `${chaveDaLinha(p)}`).join("|")
  useEffect(() => {
    if (!pedido) return
    let vivo = true
    const chaves = pedido.split("|")
    const ids = chaves.map((c) => Number(c.split(":")[0]))
    void api<{ certidoes: Certidoes[] }>("/api/torre/processos/certidoes", "POST", { processoIds: ids }).then((r) => {
      if (!vivo || !r.ok) return
      setCertidoes((atual) => {
        const novo = { ...atual }
        for (const c of r.data.certidoes) { const chave = chaves.find((k) => Number(k.split(":")[0]) === c.processoId); if (chave) novo[chave] = c }
        return novo
      })
    })
    return () => { vivo = false }
  }, [pedido])

  const trocar = <T,>(set: (x: T) => void) => (x: T) => { set(x); setPagina(1) }

  const titulo = botaoAtivo ? `${botaoAtivo.label} · ${milhar(linhasDaFase.length)} ${linhasDaFase.length === 1 ? "processo" : "processos"}` : "Processos"

  return (
    <div className="tor-pg">
      <div className="tor-pg-cab">
        <div>
          <div className="tor-pg-trilha">
            <Link href="/torre?aba=visao">Torre de Controle</Link> › <Link href="/torre?aba=processos">Processos</Link>{botaoAtivo ? <> › <b>{botaoAtivo.label}</b></> : null}
          </div>
          <h2 className="tor-pg-titulo">{titulo}</h2>
        </div>
        <input type="text" aria-label="Buscar" placeholder="Buscar família, pessoa, cartório…" value={busca} onChange={(e) => trocar(setBusca)(e.target.value)} className="tor-pg-in" style={{ width: 300 }} />
      </div>

      {erro ? <div className="tor-card pad">{erro}</div> : carregando || (!resumo && !erroResumo) ? <div className="tor-card pad small">Carregando processos…</div> : erroResumo ? <div className="tor-card pad">{erroResumo}</div> : (
        <>
          <div className="tor-pf-fases">
            <div className="tor-pf-rotulo">Escolha a fase — a tabela abaixo mostra só os processos dela</div>
            <div className="tor-pg-chips" role="group" aria-label="Fase">
              {botoes.map((b) => (
                <button key={b.key} type="button" className="tor-pg-chip" aria-pressed={b.key === faseAtiva} onClick={() => { setFase(b.key); setPagina(1) }}>{b.label} {milhar(b.n)}</button>
              ))}
            </div>
          </div>

          <div className="tor-pf-cartoes">
            <TorreSaudeDaFase s={saude} />
            <TorrePassosDaFase p={passos} />
          </div>

          <div className="tor-pg-barra">
            <div className="tor-pg-chips" role="group" aria-label="Situação">
              {FILTROS_DE_PROCESSOS.map((f) => (
                <button key={f.chave} type="button" className="tor-pg-chip" aria-pressed={filtro === f.chave} onClick={() => trocar(setFiltro)(f.chave)}>{f.rotulo} {milhar(contagens[f.chave])}</button>
              ))}
            </div>
            <div className="tor-pg-campos">
              <select aria-label="País" value={paisEfetivo} onChange={(e) => trocar(setPais)(e.target.value)} className="tor-pg-in">
                {paisesDisponiveis.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select aria-label="Responsável" value={respEfetivo} onChange={(e) => trocar(setResp)(e.target.value)} className="tor-pg-in">
                {respsDisponiveis.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select aria-label="Ordenar" value={ordem} onChange={(e) => trocar(setOrdem)(e.target.value as OrdemDeProcessos)} className="tor-pg-in">
                {ORDENS_DE_PROCESSOS.map((o) => <option key={o.chave} value={o.chave}>{o.rotulo}</option>)}
              </select>
            </div>
          </div>

          <div className="tor-pf-tabela">
            <div className="tor-pf-rolagem">
              <div className="tor-pf-grade tor-pf-cab">
                <div>Família · país</div><div>Na fase há</div><div>Certidões prontas</div><div>Aguardando</div>
                <div>Próxima ação</div><div>Responsável</div><div>Prazo</div><div>Situação</div><div>Ações</div>
              </div>
              {pg.itens.map((p) => {
                const cert = certidoes[chaveDaLinha(p)]
                const acao = p.proximaAcao
                const tomDias = tomDosDias(p.naFase.dias, p.metaDias)
                return (
                  <div key={p.processoId} className="tor-pf-grade tor-pf-linha">
                    <div className="tor-pf-fam">
                      <Link href={`/torre/processo/${p.processoId}`}>{p.familiaNome}</Link>
                      <span>{p.pais ?? "—"} · {p.requerentes} {p.requerentes === 1 ? "requerente" : "requerentes"}</span>
                    </div>
                    <div className="tor-pf-col" title={p.naFase.desde ? `Na fase desde ${desdeTexto(p.naFase.desde, p.naFase.dias)} (${ORIGEM_NA_FASE[p.naFase.origem ?? ""] ?? "registro"})` : "Sem registro de quando entrou nesta fase"}>
                      <span className={`tor-pf-dias ${tomDias}`}>{textoNaFase(p)}</span>
                      <span className="tor-pf-sub">{p.naFase.desde ? `desde ${desdeTexto(p.naFase.desde, p.naFase.dias)}` : "sem registro de entrada"}</span>
                    </div>
                    <div className="tor-pf-prontas">
                      {cert == null ? <b>…</b> : !cert.aplicavel ? <b title="Esta fase não trabalha certidões">—</b> : (
                        <>
                          <b>{cert.recebidas} de {cert.requeridas}</b>
                          <div className="tor-pf-trilho"><i style={{ width: `${cert.requeridas > 0 ? Math.min(100, Math.round((cert.recebidas / cert.requeridas) * 100)) : 0}%` }} /></div>
                        </>
                      )}
                    </div>
                    <div><span className={`tor-pf-pilula ${p.bola.rotulo === BOLA_NOSSA ? "nossa" : "outra"}`}>{p.bola.rotulo}</span></div>
                    <div className="tor-pf-celula" title={p.motivoDoRisco}>{acao?.texto ?? "—"}</div>
                    <div className={`tor-pf-celula${acao && acao.responsaveis.donos.length === 0 ? " sem" : ""}`} title={acao ? `${acao.responsaveis.abertas} tarefa(s) aberta(s) do processo` : undefined}>{acao ? acao.responsaveis.texto : "—"}</div>
                    <div className={`tor-pf-celula${acao?.prazo.tom === "vermelho" ? " vermelho" : acao?.prazo.tom === "ambar" ? " ambar" : ""}`}>{acao?.prazo.texto ?? "—"}</div>
                    <div><span className={`tor-pf-pilula ${p.situacao}`} title={p.motivoDoRisco}>{ROTULO_DA_SITUACAO[p.situacao]}</span></div>
                    <div className="tor-pf-acoes">
                      <Link href={`/torre/processo/${p.processoId}`} className="tor-pf-foco">Foco</Link>
                      {podeRelatorio && (
                        <button type="button" className="tor-pf-rel" onClick={() => abrirRelatorio({ processoId: p.processoId, familiaId: p.familiaId, familiaNome: p.familiaNome, codigo: p.codigo })}>Relatório</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="tor-pf-rodape">
              <span>{rodapeDeProcessos(pg)}</span>
              {pg.totalPaginas > 1 && (
                <nav className="tor-pg-pags" aria-label="Páginas da tabela">
                  {paginasVisiveis(pg.pagina, pg.totalPaginas).map((n, i) => n === "…"
                    ? <span key={`r${i}`} className="tor-pg-pag-reticencias">…</span>
                    : <button key={n} type="button" className="tor-pg-pag" aria-current={n === pg.pagina ? "page" : undefined} onClick={() => setPagina(n)}>{n}</button>)}
                </nav>
              )}
            </div>
          </div>

          <div className="tor-pg-explica">&quot;Foco&quot; abre o processo inteiro; &quot;Relatório&quot; abre o relatório de controle da família, com exportação em CSV, Excel e PDF. Cada linha é um processo. Clique para abrir o processo inteiro. &quot;Certidões prontas&quot; resume as certidões da família; o detalhe certidão por certidão fica dentro do processo.</div>
        </>
      )}
    </div>
  )
}
