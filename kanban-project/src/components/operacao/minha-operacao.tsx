// src/components/operacao/minha-operacao.tsx
// ============================================================================
// MINHA OPERAÇÃO — a central PESSOAL de atenção operacional.
//
// Mental model (mandato "Minha Operação", 15/09/2026):
//   NOTIFICAÇÕES         = o que aconteceu.
//   MINHA OPERAÇÃO       = o que exige minha atenção agora.
//   PROCESSO → WORKFLOW  = onde o trabalho é EXECUTADO.
//
// Esta tela é só PROJEÇÃO + PRIORIZAÇÃO + CONSULTA + NAVEGAÇÃO. Fonte única:
// `GET /api/operacao/tarefas?visao=minha_fila` (a MESMA `minhaFila()` que já
// alimentava a antiga Minha Fila) — nenhum motor novo, nenhuma Tarefa
// sintética, nenhum passo virando linha própria.
//
// UMA LINHA = UMA TAREFA CANÔNICA. "Aguardar cartório", "Acompanhar hoje",
// "Retorno recebido" NUNCA são Tarefas separadas — são a CONDIÇÃO atual da
// MESMA linha (mesma taskId, mesmo stepInstanceId), lida dos mesmos booleanos
// canônicos que já alimentavam `central-tarefas.tsx` (`emRisco`,
// `atrasoInterno`, `atrasoTerceiro`, `acompanhamentoVencido`,
// `retornoRecebido`, `coluna`) — nunca um novo estado inventado aqui.
//
// Identidade visual: 100% tokens/componentes de `visao-global.tsx`
// (Tarefas e Projetos) — `Etiqueta`/`Estado` do kit compartilhado, shadcn
// (`Input`/`Select`/`Popover`), mesmos tokens de superfície/borda/texto.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Search, Play, CalendarClock, AlertTriangle, Clock3, Hourglass, CheckCircle2,
  SlidersHorizontal, X as XIcon, ArrowUpRight, UserPlus, MoreVertical, ClipboardCheck,
  ChevronLeft, ChevronRight, ChevronDown, LayoutGrid, List, Maximize2, Minimize2, Bell, BarChart3,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "@/src/hooks/use-toast"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import {
  auth, dataCurta, Estado, Etiqueta, ROTULO_STATUS, ROTULO_PRIORIDADE, rotularFase, useRotulosDeFaseProntos,
  SeletorResponsavel, acaoPrincipal, type LinhaDeFila, type LinhaOperacional,
} from "./kit-operacional"
import {
  CATEGORIAS_ATENCAO, classificarAtencaoOperacional, motivosAtivos, ordenarPorAtencaoOperacional, rotuloDeAtencao,
  ROTULO_MOTIVO, type CategoriaAtencao,
} from "@/lib/operacional/atencao-operacional"
import { urlOperacionalDaTarefa, urlDistribuicaoDoProcesso } from "@/lib/operacional/navegacao"
import { MinhaOperacaoDetalhe } from "./minha-operacao-detalhe"

// `obrigacao-atribuicao.ts` importa o Prisma client em tempo de execução —
// não pode ser importado por um componente "use client". O literal aqui só
// precisa continuar igual ao `ORIGEM_OBRIGACAO_ATRIBUICAO` daquele arquivo.
const ORIGEM_OBRIGACAO_ATRIBUICAO = "obrigacao-atribuicao"

/**
 * O CARTÃO DA OBRIGAÇÃO ADMINISTRATIVA — "O QUE / ONDE / SITUAÇÃO / AÇÃO"
 * em vez de uma linha de tabela genérica. A natureza da tarefa (distribuir,
 * nunca executar uma certidão) muda a apresentação, nunca o fato de que é
 * trabalho real do usuário logado — por isso vive DENTRO de Minha Operação,
 * nunca numa tela separada.
 *
 * A CONTAGEM "N aguardando responsável" é lida agora (nunca guardada na
 * linha, de propósito — ver obrigacao-atribuicao.ts) pela MESMA leitura que
 * o chip "sem responsável" da Central usa.
 */
