import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { deriveNaturezaFinanceira, validarNaturezaPreco, canonicalNaturezaPreco, admiteCusto, admiteVenda, type NaturezaPrecoRaw } from '@/lib/financeiro/natureza-financeira'
import { detectarConflitoPreco, type PrecoRegistro } from '@/lib/financeiro/conflito-preco'
import { modoCalculoValido, unidadeDoModo, modoUsaQuantidade } from '@/lib/financeiro/modo-calculo'

function toAmount(v: any): number {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
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

// Rótulo canônico "Origem · Cadastro mestre" de uma Configuração Financeira (UMA por
// mestre). O papel NÃO faz parte da config: o preço escolhe a natureza (CUSTO/RECEITA)
// dentre as que a config habilita (possuiCusto/possuiReceita).
async function listarConfigs() {
  const cfgs = await prisma.produtoFinanceiro.findMany({
    where: { ativo: true },
    select: {
      id: true, possuiCusto: true, possuiReceita: true, moedaPadrao: true,
      tipoDocumento: { select: { name: true } },
      honorario: { select: { name: true } },
      tipoProcesso: { select: { name: true } },
      itemCatalogo: { select: { name: true, natureza: true } },
    },
    orderBy: { id: 'asc' },
  })
  return cfgs.map((c) => {
    const origem = c.tipoDocumento ? 'Documento' : c.honorario ? 'Honorário' : c.tipoProcesso ? 'Processo' : (c.itemCatalogo?.natureza === 'SERVICO' ? 'Serviço' : 'Item')
    const mestre = c.tipoDocumento?.name ?? c.honorario?.name ?? c.tipoProcesso?.name ?? c.itemCatalogo?.name ?? '—'
    return { id: c.id, possuiCusto: c.possuiCusto, possuiReceita: c.possuiReceita, moedaPadrao: c.moedaPadrao, origem, mestre, label: `${origem} · ${mestre}` }
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
          fornecedor: { select: { id: true, nome: true } },
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
      listarConfigs(),
      prisma.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
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
    const configId = toIntOrNull(b.configuracaoFinanceiraItemId)
    if (!configId) return NextResponse.json({ error: 'Selecione a Configuração Financeira.' }, { status: 400 })

    const cfg = await prisma.produtoFinanceiro.findUnique({
      where: { id: configId },
      select: {
        id: true, possuiCusto: true, possuiReceita: true, naturezaFin: true, itemCatalogoId: true, moedaPadrao: true,
        tipoDocumento: { select: { name: true } }, honorario: { select: { name: true } },
        tipoProcesso: { select: { name: true } }, itemCatalogo: { select: { name: true, natureza: true } },
      },
    })
    if (!cfg) return NextResponse.json({ error: 'Configuração Financeira não encontrada.' }, { status: 404 })

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
    // Modo de cálculo OBRIGATÓRIO e válido. A UNIDADE é DERIVADA do modo (fonte única
    // `unidadeDoModo`) — ignoramos qualquer `unidade` enviada pelo cliente (não confiar na UI).
    const modoCalculo = toStrOrNull(b.modoCalculo) ?? ''
    if (!modoCalculoValido(modoCalculo)) return NextResponse.json({ error: 'Informe um Modo de cálculo válido.' }, { status: 400 })
    const unidade = unidadeDoModo(modoCalculo) // fixed → null; demais → unidade canônica
    // `fixed` não usa faixa de quantidade → normaliza min/max para null.
    const usaQtd = modoUsaQuantidade(modoCalculo)
    const quantidadeMinima = usaQtd && !(b.quantidadeMinima === '' || b.quantidadeMinima == null) ? Number(b.quantidadeMinima) : null
    const quantidadeMaxima = usaQtd && !(b.quantidadeMaxima === '' || b.quantidadeMaxima == null) ? Number(b.quantidadeMaxima) : null
    const mestre = cfg.tipoDocumento?.name ?? cfg.honorario?.name ?? cfg.tipoProcesso?.name ?? cfg.itemCatalogo?.name ?? 'Config'

    // LINHAS a criar. Modo CONJUNTO ("Custo e Venda"): b.linhas = [{natureza,moeda,valor,
    // fornecedorId}, ...]. Modo SIMPLES: uma linha derivada dos campos de topo. Cada linha
    // vira UM registro (1 natureza + 1 valor) — o modelo NÃO comporta dois valores por linha.
    const linhasRaw: any[] = Array.isArray(b.linhas) && b.linhas.length > 0
      ? b.linhas
      : [{ natureza: b.natureza, moeda: b.moeda, valor: b.valor, fornecedorId: b.fornecedorId }]

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

      const valor = toAmount(ln.valor)
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
        moeda, valor, modoCalculo, unidade, quantidadeMinima, quantidadeMaxima, vigenciaInicio, vigenciaFim,
        prioridade, arquivado: false, legadoPendente: false,
      })
    }

    // ATOMICIDADE — os N registros (1 no modo simples; 2 em "Custo e Venda") são criados
    // numa ÚNICA transação. Se qualquer um falhar (constraint/erro), TODA a operação é
    // desfeita — nunca fica só metade do cadastro persistido.
    try {
      const regras = await prisma.$transaction(
        dados.map((d) => prisma.tabelaValor.create({ data: d as never, include: { fornecedor: { select: { id: true, nome: true } } } })),
      )
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
