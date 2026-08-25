"use client"

// src/components/arvore/inteligencia/preview-impacto.tsx
// ============================================================================
// PREVIEW DE IMPACTO — o que esta alteração vai provocar, antes de provocar.
//
// A tela é fina de propósito: quem calcula é o servidor, rodando o
// materializador OFICIAL dentro de uma transação revertida (ver
// `services/genealogia/simular-impacto.ts`). Aqui só se mostra o delta.
//
// DUAS COISAS QUE ESTA TELA NUNCA FAZ:
//
//   1. Não estima. Todo número vem do delta calculado pelo motor. Quando o
//      motor não tem como responder (nenhuma Regra Documental publicada, item
//      sem vínculo no Cadastro Mestre), a tela mostra a PENDÊNCIA que ele
//      relatou em vez de exibir um zero tranquilizador.
//
//   2. Não bloqueia por precaução. Se a simulação falhar, o usuário pode salvar
//      assim mesmo — com o aviso de que o impacto não pôde ser previsto.
//      Transformar uma falha de preview em impedimento de trabalho seria
//      trocar um problema de informação por um problema de operação.
// ============================================================================

import { useEffect, useState } from "react"
import { AlertTriangle, ArrowDown, Loader2, X } from "lucide-react"
import {
  compararEstados,
  semDiferenca,
  type EstadoAtual,
  type LinhaComparacao,
} from "@/src/lib/genealogia/operacional/comparacao"

function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

interface ItemDocumental {
  necessidadeId: number
  pessoaNome: string | null
  documento: string
  obrigatoriedade: string
}

interface Resultado {
  documental: {
    adicionados: ItemDocumental[]
    dispensados: ItemDocumental[]
    reativados: ItemDocumental[]
    inalterados: number
  }
  operacional: {
    passosAdicionados: number
    tarefasPrevistas: number
    bloqueiosAdicionados: number
    bloqueiosRemovidos: number
  }
  financeiro: { visivel: boolean; recalculoPrevisto: boolean; observacao: string }
  pendencias: string[]
  semImpacto: boolean
}

/** Uma linha de "de → para", já em linguagem de operador. */
export interface AlteracaoDescrita {
  campo: string
  de: string
  para: string
}

export interface PropostaImpacto {
  processoId: number
  pessoaId: number
  mudancas?: Record<string, unknown>
  uniao?: { acao: "criar" | "remover"; conjugeId?: number; uniaoId?: number }
  alteracoes: AlteracaoDescrita[]
  /** Requerentes afetados, calculados no cliente pelo motor puro de linhagem. */
  requerentesAfetados?: string[]
  /** Estado de hoje, para montar a coluna ANTES. */
  estadoAtual?: EstadoAtual
}

interface Props {
  proposta: PropostaImpacto
  onCancelar: () => void
  onConfirmar: () => void
}

