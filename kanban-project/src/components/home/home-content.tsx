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
  Clock,
  Layers,
  ListChecks,
  ShieldAlert,
} from "lucide-react"
import type { AgendaItem, FilaOperacional, HomeData } from "@/src/types/home"
import { CommandPalette } from "@/src/components/home/command-palette"
import {
  BlocoCard,
  BlocoHeader,
  CARD_FOCAL,
  EmptyState,
  OURO, OURO_TINTA,
  formatarHorario,
  saudacao,
  CARD,
} from "@/src/components/home/home-primitives"
import { ProcessosEmAndamento } from "@/src/components/home/processos-andamento"
import { ESTILO_FAIXA_SLA } from "@/src/components/sla/sla-ui"
import { faixaDaFilaSla } from "@/src/lib/home/home-logic"

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
// 2. CENTRAL OPERACIONAL — o mesmo motor de /operacao/central, sempre por
//    família. ADMIN vê a operação inteira; OPERACIONAL só o próprio trabalho
//    — o filtro é decidido no SERVIDOR (/api/home), nunca aqui.
// ---------------------------------------------------------------------------
// Decisão do usuário em 10/09/2026: "Central de Notificações" (Prazos/Ações
// em abas soltas, sem categoria real do motor) deixou de ser o conceito
// principal. Este bloco é um RESUMO — a tela cheia, com filtro por fase,
// etapa, condição e busca, é /operacao/central; aqui é só "o que eu preciso
// saber sem sair da Home", com link pra lá.
// ===========================================================================
type FamiliasCentral = NonNullable<HomeData["centralOperacional"]>["familias"]

function fasesAgregadas(familias: FamiliasCentral | undefined) {
  const porFase = new Map<string, number>()
  for (const f of familias ?? []) {
    for (const p of f.processos) {
      for (const fa of p.fases) {
        if (fa.aFazer === 0) continue
        porFase.set(fa.label, (porFase.get(fa.label) ?? 0) + fa.aFazer)
      }
    }
  }
  return [...porFase.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total)
}

function CentralOperacionalBloco({ data }: { data: HomeData }) {
  const central = data.centralOperacional
  const isAdmin = data.usuario.tipo === "admin"
  const fases = useMemo(() => fasesAgregadas(central?.familias), [central])
  const familiasOrdenadas = useMemo(
    () => [...(central?.familias ?? [])].sort((a, b) => b.total - a.total).slice(0, 6),
    [central],
  )

  if (!central) return null

  const tilesResumo = [
    { rotulo: isAdmin ? "Abertas" : "Minhas abertas", valor: central.indicadores.total },
    { rotulo: "Executáveis agora", valor: central.indicadores.executavelAgora },
    { rotulo: isAdmin ? "Atrasadas" : "Minhas atrasadas", valor: central.indicadores.atrasadas },
    isAdmin
      ? { rotulo: "Sem responsável", valor: central.indicadores.semResponsavel }
      : { rotulo: "Bloqueadas", valor: central.indicadores.bloqueadas },
  ]

  return (
    <section id="central-operacional" className={`${CARD_FOCAL} flex min-h-[280px] flex-col`}>
      <div className="px-5 pb-3 pt-5">
        <BlocoHeader
          titulo={isAdmin ? "Central Operacional" : "Minha Central Operacional"}
          descricao={isAdmin ? "Toda a operação, agrupada por família" : "O que eu preciso fazer agora, por família"}
        />
      </div>

      {central.familias.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 pb-10 pt-2 text-center">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-medium text-[var(--text-primary)]">Tudo limpo por aqui</p>
          <p className="text-sm text-[var(--text-secondary)]">
            {isAdmin ? "Nenhuma tarefa aberta na operação." : "Nenhuma tarefa aberta atribuída a você."}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 px-5 pb-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tilesResumo.map((t) => (
              <div key={t.rotulo} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2.5">
                <div className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{t.valor}</div>
                <div className="text-[11px] text-[var(--text-secondary)]">{t.rotulo}</div>
              </div>
            ))}
          </div>

          {fases.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {fases.slice(0, 8).map((f) => (
                <span
                  key={f.label}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]"
                >
                  {f.label} <b className="tabular-nums text-[var(--text-primary)]">{f.total}</b>
                </span>
              ))}
            </div>
          )}

          <div className="space-y-1.5 pb-3">
            {familiasOrdenadas.map((f) => (
              <Link
                key={f.familiaId ?? f.nomeFamilia}
                href={`/operacao/central?busca=${encodeURIComponent(f.nomeFamilia)}`}
                className="group flex items-center justify-between gap-3 rounded-lg border border-transparent bg-[var(--surface-primary)] px-3 py-2.5 transition hover:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{f.nomeFamilia}</span>
                <span className="shrink-0 text-sm tabular-nums text-[var(--text-secondary)]">
                  {f.total} {isAdmin ? (f.total === 1 ? "tarefa" : "tarefas") : (f.total === 1 ? "minha tarefa" : "minhas tarefas")}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto border-t border-[var(--border-default)] px-5 py-3">
        <Link
          href="/operacao/central"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--action-primary)] transition hover:opacity-80"
        >
          Ver {isAdmin ? "a Central Operacional completa" : "minha Central Operacional completa"} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  )
}

