"use client"

// src/components/arvore/inteligencia/cartoes-flutuantes.tsx
// ============================================================================
// CARTÕES FLUTUANTES SOBRE O CANVAS — o que NÃO é controle.
//
// A árvore tem UMA barra de ferramentas (a linha PAISAGEM | RETRATO, ver
// `barra-linhagem.tsx`). Tudo o que antes ficava empilhado em linhas extras sobre
// o canvas virou cartão flutuante, `absolute` dentro do contêiner do canvas:
//
//   • `CartaoResumoFlutuante` — resumo do requerente (linhagem, documentos,
//     próxima ação), RECOLHÍVEL, canto superior esquerdo;
//   • `LegendaSaude` — pequena, só existe com o modo Saúde ligado, canto superior
//     direito;
//   • `TrilhaFlutuante` — o breadcrumb Requerente > Pai > Avó, na base, ao centro.
//
// Nenhum entra no fluxo do canvas: abrir, recolher ou trocar de requerente não
// move um card da árvore. A superfície é opaca (`--surface-elevated`, o token
// global de "o que flutua acima de tudo"): quem lê nunca vê o desenho através.
// ============================================================================

import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react"
import { COR_NIVEL, ROTULO_NIVEL, type NivelSaudePessoa } from "@/src/lib/genealogia/operacional/saude"
import type { DegrauLinhagem } from "@/src/lib/genealogia/motor/linhagens"
import type { ResumoLinhagem } from "@/src/lib/genealogia/operacional/dossie"
import { TOTAL_PRIORIDADES, type AcaoRecomendada } from "@/src/lib/genealogia/operacional/diagnostico"
import type { RascunhoTarefa } from "@/src/lib/genealogia/operacional/tarefa-do-passo"

const CARTAO =
  "rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] text-gray-900 shadow-[var(--elev-2)]"

const CHAVE_RECOLHIDO = "arvore:resumo-recolhido"

/** Preferência do próprio visualizador (recolhido ou não). Falha de storage não quebra nada. */
function lerRecolhido(): boolean {
  // Sem escolha guardada: em tela estreita o cartão nasce recolhido (cobriria o
  // canvas); em tela larga nasce aberto.
  const estreita = window.innerWidth < 768
  try {
    const guardado = window.localStorage.getItem(CHAVE_RECOLHIDO)
    return guardado == null ? estreita : guardado === "1"
  } catch {
    return estreita
  }
}
function gravarRecolhido(v: boolean) {
  try {
    window.localStorage.setItem(CHAVE_RECOLHIDO, v ? "1" : "0")
  } catch {
    /* sem storage: o cartão só não lembra a escolha */
  }
}

// ── RESUMO DO REQUERENTE ────────────────────────────────────────────────────

export function CartaoResumoFlutuante({
  resumo,
  proximaAcao,
  carregando,
  onIrParaPessoa,
  rascunhoDaProximaAcao,
  onCriarTarefa,
}: {
  resumo: ResumoLinhagem | null
  proximaAcao: AcaoRecomendada
  carregando: boolean
  onIrParaPessoa: (pessoaId: number) => void
  /** Rascunho do "Criar tarefa" da próxima ação (null = não há alvo). */
  rascunhoDaProximaAcao?: RascunhoTarefa | null
  /** Ausente = sem permissão `tarefas.criar`: o botão não existe. */
  onCriarTarefa?: (rascunho: RascunhoTarefa) => void
}) {
  // Nasce aberto (a primeira leitura do processo precisa do resumo) e lembra a
  // escolha de quem recolheu. Lido depois da montagem para não divergir do HTML
  // do servidor.
  const [recolhido, setRecolhido] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência vem do storage, que só existe no cliente
    setRecolhido(lerRecolhido())
  }, [])
  const alternar = () => {
    const novo = !recolhido
    setRecolhido(novo)
    gravarRecolhido(novo)
  }

  if (!resumo) return null

  const feitos = resumo.documental.atendidas + resumo.documental.dispensadas
  const total = resumo.documental.necessarias
  const docs = total > 0 ? `${feitos} de ${total}` : "sem exigência"

  if (recolhido) {
    return (
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)]">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={false}
          aria-label="Abrir o resumo do requerente"
          title="Abrir o resumo do requerente"
          className={`${CARTAO} pointer-events-auto flex max-w-full items-center gap-2 px-3 py-1.5 text-[12px] transition hover:border-[var(--border-strong)]`}
        >
          <span className="max-w-[160px] truncate font-semibold">{resumo.nome}</span>
          <span className="tabular-nums text-gray-600">{total > 0 ? `${feitos}/${total}` : "—"}</span>
          {resumo.bloqueios > 0 && (
            <span className="rounded-full bg-[var(--surface-secondary)] px-1.5 text-[11px] font-semibold text-red-700">
              {resumo.bloqueios}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 w-[min(320px,calc(100%-1.5rem))]">
      <section aria-label="Resumo do requerente" className={`${CARTAO} pointer-events-auto p-3`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] uppercase leading-none tracking-wide text-[var(--text-muted)]">Requerente</p>
            <p className="mt-0.5 truncate text-[13px] font-semibold">{resumo.nome}</p>
          </div>
          <button
            type="button"
            onClick={alternar}
            aria-expanded
            aria-label="Recolher o resumo do requerente"
            title="Recolher"
            className="shrink-0 rounded p-1 text-gray-500 transition hover:bg-[var(--surface-hover)] hover:text-gray-900"
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <p className="mt-2 text-[11px] text-gray-600">
          Ascendente transmissor:{" "}
          {resumo.danteCausaNome ? (
            <button
              type="button"
              onClick={() => onIrParaPessoa(resumo.danteCausaId!)}
              title="Ascendente mais próximo com nacionalidade do país-alvo — é ele que fundamenta o pedido."
              className="font-medium text-gray-900 underline underline-offset-2 transition hover:opacity-70"
            >
              {resumo.danteCausaNome}
            </button>
          ) : (
            <span className="text-[var(--text-muted)]">não identificado</span>
          )}
        </p>
        <p className="mt-0.5 text-[11px] text-gray-600">
          Linhagem: {resumo.pessoas} pessoa{resumo.pessoas === 1 ? "" : "s"} · {resumo.geracoes} geração(ões)
        </p>

        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          <Linha rotulo="Documentos" texto={docs} dica="Atendidos ou dispensados, sobre o total exigido pelas Regras Documentais." />
          <Linha rotulo="Pendências" texto={String(resumo.documental.pendentes)} dica="Exigências que ainda não foram iniciadas." />
          <Linha
            rotulo="Bloqueios"
            texto={String(resumo.bloqueios)}
            alerta={resumo.bloqueios > 0}
            dica="Documentos marcados como não localizados — é o que impede concluir."
          />
          <Linha rotulo="Divergências" texto={String(resumo.divergencias)} dica="Achados do motor genealógico nesta linha." />
        </dl>

        <div className="mt-3 rounded-md bg-[var(--surface-secondary)] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Próxima ação</p>
          <p className="mt-0.5 text-[12px] leading-snug text-gray-800">
            {proximaAcao.pessoaNome ? `${proximaAcao.pessoaNome}: ` : ""}
            {proximaAcao.acao}
          </p>
          <p
            className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
            title={`Prioridade ${proximaAcao.prioridade}/${TOTAL_PRIORIDADES}`}
          >
            Fonte: {proximaAcao.fonte}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {proximaAcao.pessoaId != null && (
              <button
                type="button"
                onClick={() => onIrParaPessoa(proximaAcao.pessoaId!)}
                className="text-[12px] font-medium text-gray-900 underline underline-offset-2 transition hover:opacity-70"
              >
                Ir até a pessoa
              </button>
            )}
            {rascunhoDaProximaAcao && onCriarTarefa && (
              <button
                type="button"
                data-criar-tarefa
                onClick={() => onCriarTarefa(rascunhoDaProximaAcao)}
                className="rounded-md bg-[var(--action-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)]"
              >
                Criar tarefa
              </button>
            )}
          </div>
        </div>

        {carregando && (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">Atualizando dados operacionais…</p>
        )}
      </section>
    </div>
  )
}

