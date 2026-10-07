"use client"
// src/components/torre/TorreTarefas.tsx — a aba TAREFAS da Torre nova (01/10/2026), igual ao protótipo `torre-de-controle.html › Tarefas`.
// Cada linha é uma tarefa: a certidão de uma pessoa em uma fase, ou uma tarefa avulsa. Estrutura (na ordem do protótipo): cabeçalho com
// "▶ Fazer agora (N)" e "+ Tarefa transversal" · VISÃO (8 visões com número) e SALVAS · painel de filtros · faixa Bloqueio · barra de lote ·
// tabela agrupada por família · Feito · gaveta (e Modo foco) · modais com justificativa · toast com Desfazer.
// A MESMA projeção da Operação (/api/torre/tarefas). Nenhuma regra nova: cada botão chama a porta que já existe (tarefa-comandos,
// tarefa-ciclo, cobranca-terceiros, iniciar-envio, vincular-orgao-lote, atribuir). Toda regra de tela mora em
// lib/operacional/torre-tarefas-tela.ts e torre-filtros.ts (puras, testadas). Nada de dado de exemplo.
import { SeletorResponsavel } from "@/src/components/operacao/kit-operacional"
import { ordenarLinhasDeCertidao } from "@/lib/operacional/ordem-certidoes"
import { motivoLegivel, porQuem } from "@/lib/operacional/motivos-legiveis"
import { PRIORIDADES_DO_LOTE, PRIORIDADE_NORMAL, prioridadeValida, textoDoLotePrioridade, type PrioridadeDoModelo } from "@/lib/operacional/torre-prioridade-lote"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DocumentoOperationalDrawer } from "@/src/components/kanban/DocumentoOperationalDrawer"
import { agruparDentroDaFamilia, aplicarBusca, aIniciarEfetivo, precisaDeOrgaoEmissor, acaoDe, docTipoTxt } from "@/src/components/operacao/operacao-v3-derivacoes"
import { urlArvoreDoProcesso } from "@/lib/operacional/navegacao"
import { api, erroDe, useTorre, type Desfazer } from "./torre-base"
import type { LinhaTorre } from "./tipos"
import type { ProcessoDaTorre } from "./tipos-processos"
import { VisoesSalvas, type SpecDaVisao } from "./VisoesSalvas"
import { TorreFeito } from "./TorreFeito"
import { TorreFiltros, type DentroDaFamilia, type PaisDoFiltro } from "./TorreFiltros"
import { TarefasTabela } from "./TarefasTabela"
import { TarefasGaveta } from "./TarefasGaveta"
import { TarefasTransversal } from "./TarefasTransversal"
import { PainelTorreTarefa } from "./PainelTorreTarefa"
import { VincularOrgaoLoteModal } from "./VincularOrgaoLoteModal"
import { ModalDaAcao, ModalRepactuarLote, pessoaDaLinha } from "./TarefasModais"
import { useNovasDaFamilia } from "./novas-da-familia"
import { ehCancelada, type AcaoComModal, type LinhaDaTela, type LinhaDoFeito } from "./tarefas-tipos"
import { linhasDoKpi, KPIS, type ChaveKpi } from "@/lib/operacional/torre-kpis"
import { aplicarFiltros, filtrosVazios, normalizarFiltros, type FiltrosTorre } from "@/lib/operacional/torre-filtros"
import {
  VISOES_DA_TELA, CHAVES_DE_VISAO_DA_TELA, predicadoDaVisao, contagemDaVisao, agruparParaTela, paginarGrupos, acoesDaLinha,
  type Agrupar, type AcaoDaLinha, type VisaoTarefas,
} from "@/lib/operacional/torre-tarefas-tela"
import { useConfirmarAtribuicao } from "./ConfirmarAtribuicao"
import "./tarefas.css"

export type { VisaoTarefas }
/** As chaves aceitas em `?visao=` (a Torre valida a URL com esta lista). */
export const CHAVES_DE_VISAO: string[] = CHAVES_DE_VISAO_DA_TELA
const AGRUPAR_VALIDOS: Agrupar[] = ["fam", "resp", "org", "fase", "none"]
const DENTRO_VALIDOS: DentroDaFamilia[] = ["pessoa", "orgao", "passo"]
export const LINHAS_POR_PAGINA = 50

interface Funcionario { id: number; nome: string; email?: string; tarefasAtivas: number }
interface RespLote { total?: number; sucesso?: number; falha?: number; itens?: Array<{ ok: boolean; mensagem?: string }>; desfazer?: Desfazer | null; error?: string }

/** Sufixo honesto de um lote em que algumas não passaram: "· 2 não passou(aram): <primeiro motivo>". */
const sufixoDasFalhas = (itens: Array<{ ok: boolean; mensagem?: string }> | undefined): string => {
  const falhas = (itens ?? []).filter((i) => !i.ok)
  return falhas.length ? ` · ${falhas.length} não passou(aram): ${falhas[0].mensagem ?? "recusada"}` : ""
}

