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
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  DollarSign,
  FileText,
  Layers,
  ListChecks,
  ShieldAlert,
} from "lucide-react"
import type { AgendaItem, FilaOperacional, HomeData, ModuloFila } from "@/src/types/home"
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
// 2. CENTRAL OPERACIONAL — o maior bloco: só ações executáveis
// ===========================================================================
function LinhaFila({ fila }: { fila: FilaOperacional }) {
  const st = nivelStyle(fila.nivel)
  const Icone = ICONE_MODULO[fila.modulo]
  return (
    <Link
      href={fila.href}
      className="group flex items-center gap-3 rounded-xl border border-transparent bg-[var(--surface-primary)] px-3 py-3 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-primary)] focus:outline-none focus:ring-2 focus:ring-white/20 md:gap-4"
    >
      <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border ${st.chip}`}>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{fila.titulo}</p>
        <p className="truncate text-xs text-[var(--text-secondary)]">{fila.descricao}</p>
      </div>
      {/* A quantidade é o dado que decide a prioridade: número grande e limpo,
          sem chip — a cor do nível já vive no ícone. */}
      <span className={`shrink-0 text-xl font-semibold tabular-nums ${fila.nivel === "critico" ? st.texto : "text-[var(--text-primary)]"}`}>
        {fila.quantidade}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-secondary)]" />
    </Link>
  )
}

function CentralOperacional({ data }: { data: HomeData }) {
  const total = data.status.totalAcoes
  return (
    <section className={`${CARD_FOCAL} flex h-full flex-col`}>
      <div className="px-5 pb-3 pt-5">
        <BlocoHeader
          titulo="Central Operacional"
          descricao="O que precisa da sua ação agora"
          acao={
            total > 0 ? (
              <span className="rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-0.5 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
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
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] text-green-800">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-medium text-[var(--text-primary)]">Tudo limpo por aqui</p>
          <p className="text-sm text-[var(--text-secondary)]">Nenhuma fila com trabalho pendente para você.</p>
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
    <BlocoCard>
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
// 4. ALERTAS — o bloco só existe quando há alerta real
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
    <BlocoCard className="border-[var(--border-default)] bg-[var(--surface-secondary)]">
      <BlocoHeader titulo="Alertas" descricao="Eventos críticos que travam a operação" />
      <ul className="space-y-2">
        {data.alertas.map((a) => {
          const st = nivelStyle(a.nivel)
          const Icone = a.tipo === "integracao" || a.tipo === "automacao" ? ShieldAlert : AlertTriangle
          return (
            <li key={a.key}>
              <Link
                href={a.href}
                className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-black/20 px-3 py-2.5 transition hover:bg-black/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <Icone className={`h-4 w-4 shrink-0 ${st.texto}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{a.titulo}</p>
                  <p className="truncate text-xs text-[var(--text-secondary)]">{a.detalhe}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
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
      <BlocoCard className="flex flex-wrap items-center gap-x-5 gap-y-2 !py-3">
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

// ===========================================================================
// FAIXA DE INDICADORES — os quatro cartões do topo do mockup.
//
// Cada número vem de uma fonte que JÁ EXISTE no HomeData; nenhum deles é
// inventado nem recalculado aqui. O ladrilho colorido é o mesmo par
// (pastel + glifo saturado) usado nos KPI da fase.
// ===========================================================================
const CARTOES_TOPO = [
  { chave: "criticos",   rotulo: "Itens críticos",       sub: "Exigem atenção imediata", tile: "var(--danger-tile)",  ink: "var(--danger)",  Icone: AlertCircle },
  { chave: "noPrazo",    rotulo: "Processos no prazo",   sub: "Dentro do SLA contratado", tile: "var(--warning-tile)", ink: "var(--warning)", Icone: Clock },
  { chave: "abertas",    rotulo: "Ações abertas",        sub: "Pendências operacionais",  tile: "var(--pessoa-tile)",  ink: "var(--pessoa)",  Icone: ListChecks },
  { chave: "concluidas", rotulo: "Ações concluídas hoje", sub: "Parabéns, ótimo trabalho!", tile: "var(--success-tile)", ink: "var(--success)", Icone: CheckCircle2 },
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
        <div key={c.chave} className={`${CARD} overflow-hidden p-5`}>
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
        </div>
      ))}
    </div>
  )
}

// ===========================================================================
// ROSCA DE SLA — as quatro faixas que o ResumoSla já entrega.
// SVG puro: um gráfico destes não justifica biblioteca.
// ===========================================================================
function RoscaSla({ data }: { data: HomeData }) {
  const r = data.sla?.resumo
  if (!r) return null
  const faixas = [
    { rotulo: "No prazo",       valor: r.noPrazo,    cor: "var(--success)" },
    { rotulo: "Próximos 7 dias", valor: r.proximos7,  cor: "var(--accent-primary)" },
    { rotulo: "Vencem hoje",    valor: r.vencemHoje, cor: "var(--warning)" },
    { rotulo: "Atrasados",      valor: r.atrasados,  cor: "var(--danger)" },
  ]
  const total = faixas.reduce((s, f) => s + f.valor, 0)
  const RAIO = 52, ESPESSURA = 12
  const circ = 2 * Math.PI * RAIO
  let percorrido = 0

  return (
    <BlocoCard>
      <BlocoHeader titulo="SLA dos processos" descricao={`${total} processo${total === 1 ? "" : "s"} avaliado${total === 1 ? "" : "s"}`} />
      <div className="mt-4 flex items-center gap-5">
        <div className="relative shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Distribuição de SLA">
            <circle cx="64" cy="64" r={RAIO} fill="none" stroke="var(--surface-tertiary)" strokeWidth={ESPESSURA} />
            {total > 0 && faixas.map((f) => {
              if (f.valor === 0) return null
              const traco = (f.valor / total) * circ
              const el = (
                <circle
                  key={f.rotulo} cx="64" cy="64" r={RAIO} fill="none"
                  stroke={f.cor} strokeWidth={ESPESSURA} strokeLinecap="butt"
                  strokeDasharray={`${traco} ${circ - traco}`}
                  strokeDashoffset={-percorrido}
                  transform="rotate(-90 64 64)"
                />
              )
              percorrido += traco
              return el
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-[26px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">{r.noPrazo}</div>
              <div className="text-[11px] text-[var(--text-muted)]">No prazo</div>
            </div>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-2">
          {faixas.map((f) => (
            <li key={f.rotulo} className="flex items-center gap-2.5 text-[13px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: f.cor }} aria-hidden />
              <span className="w-7 shrink-0 text-right font-semibold tabular-nums text-[var(--text-primary)]">{f.valor}</span>
              <span className="truncate text-[var(--text-secondary)]">{f.rotulo}</span>
            </li>
          ))}
        </ul>
      </div>
    </BlocoCard>
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
              <CentralOperacional data={data} />
            </div>
            <div className="space-y-5">
              <Alertas data={data} />
              <AgendaBloco data={data} />
              <RoscaSla data={data} />
            </div>
          </div>

          <PainelSlaBloco data={data} />

          <ResumoDoDia data={data} />
        </>
      )}
    </div>
  )
}
