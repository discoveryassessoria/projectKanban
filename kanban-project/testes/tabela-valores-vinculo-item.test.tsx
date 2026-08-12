// testes/tabela-valores-vinculo-item.test.tsx
// ============================================================================
// MODAL "NOVO VALOR" — o item selecionado fica REALMENTE vinculado.
//
// O defeito que estes testes travam: a tela gravava o item em `itemCatalogoId`
// mas decidia "existe item selecionado?" olhando a CONFIGURAÇÃO FINANCEIRA
// (`configuracaoFinanceiraItemId`), que é NULA para todo item ainda não
// precificado — em produção, todo Documento Mestre. Resultado: o item aparecia
// escolhido no seletor, "Preço de Custo"/"Preço de Venda" continuavam
// desabilitados e o cadastro era impossível. Duas fontes da verdade para o
// mesmo fato; agora só existe uma, `itemCatalogoId`.
//
// Nada disso é observável por `tsc` nem por leitura de código: só renderizando
// se prova que o clique no item habilita as naturezas e que o submit leva o ID.
// ============================================================================
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import TabelaValoresTab from '@/src/components/gerenciamentoComponents/TabelaValoresTab'
import { renderizar, servidorFalso, comSessao, type ServidorFalso } from './util'

// Item DOCUMENTO nunca precificado: `id` (Configuração Financeira) é NULO — é
// exatamente o caso que quebrava. `possuiCusto/possuiReceita` vêm true porque a
// config oficial nasce em CUSTO_E_RECEITA quando o backend a cria ao salvar.
const DOC = {
  itemCatalogoId: 1, natureza: 'DOCUMENTO', mestre: 'Certidão de Nascimento - Inteiro Teor',
  codigo: 'CERT_NASCIMENTO', categoria: null, unidade: null,
  id: null, possuiCusto: true, possuiReceita: true, moedaPadrao: null, label: 'Certidão de Nascimento - Inteiro Teor',
}
// Item SERVICO já com Configuração Financeira (o caso que funcionava).
const SERV = {
  itemCatalogoId: 2, natureza: 'SERVICO', mestre: 'Assessoria de Cidadania',
  codigo: 'SRV-1', categoria: null, unidade: null,
  id: 10, possuiCusto: true, possuiReceita: true, moedaPadrao: 'EUR', label: 'Assessoria de Cidadania',
}
// Item que só admite VENDA — a natureza ofertada vem do item, não de um padrão.
const SO_VENDA = {
  itemCatalogoId: 3, natureza: 'SERVICO', mestre: 'Análise Documental',
  codigo: 'SRV-2', categoria: null, unidade: null,
  id: 11, possuiCusto: false, possuiReceita: true, moedaPadrao: 'BRL', label: 'Análise Documental',
}

const PRECO_EXISTENTE = {
  id: 77, name: 'Certidão · CUSTO', natureza: 'CUSTO',
  itemCatalogoId: DOC.itemCatalogoId, configuracaoFinanceiraItemId: 55,
  configuracaoFinanceiraItem: {
    id: 55, possuiCusto: true, possuiReceita: true,
    tipoDocumento: null, honorario: null, tipoProcesso: null,
    itemCatalogo: { name: DOC.mestre, natureza: 'DOCUMENTO' },
  },
  fornecedorId: null, moeda: 'BRL', valor: '120', valorBase: null, valorAdicional: null,
  modoCalculo: 'fixed', unidade: null, quantidadeMinima: null, quantidadeMaxima: null,
  vigenciaInicio: '2026-01-01', vigenciaFim: null, prioridade: 0, arquivado: false, fornecedor: null,
}

/** Servidor falso com a MESMA forma que o GET real devolve. */
function servidor(tabelaValores: unknown[] = []): ServidorFalso {
  return servidorFalso([
    { quando: '/api/gerenciamento/tabela-valores', metodo: 'GET', responde: { tabelaValores, configs: [DOC, SERV, SO_VENDA], fornecedores: [] } },
    { quando: '/api/gerenciamento/tabela-valores', metodo: 'POST', responde: { regras: [] } },
    { quando: '/api/gerenciamento/tabela-valores/', metodo: 'PUT', responde: { regra: {} } },
  ])
}

