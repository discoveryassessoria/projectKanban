import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { parseConsulta, filtroBusca, filtroAtivo, ordenacao, meta } from '@/lib/gerenciamento/consulta'
import { legacyFromCode } from '@/src/lib/document-category-map'
import { slugTecnico, gerarChaveUnica } from '@/src/lib/catalogo/chave-tecnica-interna'
import { conferirContratoDoTipo, dadosDoContrato, INCLUDE_CONTRATO } from '@/src/lib/documentos/contrato-tipo-documento'

// Classificação CANÔNICA = categoriaDocumental (por ID). A relação é sempre
// carregada para a UI exibir o nome do mestre (sem mapa local). A coluna legada
// `category` só existe como fallback transitório e NÃO é editável pela UI nova.
const INCLUDE_CATEGORIA = {
  categoriaDocumental: { select: { id: true, code: true, name: true, ativo: true } },
  // CONTRATO OPERACIONAL — a tela precisa MOSTRAR o contrato, e mostrar exige
  // trazer o workflow por trás do perfil. Só leitura: a edição do workflow
  // continua na área de Workflow Interno.
  ...INCLUDE_CONTRATO,
} as const

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const c = parseConsulta(new URL(request.url).searchParams)
    const where = { ...filtroBusca(c.q, ['name', 'code', 'category', 'nature']), ...filtroAtivo(c) }
    const [total, tipos] = await Promise.all([
      prisma.tipoDocumentoCadastro.count({ where }),
      prisma.tipoDocumentoCadastro.findMany({ where, orderBy: ordenacao(c, ['name', 'code', 'category'], [{ name: 'asc' }]), skip: c.skip, take: c.take, include: INCLUDE_CATEGORIA }),
    ])
    return NextResponse.json({ tipos, meta: meta(total, c) })
  } catch (e) {
    console.error('GET tipos-documento', e)
    return NextResponse.json({ error: 'Erro ao carregar tipos de documento.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })

    // GUARD DO CONTRATO — recusa, nunca corrige.
    const recusa = await conferirContratoDoTipo(b, null)
    if (recusa) return NextResponse.json(recusa, { status: 422 })

    // LOTE A — FONTE CANÔNICA = categoriaDocumentalId (por ID). Valida existência.
    // DUAL-WRITE: deriva a coluna legada `category` a partir do code SÓ como
    // compatibilidade. Categoria nova sem equivalência legada (ex.: MILITAR) grava
    // a FK normalmente e deixa `category` null — nunca rejeita categoria válida.
    // A UI nova NÃO envia `category`; não se infere a fonte principal por texto.
    let categoriaDocumentalId: number | null = null
    let categoryLegado: string | null = null
    if (b.categoriaDocumentalId != null) {
      const cid = Number(b.categoriaDocumentalId)
      if (!Number.isInteger(cid)) return NextResponse.json({ error: 'Categoria documental inválida.' }, { status: 400 })
      const cat = await prisma.categoriaDocumental.findUnique({ where: { id: cid } })
      if (!cat) return NextResponse.json({ error: 'Categoria documental não encontrada.' }, { status: 404 })
      categoriaDocumentalId = cat.id
      categoryLegado = legacyFromCode(cat.code) // null quando não há legado → ok
    } else if (b.category) {
      // caminho legado puro (sem FK) — só compat; deprecado para a UI nova
      categoryLegado = String(b.category)
    }

    // CHAVE TÉCNICA INTERNA: gerada no backend a partir do nome (o operador NUNCA
    // informa nem vê `code`). Necessária porque a Matriz Documental referencia o
    // tipo por `documentTypeCode`. DOC-n é do documento concreto, não do tipo.
    const nome = String(b.name).trim()
    const code = await gerarChaveUnica(slugTecnico(nome, 'DOC'), async (c) =>
      !!(await prisma.tipoDocumentoCadastro.findFirst({ where: { code: c }, select: { id: true } })),
    )
    const tipo = await prisma.tipoDocumentoCadastro.create({
      data: {
        code,
        name: nome,
        category: categoryLegado,
        categoriaDocumentalId,
        ativo: b.ativo !== false,
        ...dadosDoContrato(b),
      },
      include: INCLUDE_CATEGORIA,
    })
    await registrarAuditoria(request, { acao: 'CRIAR', entidade: 'TipoDocumentoCadastro', entidadeId: tipo.id, descricao: `Tipo documental criado: ${tipo.name}`, detalhes: { code: tipo.code, category: tipo.category } })
    return NextResponse.json({ tipo }, { status: 201 })
  } catch (e) {
    console.error('POST tipos-documento', e)
    return NextResponse.json({ error: 'Erro ao criar tipo de documento.' }, { status: 500 })
  }
}