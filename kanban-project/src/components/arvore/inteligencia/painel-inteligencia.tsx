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

import { useMemo, useState } from "react"
import {
  X, AlertTriangle, TriangleAlert, Info, Target, Users, MessageCircleQuestion, ChevronDown, ChevronRight,
} from "lucide-react"
import type {
  AnaliseArvore, ChaveMedida, Insight, ItemDecomposicao, Medida, PassoSugerido, Severidade,
} from "@/src/lib/genealogia/motor/tipos"
import {
  PERGUNTAS,
  responder,
  type ChavePergunta,
  type ContextoPerguntas,
} from "@/src/lib/genealogia/operacional/perguntas"
import type { IndicadoresDaArvore } from "@/src/lib/genealogia/operacional/indicadores"
import type { RascunhoTarefa } from "@/src/lib/genealogia/operacional/tarefa-do-passo"

interface Props {
  analise: AnaliseArvore | null
  aberto: boolean
  onFechar: () => void
  /** Levar o usuário até a pessoa no canvas (não altera o layout, só navega). */
  onIrParaPessoa?: (pessoaId: number) => void
  nomeDePessoa: (pessoaId: number) => string
  /**
   * Contexto das perguntas da árvore. Ausente = a seção de perguntas não
   * aparece; ela não tem como responder sem os dossiês.
   */
  perguntas?: ContextoPerguntas | null
  /**
   * Os números da árvore (qualidade com a CONTA de cada porcentagem + divergências).
   * Vêm de `indicadores.ts` — a mesma fonte do cartão de resumo e da aba Operação;
   * o painel não recalcula nada.
   */
  indicadores?: IndicadoresDaArvore | null
  /** Abre o modal "Criar tarefa". Ausente = sem permissão `tarefas.criar` (o botão não existe). */
  onCriarTarefa?: (rascunho: RascunhoTarefa) => void
  /** Rascunho do "Criar tarefa" de um próximo passo. */
  rascunhoDoPasso?: (passo: PassoSugerido) => RascunhoTarefa | null
  /** Abre uma tarefa que já existe (Central Operacional). */
  onAbrirTarefa?: (processoId: number, tarefaId: number) => void
}

/**
 * PERGUNTAS DA ÁRVORE — cinco perguntas fixas, resposta por consulta.
 *
 * Não há campo de texto livre de propósito: campo livre promete entender
 * qualquer pergunta, e o que existe atrás é uma consulta determinística sobre os
 * dados do processo. Cinco perguntas explícitas dizem a verdade sobre o que a
 * árvore sabe responder — e cada resposta mostra de onde saiu.
 */
