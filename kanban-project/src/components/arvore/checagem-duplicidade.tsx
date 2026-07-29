// src/components/arvore/checagem-duplicidade.tsx
//
// CHECAGEM OBRIGATÓRIA NO CADASTRO MESTRE, antes de criar Pessoa.
//
// Por que existe: `POST /api/pessoas` cria sem deduplicar. O serviço oficial de
// criação-com-dedup (e o de fusão) ainda não existem no Cadastro Mestre — são
// decisão de arquitetura pendente. Enquanto isso, a árvore não pode continuar
// despejando Pessoa nova a cada clique: é assim que nasce a duplicidade que
// depois ninguém consegue desfazer, porque não há fusão.
//
// A solução aqui NÃO é um serviço paralelo (isso a Constituição proíbe): é
// deduplicação com humano no circuito. O operador é obrigado a procurar, ver os
// candidatos e declarar explicitamente que nenhum serve. Só então a criação
// destrava. A limitação fica VISÍVEL na tela — não mascarada.

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Check, Loader2, Search, UserCheck } from "lucide-react"
import { similaridadeNome, anoDe } from "@/src/lib/genealogia/motor/texto"

export interface CandidatoPessoa {
  id: number
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  data_nasc?: string | null
  data_obito?: string | null
  local_nasc?: string | null
  pais_nasc?: string | null
  arvoreId?: number | null
  pai?: { id: number; nome: string; sobrenome?: string | null } | null
  mae?: { id: number; nome: string; sobrenome?: string | null } | null
}

export interface ChecagemDuplicidadeProps {
  nome: string
  sobrenome: string
  dataNasc?: string
  /** Ids já presentes nesta árvore — não são candidatos a "vincular". */
  idsNaArvore: Set<number>
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  /** Operador escolheu uma pessoa existente: vincular em vez de criar. */
  aoVincular: (candidato: CandidatoPessoa) => void
  /** Operador declarou que nenhum candidato serve — libera a criação. */
  aoLiberarCriacao: (liberado: boolean, decisaoDedupId: number | null) => void
  liberado: boolean
}

function rotulo(c: CandidatoPessoa): string {
  return c.sobrenome ? `${c.nome} ${c.sobrenome}` : c.nome
}

function anos(c: CandidatoPessoa): string {
  const n = anoDe(c.data_nasc)
  const o = anoDe(c.data_obito)
  if (n && o) return `${n}–${o}`
  if (n) return String(n)
  if (o) return `† ${o}`
  return "sem datas"
}

