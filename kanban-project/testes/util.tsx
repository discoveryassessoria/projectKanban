// testes/util.tsx
// ============================================================================
// Utilitários dos testes de componente — uma definição, todos os testes.
//
// `renderizar` embrulha o componente no que a aplicação real fornece (cache SWR
// isolado por teste) e devolve o `user` do user-event já configurado. Sem o
// cache isolado, um teste veria os dados que outro deixou no cache global — e
// passaria por engano.
//
// `servidorFalso` intercepta `fetch` por rota, com asserção de que a rota
// esperada foi realmente chamada. É o que permite provar revalidação: contar
// quantas vezes a lista foi buscada antes e depois de criar/excluir.
// ============================================================================
import type { ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { vi } from 'vitest'

/** Provider que a aplicação usa, com cache NOVO por teste. */
function Envolver({ children }: { children: React.ReactNode }) {
  // `provider: () => new Map()` dá a cada teste um cache limpo; `dedupingInterval: 0`
  // faz a revalidação acontecer na hora, sem a janela de dedupe da produção
  // atrapalhar a asserção.
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  )
}

export function renderizar(ui: ReactElement, opcoes?: Omit<RenderOptions, 'wrapper'>) {
  return {
    user: userEvent.setup(),
    ...render(ui, { wrapper: Envolver, ...opcoes }),
  }
}

export interface Rota {
  /** Casa com a URL por `includes` — basta o trecho identificador. */
  quando: string
  /** Método; omitido = qualquer. */
  metodo?: string
  /** Corpo da resposta (será serializado). */
  responde: unknown
  /** Status HTTP; padrão 200. */
  status?: number
}

export interface ServidorFalso {
  /** Quantas vezes uma rota foi chamada (por trecho da URL). */
  chamadas: (trecho: string, metodo?: string) => number
  /** Todas as chamadas registradas, em ordem. */
  historico: { url: string; metodo: string }[]
  /** Troca a resposta de uma rota em tempo de execução (ex.: após um POST). */
  responder: (trecho: string, corpo: unknown, status?: number) => void
}

/**
 * Instala um `fetch` falso baseado em rotas. A última rota declarada para o
 * mesmo trecho vence, e `responder()` permite mudar a resposta no meio do teste
 * — que é como se prova que a lista foi REBUSCADA depois de uma escrita.
 */
export function servidorFalso(rotas: Rota[]): ServidorFalso {
  const tabela = [...rotas]
  const historico: { url: string; metodo: string }[] = []

  const buscar = vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.toString() : String(entrada)
    const metodo = (init?.method ?? 'GET').toUpperCase()
    historico.push({ url, metodo })

    // Última declaração compatível vence: permite sobrescrever no meio do teste.
    const rota = [...tabela].reverse().find(
      (r) => url.includes(r.quando) && (!r.metodo || r.metodo.toUpperCase() === metodo),
    )
    const status = rota?.status ?? (rota ? 200 : 404)
    const corpo = rota ? rota.responde : { error: `rota não mapeada no teste: ${metodo} ${url}` }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
      text: async () => JSON.stringify(corpo),
      headers: new Headers(),
    } as unknown as Response
  })

  vi.stubGlobal('fetch', buscar)

  return {
    historico,
    chamadas: (trecho, metodo) =>
      historico.filter((h) => h.url.includes(trecho) && (!metodo || h.metodo === metodo.toUpperCase())).length,
    responder: (trecho, corpo, status = 200) => tabela.push({ quando: trecho, responde: corpo, status }),
  }
}

/** Token de sessão presente — a camada de dados manda `Authorization`. */
export function comSessao(token = 'token-de-teste'): void {
  localStorage.setItem('authToken', token)
}
