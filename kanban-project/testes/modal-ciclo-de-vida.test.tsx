// testes/modal-ciclo-de-vida.test.tsx
// ============================================================================
// CICLO DE VIDA DE MODAL — o contrato que as Categorias 2 e 3 não podem quebrar.
//
// Aqui está o motivo de este arquivo existir antes de qualquer refatoração de
// modal: os ~65 warnings de "sincronização prop → estado" e "reset de modal"
// vivem exatamente nestes comportamentos, e nenhum deles é observável por
// `tsc` ou por leitura de código. Um modal que perde o que foi digitado, ou que
// reabre com dados do registro anterior, compila perfeitamente.
//
// O contrato provado aqui, com um modal de REFERÊNCIA que usa o padrão
// recomendado (remontagem por `key`), serve de especificação executável: quando
// eu migrar os modais reais, é este comportamento que eles têm de manter.
//
//   1. abre com os dados do registro;
//   2. o que o usuário digita é preservado enquanto o modal está aberto;
//   3. fechar e reabrir o MESMO registro reseta o rascunho (não vaza edição);
//   4. abrir OUTRO registro mostra os dados do outro (não os do anterior);
//   5. alternar de aba e voltar preserva o rascunho;
//   6. o foco inicial cai no primeiro campo;
//   7. criar (sem registro) abre em branco;
//   8. editar submete o que está na tela;
//   9. fechar com alterações pendentes pede confirmação;
//  10. validação bloqueia a submissão e diz qual campo.
// ============================================================================
import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderizar } from './util'

interface Registro { id: number; nome: string; email: string }

/**
 * Modal de REFERÊNCIA. Não sincroniza prop→estado por efeito: o estado inicial
 * vem do próprio registro e a identidade do modal é a `key` do hospedeiro —
 * é o padrão que os modais reais devem adotar.
 */
function ModalRef({
  registro, onFechar, onSalvar,
}: { registro: Registro | null; onFechar: () => void; onSalvar: (r: Omit<Registro, 'id'>) => void }) {
  const [nome, setNome] = useState(registro?.nome ?? '')
  const [email, setEmail] = useState(registro?.email ?? '')
  const [aba, setAba] = useState<'dados' | 'extra'>('dados')
  const [erro, setErro] = useState<string | null>(null)

  const sujo = nome !== (registro?.nome ?? '') || email !== (registro?.email ?? '')

  const fechar = () => {
    if (sujo && !window.confirm('Descartar alterações?')) return
    onFechar()
  }

  return (
    <div role="dialog" aria-label={registro ? 'Editar registro' : 'Criar registro'}>
      <div role="tablist">
        <button role="tab" aria-selected={aba === 'dados'} onClick={() => setAba('dados')}>Dados</button>
        <button role="tab" aria-selected={aba === 'extra'} onClick={() => setAba('extra')}>Extra</button>
      </div>

      {aba === 'dados' && (
        <>
          <label htmlFor="nome">Nome</label>
          {/* autoFocus: o foco inicial é parte do contrato, não detalhe visual */}
          <input id="nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
          <label htmlFor="email">Email</label>
          <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </>
      )}
      {aba === 'extra' && <p>conteúdo extra</p>}

      {erro && <p role="alert">{erro}</p>}
      <button onClick={fechar}>Fechar</button>
      <button
        onClick={() => {
          if (!nome.trim()) { setErro('Informe o nome.'); return }
          onSalvar({ nome, email })
        }}
      >
        Salvar
      </button>
    </div>
  )
}

/** Hospedeiro: é ele que decide a identidade do modal via `key`. */
function Host({ registros }: { registros: Registro[] }) {
  const [abertoId, setAbertoId] = useState<number | null>(null)
  const [sessao, setSessao] = useState(0)
  const salvo = vi.fn()
  const registro = registros.find((r) => r.id === abertoId) ?? null

  return (
    <div>
      {registros.map((r) => (
        <button key={r.id} onClick={() => { setAbertoId(r.id); setSessao((s) => s + 1) }}>
          Abrir {r.nome}
        </button>
      ))}
      <button onClick={() => { setAbertoId(null); setSessao((s) => s + 1) }}>Abrir criação</button>
      {(abertoId !== null || sessao > 0) && (
        <ModalRef
          // A `key` é o que dá ao modal uma identidade por SESSÃO de abertura:
          // trocar de registro, ou reabrir o mesmo, monta um modal novo com
          // estado inicial novo. É isso que substitui o setState-em-efeito.
          key={`${abertoId ?? 'novo'}-${sessao}`}
          registro={registro}
          onFechar={() => setSessao(0)}
          onSalvar={salvo}
        />
      )}
    </div>
  )
}

