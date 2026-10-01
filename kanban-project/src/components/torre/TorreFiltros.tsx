"use client"
// src/components/torre/TorreFiltros.tsx — o PAINEL DE FILTROS da aba Tarefas, igual ao protótipo (Torre nova, 01/10/2026).
// Linha 1 (8 campos): Família · Responsável · Prazo · Iniciou · Nacionalidade · Fase · Certidão · Risco.
// Linha 2: Agrupar por · Dentro da família · "Mais filtros · 6" · Ordenar por · "Mostrando N de M · 50 por página" · Limpar filtros.
// "Mais filtros": Passo atual · Cartório · Prioridade · Cobrança · Status · Só linha reta.
// SEM DUPLICAR O QUE AS VISÕES JÁ FAZEM: Responsável não tem "Eu" nem "Sem responsável" (são as visões Minhas / Sem responsável),
// Prazo não tem "Vencidas" (é a visão Vencidas) e Status só tem A iniciar · Em andamento · Cancelada (o resto é Aguardando/Bloqueadas).
// Só desenha e devolve o estado: TODA regra (predicados, AND, "Mostrando N de M", contadores) mora em lib/operacional/torre-filtros.ts —
// a mesma função que a tabela usa. Cada <select> mostra SEMPRE o valor do estado (nunca "volta ao padrão" como no protótipo).
import { useMemo, useState } from "react"
import { rotularFase, useRotulosDeFaseProntos } from "@/src/components/operacao/kit-operacional"
import {
  CERTIDOES_TORRE, PRAZOS_TORRE, PRIORIDADES_TORRE, RISCOS_TORRE, ROTULO_CERTIDAO_TORRE, ROTULO_PRIORIDADE_TORRE, ROTULO_PRAZO_TORRE, ROTULO_RISCO_TORRE,
  contarPorPrazo, opcoesDosFiltros, type ContextoDeFiltro, type FiltrosTorre, type OrdemTorre, type PrazoTorre,
} from "@/lib/operacional/torre-filtros"
import { INICIOU_TORRE, ROTULO_INICIOU_TORRE, type Agrupar, type IniciouTorre } from "@/lib/operacional/torre-tarefas-tela"
import { ROTULO_STATUS } from "@/src/lib/home/rotulo-status-tarefa"
import type { LinhaTorre } from "./tipos"

export type DentroDaFamilia = "none" | "pessoa" | "orgao" | "passo"
export interface PaisDoFiltro { chave: string; rotulo: string }

/** O valor de um filtro de LISTA para o <select>: 1 valor = ele; vazio = ""; vários (URL antiga) = "__varios". */
const valorUnico = (v: string[]): string => (v.length === 0 ? "" : v.length === 1 ? v[0] : "__varios")

