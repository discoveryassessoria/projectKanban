// src/components/arvore/motor/painel-inteligencia.tsx
//
// O painel onde a árvore explica o que descobriu.
//
// Princípio: nada aqui é um relatório. Todo item é (1) um achado, (2) o motivo
// dele existir e (3) um botão que leva o operador direto à pessoa envolvida.
// Insight que não navega para lugar nenhum é ruído com aparência de trabalho.
//
// Ordem fixa e intencional:
//   Saúde da árvore → o número que resume a situação
//   Próximos passos → o que fazer AGORA, já priorizado
//   Achados por categoria → o detalhe, quando o operador quiser

"use client"

import { memo, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  FileSearch,
  GitBranch,
  Lightbulb,
  Plane,
  ShieldAlert,
  Signature,
  Target,
  X,
} from "lucide-react"
import type { AnaliseArvore, CategoriaInsight, Insight } from "@/src/lib/genealogia/motor/tipos"
import { CATEGORIA_ROTULO, EASE, SEVERIDADE_COR, SEVERIDADE_ROTULO, SUCESSO, SUCESSO_SUAVE, TREE } from "./tokens"

const ICONE_CATEGORIA: Record<CategoriaInsight, React.ReactNode> = {
  conflito: <AlertTriangle className="h-3.5 w-3.5" />,
  duplicidade: <Copy className="h-3.5 w-3.5" />,
  lacuna: <Target className="h-3.5 w-3.5" />,
  relacao: <GitBranch className="h-3.5 w-3.5" />,
  pesquisa: <FileSearch className="h-3.5 w-3.5" />,
  migracao: <Plane className="h-3.5 w-3.5" />,
  sobrenome: <Signature className="h-3.5 w-3.5" />,
  risco: <ShieldAlert className="h-3.5 w-3.5" />,
}

const ORDEM_CATEGORIAS: CategoriaInsight[] = [
  "risco",
  "conflito",
  "duplicidade",
  "lacuna",
  "pesquisa",
  "relacao",
  "sobrenome",
  "migracao",
]

export interface PainelInteligenciaProps {
  analise: AnaliseArvore
  aberto: boolean
  aoFechar: () => void
  aoIrParaPessoa: (id: number) => void
  nomeDe: (id: number) => string
  /** Categoria pré-aberta ao abrir o painel (vinda de um clique no resumo). */
  categoriaInicial?: CategoriaInsight | null
}

