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

import { useCallback, useMemo } from 'react'
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
  // ESTABILIDADE REFERENCIAL — não é otimização, é correção.
  //
  // Devolver um objeto (e uma `recarregar`) novos a cada render fazia qualquer
  // `useCallback`/`useEffect` que dependesse do resultado disparar em TODO render.
  // Uma tela com `useEffect(() => carregar(), [carregar])` entrava em revalidação
  // infinita: mutate → render → nova identidade → mutate. O spinner nunca
  // terminava porque a consulta nunca estabilizava.
  //
  // `mutate` do SWR já é estável por chave; o que faltava era não embrulhá-lo numa
  // função nova toda vez.
  const recarregar = useCallback((dados?: T) => mutate(dados as T | undefined), [mutate])
  return useMemo(
    () => ({ dados: data, carregando: isLoading, revalidando: isValidating, erro: error, recarregar }),
    [data, isLoading, isValidating, error, recarregar],
  )
}

/**
 * Consulta de leitura cuja LEITURA não é um GET simples numa URL.
 *
 * Existe porque três formas legítimas de ler não cabem em `useApi`, e sem um lugar
 * oficial cada tela voltaria a inventar o seu fetcher — a duplicação que esta camada
 * existe para acabar:
 *
 *   • leitura COMPOSTA — uma lista e, para cada item, um complemento (protocolos e
 *     os seus anexos), que só faz sentido em tela como um resultado único;
 *   • leitura por POST — cálculo no servidor que recebe parâmetros no corpo
 *     (prévias, simulações), sem efeito colateral;
 *   • leitura através de um SERVIÇO já existente, que não vale reescrever.
 *
 * O que NÃO muda: é o mesmo SWR, a mesma política, o mesmo cache. A `chave`
 * continua sendo a identidade do resultado — precisa conter TODO parâmetro que
 * muda a resposta, senão duas consultas diferentes compartilham cache.
 *
 * Se a leitura é um GET numa URL, use `useApi`. Esta função não é a porta larga.
 */
export function useConsulta<T = unknown>(
  chave: string | null,
  ler: () => Promise<T>,
  opcoes?: SWRConfiguration,
): Resultado<T> {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T, ErroApi>(
    chave,
    // A chave identifica; quem sabe ler é o chamador. Ignorar o argumento aqui é
    // deliberado — a chave já está fechada dentro de `ler`.
    () => ler(),
    { ...POLITICA_PADRAO, ...opcoes },
  )
  // Mesma estabilidade referencial de `useApi` — ver a explicação lá.
  const recarregar = useCallback((dados?: T) => mutate(dados as T | undefined), [mutate])
  return useMemo(
    () => ({ dados: data, carregando: isLoading, revalidando: isValidating, erro: error, recarregar }),
    [data, isLoading, isValidating, error, recarregar],
  )
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

/**
 * ESCRITA (POST/PUT/PATCH/DELETE). Existe aqui porque a base tinha 24 cópias do
 * mesmo `jsonFetch` local — cada tela reimplementando autenticação, parse e
 * tratamento de erro. Mesma semântica das cópias que substitui: corpo em JSON,
 * token do usuário, e erro com a mensagem que o servidor mandou.
 *
 * Não invalida nada sozinho: quem escreve sabe o que ficou obsoleto, então
 * chama `invalidar(prefixo)` (ou o `recarregar()` da própria consulta) logo
 * depois. Invalidação implícita esconde dependência.
 */
export async function enviar<T = unknown>(
  chave: string,
  opcoes: { metodo?: "POST" | "PUT" | "PATCH" | "DELETE"; corpo?: unknown } = {},
): Promise<T> {
  const { metodo = "POST", corpo } = opcoes
  const res = await fetch(chave, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const dados = await res.json().catch(() => null)

  if (res.status === 401) {
    void encerrarSessao("token_invalido")
    throw new ErroApi(401, "Sessão expirada.", dados)
  }
  if (!res.ok) {
    const msg =
      (dados && typeof dados === "object" && ("error" in dados || "erro" in dados)
        ? String((dados as Record<string, unknown>).error ?? (dados as Record<string, unknown>).erro)
        : null) ?? `Erro ${res.status}`
    throw new ErroApi(res.status, msg, dados)
  }
  return dados as T
}
