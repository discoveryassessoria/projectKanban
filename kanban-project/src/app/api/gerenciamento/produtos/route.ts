// src/app/api/gerenciamento/produtos/route.ts
// GET  - Listar produtos financeiros / itens cobrados
// POST - Criar produto (Catálogo Financeiro)
// Campos do mockup: codigo(req), nome(req), especie, naturezaFinanceira,
//   categoriaId(→Categoria), planoContaId(→Conta contábil), moedaPadrao,
//   valorPadrao, cobravelDoCliente, custoInterno, repasse, reembolsavel.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { sincronizarItemDeProduto } from '@/src/services/catalogo-sync'

const MOEDAS = ['BRL', 'EUR', 'USD']
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Configuração Financeira (ProdutoFinanceiro) inclui os mestres reais por FK.
// O código/nome de NEGÓCIO vêm SEMPRE do cadastro mestre — nunca de campo derivado.
const MASTER_INCLUDE = {
  categoria: { select: { id: true, nome: true } },
  planoConta: { select: { id: true, codigo: true, nome: true } },
  tipoDocumento: { select: { code: true, name: true } },
  honorario: { select: { code: true, name: true } },
  tipoProcesso: { select: { code: true, name: true } },
  // Serviço mestre real (ServicoProduto) via item-pivô; code/name reais, nunca SRV_.
  itemCatalogo: {
    select: {
      natureza: true,
      name: true,
      servicos: { select: { code: true, name: true }, orderBy: { id: 'asc' as const }, take: 1 },
    },
  },
} as const

/** Resolve o mestre REAL (nome + código de negócio) por relação — nunca campo derivado. */
function resolverMestre(p: any): { origem: string; codigo: string | null; nome: string } | null {
  if (p.tipoDocumento) return { origem: 'documento', codigo: p.tipoDocumento.code ?? null, nome: p.tipoDocumento.name }
  if (p.honorario) return { origem: 'honorario', codigo: p.honorario.code ?? null, nome: p.honorario.name }
  if (p.tipoProcesso) return { origem: 'processo', codigo: p.tipoProcesso.code ?? null, nome: p.tipoProcesso.name }
  const svc = p.itemCatalogo?.servicos?.[0]
  if (svc) return { origem: 'servico', codigo: svc.code ?? null, nome: svc.name }
  if (p.itemCatalogo) return { origem: 'item', codigo: null, nome: p.itemCatalogo.name }
  return null
}

