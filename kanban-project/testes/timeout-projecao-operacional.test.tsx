// testes/timeout-projecao-operacional.test.tsx
// ============================================================================
// TIMEOUT ESCOPADO do DocumentoOperationalDrawer (rodada de ajustes Operação
// v3, 27/09/2026). Achado real: o usuário clicava numa linha de documento, o
// drawer abria, e o GET operational-projection — lento sob contenção do pool
// Postgres, causa raiz ainda não corrigida (ver relatório da rodada) — ficava
// pendurado sem NENHUM prazo visível: `useApi`/`buscar()` (src/lib/dados) tem
// um prazo de 45s, mas compartilhado por TODA a aplicação, longo demais para
// dar feedback aqui.
//
// `useProjecaoOperacional` (DocumentoOperationalDrawer.tsx) é a correção: só
// esta chamada usa fetch cru + AbortController — mesmo padrão de
// `abrirOperacao` em ProcessoCentralOperacional.tsx. Prova os 3 estados
// pedidos:
//   1. resposta lenta → aviso ("demorando") aparece aos 5s, antes de estourar
//   2. estoura os 15s → erro claro, `carregando` encerra
//   3. "Tentar de novo" (recarregar()) refaz a chamada do zero e resolve
// ============================================================================
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjecaoOperacional } from '@/src/components/kanban/DocumentoOperationalDrawer'

/** fetch que nunca resolve sozinho — só quando o AbortController dele aborta. */
function fetchPendurado() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const e = new Error('aborted')
        e.name = 'AbortError'
        reject(e)
      })
    })
  })
}

describe('useProjecaoOperacional — timeout escopado (15s) e aviso (5s)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('1) resposta lenta — aviso "demorando" aparece aos 5s, antes do prazo estourar', async () => {
    vi.stubGlobal('fetch', fetchPendurado())

    const { result } = renderHook(() => useProjecaoOperacional('/api/documentos/1/operational-projection'))

    expect(result.current.carregando).toBe(true)
    expect(result.current.demorando).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

    expect(result.current.demorando).toBe(true)
    expect(result.current.carregando).toBe(true) // ainda dentro do prazo de 15s
    expect(result.current.erro).toBeNull()
  })

  it('2) estoura os 15s — erro claro, carregando encerra, aviso some (é terminal, não "lento")', async () => {
    vi.stubGlobal('fetch', fetchPendurado())

    const { result } = renderHook(() => useProjecaoOperacional('/api/documentos/1/operational-projection'))

    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })

    expect(result.current.carregando).toBe(false)
    expect(result.current.demorando).toBe(false)
    expect(result.current.erro).toBe('A consulta excedeu 15 segundos.')
    expect(result.current.dados).toBeUndefined()
  })

  it('3) "Tentar de novo" — recarregar() refaz a chamada do zero e resolve, sem fechar o drawer', async () => {
    vi.stubGlobal('fetch', fetchPendurado())
    const { result } = renderHook(() => useProjecaoOperacional('/api/documentos/1/operational-projection'))
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(result.current.erro).toBe('A consulta excedeu 15 segundos.')

    // A chamada de retry responde rápido e com sucesso — mesma função, nova tentativa.
    const documentoFalso = { id: 1, tipo: 'CERTIDAO_NASCIMENTO' }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ document: documentoFalso, workflow: null, projection: null }),
    })))

    await act(async () => { await result.current.recarregar() })

    expect(result.current.erro).toBeNull()
    expect(result.current.carregando).toBe(false)
    expect(result.current.dados?.document).toEqual(documentoFalso)
  })

  it('sem documento (chave null) — não carrega, não erra', () => {
    const { result } = renderHook(() => useProjecaoOperacional(null))
    expect(result.current.carregando).toBe(false)
    expect(result.current.erro).toBeNull()
    expect(result.current.dados).toBeUndefined()
  })
})
