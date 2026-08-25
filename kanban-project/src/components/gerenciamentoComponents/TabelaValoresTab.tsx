'use client'

// src/components/gerenciamentoComponents/TabelaValoresTab.tsx
// TABELA DE PREÇOS — responde só "quanto vale esta Configuração Financeira neste contexto?".
// CHAVE: configuracaoFinanceiraItemId (FK). Sem Fase, sem Produto/Serviço legado, sem código/nome solto.
// Backend: /api/gerenciamento/tabela-valores (GET/POST) + /[id] (PUT/DELETE)

import { useState, useEffect, useMemo, useCallback } from 'react'
// FONTE ÚNICA do mapeamento modo → unidade (compartilhada com a API).
import { ESTRATEGIAS_CALCULO, rotuloEstrategia, estrategiaDoModo, estrategiaUsaPrimeiroAdicional, estrategiaUsaFaixaQuantidade } from '@/lib/financeiro/modo-calculo'
import { UNIDADES_COBRANCA_OPCOES, rotuloUnidade, rotuloUnidadeMinuscula } from '@/lib/financeiro/unidade-cobranca'
import { useApi } from "@/src/lib/dados"
import { agruparPorCadastroMestre, type DimensaoPreco } from '@/lib/financeiro/leitura/tabela-precos-projecao'

type ConfigRef = { id: number; publicCode: string | null; possuiCusto: boolean; possuiReceita: boolean; origem: string; mestre: string; label: string; moedaPadrao: string }
type FornecedorRef = { id: number; nome: string; publicCode?: string | null }
type CfgEmbed = {
  id: number; publicCode?: string | null; possuiCusto: boolean; possuiReceita: boolean
  tipoDocumento?: { name: string; publicCode?: string | null } | null; honorario?: { name: string } | null
  tipoProcesso?: { name: string } | null
  itemCatalogo?: {
    name: string; natureza: string
    tiposDocumento?: { publicCode: string | null }[]
    servicos?: { publicCode: string | null }[]
  } | null
}
type Item = {
  id: number; name: string
  // O papel (CUSTO/RECEITA) vive no PRÓPRIO preço, não na config.
  natureza: string | null
  itemCatalogoId?: number | null
  codigo?: string | null
  configuracaoFinanceiraItemId: number | null
  configuracaoFinanceiraItem?: CfgEmbed | null
  fornecedorId: number | null
  moeda: string
  valor: string | number | null
  // PRIMEIRO + ADICIONAL (estratégia base+adicional; ex.: honorários por requerente).
  valorBase: string | number | null
  valorAdicional: string | number | null
  modoCalculo: string
  unidade: string | null
  quantidadeMinima: string | number | null
  quantidadeMaxima: string | number | null
  vigenciaInicio: string | null
  vigenciaFim: string | null
  prioridade: number
  arquivado: boolean
  fornecedor?: FornecedorRef | null
}

// Item ofertável no seletor — a linha que o GET devolve em `configs`. `id` é a
// Configuração Financeira e é NULA enquanto o item nunca foi precificado; o que
// identifica o item é sempre `itemCatalogoId`.
type ItemOfertavel = {
  itemCatalogoId: number
  natureza: string
  mestre: string
  codigo: string | null
  categoria: string | null
  unidade: string | null
  id: number | null
  possuiCusto: boolean
  possuiReceita: boolean
  moedaPadrao: string | null
  label: string
}

const MOEDAS: [string, string][] = [['EUR', 'EUR'], ['BRL', 'BRL'], ['USD', 'USD']]

// TIPO DE ITEM = `ItemCatalogo.natureza` (enum oficial NaturezaItem). É a natureza
// do próprio item mestre, não uma cascata de FKs da config — por isso um Documento
// Mestre aparece aqui mesmo antes de ter qualquer preço.
// Filtro de navegação: não é gravado na Tabela de Preços.
const TIPO_ITEM_LABEL: Record<string, string> = {
  SERVICO: 'Serviços', DOCUMENTO: 'Documentos', TAXA: 'Taxas',
  DESPESA: 'Despesas', LOGISTICA: 'Logística', OUTRO: 'Outros',
}
const tipoItemLabel = (n: string) => TIPO_ITEM_LABEL[n] ?? n
const ORDEM_TIPO = ['SERVICO', 'DOCUMENTO', 'TAXA', 'DESPESA', 'LOGISTICA', 'OUTRO']

/**
 * IDENTIDADE DA LINHA — nome, origem e CÓDIGO CANÔNICO do cadastro mestre.
 *
 * O código vem da entidade de ORIGEM: Cadastro Mestre Documental (DOC1, DOC2…)
 * ou Catálogo de Serviços (SRV-1, SRV-4…). Nunca da Configuração Financeira, do
 * registro de preço ou do fornecedor — nenhum desses identifica o item, e o
 * `publicCode` do fornecedor (FOR-1) chegava a competir visualmente com ele.
 */
/**
 * QUAL ENTIDADE MESTRE esta Configuração Financeira representa — resolvida UMA
 * vez, e é dela que saem rótulo, código e origem.
 *
 * A Configuração pode apontar para o mestre por vínculo DIRETO (`tipoDocumento`)
 * ou pelo PIVÔ (`itemCatalogo`, que por sua vez tem o tipo documental ou o
 * serviço). As configs 182 e 183 usam o pivô: `tipoDocumentoId` é nulo nelas.
 *
 * Antes, `codigo` percorria a cadeia inteira e `origem` olhava só o vínculo
 * direto — duas derivações da MESMA pergunta, e só uma completa. O resultado era
 * uma certidão exibindo o código certo (DOC1) e a origem errada ("Item").
 * Resolver o mestre uma vez só é o que impede as duas voltarem a divergir.
 */