/** Campo pelo rótulo visível — sem depender da ordem dos elementos na tela. */
function campo(rotulo: string): HTMLElement {
  const label = Array.from(document.body.querySelectorAll('label'))
    .find((l) => (l.textContent ?? '').trim().startsWith(rotulo))
  if (!label) throw new Error(`rótulo não encontrado: ${rotulo}`)
  const dentro = label.querySelector<HTMLElement>('input')
  if (dentro) return dentro
  const alvo = label.parentElement?.querySelector<HTMLElement>('select, input')
  if (!alvo) throw new Error(`campo não encontrado para: ${rotulo}`)
  return alvo
}

const custo = () => screen.getByLabelText('Preço de Custo') as HTMLInputElement
const venda = () => screen.getByLabelText('Preço de Venda') as HTMLInputElement
const selectItem = () => screen.getByLabelText('Item') as HTMLSelectElement
const selectTipo = () => screen.getByLabelText('Tipo de item') as HTMLSelectElement
const botaoSalvar = () => screen.getByRole('button', { name: /salvar/i }) as HTMLButtonElement

/** Corpo JSON da última escrita (POST/PUT) recebida pelo servidor falso. */
function corpoEnviado(): any {
  const chamadas = (globalThis.fetch as any).mock.calls as any[]
  const escrita = [...chamadas].reverse().find((c) => ['POST', 'PUT'].includes(String(c[1]?.method ?? '').toUpperCase()))
  if (!escrita) throw new Error('nenhuma escrita enviada')
  return JSON.parse(escrita[1].body as string)
}

