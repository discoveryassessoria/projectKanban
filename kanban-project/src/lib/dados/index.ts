// src/lib/dados/index.ts
// ============================================================================
// CAMADA OFICIAL DE DADOS DO DISCOVERY — uma definição, todas as telas.
//
// Decisão de stack: **SWR**. Não por preferência, mas porque já estava no
// projeto (`swr@2.4.1`) e já era usado em 5 telas — cada uma, porém, com o SEU
// fetcher copiado. Trocar por React Query significaria uma dependência nova e
// reescrever o que já funciona; a escolha certa era acabar com a duplicação,
// não somar uma terceira forma de buscar dados.
//
// O que esta camada resolve, e que o `useEffect(() => carregar(), [])` espalhado
// pela base não resolvia:
//   • CACHE e DEDUPLICAÇÃO — a mesma chave pedida por dois componentes vira UMA
//     requisição; navegar de volta usa o cache em vez de piscar a tela;
//   • REVALIDAÇÃO — política única (foco não revalida, reconexão sim);
//   • LOADING e ERRO — estados derivados, não três `useState` por tela;
//   • INVALIDAÇÃO — após escrever, `invalidar(prefixo)` refaz só o que depende;
//   • SESSÃO — 401 cai no encerramento único de sessão, em vez de cada tela
//     inventar seu próprio tratamento.
//
// E resolve o motivo pelo qual o React Compiler reclamava: some o
// `setState` dentro de efeito de montagem — quem guarda o estado é o cache.
// ============================================================================
"use client"

import useSWR, { mutate as mutateGlobal, type SWRConfiguration } from "swr"
import { authHeaders } from "@/src/lib/financeiro/http"
import { encerrarSessao } from "@/src/lib/sessao/cliente"

/** Erro de API com o status preservado — a tela decide o que dizer, com o fato na mão. */
export class ErroApi extends Error {
  readonly status: number
  readonly corpo: unknown
  constructor(status: number, mensagem: string, corpo?: unknown) {
    super(mensagem)
    this.name = "ErroApi"
    this.status = status
    this.corpo = corpo
  }
}

/**
 * Fetcher ÚNICO. Autentica, entende JSON, e trata 401 no lugar certo: sessão
 * inválida encerra a sessão de verdade (auditada, propagada às outras abas) em
 * vez de cada tela redirecionar do seu jeito.
 */
export async function buscar<T = unknown>(chave: string): Promise<T> {
  const res = await fetch(chave, { headers: authHeaders() })
  const corpo = await res.json().catch(() => null)

  if (res.status === 401) {
    void encerrarSessao("token_invalido")
    throw new ErroApi(401, "Sessão expirada.", corpo)
  }
  if (!res.ok) {
    const msg =
      (corpo && typeof corpo === "object" && ("error" in corpo || "erro" in corpo)
        ? String((corpo as Record<string, unknown>).error ?? (corpo as Record<string, unknown>).erro)
        : null) ?? `Falha ao carregar (HTTP ${res.status}).`
    throw new ErroApi(res.status, msg, corpo)
  }
  return corpo as T
}

/**
 * Política padrão do projeto. Escolhida para telas operacionais que ficam
 * abertas: não rebuscar a cada troca de aba do navegador (ruído e custo), mas
 * rebuscar ao reconectar. `dedupingInterval` é o que transforma N componentes
 * pedindo a mesma coisa em uma requisição só.
 */
export const POLITICA_PADRAO: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 30_000,
  errorRetryCount: 2,
  shouldRetryOnError: (e: unknown) => !(e instanceof ErroApi && e.status >= 400 && e.status < 500),
}

export interface Resultado<T> {
  dados: T | undefined
  carregando: boolean
  /** Revalidando com dados já em tela (não pisca a interface). */
  revalidando: boolean
  erro: ErroApi | undefined
  /** Refaz esta consulta. Aceita dados otimistas, como o `mutate` do SWR. */
  recarregar: (dados?: T) => Promise<T | undefined>
}

/**
 * Consulta de leitura. `chave` é a própria URL — é ela que identifica o cache,
 * então duas telas que pedem a mesma URL compartilham resultado por construção.
 * `null` desliga a consulta (ex.: ainda não há id), sem hook condicional.
 */
export function useApi<T = unknown>(chave: string | null, opcoes?: SWRConfiguration): Resultado<T> {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T, ErroApi>(
    chave,
    buscar<T>,
    { ...POLITICA_PADRAO, ...opcoes },
  )
  return {
    dados: data,
    carregando: isLoading,
    revalidando: isValidating,
    erro: error,
    recarregar: (dados?: T) => mutate(dados as T | undefined),
  }
}

/**
 * Invalida por PREFIXO de chave: `invalidar('/api/processos/42')` refaz tudo que
 * pende daquele processo. Chamar depois de escrever é o que mantém a tela
 * coerente sem cada componente recarregar a si mesmo na mão.
 */
export function invalidar(prefixo: string): Promise<unknown> {
  return mutateGlobal(
    (chave: unknown) => typeof chave === "string" && chave.startsWith(prefixo),
    undefined,
    { revalidate: true },
  )
}
