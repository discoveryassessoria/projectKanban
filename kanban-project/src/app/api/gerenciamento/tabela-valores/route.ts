import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { deriveNaturezaFinanceira, validarNaturezaPreco, canonicalNaturezaPreco, admiteCusto, admiteVenda, type NaturezaPrecoRaw } from '@/lib/financeiro/natureza-financeira'
import { detectarConflitoPreco, type PrecoRegistro } from '@/lib/financeiro/conflito-preco'
import { modoCalculoValido, estrategiaDoModo, estrategiaUsaPrimeiroAdicional, estrategiaUsaFaixaQuantidade } from '@/lib/financeiro/modo-calculo'
import { normalizarUnidade } from '@/lib/financeiro/unidade-cobranca'
import { naturezasDeSelecao, usaNovoModeloSelecao } from '@/lib/financeiro/selecao-natureza'
import { reprocessarPendenciasFinanceiras } from '@/src/lib/motor/executor'
import { garantirConfigFinanceiraDeItem } from '@/src/services/config-financeira-auto'
import { NATUREZAS_ITEM_OFICIAIS } from '@/lib/financeiro/catalogo-oficial'
import { NaturezaItem } from '@prisma/client'

// Naturezas OFICIAIS que podem receber preço. Vem da fonte única do catálogo —
// nenhuma lista paralela de tipos é declarada aqui.
const NATUREZAS_PRECIFICAVEIS = NATUREZAS_ITEM_OFICIAIS.map((n) => NaturezaItem[n])