// ===========================================================================
// 2a. TRABALHO PARA DISTRIBUIR — só ADMIN. Operacional não distribui trabalho
// global (mandato de 10/09/2026, item 16/17).
// ===========================================================================
function TrabalhoParaDistribuir({ data }: { data: HomeData }) {
  const central = data.centralOperacional
  if (data.usuario.tipo !== "admin" || !central || central.indicadores.semResponsavel === 0) return null
  const familias = central.familias.filter((f) => f.semResponsavel > 0).length
  return (
    <BlocoCard>
      <BlocoHeader
        titulo="Trabalho para distribuir"
        descricao={`${central.indicadores.semResponsavel} tarefa(s) sem responsável, em ${familias} família(s)`}
        acao={
          <Link
            href="/operacao/central?escopo=sem_responsavel"
            className="inline-flex items-center gap-1 text-xs font-medium transition hover:opacity-80"
            style={{ color: OURO_TINTA }}
          >
            Ver tarefas <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
    </BlocoCard>
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
  const isAdmin = data.usuario.tipo === "admin"
  return (
    <BlocoCard id="sla-processos">
      <BlocoHeader
        titulo={isAdmin ? "SLA dos processos" : "Meus prazos"}
        descricao={isAdmin ? "Prazo previsto de conclusão, a partir do SLA configurado em cada fase" : "Prazo previsto de conclusão dos seus processos"}
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
// Cada âncora aponta pra seção que já existe na própria Home; nenhum link
// novo, nenhuma tela nova. Os NÚMEROS vêm de `data.centralOperacional`, que o
// servidor já escopou (admin = universo global; operacional = só o próprio
// trabalho) — esta faixa nunca decide escopo, só rotula e aponta.
interface CartaoTopo { chave: string; rotulo: string; sub: string; valor: number; tile: string; ink: string; Icone: React.ComponentType<{ className?: string }>; ancora: string }

function cartoesTopo(data: HomeData): CartaoTopo[] {
  const isAdmin = data.usuario.tipo === "admin"
  const ind = data.centralOperacional?.indicadores
  if (isAdmin) {
    return [
      { chave: "abertas", rotulo: "Abertas", sub: "Pendências operacionais", valor: ind?.total ?? 0, tile: "var(--info-tile)", ink: "var(--info)", Icone: ListChecks, ancora: "#central-operacional" },
      { chave: "executaveis", rotulo: "Executáveis agora", sub: "Prontas para avançar", valor: ind?.executavelAgora ?? 0, tile: "var(--success-tile)", ink: "var(--success)", Icone: CheckCircle2, ancora: "#central-operacional" },
      { chave: "atrasadas", rotulo: "Atrasadas", sub: "Fora do prazo", valor: ind?.atrasadas ?? 0, tile: "var(--danger-tile)", ink: "var(--danger)", Icone: AlertCircle, ancora: "#central-operacional" },
      { chave: "semResponsavel", rotulo: "Sem responsável", sub: "Aguardando distribuição", valor: ind?.semResponsavel ?? 0, tile: "var(--warning-tile)", ink: "var(--warning)", Icone: Layers, ancora: "#central-operacional" },
      { chave: "bloqueadas", rotulo: "Bloqueadas", sub: "Impedimento a resolver", valor: ind?.bloqueadas ?? 0, tile: "var(--danger-tile)", ink: "var(--danger)", Icone: ShieldAlert, ancora: "#central-operacional" },
    ]
  }
  return [
    { chave: "abertas", rotulo: "Minhas abertas", sub: "O que é meu para fazer", valor: ind?.total ?? 0, tile: "var(--info-tile)", ink: "var(--info)", Icone: ListChecks, ancora: "#central-operacional" },
    { chave: "executaveis", rotulo: "Executáveis agora", sub: "Prontas para avançar", valor: ind?.executavelAgora ?? 0, tile: "var(--success-tile)", ink: "var(--success)", Icone: CheckCircle2, ancora: "#central-operacional" },
    { chave: "atrasadas", rotulo: "Minhas atrasadas", sub: "Fora do prazo", valor: ind?.atrasadas ?? 0, tile: "var(--danger-tile)", ink: "var(--danger)", Icone: AlertCircle, ancora: "#central-operacional" },
    { chave: "prazos", rotulo: "Próximos prazos", sub: "Nos próximos dias", valor: data.prazosResumo?.futuro ?? 0, tile: "var(--warning-tile)", ink: "var(--warning)", Icone: Calendar, ancora: "#sla-processos" },
    { chave: "bloqueadas", rotulo: "Bloqueadas", sub: "Impedimento a resolver", valor: ind?.bloqueadas ?? 0, tile: "var(--danger-tile)", ink: "var(--danger)", Icone: ShieldAlert, ancora: "#central-operacional" },
  ]
}

function FaixaIndicadores({ data }: { data: HomeData }) {
  const cartoes = cartoesTopo(data)
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cartoes.map((c) => (
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
                {c.valor}
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
          <TrabalhoParaDistribuir data={data} />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <ProcessosEmAndamento {...(data.usuario.tipo === "admin" ? {} : { titulo: "Meus processos" })} />
              <CentralOperacionalBloco data={data} />
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
