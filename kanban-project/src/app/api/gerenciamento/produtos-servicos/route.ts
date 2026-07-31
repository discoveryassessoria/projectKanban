import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { sincronizarItemDeServico } from '@/src/services/catalogo-sync'
import { garantirConfigFinanceiraDeItem } from '@/src/services/config-financeira-auto'
import { slugTecnico, gerarChaveUnica } from '@/src/lib/catalogo/chave-tecnica-interna'
import { resolverAplicacaoTerritorial, gravarAplicacaoTerritorial } from '@/src/services/aplicacao-territorial-servico'
import { resolverCategoriaServico } from '@/src/services/categoria-servico-ref'

function toStrOrNull(v: any): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
// GET - Cadastro MESTRE operacional de Serviços (sem financeiro).
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    // A relação M2M legada (itensFinanceiros) permanece no banco (dados preservados),
    // mas NÃO é exibida/gerenciada aqui — o vínculo financeiro é feito em Configurações Financeiras.
    //
    // ADITIVO: o espelho no Cadastro Mestre vem junto (natureza/unidade + contadores
    // de vínculo). É o que permite ao Catálogo de Serviços ser a ÚNICA tela sobre o
    // mestre — mostrando tipo, unidade e vínculos sem uma segunda tela técnica.
    // APLICAÇÃO TERRITORIAL: vem junto a seleção real (vínculos N:N, na ordem de
    // criação) e o cadastro oficial de países que alimenta o seletor da tela —
    // uma carga, sem segunda chamada e sem a tela manter lista própria de nacionalidades.
    const [servicos, paisesCatalogo, categoriasCatalogo] = await Promise.all([
      prisma.servicoProduto.findMany({
        orderBy: { code: 'asc' },
        include: {
          itemCatalogo: {
            select: {
              id: true, natureza: true, unidade: true, categoriaId: true,
              categoria: { select: { id: true, nome: true } },
              _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } },
            },
          },
          paises: { select: { paisId: true }, orderBy: { criadoEm: 'asc' } },
        },
      }),
      prisma.catalogoPais.findMany({
        where: { ativo: true },
        orderBy: { countryLabel: 'asc' },
        select: { id: true, countryKey: true, countryLabel: true, nationalityKey: true, flag: true, ativo: true },
      }),
      // Cadastro oficial de categorias — alimenta o select do formulário. Só as
      // ATIVAS: categoria inativa não pode ser escolhida (a API também recusa).
      prisma.categoriaServico.findMany({
        where: { ativo: true },
        orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
        select: { id: true, code: true, nome: true, ordem: true, ativo: true },
      }),
    ])

    return NextResponse.json({ servicos, paisesCatalogo, categoriasCatalogo })
  } catch (error) {
    console.error('Erro ao listar produtos e serviços:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar serviço
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    if (!b.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    }

    const name = String(b.name).trim()

    // CATEGORIA — referência estrutural: só id oficial, conferido no cadastro.
    const categoria = await resolverCategoriaServico(b)
    if (categoria.erros.length) {
      return NextResponse.json({ error: categoria.erros[0].mensagem, erros: categoria.erros }, { status: 400 })
    }

    // APLICAÇÃO TERRITORIAL — conferida contra o cadastro real ANTES de abrir a
    // transação. Body que não declara nada nasce global (default do domínio).
    const territorio = await resolverAplicacaoTerritorial(b)
    if (territorio.erros.length) {
      return NextResponse.json({ error: territorio.erros[0].mensagem, erros: territorio.erros }, { status: 400 })
    }
    const selecao = territorio.declarado ? territorio.selecao : { global: true, paisIds: [] }

    // O mestre (ItemCatalogo, natureza SERVICO) é quem o Financeiro referencia —
    // e é o portador ÚNICO da categoria.
    const servico = await prisma.$transaction(async (tx) => {
      // CHAVE TÉCNICA INTERNA: gerada no backend a partir do nome (o operador NUNCA
      // informa nem vê `code`). Igual ao publicCode — automática, única, invisível.
      const code = await gerarChaveUnica(slugTecnico(name, 'SERVICO'), async (c) =>
        !!(await tx.servicoProduto.findUnique({ where: { code: c }, select: { id: true } })) ||
        !!(await tx.itemCatalogo.findUnique({ where: { code: c }, select: { id: true } })),
      )
      const itemCatalogoId = await sincronizarItemDeServico(tx, { code, name, categoriaId: categoria.categoriaId })
      const s = await tx.servicoProduto.create({
        data: {
          code,
          name,
          descricao: toStrOrNull(b.descricao),
          unidadePadrao: b.unidadePadrao || null,
          aplicacaoGlobal: selecao.global,
          ativo: b.ativo !== undefined ? !!b.ativo : true,
          itemCatalogoId,
        },
      })
      await gravarAplicacaoTerritorial(tx, s.id, selecao)
      // FLUXO: Cadastro Mestre (Serviço) → Configuração Financeira criada AUTOMATICAMENTE
      // (vínculo estrutural itemCatalogoId; idempotente). Não cria preço — só a config.
      await garantirConfigFinanceiraDeItem(tx, { itemCatalogoId, nome: name })
      return s
    })

    return NextResponse.json({ servico })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um serviço com esse código.' }, { status: 409 })
    }
    console.error('Erro ao criar produto/serviço:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}