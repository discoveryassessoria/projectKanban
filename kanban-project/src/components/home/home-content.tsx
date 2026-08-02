"use client"

// ============================================================================
// CENTRO OPERACIONAL — composição da Home
// ----------------------------------------------------------------------------
// A Home responde 5 perguntas e nada mais:
//   1. O que precisa ser feito agora?  → Central Operacional (filas)
//   2. Quais são as prioridades?       → ordem e nível das filas
//   3. Existe algum problema?          → Alertas (só quando existem)
//   4. O que vence hoje?               → Agenda (hoje / amanhã / próximos)
//   5. Quais filas trabalhar?          → clique direto abre a fila exata
//
// Fora daqui: receita, caixa, financeiro resumido, processos ativos, famílias,
// pessoas na árvore, processos por fase, workflow macro, indicadores, atividade
// recente, acesso rápido e qualquer gráfico. Isso vive nos módulos próprios.
// ============================================================================

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  DollarSign,
  FileText,
  Layers,
  ShieldAlert,
} from "lucide-react"
import type { AgendaItem, FilaOperacional, HomeData, ModuloFila } from "@/src/types/home"
import { CommandPalette } from "@/src/components/home/command-palette"
import {
  BlocoCard,
  BlocoHeader,
  CARD_FOCAL,
  EmptyState,
  OURO,
  formatarHorario,
  nivelStyle,
  saudacao,
} from "@/src/components/home/home-primitives"
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
  critico: "border-red-400/25 bg-red-500/[0.13] text-red-300",
  atencao: "border-amber-400/25 bg-amber-500/[0.12] text-amber-300",
  ok: "border-emerald-400/25 bg-emerald-500/[0.12] text-emerald-300",
}
const PONTO_STATUS: Record<string, string> = {
  critico: "bg-red-400",
  atencao: "bg-amber-400",
  ok: "bg-emerald-400",
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
        <h1 className="truncate text-[26px] font-semibold tracking-tight text-white">
          {saudacao()}, {data.usuario.nome.split(" ")[0]}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-sm text-white/55">
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
// 2. CENTRAL OPERACIONAL — o maior bloco: só ações executáveis
// ===========================================================================
function LinhaFila({ fila }: { fila: FilaOperacional }) {
  const st = nivelStyle(fila.nivel)
  const Icone = ICONE_MODULO[fila.modulo]
  return (
    <Link
      href={fila.href}
      className="group flex items-center gap-3 rounded-xl border border-transparent bg-white/[0.04] px-3 py-3 transition hover:border-white/10 hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-white/20 md:gap-4"
    >
      <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border ${st.chip}`}>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{fila.titulo}</p>
        <p className="truncate text-xs text-white/45">{fila.descricao}</p>
      </div>
      {/* A quantidade é o dado que decide a prioridade: número grande e limpo,
          sem chip — a cor do nível já vive no ícone. */}
      <span className={`shrink-0 text-xl font-semibold tabular-nums ${fila.nivel === "critico" ? st.texto : "text-white"}`}>
        {fila.quantidade}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-white/60" />
    </Link>
  )
}

function CentralOperacional({ data }: { data: HomeData }) {
  const total = data.status.totalAcoes
  return (
    <section className={`${CARD_FOCAL} flex h-full flex-col`}>
      {/* Fio dourado no topo — a marca de que ESTE é o bloco principal da tela. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${OURO}8C, transparent)` }}
      />
      <div className="px-5 pb-3 pt-5">
        <BlocoHeader
          titulo="Central Operacional"
          descricao="O que precisa da sua ação agora"
          acao={
            total > 0 ? (
              <span className="rounded-md border border-red-400/30 bg-red-500/15 px-2 py-0.5 text-sm font-semibold tabular-nums text-red-300">
                {total}
              </span>
            ) : null
          }
        />
      </div>
      {data.filas.length === 0 ? (
        // Vazio aqui é CONQUISTA, não buraco: some o ícone apagado e entra a
        // confirmação de que a fila está limpa.
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-10 pt-2 text-center">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-500/10 text-emerald-300">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-medium text-white">Tudo limpo por aqui</p>
          <p className="text-sm text-white/45">Nenhuma fila com trabalho pendente para você.</p>
        </div>
      ) : (
        <div className="space-y-1.5 px-3 pb-3">
          {data.filas.map((f) => (
            <LinhaFila key={f.key} fila={f} />
          ))}
        </div>
      )}
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
      className="group flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 transition hover:border-white/20 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/20 md:px-4"
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${st.ponto}`} />
        <span className={`text-2xl font-bold tabular-nums ${fila.quantidade > 0 ? st.texto : "text-white/40"}`}>
          {fila.quantidade}
        </span>
        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-white/25 transition-transform group-hover:translate-x-0.5 group-hover:text-white/60" />
      </div>
      <p className="truncate text-sm font-semibold text-white">{fila.titulo}</p>
      <p className="truncate text-xs text-white/45">{fila.descricao}</p>
    </Link>
  )
}

function PainelSlaBloco({ data }: { data: HomeData }) {
  const sla = data.sla
  if (!sla) return null
  return (
    <BlocoCard>
      <BlocoHeader
        titulo="SLA dos processos"
        descricao="Prazo previsto de conclusão, a partir do SLA configurado em cada fase"
        acao={
          sla.resumo.semPrazo > 0 ? (
            <span className="text-xs font-medium tabular-nums text-white/45">
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
        className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/20"
      >
        <span className="w-14 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-white/70">
          {item.diaInteiro ? "dia" : formatarHorario(item.horario)}
        </span>
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: OURO }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">{item.titulo}</p>
          <p className="truncate text-xs text-white/45">
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
      <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">{titulo}</p>
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
            style={{ color: OURO }}
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
// 4. ALERTAS — o bloco só existe quando há alerta real
// ===========================================================================
/** Linha discreta de "nada aqui" — um bloco vazio não merece um vazio de card. */
function LinhaQuieta({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 px-0.5 py-1.5 text-sm text-white/40">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/20" />
      {children}
    </p>
  )
}

function Alertas({ data }: { data: HomeData }) {
  if (data.alertas.length === 0) {
    return (
      <BlocoCard>
        <BlocoHeader titulo="Alertas" />
        <LinhaQuieta>Nenhum evento travando a operação.</LinhaQuieta>
      </BlocoCard>
    )
  }
  return (
    <BlocoCard className="border-red-400/20 bg-red-500/[0.06]">
      <BlocoHeader titulo="Alertas" descricao="Eventos críticos que travam a operação" />
      <ul className="space-y-2">
        {data.alertas.map((a) => {
          const st = nivelStyle(a.nivel)
          const Icone = a.tipo === "integracao" || a.tipo === "automacao" ? ShieldAlert : AlertTriangle
          return (
            <li key={a.key}>
              <Link
                href={a.href}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 transition hover:bg-black/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <Icone className={`h-4 w-4 shrink-0 ${st.texto}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{a.titulo}</p>
                  <p className="truncate text-xs text-white/55">{a.detalhe}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
              </Link>
            </li>
          )
        })}
      </ul>
    </BlocoCard>
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
        className={`text-2xl font-bold tabular-nums ${destaque && valor > 0 ? "text-red-300" : "text-white"}`}
      >
        {valor}
      </span>
      <span className="text-xs text-white/50">{rotulo}</span>
    </div>
  )
  if (!href) return conteudo
  return (
    <Link href={href} className="rounded-lg transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/20">
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
      <BlocoCard className="flex flex-wrap items-center gap-x-5 gap-y-2 !py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/90">Operação de hoje</h2>
        <span className="hidden h-3.5 w-px bg-white/10 sm:block" />
        {itens.map((i) => (
          <span key={i.rotulo} className="text-xs text-white/40">
            <b className="font-semibold tabular-nums text-white/60">0</b> {i.curto}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Sem pendências no dia
        </span>
      </BlocoCard>
    )
  }

  return (
    <BlocoCard>
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
export function HomeContent({ data }: { data: HomeData }) {
  const semAcesso =
    !data.permissions.verProcessos && !data.permissions.verTarefas && !data.permissions.verEventos

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6">
      <Cabecalho data={data} />

      {semAcesso ? (
        <BlocoCard>
          <EmptyState icon={Clock}>
            Sua conta ainda não tem permissões liberadas. Fale com o administrador para começar a operar.
          </EmptyState>
        </BlocoCard>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CentralOperacional data={data} />
            </div>
            <div className="space-y-5">
              <Alertas data={data} />
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
