"use client"

// src/components/arvore/inteligencia/painel-inteligencia.tsx
// ============================================================================
// PAINEL DE INTELIGÊNCIA — tela NOVA, sobreposta; o desenho da árvore não muda.
//
// Mostra o que o motor genealógico apurou: qualidade da árvore, achados
// priorizados (conflitos, duplicidades, lacunas), gargalos da linha de
// cidadania e os próximos passos sugeridos.
//
// Duas decisões que valem registro:
//
// 1. O painel é um DRAWER lateral por cima do canvas, com o mesmo `position:
//    fixed` dos controles que já existiam. Ele não entra no fluxo do canvas,
//    então abrir e fechar não reposiciona um único card da árvore.
//
// 2. Quando o motor TRUNCA os achados (numa árvore grande as regras produzem
//    milhares), o painel diz isso em voz alta. Mostrar 20 de 3.000 sem avisar é
//    fingir cobertura completa — e é assim que um conflito real passa batido.
// ============================================================================

import { useMemo } from "react"
import { X, AlertTriangle, TriangleAlert, Info, Target, Users } from "lucide-react"
import type { AnaliseArvore, Insight, Severidade } from "@/src/lib/genealogia/motor/tipos"

interface Props {
  analise: AnaliseArvore | null
  aberto: boolean
  onFechar: () => void
  /** Levar o usuário até a pessoa no canvas (não altera o layout, só navega). */
  onIrParaPessoa?: (pessoaId: number) => void
  nomeDePessoa: (pessoaId: number) => string
}

const CORES: Record<Severidade, { texto: string; fundo: string; borda: string }> = {
  critico: { texto: "#b42318", fundo: "#fef3f2", borda: "#fecdca" },
  alto: { texto: "#b54708", fundo: "#fffaeb", borda: "#fedf89" },
  medio: { texto: "#175cd3", fundo: "#eff8ff", borda: "#b2ddff" },
  baixo: { texto: "#475467", fundo: "#f9fafb", borda: "#eaecf0" },
  info: { texto: "#475467", fundo: "#f9fafb", borda: "#eaecf0" },
}

function IconeSeveridade({ s }: { s: Severidade }) {
  if (s === "critico") return <AlertTriangle className="h-4 w-4 shrink-0" />
  if (s === "alto") return <TriangleAlert className="h-4 w-4 shrink-0" />
  return <Info className="h-4 w-4 shrink-0" />
}

function Medidor({ rotulo, valor }: { rotulo: string; valor: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(valor)))
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">{rotulo}</span>
        <span className="text-sm font-semibold tabular-nums text-gray-800">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
        <div className="h-1.5 rounded-full bg-[#2c7be5] transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function CartaoInsight({
  insight, nomeDePessoa, onIrParaPessoa,
}: { insight: Insight; nomeDePessoa: (id: number) => string; onIrParaPessoa?: (id: number) => void }) {
  const cor = CORES[insight.severidade]
  const envolvidos = insight.pessoaIds.slice(0, 3)
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: cor.borda, backgroundColor: cor.fundo }}>
      <div className="flex items-start gap-2" style={{ color: cor.texto }}>
        <IconeSeveridade s={insight.severidade} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{insight.titulo}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600">{insight.explicacao}</p>
          {insight.acao && (
            <p className="mt-1.5 text-[12px] font-medium text-gray-700">→ {insight.acao}</p>
          )}
          {envolvidos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {envolvidos.map((id) => (
                <button
                  key={id}
                  onClick={() => onIrParaPessoa?.(id)}
                  className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  {nomeDePessoa(id)}
                </button>
              ))}
              {insight.pessoaIds.length > envolvidos.length && (
                <span className="px-1 py-0.5 text-[11px] text-gray-500">
                  +{insight.pessoaIds.length - envolvidos.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function PainelInteligencia({ analise, aberto, onFechar, onIrParaPessoa, nomeDePessoa }: Props) {
  // Agrupa por severidade preservando a ordem que o motor já priorizou.
  const porSeveridade = useMemo(() => {
    const grupos = new Map<Severidade, Insight[]>()
    for (const i of analise?.insights ?? []) {
      const lista = grupos.get(i.severidade) ?? []
      lista.push(i)
      grupos.set(i.severidade, lista)
    }
    return grupos
  }, [analise])

  if (!aberto) return null

  const q = analise?.qualidade
  const totalAchados = analise ? Object.values(analise.totais).reduce((s, n) => s + n, 0) : 0

  return (
    <div className="fixed right-0 top-0 z-[10002] flex h-full w-[380px] flex-col border-l border-gray-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Inteligência da árvore</h2>
          <p className="text-[11px] text-gray-500">Análise determinística · sem enviar dados</p>
        </div>
        <button onClick={onFechar} aria-label="Fechar painel" className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {!analise ? (
          <p className="py-10 text-center text-sm text-gray-400">
            Adicione pessoas à árvore para ver a análise.
          </p>
        ) : (
          <>
            <section className="space-y-3">
              <Medidor rotulo="Qualidade geral" valor={q?.score ?? 0} />
              <Medidor rotulo="Completude" valor={q?.completude ?? 0} />
              <Medidor rotulo="Consistência" valor={q?.consistencia ?? 0} />
              <Medidor rotulo="Cobertura da linha" valor={q?.coberturaLinha ?? 0} />
              <p className="pt-1 text-[12px] text-gray-500">
                {q?.totalPessoas ?? 0} pessoa(s) · {analise.linhaCidadania.length} na linha de cidadania
                {analise.paisAlvo ? ` (${analise.paisAlvo.toLowerCase()})` : ""}
              </p>
            </section>

            {analise.proximosPassos.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <Target className="h-3.5 w-3.5" /> Próximos passos
                </h3>
                <ol className="space-y-1.5">
                  {analise.proximosPassos.slice(0, 5).map((passo, i) => (
                    <li key={passo.id} className="flex gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-[12px] text-gray-700">
                      <span className="font-semibold text-gray-400">{i + 1}</span>
                      <span className="min-w-0">
                        {passo.titulo}
                        {/* O motor também diz POR QUE o passo importa — é o que
                            transforma uma lista de tarefas em prioridade. */}
                        <span className="block text-[11px] text-gray-500">{passo.motivo}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {analise.gargalos.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <Users className="h-3.5 w-3.5" /> Gargalos da linha
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {analise.gargalos.slice(0, 6).map((id) => (
                    <button
                      key={id}
                      onClick={() => onIrParaPessoa?.(id)}
                      className="rounded-full border border-gray-200 px-2.5 py-1 text-[12px] text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                    >
                      {nomeDePessoa(id)}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Achados ({analise.insights.length}
                {analise.truncado ? ` de ${totalAchados}` : ""})
              </h3>
              {analise.truncado && (
                // Honestidade sobre cobertura: a lista foi cortada por relevância.
                <p className="mb-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                  Mostrando os mais relevantes. Resolva os primeiros para os demais aparecerem.
                </p>
              )}
              <div className="space-y-2">
                {(["critico", "alto", "medio", "baixo", "info"] as Severidade[]).flatMap((s) =>
                  (porSeveridade.get(s) ?? []).map((insight) => (
                    <CartaoInsight
                      key={insight.id}
                      insight={insight}
                      nomeDePessoa={nomeDePessoa}
                      onIrParaPessoa={onIrParaPessoa}
                    />
                  )),
                )}
                {analise.insights.length === 0 && (
                  <p className="py-6 text-center text-[13px] text-gray-400">
                    Nenhum problema encontrado nesta árvore.
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
