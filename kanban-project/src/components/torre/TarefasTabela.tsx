"use client"
// src/components/torre/TarefasTabela.tsx — a TABELA agrupada da aba Tarefas (Torre nova, igual ao protótipo).
// Colunas (uma informação por coluna): [☐] Certidão | Pessoa | Família | Fase | Passo | Status | Aguardando | Cobrar em | Responsável | Iniciou | Prazo | Risco | [ações].
// TUDO CABE NA TELA (sem arrastar para o lado): colunas fluidas, texto quebra linha. O cabeçalho das colunas fica DENTRO de cada bloco, abaixo da faixa da família.
// Cabeçalho de grupo: ☐, a família (link), o resumo, "N tarefas" e "Foco ›". A certidão CANCELADA continua visível — riscada, no fim do
// grupo, com "Ver motivo" — mas é só exibição: não conta no "N tarefas", não tem seleção e não entra em lote.
// Prazo: SEMPRE o da tarefa, uma vez só, curto (`textoPrazoCompacto`: "venceu há 5 dias", ≤ 2 linhas; a data vai na dica). Status: `ROTULO_STATUS_TAREFA` (via `statusDaLinha`).
import Link from "next/link"
import { Fragment, useState } from "react"
import { alternarGrupo, contarSelecionadas, expandirTudo, grupoAberto, recolherTudo, textoSelecionadasNoGrupo } from "@/lib/operacional/torre-tarefas-grupos"
import {
  acoesDaLinha, statusDaLinha, textoDaBola, textoDoCobrar, textoPrazoCompacto, textoDoIniciou, resumoDoGrupo, type AcaoDaLinha, type Agrupar,
} from "@/lib/operacional/torre-tarefas-tela"
import {
  passoLabelDe, docTipoTxt, aIniciarEfetivo, acaoDe, agruparDentroDaFamilia,
} from "@/src/components/operacao/operacao-v3-derivacoes"
import { rotularFase } from "@/src/components/operacao/kit-operacional"
import { riscoDe, temAcompanhamento } from "./tipos"
import type { ProcessoDaTorre } from "./tipos-processos"
import { ehCancelada, type LinhaDaTela } from "./tarefas-tipos"

export type GrupoDaPagina = [string, LinhaDaTela[]]

const TOM_RISCO: Record<string, string> = { red: "red", amb: "amb", grn: "grn", blu: "grn", gry: "grn" }

/** "7 tarefas" (só o trabalho) · com as canceladas à mostra: "11 (7 ativas + 4 canceladas / não exigidas)" — o número é SEMPRE o das linhas mostradas. */
export function textoDoCabecalho(mostradas: number, ativas: number, canceladas: number, mostrando: boolean): string {
  const tarefas = (n: number) => `${n} ${n === 1 ? "tarefa" : "tarefas"}`
  return mostrando ? `${mostradas} (${ativas} ${ativas === 1 ? "ativa" : "ativas"} + ${canceladas} ${canceladas === 1 ? "cancelada / não exigida" : "canceladas / não exigidas"})` : tarefas(mostradas)
}

