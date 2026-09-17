"use client"

// ============================================================================
// PÁGINA INICIAL — composição da Home
// ----------------------------------------------------------------------------
// Redesign 16/09/2026 (decisão do usuário): a Home é visão geral, não fila de
// trabalho. Ela responde só 4 perguntas:
//   1. Como estou / como está a operação agora?  → Cabeçalho
//   2. Existe algo que precisa da minha atenção?  → Minha Atenção (resumo,
//      nunca uma segunda fila — a fila de verdade é /operacao)
//   3. Como estão meus processos, e o que vem na agenda?  → Meus Processos +
//      Agenda, lado a lado
//   4. O que tem prazo?  → Prazos (um bloco só, Processos e Tarefas)
//
// Fora daqui: execução, fila operacional detalhada, distribuição de trabalho,
// indicadores por família, resumo de produtividade do dia. Isso pertence à
// tela Operação — a Home aponta pra lá, nunca duplica.
// ============================================================================

import * as React from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react"
import type { AgendaItem, FilaOperacional, HomeData } from "@/src/types/home"
import { CommandPalette } from "@/src/components/home/command-palette"
import {
  BlocoCard,
  BlocoHeader,
  EmptyState,
  OURO,
  formatarHorario,
  saudacao,
} from "@/src/components/home/home-primitives"
import { ProcessosEmAndamento } from "@/src/components/home/processos-andamento"
import { CORES_SLA, type CorSla } from "@/src/components/sla/sla-ui"
import { faixaDaFilaPrazo, type FaixaPrazo } from "@/src/lib/home/home-logic"

/**
 * Semáforo dos DOIS relógios operacionais canônicos — Tarefa e Subtarefa
 * (o SLA de FaseMacro/Processo foi removido, 17/09/2026 — ver
 * [[prazo-tarefa-subtarefa-dois-relogios]]). `proximos-3` e `proximos-7`
 * dividem o mesmo tom de atenção — a engine de SLA sempre teve só 3 cores
 * (🟢🟡🔴); os 5 baldes são um recorte mais fino do MESMO semáforo, não uma
 * paleta nova.
 */
const ESTILO_FAIXA_PRAZO: Record<FaixaPrazo, CorSla> = {
  atrasadas: CORES_SLA.atrasado,
  "vencem-hoje": CORES_SLA.hoje,
  "proximos-3": CORES_SLA.atencao,
  "proximos-7": CORES_SLA.atencao,
  "no-prazo": CORES_SLA.ok,
}

// ===========================================================================
// 1. CABEÇALHO — saudação, data, estado geral. Sem card: a Home pediu
//    explicitamente "não criar cards grandes" para esta informação.
// ===========================================================================
const PONTO_STATUS: Record<string, string> = {
  critico: "bg-red-600",
  atencao: "bg-amber-600",
  ok: "bg-[var(--action-primary)]",
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {saudacao()}
        </p>
        <h1 className="mt-0.5 truncate text-[30px] font-semibold tracking-tight text-[var(--text-primary)]">
          {data.usuario.nome.split(" ")[0]}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2.5 text-sm text-[var(--text-secondary)]">
          <span className="capitalize">{hoje}</span>
          <span className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
          <span className="inline-flex items-center gap-1.5">
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
// 2. MINHA ATENÇÃO — resumo compacto, nunca uma segunda fila. Uma linha só:
//    tudo em dia, ou a contagem do que precisa de ação — sempre com a porta
//    pra Operação, que é onde o trabalho de verdade se faz.
// ===========================================================================
function MinhaAtencaoBloco({ data }: { data: HomeData }) {
  const central = data.centralOperacional
  if (!central) return null
  // PESSOAL, não a operação inteira (achado real 17/09/2026, mandato
  // Grisotto): `central.indicadores` já vem calculado com `responsavelId: eu`
  // — inclusive para admin (ver src/app/api/home/route.ts). Por isso
  // `semResponsavel` não entra aqui: uma tarefa sem dono nunca é "minha", e a
  // obrigação administrativa de distribuí-la (Tarefa própria, tipo
  // ADMINISTRATIVA) é que aparece nestes números quando o usuário logado é
  // quem a recebeu — contada uma vez, nunca somada de novo por fora.
  const { executavelAgora, atrasadas, bloqueadas } = central.indicadores
  const precisaAtencao = executavelAgora + atrasadas + bloqueadas

  const partes: string[] = []
  if (executavelAgora > 0) partes.push(`${executavelAgora} pronta${executavelAgora === 1 ? "" : "s"} para avançar`)
  if (atrasadas > 0) partes.push(`${atrasadas} atrasada${atrasadas === 1 ? "" : "s"}`)
  if (bloqueadas > 0) partes.push(`${bloqueadas} bloqueada${bloqueadas === 1 ? "" : "s"}`)

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
            precisaAtencao === 0 ? "bg-[var(--success-tile)] text-[var(--success)]" : "bg-[var(--warning-tile)] text-[var(--warning)]"
          }`}
          aria-hidden
        >
          <CheckCircle2 className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-[var(--text-primary)]">
            {precisaAtencao === 0
              ? "Tudo em dia — nenhuma operação exige sua atenção agora."
              : `${precisaAtencao} operaç${precisaAtencao === 1 ? "ão exige" : "ões exigem"} sua atenção`}
          </p>
          {precisaAtencao > 0 && (
            <p className="truncate text-[12.5px] text-[var(--text-secondary)]">{partes.join(" · ")}</p>
          )}
        </div>
      </div>
      <Link
        // Reconciliação de rotas (16/09/2026): apontava pra Central Operacional
        // (/operacao/central — família inteira; pra admin, a empresa toda). O
        // bloco é pessoal ("sua atenção"), e a tela que o usuário chama de
        // "Operação" em todo o resto da conversa é /operacao ("Minha
        // Operação"), pessoal pra qualquer tipo de usuário — mesmo destino
        // conceitual do card, agora com a rota certa.
        href="/operacao"
        className="inline-flex shrink-0 items-center gap-1.5 self-start text-[13px] font-semibold text-[var(--action-primary)] transition hover:opacity-80 sm:self-auto"
      >
        Abrir Operação <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  )
}

// ===========================================================================
// 3. PRAZOS — um bloco só, duas linhas (Processos / Tarefas). Resumo: a
//    utilização operacional detalhada continua em Operação.
// ===========================================================================
function LinhaDeChip({ fila }: { fila: FilaOperacional }) {
  const faixaPrazo = faixaDaFilaPrazo(fila.key)?.faixa ?? "no-prazo"
  const st = ESTILO_FAIXA_PRAZO[faixaPrazo]
  return (
    <Link
      href={fila.href}
      className="group flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2.5 transition hover:bg-[var(--surface-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--action-primary)]/30"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.ponto}`} />
      <span className={`text-lg font-semibold tabular-nums ${fila.quantidade > 0 ? st.texto : "text-[var(--text-muted)]"}`}>
        {fila.quantidade}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">{fila.titulo.replace(/^(Tarefas|Subtarefas)\s*[—-]?\s*/, "").replace(/^\w/, (c) => c.toUpperCase())}</span>
    </Link>
  )
}

