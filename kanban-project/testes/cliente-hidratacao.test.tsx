// testes/cliente-hidratacao.test.tsx
// ============================================================================
// AS ABSTRAÇÕES DE CLIENTE, renderizadas de verdade.
//
// O guard estrutural (scripts/ssr-hidratacao.test.ts) prova o CONTRATO lendo o
// código. Aqui se prova o COMPORTAMENTO: que `useIsClient` fica true após
// montar, que `useJsonLocalStorage` devolve a MESMA referência entre renders
// (sem isso o React entra em laço), que uma escrita em outra aba propaga, e que
// JSON corrompido não derruba a árvore.
//
// A referência estável é o ponto sutil: `useSyncExternalStore` exige snapshot
// estável, e é fácil quebrar isso "melhorando" o cache do módulo depois.
// ============================================================================
import { useEffect } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { gravarLocal, useIsClient, useJsonLocalStorage, useLocalStorage } from '@/src/lib/cliente'
import { renderizar } from './util'

function SondaCliente() {
  const noCliente = useIsClient()
  return <p data-testid="cliente">{String(noCliente)}</p>
}

function SondaBruto({ chave }: { chave: string }) {
  const valor = useLocalStorage(chave)
  return <p data-testid="bruto">{valor ?? '(null)'}</p>
}

function SondaJson({ chave, observados }: { chave: string; observados?: unknown[] }) {
  const valor = useJsonLocalStorage<{ nome?: string }>(chave)
  // Registra o valor observado a CADA render, num efeito sem array de deps.
  // Fora do render de propósito: ler/escrever ref durante o render é o próprio
  // defeito que esta suíte existe para vigiar.
  useEffect(() => { observados?.push(valor) })
  return <p data-testid="nome">{valor?.nome ?? '(sem nome)'}</p>
}

describe('abstrações de cliente (src/lib/cliente)', () => {
  it('useIsClient fica true depois de montar', async () => {
    renderizar(<SondaCliente />)
    await waitFor(() => expect(screen.getByTestId('cliente')).toHaveTextContent('true'))
  })

  it('useLocalStorage lê o valor já presente', () => {
    localStorage.setItem('k', 'valor-cru')
    renderizar(<SondaBruto chave="k" />)
    expect(screen.getByTestId('bruto')).toHaveTextContent('valor-cru')
  })

  it('chave ausente devolve null sem quebrar', () => {
    renderizar(<SondaBruto chave="nao-existe" />)
    expect(screen.getByTestId('bruto')).toHaveTextContent('(null)')
  })

  it('useJsonLocalStorage parseia JSON válido', () => {
    localStorage.setItem('user', JSON.stringify({ nome: 'Marco' }))
    renderizar(<SondaJson chave="user" />)
    expect(screen.getByTestId('nome')).toHaveTextContent('Marco')
  })

  it('JSON corrompido devolve null em vez de derrubar a árvore', () => {
    localStorage.setItem('user', '{isso não é json')
    renderizar(<SondaJson chave="user" />)
    expect(screen.getByTestId('nome')).toHaveTextContent('(sem nome)')
  })

  it('a referência do JSON é ESTÁVEL entre renders (sem laço)', async () => {
    localStorage.setItem('user', JSON.stringify({ nome: 'Marco' }))
    const observados: unknown[] = []
    const { rerender } = renderizar(<SondaJson chave="user" observados={observados} />)
    rerender(<SondaJson chave="user" observados={observados} />)
    rerender(<SondaJson chave="user" observados={observados} />)
    await waitFor(() => expect(observados.length).toBeGreaterThanOrEqual(3))
    // Vários renders, UMA referência: é o que `useSyncExternalStore` exige. Se o
    // parse acontecesse a cada leitura, cada render traria um objeto novo e o
    // React entraria em laço.
    expect(new Set(observados).size).toBe(1)
  })

  it('gravarLocal atualiza a tela na PRÓPRIA aba', async () => {
    localStorage.setItem('user', JSON.stringify({ nome: 'Antes' }))
    renderizar(<SondaJson chave="user" />)
    expect(screen.getByTestId('nome')).toHaveTextContent('Antes')

    await act(async () => { gravarLocal('user', { nome: 'Depois' }) })
    await waitFor(() => expect(screen.getByTestId('nome')).toHaveTextContent('Depois'))
  })

  it('mudança vinda de OUTRA aba propaga (evento storage)', async () => {
    localStorage.setItem('user', JSON.stringify({ nome: 'Local' }))
    renderizar(<SondaJson chave="user" />)

    await act(async () => {
      localStorage.setItem('user', JSON.stringify({ nome: 'Da outra aba' }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'user' }))
    })
    await waitFor(() => expect(screen.getByTestId('nome')).toHaveTextContent('Da outra aba'))
  })
})