function CartaoObrigacaoAdministrativa({ l }: { l: LinhaOperacional }) {
  const router = useRouter()
  const [semResponsavel, setSemResponsavel] = useState<number | null>(null)

  useEffect(() => {
    if (l.processoId == null) return
    let vivo = true
    const p = new URLSearchParams({ processo: String(l.processoId), semResponsavel: "1", porPagina: "1" })
    p.append("tipoTarefa", "NORMAL")
    fetch(`/api/operacao/visao-global?${p.toString()}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { total: number }) => { if (vivo) setSemResponsavel(d.total) })
      .catch(() => { if (vivo) setSemResponsavel(null) })
    return () => { vivo = false }
  }, [l.processoId])

  const contexto = l.familiaNome ? `${l.familiaNome} · ${l.processoNome ?? "—"}` : l.processoNome ?? "—"
  const abrirDistribuicao = () => { if (l.processoId != null) router.push(urlDistribuicaoDoProcesso(l.processoId)) }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={abrirDistribuicao}
      onKeyDown={(e) => { if (e.key === "Enter") abrirDistribuicao() }}
      className="flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border border-[var(--info-tile)] bg-[var(--info-tile)]/25 px-4 py-3 transition-colors hover:bg-[var(--info-tile)]/40"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--info-tile)] text-[var(--info-text)]">
        <UserPlus className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">Atribuir tarefas</p>
        <p className="truncate text-[11.5px] text-[var(--text-secondary)]">{contexto}</p>
      </div>
      <p className="shrink-0 text-[12.5px] text-[var(--text-secondary)]">
        {semResponsavel == null ? "…" : `${semResponsavel} tarefa${semResponsavel === 1 ? "" : "s"} aguardando responsável`}
      </p>
      <span className="shrink-0 text-[11.5px] text-[var(--text-secondary)]">Responsável: {l.responsavelNome ?? "—"}</span>
      <button
        onClick={(e) => { e.stopPropagation(); abrirDistribuicao() }}
        className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--action-primary)] bg-[var(--action-primary)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90"
      >
        Distribuir tarefas <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const ICONE_CATEGORIA: Record<CategoriaAtencao, React.ComponentType<{ className?: string }>> = {
  paraAgirAgora: Play,
  acompanharHoje: CalendarClock,
  atrasoInterno: AlertTriangle,
  terceirosAtrasados: Clock3,
  aguardandoTerceiros: Hourglass,
}
/** O subtítulo curto do ladrilho — mandato "ultra fiel ao desenho", 24/09/2026. */
const SUBTITULO_CATEGORIA: Record<CategoriaAtencao, string> = {
  paraAgirAgora: "Suas tarefas de execução",
  acompanharHoje: "Aguardando terceiros",
  atrasoInterno: "Suas tarefas em atraso",
  terceirosAtrasados: "Aguardando retorno",
  aguardandoTerceiros: "Dentro do prazo",
}

function csvEscapar(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
/** "Mais ações" da família — exportar, real e local, sem round-trip novo. */
function exportarFamiliaCsv(nome: string, linhas: LinhaOperacional[]) {
  const cabecalho = ["Pessoa", "Documento/Tarefa", "Fase", "Etapa atual", "Prazo", "Prioridade", "Situação", "Terceiro"]
  const corpo = linhas.map((l) => [
    l.pessoaNome ?? "—", l.titulo, rotularFase(l.faseMacroKey) ?? "—", l.etapaAtual ?? "—",
    dataCurta(l.dataPrazo), ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade, textoDaSituacao(l), l.terceiroNome ?? "—",
  ].map((c) => csvEscapar(String(c))).join(","))
  const csv = [cabecalho.join(","), ...corpo].join("\n")
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${nome.toLowerCase().replace(/\s+/g, "-")}-tarefas.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** A cor da bolinha de prioridade — mesma régua semântica usada no resto da tela. */
const COR_PRIORIDADE: Record<string, string> = {
  URGENTE: "bg-[var(--danger)]",
  ALTA: "bg-[var(--danger)]",
  MEDIA: "bg-[var(--warning)]",
  BAIXA: "bg-[var(--success)]",
}
const ORDEM_PRIORIDADE: Record<string, number> = { URGENTE: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 }

/** Ordenação manual das LINHAS visíveis — nunca mexe no agrupamento por família, só na ordem dentro dele. */
function ordenarPorColuna(
  linhas: LinhaOperacional[],
  coluna: "prazo" | "prioridade" | "pessoa" | "fase" | null,
  asc: boolean,
): LinhaOperacional[] {
  if (!coluna) return linhas
  const cmp = (a: LinhaOperacional, b: LinhaOperacional): number => {
    if (coluna === "prazo") {
      const pa = a.dataPrazo ? Date.parse(a.dataPrazo) : Number.POSITIVE_INFINITY
      const pb = b.dataPrazo ? Date.parse(b.dataPrazo) : Number.POSITIVE_INFINITY
      return pa - pb
    }
    if (coluna === "prioridade") return (ORDEM_PRIORIDADE[a.prioridade] ?? 9) - (ORDEM_PRIORIDADE[b.prioridade] ?? 9)
    if (coluna === "pessoa") return (a.pessoaNome ?? "").localeCompare(b.pessoaNome ?? "", "pt-BR")
    return (rotularFase(a.faseMacroKey) ?? "").localeCompare(rotularFase(b.faseMacroKey) ?? "", "pt-BR")
  }
  return [...linhas].sort((a, b) => (asc ? cmp(a, b) : -cmp(a, b)))
}

/** O cabeçalho clicável — seta indica coluna ativa e sentido, nunca decorativa. */
function ThOrdenavel({ label, campo, ativo, asc, aoClicar, className = "" }: {
  label: string
  campo: string
  ativo: boolean
  asc: boolean
  aoClicar: () => void
  className?: string
}) {
  return (
    <th className={className}>
      <button onClick={aoClicar} className="flex items-center gap-1 hover:text-[var(--text-primary)]">
        {label}
        <span className={`text-[9px] transition-transform ${ativo ? "opacity-100" : "opacity-30"} ${ativo && !asc ? "rotate-180" : ""}`}>▲</span>
      </button>
    </th>
  )
}

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?"
}
/** Mesmos tokens semânticos de tile/tinta que `visao-global.tsx` (Etapa 5) já usa — nunca cor inventada. */
const TOM_CATEGORIA: Record<CategoriaAtencao, string> = {
  paraAgirAgora: "bg-[var(--info-tile)] text-[var(--info-text)]",
  acompanharHoje: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
  atrasoInterno: "bg-[var(--danger-tile)] text-[var(--danger-text)]",
  terceirosAtrasados: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
  aguardandoTerceiros: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
}

const TODOS = "todos"
const Z_POPOVER = "z-[10060]"
const POR_PAGINA_GRUPOS = 8
const POR_PAGINA_LINHAS = 50
const LINHAS_VISIVEIS_POR_FAMILIA = 5

interface GrupoOperacional {
  chave: string
  processoId: number | null
  rotuloPrincipal: string
  rotuloSecundario: string | null
  faseMacroKey: string | null
  linhas: LinhaOperacional[]
  pessoas: number
  paraFazer: number
  acompanhar: number
  atrasadas: number
  terceirosAtrasados: number
  /** Vem de um universo SEPARADO (`concluidas_hoje`) — `linhas` acima nunca inclui concluída (minhaFila exclui de propósito). */
  concluidas: number
  proximoPrazo: string | null
}

/**
 * A LINHA DENTRO DE UM GRUPO — mesma tabela de sempre, agora escopada a UMA
 * família/processo por vez. Extraída para não repetir a marcação ao renderizar
 * N grupos — a TAREFA continua sendo a mesma linha canônica, só o container
 * visual mudou (item 13 do mandato: agrupamento é projeção, não motor).
 */
function LinhaOperacaoTabela({
  l, selecionado, aoSelecionar, aoExecutar, ocupado, marcado, aoMarcar, mostrarSelecao,
  aoAguardarTerceiro, aoBloquear, aoDevolverAFila, aoContatarTerceiro,
}: {
  l: LinhaOperacional
  /**
   * CLICAR PARA OLHAR NUNCA ASSUME TRABALHO — o clique na LINHA só abre o
   * painel de detalhe (`aoSelecionar`), nunca comanda. Quem inicia clica no
   * botão da ação, explicitamente.
   */
  selecionado: boolean
  aoSelecionar: () => void
  /** A ação do botão: comanda (quando há o que comandar) e SÓ DEPOIS navega. */
  aoExecutar: () => void
  ocupado: boolean
  marcado: boolean
  aoMarcar: () => void
  /** `tarefas.editar` — sem ela, a coluna nem existe (nunca um checkbox morto). */
  mostrarSelecao: boolean
  /** Cada callback só existe quando a PERMISSÃO existe — o item nem aparece sem ela (nunca botão morto). */
  aoAguardarTerceiro?: () => void
  aoBloquear?: () => void
  aoDevolverAFila?: () => void
  aoContatarTerceiro?: () => void
}) {
  const atencaoLinha = rotuloDeAtencao(l)
  const acao = acaoPrincipal(l)
  return (
    <tr
      onClick={aoSelecionar}
      className={`cursor-pointer border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-secondary)] last:border-b-0 ${selecionado ? "bg-[var(--surface-secondary)]" : ""}`}
    >
      {mostrarSelecao && (
        <td className="w-8 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={marcado} onChange={aoMarcar} className="h-3.5 w-3.5 accent-[var(--action-primary)]" />
        </td>
      )}
      <td className="px-3 py-2.5">
        <Etiqueta tom={atencaoLinha.tom === "critico" ? "critico" : atencaoLinha.tom === "alerta" ? "alerta" : "neutro"}>{atencaoLinha.rotulo}</Etiqueta>
      </td>
      <td className="max-w-[160px] overflow-hidden px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--pessoa-tile)] text-[8.5px] font-semibold text-[var(--pessoa)]">
            {iniciaisDe(l.pessoaNome ?? l.processoNome ?? "?")}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">{l.pessoaNome ?? "—"}</div>
            <div className="truncate text-[10.5px] text-[var(--text-muted)]">{l.processoNome ?? "—"}</div>
          </div>
        </div>
      </td>
      <td className="max-w-[220px] overflow-hidden px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {l.emRisco && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--danger)]" title={l.motivosRisco.length ? l.motivosRisco.join(" · ") : "Em risco"} />
          )}
          <span className="block min-w-0 truncate text-[12.5px] font-medium text-[var(--text-primary)]">{l.titulo}</span>
        </div>
        {/* MOTIVOS CONCORRENTES — vários relógios podem tocar ao mesmo tempo
            pra MESMA tarefa (mandato "motor de atenção operacional",
            17/09/2026): nunca vira segunda linha, só um rodapé informativo. */}
        {motivosAtivos(l).length > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {motivosAtivos(l).map((m) => (
              <span key={m} className="rounded-full bg-[var(--warning-tile)] px-1.5 py-0.5 text-[9.5px] font-medium text-[var(--warning-text)]">
                {ROTULO_MOTIVO[m]}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-[11.5px] text-[var(--text-secondary)]">{rotularFase(l.faseMacroKey) ?? "—"}</td>
      <td className="max-w-[160px] px-3 py-2.5 text-[11.5px] text-[var(--text-secondary)]">
        <div className="truncate">{l.etapaAtual ?? "—"}</div>
        <div className="truncate text-[10px] text-[var(--text-muted)]">{textoDaProximaAcao(l)}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className={`text-[11.5px] ${l.atrasada ? "text-[var(--danger-text)]" : "text-[var(--text-secondary)]"}`}>{l.rotuloDoPrazo}</div>
        {l.dataPrazo && <div className="text-[10px] tabular-nums text-[var(--text-muted)]">{dataCurta(l.dataPrazo)}</div>}
      </td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${COR_PRIORIDADE[l.prioridade] ?? "bg-[var(--text-muted)]"}`} />
          {ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <Etiqueta tom={tomDaSituacao(l)}>{textoDaSituacao(l)}</Etiqueta>
      </td>
      <td className="max-w-[140px] overflow-hidden px-3 py-2.5 text-[11.5px] text-[var(--text-secondary)]">
        {l.terceiroNome ? <span className="block truncate text-[var(--info-text)]">{l.terceiroNome}</span> : "—"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button
            disabled={ocupado}
            onClick={(e) => { e.stopPropagation(); aoExecutar() }}
            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-[10.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            {ocupado && acao.comando === "iniciar" ? "Iniciando…" : acao.rotulo} <ArrowUpRight className="h-3 w-3" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
                aria-label="Mais ações"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className={Z_POPOVER}>
              <DropdownMenuItem onClick={aoSelecionar}>Ver detalhes</DropdownMenuItem>
              {aoContatarTerceiro && <DropdownMenuItem onClick={aoContatarTerceiro}>Contatar {l.terceiroNome}</DropdownMenuItem>}
              {aoAguardarTerceiro && l.coluna !== "AGUARDANDO_TERCEIRO" && <DropdownMenuItem onClick={aoAguardarTerceiro}>Aguardar terceiro</DropdownMenuItem>}
              {aoBloquear && l.coluna !== "BLOQUEADA" && <DropdownMenuItem onClick={aoBloquear}>Bloquear</DropdownMenuItem>}
              {aoDevolverAFila && l.responsavelId != null && <DropdownMenuItem onClick={aoDevolverAFila}>Devolver à fila</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  )
}

/** O mini-ladrilho de KPI por família — mesma linguagem visual dos ladrilhos do topo, em escala menor. */
function MiniLadrilho({ icone: Icone, valor, rotulo, tom }: {
  icone: React.ComponentType<{ className?: string }>
  valor: number
  rotulo: string
  tom: "neutro" | "info" | "warning" | "danger" | "success"
}) {
  const cor = {
    neutro: "text-[var(--text-secondary)]",
    info: "text-[var(--info-text)]",
    warning: "text-[var(--warning-text)]",
    danger: "text-[var(--danger-text)]",
    success: "text-[var(--success-text)]",
  }[tom]
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-page)] px-2 py-1">
      <Icone className={`h-3.5 w-3.5 shrink-0 ${cor}`} />
      <div className="leading-tight">
        <div className={`text-[13px] font-semibold tabular-nums ${cor}`}>{valor}</div>
        <div className="whitespace-nowrap text-[9px] text-[var(--text-muted)]">{rotulo}</div>
      </div>
    </div>
  )
}

/** O motivo é obrigatório no serviço (SEM_MOTIVO se vazio) — pedir aqui evita o roundtrip de erro. */
function ModalMotivo({ titulo, placeholder, ocupado, erro, aoFechar, aoConfirmar }: {
  titulo: string
  placeholder: string
  ocupado: boolean
  erro: string | null
  aoFechar: () => void
  aoConfirmar: (motivo: string) => void
}) {
  const [motivo, setMotivo] = useState("")
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={aoFechar}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-[13px] font-medium text-white/90">{titulo}</h2>
        </div>
        {erro && <div className="border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-2 text-[11px] text-red-700/90">{erro}</div>}
        <div className="p-4">
          <textarea
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
            rows={3}
            placeholder={placeholder}
            className="w-full resize-none rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-[var(--text-muted)]"
          />
          <div className="mt-0.5 text-right text-[10px] text-[var(--text-muted)]">{motivo.length}/300</div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.08] px-4 py-2.5">
          <button onClick={aoFechar} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-white/80">Cancelar</button>
          <button
            disabled={ocupado || !motivo.trim()}
            onClick={() => aoConfirmar(motivo.trim())}
            className="rounded bg-[var(--action-primary)] px-3 py-1.5 text-[11px] font-medium text-[var(--action-primary-ink)] disabled:opacity-40"
          >
            {ocupado ? "Enviando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  )
}

interface Acontecimento { id: number; tipo: string; titulo: string; mensagem: string; link: string | null; criadoEm: string }

/**
 * NOTIFICAÇÃO DENTRO DA ABA (C9) — o sino do topo é do app inteiro,
 * misturado com tudo. Aqui é só o que aconteceu NA operação de quem está
 * olhando, lido da MESMA porta canônica (`/api/notificacoes`) — nenhuma
 * tabela nova, nenhum estado paralelo ao sino.
 */
