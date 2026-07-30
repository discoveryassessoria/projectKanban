// testes/date-picker-rascunho.test.tsx
// ============================================================================
// O CAMPO DE DATA — rascunho sobre valor externo, e a navegação do calendário.
//
// Este arquivo existe por causa de um defeito REAL cometido durante a migração:
// ao juntar `viewMonth` e `viewYear` num só estado, "mês anterior" a partir de
// Janeiro passou a ir para Janeiro do ano anterior em vez de DEZEMBRO — porque as
// duas chamadas de setter no mesmo handler não compunham. `tsc` e lint não veem
// isso; só renderizar e clicar vê.
//
// O que fica travado aqui:
//   1. o campo mostra o valor que veio de fora, formatado;
//   2. o que o usuário digita é preservado (é rascunho, não é sobrescrito);
//   3. quando `value` muda por fora, o rascunho é DESCARTADO;
//   4. Janeiro → mês anterior = Dezembro do ano anterior (o defeito acima);
//   5. Dezembro → mês seguinte = Janeiro do ano seguinte (o espelho do caso 4).
// ============================================================================
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DatePickerField } from '@/components/ui/date-picker-field'
import { renderizar } from './util'

// Digitar aqui é sempre por TECLADO, nunca por clique. Ao primeiro caractere o
// componente abre o popover em modo modal, e a partir daí o Radix marca o resto da
// página com `pointer-events: none` — o user-event recusa clicar num elemento
// nesse estado. O usuário real também não clica: o campo já está com foco.
async function digitar(user: ReturnType<typeof renderizar>['user'], campo: HTMLElement, texto: string) {
  campo.focus()
  await user.keyboard(`{Control>}a{/Control}${texto}`)
}

describe('DatePickerField — rascunho e navegação', () => {
  it('1. mostra o valor recebido, formatado', () => {
    renderizar(<DatePickerField value="2026-03-15" />)
    expect(screen.getByRole('textbox')).toHaveValue('15/03/2026')
  })

  it('2. preserva o que o usuário digita', async () => {
    const { user } = renderizar(<DatePickerField value="2026-03-15" />)
    const campo = screen.getByRole('textbox')
    await digitar(user, campo, '20042026')
    expect(campo).toHaveValue('20/04/2026')
  })

  it('3. valor novo vindo de fora DESCARTA o rascunho', async () => {
    const { user, rerender } = renderizar(<DatePickerField value="2026-03-15" />)
    const campo = screen.getByRole('textbox')
    await digitar(user, campo, '99')
    // A máscara do campo já insere a barra depois do dia — é o rascunho do usuário.
    expect(campo).toHaveValue('99/')

    // O pai troca a data (ex.: outro registro foi selecionado).
    rerender(<DatePickerField value="2026-07-01" />)
    // A asserção é no MESMO nó (o campo já em mãos): com o popover modal aberto, o
    // Radix esconde o resto da página da árvore de acessibilidade, e uma busca por
    // papel não acharia o input — sem que ele tenha saído da tela.
    expect(campo).toHaveValue('01/07/2026')
  })

  it('4. de Janeiro, "mês anterior" vai para DEZEMBRO do ano anterior', async () => {
    const { user } = renderizar(<DatePickerField value="2026-01-10" />)
    await user.click(screen.getByRole('button', { name: 'Abrir calendário' }))

    const combos = await screen.findAllByRole('combobox')
    const [mes, ano] = combos
    expect(mes).toHaveValue('0')      // Janeiro
    expect(ano).toHaveValue('2026')

    await user.click(screen.getByRole('button', { name: 'Mês anterior' }))

    expect(mes).toHaveValue('11')     // Dezembro, não Janeiro
    expect(ano).toHaveValue('2025')
  })

  it('5. de Dezembro, "mês seguinte" vai para JANEIRO do ano seguinte', async () => {
    // `toYear` explícito: por padrão o seletor de ano para no ano corrente, e um
    // <select> não exibe valor que não está entre as suas opções — a asserção
    // falharia por causa da FAIXA, não do comportamento sob teste.
    const { user } = renderizar(<DatePickerField value="2026-12-10" toYear={2030} />)
    await user.click(screen.getByRole('button', { name: 'Abrir calendário' }))

    const combos = await screen.findAllByRole('combobox')
    const [mes, ano] = combos
    expect(mes).toHaveValue('11')
    expect(ano).toHaveValue('2026')

    await user.click(screen.getByRole('button', { name: 'Mês seguinte' }))

    expect(mes).toHaveValue('0')
    expect(ano).toHaveValue('2027')
  })
})