export function ChecagemDuplicidade({
  nome,
  sobrenome,
  dataNasc,
  idsNaArvore,
  authFetch,
  aoVincular,
  aoLiberarCriacao,
  liberado,
}: ChecagemDuplicidadeProps) {
  const [candidatos, setCandidatos] = useState<CandidatoPessoa[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [nivel, setNivel] = useState<string>("LIVRE")
  const [registrando, setRegistrando] = useState(false)
  const termo = `${nome} ${sobrenome}`.trim()
  const podeBuscar = nome.trim().length >= 2

  // Trocar o nome invalida a checagem: a liberação valia para AQUELE nome.
  useEffect(() => {
    setCandidatos(null)
    setNivel("LIVRE")
    aoLiberarCriacao(false, null)
  }, [nome, sobrenome, aoLiberarCriacao])

  const buscar = useCallback(async () => {
    if (!podeBuscar) return
    setBuscando(true)
    setErro(null)
    try {
      // Triagem OFICIAL: o servidor decide o nível e devolve os candidatos com
      // evidência. A tela não pontua nada por conta própria — se pontuasse,
      // haveria dois algoritmos de similaridade e dois veredictos possíveis.
      const r = await authFetch("/api/pessoas/triagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), sobrenome, dataNascimento: dataNasc }),
      })
      if (!r.ok) throw new Error(`Falha ${r.status}`)
      const dados = await r.json()
      setNivel(dados?.nivel ?? "LIVRE")
      const lista = Array.isArray(dados?.candidatos)
        ? dados.candidatos.map((c: { pessoa: CandidatoPessoa | null; score: number }) => ({
            ...(c.pessoa ?? {}),
            _score: c.score,
          }))
        : []
      setCandidatos(lista.filter((c: CandidatoPessoa) => !!c?.id))
    } catch (e) {
      setErro("Não foi possível consultar o Cadastro Mestre. Tente novamente.")
      setCandidatos(null)
      console.error("Checagem de duplicidade:", e)
    } finally {
      setBuscando(false)
    }
  }, [authFetch, nome, podeBuscar])

  // Ordena por semelhança real com o que está sendo digitado, não por ordem de
  // banco — o candidato certo precisa aparecer primeiro.
  const ordenados = useMemo(() => {
    if (!candidatos) return []
    const anoAlvo = anoDe(dataNasc)
    return candidatos
      .map((c) => {
        let score = similaridadeNome(termo, rotulo(c))
        const anoC = anoDe(c.data_nasc)
        if (anoAlvo && anoC) score += Math.abs(anoAlvo - anoC) <= 2 ? 0.25 : -0.2
        return { c, score }
      })
      .filter((x) => x.score > 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [candidatos, termo, dataNasc])

  const jaBuscou = candidatos !== null

  return (
    <section className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-900">
            Checagem obrigatória no Cadastro Mestre
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
            O Discovery ainda não tem serviço oficial de criação com deduplicação nem de fusão de
            Pessoa. Enquanto isso, a conferência é feita aqui: procure antes de criar. Se a pessoa
            já existe, vincule — criar de novo gera uma duplicidade que hoje não há como desfazer.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={buscar}
              disabled={!podeBuscar || buscando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {buscando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {jaBuscou ? "Procurar de novo" : "Procurar no Cadastro Mestre"}
            </button>
            {!podeBuscar && (
              <span className="text-xs text-amber-700">Digite o nome para poder procurar.</span>
            )}
          </div>

          {erro && (
            <p role="alert" className="mt-2 text-xs font-medium text-red-700">
              {erro}
            </p>
          )}

          {jaBuscou && !erro && (
            <div className="mt-3">
              {ordenados.length === 0 ? (
                <p className="text-xs text-amber-800">
                  Nenhuma pessoa parecida encontrada para <strong>{termo}</strong>.
                </p>
              ) : (
                <>
                  <p className="mb-1.5 text-xs font-medium text-amber-900">
                    {ordenados.length} pessoa(s) parecida(s) já no Cadastro Mestre:
                  </p>
                  <ul className="space-y-1">
                    {ordenados.map(({ c, score }) => {
                      const naArvore = idsNaArvore.has(c.id)
                      return (
                        <li key={c.id}>
                          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-2.5 py-1.5">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-gray-900">
                                {rotulo(c)}
                              </span>
                              <span className="block truncate text-[11px] text-gray-500">
                                {anos(c)}
                                {c.local_nasc ? ` · ${c.local_nasc}` : ""}
                                {c.pai || c.mae
                                  ? ` · filho(a) de ${[c.pai?.nome, c.mae?.nome].filter(Boolean).join(" e ")}`
                                  : ""}
                              </span>
                            </span>
                            <span
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-800"
                              style={{ background: "rgba(217,119,6,0.14)" }}
                              title="Semelhança com o que está sendo digitado"
                            >
                              {Math.round(Math.min(1, score) * 100)}%
                            </span>
                            <button
                              type="button"
                              onClick={() => aoVincular(c)}
                              disabled={naArvore}
                              className="shrink-0 rounded-md bg-teal-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                              title={naArvore ? "Já está nesta árvore" : "Usar esta pessoa em vez de criar outra"}
                            >
                              {naArvore ? "Já na árvore" : "É esta"}
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}

              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-amber-300 bg-white p-2.5">
                <input
                  type="checkbox"
                  checked={liberado}
                  disabled={registrando || nivel === "BLOQUEIO"}
                  onChange={async (e) => {
                    if (!e.target.checked) {
                      aoLiberarCriacao(false, null)
                      return
                    }
                    // A liberação é REGISTRADA no servidor: sem
                    // `decisaoDedupId` a criação não passa da API.
                    setRegistrando(true)
                    try {
                      const r = await authFetch("/api/pessoas/triagem", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          nome: nome.trim(),
                          sobrenome,
                          dataNascimento: dataNasc,
                          decisao: "CRIOU_NOVA",
                          justificativa: `Conferido no Cadastro Mestre: nenhum dos ${ordenados.length} candidato(s) corresponde a ${termo}.`,
                        }),
                      })
                      const d = await r.json()
                      if (!r.ok) {
                        setErro(d?.error || "Não foi possível registrar a decisão.")
                        aoLiberarCriacao(false, null)
                        return
                      }
                      aoLiberarCriacao(true, d.decisaoDedupId ?? null)
                    } catch {
                      setErro("Falha ao registrar a decisão no Cadastro Mestre.")
                      aoLiberarCriacao(false, null)
                    } finally {
                      setRegistrando(false)
                    }
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-xs leading-snug text-gray-700">
                  <strong className="text-gray-900">Conferi e nenhuma das pessoas acima é esta.</strong>{" "}
                  Criar uma Pessoa nova no Cadastro Mestre.
                </span>
              </label>
            </div>
          )}

          {nivel === "BLOQUEIO" && (
            <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
              Já existe Pessoa com este documento. Vincule a existente — criar outra geraria
              duplicidade permanente.
            </p>
          )}

          {liberado && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-teal-700">
              <Check className="h-3.5 w-3.5" />
              Criação liberada para <strong>{termo}</strong>.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/** Selo usado no botão de salvar quando a checagem ainda não foi feita. */
export function AvisoChecagemPendente() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
      <UserCheck className="h-3.5 w-3.5" />
      Faça a checagem no Cadastro Mestre para liberar a criação.
    </span>
  )
}
