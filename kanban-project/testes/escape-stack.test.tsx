// testes/escape-stack.test.tsx
// ============================================================================
// ESC EM CASCATA (rodada de ajustes Operação v3, 27/09/2026). Achado real: com
// o drawer de documento aberto DENTRO do modal do processo, apertar Esc
// fechava OS DOIS de uma vez — cada componente registrava o PRÓPRIO
// `document.addEventListener("keydown", ...)`, cego aos outros. Um Esc só
// disparava todos os listeners vivos.
//
// `registrarEscape` (src/lib/ui/escape-stack.ts) substitui os N listeners
// independentes por UMA pilha: só o overlay do TOPO (o mais recente a abrir)
// responde ao Esc. Prova:
//   1. só um overlay aberto → Esc fecha ele
//   2. dois empilhados → Esc fecha só o de cima; o de baixo continua aberto
//   3. Esc de novo, com o de cima já fechado → agora fecha o de baixo
//   4. nenhum overlay aberto → Esc não quebra nada
// ============================================================================
import { useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { registrarEscape, useFecharComEsc } from '@/src/lib/ui/escape-stack'

describe('registrarEscape — pilha pura', () => {
  it('1) um overlay — Esc fecha ele', () => {
    const fechar = vi.fn()
    const limpar = registrarEscape(fechar)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(fechar).toHaveBeenCalledTimes(1)
    limpar()
  })

  it('2) dois empilhados — Esc fecha só o do TOPO (o mais recente)', () => {
    const fecharModal = vi.fn()
    const fecharDrawer = vi.fn()
    const limparModal = registrarEscape(fecharModal)
    const limparDrawer = registrarEscape(fecharDrawer) // aberto DEPOIS → é o topo

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })

    expect(fecharDrawer).toHaveBeenCalledTimes(1)
    expect(fecharModal).not.toHaveBeenCalled()

    limparDrawer(); limparModal()
  })

  it('3) fechado o do topo, o próximo Esc fecha o de baixo', () => {
    const fecharModal = vi.fn()
    const fecharDrawer = vi.fn()
    const limparModal = registrarEscape(fecharModal)
    const limparDrawer = registrarEscape(fecharDrawer)

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    limparDrawer() // simula o drawer desmontando depois de fechar

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(fecharModal).toHaveBeenCalledTimes(1)

    limparModal()
  })

  it('4) nenhum overlay registrado — Esc não quebra nada', () => {
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }).not.toThrow()
  })

  it('tecla diferente de Escape não fecha nada', () => {
    const fechar = vi.fn()
    const limpar = registrarEscape(fechar)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })
    expect(fechar).not.toHaveBeenCalled()
    limpar()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// INTEGRAÇÃO — dois componentes reais (modal do processo + drawer de
// documento), cada um usando `useFecharComEsc`, o MESMO hook que os 8
// componentes reais usam. Prova o cenário exato do bug relatado, e a
// armadilha que `registrarEscape` cru (sem o hook) tem: `onClose` como arrow
// function inline (`onClose={() => setX(null)}`, o padrão real em
// ProcessoCentralOperacional.tsx) muda de identidade a CADA render do pai —
// se o efeito de registro dependesse de `onClose`, isso desregistrava e
// registrava de novo o overlay de FORA toda vez que ele só re-renderizava
// (ex.: polling), fazendo-o "roubar" o topo da pilha de um overlay aberto
// depois dele. `useFecharComEsc` só depende de `isOpen`, então é imune a isso
// — provado no teste de regressão abaixo.
// ────────────────────────────────────────────────────────────────────────────
function OverlayRef({
  isOpen, onClose, rotulo, children,
}: { isOpen: boolean; onClose: () => void; rotulo: string; children?: React.ReactNode }) {
  // Mesmo hook que os 8 componentes reais usam — não o `registrarEscape` cru.
  useFecharComEsc(isOpen, onClose)

  if (!isOpen) return null
  return <div role="dialog" aria-label={rotulo}>{children}</div>
}

function CenaProcessoComDrawer() {
  const [modalAberto, setModalAberto] = useState(true)
  const [drawerAberto, setDrawerAberto] = useState(false)
  return (
    <OverlayRef isOpen={modalAberto} onClose={() => setModalAberto(false)} rotulo="Modal do processo">
      <button onClick={() => setDrawerAberto(true)}>Abrir drawer do documento</button>
      <OverlayRef isOpen={drawerAberto} onClose={() => setDrawerAberto(false)} rotulo="Drawer do documento" />
    </OverlayRef>
  )
}

describe('Esc em cascata — cenário real (modal do processo + drawer empilhado)', () => {
  it('drawer aberto + Esc → fecha só o drawer; modal do processo continua aberto', async () => {
    const user = userEvent.setup()
    render(<CenaProcessoComDrawer />)

    expect(screen.getByRole('dialog', { name: 'Modal do processo' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Abrir drawer do documento' }))
    expect(screen.getByRole('dialog', { name: 'Drawer do documento' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Drawer do documento' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Modal do processo' })).toBeInTheDocument()

    // Esc de novo agora fecha o modal do processo.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Modal do processo' })).not.toBeInTheDocument()
  })

  it('regressão: re-render do modal externo (onClose inline recriado) não rouba o topo da pilha', async () => {
    const user = userEvent.setup()

    function CenaComPollingNoModal() {
      const [modalAberto, setModalAberto] = useState(true)
      const [drawerAberto, setDrawerAberto] = useState(false)
      // Simula o polling do modal do processo: re-renderiza sem mudar `isOpen`,
      // recriando a arrow function de `onClose` a cada vez — exatamente como
      // `onClose={() => setDrawerDocId(null)}` inline recria a cada render de
      // ProcessoCentralOperacional.tsx.
      const [tick, setTick] = useState(0)
      return (
        <div>
          <button onClick={() => setTick((t) => t + 1)}>Forçar re-render do modal (polling)</button>
          <OverlayRef
            isOpen={modalAberto}
            onClose={() => setModalAberto(false)}
            rotulo={`Modal do processo (tick ${tick})`}
          >
            <button onClick={() => setDrawerAberto(true)}>Abrir drawer do documento</button>
            <OverlayRef isOpen={drawerAberto} onClose={() => setDrawerAberto(false)} rotulo="Drawer do documento" />
          </OverlayRef>
        </div>
      )
    }

    render(<CenaComPollingNoModal />)
    await user.click(screen.getByRole('button', { name: 'Abrir drawer do documento' }))
    expect(screen.getByRole('dialog', { name: 'Drawer do documento' })).toBeInTheDocument()

    // O modal "recebe uma atualização de polling" — re-renderiza, `onClose` vira
    // uma referência NOVA — mas o drawer continua sendo o overlay mais recente.
    await user.click(screen.getByRole('button', { name: 'Forçar re-render do modal (polling)' }))
    await user.click(screen.getByRole('button', { name: 'Forçar re-render do modal (polling)' }))

    await user.keyboard('{Escape}')

    // Se o bug tivesse voltado, o Esc fecharia o modal (e o drawer, aninhado
    // nele, junto) em vez do drawer sozinho.
    expect(screen.queryByRole('dialog', { name: /Drawer do documento/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /Modal do processo/ })).toBeInTheDocument()
  })
})
