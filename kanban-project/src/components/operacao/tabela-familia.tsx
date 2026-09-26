// src/components/operacao/tabela-familia.tsx
// ============================================================================
// A TABELA RICA DE UMA FAMÍLIA EXPANDIDA — extraída de `minha-operacao.tsx`
// (25/09/2026, fusão Central Operacional + Minha Operação numa tela só,
// `/operacao`) para ser a ÚNICA implementação da tabela por família, usada
// pela Central Operacional (agora a casca de `/operacao`) em vez de repetir
// esta lógica ou duplicá-la.
//
// `FamiliaTabelaExpandida` é AUTOSSUFICIENTE: busca suas próprias linhas
// (`/api/operacao/visao-global?familia=…`, a MESMA leitura gerencial de
// sempre — `visaoGerencial`/`whereGerencial`), comanda suas próprias ações
// (`POST /api/tarefas/{id}/comando`) e se releitura sozinha depois. Quem a
// usa só precisa saber QUAL família mostrar.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Play, CalendarClock, AlertTriangle, Clock3, CheckCircle2,
  ArrowUpRight, MoreVertical, ChevronDown, X as XIcon, UserPlus,
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "@/src/hooks/use-toast"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import {
  auth, dataCurta, Estado, ROTULO_STATUS, ROTULO_PRIORIDADE, rotularFase,
  acaoPrincipal, SeletorResponsavel, type LinhaOperacional,
} from "./kit-operacional"
import {
  classificarAtencaoOperacional, motivosAtivos, ROTULO_MOTIVO,
} from "@/lib/operacional/atencao-operacional"
import { urlOperacionalDaTarefa, urlDistribuicaoDoProcesso } from "@/lib/operacional/navegacao"

// `obrigacao-atribuicao.ts` importa o Prisma client em tempo de execução —
// não pode ser importado por um componente "use client". O literal aqui só
// precisa continuar igual ao `ORIGEM_OBRIGACAO_ATRIBUICAO` daquele arquivo.
export const ORIGEM_OBRIGACAO_ATRIBUICAO = "obrigacao-atribuicao"

/**
 * O CARTÃO DA OBRIGAÇÃO ADMINISTRATIVA — "O QUE / ONDE / SITUAÇÃO / AÇÃO"
 * em vez de uma linha de tabela genérica. A natureza da tarefa (distribuir,
 * nunca executar uma certidão) muda a apresentação, nunca o fato de que é
 * trabalho real do usuário logado.
 *
 * A CONTAGEM "N aguardando responsável" é lida agora (nunca guardada na
 * linha, de propósito) pela MESMA leitura que o chip "sem responsável" já usa.
 */