function PainelNotificacoes({ itens, aoFechar, aoMarcarLida, aoAbrirLink }: {
  itens: Acontecimento[] | null
  aoFechar: () => void
  aoMarcarLida: (id: number) => void
  aoAbrirLink: (link: string | null) => void
}) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-stretch justify-end bg-[var(--overlay-modal)]" onClick={aoFechar}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Notificações</h2>
          <button onClick={aoFechar} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {itens == null && <Estado tipo="carregando" mensagem="Carregando notificações…" />}
          {itens != null && itens.length === 0 && <Estado tipo="vazio" mensagem="Nada de novo desde a última vez que você entrou aqui." />}
          {itens?.map((n) => (
            <div key={n.id} className="border-b border-[var(--border-subtle)] px-4 py-2.5">
              <button
                onClick={() => { aoMarcarLida(n.id); aoAbrirLink(n.link) }}
                className="block w-full text-left"
              >
                <div className="text-[12.5px] font-medium text-[var(--text-primary)]">{n.titulo}</div>
                <div className="mt-0.5 text-[11.5px] text-[var(--text-secondary)]">{n.mensagem}</div>
                <div className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">{new Date(n.criadoEm).toLocaleString("pt-BR")}</div>
              </button>
              <button onClick={() => aoMarcarLida(n.id)} className="mt-1 text-[10.5px] text-[var(--action-primary)] hover:underline">
                Marcar como lida
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface RelatorioPessoal {
  dias: number
  porDia: { dia: string; total: number }[]
  totalNoPeriodo: number
  totalUltimos7Dias: number
  totalSemanaAnterior: number
  tendencia: number | null
  mediaPorDia: number
  tempoMedioCicloHoras: number | null
  ultimasConcluidas: { id: number; titulo: string; dataConclusao: string; processoId: number | null }[]
}

/**
 * RELATÓRIO PESSOAL (C6) — a primeira vez que Minha Operação olha pra trás.
 * Fonte única: `GET /api/operacao/relatorio-pessoal` (Tarefa.dataConclusao),
 * nenhum número inventado — se não há dado, o gráfico mostra 0, nunca oculta
 * o dia.
 */
function PainelRelatorio({ aoFechar, aoAbrirTarefa }: { aoFechar: () => void; aoAbrirTarefa: (taskId: number, processoId: number | null) => void }) {
  const [dado, setDado] = useState<RelatorioPessoal | null>(null)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => {
    let vivo = true
    fetch("/api/operacao/relatorio-pessoal?dias=14", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RelatorioPessoal) => { if (vivo) setDado(d) })
      .catch(() => { if (vivo) setFalhou(true) })
    return () => { vivo = false }
  }, [])

  const maiorDia = Math.max(1, ...(dado?.porDia.map((p) => p.total) ?? [1]))

  return (
    <div className="fixed inset-0 z-[10000] flex items-stretch justify-end bg-[var(--overlay-modal)]" onClick={aoFechar}>
      <div
        className="flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Meu relatório</h2>
          <button onClick={aoFechar} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar o relatório." />}
          {!falhou && dado == null && <Estado tipo="carregando" mensagem="Carregando relatório…" />}
          {dado && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-page)] px-3 py-2.5">
                  <div className="text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">{dado.totalUltimos7Dias}</div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">Últimos 7 dias</div>
                  {dado.tendencia != null && (
                    <div className={`mt-0.5 text-[10px] font-medium ${dado.tendencia >= 0 ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>
                      {dado.tendencia >= 0 ? "▲" : "▼"} {Math.abs(dado.tendencia)}% vs semana anterior
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-page)] px-3 py-2.5">
                  <div className="text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">{dado.mediaPorDia}</div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">Média por dia ({dado.dias}d)</div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-page)] px-3 py-2.5">
                  <div className="text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">
                    {dado.tempoMedioCicloHoras != null ? `${Math.round(dado.tempoMedioCicloHoras / 24)}d` : "—"}
                  </div>
                  <div className="text-[10.5px] text-[var(--text-muted)]">Tempo médio de ciclo</div>
                </div>
              </div>

              <div className="mt-4">
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Conclusões por dia</h3>
                <div className="mt-2 flex h-24 items-end gap-1">
                  {dado.porDia.map((p) => (
                    <div key={p.dia} className="flex flex-1 flex-col items-center gap-1" title={`${p.total} em ${dataCurta(p.dia)}`}>
                      <div
                        className={`w-full rounded-t ${p.total > 0 ? "bg-[var(--action-primary)]" : "bg-[var(--border-subtle)]"}`}
                        style={{ height: `${Math.max(2, (p.total / maiorDia) * 80)}px` }}
                      />
                      <span className="text-[8px] text-[var(--text-muted)]">{p.dia.slice(8, 10)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Últimas concluídas</h3>
                {dado.ultimasConcluidas.length === 0 && <p className="mt-2 text-[12px] text-[var(--text-muted)]">Nenhuma tarefa concluída no período.</p>}
                <div className="mt-2 divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)]">
                  {dado.ultimasConcluidas.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => aoAbrirTarefa(t.id, t.processoId)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-secondary)]"
                    >
                      <span className="min-w-0 truncate text-[12px] text-[var(--text-primary)]">{t.titulo}</span>
                      <span className="shrink-0 text-[10.5px] text-[var(--text-muted)]">{new Date(t.dataConclusao).toLocaleDateString("pt-BR")}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--text-secondary)]">{rotulo}</span>
      {children}
    </label>
  )
}

/** A situação em linguagem de gente — mandato §16: passo ≠ estado operacional. */
function textoDaSituacao(l: LinhaOperacional): string {
  if (l.requerDecisao) return "Requer decisão"
  if (l.coluna === "AGUARDANDO_TERCEIRO") {
    return l.esperandoDe === "cliente" ? "Aguardando o cliente" : `Aguardando ${l.terceiroNome ?? "terceiro"}`
  }
  if (l.coluna === "BLOQUEADA") return l.motivoBloqueio ? `Bloqueada — ${l.motivoBloqueio}` : "Bloqueada"
  if (l.coluna === "A_FAZER") return "Ação necessária"
  if (l.coluna === "CONCLUIDA") return "Concluída"
  return ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa
}
/** A cor do badge de situação — mesma régua semântica do resto da tela. */
function tomDaSituacao(l: LinhaOperacional): "neutro" | "alerta" | "critico" | "acento" | "sucesso" {
  if (l.requerDecisao) return "alerta"
  if (l.coluna === "AGUARDANDO_TERCEIRO") return "alerta"
  if (l.coluna === "BLOQUEADA") return "critico"
  if (l.coluna === "A_FAZER") return "acento"
  if (l.coluna === "CONCLUIDA") return "sucesso"
  return "neutro"
}

/** A próxima ação/acontecimento — mandato §15, a coluna mais importante da tela. */
function textoDaProximaAcao(l: LinhaOperacional): string {
  if (l.proximoAcontecimento?.descricao) return l.proximoAcontecimento.descricao
  if (l.requerDecisao) return "Decidir o que fazer com esta operação"
  if (l.coluna === "A_FAZER") return l.etapaAtual ? `Executar: ${l.etapaAtual}` : "Iniciar"
  if (l.coluna === "AGUARDANDO_TERCEIRO") return `Aguardar ${l.terceiroNome ?? "terceiro"}`
  return l.etapaAtual ?? "—"
}

interface Filtros {
  busca: string
  fase: string | null
  /** Client-side — vem do universo já carregado, sem round-trip novo. */
  etapa: string | null
  prioridade: string | null
  terceiro: string | null
  prazo: "todos" | "atrasadas" | "hoje" | "7dias"
}
const SEM_FILTRO: Filtros = { busca: "", fase: null, etapa: null, prioridade: null, terceiro: null, prazo: "todos" }

interface VisaoSalva { id: number; nome: string; spec: { filtros: Filtros; categoria: CategoriaAtencao | "todas" | "concluidas"; visaoModo: "familia" | "lista" } }

export function MinhaOperacao() {
  useRotulosDeFaseProntos()
  const router = useRouter()
  // ATRIBUIÇÃO EM LOTE é distribuição — mesma permissão que já guarda "Sem
  // responsável"/"Distribuir tarefas" em toda a operação (`tarefas.editar`,
  // `/api/operacao/atribuiveis`: "só quem distribui vê a lista de para-quem-
  // distribuir"). Sem este porteiro, quem não tem a permissão via checkbox e
  // botão que sempre falham ao tentar usar — botão morto (achado real,
  // teste com Daniela/assistente, 24/09/2026).
  const { pode: podePermissao } = usePermissoes()
  const podeAtribuirLote = podePermissao("tarefas.editar")
  // AÇÕES DO MENU "⋮" DA LINHA — cada uma com sua permissão própria (mesma
  // régua do backend, `PERMISSAO` em comando/route.ts): quem executa aguarda
  // terceiro/bloqueia a PRÓPRIA tarefa; devolver à fila é gestão.
  const podeIniciarConcluir = podePermissao("tarefas.iniciar_concluir")
  const podeBloquear = podePermissao("tarefas.bloquear")
  // DEEP-LINK — a notificação de "nova atribuição em lote" (Sino) e o
  // cartão da obrigação administrativa mandam pra cá com `?processo=<id>`,
  // lido só uma vez, no mount, pra abrir aquele contexto já expandido.
  const paramsIniciais = useSearchParams()
  const [processoAlvoId] = useState<number | null>(() => {
    const n = Number(paramsIniciais.get("processo"))
    return Number.isInteger(n) && n > 0 ? n : null
  })
  const [expandidos, setExpandidos] = useState<Set<string>>(() => (processoAlvoId != null ? new Set([String(processoAlvoId)]) : new Set()))
  const [resultado, setResultado] = useState<{ chave: string; lista: LinhaOperacional[] | null } | null>(null)
  const [recarga, setRecarga] = useState(0)
  // ABRE EM "PARA FAZER", NUNCA EM "TODAS" (mandato 17/09/2026, item 1): quem
  // tem 300 tarefas abertas não deve precisar procurar dentro das 300 pra
  // achar as 12 que exigem ação agora. "Todas" continua existindo — só não é
  // mais a porta de entrada.
  const [categoria, setCategoria] = useState<CategoriaAtencao | "todas" | "concluidas">("paraAgirAgora")
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO)
  const [maisFiltros, setMaisFiltros] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [visaoModo, setVisaoModo] = useState<"familia" | "lista">("familia")
  const [selecionadosLote, setSelecionadosLote] = useState<Set<number>>(new Set())
  const [loteAberto, setLoteAberto] = useState(false)
  const [loteOcupado, setLoteOcupado] = useState(false)
  const [loteErro, setLoteErro] = useState<string | null>(null)
  const [familiasVerTodas, setFamiliasVerTodas] = useState<Set<string>>(new Set())
  const [ordenarPor, setOrdenarPor] = useState<"prazo" | "nome" | "tarefas">("prazo")

  // ── MINHAS VISÕES (C2) — reaproveita RelatorioVisao, domínio
  // "minha-operacao" (mesma tabela genérica que Tarefas e Projetos e o motor
  // de Relatórios já usam). Salva filtros+categoria+visão, nunca resultado.
  const [minhasVisoes, setMinhasVisoes] = useState<VisaoSalva[] | null>(null)
  const [salvarVisaoAberto, setSalvarVisaoAberto] = useState(false)
  const [nomeVisao, setNomeVisao] = useState("")
  const [salvandoVisao, setSalvandoVisao] = useState(false)
  const carregarVisoes = useCallback(() => {
    fetch("/api/operacao/tarefas/visoes", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { visoes: VisaoSalva[] }) => setMinhasVisoes(d.visoes))
      .catch(() => setMinhasVisoes([]))
  }, [])
  useEffect(() => { carregarVisoes() }, [carregarVisoes])
  const salvarVisaoAtual = async () => {
    const nome = nomeVisao.trim()
    if (!nome) return
    setSalvandoVisao(true)
    try {
      const r = await fetch("/api/operacao/tarefas/visoes", {
        method: "POST", headers: auth(), body: JSON.stringify({ nome, filtros, categoria, visaoModo }),
      })
      if (r.ok) {
        setSalvarVisaoAberto(false); setNomeVisao(""); carregarVisoes()
        toast({ description: `Visão "${nome}" salva.`, variant: "success" })
      } else setErroComando("Não foi possível salvar a visão.")
    } catch {
      setErroComando("Não foi possível falar com o servidor.")
    } finally {
      setSalvandoVisao(false)
    }
  }
  const abrirVisaoSalva = (v: VisaoSalva) => {
    setFiltros(v.spec.filtros)
    setBuscaDigitada(v.spec.filtros.busca ?? "")
    setCategoria(v.spec.categoria)
    setVisaoModo(v.spec.visaoModo)
    setPagina(1)
  }
  const excluirVisaoSalva = async (id: number) => {
    await fetch(`/api/operacao/tarefas/visoes?id=${id}`, { method: "DELETE", headers: auth() }).catch(() => {})
    carregarVisoes()
  }
  // ── ORDENAÇÃO DA TABELA (C4/A4) — independente do ranking de atenção: quem
  // clica no cabeçalho quer control MANUAL sobre a ordem das linhas
  // visíveis, sem perder o agrupamento por família nem o ranking quando
  // nenhuma coluna está ativa (`sortColuna === null`).
  const [sortColuna, setSortColuna] = useState<"prazo" | "prioridade" | "pessoa" | "fase" | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const alternarSortColuna = (coluna: NonNullable<typeof sortColuna>) => {
    if (sortColuna === coluna) setSortAsc((v) => !v)
    else { setSortColuna(coluna); setSortAsc(true) }
  }
  // DATA/HORA DO CABEÇALHO — mesmo formato de `header-bar-app.tsx` (pt-BR,
  // dia da semana por extenso + hora), só que aqui dentro do CONTEÚDO
  // (mandato "ultra fiel ao desenho", 24/09/2026).
  const [dataAgora, setDataAgora] = useState("")
  const [horaAgora, setHoraAgora] = useState("")
  useEffect(() => {
    const atualizar = () => {
      const agora = new Date()
      setHoraAgora(agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))
      const data = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      setDataAgora(data.charAt(0).toUpperCase() + data.slice(1))
    }
    atualizar()
    const t = setInterval(atualizar, 30000)
    return () => clearInterval(t)
  }, [])

  // ── NOTIFICAÇÕES DENTRO DA ABA (C9) — mesma porta canônica do sino
  // (`/api/notificacoes`), sem tabela nova. Recarrega no mesmo ritmo do
  // polling silencioso, pra o número do sininho local nunca ficar velho.
  const [notifAberto, setNotifAberto] = useState(false)
  const [relatorioAberto, setRelatorioAberto] = useState(false)
  const [acontecimentos, setAcontecimentos] = useState<Acontecimento[] | null>(null)
  const carregarNotificacoes = useCallback(async () => {
    try {
      const r = await fetch("/api/notificacoes", { headers: auth() })
      if (!r.ok) return
      const d: { acontecimentos?: Acontecimento[] } = await r.json()
      setAcontecimentos(d.acontecimentos ?? [])
    } catch { /* poll silencioso */ }
  }, [])
  useEffect(() => {
    void carregarNotificacoes()
    const t = setInterval(() => { if (!document.hidden) void carregarNotificacoes() }, 20000)
    return () => clearInterval(t)
  }, [carregarNotificacoes])
  const marcarNotificacaoLida = useCallback(async (id: number) => {
    setAcontecimentos((prev) => (prev ? prev.filter((n) => n.id !== id) : prev))
    await fetch(`/api/notificacoes/${id}/lida`, { method: "POST", headers: auth() }).catch(() => {})
  }, [])

  // A BUSCA TEM DEBOUNCE — não dispara um request por tecla (mandato §21).
  const [buscaDigitada, setBuscaDigitada] = useState("")
  useEffect(() => {
    const t = setTimeout(() => { setFiltros((f) => ({ ...f, busca: buscaDigitada })); setPagina(1) }, 350)
    return () => clearTimeout(t)
  }, [buscaDigitada])

  // ── ATALHO "/" PARA A BUSCA (C5) — padrão de toda ferramenta densa
  // (Linear, Gmail, GitHub); nunca dispara dentro de um campo de texto já
  // focado, senão a pessoa digitando "usuário/senha" perderia o "/".
  const buscaRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      const dentroDeCampo = alvo?.tagName === "INPUT" || alvo?.tagName === "TEXTAREA" || alvo?.isContentEditable
      if (e.key === "/" && !dentroDeCampo) {
        e.preventDefault()
        buscaRef.current?.focus()
      }
    }
    window.addEventListener("keydown", aoTeclar)
    return () => window.removeEventListener("keydown", aoTeclar)
  }, [])

  // ── FILTROS SERVER-SIDE (mandato §20): fase/terceiro/prazo/busca viram
  // query string e entram no `where` do banco, ANTES da paginação — a MESMA
  // leitura de `visaoGerencial`/Tarefas e Projetos. A categoria de atenção
  // (KPI/chip) continua client-side: é estado COMPOSTO (`categoriasDaLinha`),
  // não uma coluna do banco — filtrar por ela sobre o universo já filtrado
  // pelo servidor é o mesmo padrão que os TILES de Tarefas e Projetos usam.
  const query = useMemo(() => {
    const p = new URLSearchParams({ visao: "minha_fila" })
    if (filtros.busca.trim()) p.set("busca", filtros.busca.trim())
    if (filtros.fase) p.set("fase", filtros.fase)
    if (filtros.terceiro) p.set("terceiro", filtros.terceiro)
    if (filtros.prazo !== "todos") p.set("prazo", filtros.prazo)
    return p.toString()
  }, [filtros])

  const chave = `${query}#${recarga}`
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?${query}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setResultado({ chave, lista: d.linhas ?? [] }) })
      .catch(() => { if (vivo) setResultado({ chave, lista: null }) })
    return () => { vivo = false }
  }, [chave, query])

  const carregando = resultado?.chave !== chave
  const linhas = carregando ? null : resultado?.lista ?? null
  const falhou = !carregando && linhas == null

  /**
   * RELEITURA IMEDIATA APÓS COMANDO — antes de `comandar` devolver, a tela
   * ainda mostrava o estado velho: quem clicava "Iniciar" via o cartão dizer
   * "A fazer" por um instante que podia durar até a próxima leitura natural.
   * Se a releitura demorasse, falhasse ou fosse descartada, a janela virava
   * permanente — "cliquei em Iniciar e nada aconteceu", com a tarefa já
   * iniciada no banco. `comandar` espera ESTA função antes de dar o ato por
   * encerrado.
   */
  const recarregarAgora = useCallback(async (): Promise<LinhaOperacional[] | null> => {
    try {
      const r = await fetch(`/api/operacao/tarefas?${query}`, { headers: auth() })
      if (!r.ok) return null
      const d: { linhas?: LinhaOperacional[] } = await r.json()
      const lista = d.linhas ?? []
      setResultado({ chave, lista })
      return lista
    } catch {
      return null
    }
  }, [query, chave])

  const [ocupado, setOcupado] = useState(false)
  const [erroComando, setErroComando] = useState<string | null>(null)

  /**
   * TODA MUDANÇA SAI POR UMA PORTA SÓ — inclusive o conflito: quando outro
   * responsável mexeu na tarefa antes, a porta responde 409 e a tela DIZ
   * isso e recarrega, em vez de deixar o clique parecer morto (achado real,
   * mandato "Minha Operação — Iniciar não pode virar só navegação",
   * 24/09/2026).
   */
  const comandar = useCallback(
    async (tarefaId: number, corpo: Record<string, unknown>, mensagemSucesso?: string): Promise<boolean> => {
      setOcupado(true)
      setErroComando(null)
      try {
        const r = await fetch(`/api/tarefas/${tarefaId}/comando`, {
          method: "POST",
          headers: auth(),
          body: JSON.stringify(corpo),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          // O CÓDIGO IMPORTA para quem lê. "Não foi possível" não diz se falta
          // permissão, se alguém chegou antes ou se o servidor caiu.
          const porStatus: Record<number, string> = {
            401: "Sua sessão expirou. Entre de novo.",
            403: "Você não tem permissão para esta ação.",
            409: "Esta tarefa foi alterada por outra pessoa. A lista foi atualizada.",
            422: d.error ?? "A ação não é válida para o estado atual desta tarefa.",
          }
          setErroComando(porStatus[r.status] ?? d.error ?? `Não foi possível concluir a ação (HTTP ${r.status}).`)
          await recarregarAgora()
          return false
        }
        // ESPERA a lista nova. Sem isto o ato "terminava" antes de a tela mudar.
        await recarregarAgora()
        setRecarga((n) => n + 1) // também atualiza KPIs e opções de filtro
        if (mensagemSucesso) toast({ description: mensagemSucesso, variant: "success" })
        return true
      } catch {
        // FALHA DE REDE NÃO É SILÊNCIO. O comando pode ter chegado ao servidor e
        // só a resposta ter se perdido — por isso relemos antes de acusar.
        const lista = await recarregarAgora()
        setErroComando(
          lista == null
            ? "Falha de rede. Verifique a conexão e tente novamente."
            : "A resposta do servidor não chegou. A lista foi atualizada — confira o estado da tarefa.",
        )
        return false
      } finally {
        setOcupado(false)
      }
    },
    [recarregarAgora],
  )

  // A NATUREZA da tarefa muda a APRESENTAÇÃO, nunca o fato de que é trabalho
  // real do usuário: a obrigação administrativa vira CARTÃO próprio (O QUE/
  // ONDE/SITUAÇÃO/AÇÃO), nunca uma linha genérica da tabela operacional —
  // por isso sai do pipeline de categoria/tabela/paginação abaixo, mas
  // continua vindo da MESMA `linhas` (mesma `/api/operacao/tarefas`).
  const linhasAdministrativas = useMemo(() => linhas?.filter((l) => l.origem === ORIGEM_OBRIGACAO_ATRIBUICAO) ?? [], [linhas])
  // `null` preservado (nunca `[]`) — o pipeline de categoria/tabela abaixo
  // distingue "ainda carregando" de "carregou e está vazio" por isto.
  const linhasNormais = useMemo(() => (linhas ? linhas.filter((l) => l.origem !== ORIGEM_OBRIGACAO_ATRIBUICAO) : null), [linhas])

  // ── OPÇÕES DOS FILTROS — de um universo ESTÁVEL (fetch próprio, sem
  // filtro), nunca do resultado já filtrado — senão escolher uma fase faria
  // as outras fases desaparecerem do próprio seletor de fase.
  const [universo, setUniverso] = useState<LinhaOperacional[] | null>(null)
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?visao=minha_fila`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setUniverso(d.linhas ?? []) })
      .catch(() => { if (vivo) setUniverso([]) })
    return () => { vivo = false }
  }, [recarga])
  const opcoesFase = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const l of universo ?? []) if (l.faseMacroKey) vistos.set(l.faseMacroKey, rotularFase(l.faseMacroKey) ?? l.faseMacroKey)
    return [...vistos.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [universo])
  const opcoesTerceiro = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of universo ?? []) if (l.terceiroNome) vistos.add(l.terceiroNome)
    return [...vistos].sort((a, b) => a.localeCompare(b))
  }, [universo])
  const opcoesEtapa = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of universo ?? []) if (l.etapaAtual) vistos.add(l.etapaAtual)
    return [...vistos].sort((a, b) => a.localeCompare(b))
  }, [universo])
  const opcoesPrioridade = useMemo(() => {
    const vistos = new Set<string>()
    for (const l of universo ?? []) vistos.add(l.prioridade)
    return [...vistos].sort((a, b) => (ROTULO_PRIORIDADE[a] ?? a).localeCompare(ROTULO_PRIORIDADE[b] ?? b))
  }, [universo])

  // KPI "Concluídas hoje" + badge por família — universo À PARTE (minhaFila
  // exclui concluída de propósito), sempre do usuário do token.
  const [concluidasHoje, setConcluidasHoje] = useState<LinhaOperacional[] | null>(null)
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?visao=concluidas_hoje`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setConcluidasHoje(d.linhas ?? []) })
      .catch(() => { if (vivo) setConcluidasHoje([]) })
    return () => { vivo = false }
  }, [recarga])
  const concluidasPorProcesso = useMemo(() => {
    const mapa = new Map<number, number>()
    for (const l of concluidasHoje ?? []) {
      if (l.processoId == null) continue
      mapa.set(l.processoId, (mapa.get(l.processoId) ?? 0) + 1)
    }
    return mapa
  }, [concluidasHoje])

  // ── TEMPO REAL (polling silencioso, mandato "premium", 24/09/2026) — a
  // tela se atualiza sozinha a cada 20s, sem piscar loading: atualiza
  // `resultado` pelo MESMO `recarregarAgora` que já existe pro comando (não
  // muda `chave`, então `carregando` nunca vira true), e `universo`/
  // `concluidasHoje` direto (esses dois nunca tiveram spinner próprio). Se um
  // colega assumir/concluir uma tarefa, o número muda sozinho na tela de
  // quem está só olhando — sem F5.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return // aba em segundo plano não gasta request à toa
      void recarregarAgora()
      fetch(`/api/operacao/tarefas?visao=minha_fila`, { headers: auth() })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { linhas?: LinhaOperacional[] }) => setUniverso(d.linhas ?? []))
        .catch(() => { /* poll silencioso — falha aqui não é erro pro usuário, só tenta de novo no próximo tick */ })
      fetch(`/api/operacao/tarefas?visao=concluidas_hoje`, { headers: auth() })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { linhas?: LinhaOperacional[] }) => setConcluidasHoje(d.linhas ?? []))
        .catch(() => { /* idem */ })
    }, 20000)
    return () => clearInterval(t)
  }, [recarregarAgora])

  // ── AS CONTAGENS DE FILA — MESMO UNIVERSO da tabela (mandato "fila real de
  // trabalho", 17/09/2026): sobre o resultado JÁ FILTRADO pelo servidor
  // (fase/terceiro/prazo/busca), nunca sobre o universo total. EXCLUSIVA —
  // `classificarAtencaoOperacional` devolve UMA fila por tarefa (nunca
  // "Para fazer" E "Aguardando terceiros" ao mesmo tempo), porque o
  // contador de cada fila PRECISA fechar com o que a própria fila lista.
  const porCategoria = useMemo(() => {
    const mapa = new Map<CategoriaAtencao, LinhaOperacional[]>(CATEGORIAS_ATENCAO.map((c) => [c.chave, []]))
    for (const l of linhasNormais ?? []) {
      const c = classificarAtencaoOperacional(l)
      if (c !== "outras") mapa.get(c)?.push(l)
    }
    return mapa
  }, [linhasNormais])

  const filtradas = useMemo(() => {
    // "Concluídas hoje" é universo SEPARADO (minhaFila exclui concluída de
    // propósito) — o ladrilho vira filtro de verdade, nunca número morto.
    if (categoria === "concluidas") return concluidasHoje ?? []
    if (!linhasNormais) return null
    let base = categoria === "todas" ? linhasNormais : linhasNormais.filter((l) => classificarAtencaoOperacional(l) === categoria)
    if (filtros.etapa) base = base.filter((l) => l.etapaAtual === filtros.etapa)
    if (filtros.prioridade) base = base.filter((l) => l.prioridade === filtros.prioridade)
    return base
  }, [linhasNormais, categoria, filtros.etapa, filtros.prioridade, concluidasHoje])

  const ordenadas = useMemo(() => (filtradas ? ordenarPorAtencaoOperacional(filtradas) : null), [filtradas])

  // ── AGRUPAMENTO POR FAMÍLIA/PROCESSO — item 11/13 do mandato 17/09/2026:
  // "não quero uma experiência interminável" quando o usuário tem várias
  // famílias com muitas tarefas cada. Projeção VISUAL sobre a MESMA lista já
  // filtrada/ordenada — as tarefas continuam individuais e canônicas; só a
  // apresentação principal passa a ser por contexto, com a família do
  // deep-link já expandida.
  const grupos = useMemo<GrupoOperacional[] | null>(() => {
    if (!ordenadas) return null
    const mapa = new Map<string, GrupoOperacional>()
    const pessoasPorGrupo = new Map<string, Set<number>>()
    for (const l of ordenadas) {
      const chave = l.processoId != null ? String(l.processoId) : "sem-processo"
      let g = mapa.get(chave)
      if (!g) {
        g = {
          chave,
          processoId: l.processoId,
          faseMacroKey: l.faseMacroKey,
          rotuloPrincipal: l.familiaNome ?? l.processoNome ?? "Sem processo vinculado",
          rotuloSecundario: l.familiaNome && l.processoNome ? l.processoNome : null,
          linhas: [], pessoas: 0, paraFazer: 0, acompanhar: 0, atrasadas: 0,
          terceirosAtrasados: 0, concluidas: 0, proximoPrazo: null,
        }
        mapa.set(chave, g)
        pessoasPorGrupo.set(chave, new Set())
      }
      g.linhas.push(l)
      if (l.pessoaId != null) pessoasPorGrupo.get(chave)!.add(l.pessoaId)
      const c = classificarAtencaoOperacional(l)
      if (c === "paraAgirAgora") g.paraFazer++
      else if (c === "acompanharHoje") g.acompanhar++
      else if (c === "terceirosAtrasados") g.terceirosAtrasados++
      if (l.atrasada) g.atrasadas++
      if (l.dataPrazo && (g.proximoPrazo == null || l.dataPrazo < g.proximoPrazo)) g.proximoPrazo = l.dataPrazo
    }
    for (const g of mapa.values()) {
      g.pessoas = pessoasPorGrupo.get(g.chave)?.size ?? 0
      g.concluidas = g.processoId != null ? concluidasPorProcesso.get(g.processoId) ?? 0 : 0
    }
    const lista = [...mapa.values()]
    if (ordenarPor === "nome") return lista.sort((a, b) => a.rotuloPrincipal.localeCompare(b.rotuloPrincipal, "pt-BR"))
    if (ordenarPor === "tarefas") return lista.sort((a, b) => b.linhas.length - a.linhas.length)
    // "prazo" (padrão) — o pior sinal primeiro, mesmo princípio do ranking de
    // atenção, agora agregado: quem tem atraso aparece antes de quem só tem
    // prazo distante.
    return lista.sort((a, b) => {
      if (a.atrasadas !== b.atrasadas) return b.atrasadas - a.atrasadas
      const pa = a.proximoPrazo ? Date.parse(a.proximoPrazo) : Number.POSITIVE_INFINITY
      const pb = b.proximoPrazo ? Date.parse(b.proximoPrazo) : Number.POSITIVE_INFINITY
      return pa - pb
    })
  }, [ordenadas, concluidasPorProcesso, ordenarPor])

  const alternarGrupo = (chave: string) => setExpandidos((prev) => {
    const novo = new Set(prev)
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave)
    return novo
  })

  const alternarSelecaoLote = (taskId: number) => setSelecionadosLote((prev) => {
    const novo = new Set(prev)
    if (novo.has(taskId)) novo.delete(taskId); else novo.add(taskId)
    return novo
  })
  const alternarTodosNaFamilia = (ids: number[], todasMarcadas: boolean) => setSelecionadosLote((prev) => {
    const novo = new Set(prev)
    if (todasMarcadas) ids.forEach((id) => novo.delete(id))
    else ids.forEach((id) => novo.add(id))
    return novo
  })

  // ── ATRIBUIÇÃO EM LOTE — mesma porta de sempre (`POST /api/tarefas/{id}/
  // comando`), chamada uma vez por tarefa selecionada (mandato "Seleção em
  // massa": lote chama a porta de UMA linha, nunca uma porta paralela).
  const linhasSelecionadasLote = useMemo(
    () => (ordenadas ?? []).filter((l) => selecionadosLote.has(l.taskId)),
    [ordenadas, selecionadosLote],
  )
  const atribuirLote = async (responsavelId: number) => {
    setLoteOcupado(true)
    setLoteErro(null)
    let falhas = 0
    for (const l of linhasSelecionadasLote) {
      try {
        const r = await fetch(`/api/tarefas/${l.taskId}/comando`, {
          method: "POST",
          headers: auth(),
          body: JSON.stringify({ acao: l.responsavelId == null ? "atribuir" : "transferir", responsavelId }),
        })
        if (!r.ok) falhas++
      } catch {
        falhas++
      }
    }
    setLoteOcupado(false)
    if (falhas > 0) {
      setLoteErro(`${falhas} tarefa${falhas === 1 ? "" : "s"} não pôde${falhas === 1 ? "" : "ram"} ser atribuída${falhas === 1 ? "" : "s"}.`)
      return
    }
    const total = linhasSelecionadasLote.length
    setLoteAberto(false)
    setSelecionadosLote(new Set())
    setRecarga((n) => n + 1)
    toast({ description: `${total} tarefa${total === 1 ? "" : "s"} atribuída${total === 1 ? "" : "s"}.`, variant: "success" })
  }

  const totalPaginas = Math.max(1, Math.ceil((grupos?.length ?? 0) / POR_PAGINA_GRUPOS))
  const paginaValida = Math.min(Math.max(pagina, 1), totalPaginas)
  const gruposVisiveis = grupos?.slice((paginaValida - 1) * POR_PAGINA_GRUPOS, paginaValida * POR_PAGINA_GRUPOS) ?? null

  // ── PAGINAÇÃO DA "VISÃO POR LISTA" (C3) — sem isto, 300 tarefas renderizam
  // de uma vez só. Mesmo state `pagina` da visão por família: só uma das
  // duas visões está montada por vez, então não colidem.
  const linhasListaOrdenadas = useMemo(() => ordenarPorColuna(ordenadas ?? [], sortColuna, sortAsc), [ordenadas, sortColuna, sortAsc])
  const totalPaginasLista = Math.max(1, Math.ceil(linhasListaOrdenadas.length / POR_PAGINA_LINHAS))
  const paginaListaValida = Math.min(Math.max(pagina, 1), totalPaginasLista)
  const linhasListaVisiveis = linhasListaOrdenadas.slice((paginaListaValida - 1) * POR_PAGINA_LINHAS, paginaListaValida * POR_PAGINA_LINHAS)

  // O rótulo da fila ATIVA no cabeçalho do grupo — "N tarefas · Aguardando
  // terceiros", nunca hardcoded "a fazer" pra QUALQUER fila (era o defeito
  // real da Grisotto: 3 tarefas aguardando cartório anunciadas como "3
  // tarefas a fazer" só porque o rótulo do cabeçalho nunca olhava a fila).
  const rotuloFilaAtiva = categoria === "todas" ? null : CATEGORIAS_ATENCAO.find((c) => c.chave === categoria)?.rotulo ?? null

  const temFiltro = filtros.busca.trim() !== "" || filtros.fase != null || filtros.etapa != null || filtros.prioridade != null || filtros.terceiro != null || filtros.prazo !== "todos" || categoria !== "paraAgirAgora"
  const limparFiltros = () => { setFiltros(SEM_FILTRO); setBuscaDigitada(""); setCategoria("paraAgirAgora"); setPagina(1) }

  /**
   * ONDE O TRABALHO ACONTECE — Minha Operação não executa. O deep-link
   * canônico leva ao processo, na Central, no documento e na etapa daquela
   * tarefa — a MESMA função que o Kanban, a visão global e as notificações
   * usam. Nunca uma rota própria.
   */
  const abrirOTrabalho = useCallback((l: LinhaOperacional) => {
    router.push(urlOperacionalDaTarefa({ taskId: l.taskId, processoId: l.processoId }))
  }, [router])

  /**
   * A AÇÃO PRINCIPAL DA LINHA — assumir e ir trabalhar, no mesmo gesto.
   *
   *   INICIAR    assume o trabalho e LEVA à etapa. Quem clica "Iniciar tarefa"
   *              está indo trabalhar agora; parar na fila obrigaria um
   *              segundo clique para chegar onde o trabalho acontece.
   *   CONTINUAR  só navega. Não reinicia nada, não escreve nada.
   *
   * A NAVEGAÇÃO SÓ ACONTECE DEPOIS DO SUCESSO CONFIRMADO — navegar junto com
   * o pedido (ou apesar dele) levaria a pessoa para a etapa acreditando que
   * assumiu um trabalho que continuou de ninguém (achado real: a versão
   * anterior desta tela só navegava, nunca comandava — "Iniciar" só existia
   * na Central, um clique a mais para todo mundo, sempre).
   */
  const irParaOTrabalho = useCallback(async (l: LinhaOperacional) => {
    const acao = acaoPrincipal(l)
    if (acao.comando === "iniciar") {
      const ok = await comandar(l.taskId, { acao: "iniciar" }, "Tarefa iniciada.")
      if (!ok) return
    }
    abrirOTrabalho(l)
  }, [comandar, abrirOTrabalho])

  // ── MENU "⋮" DA LINHA — aguardar terceiro/bloquear pedem motivo (exigido
  // pelo próprio serviço, `SEM_MOTIVO` se vazio); devolver à fila não pede.
  const [acaoComMotivo, setAcaoComMotivo] = useState<{ tarefaId: number; acao: "aguardar_terceiro" | "bloquear"; titulo: string } | null>(null)
  const devolverAFila = useCallback(async (l: LinhaOperacional) => {
    await comandar(l.taskId, { acao: "devolver_a_fila" }, "Tarefa devolvida para Sem responsável.")
  }, [comandar])

  /** Abre o canal de contato real do terceiro — nunca um número decorativo. */
  const contatarTerceiro = useCallback((l: LinhaOperacional) => {
    if (l.terceiroEmail) window.open(`mailto:${l.terceiroEmail}`, "_blank")
    else if (l.terceiroTelefone) window.open(`tel:${l.terceiroTelefone.replace(/\D/g, "")}`, "_blank")
  }, [])

  // Props do menu "⋮" — cada callback só existe com a PERMISSÃO correspondente
  // (mesma régua do backend); sem ela, o item de menu nem aparece.
  // Função pura de leitura por linha — barata (objeto pequeno), não precisa
  // de memoização própria (o `useCallback` aqui só confundia o React
  // Compiler sobre `setAcaoComMotivo`, um setState estável).
  const acoesDaLinha = (l: LinhaOperacional) => ({
    aoAguardarTerceiro: podeIniciarConcluir ? () => setAcaoComMotivo({ tarefaId: l.taskId, acao: "aguardar_terceiro", titulo: `Aguardar terceiro — ${l.titulo}` }) : undefined,
    aoBloquear: podeBloquear ? () => setAcaoComMotivo({ tarefaId: l.taskId, acao: "bloquear", titulo: `Bloquear — ${l.titulo}` }) : undefined,
    aoDevolverAFila: podeAtribuirLote ? () => void devolverAFila(l) : undefined,
    aoContatarTerceiro: (l.terceiroEmail || l.terceiroTelefone) ? () => contatarTerceiro(l) : undefined,
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-page)]">
      {/* ── CABEÇALHO ── */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-6 py-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--info-tile)] text-[var(--info-text)]">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">Minha Operação</h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Aqui está tudo o que precisa da sua atenção hoje.</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRelatorioAberto(true)}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            >
              <BarChart3 className="h-3.5 w-3.5" /> Meu relatório
            </button>
            <button
              onClick={() => setNotifAberto(true)}
              className="relative rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
              aria-label="Notificações da operação"
            >
              <Bell className="h-4 w-4" />
              {acontecimentos != null && acontecimentos.length > 0 && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[9px] font-semibold text-white">
                  {acontecimentos.length > 9 ? "9+" : acontecimentos.length}
                </span>
              )}
            </button>
            <div className="text-right">
              <div className="text-[11.5px] text-[var(--text-secondary)]">{dataAgora}</div>
              <div className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)]">{horaAgora}</div>
            </div>
          </div>
          <div className="relative w-full max-w-sm sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              ref={buscaRef}
              value={buscaDigitada}
              onChange={(e) => setBuscaDigitada(e.target.value)}
              placeholder="Buscar por pessoa, processo, documento, cartório… (/)"
              className="h-9 bg-[var(--surface-elevated)] pl-8 text-[13px]"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
        <div className="flex h-full min-h-0 gap-4">
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col gap-3 ${selecionado != null ? "hidden lg:flex" : ""}`}>
            {/* O QUE ACONTECEU AO COMANDAR — nunca falha silenciosa. Antes de
                existir, um 403/409/rede perdida no "Iniciar tarefa" não
                aparecia em lugar nenhum: a pessoa clicava, nada mudava, e o
                botão parecia morto. */}
            {erroComando && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-tile)] px-3.5 py-2.5 text-[12px] text-[var(--danger-text)]"
              >
                <span>{erroComando}</span>
                <button
                  onClick={() => setErroComando(null)}
                  className="shrink-0 text-[var(--danger-text)]/70 transition-colors hover:text-[var(--danger-text)]"
                  aria-label="Fechar aviso de erro"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* ── OBRIGAÇÕES ADMINISTRATIVAS — cartão próprio, sempre visível
                independente da categoria/filtro ativo na tabela abaixo (a
                tabela é só para tarefas NORMAL/TRANSVERSAL). "Se existe uma
                tarefa canônica ativa atribuída a mim que exige uma ação
                minha, eu preciso encontrá-la em Minha Operação." ── */}
            {linhasAdministrativas.length > 0 && (
              <div className="flex flex-col gap-2">
                {linhasAdministrativas.map((l) => <CartaoObrigacaoAdministrativa key={l.taskId} l={l} />)}
              </div>
            )}

            {/* ── LADRILHOS DE ATENÇÃO — 6 tiles (mandato "tela de Operação",
                24/09/2026): as 5 categorias já canônicas de
                `atencao-operacional.ts` + "Concluídas hoje" (universo
                separado, `minhaFila` exclui CONCLUIDA de propósito). Clicar
                num ladrilho filtra a tabela abaixo pela mesma categoria —
                "Concluídas hoje" é só informativo (não tem linha própria no
                pipeline de categoria). ── */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {CATEGORIAS_ATENCAO.map((c) => {
                const Icone = ICONE_CATEGORIA[c.chave]
                const n = porCategoria.get(c.chave)?.length ?? 0
                const ativo = categoria === c.chave
                return (
                  <button
                    key={c.chave}
                    title={c.tooltip}
                    onClick={() => { setCategoria(ativo ? "todas" : c.chave); setPagina(1) }}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      ativo
                        ? "border-[var(--action-primary)] bg-[var(--action-primary)] text-[var(--action-primary-ink)]"
                        : "border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-secondary)]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icone className={`h-3.5 w-3.5 ${ativo ? "text-[var(--action-primary-ink)]" : "text-[var(--text-muted)]"}`} />
                      <span className={`text-[20px] font-semibold tabular-nums ${ativo ? "text-[var(--action-primary-ink)]" : "text-[var(--text-primary)]"}`}>{n}</span>
                    </div>
                    <div className={`text-[11.5px] font-medium ${ativo ? "text-[var(--action-primary-ink)]" : "text-[var(--text-primary)]"}`}>{c.rotulo}</div>
                    <div className={`truncate text-[10px] ${ativo ? "text-[var(--action-primary-ink)]/80" : "text-[var(--text-muted)]"}`}>{SUBTITULO_CATEGORIA[c.chave]}</div>
                  </button>
                )
              })}
              <button
                onClick={() => { setCategoria(categoria === "concluidas" ? "todas" : "concluidas"); setPagina(1) }}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  categoria === "concluidas"
                    ? "border-[var(--action-primary)] bg-[var(--action-primary)] text-[var(--action-primary-ink)]"
                    : "border-[var(--border-subtle)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-secondary)]"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className={`h-3.5 w-3.5 ${categoria === "concluidas" ? "text-[var(--action-primary-ink)]" : "text-[var(--success-text)]"}`} />
                  <span className={`text-[20px] font-semibold tabular-nums ${categoria === "concluidas" ? "text-[var(--action-primary-ink)]" : "text-[var(--text-primary)]"}`}>{concluidasHoje?.length ?? 0}</span>
                </div>
                <div className={`text-[11.5px] font-medium ${categoria === "concluidas" ? "text-[var(--action-primary-ink)]" : "text-[var(--text-primary)]"}`}>Concluídas hoje</div>
                <div className={`truncate text-[10px] ${categoria === "concluidas" ? "text-[var(--action-primary-ink)]/80" : "text-[var(--text-muted)]"}`}>Tarefas finalizadas</div>
              </button>
            </div>

            {/* ── FILTROS — item 10, + Etapa atual/Prioridade (client-side) ── */}
            <div className="flex flex-wrap items-end gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5">
              <Campo rotulo="Fase">
                <Select value={filtros.fase ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, fase: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todas as fases</SelectItem>
                    {opcoesFase.map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Etapa atual">
                <Select value={filtros.etapa ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, etapa: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todas as etapas</SelectItem>
                    {opcoesEtapa.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Prioridade">
                <Select value={filtros.prioridade ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, prioridade: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-32 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todas</SelectItem>
                    {opcoesPrioridade.map((p) => <SelectItem key={p} value={p}>{ROTULO_PRIORIDADE[p] ?? p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Prazo">
                <Select value={filtros.prazo} onValueChange={(v) => { setFiltros((f) => ({ ...f, prazo: v as Filtros["prazo"] })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-36 bg-[var(--surface-elevated)] text-[12px]">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value="todos">Qualquer prazo</SelectItem>
                    <SelectItem value="atrasadas">Atrasadas</SelectItem>
                    <SelectItem value="hoje">Vencem hoje</SelectItem>
                    <SelectItem value="7dias">Vencem em 7 dias</SelectItem>
                  </SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Terceiro">
                <Select value={filtros.terceiro ?? TODOS} onValueChange={(v) => { setFiltros((f) => ({ ...f, terceiro: v === TODOS ? null : v })); setPagina(1) }}>
                  <SelectTrigger className="h-8 w-40 bg-[var(--surface-elevated)] text-[12px]"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent className={Z_POPOVER}>
                    <SelectItem value={TODOS}>Todos os terceiros</SelectItem>
                    {opcoesTerceiro.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Campo>
              <button
                onClick={() => setMaisFiltros((v) => !v)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Mais filtros
              </button>
              {temFiltro && (
                <button onClick={limparFiltros} className="flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]">
                  <XIcon className="h-3.5 w-3.5" /> Limpar filtros
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]">
                    Minhas Visões {minhasVisoes && minhasVisoes.length > 0 && <span className="tabular-nums text-[var(--text-muted)]">({minhasVisoes.length})</span>} <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className={Z_POPOVER}>
                  <DropdownMenuItem onClick={() => setSalvarVisaoAberto(true)}>Salvar visão atual…</DropdownMenuItem>
                  {minhasVisoes && minhasVisoes.length > 0 && (
                    <>
                      {minhasVisoes.map((v) => (
                        <div key={v.id} className="flex items-center justify-between gap-2 px-2 py-1">
                          <button onClick={() => abrirVisaoSalva(v)} className="min-w-0 flex-1 truncate text-left text-[13px] text-[var(--text-primary)] hover:underline">
                            {v.nome}
                          </button>
                          <button onClick={() => void excluirVisaoSalva(v.id)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger-text)]" aria-label={`Excluir visão ${v.nome}`}>
                            <XIcon className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] p-0.5">
                <button
                  onClick={() => { setVisaoModo("familia"); setPagina(1) }}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${visaoModo === "familia" ? "bg-[var(--action-primary)] text-[var(--action-primary-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"}`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" /> Visão por família
                </button>
                <button
                  onClick={() => { setVisaoModo("lista"); setPagina(1) }}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${visaoModo === "lista" ? "bg-[var(--action-primary)] text-[var(--action-primary-ink)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"}`}
                >
                  <List className="h-3.5 w-3.5" /> Visão por lista
                </button>
              </div>
            </div>

            {visaoModo === "familia" && grupos != null && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Famílias e processos ({grupos.length})</h2>
                <div className="flex items-center gap-2">
                  <Campo rotulo="Ordenar por:">
                    <Select value={ordenarPor} onValueChange={(v) => setOrdenarPor(v as typeof ordenarPor)}>
                      <SelectTrigger className="h-8 w-44 bg-[var(--surface-elevated)] text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent className={Z_POPOVER}>
                        <SelectItem value="prazo">Prazo (mais próximo)</SelectItem>
                        <SelectItem value="nome">Nome (A-Z)</SelectItem>
                        <SelectItem value="tarefas">Mais tarefas</SelectItem>
                      </SelectContent>
                    </Select>
                  </Campo>
                  <button
                    onClick={() => setExpandidos(new Set(grupos.map((g) => g.chave)))}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]"
                  >
                    <Maximize2 className="h-3.5 w-3.5" /> Expandir todas
                  </button>
                  <button
                    onClick={() => setExpandidos(new Set())}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]"
                  >
                    <Minimize2 className="h-3.5 w-3.5" /> Recolher todas
                  </button>
                </div>
              </div>
            )}

            {podeAtribuirLote && selecionadosLote.size > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-secondary)] px-3.5 py-2 shadow-[var(--elev-1)]">
                <span className="text-[12px] font-semibold text-[var(--text-primary)]">{selecionadosLote.size} selecionada{selecionadosLote.size === 1 ? "" : "s"}</span>
                <button
                  onClick={() => setLoteAberto(true)}
                  className="rounded-md bg-[var(--action-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90"
                >
                  Atribuir selecionadas
                </button>
                <button onClick={() => setSelecionadosLote(new Set())} className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  Limpar seleção
                </button>
              </div>
            )}

            {/* ── TABELA — item 13, "Visão por família" (padrão) ou "Visão por lista" (chata) ── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
              {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar sua operação." aoTentar={() => setRecarga((n) => n + 1)} />}
              {carregando && <Estado tipo="carregando" mensagem="Carregando sua operação…" />}
              {!carregando && !falhou && gruposVisiveis?.length === 0 && (
                <Estado
                  tipo="vazio"
                  mensagem={
                    temFiltro
                      ? "Nenhuma operação corresponde aos filtros selecionados."
                      : linhasAdministrativas.length > 0
                        ? "Nenhuma tarefa operacional pendente — veja a obrigação administrativa acima."
                        : "Nenhuma operação exige sua atenção agora."
                  }
                />
              )}

              {visaoModo === "lista" && !carregando && !falhou && ordenadas != null && ordenadas.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1 overflow-auto">
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
                        <tr className="border-b border-[var(--border-subtle)] [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
                          {podeAtribuirLote && <th className="w-8" />}
                          <th>Atenção</th>
                          <ThOrdenavel label="Pessoa" campo="pessoa" ativo={sortColuna === "pessoa"} asc={sortAsc} aoClicar={() => alternarSortColuna("pessoa")} />
                          <th>Documento / Tarefa</th>
                          <ThOrdenavel label="Fase" campo="fase" ativo={sortColuna === "fase"} asc={sortAsc} aoClicar={() => alternarSortColuna("fase")} />
                          <th>Etapa atual</th>
                          <ThOrdenavel label="Prazo" campo="prazo" ativo={sortColuna === "prazo"} asc={sortAsc} aoClicar={() => alternarSortColuna("prazo")} />
                          <ThOrdenavel label="Prioridade" campo="prioridade" ativo={sortColuna === "prioridade"} asc={sortAsc} aoClicar={() => alternarSortColuna("prioridade")} />
                          <th>Situação</th>
                          <th>Terceiro</th>
                          <th className="w-24">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhasListaVisiveis.map((l) => (
                          <LinhaOperacaoTabela
                            key={l.taskId}
                            l={l}
                            selecionado={selecionado === l.taskId}
                            aoSelecionar={() => setSelecionado(l.taskId)}
                            aoExecutar={() => void irParaOTrabalho(l)}
                            ocupado={ocupado}
                            marcado={selecionadosLote.has(l.taskId)}
                            aoMarcar={() => alternarSelecaoLote(l.taskId)}
                            mostrarSelecao={podeAtribuirLote}
                            {...acoesDaLinha(l)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPaginasLista > 1 && (
                    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
                      <span className="text-[11px] text-[var(--text-muted)]">
                        Mostrando {linhasListaVisiveis.length} de {ordenadas.length} tarefas
                      </span>
                      <div className="flex items-center gap-2">
                        <button disabled={paginaListaValida <= 1} onClick={() => setPagina(paginaListaValida - 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span className="text-[11px] tabular-nums text-[var(--text-primary)]">{paginaListaValida} / {totalPaginasLista}</span>
                        <button disabled={paginaListaValida >= totalPaginasLista} onClick={() => setPagina(paginaListaValida + 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {visaoModo === "familia" && gruposVisiveis != null && gruposVisiveis.length > 0 && (
                <div className="min-h-0 flex-1 overflow-auto divide-y divide-[var(--border-subtle)]">
                  {gruposVisiveis.map((g) => {
                    const aberto = expandidos.has(g.chave)
                    const verTodas = familiasVerTodas.has(g.chave)
                    const linhasOrdenadas = ordenarPorColuna(g.linhas, sortColuna, sortAsc)
                    const linhasVisiveis = verTodas ? linhasOrdenadas : linhasOrdenadas.slice(0, LINHAS_VISIVEIS_POR_FAMILIA)
                    const idsDaFamilia = g.linhas.map((l) => l.taskId)
                    const todasMarcadas = idsDaFamilia.length > 0 && idsDaFamilia.every((id) => selecionadosLote.has(id))
                    const selecionadasNaFamilia = idsDaFamilia.filter((id) => selecionadosLote.has(id)).length
                    return (
                      <div key={g.chave}>
                        <button
                          onClick={() => alternarGrupo(g.chave)}
                          className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-secondary)]"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="w-3 shrink-0 text-[10px] text-[var(--text-muted)]">{aberto ? "▾" : "▸"}</span>
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--pessoa-tile)] text-[11px] font-semibold text-[var(--pessoa)]">
                              {iniciaisDe(g.rotuloPrincipal)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{g.rotuloPrincipal}</span>
                                {g.processoId != null && <span className="shrink-0 text-[10.5px] text-[var(--text-muted)]">Processo #{g.processoId}</span>}
                                {g.faseMacroKey && <Etiqueta tom="neutro">{rotularFase(g.faseMacroKey)}</Etiqueta>}
                              </div>
                              <div className="truncate text-[10.5px] text-[var(--text-muted)]">
                                {g.pessoas} pessoa{g.pessoas === 1 ? "" : "s"} · {g.linhas.length} tarefa{g.linhas.length === 1 ? "" : "s"} no total
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <MiniLadrilho icone={Play} valor={g.paraFazer} rotulo="Para fazer" tom="info" />
                              <MiniLadrilho icone={CalendarClock} valor={g.acompanhar} rotulo="Acompanhar" tom="warning" />
                              <MiniLadrilho icone={AlertTriangle} valor={g.atrasadas} rotulo="Atrasadas" tom="danger" />
                              <MiniLadrilho icone={Clock3} valor={g.terceirosAtrasados} rotulo="Terceiros atrasados" tom="warning" />
                              <MiniLadrilho icone={CheckCircle2} valor={g.concluidas} rotulo="Concluídas" tom="success" />
                            </div>
                            {g.proximoPrazo && (
                              <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--text-secondary)]">Próximo prazo: {dataCurta(g.proximoPrazo)}</span>
                            )}
                          </div>
                        </button>
                        {aberto && (
                          <>
                            <table className="w-full border-collapse text-left">
                              <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
                                <tr className="border-b border-[var(--border-subtle)] [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
                                  {podeAtribuirLote && <th className="w-8" />}
                                  <th>Atenção</th>
                                  <ThOrdenavel label="Pessoa" campo="pessoa" ativo={sortColuna === "pessoa"} asc={sortAsc} aoClicar={() => alternarSortColuna("pessoa")} />
                                  <th>Documento / Tarefa</th>
                                  <ThOrdenavel label="Fase" campo="fase" ativo={sortColuna === "fase"} asc={sortAsc} aoClicar={() => alternarSortColuna("fase")} />
                                  <th>Etapa atual</th>
                                  <ThOrdenavel label="Prazo" campo="prazo" ativo={sortColuna === "prazo"} asc={sortAsc} aoClicar={() => alternarSortColuna("prazo")} />
                                  <ThOrdenavel label="Prioridade" campo="prioridade" ativo={sortColuna === "prioridade"} asc={sortAsc} aoClicar={() => alternarSortColuna("prioridade")} />
                                  <th>Situação</th>
                                  <th>Terceiro</th>
                                  <th className="w-24">Ações</th>
                                </tr>
                              </thead>
                              <tbody>
                                {linhasVisiveis.map((l) => (
                                  <LinhaOperacaoTabela
                                    key={l.taskId}
                                    l={l}
                                    selecionado={selecionado === l.taskId}
                                    aoSelecionar={() => setSelecionado(l.taskId)}
                                    aoExecutar={() => void irParaOTrabalho(l)}
                                    ocupado={ocupado}
                                    marcado={selecionadosLote.has(l.taskId)}
                                    aoMarcar={() => alternarSelecaoLote(l.taskId)}
                                    mostrarSelecao={podeAtribuirLote}
                                    {...acoesDaLinha(l)}
                                  />
                                ))}
                              </tbody>
                            </table>
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)]/40 px-4 py-2">
                              <div className="text-[11px] text-[var(--text-secondary)]">
                                {g.linhas.length > LINHAS_VISIVEIS_POR_FAMILIA ? (
                                  <>
                                    Mostrando {linhasVisiveis.length} de {g.linhas.length} tarefas ·{" "}
                                    <button
                                      onClick={() => setFamiliasVerTodas((prev) => {
                                        const novo = new Set(prev)
                                        if (verTodas) novo.delete(g.chave); else novo.add(g.chave)
                                        return novo
                                      })}
                                      className="font-medium text-[var(--action-primary)] hover:underline"
                                    >
                                      {verTodas ? "Mostrar menos" : `Ver todas as tarefas de ${g.rotuloPrincipal}`}
                                    </button>
                                  </>
                                ) : (
                                  <>{g.linhas.length} tarefa{g.linhas.length === 1 ? "" : "s"}</>
                                )}
                              </div>
                              {podeAtribuirLote && (
                                <div className="flex items-center gap-3">
                                  <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                                    <input
                                      type="checkbox"
                                      checked={todasMarcadas}
                                      onChange={() => alternarTodosNaFamilia(idsDaFamilia, todasMarcadas)}
                                      className="h-3.5 w-3.5 accent-[var(--action-primary)]"
                                    />
                                    Selecionar todas ({idsDaFamilia.length})
                                  </label>
                                  <button
                                    disabled={selecionadasNaFamilia === 0}
                                    onClick={() => setLoteAberto(true)}
                                    className="flex items-center gap-1.5 rounded-md bg-[var(--action-primary)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90 disabled:opacity-40"
                                  >
                                    <UserPlus className="h-3.5 w-3.5" /> Atribuir selecionadas
                                  </button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]">
                                        Mais ações <ChevronDown className="h-3.5 w-3.5" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className={Z_POPOVER}>
                                      <DropdownMenuItem onClick={() => exportarFamiliaCsv(g.rotuloPrincipal, g.linhas)}>Exportar CSV</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {visaoModo === "familia" && grupos != null && grupos.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Total de famílias: {grupos.length} | Total de tarefas: {ordenadas?.length ?? 0} | Exibindo: {gruposVisiveis?.length ?? 0} famílias
                  </span>
                  {totalPaginas > 1 && (
                    <div className="flex items-center gap-2">
                      <button disabled={paginaValida <= 1} onClick={() => setPagina(paginaValida - 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[11px] tabular-nums text-[var(--text-primary)]">{paginaValida} / {totalPaginas}</span>
                      <button disabled={paginaValida >= totalPaginas} onClick={() => setPagina(paginaValida + 1)} className="rounded border border-[var(--border-default)] p-1 text-[var(--text-secondary)] disabled:opacity-40">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── PAINEL DE DETALHE — item 21+ ── */}
          {selecionado != null && (
            <div className="flex w-full min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] lg:w-[420px]">
              <MinhaOperacaoDetalhe taskId={selecionado} aoFechar={() => setSelecionado(null)} />
            </div>
          )}
        </div>
      </div>

      {loteAberto && (
        <SeletorResponsavel
          titulo={`Atribuir ${linhasSelecionadasLote.length} tarefa${linhasSelecionadasLote.length === 1 ? "" : "s"}`}
          atual={null}
          ocupado={loteOcupado}
          erro={loteErro}
          aoFechar={() => { setLoteAberto(false); setLoteErro(null) }}
          aoEscolher={atribuirLote}
        />
      )}

      {acaoComMotivo && (
        <ModalMotivo
          titulo={acaoComMotivo.titulo}
          placeholder={acaoComMotivo.acao === "aguardar_terceiro" ? "Do que a tarefa está esperando?" : "Motivo do bloqueio"}
          ocupado={ocupado}
          erro={erroComando}
          aoFechar={() => { setAcaoComMotivo(null); setErroComando(null) }}
          aoConfirmar={async (motivo) => {
            const ok = await comandar(
              acaoComMotivo.tarefaId, { acao: acaoComMotivo.acao, motivo },
              acaoComMotivo.acao === "aguardar_terceiro" ? "Tarefa marcada como aguardando terceiro." : "Tarefa bloqueada.",
            )
            if (ok) setAcaoComMotivo(null)
          }}
        />
      )}

      {notifAberto && (
        <PainelNotificacoes
          itens={acontecimentos}
          aoFechar={() => setNotifAberto(false)}
          aoMarcarLida={(id) => void marcarNotificacaoLida(id)}
          aoAbrirLink={(link) => { if (link) router.push(link) }}
        />
      )}

      {relatorioAberto && (
        <PainelRelatorio
          aoFechar={() => setRelatorioAberto(false)}
          aoAbrirTarefa={(taskId, processoId) => router.push(urlOperacionalDaTarefa({ taskId, processoId }))}
        />
      )}

      {salvarVisaoAberto && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={() => setSalvarVisaoAberto(false)}>
          <div
            className="w-full max-w-sm overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--elev-3)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-white/[0.08] px-4 py-3">
              <h2 className="text-[13px] font-medium text-white/90">Salvar visão atual</h2>
            </div>
            <div className="p-4">
              <input
                autoFocus
                value={nomeVisao}
                onChange={(e) => setNomeVisao(e.target.value.slice(0, 80))}
                placeholder="Ex.: Prioridade alta, Cibils"
                onKeyDown={(e) => { if (e.key === "Enter") void salvarVisaoAtual() }}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-[var(--text-muted)]"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-white/[0.08] px-4 py-2.5">
              <button onClick={() => setSalvarVisaoAberto(false)} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-white/80">Cancelar</button>
              <button
                disabled={salvandoVisao || !nomeVisao.trim()}
                onClick={() => void salvarVisaoAtual()}
                className="rounded bg-[var(--action-primary)] px-3 py-1.5 text-[11px] font-medium text-[var(--action-primary-ink)] disabled:opacity-40"
              >
                {salvandoVisao ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
