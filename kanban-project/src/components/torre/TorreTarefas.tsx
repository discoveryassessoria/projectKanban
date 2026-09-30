"use client"
// src/components/torre/TorreTarefas.tsx — aba TAREFAS (Bloco G1–G3, G6 + absorção da Operação).
// A MESMA projeção da Operação (/api/torre/tarefas). Lote com toast de 6 s + Desfazer, ação rápida por linha, "Cobrar todos os
// vencidos (N)", painel espelhado da tarefa, visões fixas (inclui Minhas, Acompanhamentos vencidos e Feito), subagrupamento dentro
// da família, "Adiar acompanhamento", "Vincular órgão nas N", "novas", "Fazer agora", tarefa transversal e iniciar em lote.
// Nenhuma regra nova: cada botão chama a porta que a Operação já usa. Nada de dado de exemplo.
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { DocumentoOperationalDrawer } from "@/src/components/kanban/DocumentoOperationalDrawer"
import { TarefaTransversalModal } from "@/src/components/kanban/TarefaTransversalModal"
import { RegistrarContatoModal } from "@/src/components/operacao/RegistrarContatoModal"
import {
  passoLabelDe, statusTarefaTxt, statusTarefaCls, acompTxtCompleto, aplicarBusca, docTipoTxt, acaoDe, concluirLabelDe, aIniciarEfetivo, precisaDeOrgaoEmissor, agruparDentroDaFamilia,
} from "@/src/components/operacao/operacao-v3-derivacoes"
import type { LinhaOperacaoV3, RespostaTarefas } from "@/src/components/operacao/operacao-v3-tipos"
import { urlArvoreDoProcesso } from "@/lib/operacional/navegacao"
import { api, erroDe, Campo, Modal, resumoDoLote, useTorre, type Desfazer } from "./torre-base"
import { bolaDe, riscoDe, temAcompanhamento, type LinhaTorre } from "./tipos"
import type { ProcessoDaTorre } from "./tipos-processos"
import { PainelTorreTarefa } from "./PainelTorreTarefa"
import { CobrarTodosVencidos } from "./CobrarTodosVencidos"
import { VisoesSalvas, type SpecDaVisao } from "./VisoesSalvas"
import { TorreFeito } from "./TorreFeito"
import { VincularOrgaoLoteModal } from "./VincularOrgaoLoteModal"
import { useAdiarAcompanhamento } from "./adiar-acompanhamento"
import { useNovasDaFamilia } from "./novas-da-familia"
import { linhasDoKpi, KPIS, type ChaveKpi } from "@/lib/operacional/torre-kpis"

type Agrupar = "fam" | "resp" | "org" | "fase" | "none"
type Dentro = "none" | "pessoa" | "orgao" | "passo"
export type VisaoTarefas = "todas" | "vencidas" | "semdono" | "aguard" | "cobranca" | "acompvenc" | "minhas" | "feito"

const VISOES: Array<[VisaoTarefas, string]> = [
  ["todas", "Todas as abertas"], ["minhas", "Minhas tarefas"], ["vencidas", "Vencidas"], ["semdono", "Sem responsável"], ["aguard", "Com o cartório"],
  ["acompvenc", "Acompanhamentos vencidos"], ["cobranca", "Cobranças a fazer (vencidas)"], ["feito", "Feito"],
]
/** As chaves aceitas em `?visao=` (a Torre valida a URL com esta lista). */
export const CHAVES_DE_VISAO: string[] = VISOES.map(([v]) => v)
const predicadoDe = (v: VisaoTarefas, usuarioId: number | null): ((l: LinhaTorre) => boolean) => {
  switch (v) {
    case "vencidas": return (l) => l.atrasada
    case "semdono": return (l) => l.responsavelId == null
    case "aguard": return (l) => l.estadoOperacao === "AGUARDANDO"
    case "cobranca": return (l) => l.cobravelVencida
    case "acompvenc": return (l) => l.acompanhamentoVencido === true
    case "minhas": return (l) => usuarioId != null && l.responsavelId === usuarioId
    default: return () => true
  }
}
const AGRUPAR_VALIDOS: Agrupar[] = ["fam", "resp", "org", "fase", "none"]
const CHAVE: Record<Agrupar, (l: LinhaTorre) => string> = {
  fam: (l) => l.familiaNome ?? l.processoNome ?? "Sem família",
  resp: (l) => l.responsavelNome ?? "Sem responsável",
  org: (l) => l.terceiroNome ?? "Sem cartório",
  fase: (l) => l.faseAtualDoProcessoLabel ?? l.faseMacroKey ?? "Sem fase",
  none: () => "Todas",
}

