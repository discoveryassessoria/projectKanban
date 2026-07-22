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
  CalendarClock,
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
import { GlobalSearch } from "@/src/components/home/global-search"
import {
  BlocoCard,
  BlocoHeader,
  EmptyState,
  OURO,
  formatarHorario,
  nivelStyle,
  saudacao,
} from "@/src/components/home/home-primitives"

const ICONE_MODULO: Record<ModuloFila, React.ComponentType<{ className?: string }>> = {
  documentos: FileText,
  processos: Layers,
  tarefas: ClipboardList,
  financeiro: DollarSign,
}

// ===========================================================================
// 1. CABEÇALHO — saudação, data, status operacional, busca global
// ===========================================================================
function Cabecalho({ data }: { data: HomeData }) {
  const hoje = new Date(data.geradoEm).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
  const s = data.status
  const cor = s.nivel === "critico" ? "bg-red-400" : s.nivel === "atencao" ? "bg-amber-400" : "bg-emerald-400"

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight text-white md:text-[28px]">
          {saudacao()}, {data.usuario.nome.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm capitalize text-white/50">{hoje}</p>
        <p className="mt-2 flex items-center gap-2 text-sm text-white/80">
          <span className={`h-2 w-2 rounded-full ${cor}`} />
          {s.mensagem}
        </p>
      </div>
      <div className="w-full lg:max-w-md">
        <GlobalSearch />
      </div>
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
      className="group flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 transition hover:border-white/20 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/20 md:gap-4 md:px-4"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${st.chip}`}>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{fila.titulo}</p>
        <p className="truncate text-xs text-white/50">{fila.descricao}</p>
      </div>
      <span className={`shrink-0 rounded-md border px-2 py-1 text-sm font-bold tabular-nums ${st.chip}`}>
        {fila.quantidade}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-white/60" />
    </Link>
  )
}

function CentralOperacional({ data }: { data: HomeData }) {
  return (
    <BlocoCard>
      <BlocoHeader
        titulo="Central Operacional"
        descricao="O que precisa da sua ação agora"
        acao={
          data.status.totalAcoes > 0 ? (
            <span className="text-xs font-medium tabular-nums text-white/50">
              {data.status.totalAcoes} {data.status.totalAcoes === 1 ? "ação" : "ações"}
            </span>
          ) : null
        }
      />
      {data.filas.length === 0 ? (
        <EmptyState icon={CheckCircle2}>Nenhuma fila com trabalho pendente para você.</EmptyState>
      ) : (
        <div className="space-y-2">
          {data.filas.map((f) => (
            <LinhaFila key={f.key} fila={f} />
          ))}
        </div>
      )}
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
        <EmptyState icon={CalendarClock}>Nenhum compromisso nos próximos dias.</EmptyState>
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
function Alertas({ data }: { data: HomeData }) {
  if (data.alertas.length === 0) return null
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
  return (
    <BlocoCard>
      <BlocoHeader titulo="Operação de hoje" descricao="O trabalho do dia, em tempo real" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Indicador valor={r.tarefasConcluidas} rotulo="Tarefas concluídas hoje" />
        <Indicador valor={r.aguardandoCliente} rotulo="Aguardando cliente" href="/dashboard/fila/aguardando-cliente" />
        <Indicador valor={r.aguardandoCartorio} rotulo="Aguardando cartório" />
        <Indicador valor={r.emValidacao} rotulo="Em validação" href="/dashboard/fila/validar" />
        <Indicador valor={r.processosBloqueados} rotulo="Processos bloqueados" href="/dashboard/fila/bloqueios" destaque />
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

          <ResumoDoDia data={data} />
        </>
      )}
    </div>
  )
}