function resolverMestre(cfg?: CfgEmbed | null): { tipo: 'DOCUMENTO' | 'SERVICO' | 'HONORARIO' | 'PROCESSO' | null; nome: string | null; codigo: string | null } {
  if (!cfg) return { tipo: null, nome: null, codigo: null }

  // Vínculo DIRETO com o Cadastro Mestre Documental.
  if (cfg.tipoDocumento) return { tipo: 'DOCUMENTO', nome: cfg.tipoDocumento.name, codigo: cfg.tipoDocumento.publicCode ?? null }

  // Pelo PIVÔ: o ItemCatalogo sabe se é documento ou serviço porque a entidade
  // mestre correspondente aponta para ele. É o TIPO REAL — não o nome, não o
  // prefixo do código.
  const doc = cfg.itemCatalogo?.tiposDocumento?.[0]
  if (doc) return { tipo: 'DOCUMENTO', nome: cfg.itemCatalogo?.name ?? null, codigo: doc.publicCode ?? null }
  const srv = cfg.itemCatalogo?.servicos?.[0]
  if (srv) return { tipo: 'SERVICO', nome: cfg.itemCatalogo?.name ?? null, codigo: srv.publicCode ?? null }

  if (cfg.honorario) return { tipo: 'HONORARIO', nome: cfg.honorario.name, codigo: null }
  if (cfg.tipoProcesso) return { tipo: 'PROCESSO', nome: cfg.tipoProcesso.name, codigo: null }

  // Último recurso: a natureza declarada no próprio Catálogo. Ainda é o tipo
  // canônico do cadastro — só que sem a entidade mestre alcançável daqui.
  const nat = cfg.itemCatalogo?.natureza
  const porNatureza = nat === 'DOCUMENTO' ? 'DOCUMENTO' : nat === 'SERVICO' ? 'SERVICO' : nat === 'HONORARIO' ? 'HONORARIO' : null
  return { tipo: porNatureza as 'DOCUMENTO' | 'SERVICO' | 'HONORARIO' | null, nome: cfg.itemCatalogo?.name ?? null, codigo: null }
}

const ROTULO_ORIGEM: Record<string, string> = {
  DOCUMENTO: 'Documento', SERVICO: 'Serviço', HONORARIO: 'Honorário', PROCESSO: 'Processo',
}