function SecaoPerguntas({
  ctx,
  onIrParaPessoa,
  onCriarTarefa,
  onAbrirTarefa,
}: {
  ctx: ContextoPerguntas
  onIrParaPessoa?: (id: number) => void
  onCriarTarefa?: (rascunho: RascunhoTarefa) => void
  onAbrirTarefa?: (processoId: number, tarefaId: number) => void
}) {
  const [ativa, setAtiva] = useState<ChavePergunta | null>(null)
  const resposta = useMemo(() => (ativa ? responder(ativa, ctx) : null), [ativa, ctx])

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        <MessageCircleQuestion className="h-3.5 w-3.5" /> Perguntas
      </h3>
      <div className="space-y-1.5">
        {PERGUNTAS.map((p) => {
          const aberta = ativa === p.chave
          return (
            <div key={p.chave} className="overflow-hidden rounded-lg border border-gray-100">
              <button
                onClick={() => setAtiva(aberta ? null : p.chave)}
                className={`w-full px-2.5 py-2 text-left text-[12px] transition ${
                  aberta ? "bg-gray-50 font-medium text-gray-900" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {p.texto}
              </button>
              {aberta && resposta && (
                <div className="border-t border-gray-100 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{resposta.escopo}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-gray-800">{resposta.resumo}</p>
                  {resposta.itens.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {resposta.itens.map((item, i) => (
                        <li
                          key={`${resposta.chave}-${i}`}
                          className="flex items-start justify-between gap-2 text-[11px] leading-snug"
                        >
                          {item.pessoaId != null && onIrParaPessoa ? (
                            <button
                              onClick={() => onIrParaPessoa(item.pessoaId!)}
                              className="min-w-0 text-left text-gray-600 underline decoration-gray-300 underline-offset-2 transition hover:text-gray-900"
                            >
                              {item.texto}
                            </button>
                          ) : (
                            <span className="min-w-0 text-gray-600">{item.texto}</span>
                          )}
                          {/* Documento com tarefa → abrir a que existe; sem tarefa →
                              criar pela porta canônica. Nunca os dois. */}
                          {item.tarefa && onAbrirTarefa ? (
                            <button
                              onClick={() => onAbrirTarefa(item.tarefa!.processoId, item.tarefa!.id)}
                              className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                            >
                              Abrir tarefa
                            </button>
                          ) : item.rascunho && onCriarTarefa ? (
                            <button
                              onClick={() => onCriarTarefa(item.rascunho!)}
                              data-criar-tarefa
                              className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                            >
                              Criar tarefa
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {resposta.totalItens > resposta.itens.length && (
                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                      Mostrando {resposta.itens.length} de {resposta.totalItens}.
                    </p>
                  )}
                  {/* Resposta sem fonte não é resposta: o operador precisa saber
                      onde conferir antes de agir sobre um processo. */}
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                    Fonte: {resposta.fonte}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

const CORES: Record<Severidade, { texto: string; fundo: string; borda: string }> = {
  critico: { texto: "#b42318", fundo: "#fef3f2", borda: "#fecdca" },
  alto: { texto: "#b54708", fundo: "#fffaeb", borda: "#fedf89" },
  medio: { texto: "#175cd3", fundo: "#eff8ff", borda: "#b2ddff" },
  baixo: { texto: "#475467", fundo: "#eaf5fc", borda: "#eaecf0" },
  info: { texto: "#475467", fundo: "#eaf5fc", borda: "#eaecf0" },
}

function IconeSeveridade({ s }: { s: Severidade }) {
  if (s === "critico") return <AlertTriangle className="h-4 w-4 shrink-0" />
  if (s === "alto") return <TriangleAlert className="h-4 w-4 shrink-0" />
  return <Info className="h-4 w-4 shrink-0" />
}

/**
 * Uma porcentagem COM a conta aberta. O número e a lista saem do mesmo objeto
 * (`Medida`, produzido por `motor/qualidade.ts`): não há como a lista dizer uma
 * coisa e o número outra.
 */
function MedidorExpansivel({
  medida,
  aberto,
  onAlternar,
  onAbrirMedida,
  nomeDePessoa,
  onIrParaPessoa,
}: {
  medida: Medida
  aberto: boolean
  onAlternar: () => void
  onAbrirMedida: (chave: ChaveMedida) => void
  nomeDePessoa: (id: number) => string
  onIrParaPessoa?: (id: number) => void
}) {
  const pct = Math.max(0, Math.min(100, Math.round(medida.valor)))
  const pesam = medida.itens.filter((i) => i.pesa).length
  return (
    <div data-medida={medida.chave}>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        aria-label={`${medida.rotulo}: ${pct}%. ${aberto ? "Fechar" : "Ver"} a conta`}
        className="w-full text-left"
      >
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-500">
            {aberto ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
            {medida.rotulo}
          </span>
          <span className="text-sm font-semibold tabular-nums text-gray-800">{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
          <div className="h-1.5 rounded-full bg-[#2c7be5] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </button>

      {aberto && (
        <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5" data-medida-conta={medida.chave}>
          <p className="text-[11px] leading-snug text-gray-600">{medida.formula}</p>
          <p className="mt-1 text-[11px] tabular-nums text-gray-700">
            Conta: {Math.round(medida.numerador * 100) / 100}
            {medida.denominador != null ? ` ÷ ${Math.round(medida.denominador * 100) / 100}` : ""} →{" "}
            <strong>{pct}%</strong> · {pesam} item(ns) pesando de {medida.totalItens}
          </p>
          {medida.observacao && <p className="mt-1 text-[11px] text-amber-800">{medida.observacao}</p>}
          {medida.itens.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {medida.itens.map((item) => (
                <ItemDaConta
                  key={item.chave}
                  item={item}
                  nomeDePessoa={nomeDePessoa}
                  onIrParaPessoa={onIrParaPessoa}
                  onAbrirMedida={medida.chave === "qualidade" ? onAbrirMedida : undefined}
                />
              ))}
            </ul>
          )}
          {medida.omitidos > 0 && (
            <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
              + {medida.omitidos} item(ns) de menor peso não listados (já entram na conta acima).
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ItemDaConta({
  item,
  nomeDePessoa,
  onIrParaPessoa,
  onAbrirMedida,
}: {
  item: ItemDecomposicao
  nomeDePessoa: (id: number) => string
  onIrParaPessoa?: (id: number) => void
  onAbrirMedida?: (chave: ChaveMedida) => void
}) {
  const rotulo = (
    <span className={`text-[12px] font-medium ${item.pesa ? "text-gray-800" : "text-gray-500"}`}>{item.rotulo}</span>
  )
  return (
    <li className="text-[11px] leading-snug" data-item-conta={item.chave}>
      {onAbrirMedida && item.pessoaId == null ? (
        <button type="button" onClick={() => onAbrirMedida(item.chave as ChaveMedida)} className="text-left underline decoration-gray-300 underline-offset-2">
          {rotulo}
        </button>
      ) : item.pessoaId != null && onIrParaPessoa && item.pessoaIds.length <= 1 ? (
        <button type="button" onClick={() => onIrParaPessoa(item.pessoaId!)} className="text-left underline decoration-gray-300 underline-offset-2 hover:text-gray-900">
          {rotulo}
        </button>
      ) : (
        rotulo
      )}
      <p className="text-gray-600">{item.detalhe}</p>
      {item.pessoaIds.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {item.pessoaIds.slice(0, 4).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onIrParaPessoa?.(id)}
              className="rounded-full border border-gray-200 bg-[var(--surface-primary)] px-2 py-0.5 text-[10px] text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              {nomeDePessoa(id)}
            </button>
          ))}
        </div>
      )}
    </li>
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
                  className="rounded-full border border-gray-200 bg-[var(--surface-primary)] px-2 py-0.5 text-[11px] text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
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

export function PainelInteligencia({
  analise,
  aberto,
  onFechar,
  onIrParaPessoa,
  nomeDePessoa,
  perguntas,
  indicadores,
  onCriarTarefa,
  rascunhoDoPasso,
  onAbrirTarefa,
}: Props) {
  const [medidasAbertas, setMedidasAbertas] = useState<ReadonlySet<ChaveMedida>>(new Set())
  const alternarMedida = (chave: ChaveMedida) =>
    setMedidasAbertas((atual) => {
      const novo = new Set(atual)
      if (novo.has(chave)) novo.delete(chave)
      else novo.add(chave)
      return novo
    })
  const abrirMedida = (chave: ChaveMedida) => setMedidasAbertas((atual) => new Set(atual).add(chave))

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
  const totalAchados = indicadores?.totalAchados ?? 0

  // Cor própria na raiz — ver comentário equivalente em tree-onboarding.tsx.
  return (
    <div className="fixed right-0 top-0 z-[10002] flex h-full w-[380px] flex-col border-l border-gray-200 bg-[var(--surface-primary)] text-gray-900 shadow-[var(--elev-3)]">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Inteligência da árvore</h2>
          <p className="text-[11px] text-gray-500">Análise determinística · sem enviar dados</p>
        </div>
        <button onClick={onFechar} aria-label="Fechar painel" className="rounded-md p-1.5 text-[var(--text-muted)] transition hover:bg-gray-100 hover:text-gray-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {!analise ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            Adicione pessoas à árvore para ver a análise.
          </p>
        ) : (
          <>
            <section className="space-y-3">
              {/* Cada porcentagem abre a CONTA que a produziu (clique no nome). */}
              {(["qualidade", "completude", "consistencia", "cobertura"] as const).map((chave) => {
                const medida = (indicadores?.qualidade ?? analise.qualidade.detalhe)[chave]
                return (
                  <MedidorExpansivel
                    key={chave}
                    medida={medida}
                    aberto={medidasAbertas.has(chave)}
                    onAlternar={() => alternarMedida(chave)}
                    onAbrirMedida={abrirMedida}
                    nomeDePessoa={nomeDePessoa}
                    onIrParaPessoa={onIrParaPessoa}
                  />
                )
              })}
              <p className="pt-1 text-[12px] text-gray-500">
                {q?.totalPessoas ?? 0} pessoa(s) · {analise.linhaCidadania.length} na linha de cidadania
                {analise.paisAlvo ? ` (${analise.paisAlvo.toLowerCase()})` : ""}
              </p>
              {indicadores && (
                <p className="text-[12px] text-gray-500" data-indicador-divergencias>
                  Divergências na árvore: {indicadores.divergencias.total}
                  {indicadores.divergencias.impeditivas > 0
                    ? ` (${indicadores.divergencias.impeditivas} crítica(s))`
                    : ""}
                  {indicadores.divergencias.parcial ? " · contagem limitada aos achados mais relevantes" : ""}
                </p>
              )}
            </section>

            {perguntas && (
              <SecaoPerguntas
                ctx={perguntas}
                onIrParaPessoa={onIrParaPessoa}
                onCriarTarefa={onCriarTarefa}
                onAbrirTarefa={onAbrirTarefa}
              />
            )}

            {analise.proximosPassos.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <Target className="h-3.5 w-3.5" /> Próximos passos
                </h3>
                <ol className="space-y-1.5">
                  {analise.proximosPassos.slice(0, 5).map((passo, i) => {
                    const rascunho = onCriarTarefa && rascunhoDoPasso ? rascunhoDoPasso(passo) : null
                    const pessoaId = passo.pessoaIds[0] ?? null
                    return (
                      <li key={passo.id} data-proximo-passo={passo.id} className="flex gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-[12px] text-gray-700">
                        <span className="font-semibold text-[var(--text-muted)]">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          {passo.titulo}
                          {/* O motor também diz POR QUE o passo importa — é o que
                              transforma uma lista de tarefas em prioridade. */}
                          <span className="block text-[11px] text-gray-500">{passo.motivo}</span>
                          {(pessoaId != null && onIrParaPessoa) || rascunho ? (
                            <span className="mt-1.5 flex flex-wrap gap-1.5">
                              {pessoaId != null && onIrParaPessoa && (
                                <button
                                  type="button"
                                  onClick={() => onIrParaPessoa(pessoaId)}
                                  className="rounded border border-gray-200 bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                                >
                                  Ver no mapa
                                </button>
                              )}
                              {rascunho && (
                                <button
                                  type="button"
                                  data-criar-tarefa
                                  onClick={() => onCriarTarefa!(rascunho)}
                                  className="rounded bg-[var(--action-primary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)]"
                                >
                                  Criar tarefa
                                </button>
                              )}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    )
                  })}
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
                <p className="mb-2 rounded-md bg-[var(--surface-secondary)] px-2.5 py-1.5 text-[11px] text-amber-800">
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
                  <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
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