interface Funcionario { id: number; nome: string; email?: string; tarefasAtivas: number }
interface RespLote { total?: number; sucesso?: number; falha?: number; itens?: Array<{ ok: boolean; mensagem?: string }>; desfazer?: Desfazer | null; error?: string }

export function TorreTarefas({ linhas, carregando, erro, kpi, busca, paisChave, paisRotulo, visaoPedida, tarefaPedida, onTarefaAtendida, processos, processoFoco, versao, onAplicarSpec }: {
  linhas: LinhaTorre[]; carregando: boolean; erro: boolean
  /** Filtro do KPI clicado no cabeçalho (o MESMO predicado que dá o número do cartão). */
  kpi: ChaveKpi | null
  /** A busca do cabeçalho. */
  busca: string
  /** A nacionalidade escolhida (chave) — só para a visão salva. */
  paisChave: string
  /** O rótulo da nacionalidade escolhida — filtra também o "Feito". */
  paisRotulo?: string | null
  /** `?visao=` da URL (já validada pelo casco). */
  visaoPedida?: string | null
  /** `?tarefa=` da URL: abre o drawer daquela tarefa (abertas, senão concluídas recentes). */
  tarefaPedida?: number | null
  onTarefaAtendida?: () => void
  /** Todos os processos da Torre — escolher a família da tarefa transversal. */
  processos?: ProcessoDaTorre[]
  /** A família em foco (ou `?processo=`) — marca as "novas" e sugere a família da transversal. */
  processoFoco?: number | null
  /** Sobe a cada recarga da Torre — o "Feito" acompanha. */
  versao?: number
  /** Uma visão salva com KPI/país/busca próprios: o casco os adota. */
  onAplicarSpec: (s: { kpi: ChaveKpi | null; pais: string; busca: string }) => void
}) {
  const router = useRouter()
  const { permissoes, avisar, recarregar, abrirFoco } = useTorre()
  const [agrupar, setAgrupar] = useState<Agrupar>("fam")
  const [dentro, setDentro] = useState<Dentro>("none")
  const [visaoSel, setVisaoSel] = useState<string>(visaoPedida ?? "todas")
  const [visaoVista, setVisaoVista] = useState<string | null>(visaoPedida ?? null)
  const [visaoSalva, setVisaoSalva] = useState<VisaoTarefas>("todas")
  const [sel, setSel] = useState<Record<number, true>>({})
  const [pessoas, setPessoas] = useState<Funcionario[]>([])
  const [pessoaId, setPessoaId] = useState<number | null>(null)
  const [repactuar, setRepactuar] = useState(false)
  const [cobrarLinha, setCobrarLinha] = useState<LinhaTorre | null>(null)
  const [aberta, setAberta] = useState<LinhaOperacaoV3 | null>(null)
  const [focoIds, setFocoIds] = useState<number[] | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [vincular, setVincular] = useState<number[] | null>(null)
  const [escolhendoTransversal, setEscolhendoTransversal] = useState(false)
  const [transversalProcessoId, setTransversalProcessoId] = useState<number | null>(null)
  const [feito, setFeito] = useState<LinhaOperacaoV3[] | null>(null)
  const [erroFeito, setErroFeito] = useState(false)
  const adiar = useAdiarAcompanhamento()
  const novas = useNovasDaFamilia(processoFoco ?? null)

  // A URL pode mudar depois de montado: a visão nova entra no estado (ajuste durante a renderização, sem efeito).
  if ((visaoPedida ?? null) !== visaoVista) { setVisaoVista(visaoPedida ?? null); if (visaoPedida) setVisaoSel(visaoPedida) }

  const podeEditar = !!permissoes?.editar
  const usuarioId = permissoes?.usuarioId ?? null
  useEffect(() => {
    if (!podeEditar) return
    let vivo = true
    void api<{ funcionarios: Funcionario[] }>("/api/operacao/atribuiveis").then((r) => {
      if (vivo && r.ok) { setPessoas(r.data.funcionarios ?? []); setPessoaId((atual) => atual ?? r.data.funcionarios?.[0]?.id ?? null) }
    })
    return () => { vivo = false }
  }, [podeEditar])

  // FEITO: concluídas dos últimos 14 dias, escopo equipe (a mesma leitura da aba Feito da Operação).
  useEffect(() => {
    let vivo = true
    void api<RespostaTarefas>("/api/operacao/tarefas?visao=feito&escopo=equipe").then((r) => {
      if (!vivo) return
      if (r.ok) { setFeito(r.data.linhas ?? []); setErroFeito(false) } else setErroFeito(true)
    })
    return () => { vivo = false }
  }, [versao])

  // ?tarefa=<id>: abre o drawer daquela tarefa — nas abertas; se não estiver, nas concluídas recentes; senão avisa.
  // A resolução acontece durante a renderização (sem efeito); o aviso e o "atendida" saem no efeito logo abaixo.
  const [tratada, setTratada] = useState<{ id: number; achou: boolean } | null>(null)
  if (tarefaPedida == null && tratada != null) setTratada(null)
  if (tarefaPedida != null && tratada?.id !== tarefaPedida && !carregando && !erro) {
    const l = linhas.find((x) => x.taskId === tarefaPedida)
    if (l) { setTratada({ id: tarefaPedida, achou: true }); setAberta(l) }
    else if (feito != null || erroFeito) {
      const f = feito?.find((x) => x.taskId === tarefaPedida)
      setTratada({ id: tarefaPedida, achou: !!f })
      if (f) { setVisaoSel("feito"); setAberta(f) }
    }
  }
  useEffect(() => {
    if (tarefaPedida == null || tratada?.id !== tarefaPedida) return
    if (!tratada.achou) avisar("Tarefa não encontrada entre as abertas ou concluídas recentes")
    onTarefaAtendida?.()
  }, [tarefaPedida, tratada, avisar, onTarefaAtendida])

  // A visão em vigor: uma das fixas, ou a `visao` guardada dentro da visão salva escolhida.
  const visao: VisaoTarefas = (VISOES.some(([v]) => v === visaoSel) ? visaoSel : visaoSalva) as VisaoTarefas
  const base = useMemo(() => (kpi ? linhasDoKpi(kpi, linhas) : linhas), [linhas, kpi])
  const visiveis = useMemo(() => {
    const l = aplicarBusca(base.filter(predicadoDe(visao, usuarioId)), busca) as LinhaTorre[]
    // As NOVAS (último aviso "chegou trabalho") sobem ao topo; o resto mantém a ordem.
    return novas.size ? [...l].sort((a, b) => Number(novas.has(b.taskId)) - Number(novas.has(a.taskId))) : l
  }, [base, visao, usuarioId, busca, novas])
  const feitoVisiveis = useMemo(
    () => aplicarBusca((feito ?? []).filter((l) => !paisRotulo || l.pais === paisRotulo), busca),
    [feito, paisRotulo, busca],
  )
  const nNovas = useMemo(() => linhas.filter((l) => novas.has(l.taskId)).length, [linhas, novas])
  const semOrgao = useMemo(() => visiveis.filter(precisaDeOrgaoEmissor), [visiveis])
  const contagem = (v: VisaoTarefas): number | null => {
    if (v === "feito") return feito ? feito.length : null
    if (v === "minhas" || v === "acompvenc" || v === "cobranca") return linhas.filter(predicadoDe(v, usuarioId)).length
    return null
  }
  const specAtual: SpecDaVisao = { visao, agrupar, dentro, kpi, pais: paisChave || null, busca: busca.trim() || null }
  const grupos = useMemo(() => {
    const m = new Map<string, LinhaTorre[]>()
    for (const l of visiveis) { const k = CHAVE[agrupar](l); m.set(k, [...(m.get(k) ?? []), l]) }
    return [...m.entries()]
  }, [visiveis, agrupar])
  const selIds = useMemo(() => Object.keys(sel).map(Number).filter((id) => linhas.some((l) => l.taskId === id)), [sel, linhas])
  const selSemOrgao = useMemo(() => linhas.filter((l) => sel[l.taskId] && precisaDeOrgaoEmissor(l)).map((l) => l.taskId), [linhas, sel])
  const pessoa = pessoas.find((p) => p.id === pessoaId)

  const alternar = (ids: number[], ligar: boolean) => setSel((s) => {
    const n = { ...s }
    for (const id of ids) { if (ligar) n[id] = true; else delete n[id] }
    return n
  })

  const lote = async (acao: string, extra: Record<string, unknown> = {}) => {
    setOcupado(true)
    const r = await api<RespLote>("/api/torre/tarefas/lote", "POST", { acao, tarefaIds: selIds, ...extra })
    setOcupado(false)
    if (r.data && typeof r.data.total === "number") {
      const verbo = { ATRIBUIR: `atribuída(s) a ${pessoa?.nome ?? "a pessoa"}`, PRIORIDADE_ALTA: "com prioridade alta", REPACTUAR: "repactuada(s)", COBRAR: "cobrada(s) ao cartório" }[acao]
      avisar(`${resumoDoLote(r.data)} — ${verbo}.`, r.data.desfazer ?? null)
      setSel({}); recarregar()
      return { ok: true as const }
    }
    avisar(erroDe(r.data))
    return { ok: false as const, mensagem: erroDe(r.data) }
  }

  // Iniciar em lote — a MESMA porta da Operação (envia ao cartório; as que não podem voltam como "ignoradas").
  const iniciarSelecionadas = async () => {
    setOcupado(true)
    const r = await api<{ ok?: boolean; iniciadas?: number; ignoradas?: Array<{ motivo: string }>; mensagem?: string }>("/api/operacao/tarefas/iniciar-lote", "POST", { tarefaIds: selIds })
    setOcupado(false)
    if (r.ok && r.data.ok) avisar(`${r.data.iniciadas} certidões enviadas.${r.data.ignoradas?.length ? ` (${r.data.ignoradas.length} ignorada(s): ${r.data.ignoradas[0]?.motivo})` : ""}`)
    else avisar(r.data.mensagem ?? erroDe(r.data, "Não foi possível iniciar em lote."))
    setSel({}); recarregar()
  }

  const atribuirRapido = async (l: LinhaTorre) => {
    const r = await api<{ mensagem?: string; desfazer?: Desfazer }>(`/api/torre/tarefas/${l.taskId}/atribuir-sugerido`, "POST")
    if (r.ok) { avisar(r.data.mensagem ?? "Atribuída.", r.data.desfazer ?? null); recarregar() } else avisar(erroDe(r.data))
  }
  const iniciarRapido = async (l: LinhaTorre) => {
    const r = await api<{ mensagem?: string }>(`/api/torre/tarefas/${l.taskId}/iniciar`, "POST", {})
    avisar(r.ok ? (r.data.mensagem ?? "Iniciada.") : erroDe(r.data))
    if (r.ok) recarregar()
  }

  // Genealogia sem documento não abre o drawer documental: "Continuar" leva à Árvore do processo (igual à Operação).
  const abrirLinha = (l: LinhaOperacaoV3) => {
    if (l.faseMacroKey === "genealogia" && l.documentoId == null && l.processoId != null) { router.push(urlArvoreDoProcesso(l.processoId)); return }
    setAberta(l)
  }

  // ▶ Fazer agora: o drawer da 1ª tarefa da lista visível + Anterior/Próxima com "i de N".
  const linhaPorId = useMemo(() => new Map<number, LinhaOperacaoV3>([...(feito ?? []).map((l) => [l.taskId, l] as const), ...linhas.map((l) => [l.taskId, l] as const)]), [feito, linhas])
  const iniciarFoco = () => {
    const ordem = grupos.flatMap(([, itens]) => itens)
    if (!ordem.length) { avisar("Nada a fazer."); return }
    setFocoIds(ordem.map((l) => l.taskId)); abrirLinha(ordem[0])
  }
  const navFoco = (dir: 1 | -1) => {
    if (!focoIds || !aberta) return
    const i = focoIds.indexOf(aberta.taskId)
    for (let k = 1; k <= focoIds.length; k++) {
      const prox = linhaPorId.get(focoIds[(((i + dir * k) % focoIds.length) + focoIds.length) % focoIds.length])
      if (prox) { setAberta(prox); return }
    }
  }
  const fecharAberta = () => { setAberta(null); setFocoIds(null) }

  if (erro) return <div className="tor-card pad">Não foi possível carregar as tarefas. Tente recarregar a página.</div>
  if (carregando) return <div className="tor-card pad small">Carregando tarefas…</div>

  const linhaAberta: LinhaOperacaoV3 | null = aberta ? linhaPorId.get(aberta.taskId) ?? aberta : null
  const posFoco = focoIds && linhaAberta ? focoIds.indexOf(linhaAberta.taskId) : -1
  const painel = linhaAberta ? (
    <>
      {posFoco >= 0 && focoIds && (
        <div className="tor-sel" role="toolbar" aria-label="Modo foco" style={{ borderRadius: 0 }}>
          <span className="tor-p blu">Modo foco</span>
          <b>{posFoco + 1} de {focoIds.length}</b>
          <div className="tor-meter" style={{ width: 120, marginBottom: 0 }}><i className="ambar" style={{ width: `${Math.round(((posFoco + 1) / focoIds.length) * 100)}%` }} /></div>
          <div style={{ flexGrow: 1 }} />
          <button className="tor-btn" onClick={() => navFoco(-1)}>← Anterior</button>
          <button className="tor-btn" onClick={() => navFoco(1)}>Próxima →</button>
          <button className="tor-btn" onClick={fecharAberta}>Sair</button>
        </div>
      )}
      <PainelTorreTarefa linha={linhaAberta} />
    </>
  ) : null

  const renderLinha = (l: LinhaTorre) => {
    const bola = bolaDe(l); const risco = riscoDe(l); const acao = acaoDe(l)
    const iniciavel = aIniciarEfetivo(l) && l.podeIniciar && !!permissoes?.iniciar
    return (
      <div key={l.taskId} className={`tor-row tor-gT ${sel[l.taskId] ? "sel" : ""}`}>
        <button className={`tor-chk ${sel[l.taskId] ? "on" : ""}`} aria-label={`Selecionar a tarefa ${l.taskId}`} onClick={() => alternar([l.taskId], !sel[l.taskId])} />
        <div>
          <b>{novas.has(l.taskId) && <span className="tor-p amb" style={{ marginRight: 6 }}>nova</span>}{docTipoTxt(l)}</b>
          <div className="small">{l.pessoaNome ?? l.casalNomes ?? "—"} · {l.familiaNome ?? l.processoNome ?? "—"} · #{l.taskId}</div>
        </div>
        <div><span className={`tor-p ${bola.cls}`}>{bola.txt}</span>{l.esperandoHaDias != null && <div className="small">há {l.esperandoHaDias} d</div>}</div>
        <div className="small">{passoLabelDe(l).label}</div>
        <div><span className={`tor-p ${statusTarefaCls(l).replace("opv3-p-", "")}`}>{statusTarefaTxt(l)}</span></div>
        <div className={l.responsavelId ? "" : "small"}>{l.responsavelNome ?? "sem responsável"}</div>
        <div className="small">{l.rotuloDoPrazo || "—"}</div>
        <div className="small">{acompTxtCompleto(l.acompanhamentoPasso)}</div>
        <div><span className={`tor-p ${risco.cls}`}>{risco.txt}</span></div>
        <div className="flex flex-wrap gap-1">
          {iniciavel
            ? <button className="tor-btn pri" onClick={() => void iniciarRapido(l)}>Iniciar</button>
            : <button className="tor-btn pri" onClick={() => abrirLinha(l)}>{aIniciarEfetivo(l) ? "Abrir" : acao.label}</button>}
          {!aIniciarEfetivo(l) && <button className="tor-btn" onClick={() => abrirLinha(l)}>{concluirLabelDe(l)}</button>}
          {podeEditar && l.responsavelId == null && <button className="tor-btn" onClick={() => void atribuirRapido(l)}>Atribuir</button>}
          {l.estadoOperacao === "AGUARDANDO" && <button className="tor-btn" onClick={() => setCobrarLinha(l)}>Cobrar</button>}
          {temAcompanhamento(l) && <button className="tor-btn" onClick={() => adiar.abrir(l.taskId)}>Adiar</button>}
        </div>
      </div>
    )
  }

  const opcoesTransversal = (processos ?? []).length
    ? (processos ?? []).map((p) => ({ id: p.processoId, rotulo: `${p.familiaNome}${p.codigo ? ` · ${p.codigo}` : ""}` }))
    : [...new Map(linhas.filter((l) => l.processoId != null).map((l) => [l.processoId as number, { id: l.processoId as number, rotulo: l.familiaNome ?? l.processoNome ?? `Processo ${l.processoId}` }])).values()]

  return (
    <div>
      <div className="tor-bar">
        {visao !== "feito" && (
          <>
            <button className="tor-btn pri" onClick={iniciarFoco}>▶ Fazer agora ({visiveis.length})</button>
            <label className="flex items-center gap-1.5 small">Agrupar por
              <select className="tor-in" aria-label="Agrupar por" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
                <option value="fam">Família</option><option value="resp">Responsável</option><option value="org">Cartório</option><option value="fase">Fase</option><option value="none">Sem agrupamento</option>
              </select>
            </label>
            {agrupar === "fam" && (
              <label className="flex items-center gap-1.5 small">Dentro da família
                <select className="tor-in" aria-label="Dentro da família" value={dentro} onChange={(e) => setDentro(e.target.value as Dentro)}>
                  <option value="pessoa">Pessoa</option><option value="orgao">Órgão</option><option value="passo">Passo</option><option value="none">Nenhum</option>
                </select>
              </label>
            )}
          </>
        )}
        <VisoesSalvas
          fixas={VISOES.map(([v, l]) => { const c = contagem(v); return [v, c == null ? l : `${l} (${c})`] as [string, string] })}
          valor={visaoSel} atual={specAtual}
          onEscolherFixa={(v) => setVisaoSel(v)}
          onAplicar={(spec, id) => {
            setVisaoSel(id)
            setVisaoSalva((VISOES.some(([v]) => v === spec.visao) ? spec.visao : "todas") as VisaoTarefas)
            if (AGRUPAR_VALIDOS.includes(spec.agrupar as Agrupar)) setAgrupar(spec.agrupar as Agrupar)
            setDentro(((["none", "pessoa", "orgao", "passo"] as string[]).includes(spec.dentro ?? "") ? spec.dentro : "none") as Dentro)
            onAplicarSpec({ kpi: KPIS.some((k) => k.chave === spec.kpi && k.filtra) ? (spec.kpi as ChaveKpi) : null, pais: spec.pais ?? "", busca: spec.busca ?? "" })
          }}
        />
        {nNovas > 0 && <span className="tor-p amb">{nNovas} {nNovas === 1 ? "nova" : "novas"}</span>}
        <div style={{ flexGrow: 1 }} />
        <button className="tor-btn" onClick={() => setEscolhendoTransversal(true)}>+ Tarefa transversal</button>
        <CobrarTodosVencidos linhas={linhas} />
        {visao !== "feito" && selIds.length > 0 && (
          <div className="tor-sel" role="toolbar" aria-label="Ações em lote">
            <b>{selIds.length} sel.</b>
            {permissoes?.iniciar && <button className="tor-btn pri" disabled={ocupado} onClick={() => void iniciarSelecionadas()}>Iniciar (enviar ao cartório) as {selIds.length}</button>}
            {podeEditar && (
              <>
                <select className="tor-in" aria-label="Pessoa" value={pessoaId ?? ""} onChange={(e) => setPessoaId(Number(e.target.value))}>
                  {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.tarefasAtivas})</option>)}
                </select>
                <button className="tor-btn pri" disabled={ocupado || !pessoa} onClick={() => void lote("ATRIBUIR", { responsavelId: pessoaId })}>Atribuir a {pessoa?.nome ?? "…"}</button>
                <button className="tor-btn" disabled={ocupado} onClick={() => void lote("PRIORIDADE_ALTA")}>Prioridade alta</button>
                <button className="tor-btn" disabled={ocupado} onClick={() => setRepactuar(true)}>Repactuar prazo</button>
                <button className="tor-btn" disabled={ocupado || selSemOrgao.length === 0} title={selSemOrgao.length === 0 ? "Nenhuma das selecionadas precisa de órgão emissor" : undefined} onClick={() => setVincular(selSemOrgao)}>Vincular órgão nas {selSemOrgao.length}</button>
              </>
            )}
            <button className="tor-btn" disabled={ocupado} onClick={() => void lote("COBRAR")}>Cobrar cartório</button>
            <button className="tor-btn" onClick={() => setSel({})}>Limpar</button>
          </div>
        )}
      </div>

      {visao !== "feito" && semOrgao.length > 0 && (
        <div className="tor-card pad flex flex-wrap items-center gap-3 small">
          <span className="tor-p red">Bloqueio</span>
          <span><b>{semOrgao.length} certidões sem órgão emissor.</b> Não dá pra enviar sem destino — vincule antes de iniciar.</span>
          <div style={{ flexGrow: 1 }} />
          {podeEditar && <button className="tor-btn pri" onClick={() => setVincular(semOrgao.map((l) => l.taskId))}>Vincular órgão nas {semOrgao.length}</button>}
        </div>
      )}

      {visao === "feito" && (
        feito == null && !erroFeito ? <div className="tor-card pad small">Carregando concluídas…</div>
          : erroFeito ? <div className="tor-card pad">Não foi possível carregar as tarefas concluídas.</div>
            : <TorreFeito linhas={feitoVisiveis} onAbrir={(l) => abrirLinha(l)} />
      )}

      {visao !== "feito" && grupos.length === 0 && <div className="tor-card pad small">Nenhuma tarefa nesta visão.</div>}
      {visao !== "feito" && grupos.map(([nome, itens]) => {
        const todas = itens.every((l) => sel[l.taskId]); const alguma = itens.some((l) => sel[l.taskId])
        const subgrupos = agrupar === "fam" && dentro !== "none" ? agruparDentroDaFamilia(itens, dentro) : null
        return (
          <div key={nome} className="tor-card tor-scroll">
            <div className="tor-grp">
              <button className={`tor-chk ${todas ? "on" : alguma ? "mid" : ""}`} aria-label={`Selecionar o grupo ${nome}`} onClick={() => alternar(itens.map((l) => l.taskId), !todas)} />
              {agrupar === "fam" && itens[0]?.processoId != null
                ? <button className="tor-linkbtn" aria-label={`Abrir o foco da família ${nome}`} onClick={() => abrirFoco(itens[0].processoId as number)}>{nome}</button>
                : <b>{nome}</b>}<div style={{ flexGrow: 1 }} /><span className="tor-p gry">{itens.length} tarefas</span>
            </div>
            <div className="tor-hd tor-gT"><span /><span>Certidão · pessoa</span><span>Bola com</span><span>Etapa</span><span>Status</span><span>Responsável</span><span>Prazo</span><span>Acomp.</span><span>Risco</span><span /></div>
            {subgrupos
              ? subgrupos.map((g) => {
                const ls = g.linhas as LinhaTorre[]
                const todasG = ls.every((l) => sel[l.taskId]); const algumaG = ls.some((l) => sel[l.taskId])
                return (
                  <div key={g.chave}>
                    <div className="tor-grp" style={{ background: "var(--surface-secondary)", borderTop: "1px solid var(--border-default)" }}>
                      <button className={`tor-chk ${todasG ? "on" : algumaG ? "mid" : ""}`} aria-label={`Selecionar o subgrupo ${g.titulo}`} onClick={() => alternar(ls.map((l) => l.taskId), !todasG)} />
                      <span className={`tor-p ${g.pillCls === "opv3-p-red" ? "red" : "gry"}`}>{g.pill}</span><b>{g.titulo}</b>
                      <div style={{ flexGrow: 1 }} /><span className="tor-p gry">{ls.length} tarefas</span>
                    </div>
                    {ls.map(renderLinha)}
                  </div>
                )
              })
              : itens.map(renderLinha)}
          </div>
        )
      })}

      {repactuar && <RepactuarLoteModal n={selIds.length} onFechar={() => setRepactuar(false)} onEnviar={async (novoPrazo, justificativa) => {
        const r = await lote("REPACTUAR", { novoPrazo, justificativa })
        if (r.ok) setRepactuar(false)
        return r
      }} />}

      {cobrarLinha && (
        <RegistrarContatoModal
          titulo="Cobrar" subtitulo={`${cobrarLinha.terceiroNome ?? "Cartório"} · #${cobrarLinha.taskId}`}
          onFechar={() => setCobrarLinha(null)}
          onEnviar={async (dados) => {
            const r = await api<{ ok?: boolean; mensagem?: string; escalada?: boolean }>(`/api/operacao/tarefas/${cobrarLinha.taskId}/cobrar`, "POST", dados)
            if (!r.ok || !r.data.ok) return { ok: false, mensagem: r.data.mensagem ?? erroDe(r.data) }
            setCobrarLinha(null); avisar(`Contato registrado${r.data.escalada ? " · escalada ao gestor" : ""}.`); recarregar()
            return { ok: true }
          }}
        />
      )}

      {vincular && <VincularOrgaoLoteModal tarefaIds={vincular} onFechar={() => setVincular(null)} onFeito={() => setSel({})} />}
      {adiar.modal}

      {escolhendoTransversal && (
        <EscolherProcessoModal
          opcoes={opcoesTransversal} inicial={processoFoco ?? grupos[0]?.[1][0]?.processoId ?? null}
          onFechar={() => setEscolhendoTransversal(false)}
          onEscolher={(id) => { setEscolhendoTransversal(false); setTransversalProcessoId(id) }}
        />
      )}
      {transversalProcessoId != null && (
        <TarefaTransversalModal
          processoId={transversalProcessoId}
          onClose={() => setTransversalProcessoId(null)}
          onCreated={() => { setTransversalProcessoId(null); avisar("Tarefa transversal criada. Não muda a fase do processo."); recarregar() }}
        />
      )}

      {linhaAberta && (linhaAberta.documentoId != null ? (
        <DocumentoOperationalDrawer
          documentoId={linhaAberta.documentoId} isOpen onClose={fecharAberta} onSave={() => recarregar()}
          pilulaExtra="painel real do processo · espelhado"
          barraSuperiorExtra={painel}
          rodapeExtra={posFoco >= 0 ? (
            <div className="tor-bar" style={{ margin: 0, padding: "10px 18px", background: "var(--surface-secondary)", borderTop: "1px solid var(--border-default)" }}>
              <span className="small">Navegação do A fazer</span><div style={{ flexGrow: 1 }} />
              <button className="tor-btn" onClick={() => navFoco(-1)}>← Anterior</button>
              <button className="tor-btn" onClick={() => navFoco(1)}>Próxima →</button>
            </div>
          ) : undefined}
        />
      ) : (
        <div className="tor tor-gaveta" onClick={fecharAberta}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Painel da tarefa">
            <div className="p-4 flex items-center gap-2"><b className="flex-1">{linhaAberta.titulo}</b><button className="tor-btn" onClick={fecharAberta}>Fechar</button></div>
            {painel}
            <p className="small p-4">Esta tarefa não tem documento vinculado: o painel completo do processo não se aplica.</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function EscolherProcessoModal({ opcoes, inicial, onFechar, onEscolher }: {
  opcoes: Array<{ id: number; rotulo: string }>; inicial: number | null; onFechar: () => void; onEscolher: (processoId: number) => void
}) {
  const [id, setId] = useState<string>(String(inicial ?? opcoes[0]?.id ?? ""))
  return (
    <Modal titulo="Tarefa transversal" subtitulo="Escolha a família (processo) que receberá a tarefa. Ela não muda a fase do processo." onFechar={onFechar} rodape={<>
      <button className="tor-btn" onClick={onFechar}>Cancelar</button>
      <button className="tor-btn pri" disabled={!id} onClick={() => onEscolher(Number(id))}>Continuar</button>
    </>}>
      <Campo rotulo="Família / processo">
        <select className="tor-in w-full" value={id} onChange={(e) => setId(e.target.value)}>
          {opcoes.length === 0 && <option value="">Nenhum processo disponível</option>}
          {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
        </select>
      </Campo>
    </Modal>
  )
}

function RepactuarLoteModal({ n, onFechar, onEnviar }: { n: number; onFechar: () => void; onEnviar: (novoPrazoIso: string, justificativa: string) => Promise<{ ok: boolean; mensagem?: string }> }) {
  const [data, setData] = useState("")
  const [just, setJust] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const valido = data !== "" && just.trim().length >= 5
  const enviar = async () => {
    setEnviando(true); setErro(null)
    // Meio-dia UTC — nunca meia-noite, que vira o dia anterior no fuso operacional (mesma convenção do modal individual).
    const r = await onEnviar(`${data}T12:00:00.000Z`, just.trim())
    setEnviando(false)
    if (!r.ok) setErro(r.mensagem ?? "Não foi possível repactuar.")
  }
  return (
    <Modal titulo={`Repactuar prazo de ${n} tarefa(s)`} subtitulo="UMA justificativa para todas; cada tarefa grava a sua linha de auditoria." onFechar={onFechar} ocupado={enviando} rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando || !valido}>{enviando ? "Repactuando…" : "Repactuar prazo"}</button>
    </>}>
      <Campo rotulo="Novo prazo"><input type="date" className="tor-in w-full" value={data} onChange={(e) => setData(e.target.value)} /></Campo>
      <Campo rotulo="Justificativa única (obrigatória)"><textarea className="tor-in w-full" rows={3} value={just} onChange={(e) => setJust(e.target.value)} /></Campo>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
    </Modal>
  )
}
