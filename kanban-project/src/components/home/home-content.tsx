"use client"

// ============================================================================
// CENTRO OPERACIONAL — composição da Home
// ----------------------------------------------------------------------------
// A Home responde 5 perguntas e nada mais:
//   1. O que precisa ser feito agora?  → Central de Notificações, aba "Ações"
//   2. Existe algum problema?          → idem — alertas entram na mesma lista,
//                                         ordenados por severidade (mesclado
//                                         09/09/2026, aprovado pelo usuário:
//                                         "Alertas" numa caixa à parte da
//                                         Central Operacional era a MESMA
//                                         categoria de coisa fragmentada em
//                                         dois lugares)
//   3. O que tem prazo?                → Central de Notificações, aba "Prazos"
//                                         (prévia Atrasadas/Hoje/A vencer,
//                                         "Ver Central de Prazos completa"
//                                         abre a tela cheia com calendário)
//   4. O que vence hoje (agenda)?      → Agenda (hoje / amanhã / próximos)
//   5. Quais itens trabalhar?          → clique direto abre a fila/alerta exato
//
// Fora daqui: receita, caixa, financeiro resumido, processos ativos, famílias,
// pessoas na árvore, processos por fase, workflow macro, indicadores, atividade
// recente, acesso rápido e qualquer gráfico. Isso vive nos módulos próprios.
// ============================================================================

import * as React from "react"
import { useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  DollarSign,
  FileText,
  Layers,
  ListChecks,
  Search,
  ShieldAlert,
} from "lucide-react"
import type { AgendaItem, FilaOperacional, HomeData, ModuloFila, NivelPrioridade } from "@/src/types/home"
import { CommandPalette } from "@/src/components/home/command-palette"
import {
  BlocoCard,
  BlocoHeader,
  CARD_FOCAL,
  EmptyState,
  OURO, OURO_TINTA,
  formatarHorario,
  nivelStyle,
  saudacao,
  CARD,
} from "@/src/components/home/home-primitives"
import { ProcessosEmAndamento } from "@/src/components/home/processos-andamento"
import { ESTILO_FAIXA_SLA } from "@/src/components/sla/sla-ui"
import { faixaDaFilaSla } from "@/src/lib/home/home-logic"

const ICONE_MODULO: Record<ModuloFila, React.ComponentType<{ className?: string }>> = {
  documentos: FileText,
  processos: Layers,
  tarefas: ClipboardList,
  financeiro: DollarSign,
}

// ===========================================================================
// 1. CABEÇALHO — saudação, data, status operacional, busca global
// ===========================================================================
/** Pílula de status: a mensagem operacional vira UM objeto, com a cor do nível. */
const PILULA_STATUS: Record<string, string> = {
  critico: "border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]",
  atencao: "border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]",
  ok: "border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]",
}
const PONTO_STATUS: Record<string, string> = {
  critico: "bg-red-600",
  atencao: "bg-amber-600",
  ok: "bg-green-600",
}