const REGISTROS: Registro[] = [
  { id: 1, nome: 'Ana', email: 'ana@x.com' },
  { id: 2, nome: 'Bruno', email: 'bruno@x.com' },
]

describe('ciclo de vida de modal', () => {
  it('1. abre com os dados do registro', async () => {
    const { user } = renderizar(<Host registros={REGISTROS} />)
    await user.click(screen.getByRole('button', { name: 'Abrir Ana' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('Ana')
    expect(screen.getByLabelText('Email')).toHaveValue('ana@x.com')
  })

  it('2. preserva o que o usuário digita enquanto está aberto', async () => {
    const { user } = renderizar(<Host registros={REGISTROS} />)
    await user.click(screen.getByRole('button', { name: 'Abrir Ana' }))
    const nome = screen.getByLabelText('Nome')
    await user.clear(nome)
    await user.type(nome, 'Ana Maria')
    expect(nome).toHaveValue('Ana Maria')
  })

  it('3. reabrir o MESMO registro reseta o rascunho', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user } = renderizar(<Host registros={REGISTROS} />)
    await user.click(screen.getByRole('button', { name: 'Abrir Ana' }))
    await user.type(screen.getByLabelText('Nome'), ' EDITADO')
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    await user.click(screen.getByRole('button', { name: 'Abrir Ana' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('Ana')
  })

  it('4. abrir OUTRO registro mostra os dados do outro', async () => {
    const { user } = renderizar(<Host registros={REGISTROS} />)
    await user.click(screen.getByRole('button', { name: 'Abrir Ana' }))
    await user.click(screen.getByRole('button', { name: 'Abrir Bruno' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('Bruno')
    expect(screen.getByLabelText('Email')).toHaveValue('bruno@x.com')
  })

  it('5. trocar de aba e voltar preserva o rascunho', async () => {
    const { user } = renderizar(<Host registros={REGISTROS} />)
    await user.click(screen.getByRole('button', { name: 'Abrir Ana' }))
    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), 'Rascunho')
    await user.click(screen.getByRole('tab', { name: 'Extra' }))
    expect(screen.getByText('conteúdo extra')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Dados' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho')
  })

  it('6. o foco inicial cai no primeiro campo', async () => {
    const { user } = renderizar(<Host registros={REGISTROS} />)
    await user.click(screen.getByRole('button', { name: 'Abrir Ana' }))
    await waitFor(() => expect(screen.getByLabelText('Nome')).toHaveFocus())
  })

  it('7. criação abre em branco', async () => {
    const { user } = renderizar(<Host registros={REGISTROS} />)
    await user.click(screen.getByRole('button', { name: 'Abrir criação' }))
    expect(screen.getByRole('dialog', { name: 'Criar registro' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('8. edição submete o que está na tela', async () => {
    const salvo = vi.fn()
    const { user } = renderizar(
      <ModalRef registro={REGISTROS[0]} onFechar={() => {}} onSalvar={salvo} />,
    )
    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), 'Ana Alterada')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(salvo).toHaveBeenCalledWith({ nome: 'Ana Alterada', email: 'ana@x.com' })
  })

  it('9. fechar com alterações pendentes pede confirmação — e cancelar mantém o modal', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fechou = vi.fn()
    const { user } = renderizar(
      <ModalRef registro={REGISTROS[0]} onFechar={fechou} onSalvar={() => {}} />,
    )
    await user.type(screen.getByLabelText('Nome'), ' X')
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(confirmar).toHaveBeenCalled()
    expect(fechou).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nome')).toHaveValue('Ana X')
  })

  it('9b. sem alterações, fechar NÃO incomoda o usuário', async () => {
    const confirmar = vi.spyOn(window, 'confirm')
    const fechou = vi.fn()
    const { user } = renderizar(
      <ModalRef registro={REGISTROS[0]} onFechar={fechou} onSalvar={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(confirmar).not.toHaveBeenCalled()
    expect(fechou).toHaveBeenCalled()
  })

  it('10. validação bloqueia a submissão e diz qual campo', async () => {
    const salvo = vi.fn()
    const { user } = renderizar(<ModalRef registro={null} onFechar={() => {}} onSalvar={salvo} />)
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(salvo).not.toHaveBeenCalled()
  })
})