function toAmount(v: any): number {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function toAmountOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function toIntOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
// R17 — vigência precisa ser ISO 'YYYY-MM-DD' (o EXCLUDE de sobreposição depende disso).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
function vigenciaInvalida(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false
  return !ISO_DATE.test(String(v)) || Number.isNaN(Date.parse(String(v)))
}
function mapDbError(e: any): NextResponse | null {
  const msg = String(e?.message ?? '')
  if (e?.code === 'P2002' || msg.includes('config_contexto_ativo'))
    return NextResponse.json({ error: 'Já existe um preço ativo idêntico (mesma config, contexto, moeda, unidade, faixa, prioridade e vigência).' }, { status: 409 })
  if (msg.includes('vigencia_sem_sobreposicao'))
    return NextResponse.json({ error: 'Vigência sobreposta a outro preço ativo no mesmo contexto e prioridade. Use prioridade distinta ou ajuste o período.' }, { status: 409 })
  return null
}

// ITENS PRECIFICÁVEIS — a fonte é o CADASTRO MESTRE (ItemCatalogo), não a lista
// de Configurações Financeiras que por acaso já existem.
//
// Essa distinção é o defeito que esta função corrige: derivar os tipos das configs
// existentes fazia a tela só oferecer o que já tinha preço, e um Documento Mestre
// nunca precificado ficava invisível — o operador não tinha por onde começar.
//
// O TIPO vem de `ItemCatalogo.natureza` (enum oficial NaturezaItem), nunca de uma
// cascata de campos legados. A config aparece quando existe; quando não existe, o
// item continua ofertável e a config é criada no momento de salvar o preço.
async function listarItensPrecificaveis() {
  const itens = await prisma.itemCatalogo.findMany({
    where: { ativo: true, natureza: { in: NATUREZAS_PRECIFICAVEIS } },
    select: {
      id: true, code: true, name: true, natureza: true, unidade: true,
      categoria: { select: { nome: true } },
      produtos: {
        where: { ativo: true },
        select: { id: true, possuiCusto: true, possuiReceita: true, moedaPadrao: true },
        take: 1,
      },
    },
    orderBy: [{ natureza: 'asc' }, { name: 'asc' }],
  })
  return itens.map((i) => {
    const cfg = i.produtos[0] ?? null
    return {
      // Identidade OFICIAL do item. É por ela que o preço é gravado.
      itemCatalogoId: i.id,
      natureza: i.natureza,
      mestre: i.name,
      codigo: i.code,
      categoria: i.categoria?.nome ?? null,
      unidade: i.unidade,
      // Config existente (quando houver). `null` não impede precificar.
      id: cfg?.id ?? null,
      possuiCusto: cfg?.possuiCusto ?? true,
      possuiReceita: cfg?.possuiReceita ?? true,
      moedaPadrao: cfg?.moedaPadrao ?? null,
      label: i.name,
    }
  })
}

// GET - preços ATIVOS (não-legado) + configs (select) + fornecedores + modalidades
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [tabelaValores, configs, fornecedores, tiposProcesso, modalidades] = await Promise.all([
      prisma.tabelaValor.findMany({
        where: { arquivado: false, legadoPendente: false, configuracaoFinanceiraItemId: { not: null } },
        orderBy: [{ prioridade: 'desc' }, { criadoEm: 'desc' }],
        include: {
          fornecedor: { select: { id: true, nome: true, publicCode: true } },
          modalidade: { select: { id: true, modalityLabel: true } },
          configuracaoFinanceiraItem: {
            select: {
              id: true, possuiCusto: true, possuiReceita: true,
              tipoDocumento: { select: { name: true } }, honorario: { select: { name: true } },
              tipoProcesso: { select: { name: true } }, itemCatalogo: { select: { name: true, natureza: true } },
            },
          },
        },
      }),
      listarItensPrecificaveis(),
      prisma.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, publicCode: true } }),
      prisma.tipoProcessoNacionalidade.findMany({ where: { ativo: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.modalidadePais.findMany({ where: { ativo: true }, orderBy: { modalityLabel: 'asc' }, select: { id: true, modalityLabel: true } }),
    ])

    return NextResponse.json({ tabelaValores, configs, fornecedores, tiposProcesso, modalidades })
  } catch (error) {
    console.error('Erro ao listar tabela de valores:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar preço (CHAVE: configuracaoFinanceiraItemId). Fase NÃO entra aqui.
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    // O preço é gravado contra a Configuração Financeira, mas a tela seleciona o
    // ITEM MESTRE — que é o que o operador conhece. Quando o item ainda não tem
    // config, ela é criada aqui, no mesmo caminho oficial usado pelo Catálogo.
    // Isso é o que permite precificar um Documento Mestre nunca precificado sem
    // exigir um cadastro prévio que o operador não teria como adivinhar.
    let configId = toIntOrNull(b.configuracaoFinanceiraItemId)
    const itemCatalogoId = toIntOrNull(b.itemCatalogoId)
    // TIPO DE ITEM declarado pela tela — usado só para VALIDAR o vínculo (não é
    // persistido). Se o tipo escolhido não bate com a natureza real do item, o
    // pedido é recusado: nada de resolver por aproximação ou aceitar em silêncio.
    const itemTipo = toStrOrNull(b.itemTipo)?.toUpperCase() ?? null
    const tipoIncompativel = (natureza: string, tipo: string) =>
      NextResponse.json({ error: `Item incompatível com o tipo selecionado: o item é de natureza ${natureza}, e o tipo escolhido foi ${tipo}.` }, { status: 400 })
    if (itemCatalogoId) {
      const item = await prisma.itemCatalogo.findUnique({
        where: { id: itemCatalogoId },
        select: { id: true, name: true, ativo: true, natureza: true },
      })
      // O vínculo é sempre por ID: item inexistente é erro, nunca busca por nome.
      if (!item) return NextResponse.json({ error: `Item do catálogo inexistente (#${itemCatalogoId}).` }, { status: 400 })
      if (!item.ativo) return NextResponse.json({ error: 'Item inativo não pode receber preço.' }, { status: 400 })
      if (itemTipo && String(item.natureza) !== itemTipo) return tipoIncompativel(String(item.natureza), itemTipo)
      if (!configId) {
        const criada = await garantirConfigFinanceiraDeItem(prisma, { itemCatalogoId: item.id, nome: item.name })
        configId = criada.id
      }
    }
    if (!configId) return NextResponse.json({ error: 'Selecione o item.' }, { status: 400 })

    const cfg = await prisma.produtoFinanceiro.findUnique({
      where: { id: configId },
      select: {
        id: true, possuiCusto: true, possuiReceita: true, naturezaFin: true, itemCatalogoId: true, moedaPadrao: true,
        tipoDocumento: { select: { name: true } }, honorario: { select: { name: true } },
        tipoProcesso: { select: { name: true } }, itemCatalogo: { select: { name: true, natureza: true } },
      },
    })
    if (!cfg) return NextResponse.json({ error: 'Configuração Financeira não encontrada.' }, { status: 404 })
    // Mesma guarda pelo caminho legado (config enviada sem itemCatalogoId).
    if (itemTipo && !itemCatalogoId && cfg.itemCatalogo && String(cfg.itemCatalogo.natureza) !== itemTipo)
      return tipoIncompativel(String(cfg.itemCatalogo.natureza), itemTipo)

    // §2 — o PREÇO define a natureza; deve ser compatível com a NaturezaFinanceira da
    // config. VENDA é a nomenclatura da Tabela de Preços (RECEITA legado ≡ VENDA).
    const natFin = deriveNaturezaFinanceira(cfg)
    const habil = [admiteCusto(natFin) ? 'CUSTO' : null, admiteVenda(natFin) ? 'VENDA' : null].filter(Boolean) as NaturezaPrecoRaw[]

    // Vigência é COMPARTILHADA entre as linhas (custo/venda).
    if (vigenciaInvalida(b.vigenciaInicio) || vigenciaInvalida(b.vigenciaFim))
      return NextResponse.json({ error: 'Vigência deve estar no formato ISO YYYY-MM-DD.' }, { status: 400 })

    // Parâmetros COMPARTILHADOS (uma única vez para todas as linhas).
    const processoTipoId = toStrOrNull(b.processoTipoId)
    const modalidadeId = toIntOrNull(b.modalidadeId)
    const prioridade = toIntOrNull(b.prioridade) ?? 0
    const vigenciaInicio = toStrOrNull(b.vigenciaInicio)
    const vigenciaFim = toStrOrNull(b.vigenciaFim)
    // "Válido a partir de" é OBRIGATÓRIO — define o início da validade comercial e garante
    // que sempre exista uma tabela vigente determinável (sem escolha arbitrária).
    if (!vigenciaInicio) {
      return NextResponse.json({ error: 'Informe "Válido a partir de" (início da validade comercial).' }, { status: 400 })
    }
    if (vigenciaInicio && vigenciaFim && vigenciaInicio > vigenciaFim) {
      return NextResponse.json({ error: '"Válido até" deve ser igual ou posterior a "Válido a partir de".' }, { status: 400 })
    }
    // ESTRATÉGIA de cálculo OBRIGATÓRIA (modoCalculo = código canônico da estratégia).
    const modoCalculo = toStrOrNull(b.modoCalculo) ?? ''
    if (!modoCalculoValido(modoCalculo)) return NextResponse.json({ error: 'Informe uma Estratégia de cálculo válida.' }, { status: 400 })
    // Estratégia comercial (fonte única): decide base/adicional e faixa de quantidade.
    const usaBaseAdic = estrategiaUsaPrimeiroAdicional(modoCalculo)
    const usaFaixa = estrategiaUsaFaixaQuantidade(modoCalculo)
    const ehFixo = estrategiaDoModo(modoCalculo) === 'fixo'
    // UNIDADE DE COBRANÇA — escolhida pelo usuário (fonte única enum UnidadeItem), o que se
    // conta. Obrigatória fora de "Preço fixo" (onde é só referência opcional).
    const unidade = normalizarUnidade(b.unidade)
    if (b.unidade != null && String(b.unidade).trim() !== '' && unidade == null)
      return NextResponse.json({ error: 'Unidade de cobrança inválida.' }, { status: 400 })
    if (!ehFixo && unidade == null)
      return NextResponse.json({ error: 'Selecione a Unidade de cobrança (o que está sendo contado).' }, { status: 400 })
    const parseQtdPos = (v: unknown): number | null => {
      if (!usaFaixa || v === '' || v == null) return null
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : null
    }
    const quantidadeMinima = parseQtdPos(b.quantidadeMinima)
    const quantidadeMaxima = parseQtdPos(b.quantidadeMaxima)
    if (quantidadeMinima != null && quantidadeMaxima != null && quantidadeMinima > quantidadeMaxima) {
      return NextResponse.json({ error: 'Quantidade mínima deve ser menor ou igual à máxima.' }, { status: 400 })
    }
    const mestre = cfg.tipoDocumento?.name ?? cfg.honorario?.name ?? cfg.tipoProcesso?.name ?? cfg.itemCatalogo?.name ?? 'Config'

    // LINHAS a criar. Modo CONJUNTO ("Custo e Venda"): b.linhas = [{natureza,moeda,valor,
    // fornecedorId}, ...]. Modo SIMPLES: uma linha derivada dos campos de topo. Cada linha
    // vira UM registro (1 natureza + 1 valor) — o modelo NÃO comporta dois valores por linha.
    // CONTRATO NOVO (fonte única): checkboxes precoCusto/precoVenda + blocos custo/venda.
    // A natureza é DERIVADA das flags — o novo modelo NÃO envia/exige o campo `natureza`.
    // Legado (linhas[] com natureza, ou natureza/moeda/valor soltos) é aceito só p/ compat.
    let linhasRaw: any[]
    if (usaNovoModeloSelecao(b)) {
      const naturezas = naturezasDeSelecao({ custo: !!b.precoCusto, venda: !!b.precoVenda })
      if (naturezas.length === 0)
        return NextResponse.json({ error: 'Selecione ao menos uma natureza: Preço de Custo e/ou Preço de Venda.' }, { status: 400 })
      linhasRaw = naturezas.map((nat) => {
        const src = (nat === 'CUSTO' ? b.custo : b.venda) ?? {}
        // Venda NÃO leva fornecedor (sem justificativa estrutural para vinculá-lo à venda).
        return { natureza: nat, moeda: src.moeda, valor: src.valor, valorBase: src.valorBase, valorAdicional: src.valorAdicional, fornecedorId: nat === 'CUSTO' ? src.fornecedorId : null }
      })
    } else if (Array.isArray(b.linhas) && b.linhas.length > 0) {
      linhasRaw = b.linhas // LEGADO: linhas com natureza explícita
    } else if (toStrOrNull(b.natureza)) {
      linhasRaw = [{ natureza: b.natureza, moeda: b.moeda, valor: b.valor, valorBase: b.valorBase, valorAdicional: b.valorAdicional, fornecedorId: b.fornecedorId }] // LEGADO
    } else {
      return NextResponse.json({ error: 'Selecione ao menos uma natureza: Preço de Custo e/ou Preço de Venda.' }, { status: 400 })
    }

    // §3 — barreira de DUPLICIDADE (uma leitura; cada linha valida contra o banco E contra
    // as linhas já preparadas nesta mesma operação — custo e venda não colidem entre si).
    const existentes = await prisma.tabelaValor.findMany({
      where: { configuracaoFinanceiraItemId: configId, arquivado: false, legadoPendente: false },
      select: {
        id: true, configuracaoFinanceiraItemId: true, natureza: true, processoTipoId: true, faseKey: true,
        regiao: true, modalidadeId: true, processoId: true, itemCatalogoId: true, fornecedorId: true,
        quantidadeMinima: true, quantidadeMaxima: true, vigenciaInicio: true, vigenciaFim: true, prioridade: true,
      },
    })
    const existentesPreco: PrecoRegistro[] = existentes.map((e): PrecoRegistro => ({
      id: e.id, configuracaoFinanceiraItemId: e.configuracaoFinanceiraItemId, natureza: e.natureza as NaturezaPrecoRaw | null,
      processoTipoId: e.processoTipoId, faseKey: e.faseKey, regiao: e.regiao, modalidadeId: e.modalidadeId,
      processoId: e.processoId, itemCatalogoId: e.itemCatalogoId, fornecedorId: e.fornecedorId,
      quantidadeMinima: e.quantidadeMinima == null ? null : Number(e.quantidadeMinima),
      quantidadeMaxima: e.quantidadeMaxima == null ? null : Number(e.quantidadeMaxima),
      vigenciaInicio: e.vigenciaInicio, vigenciaFim: e.vigenciaFim, prioridade: e.prioridade, arquivado: false, legadoPendente: false,
    }))

    const dados: Array<Record<string, unknown>> = []
    const acumuladas: PrecoRegistro[] = []
    for (const ln of linhasRaw) {
      const naturezaReq = (toStrOrNull(ln.natureza)?.toUpperCase() ?? null) as NaturezaPrecoRaw | null
      const naturezaInput = naturezaReq ?? (habil.length === 1 ? habil[0] : null)
      if (!naturezaInput || !['CUSTO', 'RECEITA', 'VENDA'].includes(naturezaInput))
        return NextResponse.json({ error: 'Informe a natureza do preço (CUSTO ou VENDA).' }, { status: 400 })
      const compat = validarNaturezaPreco(natFin, naturezaInput)
      if (!compat.ok) return NextResponse.json({ error: compat.motivo }, { status: 400 })
      const natureza = canonicalNaturezaPreco(naturezaInput) as 'CUSTO' | 'VENDA'
      const rotulo = natureza === 'CUSTO' ? 'custo' : 'venda'

      // Preço PRIMEIRO+ADICIONAL (estratégia por requerente): valorBase = primeiro;
      // valorAdicional = cada adicional. `valor` acompanha valorBase (compat de leitura).
      const valorBase = usaBaseAdic ? toAmountOrNull(ln.valorBase) : null
      const valorAdicional = usaBaseAdic ? toAmountOrNull(ln.valorAdicional) : null
      if ((valorBase == null) !== (valorAdicional == null))
        return NextResponse.json({ error: `Para ${rotulo}, informe Primeiro requerente e Requerente adicional juntos (ou nenhum).` }, { status: 400 })
      if (valorBase != null && valorBase <= 0) return NextResponse.json({ error: `Primeiro requerente (${rotulo}) deve ser maior que zero.` }, { status: 400 })
      if (valorAdicional != null && valorAdicional < 0) return NextResponse.json({ error: `Requerente adicional (${rotulo}) não pode ser negativo.` }, { status: 400 })

      const valor = valorBase != null ? valorBase : toAmount(ln.valor)
      if (valor <= 0) return NextResponse.json({ error: `Valor de ${rotulo} deve ser maior que zero (sem negativos; isenção não é modelada aqui).` }, { status: 400 })
      if (!toStrOrNull(ln.moeda) && !cfg.moedaPadrao) return NextResponse.json({ error: `Informe a moeda de ${rotulo}.` }, { status: 400 })
      const fornecedorId = toIntOrNull(ln.fornecedorId)
      const moeda = toStrOrNull(ln.moeda) || cfg.moedaPadrao || 'BRL'

      const candidata: PrecoRegistro = {
        configuracaoFinanceiraItemId: configId, natureza, processoTipoId, faseKey: toStrOrNull(b.faseKey),
        regiao: toStrOrNull(b.regiao), modalidadeId, processoId: toIntOrNull(b.processoId), itemCatalogoId: cfg.itemCatalogoId, fornecedorId,
        quantidadeMinima, quantidadeMaxima, vigenciaInicio, vigenciaFim, prioridade, arquivado: false, legadoPendente: false,
      }
      const conflito = detectarConflitoPreco(candidata, [...existentesPreco, ...acumuladas])
      if (!conflito.ok) return NextResponse.json({ error: conflito.motivo, conflitantes: conflito.conflitantes }, { status: 409 })
      acumuladas.push(candidata)

      const ctxNome = [processoTipoId, fornecedorId ? `forn.${fornecedorId}` : null].filter(Boolean).join(' · ')
      const nomeBase = (linhasRaw.length === 1 && toStrOrNull(b.name)) || `${mestre} · ${natureza}${ctxNome ? ' · ' + ctxNome : ''}`
      dados.push({
        name: nomeBase.slice(0, 200),
        configuracaoFinanceiraItemId: configId,
        itemCatalogoId: cfg.itemCatalogoId, // compat de leitura; chave real é a config
        natureza,
        processoTipoId, processoId: toIntOrNull(b.processoId), modalidadeId, fornecedorId, regiao: toStrOrNull(b.regiao),
        moeda, valor, valorBase, valorAdicional, modoCalculo, unidade, quantidadeMinima, quantidadeMaxima, vigenciaInicio, vigenciaFim,
        prioridade, arquivado: false, legadoPendente: false,
      })
    }

    // ATOMICIDADE — os N registros (1 no modo simples; 2 em "Custo e Venda") são criados
    // numa ÚNICA transação. Se qualquer um falhar (constraint/erro), TODA a operação é
    // desfeita — nunca fica só metade do cadastro persistido.
    try {
      const regras = await prisma.$transaction(
        dados.map((d) => prisma.tabelaValor.create({ data: d as never, include: { fornecedor: { select: { id: true, nome: true, publicCode: true } } } })),
      )
      // P4 — cadastrou preço: reprocessa (best-effort) as pendências financeiras desta config.
      reprocessarPendenciasFinanceiras({ configItemId: configId }).catch((e) => console.error('[reprocesso pendências pós-preço]', e))
      await registrarAuditoria(request, { acao: 'CRIAR', entidade: 'TabelaValor', entidadeId: regras[0]?.id ?? null, descricao: `Preço cadastrado (${regras.length} linha(s), config #${configId})` })
      return NextResponse.json(regras.length === 1 ? { regra: regras[0] } : { regras })
    } catch (e: any) {
      const mapped = mapDbError(e)
      if (mapped) return mapped
      throw e
    }
  } catch (error) {
    console.error('Erro ao criar preço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
