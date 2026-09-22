import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Tipos de Processo + países + modalidades (p/ os seletores em cascata)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [tipos, paises, modalidades] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { arquivado: false },
        orderBy: { name: 'asc' },
        include: {
          pais: { select: { countryKey: true, countryLabel: true, nationalityKey: true, nationalityLabel: true } },
          modalidadesHabilitadas: { where: { ativo: true }, include: { modalidade: { select: { id: true, modalityKey: true, modalityLabel: true } } } },
          macroWorkflows: { select: { id: true, modalidadeId: true, ativo: true, versao: true } },
        },
      }),
      prisma.catalogoPais.findMany({ where: { ativo: true }, orderBy: { countryLabel: 'asc' } }),
      prisma.modalidadePais.findMany({
        where: { ativo: true },
        orderBy: [{ pais: { countryKey: 'asc' } }, { ordem: 'asc' }],
        include: { pais: { select: { countryKey: true } } },
      }),
    ])

    // A tela continua lendo country/nationality no tipo — como APRESENTAÇÃO
    // derivada do país canônico, não como cópia persistida. `modalidades` é
    // agora uma LISTA (mandato "Reconstrução da hierarquia", 22/09/2026) —
    // um Tipo pode habilitar Administrativa, Judicial ou ambas.
    const tiposOut = tipos.map(({ pais, modalidadesHabilitadas, macroWorkflows, ...t }) => ({
      ...t,
      modalidades: modalidadesHabilitadas.map((h) => ({
        id: h.modalidade.id, modalityKey: h.modalidade.modalityKey, modalityLabel: h.modalidade.modalityLabel,
        temWorkflowMacro: macroWorkflows.some((m) => m.modalidadeId === h.modalidade.id && m.ativo),
      })),
      countryKey: pais.countryKey,
      countryLabel: pais.countryLabel,
      nationalityKey: pais.nationalityKey,
      nationalityLabel: pais.nationalityLabel,
    }))

    // A cascata país → modalidade continua endereçada por chave na tela; a
    // chave é DERIVADA do país canônico, não coluna própria da modalidade.
    const modalidadesOut = modalidades.map(({ pais, ...m }) => ({ ...m, countryKey: pais.countryKey }))

    return NextResponse.json({ tipos: tiposOut, paises, modalidades: modalidadesOut })
  } catch (error) {
    console.error('Erro ao listar tipos de processo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar tipo de processo (labels resolvidos pelo servidor a partir das chaves)
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    if (!b.code || !String(b.code).trim()) return NextResponse.json({ error: 'Informe o código.' }, { status: 400 })
    if (!b.name || !String(b.name).trim()) return NextResponse.json({ error: 'Informe o nome.' }, { status: 400 })
    // Aceita `modalityKeys`/`modalidadeIds` (várias — mandato "Reconstrução da
    // hierarquia", 22/09/2026: "Tipo pode habilitar Administrativa, Judicial
    // ou ambas") com compatibilidade de borda para o `modalityKey` singular
    // que o formulário antigo mandava.
    const modalityKeysPedidas: string[] = Array.isArray(b.modalityKeys) ? b.modalityKeys.map(String)
      : b.modalityKey ? [String(b.modalityKey)] : []
    if (modalityKeysPedidas.length === 0 || !(b.paisId || b.countryKey)) {
      return NextResponse.json({ error: 'Escolha país e ao menos uma modalidade.' }, { status: 400 })
    }

    // IDENTIDADE primeiro. `countryKey` só é aceito como compatibilidade de
    // borda: vira vínculo aqui e não segue adiante como texto.
    const pais = b.paisId
      ? await prisma.catalogoPais.findUnique({ where: { id: Number(b.paisId) } })
      : await prisma.catalogoPais.findUnique({ where: { countryKey: String(b.countryKey) } })
    if (!pais) return NextResponse.json({ error: 'País não encontrado no catálogo.' }, { status: 400 })
    const modalidades = await prisma.modalidadePais.findMany({
      where: { paisId: pais.id, modalityKey: { in: modalityKeysPedidas } },
    })
    if (modalidades.length !== modalityKeysPedidas.length) {
      return NextResponse.json({ error: 'Uma ou mais modalidades não foram encontradas para este país.' }, { status: 400 })
    }

    const tipo = await prisma.$transaction(async (tx) => {
      const criado = await tx.tipoProcessoNacionalidade.create({
        data: {
          code: String(b.code).trim().toUpperCase(),
          name: String(b.name).trim(),
          // IDENTIDADE. Nada de país é copiado para dentro do tipo.
          pais: { connect: { id: pais.id } },
          processFamily: 'cidadania',
          serviceNature: 'main_process',
          ativo: b.ativo !== false,
        },
      })
      // HABILITAÇÃO — N:N real, nunca um FK único (mandato "Reconstrução da
      // hierarquia"): a mesma nacionalidade pode nascer já habilitada para
      // Administrativa e Judicial numa única criação.
      await tx.tipoProcessoModalidadeHabilitada.createMany({
        data: modalidades.map((m) => ({ tipoProcessoId: criado.id, modalidadeId: m.id, ativo: true })),
      })
      return criado
    })

    return NextResponse.json({ tipo })
  } catch (error: any) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'Já existe um tipo de processo com esse código.' }, { status: 409 })
    console.error('Erro ao criar tipo de processo:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}