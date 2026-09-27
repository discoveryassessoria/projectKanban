// testes/loop-pode-instavel.test.tsx
// ============================================================================
// LOOP DE PRODUÇÃO (27/09/2026, achado real e URGENTE): com a Central
// Operacional do processo aberta (/processos/[id]?tab=central), o navegador
// disparava GET /api/operacao/atribuiveis sem parar — mais de 18.500
// chamadas em ~2min, sozinho, sem nenhum clique, até esgotar o pool do
// Postgres.
//
// Causa: `usePermissoes()` devolvia `pode` como uma arrow function NOVA a
// cada chamada — ou seja, a cada render de QUALQUER componente que o usa.
// ProcessoCentralOperacional.tsx tinha `useEffect(() => {... fetch...},
// [pode])`: o próprio `setState` do fetch já É o próximo render, que gera um
// novo `pode`, que refaz o efeito, que faz outro fetch — sem fim.
//
// Duas provas:
//   1. `usePermissoes` sozinho — `pode` deve ter a MESMA identidade entre
//      renders (enquanto as permissões não mudam de verdade), não só o
//      mesmo comportamento.
//   2. O PADRÃO EXATO do bug real: um componente com
//      `useEffect(() => { if (pode(x)) buscar() }, [pode])` — no código de
//      ONTEM (pode instável) isso chamava `buscar()` em CADA re-render; no
//      código de HOJE, no máximo uma vez.
// ============================================================================
import { useEffect, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderizar, servidorFalso, comSessao } from './util'
import { usePermissoes } from '@/src/hooks/use-permissoes'

describe('usePermissoes — pode é estável entre renders', () => {
  it('a identidade de `pode` não muda quando o componente só re-renderiza (sem novo dado)', async () => {
    comSessao()
    servidorFalso([
      { quando: '/api/me/permissoes', responde: { permissoes: { 'tarefas.editar': true }, tipo: 'operador', userId: 1 } },
    ])

    const identidades: Array<(chave: string) => boolean> = []
    function Sonda() {
      const { pode } = usePermissoes()
      const [tick, setTick] = useState(0)
      identidades.push(pode)
      return <button onClick={() => setTick((t) => t + 1)}>re-render {tick}</button>
    }

    const { user } = renderizar(<Sonda />)
    await screen.findByRole('button', { name: /re-render/ }) // aguarda a 1ª carga (SWR)

    const antes = identidades.length
    await user.click(screen.getByRole('button', { name: /re-render/ }))
    await user.click(screen.getByRole('button', { name: /re-render/ }))
    await user.click(screen.getByRole('button', { name: /re-render/ }))

    // Renderizou de novo (o clique prova isso), mas `pode` é a MESMA referência
    // em todas as capturas pós-carga — nunca uma função nova por render.
    expect(identidades.length).toBeGreaterThan(antes)
    const posCarga = identidades.slice(-4)
    for (const p of posCarga) expect(p).toBe(posCarga[0])
  })
})

describe('regressão — o padrão exato do loop real (useEffect com [pode] nas deps)', () => {
  /** Reproduz a forma real do bug em ProcessoCentralOperacional.tsx:709 (antes da correção). */
  function TelaComPodeInstavel({ onFetch }: { onFetch: () => void }) {
    const permissoes: Record<string, boolean> = { 'tarefas.editar': true }
    // A MESMA forma do bug: arrow function nova a cada render — NUNCA useCallback.
    const podeInstavel = (chave: string) => !!permissoes[chave]
    const [tick, setTick] = useState(0)

    useEffect(() => {
      if (!podeInstavel('tarefas.editar')) return
      onFetch()
      // dispara um novo render (é exatamente isso que `setAtribuiveis` fazia
      // depois do fetch resolver) — o que, com `pode` instável, realimentava
      // o próprio efeito.
      if (tick < 5) setTick((t) => t + 1)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [podeInstavel])

    return <div>tick {tick}</div>
  }

  /** A versão corrigida: dependência primitiva, do jeito que ProcessoCentralOperacional.tsx está hoje. */
  function TelaComBooleanoEstavel({ onFetch }: { onFetch: () => void }) {
    const permissoes: Record<string, boolean> = { 'tarefas.editar': true }
    const pode = (chave: string) => !!permissoes[chave] // instável de propósito — não é o ponto aqui
    const podeEditarTarefas = pode('tarefas.editar')
    // Qualquer OUTRO motivo de re-render da tela — o mesmo papel que
    // `setAtribuiveis` (dentro do próprio fetch) tinha no bug real.
    const [outroEstado, setOutroEstado] = useState(0)

    useEffect(() => {
      if (!podeEditarTarefas) return
      onFetch()
      // mesma forma do efeito real (ProcessoCentralOperacional.tsx): só a
      // permissão nas deps, `onFetch`/`fetch` de propósito fora — é isso que
      // este teste prova ser seguro.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [podeEditarTarefas])

    return <button onClick={() => setOutroEstado((n) => n + 1)}>outro estado {outroEstado}</button>
  }

  it('CÓDIGO DE ONTEM — [pode] instável nas deps entra em loop (não pode passar)', async () => {
    const buscar = vi.fn()
    act(() => { render(<TelaComPodeInstavel onFetch={buscar} />) })
    // Deixa os re-renders em cascata acontecerem (setTick dentro do próprio efeito).
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    // Sem a correção, cada re-render recria `pode` → refaz o efeito → chama de novo.
    // O teto de 6 chamadas (tick 0..5) é só pra não deixar este teste rodar infinito;
    // o ponto é que ele NÃO para em 1.
    expect(buscar.mock.calls.length).toBeGreaterThan(1)
  })

  it('CÓDIGO DE HOJE — dependência primitiva (booleano) chama a busca UMA vez só, mesmo com N re-renders depois', async () => {
    const buscar = vi.fn()
    const user = userEvent.setup()
    render(<TelaComBooleanoEstavel onFetch={buscar} />)
    expect(buscar).toHaveBeenCalledTimes(1)

    // Três re-renders por um motivo TOTALMENTE alheio à permissão — o mesmo
    // papel que `setAtribuiveis` tinha no bug real, disparado pelo próprio
    // fetch. A dependência (`podeEditarTarefas`) continua `true === true`.
    const botao = screen.getByRole('button', { name: /outro estado/ })
    await user.click(botao)
    await user.click(botao)
    await user.click(botao)
    expect(await screen.findByText('outro estado 3')).toBeInTheDocument()

    expect(buscar).toHaveBeenCalledTimes(1)
  })
})
