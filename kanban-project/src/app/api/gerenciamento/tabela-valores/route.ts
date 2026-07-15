import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

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

// Rótulo canônico "Origem · Cadastro mestre · Papel" de uma Configuração Financeira.
async function listarConfigs() {
  const cfgs = await prisma.produtoFinanceiro.findMany({
    where: { ativo: true, papelFinanceiro: { not: null } },
    select: {
      id: true, papelFinanceiro: true, moedaPadrao: true,
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
    return { id: c.id, papel: c.papelFinanceiro, moedaPadrao: c.moedaPadrao, origem, mestre, label: `${origem} · ${mestre} · ${c.papelFinanceiro}` }
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
              id: true, papelFinanceiro: true,
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
        id: true, papelFinanceiro: true, itemCatalogoId: true, moedaPadrao: true,
        tipoDocumento: { select: { name: true } }, honorario: { select: { name: true } },
        tipoProcesso: { select: { name: true } }, itemCatalogo: { select: { name: true, natureza: true } },
      },
    })
    if (!cfg) return NextResponse.json({ error: 'Configuração Financeira não encontrada.' }, { status: 404 })

    const valor = toAmount(b.valor)
    if (valor <= 0) return NextResponse.json({ error: 'Valor deve ser maior que zero (isenção não é modelada aqui).' }, { status: 400 })
    if (vigenciaInvalida(b.vigenciaInicio) || vigenciaInvalida(b.vigenciaFim))
      return NextResponse.json({ error: 'Vigência deve estar no formato ISO YYYY-MM-DD.' }, { status: 400 })

    const fornecedorId = toIntOrNull(b.fornecedorId)
    const processoTipoId = toStrOrNull(b.processoTipoId)
    const modalidadeId = toIntOrNull(b.modalidadeId)
    const prioridade = toIntOrNull(b.prioridade) ?? 0
    const vigenciaInicio = toStrOrNull(b.vigenciaInicio)
    const vigenciaFim = toStrOrNull(b.vigenciaFim)

    // nome DERIVADO: [mestre] · [papel] · [contexto]
    const mestre = cfg.tipoDocumento?.name ?? cfg.honorario?.name ?? cfg.tipoProcesso?.name ?? cfg.itemCatalogo?.name ?? 'Config'
    const ctxNome = [processoTipoId, fornecedorId ? `forn.${fornecedorId}` : null].filter(Boolean).join(' · ')
    const name = toStrOrNull(b.name) || `${mestre} · ${cfg.papelFinanceiro}${ctxNome ? ' · ' + ctxNome : ''}`.slice(0, 200)

    // natureza espelha o papel (compat com o resolver por item), mas a CHAVE é a config.
    const natureza = cfg.papelFinanceiro === 'CUSTO' ? 'CUSTO' : cfg.papelFinanceiro === 'RECEITA' ? 'RECEITA' : null

    try {
      const regra = await prisma.tabelaValor.create({
        data: {
          name,
          configuracaoFinanceiraItemId: configId,
          itemCatalogoId: cfg.itemCatalogoId, // compat de leitura; chave real é a config
          natureza: natureza as never,
          processoTipoId,
          processoId: toIntOrNull(b.processoId),
          modalidadeId,
          fornecedorId,
          regiao: toStrOrNull(b.regiao),
          moeda: b.moeda || cfg.moedaPadrao || 'BRL',
          valor,
          modoCalculo: toStrOrNull(b.modoCalculo) || 'fixed',
          unidade: toStrOrNull(b.unidade),
          quantidadeMinima: b.quantidadeMinima === '' || b.quantidadeMinima == null ? null : Number(b.quantidadeMinima),
          quantidadeMaxima: b.quantidadeMaxima === '' || b.quantidadeMaxima == null ? null : Number(b.quantidadeMaxima),
          vigenciaInicio,
          vigenciaFim,
          prioridade,
          arquivado: false,
          legadoPendente: false,
        },
        include: { fornecedor: { select: { id: true, nome: true } } },
      })
      return NextResponse.json({ regra })
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
