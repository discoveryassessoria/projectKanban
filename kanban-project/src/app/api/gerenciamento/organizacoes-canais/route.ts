// src/app/api/gerenciamento/organizacoes-canais/route.ts
//
// POR ONDE CADA ORGANIZAÇÃO ATENDE.
//
// O vocabulário de tipos de canal (`CanalOperacional`) é domínio e continua onde
// estava. Aqui mora a DISPONIBILIDADE: quais desses tipos uma organização concreta
// atende, com que endereço e exigindo o quê. É esta tabela que o runtime consulta
// quando uma subtarefa diz "use os canais do fornecedor relacionado" — e é por isso
// que um cartório de balcão deixa de aparecer com CRC e e-mail.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  const orgId = Number(request.nextUrl.searchParams.get('organizacaoId'))
  const busca = (request.nextUrl.searchParams.get('q') ?? '').trim()

  const tipos = await prisma.canalOperacional.findMany({
    where: { ativo: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
  })

  if (Number.isFinite(orgId) && orgId > 0) {
    const org = await prisma.orgaoProtocolo.findUnique({
      where: { id: orgId },
      select: {
        id: true, name: true, nomeFantasia: true, type: true, city: true,
        paisId: true, pais: { select: { id: true, countryKey: true, countryLabel: true } },
        canais: { include: { canal: true }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] },
      },
    })
    if (!org) return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })
    return NextResponse.json({ tipos, organizacao: org })
  }

  // A LISTA de organizações com a CONTAGEM de canais. Zero é informação: quer dizer
  // que ninguém cadastrou por onde ela atende, e toda subtarefa que dependa de canal
  // vai ficar bloqueada nela — o que a tela mostra em vez de esconder.
  const organizacoes = await prisma.orgaoProtocolo.findMany({
    where: {
      ativo: true,
      ...(busca ? { OR: [
        { name: { contains: busca, mode: 'insensitive' as const } },
        { nomeFantasia: { contains: busca, mode: 'insensitive' as const } },
        { city: { contains: busca, mode: 'insensitive' as const } },
      ] } : {}),
    },
    orderBy: [{ name: 'asc' }],
    take: 200,
    select: {
      id: true, name: true, nomeFantasia: true, type: true, city: true,
      paisId: true, pais: { select: { id: true, countryKey: true, countryLabel: true } },
      canais: { where: { ativo: true }, select: { canal: { select: { key: true, label: true } } } },
    },
  })
  return NextResponse.json({ tipos, organizacoes })
}

/**
 * SUBSTITUI os canais de UMA organização.
 *
 * Substituição inteira, não patch: a tela manda a lista que o administrador vê, e o
 * que sumiu dela some. Os vínculos são recriados; o que se perde é só o vínculo, nunca
 * a solicitação que passou por ele — essa aponta para o canal por chave e continua
 * legível.
 */
export async function PUT(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  const body = await request.json().catch(() => ({}))
  const organizacaoId = Number(body?.organizacaoId)
  if (!Number.isFinite(organizacaoId)) {
    return NextResponse.json({ error: 'Organização não informada.' }, { status: 400 })
  }
  const org = await prisma.orgaoProtocolo.findUnique({ where: { id: organizacaoId }, select: { id: true, name: true } })
  if (!org) return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })

  const linhas = Array.isArray(body?.canais) ? body.canais : []
  const usuario = await extrairUsuarioComPermissoes(request)

  await prisma.$transaction(async (tx) => {
    await tx.organizacaoCanal.deleteMany({ where: { organizacaoId } })
    for (const [i, l] of linhas.entries()) {
      const key = String(l?.canalKey ?? l?.canal?.key ?? '')
      if (!key) continue
      const canal = await tx.canalOperacional.findUnique({ where: { key }, select: { id: true } })
      if (!canal) continue
      await tx.organizacaoCanal.create({
        data: {
          organizacaoId, canalId: canal.id,
          ordem: Number(l?.ordem) || i + 1,
          ativo: l?.ativo !== false,
          // `null` = herda a exigência do TIPO. `true` = esta organização exige a mais.
          // Ela nunca dispensa: quem resolve isso é `canaisDaOrganizacao`, e ele soma.
          exigeProtocolo: typeof l?.exigeProtocolo === 'boolean' ? l.exigeProtocolo : null,
          exigeAnexo: typeof l?.exigeAnexo === 'boolean' ? l.exigeAnexo : null,
          exigeRastreio: typeof l?.exigeRastreio === 'boolean' ? l.exigeRastreio : null,
          exigeObservacao: typeof l?.exigeObservacao === 'boolean' ? l.exigeObservacao : null,
          endereco: l?.endereco ? String(l.endereco).slice(0, 300) : null,
          prazoDias: Number(l?.prazoDias) > 0 ? Number(l.prazoDias) : null,
          observacao: l?.observacao ? String(l.observacao) : null,
        },
      })
    }
  }, { maxWait: 20_000, timeout: 120_000 })

  await prisma.logAuditoria.create({
    data: {
      acao: 'ORGANIZACAO_CANAIS_ATUALIZADOS', entidade: 'OrgaoProtocolo', entidadeId: organizacaoId,
      descricao: `Canais de atendimento de "${org.name}" atualizados: ${linhas.length} canal(is).`,
      detalhes: { canais: linhas.map((l: { canalKey?: string }) => l?.canalKey).filter(Boolean) } as never,
      usuarioId: usuario?.userId ?? null,
    },
  }).catch(() => null)

  const atual = await prisma.orgaoProtocolo.findUnique({
    where: { id: organizacaoId },
    select: { id: true, name: true, canais: { include: { canal: true }, orderBy: { ordem: 'asc' } } },
  })
  return NextResponse.json({ organizacao: atual })
}