/**
 * UM PAINEL DE PRAZO — Tarefa (compromisso de entrega) OU Subtarefa (ação
 * corrente). Os dois convivem lado a lado na Home, NUNCA um substituindo o
 * outro: uma tarefa pode estar no prazo enquanto a subtarefa que está
 * rodando agora já está atrasada, e as duas leituras são verdadeiras ao
 * mesmo tempo (regra definitiva do usuário, 17/09/2026).
 */
function PainelDePrazo({
  icone: Icone,
  titulo,
  descricao,
  cards,
}: {
  icone: React.ComponentType<{ className?: string }>
  titulo: string
  descricao: string
  cards: FilaOperacional[]
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] p-3.5">
      <div className="flex items-center gap-2.5 pb-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--info-tile)] text-[var(--info)]" aria-hidden>
          <Icone className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">{titulo}</p>
          <p className="truncate text-[11px] text-[var(--text-muted)]">{descricao}</p>
        </div>
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {cards.map((c) => (
          <LinhaDeChip key={c.key} fila={c} />
        ))}
      </div>
    </div>
  )
}

function PrazosBloco({ data }: { data: HomeData }) {
  const tarefas = data.prazosTarefas ?? null
  const subtarefas = data.prazosSubtarefas ?? null
  if (!tarefas && !subtarefas) return null

  return (
    <BlocoCard id="prazos">
      <BlocoHeader titulo="Prazos" descricao="Os dois controles de prazo da operação, lado a lado" />
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        {tarefas && (
          <PainelDePrazo
            icone={CheckCircle2}
            titulo="Tarefas"
            descricao="Prazo de conclusão — o compromisso macro"
            cards={tarefas}
          />
        )}
        {subtarefas && (
          <PainelDePrazo
            icone={ChevronRight}
            titulo="Subtarefas ativas"
            descricao="Prazo da ação atual — o relógio operacional"
            cards={subtarefas}
          />
        )}
      </div>
    </BlocoCard>
  )
}

// ===========================================================================
// 4. AGENDA — hoje, amanhã, próximos dias.
// ===========================================================================
function LinhaAgenda({ item }: { item: AgendaItem }) {
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--surface-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--action-primary)]/30"
      >
        <span className="w-14 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
          {item.diaInteiro ? "dia" : formatarHorario(item.horario)}
        </span>
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: OURO }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[var(--text-primary)]">{item.titulo}</p>
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
    <BlocoCard className="h-full">
      <BlocoHeader
        titulo="Agenda"
        acao={
          <Link
            href="/events"
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--action-primary)] transition hover:opacity-80"
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

function LinhaQuieta({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 px-0.5 py-1.5 text-sm text-[var(--text-muted)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--surface-secondary)]" />
      {children}
    </p>
  )
}

// ===========================================================================
// COMPOSIÇÃO
// ===========================================================================
export function HomeContent({ data }: { data: HomeData }) {
  const semAcesso =
    !data.permissions.verProcessos && !data.permissions.verTarefas && !data.permissions.verEventos

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6">
      <Cabecalho data={data} />

      {semAcesso ? (
        <BlocoCard>
          <EmptyState icon={ChevronRight}>
            Sua conta ainda não tem permissões liberadas. Fale com o administrador para começar a operar.
          </EmptyState>
        </BlocoCard>
      ) : (
        <>
          <MinhaAtencaoBloco data={data} />

          {/* Meus Processos ~70-75% · Agenda ~25-30% */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
            <ProcessosEmAndamento {...(data.usuario.tipo === "admin" ? {} : { titulo: "Meus processos" })} />
            <AgendaBloco data={data} />
          </div>

          <PrazosBloco data={data} />
        </>
      )}
    </div>
  )
}
