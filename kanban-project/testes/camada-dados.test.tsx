// testes/camada-dados.test.tsx
// ============================================================================
// A CAMADA DE DADOS, exercitada de verdade — não por leitura de código.
//
// Este é o teste que dá confiança em todos os lotes de migração: se `useApi`
// carrega, deduplica, revalida e propaga erro corretamente, então as ~43 telas
// migradas herdam esse comportamento. Sem ele, cada migração era um ato de fé.
//
// Prova, renderizando:
//   • estado de carregamento → dados;
//   • DEDUPLICAÇÃO: dois componentes pedindo a mesma URL = UMA requisição;
//   • REVALIDAÇÃO após escrita: a lista é rebuscada e a tela mostra o novo item;
//   • erro do servidor chega à tela com a mensagem do servidor;
//   • chave `null` não dispara requisição (o "ainda não tenho id").
// ============================================================================
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useApi, enviar } from '@/src/lib/dados'
import { comSessao, renderizar, servidorFalso } from './util'

interface Resp { itens?: { id: number; nome: string }[] }

function Lista({ chave = '/api/coisas' as string | null }: { chave?: string | null }) {
  const { dados, carregando, erro, recarregar } = useApi<Resp>(chave)
  if (carregando) return <p>carregando…</p>
  if (erro) return <p role="alert">{erro.message}</p>
  return (
    <div>
      <ul>{(dados?.itens ?? []).map((i) => <li key={i.id}>{i.nome}</li>)}</ul>
      <button
        onClick={async () => {
          await enviar('/api/coisas', { metodo: 'POST', corpo: { nome: 'Novo' } })
          await recarregar()
        }}
      >
        Criar
      </button>
    </div>
  )
}

describe('camada de dados (src/lib/dados)', () => {
  it('mostra carregamento e depois os dados', async () => {
    comSessao()
    servidorFalso([{ quando: '/api/coisas', responde: { itens: [{ id: 1, nome: 'Alfa' }] } }])

    renderizar(<Lista />)
    expect(screen.getByText('carregando…')).toBeInTheDocument()
    expect(await screen.findByText('Alfa')).toBeInTheDocument()
  })

  it('manda o token de sessão na requisição', async () => {
    comSessao('abc123')
    const srv = servidorFalso([{ quando: '/api/coisas', responde: { itens: [] } }])

    renderizar(<Lista />)
    await waitFor(() => expect(srv.chamadas('/api/coisas')).toBeGreaterThan(0))
    const chamada = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    const init = chamada[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc123')
  })

  it('DEDUPLICA: dois componentes na mesma URL fazem UMA requisição', async () => {
    comSessao()
    const srv = servidorFalso([{ quando: '/api/coisas', responde: { itens: [{ id: 1, nome: 'Alfa' }] } }])

    renderizar(<><Lista /><Lista /></>)
    await waitFor(() => expect(screen.getAllByText('Alfa')).toHaveLength(2))
    expect(srv.chamadas('/api/coisas', 'GET')).toBe(1)
  })

  it('REVALIDA depois de criar: a tela passa a mostrar o novo item', async () => {
    comSessao()
    const srv = servidorFalso([
      { quando: '/api/coisas', metodo: 'GET', responde: { itens: [{ id: 1, nome: 'Alfa' }] } },
      { quando: '/api/coisas', metodo: 'POST', responde: { ok: true } },
    ])

    const { user } = renderizar(<Lista />)
    expect(await screen.findByText('Alfa')).toBeInTheDocument()
    const antes = srv.chamadas('/api/coisas', 'GET')

    // O servidor passa a devolver os dois itens — é o que a revalidação deve trazer.
    srv.responder('/api/coisas', { itens: [{ id: 1, nome: 'Alfa' }, { id: 2, nome: 'Beta' }] })
    await user.click(screen.getByRole('button', { name: 'Criar' }))

    expect(await screen.findByText('Beta')).toBeInTheDocument()
    expect(srv.chamadas('/api/coisas', 'POST')).toBe(1)
    expect(srv.chamadas('/api/coisas', 'GET')).toBeGreaterThan(antes)
  })

  it('erro do servidor chega à tela com a mensagem do servidor', async () => {
    comSessao()
    servidorFalso([{ quando: '/api/coisas', responde: { error: 'Falha específica do servidor' }, status: 500 }])

    renderizar(<Lista />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha específica do servidor')
  })

  it('chave null não dispara requisição', async () => {
    comSessao()
    const srv = servidorFalso([{ quando: '/api/coisas', responde: { itens: [] } }])

    renderizar(<Lista chave={null} />)
    await waitFor(() => expect(screen.queryByText('carregando…')).not.toBeInTheDocument())
    expect(srv.chamadas('/api/coisas')).toBe(0)
  })
})