// ID técnico interno da configuração — referencia o mestre por ID (nunca copia/deriva
// o CÓDIGO de negócio do mestre). Preenche a coluna NOT NULL `codigo`; NÃO é exibido na
// interface. UMA config por mestre ⇒ sem sufixo de papel (custo/receita são valores).
const PREFIXO_ORIGEM: Record<string, string> = { documento: 'DOC', honorario: 'HON', processo: 'PRC', servico: 'SRV', item: 'SRV' }
function codigoTecnicoConfig(origem: string, masterFkId: number): string {
  return `CFG_${PREFIXO_ORIGEM[origem] ?? 'CFG'}_${masterFkId}`.slice(0, 30)
}

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    // F3.2 — além dos itens, devolve os MESTRES para o select pesquisável por origem.
    const [produtosRaw, tiposDocumento, servicosRaw, honorarios, tiposProcesso, fornecedores] = await Promise.all([
      prisma.produtoFinanceiro.findMany({
        orderBy: { nome: 'asc' },
        include: MASTER_INCLUDE,
      }),
      prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      // Serviços mestres: o SELECT expõe o código/nome REAIS do ServicoProduto (nunca SRV_).
      // `id` é o do item-pivô (ItemCatalogo) — a FK que a config grava para Serviço.
      prisma.servicoProduto.findMany({ where: { ativo: true, itemCatalogoId: { not: null } }, select: { itemCatalogoId: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.honorario.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.tipoProcessoNacionalidade.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.fornecedor.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
    ])

    // Anexa o mestre RESOLVIDO (nome/código reais por relação) a cada configuração.
    const produtos = produtosRaw.map((p) => ({ ...p, mestre: resolverMestre(p) }))
    const servicos = servicosRaw.map((x) => ({ id: x.itemCatalogoId, code: x.code, name: x.name }))

    return NextResponse.json({ produtos, mestres: { tiposDocumento, servicos, honorarios, tiposProcesso, fornecedores } })
  } catch (error) {
    console.error('Erro ao listar produtos:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    if (b.moedaPadrao && !MOEDAS.includes(b.moedaPadrao)) {
      return NextResponse.json({ error: 'Moeda inválida' }, { status: 400 })
    }

    // A configuração REFERENCIA um cadastro mestre por FK. Nome e código de negócio
    // são resolvidos do mestre — o cliente NÃO envia código/nome (nada é derivado aqui).
    // UMA config por mestre: custo e receita são VALORES desta config (flags + valores).
    const possuiCusto = !!b.possuiCusto || parseDecimal(b.valorCustoPadrao) != null
    const possuiReceita = !!b.possuiReceita || parseDecimal(b.valorReceitaPadrao) != null

    let origem: string
    let masterFkId: number
    let masterNome: string
    let docItemCatalogoId: number | null = null
    if (b.tipoDocumentoId) {
      const td = await prisma.tipoDocumentoCadastro.findUnique({ where: { id: Number(b.tipoDocumentoId) }, select: { name: true, itemCatalogoId: true } })
      if (!td) return NextResponse.json({ error: 'Documento mestre não encontrado' }, { status: 400 })
      origem = 'documento'; masterFkId = Number(b.tipoDocumentoId); masterNome = td.name; docItemCatalogoId = td.itemCatalogoId
    } else if (b.honorarioId) {
      const h = await prisma.honorario.findUnique({ where: { id: Number(b.honorarioId) }, select: { name: true } })
      if (!h) return NextResponse.json({ error: 'Honorário mestre não encontrado' }, { status: 400 })
      origem = 'honorario'; masterFkId = Number(b.honorarioId); masterNome = h.name
    } else if (b.tipoProcessoId) {
      const tp = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: Number(b.tipoProcessoId) }, select: { name: true } })
      if (!tp) return NextResponse.json({ error: 'Processo mestre não encontrado' }, { status: 400 })
      origem = 'processo'; masterFkId = Number(b.tipoProcessoId); masterNome = tp.name
    } else if (b.itemCatalogoId) {
      const svc = await prisma.servicoProduto.findFirst({ where: { itemCatalogoId: Number(b.itemCatalogoId) }, select: { name: true } })
      const item = svc ? null : await prisma.itemCatalogo.findUnique({ where: { id: Number(b.itemCatalogoId) }, select: { name: true } })
      const nomeMestre = svc?.name ?? item?.name
      if (!nomeMestre) return NextResponse.json({ error: 'Serviço mestre não encontrado' }, { status: 400 })
      origem = 'servico'; masterFkId = Number(b.itemCatalogoId); masterNome = nomeMestre
    } else {
      return NextResponse.json({ error: 'Selecione a entidade mestre (documento, serviço, honorário ou processo).' }, { status: 400 })
    }

    // Nome = nome REAL do mestre. Código = ID técnico interno (referencia o mestre por
    // ID, nunca copia/deriva o código de negócio). A exibição resolve o código do mestre.
    const nome = masterNome
    const codigo = codigoTecnicoConfig(origem, masterFkId)

    // LOTE B — dual-write: ItemCatalogo (mestre, natureza PRODUTO) e vínculo por ID.
    const produto = await prisma.$transaction(async (tx) => {
      // O pivô itemCatalogoId vem do MESTRE escolhido (não recria mirror):
      //   documento → itemCatalogo do TipoDocumento;  serviço → o próprio ItemCatalogo.
      //   Só cria mirror quando não há mestre com item (honorário/processo/legado).
      let itemCatalogoId: number | null = docItemCatalogoId
      if (itemCatalogoId == null && origem === 'servico') itemCatalogoId = masterFkId
      if (itemCatalogoId == null) itemCatalogoId = await sincronizarItemDeProduto(tx, { codigo, nome })
      return tx.produtoFinanceiro.create({
        data: {
          codigo,
          nome,
          especie: s(b.especie),
          naturezaFinanceira: b.naturezaFinanceira || 'revenue',
          categoriaId: b.categoriaId ? Number(b.categoriaId) : null,
          planoContaId: b.planoContaId ? Number(b.planoContaId) : null,
          moedaPadrao: b.moedaPadrao || 'BRL',
          valorPadrao: parseDecimal(b.valorPadrao),
          cobravelDoCliente: !!b.cobravelDoCliente,
          custoInterno: !!b.custoInterno,
          repasse: !!b.repasse,
          reembolsavel: !!b.reembolsavel,
          ativo: b.ativo === undefined ? true : !!b.ativo,
          // M-UNIFICA — Configuração Financeira ÚNICA por mestre: custo e receita são
          // VALORES desta config (papel só em TabelaValor.natureza). FKs diretas ao mestre.
          possuiCusto,
          possuiReceita,
          valorCustoPadrao: parseDecimal(b.valorCustoPadrao),
          valorReceitaPadrao: parseDecimal(b.valorReceitaPadrao),
          tipoDocumentoId: b.tipoDocumentoId ? Number(b.tipoDocumentoId) : null,
          honorarioId: b.honorarioId ? Number(b.honorarioId) : null,
          tipoProcessoId: b.tipoProcessoId ? Number(b.tipoProcessoId) : null,
          fornecedorPadraoId: b.fornecedorPadraoId ? Number(b.fornecedorPadraoId) : null,
          itemCatalogoId,
        },
      })
    })

    return NextResponse.json({ produto }, { status: 201 })
  } catch (error: any) {
    // UMA config por mestre (unique itemCatalogoId): duplicidade → 409 explícito.
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe uma Configuração Financeira para este cadastro mestre.' }, { status: 409 })
    }
    console.error('Erro ao criar produto:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}