describe('Modal "Novo valor" — vínculo do item', () => {
  beforeEach(() => { comSessao() })

  async function abrirNovo() {
    const { user } = renderizar(<TabelaValoresTab />)
    await user.click(await screen.findByRole('button', { name: '+ Novo valor' }))
    return user
  }

  it('1) selecionar o item grava o ID canônico no formulário', async () => {
    servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId))
    expect(selectItem().value).toBe(String(DOC.itemCatalogoId))
  })

  it('2) rótulo exibido e ID permanecem sincronizados (o texto vem do item do ID)', async () => {
    servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId))
    expect(screen.getByText(`Item vinculado: ${DOC.mestre} · ${DOC.codigo}`)).toBeTruthy()
    const opcao = selectItem().selectedOptions[0]
    expect(opcao.value).toBe(String(DOC.itemCatalogoId))
    expect(opcao.textContent).toContain(DOC.mestre)
  })

  it('3) natureza do preço é habilitada — inclusive para item SEM Configuração Financeira', async () => {
    servidor()
    const user = await abrirNovo()
    expect(custo().disabled).toBe(true)
    expect(venda().disabled).toBe(true)
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId)) // config NULA
    expect(custo().disabled).toBe(false)
    expect(venda().disabled).toBe(false)
    expect(screen.queryByText('Selecione um item para escolher as naturezas.')).toBeNull()
  })

  it('4) trocar o tipo limpa o item anterior e volta a desabilitar as naturezas', async () => {
    servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId))
    await user.click(custo())
    expect(custo().checked).toBe(true)

    await user.selectOptions(selectTipo(), 'SERVICO')
    expect(selectItem().value).toBe('')
    expect(custo().disabled).toBe(true)
    expect(venda().disabled).toBe(true)
    expect(custo().checked).toBe(false)
    expect(botaoSalvar().disabled).toBe(true)
  })

  it('5) o seletor só oferece itens compatíveis com o tipo escolhido', async () => {
    servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    const valores = Array.from(selectItem().options).map((o) => o.value).filter(Boolean)
    expect(valores).toEqual([String(DOC.itemCatalogoId)])
    expect(valores).not.toContain(String(SERV.itemCatalogoId))
  })

  it('6) o submit envia o ID canônico (nunca o nome/código do item)', async () => {
    const srv = servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId))
    await user.click(custo())
    await user.selectOptions(campo('Moeda do custo'), 'BRL')
    await user.type(campo('Valor fixo'), '150')
    fireEvent.change(campo('Válido a partir de'), { target: { value: '2026-08-01' } })
    await user.click(botaoSalvar())

    await waitFor(() => expect(srv.chamadas('/api/gerenciamento/tabela-valores', 'POST')).toBe(1))
    const corpo = corpoEnviado()
    expect(corpo.itemCatalogoId).toBe(DOC.itemCatalogoId)
    expect(typeof corpo.itemCatalogoId).toBe('number')
    expect(corpo.itemTipo).toBe('DOCUMENTO')
    expect(corpo.precoCusto).toBe(true)
    expect(corpo.custo).toMatchObject({ moeda: 'BRL', valor: 150 })
    expect(corpo.vigenciaInicio).toBe('2026-08-01')
    // Nenhum texto do item viaja como vínculo.
    expect(JSON.stringify(corpo)).not.toContain(DOC.mestre)
    expect(JSON.stringify(corpo)).not.toContain(DOC.codigo)
    // Estado duplicado eliminado: a config não é mais enviada pela tela.
    expect(corpo).not.toHaveProperty('configuracaoFinanceiraItemId')
  })

  it('7) o erro de validação some assim que o item é selecionado', async () => {
    servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId))
    await user.click(botaoSalvar()) // sem natureza marcada → erro
    expect(await screen.findByText(/Marque pelo menos uma natureza/)).toBeTruthy()
    await user.selectOptions(selectItem(), '')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId))
    expect(screen.queryByText(/Marque pelo menos uma natureza/)).toBeNull()
  })

  it('8) remover o item desabilita as naturezas e impede salvar', async () => {
    servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId))
    expect(botaoSalvar().disabled).toBe(false)
    await user.selectOptions(selectItem(), '')
    expect(custo().disabled).toBe(true)
    expect(venda().disabled).toBe(true)
    expect(botaoSalvar().disabled).toBe(true)
  })

  it('9) reabrir em edição preserva o item já vinculado', async () => {
    const srv = servidor([PRECO_EXISTENTE])
    const { user } = renderizar(<TabelaValoresTab />)
    await user.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(selectTipo().value).toBe('DOCUMENTO')
    expect(selectItem().value).toBe(String(DOC.itemCatalogoId))
    expect(screen.getByText(new RegExp(`Item vinculado: ${DOC.mestre}`))).toBeTruthy()
    expect(botaoSalvar().disabled).toBe(false)
    // e a edição continua enviando o mesmo ID (item imutável).
    await user.click(botaoSalvar())
    await waitFor(() => expect(srv.chamadas('/api/gerenciamento/tabela-valores/77', 'PUT')).toBe(1))
    expect(corpoEnviado().itemCatalogoId).toBe(DOC.itemCatalogoId)
  })

  it('10) as naturezas ofertadas vêm do item (só venda ⇒ custo desabilitado)', async () => {
    servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'SERVICO')
    await user.selectOptions(selectItem(), String(SO_VENDA.itemCatalogoId))
    expect(custo().disabled).toBe(true)
    expect(venda().disabled).toBe(false)
    expect(venda().checked).toBe(true)
  })

  it('11) custo e venda podem ser cadastrados juntos — um pedido, as duas naturezas', async () => {
    const srv = servidor()
    const user = await abrirNovo()
    await user.selectOptions(selectTipo(), 'DOCUMENTO')
    await user.selectOptions(selectItem(), String(DOC.itemCatalogoId))
    await user.click(custo())
    await user.click(venda())
    await user.selectOptions(campo('Moeda do custo'), 'BRL')
    await user.selectOptions(campo('Moeda da venda'), 'EUR')
    const valores = screen.getAllByPlaceholderText('0,00')
    await user.type(valores[0], '100')
    await user.type(valores[1], '250')
    fireEvent.change(campo('Válido a partir de'), { target: { value: '2026-08-01' } })
    await user.click(botaoSalvar())

    await waitFor(() => expect(srv.chamadas('/api/gerenciamento/tabela-valores', 'POST')).toBe(1))
    const corpo = corpoEnviado()
    expect(corpo.precoCusto).toBe(true)
    expect(corpo.precoVenda).toBe(true)
    expect(corpo.custo).toMatchObject({ moeda: 'BRL', valor: 100 })
    expect(corpo.venda).toMatchObject({ moeda: 'EUR', valor: 250 })
    expect(corpo.itemCatalogoId).toBe(DOC.itemCatalogoId)
  })
})
