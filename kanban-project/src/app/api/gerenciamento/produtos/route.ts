// src/app/api/gerenciamento/produtos/route.ts
// GET  - Listar produtos financeiros / itens cobrados
// POST - Criar produto (Catálogo Financeiro)
// Campos: codigo(req), nome(req), especie, naturezaFin, moedaPadrao, cobravelDoCliente,
//   repasse, reembolsavel, regraComissaoId (comissão quando aplicável), ativo.
// A classificação intermediária (categoria/conta contábil/centro de custo) foi
// ELIMINADA em 02/08/2026: comportamento financeiro pertence ao cadastro mestre.

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
  regraComissao: { select: { id: true, name: true, ativo: true } },
  tipoDocumento: { select: { code: true, name: true } },
  honorario: { select: { code: true, name: true } },
  tipoProcesso: { select: { code: true, name: true } },
  // Serviço mestre real (ServicoProduto) via item-pivô; code/name reais, nunca SRV_.
  itemCatalogo: {
    select: {
      natureza: true,
      name: true,
      servicos: { select: { code: true, name: true, publicCode: true }, orderBy: { id: 'asc' as const }, take: 1 },
    },
  },
} as const

/** Resolve o mestre REAL (nome + chave técnica + publicCode quando o mestre for uma entidade com
 *  código público, ex.: Serviço → SRV-n). `codigo` = chave técnica; `publicCode` = código público. */
function resolverMestre(p: any): { origem: string; codigo: string | null; nome: string; publicCode: string | null } | null {
  if (p.tipoDocumento) return { origem: 'documento', codigo: p.tipoDocumento.code ?? null, nome: p.tipoDocumento.name, publicCode: null }
  if (p.honorario) return { origem: 'honorario', codigo: p.honorario.code ?? null, nome: p.honorario.name, publicCode: null }
  if (p.tipoProcesso) return { origem: 'processo', codigo: p.tipoProcesso.code ?? null, nome: p.tipoProcesso.name, publicCode: null }
  const svc = p.itemCatalogo?.servicos?.[0]
  if (svc) return { origem: 'servico', codigo: svc.code ?? null, nome: svc.name, publicCode: svc.publicCode ?? null }
  if (p.itemCatalogo) return { origem: 'item', codigo: null, nome: p.itemCatalogo.name, publicCode: null }
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
    // A tabela legada Honorario NÃO é consultada: honorário deixou de ser cadastro
    // mestre (é Serviço do Catálogo Mestre). Configurações antigas seguem legíveis
    // pelo próprio vínculo do registro, sem lista de seleção.
    const [produtosRaw, tiposDocumento, servicosRaw, tiposProcesso, fornecedores] = await Promise.all([
      prisma.produtoFinanceiro.findMany({
        orderBy: { nome: 'asc' },
        include: MASTER_INCLUDE,
      }),
      prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      // Serviços mestres: o SELECT expõe o código/nome REAIS do ServicoProduto (nunca SRV_).
      // `id` é o do item-pivô (ItemCatalogo) — a FK que a config grava para Serviço.
      prisma.servicoProduto.findMany({ where: { ativo: true, itemCatalogoId: { not: null } }, select: { itemCatalogoId: true, code: true, name: true, publicCode: true }, orderBy: { name: 'asc' } }),
      prisma.tipoProcessoNacionalidade.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.fornecedor.findMany({ where: { ativo: true }, select: { id: true, nome: true, publicCode: true }, orderBy: { nome: "asc" } }),
    ])

    // Anexa o mestre RESOLVIDO (nome/código reais por relação) a cada configuração.
    const produtos = produtosRaw.map((p) => ({ ...p, mestre: resolverMestre(p) }))
    const servicos = servicosRaw.map((x) => ({ id: x.itemCatalogoId, code: x.code, name: x.name, publicCode: x.publicCode }))

    return NextResponse.json({ produtos, mestres: { tiposDocumento, servicos, tiposProcesso, fornecedores } })
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
    // PREÇO-FONTE-ÚNICA — Natureza Financeira (estrutural) deriva as flags quando enviada.
    const natFinReq = typeof b.naturezaFin === 'string' && ['SOMENTE_CUSTO', 'SOMENTE_RECEITA', 'CUSTO_E_RECEITA'].includes(b.naturezaFin) ? b.naturezaFin : undefined
    const possuiCusto = natFinReq ? natFinReq !== 'SOMENTE_RECEITA' : (!!b.possuiCusto || parseDecimal(b.valorCustoPadrao) != null)
    const possuiReceita = natFinReq ? natFinReq !== 'SOMENTE_CUSTO' : (!!b.possuiReceita || parseDecimal(b.valorReceitaPadrao) != null)

    // REEMBOLSÁVEL — significado exclusivo: os CUSTOS gerados podem ser reembolsados. Só se gera custo.
    if (!!b.reembolsavel && !possuiCusto) {
      return NextResponse.json({ error: 'Reembolsável só se aplica a itens que geram custo (o reembolso é do custo pelo cliente).' }, { status: 400 })
    }

    let origem: string
    let masterFkId: number
    let masterNome: string
    let docItemCatalogoId: number | null = null
    if (b.tipoDocumentoId) {
      const td = await prisma.tipoDocumentoCadastro.findUnique({ where: { id: Number(b.tipoDocumentoId) }, select: { name: true, itemCatalogoId: true } })
      if (!td) return NextResponse.json({ error: 'Documento mestre não encontrado' }, { status: 400 })
      origem = 'documento'; masterFkId = Number(b.tipoDocumentoId); masterNome = td.name; docItemCatalogoId = td.itemCatalogoId
    } else if (b.honorarioId) {
      // MESTRE LEGADO: a tabela Honorario saiu da arquitetura — honorário é um
      // SERVIÇO do Catálogo Mestre + esta Configuração Financeira + preço na
      // Tabela de Valores. Configurações antigas continuam legíveis; nenhuma nova
      // nasce daqui (senão o espelho volta a alimentar o seletor de lançamento).
      return NextResponse.json({ error: 'Honorário não é mais um cadastro mestre: cadastre o serviço no Catálogo Mestre e configure o preço na Tabela de Valores.' }, { status: 400 })
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
          regraComissaoId: b.regraComissaoId ? Number(b.regraComissaoId) : null,
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
          naturezaFin: (natFinReq ?? (possuiCusto && possuiReceita ? 'CUSTO_E_RECEITA' : possuiCusto ? 'SOMENTE_CUSTO' : 'SOMENTE_RECEITA')) as never,
          valorCustoPadrao: parseDecimal(b.valorCustoPadrao),
          valorReceitaPadrao: parseDecimal(b.valorReceitaPadrao),
          tipoDocumentoId: b.tipoDocumentoId ? Number(b.tipoDocumentoId) : null,
          honorarioId: null, // mestre legado: nenhuma configuração NOVA aponta para ele
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