export function TorreTarefas({ linhas, carregando, erro, kpi, busca, paisChave, paisRotulo, visaoPedida, tarefaPedida, onTarefaAtendida, processos, processoFoco, versao, onAplicarSpec, agora, filtros, onFiltros, onLimparPais, onLimparBusca, agruparPedido, dentroPedido, onEstadoUrl }: {
  linhas: LinhaTorre[]; carregando: boolean; erro: boolean
  /** Filtro do KPI clicado no cabeçalho (o MESMO predicado que dá o número do cartão). */
  kpi: ChaveKpi | null
  /** A busca do cabeçalho. */
  busca: string
  /** A nacionalidade escolhida (chave) — o DONO é o seletor do topo; o campo do painel lê e escreve o mesmo estado. */
  paisChave: string
  /** O rótulo da nacionalidade escolhida. */
  paisRotulo?: string | null
  /** `?visao=` da URL (já validada pelo casco). */
  visaoPedida?: string | null
  /** `?tarefa=` da URL: abre o trabalho daquela tarefa (abertas, senão concluídas recentes). */
  tarefaPedida?: number | null
  onTarefaAtendida?: () => void
  /** Todos os processos da Torre — o resumo do grupo e a família da tarefa transversal. */
  processos?: ProcessoDaTorre[]
  /** A família em foco (ou `?processo=`) — marca as "novas" e sugere a família da transversal. */
  processoFoco?: number | null
  /** Sobe a cada recarga da Torre — o "Feito" e as canceladas acompanham. */
  versao?: number
  /** Uma visão salva com KPI/país/busca próprios: o casco os adota. */
  onAplicarSpec: (s: { kpi: ChaveKpi | null; pais: string; busca: string }) => void
  /** O instante da leitura — o MESMO que o topo usa para contar a AGENDA (dia operacional). */
  agora: Date
  /** Os filtros do painel (estado do casco: vive na URL e na visão salva). */
  filtros: FiltrosTorre
  onFiltros: (f: FiltrosTorre) => void
  /** ✕ da nacionalidade / da busca (o seletor e a caixa do topo continuam sendo os donos). */
  onLimparPais: () => void
  onLimparBusca: () => void
  /** `?agrupar=` / `?dentro=` da URL (já validados pelo casco). */
  agruparPedido?: string | null
  dentroPedido?: string | null
  /** O que a aba escolheu e a URL deve guardar (só visões FIXAS — visão salva não é endereço). */
  onEstadoUrl?: (e: { visao: string | null; agrupar: string | null; dentro: string | null }) => void
}) {
  const router = useRouter()
  const { permissoes, avisar, recarregar } = useTorre()
  const [agrupar, setAgrupar] = useState<Agrupar>(AGRUPAR_VALIDOS.includes(agruparPedido as Agrupar) ? (agruparPedido as Agrupar) : "fam")
  const [dentro, setDentro] = useState<DentroDaFamilia>(DENTRO_VALIDOS.includes(dentroPedido as DentroDaFamilia) ? (dentroPedido as DentroDaFamilia) : "none")
  const [agruparVisto, setAgruparVisto] = useState<string | null>(agruparPedido ?? null)
  const [dentroVisto, setDentroVisto] = useState<string | null>(dentroPedido ?? null)
  const [visaoSel, setVisaoSel] = useState<string>(visaoPedida ?? "todas")
  const [visaoVista, setVisaoVista] = useState<string | null>(visaoPedida ?? null)
  const [visaoSalva, setVisaoSalva] = useState<VisaoTarefas>("todas")
  const [sel, setSel] = useState<Record<number, true>>({})
  const [pessoas, setPessoas] = useState<Funcionario[]>([])
  const [pessoaId, setPessoaId] = useState<number | null>(null)
  const [paises, setPaises] = useState<PaisDoFiltro[]>([])
  const [pagina, setPagina] = useState(0)
  const [chaveDaLista, setChaveDaLista] = useState("")
  const [modal, setModal] = useState<{ acao: AcaoComModal; linha: LinhaTorre } | null>(null)
  const [repactuarLote, setRepactuarLote] = useState(false)
  const [vincular, setVincular] = useState<{ ids: number[]; variante: "certidoes" | "lote" } | null>(null)
  const [transversal, setTransversal] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [gavetaId, setGavetaId] = useState<number | null>(null)
  const [focoIds, setFocoIds] = useState<number[] | null>(null)
  const [trabalho, setTrabalho] = useState<LinhaTorre | null>(null)
  const [feito, setFeito] = useState<LinhaDoFeito[] | null>(null)
  const [erroFeito, setErroFeito] = useState(false)
  const [canceladas, setCanceladas] = useState<LinhaDaTela[]>([])
  const novas = useNovasDaFamilia(processoFoco ?? null)

  // A URL pode mudar depois de montado: a visão nova entra no estado (ajuste durante a renderização, sem efeito).
  if ((visaoPedida ?? null) !== visaoVista) { setVisaoVista(visaoPedida ?? null); if (visaoPedida) setVisaoSel(visaoPedida) }
  if ((agruparPedido ?? null) !== agruparVisto) { setAgruparVisto(agruparPedido ?? null); setAgrupar(AGRUPAR_VALIDOS.includes(agruparPedido as Agrupar) ? (agruparPedido as Agrupar) : "fam") }
  if ((dentroPedido ?? null) !== dentroVisto) { setDentroVisto(dentroPedido ?? null); setDentro(DENTRO_VALIDOS.includes(dentroPedido as DentroDaFamilia) ? (dentroPedido as DentroDaFamilia) : "none") }

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
  useEffect(() => {
    let vivo = true
    void api<{ paises: PaisDoFiltro[] }>("/api/torre/paises").then((r) => { if (vivo && r.ok) setPaises(r.data.paises ?? []) })
    return () => { vivo = false }
  }, [])

  // FEITO: concluídas dos últimos 14 dias, de toda a equipe, e QUEM concluiu (a mesma leitura da aba Feito da Operação).
  useEffect(() => {
    let vivo = true
    void api<{ linhas: LinhaDoFeito[] }>(`/api/torre/tarefas/feito${paisChave ? `?pais=${encodeURIComponent(paisChave)}` : ""}`).then((r) => {
      if (!vivo) return
      if (r.ok) { setFeito(r.data.linhas ?? []); setErroFeito(false) } else setErroFeito(true)
    })
    return () => { vivo = false }
  }, [versao, paisChave])
  // CANCELADAS: só exibição (riscadas, no fim do grupo, com "Ver motivo") — nunca contador, seleção ou lote.
  useEffect(() => {
    let vivo = true
    void api<{ linhas: LinhaDaTela[] }>(`/api/torre/tarefas/canceladas${paisChave ? `?pais=${encodeURIComponent(paisChave)}` : ""}`).then((r) => { if (vivo && r.ok) setCanceladas(r.data.linhas ?? []) })
    return () => { vivo = false }
  }, [versao, paisChave])

  // A visão em vigor: uma das fixas, ou a `visao` guardada dentro da visão salva escolhida.
  const visao: VisaoTarefas = (CHAVES_DE_VISAO_DA_TELA.includes(visaoSel) ? visaoSel : visaoSalva) as VisaoTarefas
  const base = useMemo(() => (kpi ? linhasDoKpi(kpi, linhas, agora) : linhas), [linhas, kpi, agora])
  const ctxFiltro = useMemo(() => ({ usuarioId, agora }), [usuarioId, agora])
  // A lista BASE (indicador + visão + busca) e, sobre ela, os filtros do painel: UMA função (`aplicarFiltros`) dá a lista que a tabela
  // desenha, o "Mostrando N de M" e os números dentro do Prazo.
  const listaBase = useMemo(() => aplicarBusca(base.filter(predicadoDaVisao(visao, usuarioId, agora)), busca) as LinhaTorre[], [base, visao, usuarioId, busca, agora])
  const resumo = useMemo(() => aplicarFiltros(listaBase, filtros, ctxFiltro), [listaBase, filtros, ctxFiltro])
  const trabalhoVisivel = useMemo(() => {
    const l = resumo.linhas
    // As NOVAS (último aviso "chegou trabalho"): a FAMÍLIA com trabalho novo sobe ao topo — só quando a pessoa não escolheu uma ordenação. Nunca
    // reordena certidões DENTRO da família (a regra fixa de ordem manda).
    return novas.size && !filtros.ordenar ? ordenarLinhasDeCertidao(l, (a, b) => Number(novas.has(b.taskId)) - Number(novas.has(a.taskId))) : l
  }, [resumo, filtros.ordenar, novas])
  // As canceladas aparecem na visão "Todas as abertas" (sem indicador do topo), passando pela busca e pelos filtros do painel.
  const canceladasVisiveis = useMemo<LinhaDaTela[]>(() => {
    if (visao !== "todas" || kpi) return []
    return aplicarFiltros(aplicarBusca(canceladas, busca) as LinhaDaTela[], filtros, ctxFiltro).linhas
  }, [visao, kpi, canceladas, busca, filtros, ctxFiltro])
  const todasVisiveis = useMemo<LinhaDaTela[]>(() => [...trabalhoVisivel, ...canceladasVisiveis], [trabalhoVisivel, canceladasVisiveis])

  const grupos = useMemo(() => {
    const g = agruparParaTela(todasVisiveis, agrupar)
    return filtros.ordenar === "familia" && agrupar === "fam" ? [...g].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")) : g
  }, [todasVisiveis, agrupar, filtros.ordenar])
  const paginas = useMemo(() => paginarGrupos(grupos, LINHAS_POR_PAGINA), [grupos])
  // Voltar à 1ª página quando a lista muda de verdade (filtro, visão, busca, agrupamento…) — ajuste durante a renderização.
  const chave = JSON.stringify([visao, kpi, busca, filtros, agrupar, dentro])
  if (chave !== chaveDaLista) { setChaveDaLista(chave); setPagina(0) }
  const paginaEf = Math.min(pagina, Math.max(paginas.length - 1, 0))
  const gruposDaPagina = paginas[paginaEf] ?? []

  const processosPorId = useMemo(() => new Map((processos ?? []).map((p) => [p.processoId, p])), [processos])
  const semOrgao = useMemo(() => listaBase.filter(precisaDeOrgaoEmissor), [listaBase])
  const nVisao = (v: VisaoTarefas): number | null => (v === "feito" ? (feito ? feito.length : null) : contagemDaVisao(v, linhas, usuarioId, agora))
  const specAtual: SpecDaVisao = { visao, agrupar, dentro, kpi, pais: paisChave || null, busca: busca.trim() || null, filtros }
  // A URL guarda a visão FIXA escolhida e o agrupamento (visão salva não é endereço: o que ela traz entra nos próprios campos).
  const visaoFixaDaUrl = CHAVES_DE_VISAO_DA_TELA.includes(visaoSel) && visaoSel !== "todas" ? visaoSel : null
  useEffect(() => {
    onEstadoUrl?.({ visao: visaoFixaDaUrl, agrupar: agrupar !== "fam" ? agrupar : null, dentro: dentro !== "none" ? dentro : null })
  }, [visaoFixaDaUrl, agrupar, dentro, onEstadoUrl])

  const selIds = useMemo(() => Object.keys(sel).map(Number).filter((id) => linhas.some((l) => l.taskId === id)), [sel, linhas])
  const pessoa = pessoas.find((p) => p.id === pessoaId)
  const alternar = (ids: number[], ligar: boolean) => setSel((s) => {
    const n = { ...s }
    for (const id of ids) { if (ligar) n[id] = true; else delete n[id] }
    return n
  })

  // A ORDEM EM QUE AS LINHAS APARECEM (com o "Dentro da família" aplicado) — a lista do Modo foco, incluindo a cancelada.
  const ordemVisual = useMemo<LinhaDaTela[]>(() => grupos.flatMap(([, itens]) =>
    agrupar === "fam" && dentro !== "none" ? agruparDentroDaFamilia(itens, dentro).flatMap((g) => g.linhas as LinhaDaTela[]) : itens), [grupos, agrupar, dentro])
  const linhaPorId = useMemo(() => new Map<number, LinhaDaTela>([...canceladas, ...linhas].map((l) => [l.taskId, l])), [canceladas, linhas])

  // ?tarefa=<id>: abre o trabalho daquela tarefa — nas abertas; se não estiver, nas concluídas recentes; senão avisa.
  // A resolução acontece durante a renderização (sem efeito); o aviso e o "atendida" saem no efeito logo abaixo.
  const [tratada, setTratada] = useState<{ id: number; achou: boolean } | null>(null)
  if (tarefaPedida == null && tratada != null) setTratada(null)
  if (tarefaPedida != null && tratada?.id !== tarefaPedida && !carregando && !erro) {
    const l = linhas.find((x) => x.taskId === tarefaPedida)
    if (l) { setTratada({ id: tarefaPedida, achou: true }); abrirTrabalho(l) }
    else if (feito != null || erroFeito) {
      const f = feito?.find((x) => x.taskId === tarefaPedida)
      setTratada({ id: tarefaPedida, achou: !!f })
      if (f) { setVisaoSel("feito"); abrirTrabalho(f) }
    }
  }
  useEffect(() => {
    if (tarefaPedida == null || tratada?.id !== tarefaPedida) return
    if (!tratada.achou) avisar("Tarefa não encontrada entre as abertas ou concluídas recentes")
    onTarefaAtendida?.()
  }, [tarefaPedida, tratada, avisar, onTarefaAtendida])

  // ─── AÇÕES EM LOTE (a barra) ─────────────────────────────────────────────
  const [prioridadeEscolhida, setPrioridadeEscolhida] = useState<PrioridadeDoModelo>("ALTA")
  const { postar: postarComConfirmacao, modal: modalConfirmacao } = useConfirmarAtribuicao()
  const lote = async (acao: "ATRIBUIR" | "REMOVER_RESPONSAVEL" | "PRIORIDADE_ALTA" | "PRIORIDADE" | "REPACTUAR" | "COBRAR", extra: Record<string, unknown> = {}, opcoes: { limpar?: boolean; ddmm?: string } = {}) => {
    const { limpar = true, ddmm = "" } = opcoes
    setOcupado(true)
    // REMOVER RESPONSÁVEL passa pelo modal de confirmação (lista de quem sai de quê); as demais ações seguem direto.
    const r = acao === "REMOVER_RESPONSAVEL"
      ? await postarComConfirmacao<RespLote>("/api/torre/tarefas/lote", { acao, tarefaIds: selIds, ...extra })
      : await api<RespLote>("/api/torre/tarefas/lote", "POST", { acao, tarefaIds: selIds, ...extra })
    setOcupado(false)
    if (r.data && typeof r.data.total === "number") {
      const n = r.data.sucesso ?? 0
      const msg = acao === "ATRIBUIR" ? `${n} ${n === 1 ? "tarefa atribuída" : "tarefas atribuídas"} a ${pessoa?.nome ?? "a pessoa"}`
        : acao === "REMOVER_RESPONSAVEL" ? `Responsável removido de ${n} ${n === 1 ? "tarefa" : "tarefas"} — voltaram à fila de distribuição`
        : acao === "PRIORIDADE_ALTA" ? `Prioridade alta em ${n} ${n === 1 ? "tarefa" : "tarefas"}`
          : acao === "PRIORIDADE" ? textoDoLotePrioridade(prioridadeValida(extra.prioridade) ?? PRIORIDADE_NORMAL, n)
          : acao === "REPACTUAR" ? `${n} ${n === 1 ? "prazo repactuado" : "prazos repactuados"} para ${ddmm}`
            : `Cobrança registrada em ${n} ${n === 1 ? "tarefa" : "tarefas"}`
      avisar(`${msg}${sufixoDasFalhas(r.data.itens)}`, r.data.desfazer ?? null)
      if (limpar) setSel({})
      recarregar()
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
    if (r.ok && r.data.ok) {
      const n = r.data.iniciadas ?? 0
      avisar(`Iniciadas ${n} ${n === 1 ? "tarefa" : "tarefas"} · enviadas ao cartório${r.data.ignoradas?.length ? ` · ${r.data.ignoradas.length} ignorada(s): ${r.data.ignoradas[0]?.motivo}` : ""}`)
    } else avisar(r.data.mensagem ?? erroDe(r.data, "Não foi possível iniciar em lote."))
    setSel({}); recarregar()
  }

  // ─── AÇÕES DA LINHA ──────────────────────────────────────────────────────
  // ATRIBUIR abre a ESCOLHA do funcionário (a mesma lista da Operação): nunca atribui sozinho à sugestão (essa é a ação «Atribuir a <sugerido>» do painel da tarefa).
  const [escolhaLinha, setEscolhaLinha] = useState<LinhaTorre | null>(null)
  const [erroEscolha, setErroEscolha] = useState<string | null>(null)
  const [atribuindo, setAtribuindo] = useState(false)
  const atribuirRapido = (l: LinhaTorre) => { setErroEscolha(null); setEscolhaLinha(l) }
  const atribuirA = async (l: LinhaTorre, responsavelId: number) => {
    setAtribuindo(true); setErroEscolha(null)
    const r = await api<{ ok?: boolean; erro?: string }>(`/api/tarefas/${l.taskId}/comando`, "POST", { acao: l.responsavelId == null ? "atribuir" : "transferir", responsavelId })
    setAtribuindo(false)
    if (!r.ok) { setErroEscolha(erroDe(r.data)); return }
    setEscolhaLinha(null)
    avisar("Responsável atribuído · fica no histórico", { tipo: "ATRIBUICAO", tarefaIds: [l.taskId] } as Desfazer)
    recarregar()
  }
  const iniciarRapido = async (l: LinhaTorre) => {
    const r = await api<{ mensagem?: string }>(`/api/torre/tarefas/${l.taskId}/iniciar`, "POST", {})
    avisar(r.ok ? (r.data.mensagem ?? "Iniciada.") : erroDe(r.data))
    if (r.ok) recarregar()
  }
  // Genealogia sem documento não abre o drawer documental: "Continuar" leva à Árvore do processo (igual à Operação). Sem documento
  // (transversal, administrativa) o trabalho acontece na própria gaveta.
  function abrirTrabalho(l: LinhaTorre) {
    if (l.faseMacroKey === "genealogia" && l.documentoId == null && l.processoId != null) { router.push(urlArvoreDoProcesso(l.processoId)); return }
    if (l.documentoId == null) { setGavetaId(l.taskId); return }
    setGavetaId(null); setTrabalho(l)
  }
  const verMotivo = (l: LinhaDaTela) => {
    const e = l.encerramento
    avisar(`Cancelada${e?.quandoRotulo ? ` em ${e.quandoRotulo}` : ""} ${porQuem(e?.porNome)}${e?.motivo ? ` · ${motivoLegivel(e.motivo)}` : ""}`)
  }
  const executar = (acao: AcaoDaLinha, l: LinhaDaTela) => {
    switch (acao) {
      case "Atribuir": void atribuirRapido(l); break
      case "Iniciar": void iniciarRapido(l); break
      case "Cobrar": setModal({ acao: "cobrar", linha: l }); break
      case "Cobrar cliente": setModal({ acao: "cobrarCliente", linha: l }); break
      case "Adiar": setModal({ acao: "adiar", linha: l }); break
      case "Desbloquear": setModal({ acao: "desbloquear", linha: l }); break
      case "Ver motivo": verMotivo(l); break
      default: abrirTrabalho(l)
    }
  }

  // ▶ Fazer agora: a gaveta da 1ª tarefa da lista visível + Anterior/Próxima com "i de N". A cancelada entra na lista.
  const iniciarFoco = () => {
    if (!ordemVisual.length) return // lista vazia: nada abre
    setFocoIds(ordemVisual.map((l) => l.taskId)); setTrabalho(null); setGavetaId(ordemVisual[0].taskId)
  }
  const navFoco = (dir: 1 | -1) => {
    if (!focoIds || gavetaId == null) return
    const i = focoIds.indexOf(gavetaId)
    const prox = focoIds[Math.min(Math.max(i + dir, 0), focoIds.length - 1)]
    if (prox != null) setGavetaId(prox)
  }
  const fecharGaveta = () => { setGavetaId(null); setFocoIds(null) }

  if (erro) return <div className="tor-card pad">Não foi possível carregar as tarefas. Tente recarregar a página.</div>
  if (carregando) return <div className="tor-card pad small">Carregando tarefas…</div>

  const linhaGaveta = gavetaId != null ? linhaPorId.get(gavetaId) ?? null : null
  const posFoco = focoIds && gavetaId != null ? focoIds.indexOf(gavetaId) : -1
  const acoesDaGaveta = linhaGaveta
    ? acoesDaLinha({
      statusTarefa: linhaGaveta.statusTarefa, coluna: linhaGaveta.coluna, responsavelId: linhaGaveta.responsavelId, esperandoDe: linhaGaveta.esperandoDe,
      estadoOperacao: linhaGaveta.estadoOperacao, aIniciarEfetivo: aIniciarEfetivo(linhaGaveta), podeIniciar: linhaGaveta.podeIniciar && !!permissoes?.iniciar,
      temAcompanhamento: !!linhaGaveta.acompanhamentoPasso && !linhaGaveta.acompanhamentoPasso.semPrazo, acaoPadrao: acaoDe(linhaGaveta).label,
    })
    : []
  const nTrabalho = trabalhoVisivel.length
  const rodape = (
    <>
      {nTrabalho} {nTrabalho === 1 ? "tarefa" : "tarefas"}{paginas.length > 1 ? ` · página ${paginaEf + 1} de ${paginas.length}` : ""} · {LINHAS_POR_PAGINA} por página{agrupar === "fam" ? ", sempre agrupadas por processo" : ""}. A certidão cancelada ou não exigida fica escondida; o controle do grupo a mostra, riscada, na posição da regra de ordem. Clique no nome da certidão para abrir a gaveta.
      {paginas.length > 1 && (
        <span style={{ display: "inline-flex", gap: 6, marginLeft: 12 }}>
          <button type="button" className="tf-mini" disabled={paginaEf <= 0} onClick={() => setPagina(paginaEf - 1)}>← Anterior</button>
          <button type="button" className="tf-mini" disabled={paginaEf >= paginas.length - 1} onClick={() => setPagina(paginaEf + 1)}>Próxima →</button>
        </span>
      )}
    </>
  )

  return (
    <div className="tf">
      <div className="tf-head">
        <div className="tf-bread"><Link href="/torre">Torre de Controle</Link> › Tarefas</div>
        <div className="tf-titulo">
          <h2>Tarefas</h2>
          <div className="tf-sub">cada linha é uma tarefa: a certidão de uma pessoa em uma fase (emissão, tradução, apostila…) ou uma tarefa avulsa</div>
          {visao !== "feito" && <button type="button" className="tf-btn pri" onClick={iniciarFoco}>▶ Fazer agora ({nTrabalho})</button>}
          <button type="button" className="tf-btn" onClick={() => setTransversal(true)}>+ Tarefa transversal</button>
        </div>
      </div>

      <VisoesSalvas
        fixas={VISOES_DA_TELA.map(([v, l]) => [v, l, nVisao(v)] as [string, string, number | null])}
        valor={visaoSel} atual={specAtual}
        onEscolherFixa={(v) => { setVisaoSel(v); setSel({}) }}
        onAplicar={(spec, id) => {
          setVisaoSel(id); setSel({})
          setVisaoSalva((CHAVES_DE_VISAO_DA_TELA.includes(spec.visao ?? "") ? spec.visao : "todas") as VisaoTarefas)
          if (AGRUPAR_VALIDOS.includes(spec.agrupar as Agrupar)) setAgrupar(spec.agrupar as Agrupar)
          setDentro((DENTRO_VALIDOS.includes(spec.dentro as DentroDaFamilia) ? spec.dentro : "none") as DentroDaFamilia)
          onFiltros(normalizarFiltros(spec.filtros as unknown as Record<string, unknown> | undefined))
          onAplicarSpec({ kpi: KPIS.some((k) => k.chave === spec.kpi && k.filtra) ? (spec.kpi as ChaveKpi) : null, pais: spec.pais ?? "", busca: spec.busca ?? "" })
        }}
      />

      {visao !== "feito" && (
        <TorreFiltros
          linhasTodas={linhas} linhasBase={listaBase} filtros={filtros} onFiltros={onFiltros} ctx={ctxFiltro}
          mostrando={resumo.mostrando} total={listaBase.length} porPagina={LINHAS_POR_PAGINA}
          paisChave={paisChave} paises={paises} onPais={(pais) => onAplicarSpec({ kpi, pais, busca })}
          agrupar={agrupar} onAgrupar={setAgrupar} dentro={dentro} onDentro={setDentro}
          onLimparTudo={() => { onFiltros(filtrosVazios()); setAgrupar("fam"); setDentro("none"); onAplicarSpec({ kpi: null, pais: "", busca: "" }) }}
        />
      )}

      {visao !== "feito" && semOrgao.length > 0 && (
        <div className="tf-bloqueio">
          <span className="selo">Bloqueio</span>
          <span><b>{semOrgao.length} {semOrgao.length === 1 ? "certidão sem órgão emissor" : "certidões sem órgão emissor"}</b> {semOrgao.length === 1 ? "não pode ser pedida nem cobrada" : "não podem ser pedidas nem cobradas"} até você vincular o cartório.</span>
          {podeEditar && <button type="button" onClick={() => setVincular({ ids: semOrgao.map((l) => l.taskId), variante: "certidoes" })}>Vincular órgão nas {semOrgao.length}</button>}
        </div>
      )}

      {modalConfirmacao}
      {visao !== "feito" && selIds.length > 0 && (
        <div className="tf-lote" role="toolbar" aria-label="Ações em lote">
          <b>{selIds.length} selecionada(s)</b>
          {permissoes?.iniciar && <button type="button" disabled={ocupado} onClick={() => void iniciarSelecionadas()}>Iniciar (enviar ao cartório)</button>}
          {podeEditar && (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Atribuir a
                <select aria-label="Atribuir a" value={pessoaId ?? ""} onChange={(e) => setPessoaId(Number(e.target.value))}>
                  {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.tarefasAtivas} {p.tarefasAtivas === 1 ? "ativa" : "ativas"})</option>)}
                </select>
                <button type="button" disabled={ocupado || !pessoa} onClick={() => void lote("ATRIBUIR", { responsavelId: pessoaId })}>Atribuir</button>
              </span>
              <button type="button" disabled={ocupado} title="Devolve as selecionadas à fila de distribuição (fica no histórico)" onClick={() => void lote("REMOVER_RESPONSAVEL")}>Remover responsável</button>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Prioridade
                <select aria-label="Escolher prioridade" value={prioridadeEscolhida} onChange={(e) => setPrioridadeEscolhida(e.target.value as PrioridadeDoModelo)}>
                  {PRIORIDADES_DO_LOTE.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
                </select>
                <button type="button" disabled={ocupado} onClick={() => void lote("PRIORIDADE", { prioridade: prioridadeEscolhida })}>Aplicar</button>
                <button type="button" disabled={ocupado} title="Volta as selecionadas para a prioridade normal" onClick={() => void lote("PRIORIDADE", { prioridade: PRIORIDADE_NORMAL })}>Voltar ao normal</button>
              </span>
              <button type="button" disabled={ocupado} onClick={() => setRepactuarLote(true)}>Repactuar prazo</button>
              <button type="button" disabled={ocupado} onClick={() => setVincular({ ids: selIds, variante: "lote" })}>Vincular órgão</button>
            </>
          )}
          <button type="button" disabled={ocupado} onClick={() => void lote("COBRAR")}>Cobrar cartório</button>
          <button type="button" className="limpar" onClick={() => setSel({})}>Limpar</button>
        </div>
      )}

      {visao === "feito"
        ? (feito == null && !erroFeito ? <div className="tf-card"><span className="tf-vazio">Carregando concluídas…</span></div>
          : erroFeito ? <div className="tf-card"><span className="tf-vazio">Não foi possível carregar as tarefas concluídas.</span></div>
            : <TorreFeito linhas={(feito ?? []).filter((l) => !paisRotulo || l.pais === paisRotulo).filter((l) => aplicarBusca([l], busca).length > 0)} agora={agora} />)
        : (
          <TarefasTabela
            grupos={gruposDaPagina} agrupar={agrupar} dentro={dentro} sel={sel} novas={novas} processos={processosPorId} agora={agora}
            podeIniciar={!!permissoes?.iniciar} vazio={todasVisiveis.length === 0}
            onSelecionar={alternar} onTodas={alternar}
            onAbrirGaveta={(l) => { setFocoIds(null); setGavetaId(l.taskId) }}
            onAcao={executar} rodape={rodape}
          />
        )}

      {escolhaLinha && (
        <SeletorResponsavel
          titulo={escolhaLinha.responsavelId == null ? "Atribuir tarefa" : `Transferir de ${escolhaLinha.responsavelNome ?? "—"}`}
          atual={escolhaLinha.responsavelId} ocupado={atribuindo} erro={erroEscolha}
          aoFechar={() => { setEscolhaLinha(null); setErroEscolha(null) }}
          aoEscolher={(id) => void atribuirA(escolhaLinha, id)}
        />
      )}
      {modal && <ModalDaAcao acao={modal.acao} linha={modal.linha} agora={agora} onFechar={() => setModal(null)} />}

      {repactuarLote && (
        <ModalRepactuarLote n={selIds.length} onFechar={() => setRepactuarLote(false)} onEnviar={async (novoPrazo, justificativa, ddmm) => {
          const r = await lote("REPACTUAR", { novoPrazo, justificativa }, { limpar: false, ddmm })
          if (r.ok) setRepactuarLote(false)
          return r.ok ? { ok: true } : { ok: false, mensagem: r.mensagem }
        }} />
      )}

      {vincular && <VincularOrgaoLoteModal tarefaIds={vincular.ids} variante={vincular.variante} onFechar={() => setVincular(null)} onFeito={() => { if (vincular.variante === "certidoes") setSel({}) }} />}

      {transversal && (
        <TarefasTransversal
          opcoes={(processos ?? []).length
            ? (processos ?? []).map((p) => ({ id: p.processoId, rotulo: `${p.familiaNome}${p.codigo ? ` · ${p.codigo}` : ""}` }))
            : [...new Map(linhas.filter((l) => l.processoId != null).map((l) => [l.processoId as number, { id: l.processoId as number, rotulo: l.familiaNome ?? l.processoNome ?? `Processo ${l.processoId}` }])).values()]}
          inicial={processoFoco ?? null}
          onFechar={() => setTransversal(false)}
          onCriada={() => { setTransversal(false); avisar("Tarefa transversal criada"); recarregar() }}
        />
      )}

      {linhaGaveta && (
        <TarefasGaveta
          linha={linhaGaveta} agora={agora} acoes={acoesDaGaveta}
          foco={posFoco >= 0 && focoIds ? { pos: posFoco + 1, total: focoIds.length, onAnterior: () => navFoco(-1), onProxima: () => navFoco(1) } : null}
          onFechar={fecharGaveta}
          onAcaoPrimaria={(a) => {
            if (a === "Conferir" || a === "Continuar" || a === "Abrir") { abrirTrabalho(linhaGaveta); return }
            executar(a, linhaGaveta)
          }}
          onAcaoComModal={(a) => setModal({ acao: a, linha: linhaGaveta })}
        />
      )}

      {trabalho && trabalho.documentoId != null && (
        <DocumentoOperationalDrawer
          documentoId={trabalho.documentoId} isOpen onClose={() => setTrabalho(null)} onSave={() => recarregar()}
          pilulaExtra="painel real do processo · espelhado"
          barraSuperiorExtra={<PainelTorreTarefa linha={trabalho} agora={agora} />}
          rodapeExtra={focoIds ? (
            <div className="tor-bar" style={{ margin: 0, padding: "10px 18px", background: "var(--surface-secondary)", borderTop: "1px solid var(--border-default)" }}>
              <span className="small">{`Modo foco · ${posFoco >= 0 ? posFoco + 1 : "…"} de ${focoIds.length} · ${docTipoTxt(trabalho)} · ${pessoaDaLinha(trabalho)}`}</span><div style={{ flexGrow: 1 }} />
              <button className="tor-btn" onClick={() => { setGavetaId(trabalho.taskId); setTrabalho(null) }}>Voltar ao Modo foco</button>
            </div>
          ) : undefined}
        />
      )}
    </div>
  )
}