export function PreviewImpactoModal({ proposta, onCancelar, onConfirmar }: Props) {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    const buscar = async () => {
      setCarregando(true)
      setErro(null)
      try {
        const r = await authFetch(
          `/api/processos/${proposta.processoId}/genealogia/simular-impacto`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pessoaId: proposta.pessoaId,
              mudancas: proposta.mudancas ?? {},
              uniao: proposta.uniao,
            }),
          },
        )
        if (!vivo) return
        if (!r.ok) {
          const corpo = await r.json().catch(() => ({}))
          setErro(corpo.error || "Não foi possível prever o impacto desta alteração.")
          return
        }
        setResultado(await r.json())
      } catch {
        if (vivo) setErro("Não foi possível prever o impacto desta alteração.")
      } finally {
        if (vivo) setCarregando(false)
      }
    }
    buscar()
    return () => {
      vivo = false
    }
  }, [proposta])

  const doc = resultado?.documental
  const op = resultado?.operacional

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-[var(--overlay-modal)] p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-200 bg-[var(--surface-primary)] text-gray-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Impacto previsto</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Simulação somente leitura — nada foi gravado ainda
            </p>
          </div>
          <button
            onClick={onCancelar}
            aria-label="Cancelar"
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Alteração
            </h3>
            <ul className="space-y-1">
              {proposta.alteracoes.map((a) => (
                <li key={a.campo} className="text-[13px] text-gray-800">
                  <span className="text-gray-500">{a.campo}: </span>
                  {a.de} <span className="text-gray-400">→</span>{" "}
                  <span className="font-medium">{a.para}</span>
                </li>
              ))}
            </ul>
          </section>

          {carregando && (
            <div className="flex items-center gap-2 py-6 text-[13px] text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculando o impacto com o motor documental oficial…
            </div>
          )}

          {erro && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-start gap-2 text-[13px] text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {erro}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-amber-800">
                A alteração ainda pode ser salva. O motor documental é executado normalmente no
                save — o que faltou foi apenas a previsão.
              </p>
            </div>
          )}

          {resultado && !carregando && (
            <>
              {proposta.estadoAtual && !resultado.semImpacto && (
                <AntesDepois
                  linhas={compararEstados(proposta.estadoAtual, {
                    documentosAdicionados: doc!.adicionados.length,
                    documentosDispensados: doc!.dispensados.length,
                    bloqueiosAdicionados: op!.bloqueiosAdicionados,
                    bloqueiosRemovidos: op!.bloqueiosRemovidos,
                    passosAdicionados: op!.passosAdicionados,
                    linhagensAfetadas: proposta.requerentesAfetados ?? [],
                    transmissorAlterado: false,
                  })}
                />
              )}

              {resultado.semImpacto ? (
                <p className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-[13px] text-gray-700">
                  Esta alteração não produz impacto operacional conhecido.
                </p>
              ) : (
                <section className="space-y-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Impacto previsto
                  </h3>

                  {doc!.adicionados.length > 0 && (
                    <Bloco titulo="Documentos que passam a ser exigidos">
                      {doc!.adicionados.map((d) => (
                        <li key={d.necessidadeId} className="text-[13px] text-gray-800">
                          + {d.documento}
                          {d.pessoaNome ? (
                            <span className="text-gray-500"> — {d.pessoaNome}</span>
                          ) : null}
                          {d.obrigatoriedade === "OPCIONAL" && (
                            <span className="text-gray-400"> (opcional)</span>
                          )}
                        </li>
                      ))}
                    </Bloco>
                  )}

                  {doc!.reativados.length > 0 && (
                    <Bloco titulo="Exigências que voltam a valer">
                      {doc!.reativados.map((d) => (
                        <li key={d.necessidadeId} className="text-[13px] text-gray-800">
                          ↺ {d.documento}
                          {d.pessoaNome ? (
                            <span className="text-gray-500"> — {d.pessoaNome}</span>
                          ) : null}
                        </li>
                      ))}
                    </Bloco>
                  )}

                  {doc!.dispensados.length > 0 && (
                    <Bloco titulo="Exigências que deixam de ser aplicáveis">
                      {doc!.dispensados.map((d) => (
                        <li key={d.necessidadeId} className="text-[13px] text-gray-800">
                          − {d.documento}
                          {d.pessoaNome ? (
                            <span className="text-gray-500"> — {d.pessoaNome}</span>
                          ) : null}
                        </li>
                      ))}
                      {/* Distinção que o operador precisa ver: dispensar é
                          reversível e só alcança o que ainda não começou. */}
                      <li className="mt-1 text-[11px] leading-snug text-gray-500">
                        São DISPENSADAS (reversível), não apagadas. O que já estava em andamento
                        preserva o histórico e não é tocado.
                      </li>
                    </Bloco>
                  )}

                  <Bloco titulo="Operacional">
                    <li className="text-[13px] text-gray-800">
                      Passos de workflow: {sinal(op!.passosAdicionados)}
                    </li>
                    <li className="text-[13px] text-gray-800">
                      Tarefas previstas: {sinal(op!.tarefasPrevistas)}
                    </li>
                    {op!.bloqueiosAdicionados > 0 && (
                      <li className="text-[13px] text-red-700">
                        Bloqueios: +{op!.bloqueiosAdicionados}
                      </li>
                    )}
                    {op!.bloqueiosRemovidos > 0 && (
                      <li className="text-[13px] text-emerald-700">
                        Bloqueios resolvidos: −{op!.bloqueiosRemovidos}
                      </li>
                    )}
                  </Bloco>

                  {proposta.requerentesAfetados && proposta.requerentesAfetados.length > 0 && (
                    <Bloco titulo="Linhagens afetadas">
                      <li className="text-[13px] text-gray-800">
                        {proposta.requerentesAfetados.join(", ")}
                      </li>
                    </Bloco>
                  )}

                  <Bloco titulo="Financeiro">
                    <li className="text-[13px] text-gray-700">
                      {resultado.financeiro.observacao}
                    </li>
                  </Bloco>
                </section>
              )}

              {resultado.pendencias.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                    O motor não conseguiu avaliar tudo
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {resultado.pendencias.slice(0, 6).map((p, i) => (
                      <li key={i} className="text-[11px] leading-snug text-amber-900">
                        · {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onCancelar}
            className="rounded-lg border border-gray-200 bg-[var(--surface-primary)] px-3 py-2 text-[13px] text-gray-700 transition hover:border-gray-300 hover:text-gray-900"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={carregando}
            className="rounded-lg bg-slate-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            Confirmar alteração
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * ANTES × DEPOIS.
 *
 * Verde = melhora, vermelho = novo impacto, cinza = sem alteração. A cor vem da
 * `direcao` que o motor declarou por linha — não do sinal do número: mais
 * documento concluído é bom, mais bloqueio é ruim, e um comparador ingênuo
 * pintaria os dois igual.
 */
const COR_DIRECAO: Record<LinhaComparacao["direcao"], string> = {
  melhora: "text-emerald-700",
  piora: "text-red-700",
  igual: "text-gray-500",
}

function AntesDepois({ linhas }: { linhas: LinhaComparacao[] }) {
  if (semDiferenca(linhas)) return null
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Como fica
      </h3>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 border-b border-gray-100 bg-gray-50 px-2.5 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Antes</span>
          <ArrowDown aria-hidden className="h-3 w-3 -rotate-90 text-gray-300" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Depois</span>
        </div>
        <ul className="divide-y divide-gray-100">
          {linhas.map((l) => (
            <li key={l.rotulo} className="px-2.5 py-1.5" title={l.dica}>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">{l.rotulo}</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2">
                <span className="truncate text-[12px] text-gray-600">{l.antes}</span>
                <span aria-hidden className="text-[11px] text-gray-300">→</span>
                <span className={`truncate text-[12px] font-medium ${COR_DIRECAO[l.direcao]}`}>
                  {l.depois}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
      <p className="text-[11px] font-semibold text-gray-600">{titulo}</p>
      <ul className="mt-1 space-y-0.5">{children}</ul>
    </div>
  )
}

function sinal(n: number): string {
  return n > 0 ? `+${n}` : "nenhum"
}