export function TarefasTabela({
  grupos, agrupar, dentro, sel, novas, processos, agora, podeIniciar, onSelecionar, onTodas, onAbrirGaveta, onAcao, vazio, rodape,
}: {
  grupos: GrupoDaPagina[]
  agrupar: Agrupar
  dentro: "none" | "pessoa" | "orgao" | "passo"
  sel: Record<number, true>
  novas: Set<number>
  processos: Map<number, ProcessoDaTorre>
  agora: Date
  /** Pode iniciar (`tarefas.iniciar_concluir`)? */
  podeIniciar: boolean
  onSelecionar: (ids: number[], ligar: boolean) => void
  /** O ☐ do cabeçalho: seleciona (ou solta) todas as linhas de TRABALHO da página. */
  onTodas: (ids: number[], ligar: boolean) => void
  onAbrirGaveta: (l: LinhaDaTela) => void
  onAcao: (acao: AcaoDaLinha, l: LinhaDaTela) => void
  vazio: boolean
  rodape: React.ReactNode
}) {
  // Padrão: TUDO RECOLHIDO (conjunto de grupos abertos vazio). Sem agrupamento (`none`) não há faixa: a lista fica sempre aberta.
  const [abertos, setAbertos] = useState<Set<string>>(() => recolherTudo())
  // Canceladas / não exigidas: ESCONDIDAS por padrão (como na página do processo). O controle do grupo as mostra, riscadas, na posição da regra fixa de ordem.
  const [comCanceladas, setComCanceladas] = useState<Set<string>>(() => new Set())
  const comFaixa = agrupar !== "none"
  const todasDaPagina = grupos.flatMap(([, ls]) => ls).filter((l) => !ehCancelada(l)).map((l) => l.taskId)
  const todasMarcadas = todasDaPagina.length > 0 && todasDaPagina.every((id) => sel[id])

  // O CABEÇALHO DAS COLUNAS vive DENTRO de cada bloco, logo abaixo da faixa com o nome da família (não mais uma vez no topo da tabela).
  const cabecalho = (
    <div className="tf-g tf-hd" role="row">
      <div /><div>Certidão</div><div>Pessoa</div><div>Família</div><div>Fase</div><div>Passo</div><div>Status</div><div>Aguardando</div><div>Cobrar em</div><div>Responsável</div><div>Iniciou</div><div>Prazo</div><div>Risco</div><div />
    </div>
  )

  const renderLinha = (l: LinhaDaTela) => {
    const cancelada = ehCancelada(l)
    const st = statusDaLinha(l)
    const bola = textoDaBola(l, agora)
    const cobrar = cancelada ? null : textoDoCobrar(l.cobrarEm, agora)
    const prazo = textoPrazoCompacto(l, agora)
    const risco = riscoDe(l)
    const aIniciar = aIniciarEfetivo(l)
    const acoes = acoesDaLinha({
      statusTarefa: l.statusTarefa, coluna: l.coluna, responsavelId: l.responsavelId, esperandoDe: l.esperandoDe, estadoOperacao: l.estadoOperacao,
      aIniciarEfetivo: aIniciar, podeIniciar: l.podeIniciar && podeIniciar, temAcompanhamento: temAcompanhamento(l), acaoPadrao: acaoDe(l).label,
    })
    const marcada = !!sel[l.taskId]
    const semDono = l.responsavelId == null
    return (
      <div key={l.taskId} className={`tf-g tf-linha ${marcada ? "sel" : ""} ${cancelada ? "cancelada" : ""}`}>
        <div>
          {cancelada
            ? <button type="button" className="tf-chk" disabled aria-label="Certidão cancelada: só exibição" style={{ opacity: 0.4, cursor: "not-allowed" }} />
            : <button type="button" className={`tf-chk ${marcada ? "on" : ""}`} aria-label={`Selecionar a tarefa ${l.taskId}`} aria-pressed={marcada} onClick={() => onSelecionar([l.taskId], !marcada)} />}
        </div>
        <div className="tf-cert">
          <button type="button" className="tf-nome" onClick={() => onAbrirGaveta(l)}>
            {novas.has(l.taskId) && <span className="tor-p amb tf-nova">nova</span>}{docTipoTxt(l)}
          </button>
        </div>
        <div className="tf-t13">{l.pessoaNome ?? l.casalNomes ?? "—"}</div>
        <div className="tf-t13">{l.familiaNome ?? l.processoNome ?? "—"}</div>
        <div className="tf-t13">{rotularFase(l.faseMacroKey) ?? l.faseAtualDoProcessoLabel ?? "—"}</div>
        <div className="tf-t13">{cancelada ? "—" : passoLabelDe(l).label}</div>
        <div><span className={`tf-st ${st.tom}`}>{st.texto}</span></div>
        <div className="tf-t13" title={!cancelada && bola.orgao ? bola.orgao : undefined}>{cancelada ? "—" : bola.texto}</div>
        <div>
          {cobrar
            ? <span className={`tf-t13 tf-b ${cobrar.tom === "vermelho" ? "tf-verm" : cobrar.tom === "ambar" ? "tf-amb" : ""}`} title={l.cobrarEmPadrao ? "Padrão: 7 dias depois do pedido ou da última cobrança" : undefined}>{cobrar.texto}</span>
            : <span className="tf-peq">—</span>}
        </div>
        <div className={`tf-t13 ${semDono && !cancelada ? "tf-b tf-verm" : ""}`}>{cancelada ? "—" : l.responsavelNome ?? "Sem responsável"}</div>
        <div className="tf-t13" style={{ fontVariantNumeric: "tabular-nums" }}>{cancelada ? "—" : textoDoIniciou(l)}</div>
        <div className={`tf-t13 tf-prazo ${l.atrasada && !cancelada ? "tf-b tf-verm" : ""}`} title={!cancelada && prazo.dica ? `Prazo: ${prazo.dica}` : undefined}>{cancelada ? "—" : prazo.texto}</div>
        <div><span className={`tf-rk ${TOM_RISCO[risco.cls] ?? "grn"}`}>{risco.txt}</span></div>
        <div className="tf-acoes">
          {acoes.map((a, i) => (
            <button key={a} type="button" className={i === 0 ? "tf-a1" : "tf-a2"} onClick={() => onAcao(a, l)}>{a}</button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="tf-tabela">
      {!vazio && grupos.length > 0 && (
        <div className="tf-expande" role="group" aria-label="Expandir ou recolher os grupos">
          <button type="button" onClick={() => setAbertos(expandirTudo(grupos.map(([n]) => n)))}>Expandir tudo</button>
          <button type="button" onClick={() => setAbertos(recolherTudo())}>Recolher tudo</button>
          <button type="button" aria-pressed={todasMarcadas} disabled={todasDaPagina.length === 0} onClick={() => onTodas(todasDaPagina, !todasMarcadas)}>
            {todasMarcadas ? "Desmarcar todas" : "Selecionar todas"}
          </button>
        </div>
      )}
      <div className="tf-rolagem">
        {!vazio && grupos.map(([nome, itens]) => {
          const trabalho = itens.filter((l) => !ehCancelada(l))
          const nCanceladas = itens.length - trabalho.length
          const mostrarCanc = nCanceladas > 0 && comCanceladas.has(nome)
          // O que o grupo MOSTRA: o trabalho e, se pedido, as canceladas na posição da regra. O número do cabeçalho é sempre o das linhas mostradas.
          const mostradas = mostrarCanc ? itens : trabalho
          const ids = trabalho.map((l) => l.taskId)
          const todas = ids.length > 0 && ids.every((id) => sel[id]); const alguma = ids.some((id) => sel[id])
          const processoId = agrupar === "fam" ? itens[0]?.processoId ?? null : null
          const resumo = agrupar === "fam" ? resumoDoGrupo(processoId != null ? processos.get(processoId) ?? null : null, mostradas) : ""
          const subgrupos = agrupar === "fam" && dentro !== "none" ? agruparDentroDaFamilia(mostradas, dentro) : null
          const aberto = !comFaixa || grupoAberto(abertos, nome)
          const nSel = contarSelecionadas(ids, sel)
          const textoSel = textoSelecionadasNoGrupo(!aberto, nSel)
          const parar = (e: React.SyntheticEvent) => e.stopPropagation()
          return (
            <div key={nome} role="rowgroup" aria-label={`Grupo ${nome}`} className="tf-bloco">
              <div className={`tf-grp ${aberto ? "aberto" : ""}`} onClick={comFaixa ? () => setAbertos((a) => alternarGrupo(a, nome)) : undefined}>
                <div className="tf-grp-in">
                  {comFaixa && (
                    <button type="button" className="tf-seta" aria-expanded={aberto} aria-label={`${aberto ? "Recolher" : "Expandir"} ${nome}`}
                      onClick={(e) => { parar(e); setAbertos((a) => alternarGrupo(a, nome)) }}>{aberto ? "▾" : "▸"}</button>
                  )}
                  <button type="button" className={`tf-chk ${todas ? "on" : alguma ? "mid" : ""}`} aria-label={`Selecionar o grupo ${nome}`} disabled={ids.length === 0} onClick={(e) => { parar(e); onSelecionar(ids, !todas) }} />
                  {processoId != null
                    ? <Link className="fam" href={`/torre/processo/${processoId}`} onClick={parar}>{nome}</Link>
                    : <b>{nome}</b>}
                  {resumo && <span className="resumo">{resumo}</span>}
                  <span className="tf-pilula">{textoDoCabecalho(mostradas.length, trabalho.length, nCanceladas, mostrarCanc)}</span>
                  {nCanceladas > 0 && (
                    <button type="button" className="tf-mini" aria-pressed={mostrarCanc}
                      onClick={(e) => { parar(e); setComCanceladas((s) => { const n = new Set(s); if (n.has(nome)) n.delete(nome); else n.add(nome); return n }) }}>
                      {mostrarCanc ? `Ocultar ${nCanceladas} ${nCanceladas === 1 ? "cancelada / não exigida" : "canceladas / não exigidas"}` : `+ ${nCanceladas} ${nCanceladas === 1 ? "cancelada / não exigida" : "canceladas / não exigidas"}`}
                    </button>
                  )}
                  {textoSel && <span className="tf-selpil" role="status">{textoSel}</span>}
                  {processoId != null && <Link className="foco" href={`/torre/processo/${processoId}`} onClick={parar}>Foco ›</Link>}
                </div>
              </div>
              {aberto && cabecalho}
              {!aberto ? null : subgrupos
                ? subgrupos.map((g) => {
                  const ls = g.linhas as LinhaDaTela[]
                  const idsG = ls.filter((l) => !ehCancelada(l)).map((l) => l.taskId)
                  const todasG = idsG.length > 0 && idsG.every((id) => sel[id]); const algumaG = idsG.some((id) => sel[id])
                  return (
                    <Fragment key={g.chave}>
                      <div className="tf-grp tf-sub-grp">
                        <button type="button" className={`tf-chk ${todasG ? "on" : algumaG ? "mid" : ""}`} aria-label={`Selecionar o subgrupo ${g.titulo}`} disabled={idsG.length === 0} onClick={() => onSelecionar(idsG, !todasG)} />
                        <span className={`tor-p ${g.pillCls === "opv3-p-red" ? "red" : "gry"}`}>{g.pill}</span><b>{g.titulo}</b>
                        <span className="tf-pilula" style={{ marginLeft: "auto" }}>{idsG.length} {idsG.length === 1 ? "tarefa" : "tarefas"}</span>
                      </div>
                      {ls.map(renderLinha)}
                    </Fragment>
                  )
                })
                : mostradas.map(renderLinha)}
            </div>
          )
        })}
      </div>
      <div className="tf-rodape">{rodape}</div>
    </div>
  )
}
