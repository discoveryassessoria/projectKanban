// src/app/api/gerenciamento/catalogo-mestre/route.ts
// LOTE D — Catálogo Mestre (ItemCatalogo): a FONTE ÚNICA de itens.
// GET lista; POST cria. Espelha o padrão de tabela-valores (verificarPermissao).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { NaturezaItem, UnidadeItem } from '@prisma/client'
import { slugTecnico, gerarChaveUnica } from '@/src/lib/catalogo/chave-tecnica-interna'
import { NATUREZAS_ITEM_OFICIAIS } from '@/lib/financeiro/catalogo-oficial'
import { resolverCategoriaServico } from '@/src/services/categoria-servico-ref'
import { parseConsulta, filtroBusca, filtroAtivo, filtroRefs, ordenacao, meta } from '@/lib/gerenciamento/consulta'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
// Só as naturezas OFICIAIS são cadastráveis. PRODUTO/HONORARIO continuam no enum
// do banco para LEITURA de itens históricos, mas não são mais oferecidas nem
// aceitas — são estruturas eliminadas da arquitetura (lib/financeiro/catalogo-oficial).
const NATUREZAS = NATUREZAS_ITEM_OFICIAIS.map((n) => NaturezaItem[n])
const UNIDADES = Object.values(UnidadeItem)

// GET - lista itens do catálogo (+ contadores de uso, p/ mostrar ligações)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    // Busca/ordenação/paginação/ativo via query params OPCIONAIS (retrocompatível).
    const c = parseConsulta(new URL(request.url).searchParams)
    // Busca livre SÓ em conteúdo próprio do registro (nome, código, descrição).
    // Categoria é entidade: filtra-se por id, nunca por texto.
    const where = { ...filtroBusca(c.q, ['name', 'code', 'descricao']), ...filtroAtivo(c), ...filtroRefs(c, ['categoriaId']) }
    const [total, itens] = await Promise.all([
      prisma.itemCatalogo.count({ where }),
      prisma.itemCatalogo.findMany({
        where,
        orderBy: ordenacao(c, ['name', 'code', 'natureza', 'criadoEm'], [{ natureza: 'asc' }, { name: 'asc' }]),
        skip: c.skip,
        take: c.take,
        include: {
          categoria: { select: { id: true, code: true, nome: true } },
          _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } },
        },
      }),
    ])
    return NextResponse.json({ itens, naturezas: NATUREZAS, unidades: UNIDADES, meta: meta(total, c) })
  } catch (error) {
    console.error('Erro ao listar catálogo mestre:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - cria item
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const b = await request.json()
    const name = toStrOrNull(b.name)
    if (!name) return NextResponse.json({ error: 'Informe o nome do item.' }, { status: 400 })

    // Natureza eliminada é RECUSADA (não vira OUTRO em silêncio): o operador precisa
    // saber que aquele cadastro não existe mais na arquitetura.
    if (b.natureza !== undefined && b.natureza !== null && !NATUREZAS.includes(b.natureza)) {
      return NextResponse.json({ error: `Natureza "${b.natureza}" não existe mais no Cadastro Mestre. Use uma das oficiais: ${NATUREZAS.join(', ')}.` }, { status: 400 })
    }
    // SERVIÇO NÃO NASCE AQUI. O portador do código canônico SRV-n é
    // ServicoProduto.publicCode; item de mestre não tem onde carregá-lo e
    // apareceria no Catálogo sem código. Quem cadastra serviço é a rota do
    // Catálogo de Serviços, que cria o par (serviço + item) na mesma transação.
    if (b.natureza === NaturezaItem.SERVICO) {
      return NextResponse.json({
        error: 'Serviço não é cadastrado como item do mestre — ele nasce no Catálogo de Serviços, que gera o código SRV-n. Use POST /api/gerenciamento/produtos-servicos.',
      }, { status: 400 })
    }
    // CATEGORIA — referência estrutural: id oficial, conferido no cadastro.
    const categoria = await resolverCategoriaServico(b)
    if (categoria.erros.length) {
      return NextResponse.json({ error: categoria.erros[0].mensagem, erros: categoria.erros }, { status: 400 })
    }
    const natureza = b.natureza ?? NaturezaItem.OUTRO
    const unidade = UNIDADES.includes(b.unidade) ? b.unidade : UnidadeItem.UNIDADE

    // CHAVE TÉCNICA INTERNA: gerada no backend a partir do nome (o operador nunca informa `code`).
    const code = await gerarChaveUnica(slugTecnico(name, 'ITEM'), async (c) =>
      !!(await prisma.itemCatalogo.findUnique({ where: { code: c }, select: { id: true } })),
    )

    const item = await prisma.itemCatalogo.create({
      data: { code, name, descricao: toStrOrNull(b.descricao), natureza, categoriaId: categoria.categoriaId, unidade, ativo: b.ativo !== false },
    })
    await registrarAuditoria(request, { acao: 'CRIAR', entidade: 'ItemCatalogo', entidadeId: item.id, descricao: `Item mestre criado: ${name}`, detalhes: { code, natureza, categoriaId: item.categoriaId } })
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar item do catálogo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}