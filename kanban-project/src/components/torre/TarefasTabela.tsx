"use client"
// src/components/torre/TarefasTabela.tsx — a TABELA agrupada da aba Tarefas (Torre nova, igual ao protótipo).
// Colunas: [☐] Certidão · pessoa | Família · fase | Passo · status | Bola com · cobrar em | Responsável | Iniciou | Prazo | Risco | [ações].
// Cabeçalho de grupo: ☐, a família (link), o resumo, "N tarefas" e "Foco ›". A certidão CANCELADA continua visível — riscada, no fim do
// grupo, com "Ver motivo" — mas é só exibição: não conta no "N tarefas", não tem seleção e não entra em lote.
// Prazo: SEMPRE o da tarefa, uma vez só (`textoPrazoDaTarefa`). Status: `ROTULO_STATUS_TAREFA` (via `statusDaLinha`).
import Link from "next/link"
import { Fragment } from "react"
import {
  acoesDaLinha, statusDaLinha, textoDaBola, textoDoCobrar, textoDoIniciou, resumoDoGrupo, type AcaoDaLinha, type Agrupar,
} from "@/lib/operacional/torre-tarefas-tela"
import {
  passoLabelDe, docTipoTxt, aIniciarEfetivo, acaoDe, agruparDentroDaFamilia,
} from "@/src/components/operacao/operacao-v3-derivacoes"
import { rotularFase } from "@/src/components/operacao/kit-operacional"
import { textoPrazoDaTarefa } from "@/src/lib/tarefa/texto-prazo"
import { riscoDe, temAcompanhamento } from "./tipos"
import type { ProcessoDaTorre } from "./tipos-processos"
import { ehCancelada, type LinhaDaTela } from "./tarefas-tipos"

export type GrupoDaPagina = [string, LinhaDaTela[]]

const TOM_RISCO: Record<string, string> = { red: "red", amb: "amb", grn: "grn", blu: "grn", gry: "grn" }

export function TarefasTabela({
  grupos, agrupar, dentro, sel, novas, processos, agora, podeIniciar, onSelecionar, onTodas, onAbrirGaveta, onAcao, onFocoDaFamilia, vazio, rodape,
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
  onFocoDaFamilia: (processoId: number) => void
  vazio: boolean
  rodape: React.ReactNode
}) {
  const todasDaPagina = grupos.flatMap(([, ls]) => ls).filter((l) => !ehCancelada(l)).map((l) => l.taskId)
  const todasMarcadas = todasDaPagina.length > 0 && todasDaPagina.every((id) => sel[id])

  const renderLinha = (l: LinhaDaTela) => {
    const cancelada = ehCancelada(l)
    const st = statusDaLinha(l)
    const bola = textoDaBola(l, agora)
    const cobrar = cancelada ? null : textoDoCobrar(l.cobrarEm, agora)
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
          <span className="tf-peq">{l.pessoaNome ?? l.casalNomes ?? "—"}</span>
        </div>
        <div className="tf-col">
          <span className="tf-t13">{l.familiaNome ?? l.processoNome ?? "—"}</span>
          <span className="tf-peq">{rotularFase(l.faseMacroKey) ?? l.faseAtualDoProcessoLabel ?? "—"}</span>
        </div>
        <div className="tf-col">
          <span className="tf-t13">{cancelada ? "—" : passoLabelDe(l).label}</span>
          <span className={`tf-st ${st.tom}`}>{st.texto}</span>
        </div>
        <div className="tf-col">
          <span className="tf-t13">{cancelada ? "—" : bola.texto}</span>
          {cobrar
            ? <span className={`tf-peq tf-b ${cobrar.tom === "vermelho" ? "tf-verm" : cobrar.tom === "ambar" ? "tf-amb" : ""}`} title={l.cobrarEmPadrao ? "Padrão: 7 dias depois do pedido ou da última cobrança" : undefined}>{cobrar.texto}</span>
            : <span className="tf-peq">—</span>}
        </div>
        <div className={`tf-t13 ${semDono && !cancelada ? "tf-b tf-verm" : ""}`}>{cancelada ? "—" : l.responsavelNome ?? "Sem responsável"}</div>
        <div className="tf-t13" style={{ fontVariantNumeric: "tabular-nums" }}>{cancelada ? "—" : textoDoIniciou(l)}</div>
        <div className={`tf-t13 ${l.atrasada && !cancelada ? "tf-b tf-verm" : ""}`}>{cancelada ? "—" : textoPrazoDaTarefa(l) || "—"}</div>
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
      <div className="tf-rolagem">
        <div className="tf-g tf-hd">
          <div>
            <button type="button" className={`tf-chk ${todasMarcadas ? "on" : ""}`} aria-label="Selecionar todas" aria-pressed={todasMarcadas} disabled={todasDaPagina.length === 0}
              onClick={() => onTodas(todasDaPagina, !todasMarcadas)} />
          </div>
          <div>Certidão · pessoa</div><div>Família · fase</div><div>Passo · status</div><div>Aguardando · cobrar em</div><div>Responsável</div><div>Iniciou</div><div>Prazo</div><div>Risco</div><div />
        </div>
        {!vazio && grupos.map(([nome, itens]) => {
          const trabalho = itens.filter((l) => !ehCancelada(l))
          const ids = trabalho.map((l) => l.taskId)
          const todas = ids.length > 0 && ids.every((id) => sel[id]); const alguma = ids.some((id) => sel[id])
          const processoId = agrupar === "fam" ? itens[0]?.processoId ?? null : null
          const resumo = agrupar === "fam" ? resumoDoGrupo(processoId != null ? processos.get(processoId) ?? null : null, itens) : ""
          const subgrupos = agrupar === "fam" && dentro !== "none" ? agruparDentroDaFamilia(itens, dentro) : null
          return (
            <div key={nome} role="rowgroup" aria-label={`Grupo ${nome}`}>
              <div className="tf-grp">
                <button type="button" className={`tf-chk ${todas ? "on" : alguma ? "mid" : ""}`} aria-label={`Selecionar o grupo ${nome}`} disabled={ids.length === 0} onClick={() => onSelecionar(ids, !todas)} />
                {processoId != null
                  ? <Link className="fam" href={`/torre/processo/${processoId}`}>{nome}</Link>
                  : <b>{nome}</b>}
                {resumo && <span className="resumo">{resumo}</span>}
                <span className="tf-pilula">{trabalho.length > 0 ? `${trabalho.length} ${trabalho.length === 1 ? "tarefa" : "tarefas"}` : `${itens.length} ${itens.length === 1 ? "cancelada" : "canceladas"}`}</span>
                {processoId != null && <button type="button" className="foco" onClick={() => onFocoDaFamilia(processoId)}>Foco ›</button>}
              </div>
              {subgrupos
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
                : itens.map(renderLinha)}
            </div>
          )
        })}
      </div>
      <div className="tf-rodape">{rodape}</div>
    </div>
  )
}