export function PainelInteligencia({
  analise,
  aberto,
  aoFechar,
  aoIrParaPessoa,
  nomeDe,
  categoriaInicial,
}: PainelInteligenciaProps) {
  const [expandida, setExpandida] = useState<CategoriaInsight | null>(categoriaInicial ?? "risco")

  const porCategoria = useMemo(() => {
    const m = new Map<CategoriaInsight, Insight[]>()
    for (const i of analise.insights) {
      const arr = m.get(i.categoria) || []
      arr.push(i)
      m.set(i.categoria, arr)
    }
    return m
  }, [analise.insights])

  if (!aberto) return null

  const q = analise.qualidade

  return (
    <aside
      data-no-pan
      className="absolute right-0 top-0 z-30 flex h-full w-[380px] max-w-[92vw] flex-col shadow-xl"
      style={{
        background: TREE.painel,
        borderLeft: `1px solid ${TREE.cartaoBorda}`,
        boxShadow: TREE.sombraPainel,
        animation: `painelEntrada 280ms ${EASE.suave}`,
      }}
      aria-label="Inteligência da árvore"
    >
      <style>{`
        @keyframes painelEntrada {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <header
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4" style={{ color: TREE.acentoTexto }} />
          <h2 className="text-[13.5px] font-semibold" style={{ color: TREE.texto }}>
            O que a árvore encontrou
          </h2>
        </div>
        <button
          type="button"
          onClick={aoFechar}
          className="rounded p-1 transition-colors arv-hover"
          aria-label="Fechar painel de inteligência"
        >
          <X className="h-4 w-4" style={{ color: TREE.textoFraco }} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* ---------- Saúde ---------- */}
        <section className="px-4 py-4" style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}>
          <div className="flex items-center gap-4">
            <MedidorSaude valor={q.score} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Barra rotulo="Completude" valor={q.completude} />
              <Barra rotulo="Consistência" valor={q.consistencia} />
              <Barra rotulo="Linha de cidadania" valor={q.coberturaLinha} />
            </div>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: TREE.textoFraco }}>
            {q.totalPessoas} pessoas · {q.geracoesMapeadas} gerações mapeadas ·{" "}
            {analise.linhaCidadania.length > 0
              ? `${analise.linhaCidadania.length} pessoas na linha de transmissão`
              : "linha de transmissão ainda não identificada"}
            .
          </p>
          {analise.truncado && (
            <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: TREE.textoSuave }}>
              A árvore é grande: a lista abaixo mostra os achados mais relevantes de cada
              categoria, não todos. Os contadores são do total real.
            </p>
          )}
        </section>

        {/* ---------- Próximos passos ---------- */}
        {analise.proximosPassos.length > 0 && (
          <section className="px-4 py-4" style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: TREE.textoFraco }}>
              Próximos passos
            </h3>
            <ol className="space-y-1.5">
              {analise.proximosPassos.map((passo) => (
                <li key={passo.id}>
                  <button
                    type="button"
                    onClick={() => passo.pessoaIds[0] != null && aoIrParaPessoa(passo.pessoaIds[0])}
                    className="w-full rounded-lg px-2.5 py-2 text-left transition-colors arv-hover"
                    style={{ border: `1px solid ${TREE.cartaoBorda}` }}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className="mt-[3px] h-2 w-2 shrink-0 rounded-full"
                        style={{ background: SEVERIDADE_COR[passo.severidade] }}
                        aria-label={SEVERIDADE_ROTULO[passo.severidade]}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium leading-snug" style={{ color: TREE.texto }}>
                          {passo.titulo}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: TREE.textoFraco }}>
                          {passo.motivo}
                        </span>
                      </span>
                      <span
                        className="shrink-0 rounded px-1 py-0.5 text-[9.5px] font-semibold tabular-nums"
                        style={{ background: SUCESSO_SUAVE, color: SUCESSO }}
                        title="Ganho estimado na saúde da árvore"
                      >
                        +{passo.ganho}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ---------- Gargalos ---------- */}
        {analise.gargalos.length > 0 && (
          <section className="px-4 py-4" style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}>
            <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: TREE.textoFraco }}>
              Gargalos da pesquisa
            </h3>
            <p className="mb-2 text-[11px] leading-snug" style={{ color: TREE.textoFraco }}>
              Pessoas sem filiação que travam o maior número de descendentes. Resolver aqui destrava mais que resolver em qualquer outro ponto.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {analise.gargalos.slice(0, 6).map((id) => {
                const a = analise.porPessoa.get(id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => aoIrParaPessoa(id)}
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors arv-hover"
                    style={{ border: `1px solid ${TREE.cartaoBorda}`, color: TREE.texto }}
                    title={a?.resumo}
                  >
                    {nomeDe(id)}
                    {a && a.descendentesNaLinha > 0 && (
                      <span className="ml-1 tabular-nums" style={{ color: TREE.textoFraco }}>
                        ·{a.descendentesNaLinha}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* ---------- Achados ---------- */}
        <section className="px-2 py-2">
          {ORDEM_CATEGORIAS.map((cat) => {
            const itens = porCategoria.get(cat)
            if (!itens?.length) return null
            const aberta = expandida === cat
            const pior = itens[0].severidade
            // Conta o total REAL, não o que coube na lista: dizer "37" quando
            // existem 4.000 é mentir sobre o tamanho do trabalho.
            const total = analise.totais?.[cat] ?? itens.length
            return (
              <div key={cat} className="mb-1">
                <button
                  type="button"
                  onClick={() => setExpandida(aberta ? null : cat)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition-colors arv-hover"
                  aria-expanded={aberta}
                >
                  <span style={{ color: SEVERIDADE_COR[pior] }}>{ICONE_CATEGORIA[cat]}</span>
                  <span className="flex-1 text-left text-[12.5px] font-medium" style={{ color: TREE.texto }}>
                    {CATEGORIA_ROTULO[cat]}
                  </span>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                    style={{ background: TREE.hover, color: TREE.textoFraco }}
                  >
                    {total}
                  </span>
                  <ChevronDown
                    className="h-3.5 w-3.5"
                    style={{
                      color: TREE.textoFraco,
                      transform: aberta ? "rotate(180deg)" : "rotate(0)",
                      transition: `transform 200ms ${EASE.rapido}`,
                    }}
                  />
                </button>

                {aberta && (
                  <ul className="space-y-1 px-1 pb-2 pt-1">
                    {itens.slice(0, 40).map((i) => (
                      <ItemInsight key={i.id} insight={i} aoIrParaPessoa={aoIrParaPessoa} />
                    ))}
                    {total > 40 && (
                      <li className="px-2.5 py-1 text-[11px]" style={{ color: TREE.textoFraco }}>
                        + {total - 40} outros achados desta categoria. Resolva os de cima
                        primeiro — a lista é reordenada a cada atualização da árvore.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )
          })}

          {analise.insights.length === 0 && (
            <p className="px-3 py-8 text-center text-[12.5px]" style={{ color: TREE.textoFraco }}>
              Nenhum problema encontrado. A árvore está consistente.
            </p>
          )}
        </section>
      </div>
    </aside>
  )
}

const ItemInsight = memo(function ItemInsight({
  insight,
  aoIrParaPessoa,
}: {
  insight: Insight
  aoIrParaPessoa: (id: number) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => insight.pessoaIds[0] != null && aoIrParaPessoa(insight.pessoaIds[0])}
        className="w-full rounded-lg px-2.5 py-2 text-left transition-colors arv-hover"
      >
        <span className="flex items-start gap-2">
          <span
            className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: SEVERIDADE_COR[insight.severidade] }}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-medium leading-snug" style={{ color: TREE.texto }}>
              {insight.titulo}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: TREE.textoFraco }}>
              {insight.explicacao}
            </span>
            {insight.acao && (
              <span className="mt-1 block text-[11px] font-medium leading-snug" style={{ color: TREE.acentoTexto }}>
                → {insight.acao}
              </span>
            )}
          </span>
          {insight.confianca != null && insight.confianca < 1 && (
            <span
              className="shrink-0 rounded px-1 py-0.5 text-[9.5px] tabular-nums"
              style={{ background: TREE.hover, color: TREE.textoFraco }}
              title="Confiança da árvore nesta hipótese"
            >
              {Math.round(insight.confianca * 100)}%
            </span>
          )}
        </span>
      </button>
    </li>
  )
})

function MedidorSaude({ valor }: { valor: number }) {
  const r = 26
  const circ = 2 * Math.PI * r
  const cheio = (Math.max(0, Math.min(100, valor)) / 100) * circ
  const cor = valor >= 80 ? SUCESSO : valor >= 55 ? SEVERIDADE_COR.medio : SEVERIDADE_COR.critico
  return (
    <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Saúde da árvore: ${valor} de 100`}>
        <circle cx="32" cy="32" r={r} fill="none" stroke={TREE.grade} strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={cor}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${cheio} ${circ}`}
          transform="rotate(-90 32 32)"
          style={{ transition: `stroke-dasharray 640ms ${EASE.suave}` }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[16px] font-semibold tabular-nums"
        style={{ color: cor }}
      >
        {valor}
      </span>
    </div>
  )
}

function Barra({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px]" style={{ color: TREE.textoFraco }}>
          {rotulo}
        </span>
        <span className="text-[10.5px] font-medium tabular-nums" style={{ color: TREE.textoFraco }}>
          {valor}%
        </span>
      </div>
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full" style={{ background: TREE.hover }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, valor))}%`,
            background: valor >= 80 ? SUCESSO : valor >= 55 ? SEVERIDADE_COR.medio : SEVERIDADE_COR.critico,
            transition: `width 640ms ${EASE.suave}`,
          }}
        />
      </div>
    </div>
  )
}