export function TorreFiltros({
  linhasTodas, linhasBase, filtros, onFiltros, ctx, mostrando, total, porPagina, paisChave, paises, onPais,
  agrupar, onAgrupar, dentro, onDentro, onLimparTudo,
}: {
  /** As tarefas abertas da nacionalidade — de onde saem as OPÇÕES (só o que existe em tarefa aberta). */
  linhasTodas: LinhaTorre[]
  /** A lista base (indicador + visão + busca já aplicados): sobre ela se contam os números dentro do Prazo. */
  linhasBase: LinhaTorre[]
  filtros: FiltrosTorre
  onFiltros: (f: FiltrosTorre) => void
  ctx: ContextoDeFiltro
  /** Do `aplicarFiltros` — o MESMO número que a tabela desenha. */
  mostrando: number
  /** O número da visão em vigor (a lista que o painel recorta). */
  total: number
  porPagina: number
  /** A nacionalidade em vigor — o DONO é o seletor do topo (um estado só, no casco); este campo lê e escreve o mesmo estado. */
  paisChave: string
  paises: PaisDoFiltro[]
  onPais: (chave: string) => void
  agrupar: Agrupar
  onAgrupar: (a: Agrupar) => void
  dentro: DentroDaFamilia
  onDentro: (d: DentroDaFamilia) => void
  /** "Limpar filtros": zera filtros, selects, campos de texto, nacionalidade, busca e o indicador — e, com eles, a URL. */
  onLimparTudo: () => void
}) {
  useRotulosDeFaseProntos()
  const [mais, setMais] = useState(false)
  const [intervaloPrazo, setIntervaloPrazo] = useState(false)
  const [intervaloIniciou, setIntervaloIniciou] = useState(false)
  const opcoes = useMemo(() => opcoesDosFiltros(linhasTodas), [linhasTodas])
  const porPrazo = useMemo(() => contarPorPrazo(linhasBase, ctx), [linhasBase, ctx])
  const semCartorio = useMemo(() => linhasBase.filter((l) => l.orgaoId == null && !l.terceiroNome && l.statusTarefa !== "CANCELADA").length, [linhasBase])

  const set = <K extends keyof FiltrosTorre>(k: K, v: FiltrosTorre[K]) => onFiltros({ ...filtros, [k]: v })
  const lista = (k: "responsavel" | "fase" | "certidao" | "risco" | "passo" | "orgao" | "prioridade" | "status") => (v: string) => {
    if (v === "__varios") return // já é o estado: nada a mudar
    onFiltros({ ...filtros, [k]: v === "" ? [] : [v] } as FiltrosTorre)
  }

  // PRAZO (um valor por vez; "Intervalo de/até…" abre as duas datas; a visão Vencidas cuida de "vencidas", então não é opção).
  const prazoAtivo = filtros.prazo.length > 0
  const prazoSel = intervaloPrazo || filtros.prazoDe || filtros.prazoAte ? "__intervalo" : prazoAtivo ? valorUnico(filtros.prazo) : ""
  const escolherPrazo = (v: string) => {
    if (v === "__intervalo") { setIntervaloPrazo(true); onFiltros({ ...filtros, prazo: [] }); return }
    setIntervaloPrazo(false)
    onFiltros({ ...filtros, prazo: v === "" ? [] : v === "__varios" ? filtros.prazo : [v as PrazoTorre], prazoDe: null, prazoAte: null })
  }
  // INICIOU (campo `iniciouEm`).
  const iniciouSel = intervaloIniciou || filtros.iniciouDe || filtros.iniciouAte ? "__intervalo" : filtros.iniciou ?? ""
  const escolherIniciou = (v: string) => {
    if (v === "__intervalo") { setIntervaloIniciou(true); onFiltros({ ...filtros, iniciou: null }); return }
    setIntervaloIniciou(false)
    onFiltros({ ...filtros, iniciou: v === "" ? null : (v as IniciouTorre), iniciouDe: null, iniciouAte: null })
  }
  // COBRANÇA: um select, dois filtros (acompanhamento "em até 3 dias" / "sem cobrança marcada" e a cobrança "sem resposta (escalada)").
  const cobrancaSel = filtros.cobranca.includes("semresposta") ? "semresposta" : filtros.cobranca.includes("vencida") ? "vencida" : filtros.acomp.includes("3dias") ? "3dias" : filtros.acomp.includes("sem") ? "sem" : filtros.acomp.includes("vencido") ? "vencido" : ""
  const escolherCobranca = (v: string) => {
    if (v === "3dias" || v === "sem" || v === "vencido") onFiltros({ ...filtros, acomp: [v], cobranca: [] })
    else if (v === "semresposta" || v === "vencida") onFiltros({ ...filtros, acomp: [], cobranca: [v] })
    else onFiltros({ ...filtros, acomp: [], cobranca: [] })
  }
  const orgaoSel = valorUnico(filtros.orgao)
  const statusPermitidos = ["NAO_INICIADA", "EM_ANDAMENTO", "CANCELADA"]
  // Status vindo de URL/visão salva antiga fora dos três (ex.: Bloqueada): continua visível no campo, mas a lista não o oferece.
  const statusAtivoFora = filtros.status.filter((s) => !statusPermitidos.includes(s))

  return (
    <div className="tf-fx" role="search" aria-label="Filtros das tarefas" data-filtros="1">
      <label>Família
        <input className="tf-in" type="text" placeholder="Digite: Ant…" aria-label="Família" value={filtros.familia ?? ""} maxLength={80} onChange={(e) => set("familia", e.target.value.trim() ? e.target.value : null)} />
      </label>
      <label>Responsável
        <select className="tf-in" aria-label="Responsável" value={valorUnico(filtros.responsavel)} onChange={(e) => lista("responsavel")(e.target.value)}>
          <option value="">Todos</option>
          {opcoes.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          {filtros.responsavel.includes("eu") && <option value="eu">Eu (a visão Minhas faz isto)</option>}
          {filtros.responsavel.includes("sem") && <option value="sem">Sem responsável (a visão faz isto)</option>}
          {filtros.responsavel.length > 1 && <option value="__varios">{filtros.responsavel.length} selecionados</option>}
        </select>
      </label>
      <label>Prazo
        <select className="tf-in" aria-label="Prazo" value={prazoSel} onChange={(e) => escolherPrazo(e.target.value)}>
          <option value="">Qualquer</option>
          {PRAZOS_TORRE.filter((p) => p !== "vencidas" || filtros.prazo.includes("vencidas")).map((p) => <option key={p} value={p}>{ROTULO_PRAZO_TORRE[p]} ({porPrazo[p]})</option>)}
          <option value="__intervalo">Intervalo de/até…</option>
          {filtros.prazo.length > 1 && <option value="__varios">{filtros.prazo.length} selecionados</option>}
        </select>
      </label>
      <label>Iniciou
        <select className="tf-in" aria-label="Iniciou" value={iniciouSel} onChange={(e) => escolherIniciou(e.target.value)}>
          <option value="">Qualquer data</option>
          {INICIOU_TORRE.map((i) => <option key={i} value={i}>{ROTULO_INICIOU_TORRE[i]}</option>)}
          <option value="__intervalo">Intervalo de/até…</option>
        </select>
      </label>
      <label>Nacionalidade
        <select className="tf-in" aria-label="Nacionalidade" value={paisChave} onChange={(e) => onPais(e.target.value)}>
          <option value="">Todas</option>
          {paises.map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
        </select>
      </label>
      <label>Fase
        <select className="tf-in" aria-label="Fase" value={valorUnico(filtros.fase)} onChange={(e) => lista("fase")(e.target.value)}>
          <option value="">Todas</option>
          {opcoes.fases.map((f) => <option key={f} value={f}>{rotularFase(f) ?? f}</option>)}
          {filtros.fase.length > 1 && <option value="__varios">{filtros.fase.length} selecionadas</option>}
        </select>
      </label>
      <label>Certidão
        <select className="tf-in" aria-label="Certidão" value={valorUnico(filtros.certidao)} onChange={(e) => lista("certidao")(e.target.value)}>
          <option value="">Todas</option>
          {CERTIDOES_TORRE.map((c) => <option key={c} value={c}>{ROTULO_CERTIDAO_TORRE[c]}</option>)}
          {filtros.certidao.length > 1 && <option value="__varios">{filtros.certidao.length} selecionadas</option>}
        </select>
      </label>
      <label>Risco
        <select className="tf-in" aria-label="Risco" value={valorUnico(filtros.risco)} onChange={(e) => lista("risco")(e.target.value)}>
          <option value="">Todos</option>
          {RISCOS_TORRE.map((r) => <option key={r} value={r}>{ROTULO_RISCO_TORRE[r]}</option>)}
          {filtros.risco.length > 1 && <option value="__varios">{filtros.risco.length} selecionados</option>}
        </select>
      </label>

      {(prazoSel === "__intervalo" || iniciouSel === "__intervalo") && (
        <>
          {prazoSel === "__intervalo" && (
            <div className="tf-int" style={{ gridColumn: "span 4", display: "flex", gap: 8 }} aria-label="Intervalo do prazo">
              <label style={{ flex: 1 }}>Prazo de<input className="tf-in" type="date" aria-label="Prazo de" value={filtros.prazoDe ?? ""} max={filtros.prazoAte ?? undefined} onChange={(e) => set("prazoDe", e.target.value || null)} /></label>
              <label style={{ flex: 1 }}>Prazo até<input className="tf-in" type="date" aria-label="Prazo até" value={filtros.prazoAte ?? ""} min={filtros.prazoDe ?? undefined} onChange={(e) => set("prazoAte", e.target.value || null)} /></label>
            </div>
          )}
          {iniciouSel === "__intervalo" && (
            <div className="tf-int" style={{ gridColumn: "span 4", display: "flex", gap: 8 }} aria-label="Intervalo do início">
              <label style={{ flex: 1 }}>Iniciou de<input className="tf-in" type="date" aria-label="Iniciou de" value={filtros.iniciouDe ?? ""} max={filtros.iniciouAte ?? undefined} onChange={(e) => set("iniciouDe", e.target.value || null)} /></label>
              <label style={{ flex: 1 }}>Iniciou até<input className="tf-in" type="date" aria-label="Iniciou até" value={filtros.iniciouAte ?? ""} min={filtros.iniciouDe ?? undefined} onChange={(e) => set("iniciouAte", e.target.value || null)} /></label>
            </div>
          )}
        </>
      )}

      <div className="tf-fx-linha2">
        <label>Agrupar por
          <select className="tf-in" aria-label="Agrupar por" value={agrupar} onChange={(e) => onAgrupar(e.target.value as Agrupar)}>
            <option value="fam">Família</option><option value="resp">Responsável</option><option value="fase">Fase</option>
            {agrupar === "org" && <option value="org">Cartório</option>}
            <option value="none">Sem agrupamento</option>
          </select>
        </label>
        <label>Dentro da família
          <select className="tf-in" aria-label="Dentro da família" value={dentro} disabled={agrupar !== "fam"} onChange={(e) => onDentro(e.target.value as DentroDaFamilia)}>
            <option value="pessoa">Pessoa</option><option value="orgao">Órgão</option><option value="passo">Passo</option><option value="none">Nenhum</option>
          </select>
        </label>
        <span className="tf-sep" />
        <button type="button" className="tf-mini" aria-expanded={mais} onClick={() => setMais((m) => !m)}>{mais ? "Menos filtros" : "Mais filtros · 6"}</button>
        <span>Ordenar por</span>
        <select className="tf-in peq" aria-label="Ordenar por" value={filtros.ordenar ?? ""} onChange={(e) => set("ordenar", (e.target.value || null) as OrdemTorre | null)}>
          <option value="">Ordem padrão (risco, prazo)</option>
          <option value="prazo">Prazo</option><option value="familia">Família</option><option value="responsavel">Responsável</option><option value="criacao">Criação</option>
          {filtros.ordenar === "risco" && <option value="risco">Risco</option>}
        </select>
        <span className="tf-mostrando" role="status" aria-live="polite">Mostrando {mostrando} de {total} · {porPagina} por página</span>
        <button type="button" className="tf-mini forte" onClick={onLimparTudo}>Limpar filtros</button>
      </div>

      {mais && (
        <>
          <label>Passo atual
            <select className="tf-in" aria-label="Passo atual" value={valorUnico(filtros.passo)} onChange={(e) => lista("passo")(e.target.value)}>
              <option value="">Todos</option>
              {opcoes.passos.map((p) => <option key={p} value={p}>{p}</option>)}
              {filtros.passo.length > 1 && <option value="__varios">{filtros.passo.length} selecionados</option>}
            </select>
          </label>
          <label>Cartório
            <select className="tf-in" aria-label="Cartório" value={orgaoSel} onChange={(e) => lista("orgao")(e.target.value)}>
              <option value="">Todos</option>
              <option value="sem">Sem cartório ({semCartorio})</option>
              <optgroup label="Digite para buscar…">{opcoes.orgaos.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</optgroup>
              {filtros.orgao.length > 1 && <option value="__varios">{filtros.orgao.length} selecionados</option>}
            </select>
          </label>
          <label>Prioridade
            <select className="tf-in" aria-label="Prioridade" value={valorUnico(filtros.prioridade)} onChange={(e) => lista("prioridade")(e.target.value)}>
              <option value="">Todas</option>
              {PRIORIDADES_TORRE.map((p) => <option key={p} value={p}>{ROTULO_PRIORIDADE_TORRE[p]}</option>)}
              {filtros.prioridade.length > 1 && <option value="__varios">{filtros.prioridade.length} selecionadas</option>}
            </select>
          </label>
          <label>Cobrança
            <select className="tf-in" aria-label="Cobrança" value={cobrancaSel} onChange={(e) => escolherCobranca(e.target.value)}>
              <option value="">Qualquer</option>
              <option value="3dias">Vence em até 3 dias</option>
              <option value="semresposta">Sem resposta (escalada)</option>
              <option value="sem">Sem cobrança marcada</option>
              {(cobrancaSel === "vencida" || cobrancaSel === "vencido") && <option value={cobrancaSel}>{cobrancaSel === "vencida" ? "Cobrança vencida" : "Acompanhamento vencido"}</option>}
            </select>
          </label>
          <label>Status
            <select className="tf-in" aria-label="Status" value={valorUnico(filtros.status)} onChange={(e) => lista("status")(e.target.value)}>
              <option value="">Todos</option>
              <option value="NAO_INICIADA">A iniciar</option><option value="EM_ANDAMENTO">Em andamento</option><option value="CANCELADA">Cancelada</option>
              {statusAtivoFora.length > 0 && filtros.status.length === 1 && <option value={filtros.status[0]}>{ROTULO_STATUS[filtros.status[0]] ?? filtros.status[0]}</option>}
              {filtros.status.length > 1 && <option value="__varios">{filtros.status.length} selecionados</option>}
            </select>
          </label>
          <label className="tf-cb"><input type="checkbox" checked={filtros.linhaReta} onChange={(e) => set("linhaReta", e.target.checked)} /> Só linha reta</label>
        </>
      )}
    </div>
  )
}