function origemMestre(cfg?: CfgEmbed | null): { origem: string; mestre: string; codigo: string | null } {
  const m = resolverMestre(cfg)
  return {
    // Sem tipo resolvido a tela diz "—", não "Item": inventar uma categoria
    // genérica foi o que fez uma certidão passar por outra coisa.
    origem: m.tipo ? ROTULO_ORIGEM[m.tipo] : '—',
    mestre: m.nome ?? '—',
    codigo: m.codigo,
  }
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}
const fmtMoeda = (v: any, moeda: string) => {
  const n = v === null || v === undefined || v === '' ? 0 : Number(v)
  try { return n.toLocaleString('pt-BR', { style: 'currency', currency: moeda || 'BRL' }) } catch { return `${moeda} ${n.toFixed(2)}` }
}
// 'YYYY-MM-DD' → 'DD/MM/YYYY' (sem timezone; a string já é a data comercial).
const fmtData = (iso: string | null) => {
  if (!iso) return null
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
// Rótulos DERIVADOS da combinação estratégia × unidade (nunca do nome do serviço):
//  • primeiro+adic → "Primeiro <unidade>" / "<Unidade> adicional"
//  • por unidade   → "Valor por <unidade>"  • fixo → "Valor fixo"  • faixa → "Valor aplicável"
const rotuloPrimeiro = (u: string) => `Primeiro ${rotuloUnidadeMinuscula(u)}`
const rotuloAdicional = (u: string) => `${rotuloUnidade(u)} adicional`
const rotuloValorUnico = (modo: string, u: string) => {
  const est = estrategiaDoModo(modo)
  if (est === 'fixo') return 'Valor fixo'
  if (est === 'faixa') return 'Valor aplicável'
  return u ? `Valor por ${rotuloUnidadeMinuscula(u)}` : 'Valor unitário'
}

const EMPTY = {
  categoria: '', // filtro de navegação (origem estrutural) — NÃO enviado no payload
  // ÚNICO campo de vínculo do item — fonte da verdade do formulário, da validação,
  // do que a tela exibe e do que o payload envia. A Configuração Financeira NÃO é
  // estado desta tela: ela é resolvida (find-or-create) pelo backend a partir deste
  // id. Mantê-la aqui criava uma segunda fonte da verdade que ficava vazia sempre
  // que o item ainda não tinha config — e travava o cadastro.
  itemCatalogoId: '',     // identidade OFICIAL do item precificado
  // Naturezas do domínio (apenas duas). Cada uma marcada = 1 registro; ambas = 2 registros.
  precoCusto: false, precoVenda: false,
  // Custo: fornecedor + moeda + valor. Venda: moeda + valor (registros independentes).
  fornecedorId: '', moeda: '', valor: '',
  moedaVenda: '', valorVenda: '',
  // PRIMEIRO (base) + ADICIONAL — só na estratégia "Primeiro + adicionais".
  valorBase: '', valorAdicional: '', valorBaseVenda: '', valorAdicionalVenda: '',
  // Estratégia de cálculo (modoCalculo canônico) + Unidade de cobrança (o que se conta).
  modoCalculo: 'fixed', unidade: '', quantidadeMinima: '', quantidadeMaxima: '',
  // Prioridade saiu da UI (não há mais múltiplas tabelas válidas p/ o mesmo contexto).
  // Persistida sempre como 0 no backend — mantida no schema por compatibilidade.
  arquivado: false,
}
type FormState = typeof EMPTY

// Campos que só fazem sentido depois de um item escolhido — limpos junto com ele
// quando o item sai (troca de tipo ou "Selecione um item").
const SEM_ITEM: Partial<FormState> = {
  itemCatalogoId: '', precoCusto: false, precoVenda: false,
  moeda: '', valor: '', moedaVenda: '', valorVenda: '',
  valorBase: '', valorAdicional: '', valorBaseVenda: '', valorAdicionalVenda: '', fornecedorId: '',
}

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function TabelaValoresTab() {
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  // Busca dentro do campo Item — filtra a lista, nunca cria valor.
  const [buscaItem, setBuscaItem] = useState('')
  const [editando, setEditando] = useState<Item | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)
  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }))

  // UMA consulta, várias listas derivadas da MESMA resposta — o endpoint já
  // devolve tudo junto. loading/erro vêm da camada; nada de setState em efeito.
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<{ tabelaValores?: Item[], configs?: ItemOfertavel[], fornecedores?: any[] }>('/api/gerenciamento/tabela-valores')
  const itens: Item[] = dados?.tabelaValores ?? SEM_ITENS
  const configs: ItemOfertavel[] = dados?.configs ?? SEM_ITENS
  const fornecedores: any[] = dados?.fornecedores ?? SEM_ITENS
  const erroLista = erro ? (erro.message || 'Não foi possível carregar os preços.') : null

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((i) => {
      const om = origemMestre(i.configuracaoFinanceiraItem)
      // A busca aceita o código canônico: "DOC1" e "SRV-4" encontram o item.
      return `${om.codigo ?? ''} ${om.mestre} ${om.origem} ${i.natureza ?? ''} ${i.name}`.toLowerCase().includes(q)
    })
  }, [itens, busca])

  // ITEM SELECIONADO — resolvido pelo MESMO id que o formulário grava e envia.
  // Antes isto era resolvido pela Configuração Financeira (`c.id`), que é NULA para
  // todo item ainda não precificado (hoje, em produção, TODO Documento Mestre): o
  // item ficava escolhido no select e o resto da tela continuava achando que nada
  // havia sido selecionado — naturezas desabilitadas, cadastro impossível.
  const itemSelecionado = configs.find((c) => String(c.itemCatalogoId) === form.itemCatalogoId) ?? null
  // Rótulo exibido: SEMPRE derivado do id vinculado, nunca de texto digitado. Em
  // edição o item é imutável e pode nem estar mais entre os ofertáveis — aí o
  // rótulo vem do próprio registro.
  const rotuloItemVinculado = itemSelecionado
    ? `${itemSelecionado.mestre}${itemSelecionado.codigo ? ` · ${itemSelecionado.codigo}` : ''}`
    : editando
      ? origemMestre(editando.configuracaoFinanceiraItem).mestre
      : null
  // Categorias = origens ESTRUTURAIS distintas presentes nas configs (dinâmico, sem categorias fictícias).
  // Documentos/Serviços primeiro; demais origens reais depois, em ordem alfabética.
  const categorias = useMemo(() => {
    const tipos = Array.from(new Set(configs.map((c) => c.natureza).filter(Boolean)))
    return tipos.sort((a, b) => {
      const ia = ORDEM_TIPO.indexOf(a), ib = ORDEM_TIPO.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  }, [configs])
  // Itens do tipo escolhido, com busca por nome ou código público do item.
  const itensDaCategoria = useMemo(() => {
    if (!form.categoria) return []
    const q = buscaItem.trim().toLowerCase()
    return configs
      .filter((c) => c.natureza === form.categoria)
      .filter((c) => !q || `${c.mestre} ${c.codigo ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.mestre.localeCompare(b.mestre))
  }, [configs, form.categoria, buscaItem])

  function abrirNovo() { setEditando(null); setForm(EMPTY); setBuscaItem(''); setErroModal(null); setModalAberto(true) }
  function abrirEditar(i: Item) {
    setEditando(i)
    // Item vinculado do registro: o id canônico é o do PRÓPRIO preço; a lista de
    // ofertáveis só serve para descobrir o TIPO (natureza) do item.
    const itemCatalogoId = i.itemCatalogoId ?? configs.find((c) => c.id === i.configuracaoFinanceiraItemId)?.itemCatalogoId ?? null
    const doItem = itemCatalogoId != null ? configs.find((c) => c.itemCatalogoId === itemCatalogoId) : undefined
    // Categoria derivada da natureza ESTRUTURAL do item (nunca por texto).
    const categoria = doItem?.natureza ?? i.configuracaoFinanceiraItem?.itemCatalogo?.natureza ?? ''
    // Edição é sempre de UM registro individual: exatamente uma natureza (RECEITA legado ≡ VENDA).
    const ehVenda = i.natureza === 'VENDA' || i.natureza === 'RECEITA'
    const valorStr = i.valor != null ? String(i.valor) : ''
    const baseStr = i.valorBase != null ? String(i.valorBase) : ''
    const adicStr = i.valorAdicional != null ? String(i.valorAdicional) : ''
    setForm({
      categoria,
      itemCatalogoId: itemCatalogoId != null ? String(itemCatalogoId) : '',
      precoCusto: i.natureza === 'CUSTO', precoVenda: ehVenda,
      // Custo usa fornecedor/moeda/valor; Venda usa moedaVenda/valorVenda.
      fornecedorId: i.fornecedorId ? String(i.fornecedorId) : '',
      moeda: ehVenda ? '' : (i.moeda || ''), valor: ehVenda ? '' : valorStr,
      moedaVenda: ehVenda ? (i.moeda || '') : '', valorVenda: ehVenda ? valorStr : '',
      // Primeiro/adicional pertencem ao registro em edição (uma natureza por vez).
      valorBase: ehVenda ? '' : baseStr, valorAdicional: ehVenda ? '' : adicStr,
      valorBaseVenda: ehVenda ? baseStr : '', valorAdicionalVenda: ehVenda ? adicStr : '',
      modoCalculo: i.modoCalculo || 'fixed',
      // Unidade de cobrança é ESCOLHIDA (normaliza legado lowercase → enum). qtd só na faixa.
      unidade: i.unidade ? String(i.unidade).toUpperCase() : '',
      quantidadeMinima: estrategiaUsaFaixaQuantidade(i.modoCalculo) && i.quantidadeMinima != null ? String(i.quantidadeMinima) : '',
      quantidadeMaxima: estrategiaUsaFaixaQuantidade(i.modoCalculo) && i.quantidadeMaxima != null ? String(i.quantidadeMaxima) : '',
      arquivado: i.arquivado,
    })
    setBuscaItem(''); setErroModal(null); setModalAberto(true)
  }

  // SELEÇÃO DO ITEM — um único ponto de gravação: id canônico no formulário.
  // Selecionar habilita as naturezas (a lista já diz quais o item admite) e limpa
  // o erro de validação; desmarcar limpa tudo que dependia do item.
  function selecionarItem(id: string) {
    const c = configs.find((x) => String(x.itemCatalogoId) === id) ?? null
    if (!c) { setForm((f) => ({ ...f, ...SEM_ITEM })); setErroModal(null); return }
    setForm((f) => ({
      ...f,
      itemCatalogoId: String(c.itemCatalogoId),
      moeda: f.moeda || (c.moedaPadrao ?? ''),
      moedaVenda: f.moedaVenda || (c.moedaPadrao ?? ''),
      // marca por padrão as naturezas que o item habilita quando só uma;
      // ambas habilitadas → deixa o usuário escolher os checkboxes.
      precoCusto: c.possuiCusto && !c.possuiReceita,
      precoVenda: c.possuiReceita && !c.possuiCusto,
    }))
    setErroModal(null)
  }

  async function salvar() {
    if (!form.categoria) { setErroModal('Selecione o tipo de item.'); return }
    // Vínculo do item = um único campo canônico. Se ele está preenchido, o item
    // está vinculado — não existe segunda condição para "reconhecer" a seleção.
    if (!form.itemCatalogoId) { setErroModal('Selecione o item.'); return }
    if (!form.precoCusto && !form.precoVenda) { setErroModal('Marque pelo menos uma natureza: Preço de Custo e/ou Preço de Venda.'); return }
    // Estratégias derivam do modoCalculo (fonte única).
    const usaBaseAdic = estrategiaUsaPrimeiroAdicional(form.modoCalculo)
    const usaFaixa = estrategiaUsaFaixaQuantidade(form.modoCalculo)
    const ehFixo = estrategiaDoModo(form.modoCalculo) === 'fixo'
    // Unidade de cobrança: obrigatória fora do "Preço fixo".
    if (!ehFixo && !form.unidade) { setErroModal('Selecione a Unidade de cobrança.'); return }
    if (usaFaixa) {
      if (form.quantidadeMinima === '' || Number(form.quantidadeMinima) < 0) { setErroModal('Informe a Quantidade mínima da faixa.'); return }
      if (form.quantidadeMaxima !== '' && Number(form.quantidadeMaxima) < Number(form.quantidadeMinima)) { setErroModal('Quantidade máxima deve ser ≥ mínima.'); return }
    }
    if (form.precoCusto) {
      if (!form.moeda) { setErroModal('Selecione a moeda do custo.'); return }
      if (usaBaseAdic) {
        if (form.valorBase === '' || Number(form.valorBase) <= 0) { setErroModal(`${rotuloPrimeiro(form.unidade)} (custo) deve ser maior que zero.`); return }
        if (form.valorAdicional === '' || Number(form.valorAdicional) < 0) { setErroModal(`${rotuloAdicional(form.unidade)} (custo) não pode ser vazio ou negativo.`); return }
      } else if (form.valor === '' || Number(form.valor) <= 0) { setErroModal(`${rotuloValorUnico(form.modoCalculo, form.unidade)} (custo) deve ser maior que zero.`); return }
    }
    if (form.precoVenda) {
      if (!form.moedaVenda) { setErroModal('Selecione a moeda da venda.'); return }
      if (usaBaseAdic) {
        if (form.valorBaseVenda === '' || Number(form.valorBaseVenda) <= 0) { setErroModal(`${rotuloPrimeiro(form.unidade)} (venda) deve ser maior que zero.`); return }
        if (form.valorAdicionalVenda === '' || Number(form.valorAdicionalVenda) < 0) { setErroModal(`${rotuloAdicional(form.unidade)} (venda) não pode ser vazio ou negativo.`); return }
      } else if (form.valorVenda === '' || Number(form.valorVenda) <= 0) { setErroModal(`${rotuloValorUnico(form.modoCalculo, form.unidade)} (venda) deve ser maior que zero.`); return }
    }
    setSalvando(true); setErroModal(null)
    try {
      // NOVO CONTRATO: envia os CHECKBOXES + blocos custo/venda. A natureza é derivada no
      // backend (fonte única `naturezasDeSelecao`) — o componente NÃO decide natureza nem
      // envia o campo legado `natureza` no cadastro novo.
      const { categoria: _c, itemCatalogoId: _ici, precoCusto: _pc, precoVenda: _pv, moeda: _m, valor: _v, fornecedorId: _f, moedaVenda: _mv, valorVenda: _vv, valorBase: _vb, valorAdicional: _va, valorBaseVenda: _vbv, valorAdicionalVenda: _vav, ...compartilhados } = form
      const num = (v: string) => (v === '' ? undefined : Number(v))
      // Bloco de preço: na estratégia primeiro+adicional envia valorBase/valorAdicional (o
      // backend usa valorBase como `valor` de compat); nas demais envia só `valor`.
      const blocoCusto = usaBaseAdic
        ? { moeda: form.moeda, valorBase: num(form.valorBase), valorAdicional: num(form.valorAdicional), fornecedorId: form.fornecedorId ? Number(form.fornecedorId) : null }
        : { moeda: form.moeda, valor: Number(form.valor), fornecedorId: form.fornecedorId ? Number(form.fornecedorId) : null }
      const blocoVenda = usaBaseAdic
        ? { moeda: form.moedaVenda, valorBase: num(form.valorBaseVenda), valorAdicional: num(form.valorAdicionalVenda) }
        : { moeda: form.moedaVenda, valor: Number(form.valorVenda) }
      // Edição = UM registro individual já existente (natureza imutável): payload single.
      const editPayload = form.precoCusto
        ? { natureza: 'CUSTO', ...blocoCusto }
        : { natureza: 'VENDA', ...blocoVenda, fornecedorId: null }
      const body = JSON.stringify({
        ...compartilhados,
        // VÍNCULO: só o ID canônico do item. A Configuração Financeira é resolvida
        // (ou criada) pelo backend a partir dele — a tela não a carrega nem a envia.
        // Nenhum nome, código ou rótulo é enviado como vínculo.
        itemCatalogoId: Number(form.itemCatalogoId),
        // TIPO só para o backend VALIDAR a compatibilidade tipo × item. Não é persistido.
        itemTipo: form.categoria,
        prioridade: 0, // não editável — fonte única de vigência dispensa prioridade
        ...(editando
          ? editPayload
          : {
              precoCusto: form.precoCusto,
              precoVenda: form.precoVenda,
              custo: form.precoCusto ? blocoCusto : undefined,
              venda: form.precoVenda ? blocoVenda : undefined,
            }),
      })
      if (editando) await jsonFetch(`/api/gerenciamento/tabela-valores/${editando.id}`, { method: 'PUT', body })
      else await jsonFetch('/api/gerenciamento/tabela-valores', { method: 'POST', body })
      setModalAberto(false); await carregar()
    } catch (e: any) { setErroModal(e.message || 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  async function excluir(i: Item) {
    if (!confirm(`Excluir este preço?`)) return
    try { await jsonFetch(`/api/gerenciamento/tabela-valores/${i.id}`, { method: 'DELETE' }); await carregar() }
    catch (e: any) { alert(e.message || 'Não foi possível excluir.') }
  }

  const inputCls = 'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'
  // Naturezas só existem depois de um item vinculado — e é o ITEM que diz quais admite.
  const itemVinculado = !!form.itemCatalogoId
  const podeCusto = !!itemSelecionado?.possuiCusto
  const podeVenda = !!itemSelecionado?.possuiReceita

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Tabelas de Preços</h2>
          <p className="text-sm text-[var(--text-secondary)]">Repositório de valores: quanto vale cada Configuração Financeira. Custo/venda por fornecedor — a decisão de onde aplicar cada preço é da Regra Financeira. Preço ativo vale por tempo indeterminado.</p>
        </div>
        <button onClick={abrirNovo} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)]">+ Novo valor</button>
      </div>

      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cadastro mestre, papel ou contexto..." className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20" />

      {loading && <div className="py-12 text-center text-sm text-[var(--text-muted)]">Carregando...</div>}
      {!loading && erroLista && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erroLista}<button onClick={() => void carregar()} className="ml-3 underline hover:text-white">Tentar de novo</button></div>}
      {!loading && !erroLista && filtrados.length === 0 && <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] py-12 text-center text-sm text-[var(--text-muted)] backdrop-blur">{busca ? 'Nenhum preço encontrado.' : 'Nenhum preço ainda. Crie o primeiro em “Novo valor”.'}</div>}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur">
          <table className="w-full text-[13px]">
            <thead><tr className="bg-[var(--surface-primary)]">
              {/* UMA LINHA POR CADASTRO MESTRE. "Papel" era coluna porque a tela
                  renderizava REGISTRO de preço; agora Custo e Venda são colunas
                  próprias do mesmo item, e "Preço" genérico deixou de existir. */}
              {['Código', 'Cadastro mestre', 'Origem', 'Custo', 'Venda', 'Status', ''].map((h, idx) => (
                <th key={idx} className={`border-b border-[var(--border-default)] px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] ${idx === 3 || idx === 4 || idx === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {agruparPorCadastroMestre(filtrados).map((linha) => {
                const om = origemMestre(linha.referencia.configuracaoFinanceiraItem)
                const ativo = !linha.referencia.arquivado
                return (
                  <tr key={linha.configId} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-primary)]">
                    <td className="px-3 py-2.5 font-mono text-[12px] text-white/70">{om.codigo ?? '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-white">{om.mestre}</td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">{om.origem}</td>
                    <CelulaDimensao dim={linha.custo} onEditar={abrirEditar} onExcluir={excluir} />
                    <CelulaDimensao dim={linha.venda} onEditar={abrirEditar} onExcluir={excluir} />
                    <td className="px-3 py-2.5"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${ativo ? 'bg-green-50 text-green-700' : 'bg-[var(--surface-primary)] text-[var(--text-secondary)]'}`}>{ativo ? 'Ativo' : 'Inativo'}</span></td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-[var(--text-muted)]">
                      {/* VARIAÇÃO ≠ SEM PAPEL. O preço de um fornecedor específico
                          convivendo com o genérico é cadastro correto — é a régua
                          de prioridade do resolvedor. Chamá-lo de "sem papel"
                          fazia parecer defeito e escondia um preço vivo. */}
                      {linha.variacoes.length > 0 && (
                        <span
                          className="mr-2 text-[var(--text-secondary)]"
                          title={linha.variacoes
                            .map((v) => `${v.papel}: ${v.fornecedor ?? 'genérico'} — ${v.registro.moeda} ${String(v.registro.valor)}`)
                            .join('\n')}
                        >
                          +{linha.variacoes.length} por fornecedor
                        </span>
                      )}
                      {linha.outros.length > 0 && `+${linha.outros.length} sem papel`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar preço' : 'Novo valor'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
            </div>
            <div className="space-y-4 px-6 py-4">
              {/* Item via dois selects DEPENDENTES (sem digitação livre). Tipo = natureza
                  do item (filtro de navegação); Item = o id canônico gravado. */}
              <div className="grid grid-cols-[35fr_65fr] gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Tipo de item *</label>
                  <select
                    aria-label="Tipo de item"
                    value={form.categoria}
                    disabled={!!editando}
                    // Trocar o tipo derruba o item anterior e tudo que dependia dele
                    // (naturezas, moedas, valores, fornecedor) — nunca resta um item
                    // incompatível com o tipo escolhido.
                    onChange={(e) => { setBuscaItem(''); setErroModal(null); setForm((f) => ({ ...f, ...SEM_ITEM, categoria: e.target.value })) }}
                    // (unidade e estratégia preservadas — não dependem do tipo)
                    className={inputCls + (editando ? ' cursor-not-allowed opacity-60' : '')}
                  >
                    <option value="" className="bg-zinc-900">Selecione um tipo</option>
                    {categorias.map((o) => <option key={o} value={o} className="bg-zinc-900">{tipoItemLabel(o)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Item *</label>
                  {/* Busca só reduz a lista — o vínculo continua sendo por id. */}
                  {form.categoria && !editando && (
                    <input
                      value={buscaItem}
                      onChange={(e) => setBuscaItem(e.target.value)}
                      placeholder="Buscar item por nome ou código…"
                      className={inputCls + ' mb-1.5'}
                    />
                  )}
                  {/* value e option carregam o MESMO id canônico que o formulário grava. */}
                  <select
                    aria-label="Item"
                    value={form.itemCatalogoId}
                    disabled={!form.categoria || !!editando}
                    onChange={(e) => selecionarItem(e.target.value)}
                    className={inputCls + ((!form.categoria || editando) ? ' cursor-not-allowed opacity-60' : '')}
                  >
                    <option value="" className="bg-zinc-900">
                      {!form.categoria
                        ? 'Selecione um tipo primeiro'
                        : itensDaCategoria.length === 0
                          ? (buscaItem ? 'Nenhum item encontrado para esta busca' : `Nenhum item ativo de ${tipoItemLabel(form.categoria).toLowerCase()}`)
                          : 'Selecione um item'}
                    </option>
                    {/* Em edição o item é imutável e pode estar fora da lista de ofertáveis
                        (inativo, por exemplo): a opção do próprio registro garante que o
                        campo mostre o item vinculado em vez de ficar vazio. */}
                    {editando && form.itemCatalogoId && !itemSelecionado && (
                      <option value={form.itemCatalogoId} className="bg-zinc-900">{rotuloItemVinculado}</option>
                    )}
                    {itensDaCategoria.map((c) => (
                      <option key={c.itemCatalogoId} value={c.itemCatalogoId} className="bg-zinc-900">
                        {c.mestre}{c.codigo ? ` · ${c.codigo}` : ''}
                      </option>
                    ))}
                  </select>
                  {/* Confirmação do VÍNCULO — o que a tela mostra é o item resolvido pelo id. */}
                  {itemVinculado && rotuloItemVinculado && (
                    <p className="mt-1 text-[11px] text-emerald-700/80">Item vinculado: {rotuloItemVinculado}</p>
                  )}
                  {form.categoria && !editando && itensDaCategoria.length === 0 && (
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">Nenhum item nesta categoria. Cadastre a Configuração Financeira do mestre.</p>
                  )}
                </div>
              </div>

              {/* Naturezas do preço — DUAS independentes (não existe "AMBOS"). Marcar as duas
                  apenas cria dois registros (CUSTO e VENDA) na mesma transação atômica.
                  Habilitadas assim que existe item vinculado: quem diz o que o item admite
                  é o próprio item (a config, quando ainda não existe, nasce ao salvar). */}
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">Natureza do preço *</label>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <label className={`flex items-center gap-2 text-sm ${(!itemVinculado || editando || !podeCusto) ? 'cursor-not-allowed text-[var(--text-muted)]' : 'text-white/80'}`}>
                    <input type="checkbox" checked={form.precoCusto}
                      disabled={!itemVinculado || !!editando || !podeCusto}
                      onChange={(e) => set('precoCusto', e.target.checked)} className="h-4 w-4 accent-amber-500" />
                    Preço de Custo
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${(!itemVinculado || editando || !podeVenda) ? 'cursor-not-allowed text-[var(--text-muted)]' : 'text-white/80'}`}>
                    <input type="checkbox" checked={form.precoVenda}
                      disabled={!itemVinculado || !!editando || !podeVenda}
                      onChange={(e) => set('precoVenda', e.target.checked)} className="h-4 w-4 accent-emerald-500" />
                    Preço de Venda
                  </label>
                </div>
                {!itemVinculado && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Selecione um item para escolher as naturezas.</p>}
                {itemVinculado && itemSelecionado && !podeCusto && !podeVenda && (
                  <p className="mt-1 text-[11px] text-amber-700/80">Esta configuração não habilita custo nem venda. Ajuste a Natureza Financeira em Configurações Financeiras.</p>
                )}
              </div>

              {/* ESTRATÉGIA DE CÁLCULO × UNIDADE DE COBRANÇA — eixos independentes e genéricos.
                  A estratégia define COMO calcula; a unidade define O QUE conta. Qualquer
                  combinação válida é permitida (nunca condicionada ao nome do serviço). */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Estratégia de cálculo *</label>
                  <select value={form.modoCalculo} onChange={(e) => {
                    const modo = e.target.value
                    setForm((f) => ({
                      ...f, modoCalculo: modo,
                      // limpa campos que não pertencem à nova estratégia
                      ...(estrategiaUsaFaixaQuantidade(modo) ? {} : { quantidadeMinima: '', quantidadeMaxima: '' }),
                      ...(estrategiaUsaPrimeiroAdicional(modo) ? {} : { valorBase: '', valorAdicional: '', valorBaseVenda: '', valorAdicionalVenda: '' }),
                    }))
                  }} className={inputCls}>
                    {ESTRATEGIAS_CALCULO.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">
                    Unidade de cobrança {estrategiaDoModo(form.modoCalculo) === 'fixo' ? <span className="text-[var(--text-muted)]">(referência)</span> : '*'}
                  </label>
                  <select value={form.unidade} onChange={(e) => set('unidade', e.target.value)} className={inputCls}>
                    <option value="" className="bg-zinc-900">{estrategiaDoModo(form.modoCalculo) === 'fixo' ? '— (opcional) —' : 'Selecione a unidade'}</option>
                    {UNIDADES_COBRANCA_OPCOES.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">O que está sendo contado (requerente, documento, página, hora…).</p>
                </div>
              </div>

              {/* Bloco PREÇO DE CUSTO — Fornecedor + Moeda + Valor */}
              {form.precoCusto && (
                <div className="rounded-lg border border-amber-200 bg-amber-500/[0.04] p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700/80">Preço de Custo</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">Fornecedor</label>
                      <select value={form.fornecedorId} onChange={(e) => set('fornecedorId', e.target.value)} className={inputCls}>
                        <option value="" className="bg-zinc-900">— Nenhum —</option>
                        {fornecedores.map((f) => <option key={f.id} value={f.id} className="bg-zinc-900">{f.publicCode ? f.publicCode + ' — ' : ''}{f.nome}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">Moeda do custo *</label>
                      <select value={form.moeda} onChange={(e) => set('moeda', e.target.value)} className={inputCls}>
                        <option value="" className="bg-zinc-900">—</option>
                        {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                      </select>
                    </div>
                    {estrategiaUsaPrimeiroAdicional(form.modoCalculo) ? (
                      <div className="col-span-3 grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-[var(--text-secondary)]">{rotuloPrimeiro(form.unidade)} *</label>
                          <input type="number" min="0" step="0.01" value={form.valorBase} onChange={(e) => set('valorBase', e.target.value)} placeholder="0,00" className={inputCls} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[var(--text-secondary)]">{rotuloAdicional(form.unidade)} *</label>
                          <input type="number" min="0" step="0.01" value={form.valorAdicional} onChange={(e) => set('valorAdicional', e.target.value)} placeholder="0,00" className={inputCls} />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="mb-1 block text-xs text-[var(--text-secondary)]">{rotuloValorUnico(form.modoCalculo, form.unidade)} *</label>
                        <input type="number" min="0" step="0.01" value={form.valor} onChange={(e) => set('valor', e.target.value)} placeholder="0,00" className={inputCls} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bloco PREÇO DE VENDA — Moeda + Valor (sem fornecedor) */}
              {form.precoVenda && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-500/[0.04] p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700/80">Preço de Venda</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">Moeda da venda *</label>
                      <select value={form.moedaVenda} onChange={(e) => set('moedaVenda', e.target.value)} className={inputCls}>
                        <option value="" className="bg-zinc-900">—</option>
                        {MOEDAS.map(([k, label]) => <option key={k} value={k} className="bg-zinc-900">{label}</option>)}
                      </select>
                    </div>
                    {estrategiaUsaPrimeiroAdicional(form.modoCalculo) ? (
                      <div className="col-span-2 grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-[var(--text-secondary)]">{rotuloPrimeiro(form.unidade)} *</label>
                          <input type="number" min="0" step="0.01" value={form.valorBaseVenda} onChange={(e) => set('valorBaseVenda', e.target.value)} placeholder="0,00" className={inputCls} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[var(--text-secondary)]">{rotuloAdicional(form.unidade)} *</label>
                          <input type="number" min="0" step="0.01" value={form.valorAdicionalVenda} onChange={(e) => set('valorAdicionalVenda', e.target.value)} placeholder="0,00" className={inputCls} />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="mb-1 block text-xs text-[var(--text-secondary)]">{rotuloValorUnico(form.modoCalculo, form.unidade)} *</label>
                        <input type="number" min="0" step="0.01" value={form.valorVenda} onChange={(e) => set('valorVenda', e.target.value)} placeholder="0,00" className={inputCls} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Faixa de quantidade (mín./máx.) — SOMENTE na estratégia de faixa. Oculta em
                  fixo, unitário simples e primeiro+adicional (campos preservados no schema). */}
              {estrategiaUsaFaixaQuantidade(form.modoCalculo) && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--text-secondary)]">Qtd mín.</label>
                    <input type="number" min="0" value={form.quantidadeMinima} onChange={(e) => set('quantidadeMinima', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--text-secondary)]">Qtd máx.</label>
                    <input type="number" min="0" value={form.quantidadeMaxima} onChange={(e) => set('quantidadeMaxima', e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}

              {/* VALIDADE É ESTADO, NÃO DATA (09/08/2026): um preço ativo vale por
                  tempo indeterminado, até ser editado, inativado ou excluído. Os
                  campos "Válido a partir de" / "Válido até" saíram — eram
                  parametrização genérica que escondia preço correto de quem o
                  procurava. Histórico de fato continua protegido por snapshot. */}

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm text-white/80"><input type="checkbox" checked={!form.arquivado} onChange={(e) => set('arquivado', !e.target.checked)} className="h-4 w-4 accent-blue-500" />Ativo</label>
              </div>

              {erroModal && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erroModal}</div>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setModalAberto(false)} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">Cancelar</button>
              {/* Sem item oficial vinculado não há o que salvar — o botão diz
                  isso antes do clique, em vez de deixar o operador descobrir no erro.
                  A condição é a MESMA do vínculo: um único campo canônico. */}
              <button
                onClick={salvar}
                disabled={salvando || !form.itemCatalogoId}
                title={!form.itemCatalogoId ? 'Selecione o tipo e o item primeiro' : undefined}
                className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)] disabled:opacity-50"
              >{salvando ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * UMA DIMENSÃO FINANCEIRA (custo ou venda) do cadastro.
 *
 * Fornecedor e estratégia vivem AQUI, não na linha: o custo pode vir da CRC e a
 * venda não ter fornecedor nenhum, e essa diferença era justamente o que antes
 * "justificava" duas linhas para o mesmo item.
 */
function CelulaDimensao({
  dim, onEditar, onExcluir,
}: {
  dim: DimensaoPreco<Item> | null
  onEditar: (i: Item) => void
  onExcluir: (i: Item) => void
}) {
  if (!dim) return <td className="px-3 py-2.5 text-right text-[var(--text-muted)]">—</td>
  const i = dim.registro
  const valor = estrategiaUsaPrimeiroAdicional(i.modoCalculo) && i.valorBase != null && i.valorAdicional != null
    ? (
      <span className="inline-flex flex-col items-end leading-tight gap-0.5">
        <span><span className="text-[11px] text-[var(--text-secondary)]">{rotuloPrimeiro(i.unidade || '')}: </span>{fmtMoeda(i.valorBase, i.moeda)}</span>
        <span className="text-[12px]"><span className="text-[11px] text-[var(--text-secondary)]">{rotuloAdicional(i.unidade || '')}: </span>{fmtMoeda(i.valorAdicional, i.moeda)}</span>
      </span>
    )
    : <span>{fmtMoeda(i.valor, i.moeda)}</span>

  return (
    <td className="group px-3 py-2.5 text-right tabular-nums text-white/90">
      <div className="inline-flex flex-col items-end leading-tight gap-0.5">
        {valor}
        <span className="text-[11px] text-[var(--text-muted)]">{rotuloEstrategia(i.modoCalculo)}</span>
        {dim.fornecedor && <span className="text-[11px] text-[var(--text-muted)]">{dim.fornecedor}</span>}
        <span className="mt-0.5 hidden gap-2 group-hover:flex">
          <button onClick={() => onEditar(i)} className="text-[11px] text-[var(--text-secondary)] underline-offset-2 hover:text-white hover:underline">Editar</button>
          <button onClick={() => onExcluir(i)} className="text-[11px] text-red-700/70 underline-offset-2 hover:text-red-700 hover:underline">Excluir</button>
        </span>
      </div>
    </td>
  )
}