function Cabecalho({ data }: { data: HomeData }) {
  const hoje = new Date(data.geradoEm).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
  const s = data.status
  const nivel = s.nivel === "critico" ? "critico" : s.nivel === "atencao" ? "atencao" : "ok"

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {/* O protagonista da tela é a fila de trabalho, não a saudação: ela
            desce de tamanho e o status sobe para a mesma linha da data. */}
        <h1 className="truncate text-[26px] font-semibold tracking-tight text-[var(--text-primary)]">
          {saudacao()}, {data.usuario.nome.split(" ")[0]}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-sm text-[var(--text-secondary)]">
          <span className="capitalize">{hoje}</span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${PILULA_STATUS[nivel]}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${PONTO_STATUS[nivel]}`} />
            {s.mensagem}
          </span>
        </div>
      </div>
      <CommandPalette />
    </header>
  )
}

// ===========================================================================
// 2. CENTRAL DE NOTIFICAÇÕES — duas abas, nunca uma lista achatada
// ---------------------------------------------------------------------------
// Achado real (usuário, ao vivo): a lista antiga misturava "Central de
// Prazos" (uma fila baseada em DATA) com "Localizar registros" (uma fila
// baseada em AÇÃO/etapa do workflow) na mesma lista solta, como se fossem a
// mesma categoria de coisa — e não são. "Prazos" responde QUANDO; "Ações"
// responde O QUÊ. Cada uma vira sua própria aba, e Alertas (que hoje vivia
// numa caixinha separada, desconectada) entra DENTRO de "Ações" — é a mesma
// categoria de "precisa da sua atenção", só que mais grave.
// ===========================================================================

interface ItemAcao {
  key: string
  titulo: string
  descricao: string
  quantidade: number
  nivel: NivelPrioridade
  modulo: ModuloFila
  href: string
  ehAlerta: boolean
}

const ROTULO_NIVEL: Record<NivelPrioridade, string> = {
  critico: "Crítico",
  alto: "Alto",
  medio: "Médio",
  baixo: "Baixo",
}
const PONTO_NIVEL: Record<NivelPrioridade, string> = {
  critico: "bg-red-600",
  alto: "bg-amber-600",
  medio: "bg-[var(--action-primary)]",
  baixo: "bg-[var(--text-muted)]",
}
const ROTULO_MODULO: Record<ModuloFila, string> = {
  documentos: "Documentos",
  processos: "Processos",
  tarefas: "Tarefas",
  financeiro: "Financeiro",
}

function montarItensAcao(data: HomeData): ItemAcao[] {
  const dasFilas: ItemAcao[] = data.filas
    .filter((f) => f.key !== "prazos-vencendo") // prazo tem aba própria
    .map((f) => ({
      key: f.key, titulo: f.titulo, descricao: f.descricao, quantidade: f.quantidade,
      nivel: f.nivel, modulo: f.modulo, href: f.href, ehAlerta: false,
    }))
  const dosAlertas: ItemAcao[] = data.alertas
    .filter((a) => a.tipo !== "prazo") // idem — o alerta de prazo pertence à aba Prazos
    .map((a) => ({
      key: `alerta-${a.key}`, titulo: a.titulo, descricao: a.detalhe, quantidade: a.quantidade,
      nivel: a.nivel, modulo: a.tipo === "documento_invalido" ? "documentos" : "processos",
      href: a.href, ehAlerta: true,
    }))
  return [...dosAlertas, ...dasFilas]
}

function LinhaAcao({ item }: { item: ItemAcao }) {
  const st = nivelStyle(item.nivel)
  const Icone = item.ehAlerta ? ShieldAlert : ICONE_MODULO[item.modulo]
  return (
    <Link
      href={item.href}
      className="group flex items-center gap-3 rounded-xl border border-transparent bg-[var(--surface-primary)] px-3 py-3 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-primary)] focus:outline-none focus:ring-2 focus:ring-white/20 md:gap-4"
    >
      <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border ${st.chip}`}>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.titulo}</p>
        <p className="truncate text-xs text-[var(--text-secondary)]">{item.descricao}</p>
      </div>
      <span className={`shrink-0 text-xl font-semibold tabular-nums ${item.nivel === "critico" ? st.texto : "text-[var(--text-primary)]"}`}>
        {item.quantidade}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-secondary)]" />
    </Link>
  )
}