export function CartaoObrigacaoAdministrativa({ l }: { l: LinhaOperacional }) {
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

const Z_POPOVER = "z-[10060]"
const LINHAS_VISIVEIS_POR_FAMILIA = 5

function csvEscapar(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
/** "Mais ações" da família — exportar, real e local, sem round-trip novo. */
export function exportarFamiliaCsv(nome: string, linhas: LinhaOperacional[]) {
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

const COR_PRIORIDADE: Record<string, string> = {
  URGENTE: "bg-[var(--danger)]",
  ALTA: "bg-[var(--danger)]",
  MEDIA: "bg-[var(--warning)]",
  BAIXA: "bg-[var(--success)]",
}
const ORDEM_PRIORIDADE: Record<string, number> = { URGENTE: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 }
const ORDEM_CATEGORIA_DOC: Record<string, number> = { NASCIMENTO: 0, CASAMENTO: 1, OBITO: 2 }

/**
 * ORDEM PADRÃO (nenhuma coluna clicada) — pedido explícito do usuário
 * 25/09/2026: sempre agrupada por PESSOA, sequência nascimento → casamento →
 * óbito dentro da pessoa, e as pessoas na ordem da ÁRVORE (ancestral mais
 * antigo primeiro, descendo até o requerente) — a MESMA régua de "Nº
 * Linhagem" que a pasta documental/Central Operacional já usa
 * (`l.numeroLinhagem`, nunca uma conta de geração nova aqui).
 */
function agruparPorPessoaEGeracao(linhas: LinhaOperacional[]): LinhaOperacional[] {
  const grupos = new Map<string, LinhaOperacional[]>()
  for (const l of linhas) {
    const chave = l.pessoaId != null ? `p:${l.pessoaId}` : `n:${l.pessoaNome ?? "—"}`
    const g = grupos.get(chave)
    if (g) g.push(l); else grupos.set(chave, [l])
  }
  const ordemGrupo = (g: LinhaOperacional[]) => g[0]?.numeroLinhagem ?? Number.MAX_SAFE_INTEGER
  const gruposOrdenados = [...grupos.values()].sort((a, b) => {
    const d = ordemGrupo(a) - ordemGrupo(b)
    return d !== 0 ? d : (a[0]?.pessoaNome ?? "").localeCompare(b[0]?.pessoaNome ?? "", "pt-BR")
  })
  return gruposOrdenados.flatMap((g) =>
    [...g].sort((a, b) => {
      const d = (ORDEM_CATEGORIA_DOC[a.categoriaDoc ?? ""] ?? 9) - (ORDEM_CATEGORIA_DOC[b.categoriaDoc ?? ""] ?? 9)
      return d !== 0 ? d : (a.titulo ?? "").localeCompare(b.titulo ?? "", "pt-BR")
    }),
  )
}

type Coluna = "prazo" | "prioridade" | "pessoa" | "fase" | null

/** Ordenação manual das LINHAS visíveis — nunca mexe no agrupamento por família, só na ordem dentro dele. */
function ordenarPorColuna(linhas: LinhaOperacional[], coluna: Coluna, asc: boolean): LinhaOperacional[] {
  if (!coluna) return agruparPorPessoaEGeracao(linhas)
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
function ThOrdenavel({ label, ativo, asc, aoClicar, className = "" }: {
  label: string
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
/** A próxima ação/acontecimento — mandato §15, a coluna mais importante da tela. */
function textoDaProximaAcao(l: LinhaOperacional): string {
  if (l.proximoAcontecimento?.descricao) return l.proximoAcontecimento.descricao
  if (l.requerDecisao) return "Decidir o que fazer com esta operação"
  if (l.coluna === "A_FAZER") return l.etapaAtual ? `Executar: ${l.etapaAtual}` : "Iniciar"
  if (l.coluna === "AGUARDANDO_TERCEIRO") return `Aguardar ${l.terceiroNome ?? "terceiro"}`
  return l.etapaAtual ?? "—"
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

/**
 * A LINHA DENTRO DE UM GRUPO — mesma tabela de sempre, escopada a UMA
 * família/processo por vez. A TAREFA continua sendo a mesma linha canônica,
 * só o container visual muda (item 13 do mandato: agrupamento é projeção,
 * não motor).
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
          {/* `servico` é a MESMA obrigação sem o " · Nome" que `titulo` embute —
              a coluna Pessoa ao lado já mostra o nome; repeti-lo aqui era
              duplicação, não informação nova. */}
          <span className="block min-w-0 truncate text-[12.5px] font-medium text-[var(--text-primary)]">{l.servico ?? l.titulo}</span>
        </div>
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

/**
 * A TABELA DE UMA FAMÍLIA EXPANDIDA — autossuficiente: busca suas próprias
 * linhas (todas as fases da família juntas — achado 25/09/2026, a Central
 * Operacional tinha um nível intermediário "família → fase → lista" que só
 * atrapalhava; o usuário pediu família → tabela direto), comanda suas
 * próprias ações e se releitura sozinha.
 */
export function FamiliaTabelaExpandida({
  familiaId, processoId, nomeFamilia, escopo, filtrosQuery, concluidasHoje, selecionado, aoSelecionar,
}: {
  familiaId: number | null
  processoId: number | null
  nomeFamilia: string
  /**
   * `minha_fila` lê `/api/operacao/tarefas` (permissão `tarefas.ver`, escopo
   * automático ao usuário do token — segura pra qualquer um). `tudo`/
   * `sem_responsavel` leem `/api/operacao/visao-global`, que exige admin no
   * SERVIDOR — nunca chamar essa rota fora desses dois escopos, ela 403 pra
   * quem não é admin (achado real 25/09/2026).
   */
  escopo: "minha_fila" | "tudo" | "sem_responsavel"
  /**
   * fase/prioridade/busca/condições ATIVAS no painel de cima (`queryDeFiltros`
   * em central-operacional.tsx) — já como querystring pronta. Sem isto, a
   * tabela desta família ignorava os chips (achado real 25/09/2026: clicar
   * "Vence hoje" filtrava os ladrilhos do topo, a tabela continuava mostrando
   * tudo).
   */
  filtrosQuery: string
  /**
   * "Concluídas hoje" não pode vir das `linhas` desta família: `minhaFila`
   * exclui CONCLUIDA de propósito (mandato "fila real de trabalho"), então a
   * família nunca veria suas próprias conclusões de hoje se contasse sozinha.
   * O pai busca isso UMA VEZ (mesmo universo que `concluidas_hoje` sempre
   * usou) e repassa por família, mesmo padrão de antes da fusão.
   */
  concluidasHoje: number
  selecionado: number | null
  aoSelecionar: (taskId: number, processoId: number | null) => void
}) {
  const router = useRouter()
  const { pode: podePermissao } = usePermissoes()
  const podeAtribuirLote = podePermissao("tarefas.editar")
  const podeIniciarConcluir = podePermissao("tarefas.iniciar_concluir")
  const podeBloquear = podePermissao("tarefas.bloquear")

  const [resultado, setResultado] = useState<{ chave: string; linhas: LinhaOperacional[] | null }>({ chave: "", linhas: null })
  const [recarga, setRecarga] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [erroComando, setErroComando] = useState<string | null>(null)
  const [sortColuna, setSortColuna] = useState<Coluna>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [verTodas, setVerTodas] = useState(false)
  const [acaoComMotivo, setAcaoComMotivo] = useState<{ tarefaId: number; acao: "aguardar_terceiro" | "bloquear"; titulo: string } | null>(null)
  const [selecionadosLote, setSelecionadosLote] = useState<Set<number>>(new Set())
  const [loteAberto, setLoteAberto] = useState(false)
  const [loteOcupado, setLoteOcupado] = useState(false)
  const [loteErro, setLoteErro] = useState<string | null>(null)

  const endpoint = useMemo(() => {
    // Os filtros ativos entram PRIMEIRO — `familia`/`processo`/`visao`/
    // `incluirEncerradas`/`semResponsavel` abaixo nunca podem ser
    // sobrescritos por eles (não fazem parte do vocabulário de
    // `queryDeFiltros`, mas a ordem protege mesmo assim).
    const p = new URLSearchParams(filtrosQuery)
    p.set("porPagina", "500")
    if (familiaId != null) p.set("familia", String(familiaId))
    else if (processoId != null) p.set("processo", String(processoId))
    if (escopo === "minha_fila") {
      p.set("visao", "minha_fila")
      return `/api/operacao/tarefas?${p.toString()}`
    }
    p.set("incluirEncerradas", "1")
    if (escopo === "sem_responsavel") p.set("semResponsavel", "1")
    return `/api/operacao/visao-global?${p.toString()}`
  }, [familiaId, processoId, escopo, filtrosQuery])

  const chave = `${endpoint}#${recarga}`
  useEffect(() => {
    let vivo = true
    fetch(endpoint, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setResultado({ chave, linhas: d.linhas ?? [] }) })
      .catch(() => { if (vivo) setResultado({ chave, linhas: null }) })
    return () => { vivo = false }
  }, [chave, endpoint])

  const carregando = resultado.chave !== chave
  // A OBRIGAÇÃO ADMINISTRATIVA ("Atribuir tarefas") é um CARTÃO próprio, no
  // topo da tela (`CartaoObrigacaoAdministrativa`) — nunca uma linha genérica
  // aqui dentro, que não teria "Iniciar tarefa" nenhum sentido nela.
  const linhas = carregando
    ? null
    : (resultado.linhas?.filter((l) => l.origem !== ORIGEM_OBRIGACAO_ATRIBUICAO) ?? null)
  const falhou = !carregando && linhas == null

  const recarregarAgora = useCallback(async (): Promise<LinhaOperacional[] | null> => {
    try {
      const r = await fetch(endpoint, { headers: auth() })
      if (!r.ok) return null
      const d: { linhas?: LinhaOperacional[] } = await r.json()
      const lista = d.linhas ?? []
      setResultado({ chave, linhas: lista })
      return lista
    } catch {
      return null
    }
  }, [endpoint, chave])

  /**
   * TODA MUDANÇA SAI POR UMA PORTA SÓ — inclusive o conflito: quando outro
   * responsável mexeu na tarefa antes, a porta responde 409 e a tela DIZ
   * isso e recarrega, em vez de deixar o clique parecer morto.
   */
  const comandar = useCallback(async (tarefaId: number, corpo: Record<string, unknown>, mensagemSucesso?: string): Promise<boolean> => {
    setOcupado(true)
    setErroComando(null)
    try {
      const r = await fetch(`/api/tarefas/${tarefaId}/comando`, { method: "POST", headers: auth(), body: JSON.stringify(corpo) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
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
      await recarregarAgora()
      setRecarga((n) => n + 1)
      if (mensagemSucesso) toast({ description: mensagemSucesso, variant: "success" })
      return true
    } catch {
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
  }, [recarregarAgora])

  const abrirOTrabalho = useCallback((l: LinhaOperacional) => {
    router.push(urlOperacionalDaTarefa({ taskId: l.taskId, processoId: l.processoId }))
  }, [router])
  const irParaOTrabalho = useCallback(async (l: LinhaOperacional) => {
    const acao = acaoPrincipal(l)
    if (acao.comando === "iniciar") {
      const ok = await comandar(l.taskId, { acao: "iniciar" }, "Tarefa iniciada.")
      if (!ok) return
    }
    abrirOTrabalho(l)
  }, [comandar, abrirOTrabalho])
  const devolverAFila = useCallback(async (l: LinhaOperacional) => {
    await comandar(l.taskId, { acao: "devolver_a_fila" }, "Tarefa devolvida para Sem responsável.")
  }, [comandar])
  /** Abre o canal de contato real do terceiro — nunca um número decorativo. */
  const contatarTerceiro = useCallback((l: LinhaOperacional) => {
    if (l.terceiroEmail) window.open(`mailto:${l.terceiroEmail}`, "_blank")
    else if (l.terceiroTelefone) window.open(`tel:${l.terceiroTelefone.replace(/\D/g, "")}`, "_blank")
  }, [])

  const acoesDaLinha = (l: LinhaOperacional) => ({
    aoAguardarTerceiro: podeIniciarConcluir ? () => setAcaoComMotivo({ tarefaId: l.taskId, acao: "aguardar_terceiro", titulo: `Aguardar terceiro — ${l.titulo}` }) : undefined,
    aoBloquear: podeBloquear ? () => setAcaoComMotivo({ tarefaId: l.taskId, acao: "bloquear", titulo: `Bloquear — ${l.titulo}` }) : undefined,
    aoDevolverAFila: podeAtribuirLote ? () => void devolverAFila(l) : undefined,
    aoContatarTerceiro: (l.terceiroEmail || l.terceiroTelefone) ? () => contatarTerceiro(l) : undefined,
  })

  const alternarSortColuna = (coluna: NonNullable<Coluna>) => {
    if (sortColuna === coluna) setSortAsc((v) => !v)
    else { setSortColuna(coluna); setSortAsc(true) }
  }

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
    () => (linhas ?? []).filter((l) => selecionadosLote.has(l.taskId)),
    [linhas, selecionadosLote],
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
    await recarregarAgora()
    setRecarga((n) => n + 1)
    toast({ description: `${total} tarefa${total === 1 ? "" : "s"} atribuída${total === 1 ? "" : "s"}.`, variant: "success" })
  }

  const linhasOrdenadas = useMemo(() => ordenarPorColuna(linhas ?? [], sortColuna, sortAsc), [linhas, sortColuna, sortAsc])
  const linhasVisiveis = verTodas ? linhasOrdenadas : linhasOrdenadas.slice(0, LINHAS_VISIVEIS_POR_FAMILIA)

  const miniLadrilhos = useMemo(() => {
    let paraFazer = 0, acompanhar = 0, atrasadas = 0, terceirosAtrasados = 0
    for (const l of linhas ?? []) {
      if (l.coluna === "CONCLUIDA") continue
      const c = classificarAtencaoOperacional(l)
      if (c === "paraAgirAgora") paraFazer++
      else if (c === "acompanharHoje") acompanhar++
      else if (c === "terceirosAtrasados") terceirosAtrasados++
      if (l.atrasada) atrasadas++
    }
    return { paraFazer, acompanhar, atrasadas, terceirosAtrasados }
  }, [linhas])

  if (falhou) {
    return <div className="px-4 py-3"><Estado tipo="erro" mensagem="Não foi possível carregar as tarefas desta família." aoTentar={() => setRecarga((n) => n + 1)} /></div>
  }
  if (carregando) {
    return <div className="px-4 py-3"><Estado tipo="carregando" mensagem="Carregando tarefas…" /></div>
  }
  if (!linhas || linhas.length === 0) {
    return <div className="px-4 py-3"><Estado tipo="vazio" mensagem="Nenhuma tarefa nesta família." /></div>
  }

  return (
    <>
      {erroComando && (
        <div role="alert" className="mx-3 my-2 flex items-start justify-between gap-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-tile)] px-3.5 py-2.5 text-[12px] text-[var(--danger-text)]">
          <span>{erroComando}</span>
          <button onClick={() => setErroComando(null)} className="shrink-0 text-[var(--danger-text)]/70 transition-colors hover:text-[var(--danger-text)]" aria-label="Fechar aviso de erro">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2">
        <MiniLadrilho icone={Play} valor={miniLadrilhos.paraFazer} rotulo="Para fazer" tom="info" />
        <MiniLadrilho icone={CalendarClock} valor={miniLadrilhos.acompanhar} rotulo="Acompanhar" tom="warning" />
        <MiniLadrilho icone={AlertTriangle} valor={miniLadrilhos.atrasadas} rotulo="Atrasadas" tom="danger" />
        <MiniLadrilho icone={Clock3} valor={miniLadrilhos.terceirosAtrasados} rotulo="Terceiros atrasados" tom="warning" />
        <MiniLadrilho icone={CheckCircle2} valor={concluidasHoje} rotulo="Concluídas hoje" tom="success" />
      </div>
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-[var(--surface-overlay)]">
          <tr className="border-b border-[var(--border-subtle)] [&>th]:px-3 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-[var(--text-muted)]">
            {podeAtribuirLote && <th className="w-8" />}
            <ThOrdenavel label="Pessoa" ativo={sortColuna === "pessoa"} asc={sortAsc} aoClicar={() => alternarSortColuna("pessoa")} />
            <th>Documento / Tarefa</th>
            <ThOrdenavel label="Fase" ativo={sortColuna === "fase"} asc={sortAsc} aoClicar={() => alternarSortColuna("fase")} />
            <th>Etapa atual</th>
            <ThOrdenavel label="Prazo" ativo={sortColuna === "prazo"} asc={sortAsc} aoClicar={() => alternarSortColuna("prazo")} />
            <ThOrdenavel label="Prioridade" ativo={sortColuna === "prioridade"} asc={sortAsc} aoClicar={() => alternarSortColuna("prioridade")} />
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
              aoSelecionar={() => aoSelecionar(l.taskId, l.processoId)}
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
          {linhas.length > LINHAS_VISIVEIS_POR_FAMILIA ? (
            <>
              Mostrando {linhasVisiveis.length} de {linhas.length} tarefas ·{" "}
              <button onClick={() => setVerTodas((v) => !v)} className="font-medium text-[var(--action-primary)] hover:underline">
                {verTodas ? "Mostrar menos" : `Ver todas as tarefas de ${nomeFamilia}`}
              </button>
            </>
          ) : (
            <>{linhas.length} tarefa{linhas.length === 1 ? "" : "s"}</>
          )}
        </div>
        {podeAtribuirLote && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={linhas.length > 0 && linhas.every((l) => selecionadosLote.has(l.taskId))}
                onChange={() => alternarTodosNaFamilia(linhas.map((l) => l.taskId), linhas.every((l) => selecionadosLote.has(l.taskId)))}
                className="h-3.5 w-3.5 accent-[var(--action-primary)]"
              />
              Selecionar todas ({linhas.length})
            </label>
            <button
              disabled={linhas.filter((l) => selecionadosLote.has(l.taskId)).length === 0}
              onClick={() => setLoteAberto(true)}
              className="flex items-center gap-1.5 rounded-md bg-[var(--action-primary)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--action-primary-ink)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Atribuir selecionadas
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-secondary)]">
                  Mais ações <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className={Z_POPOVER}>
                <DropdownMenuItem onClick={() => exportarFamiliaCsv(nomeFamilia, linhas)}>Exportar CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
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
          placeholder={acaoComMotivo.acao === "aguardar_terceiro" ? "Por que esta tarefa está aguardando terceiro?" : "Por que esta tarefa será bloqueada?"}
          ocupado={ocupado}
          erro={erroComando}
          aoFechar={() => setAcaoComMotivo(null)}
          aoConfirmar={async (motivo) => {
            const ok = await comandar(
              acaoComMotivo.tarefaId,
              { acao: acaoComMotivo.acao, motivo },
              acaoComMotivo.acao === "aguardar_terceiro" ? "Tarefa aguardando terceiro." : "Tarefa bloqueada.",
            )
            if (ok) setAcaoComMotivo(null)
          }}
        />
      )}
    </>
  )
}