function Linha({
  rotulo,
  texto,
  dica,
  alerta = false,
}: {
  rotulo: string
  texto: string
  dica?: string
  alerta?: boolean
}) {
  return (
    <>
      <dt className="text-gray-500" title={dica}>
        {rotulo}
      </dt>
      <dd className={`text-right font-medium tabular-nums ${alerta ? "text-red-700" : "text-gray-900"}`}>{texto}</dd>
    </>
  )
}

// ── LEGENDA DA SAÚDE ────────────────────────────────────────────────────────
// Números reais, não só cores: "amarelo" não diz quantas pessoas. Só existe com o
// modo Saúde ligado — o chamador não a monta com a Saúde desligada.

export function LegendaSaude({ contagem }: { contagem: Record<NivelSaudePessoa, number> }) {
  return (
    <div
      role="status"
      aria-label="Legenda da Saúde"
      className={`${CARTAO} absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 py-1`}
    >
      {(["critico", "atencao", "saudavel", "fora"] as NivelSaudePessoa[]).map((n) => (
        <span key={n} className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COR_NIVEL[n] }} />
          {ROTULO_NIVEL[n]}
          <span className="font-medium tabular-nums text-gray-900">{contagem[n]}</span>
        </span>
      ))}
    </div>
  )
}

// ── TRILHA DA LINHAGEM (breadcrumb) ─────────────────────────────────────────
// Projeção do caminho que já existe na árvore: cada degrau aponta para o MESMO
// nó do canvas. Não é uma segunda representação da estrutura. Só aparece no
// modo linhagem, quando há mais de um degrau.

export function TrilhaFlutuante({
  trilha,
  onIrParaPessoa,
}: {
  trilha: DegrauLinhagem[]
  onIrParaPessoa: (pessoaId: number) => void
}) {
  if (trilha.length <= 1) return null
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 w-[min(860px,calc(100%-14rem))] -translate-x-1/2">
      <nav
        aria-label="Caminho da linhagem"
        className={`${CARTAO} pointer-events-auto mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 px-2.5 py-1.5`}
      >
        {trilha.map((degrau, i) => (
          <span key={degrau.pessoaId} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />}
            <button
              type="button"
              onClick={() => onIrParaPessoa(degrau.pessoaId)}
              title={`${degrau.rotulo}${degrau.compartilhadoPor > 1 ? ` · ${degrau.compartilhadoPor} requerentes dependem` : ""}`}
              className={`max-w-[150px] truncate rounded px-1.5 py-0.5 text-[12px] transition hover:bg-[var(--surface-hover)] ${
                degrau.ehDanteCausa ? "font-semibold text-gray-900" : "text-gray-600"
              }`}
            >
              <span className="text-[var(--text-muted)]">{degrau.rotulo}: </span>
              {degrau.nome}
            </button>
          </span>
        ))}
      </nav>
    </div>
  )
}