function AbaAcoes({ data }: { data: HomeData }) {
  const [busca, setBusca] = useState("")
  const [modulo, setModulo] = useState<"todos" | ModuloFila>("todos")
  const itens = useMemo(() => montarItensAcao(data), [data])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return itens.filter((i) => {
      if (modulo !== "todos" && i.modulo !== modulo) return false
      if (termo && !`${i.titulo} ${i.descricao}`.toLowerCase().includes(termo)) return false
      return true
    })
  }, [itens, busca, modulo])

  const grupos = useMemo(() => {
    const ordem: NivelPrioridade[] = ["critico", "alto", "medio", "baixo"]
    return ordem
      .map((n) => [n, filtrados.filter((i) => i.nivel === n)] as const)
      .filter(([, arr]) => arr.length > 0)
  }, [filtrados])

  const modulosPresentes = useMemo(() => [...new Set(itens.map((i) => i.modulo))], [itens])

  if (itens.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-10 pt-6 text-center">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="text-[15px] font-medium text-[var(--text-primary)]">Tudo limpo por aqui</p>
        <p className="text-sm text-[var(--text-secondary)]">Nenhuma ação nem alerta pendente para você.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col px-3 pb-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-2 px-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar ação ou alerta..."
            className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--action-primary)]"
          />
        </div>
        {modulosPresentes.length > 1 && (
          <select
            value={modulo}
            onChange={(e) => setModulo(e.target.value as "todos" | ModuloFila)}
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
          >
            <option value="todos">Todos os módulos</option>
            {modulosPresentes.map((m) => (
              <option key={m} value={m}>{ROTULO_MODULO[m]}</option>
            ))}
          </select>
        )}
      </div>

      {filtrados.length === 0 ? (
        <div className="px-2 py-6 text-center text-sm text-[var(--text-muted)]">Nenhum item bate com esse filtro.</div>
      ) : (
        <div className="space-y-3">
          {grupos.map(([nivel, arr]) => (
            <div key={nivel}>
              <div className="mb-1.5 flex items-center gap-1.5 px-2">
                <span className={`h-1.5 w-1.5 rounded-full ${PONTO_NIVEL[nivel]}`} />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {ROTULO_NIVEL[nivel]} · {arr.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {arr.map((i) => <LinhaAcao key={i.key} item={i} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AbaPrazos({ data }: { data: HomeData }) {
  const r = data.prazosResumo
  if (!r) return null
  const tiles: Array<{ rotulo: string; valor: number; tom: string; janela: string }> = [
    { rotulo: "Atrasadas", valor: r.atrasadas, tom: "text-red-700", janela: "atrasadas" },
    { rotulo: "Vencem hoje", valor: r.hoje, tom: "text-amber-700", janela: "hoje" },
    { rotulo: "A vencer", valor: r.futuro, tom: "text-[var(--text-primary)]", janela: "futuro" },
  ]
  if (r.total === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-10 pt-6 text-center">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="text-[15px] font-medium text-[var(--text-primary)]">Nenhum prazo em aberto</p>
        <p className="text-sm text-[var(--text-secondary)]">Nenhum passo nem tarefa com prazo definido agora.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-5 pb-6 pt-2">
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Link
            key={t.janela}
            href={`/dashboard/fila/prazos-vencendo?janela=${t.janela}`}
            className="group flex flex-col items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-4 text-center transition hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            <span className={`text-3xl font-bold tabular-nums ${t.tom}`}>{t.valor}</span>
            <span className="text-xs font-medium text-[var(--text-secondary)]">{t.rotulo}</span>
          </Link>
        ))}
      </div>
      <Link
        href="/dashboard/fila/prazos-vencendo"
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-strong)]"
      >
        <Calendar className="h-4 w-4" /> Ver Central de Prazos completa ({r.total})
      </Link>
    </div>
  )
}

function CentralDeNotificacoes({ data }: { data: HomeData }) {
  const [aba, setAba] = useState<"prazos" | "acoes">("acoes")
  const totalAcoes = montarItensAcao(data).reduce((s, i) => s + i.quantidade, 0)
  const totalPrazos = data.prazosResumo?.total ?? 0

  return (
    // min-h (não h-full): o conteúdo agora MUDA de altura entre as abas
    // (Prazos é curto, Ações pode ser longo) — h-full herdava a altura da
    // aba mais alta já renderizada no grid (a coluna ao lado, com Agenda,
    // esticava a linha inteira) e sobrava vazio/cortado ao trocar de aba.
    <section id="central-operacional" className={`${CARD_FOCAL} flex min-h-[280px] flex-col`}>
      <div className="px-5 pb-3 pt-5">
        <BlocoHeader titulo="Central de Notificações" descricao="O que precisa da sua atenção agora" />
        <div className="mt-3 flex gap-1.5 rounded-lg bg-[var(--surface-secondary)] p-1">
          {([
            ["prazos", "Prazos", totalPrazos],
            ["acoes", "Ações", totalAcoes],
          ] as const).map(([valor, rotulo, contagem]) => (
            <button
              key={valor}
              onClick={() => setAba(valor)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold transition ${
                aba === valor
                  ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {rotulo}
              {contagem > 0 && <span className="tabular-nums opacity-70">{contagem}</span>}
            </button>
          ))}
        </div>
      </div>
      {aba === "prazos" ? <AbaPrazos data={data} /> : <AbaAcoes data={data} />}
    </section>
  )
}

// ===========================================================================
// 2b. SLA DOS PROCESSOS — situação do prazo, clicável até a lista filtrada
// ---------------------------------------------------------------------------
// Bloco próprio: prazo não é fila de trabalho. Os quatro cards aparecem sempre
// (inclusive zerados) e cada um abre EXATAMENTE os processos daquela faixa —
// mesma engine, mesma contagem, sem recálculo na tela.
// ===========================================================================
function CardSla({ fila }: { fila: FilaOperacional }) {
  const st = ESTILO_FAIXA_SLA[faixaDaFilaSla(fila.key) ?? "no-prazo"]
  return (
    <Link
      href={fila.href}
      className="group flex flex-col gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-3 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-primary)] focus:outline-none focus:ring-2 focus:ring-white/20 md:px-4"
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${st.ponto}`} />
        <span className={`text-2xl font-bold tabular-nums ${fila.quantidade > 0 ? st.texto : "text-[var(--text-muted)]"}`}>
          {fila.quantidade}
        </span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-secondary)]" />
      </div>
      <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{fila.titulo}</p>
      <p className="truncate text-xs text-[var(--text-secondary)]">{fila.descricao}</p>
    </Link>
  )
}

function PainelSlaBloco({ data }: { data: HomeData }) {
  const sla = data.sla
  if (!sla) return null
  return (
    <BlocoCard id="sla-processos">
      <BlocoHeader
        titulo="SLA dos processos"
        descricao="Prazo previsto de conclusão, a partir do SLA configurado em cada fase"
        acao={
          sla.resumo.semPrazo > 0 ? (
            <span className="text-xs font-medium tabular-nums text-[var(--text-secondary)]">
              {sla.resumo.semPrazo} sem SLA configurado
            </span>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {sla.cards.map((c) => (
          <CardSla key={c.key} fila={c} />
        ))}
      </div>
    </BlocoCard>
  )
}

// ===========================================================================
// 3. AGENDA — hoje, amanhã, próximos dias. Nada além disso.
// ===========================================================================
function LinhaAgenda({ item }: { item: AgendaItem }) {
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--surface-primary)] focus:outline-none focus:ring-2 focus:ring-white/20"
      >
        <span className="w-14 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-white/70">
          {item.diaInteiro ? "dia" : formatarHorario(item.horario)}
        </span>
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: OURO }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">{item.titulo}</p>
          <p className="truncate text-xs text-[var(--text-secondary)]">
            {[item.grupo === "proximos" ? item.dia : null, item.processoNome, item.local]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </Link>
    </li>
  )
}

function GrupoAgendaBloco({ titulo, itens }: { titulo: string; itens: AgendaItem[] }) {
  if (itens.length === 0) return null
  return (
    <div>
      <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{titulo}</p>
      <ul className="space-y-0.5">
        {itens.map((e) => (
          <LinhaAgenda key={e.id} item={e} />
        ))}
      </ul>
    </div>
  )
}

function AgendaBloco({ data }: { data: HomeData }) {
  if (!data.permissions.verEventos) return null
  const { hoje, amanha, proximos } = data.agenda
  const vazia = hoje.length + amanha.length + proximos.length === 0
  return (
    <BlocoCard>
      <BlocoHeader
        titulo="Agenda"
        acao={
          <Link
            href="/events"
            className="inline-flex items-center gap-1 text-xs font-medium transition hover:opacity-80"
            style={{ color: OURO_TINTA }}
          >
            Ver agenda <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {vazia ? (
        <LinhaQuieta>Nenhum compromisso nos próximos dias.</LinhaQuieta>
      ) : (
        <div className="space-y-4">
          <GrupoAgendaBloco titulo="Hoje" itens={hoje} />
          <GrupoAgendaBloco titulo="Amanhã" itens={amanha} />
          <GrupoAgendaBloco titulo="Próximos dias" itens={proximos} />
        </div>
      )}
    </BlocoCard>
  )
}

// ===========================================================================
// 4. (Alertas foi mesclado na Central de Notificações — ver aba "Ações".)
// ===========================================================================
/** Linha discreta de "nada aqui" — um bloco vazio não merece um vazio de card. */
function LinhaQuieta({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 px-0.5 py-1.5 text-sm text-[var(--text-muted)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--surface-secondary)]" />
      {children}
    </p>
  )
}

// ===========================================================================
// 5. RESUMO DA OPERAÇÃO DO DIA — trabalho de hoje, não estatística histórica
// ===========================================================================
function Indicador({
  valor,
  rotulo,
  href,
  destaque,
}: {
  valor: number
  rotulo: string
  href?: string
  destaque?: boolean
}) {
  const conteudo = (
    <div className="flex flex-col gap-0.5 px-2 py-1">
      <span
        className={`text-2xl font-bold tabular-nums ${destaque && valor > 0 ? "text-red-700" : "text-white"}`}
      >
        {valor}
      </span>
      <span className="text-xs text-[var(--text-secondary)]">{rotulo}</span>
    </div>
  )
  if (!href) return conteudo
  return (
    <Link href={href} className="rounded-lg transition hover:bg-[var(--surface-primary)] focus:outline-none focus:ring-2 focus:ring-white/20">
      {conteudo}
    </Link>
  )
}

function ResumoDoDia({ data }: { data: HomeData }) {
  const r = data.resumoDia
  const itens = [
    { valor: r.tarefasConcluidas, rotulo: "Tarefas concluídas hoje", curto: "concluídas", href: undefined },
    { valor: r.aguardandoCliente, rotulo: "Aguardando cliente", curto: "aguardando cliente", href: "/dashboard/fila/aguardando-cliente" },
    { valor: r.aguardandoCartorio, rotulo: "Aguardando cartório", curto: "aguardando cartório", href: undefined },
    { valor: r.emValidacao, rotulo: "Em validação", curto: "em validação", href: "/dashboard/fila/validar" },
    { valor: r.processosBloqueados, rotulo: "Processos bloqueados", curto: "bloqueados", href: "/dashboard/fila/bloqueios", destaque: true },
  ]

  // DENSIDADE ADAPTATIVA: cinco zeros em corpo 24 ocupam o espaço de um dia
  // cheio de trabalho e não dizem nada. Sem movimento no dia, o bloco encolhe
  // para uma faixa de uma linha — o espaço volta para a operação.
  const semMovimento = itens.every((i) => i.valor === 0)
  if (semMovimento) {
    return (
      <BlocoCard id="operacao-do-dia" className="flex flex-wrap items-center gap-x-5 gap-y-2 !py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/90">Operação de hoje</h2>
        <span className="hidden h-3.5 w-px bg-[var(--surface-primary)] sm:block" />
        {itens.map((i) => (
          <span key={i.rotulo} className="text-xs text-[var(--text-muted)]">
            <b className="font-semibold tabular-nums text-[var(--text-secondary)]">0</b> {i.curto}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-green-800">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--action-primary)]" />
          Sem pendências no dia
        </span>
      </BlocoCard>
    )
  }

  return (
    <BlocoCard id="operacao-do-dia">
      <BlocoHeader titulo="Operação de hoje" descricao="O trabalho do dia, em tempo real" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {itens.map((i) => (
          <Indicador key={i.rotulo} valor={i.valor} rotulo={i.rotulo} href={i.href} destaque={i.destaque} />
        ))}
      </div>
    </BlocoCard>
  )
}

// ===========================================================================
// COMPOSIÇÃO
// ===========================================================================

// ===========================================================================
// FAIXA DE INDICADORES — os quatro cartões do topo do mockup.
//
// Cada número vem de uma fonte que JÁ EXISTE no HomeData; nenhum deles é
// inventado nem recalculado aqui. O ladrilho colorido é o mesmo par
// (pastel + glifo saturado) usado nos KPI da fase.
// ===========================================================================
// Achado real: os quatro cartões só mostravam o número — sem destino nenhum,
// nem pra onde a MESMA página já detalha aquele número (Alertas, SLA, Central
// Operacional, Operação de hoje estão todos ali embaixo). Cada âncora aponta
// pra seção que já existe na própria Home; nenhum link novo, nenhuma tela nova.
const CARTOES_TOPO = [
  { chave: "criticos",   rotulo: "Itens críticos",       sub: "Exigem atenção imediata", tile: "var(--danger-tile)",  ink: "var(--danger)",  Icone: AlertCircle, ancora: "#central-operacional" },
  { chave: "noPrazo",    rotulo: "Processos no prazo",   sub: "Dentro do SLA contratado", tile: "var(--warning-tile)", ink: "var(--warning)", Icone: Clock, ancora: "#sla-processos" },
  { chave: "abertas",    rotulo: "Ações abertas",        sub: "Pendências operacionais",  tile: "var(--info-tile)",    ink: "var(--info)",    Icone: ListChecks, ancora: "#central-operacional" },
  { chave: "concluidas", rotulo: "Ações concluídas hoje", sub: "Parabéns, ótimo trabalho!", tile: "var(--success-tile)", ink: "var(--success)", Icone: CheckCircle2, ancora: "#operacao-do-dia" },
] as const

function FaixaIndicadores({ data }: { data: HomeData }) {
  const valores: Record<string, number> = {
    // Alerta crítico é o que o motor já classificou como crítico — não é uma
    // releitura das filas com outro critério.
    criticos: data.alertas.filter((a) => a.nivel === "critico").length,
    noPrazo: data.sla?.resumo.noPrazo ?? 0,
    abertas: data.filas.reduce((s, f) => s + f.quantidade, 0),
    concluidas: data.resumoDia.tarefasConcluidas,
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CARTOES_TOPO.map((c) => (
        <a
          key={c.chave} href={c.ancora}
          className={`${CARD} block overflow-hidden p-5 transition hover:border-[var(--border-strong)] hover:shadow-[var(--elev-2)] focus:outline-none focus:ring-2 focus:ring-[var(--action-primary)]/40`}
        >
          <div className="flex items-start gap-3.5">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
              style={{ background: c.tile, color: c.ink }}
              aria-hidden
            >
              <c.Icone className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[28px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">
                {valores[c.chave]}
              </div>
              <div className="mt-1.5 text-[13px] font-medium text-[var(--text-primary)]">{c.rotulo}</div>
              <div className="text-[12px] text-[var(--text-muted)]">{c.sub}</div>
            </div>
          </div>
          {/* Filete da cor do indicador, como no mockup. */}
          <div className="mt-4 h-[3px] w-10 rounded-full" style={{ background: c.ink }} />
        </a>
      ))}
    </div>
  )
}

export function HomeContent({ data }: { data: HomeData }) {
  const semAcesso =
    !data.permissions.verProcessos && !data.permissions.verTarefas && !data.permissions.verEventos

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6">
      <Cabecalho data={data} />

      {!semAcesso && <FaixaIndicadores data={data} />}

      {semAcesso ? (
        <BlocoCard>
          <EmptyState icon={Clock}>
            Sua conta ainda não tem permissões liberadas. Fale com o administrador para começar a operar.
          </EmptyState>
        </BlocoCard>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <ProcessosEmAndamento />
              <CentralDeNotificacoes data={data} />
            </div>
            <div className="space-y-5">
              <AgendaBloco data={data} />
            </div>
          </div>

          <PainelSlaBloco data={data} />

          <ResumoDoDia data={data} />
        </>
      )}
    </div>
  )
}
