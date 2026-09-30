// /api/torre/visoes — as VISÕES SALVAS da aba Tarefas (Bloco J4). SEM MIGRATION: usa `RelatorioVisao`, a mesma
// tabela genérica das visões de relatório (`dominio: "torre-tarefas"`, spec JSON, `compartilhada` do Bloco E7).
//
//   GET     as minhas + as compartilhadas com a equipe
//   POST    cria/atualiza pelo nome        { nome, visao, agrupar, dentro, kpi, pais, busca, filtros, compartilhada? }
//   PATCH   (des)compartilha               { id, compartilhada }   — só o dono; auditado
//   DELETE  ?id=                           — só o dono
//
// A visão guarda a PERGUNTA (filtros), nunca o resultado; valores fora da lista fechada são recusados.
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { DOMINIO_VISAO_TORRE, limparSpec } from '@/lib/operacional/torre-visoes'

export async function GET(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const [minhas, compartilhadas] = await Promise.all([
    prisma.relatorioVisao.findMany({
      where: { usuarioId: usuario.userId, dominio: DOMINIO_VISAO_TORRE }, orderBy: [{ usadaEm: 'desc' }, { nome: 'asc' }],
      select: { id: true, nome: true, spec: true, compartilhada: true },
    }),
    prisma.relatorioVisao.findMany({
      where: { compartilhada: true, dominio: DOMINIO_VISAO_TORRE, usuarioId: { not: usuario.userId } }, orderBy: { nome: 'asc' },
      select: { id: true, nome: true, spec: true, usuario: { select: { nome: true } } },
    }),
  ])
  return NextResponse.json({ minhas, compartilhadas: compartilhadas.map((v) => ({ id: v.id, nome: v.nome, spec: v.spec, donoNome: v.usuario.nome })) })
}

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const nome = String(b?.nome ?? '').trim().slice(0, 80)
  if (!nome) return NextResponse.json({ error: 'Dê um nome à visão.' }, { status: 400 })
  // Os filtros da barra entram validados (`normalizarFiltros`, dentro de `limparSpec`); o JSON é só o formato de gravação.
  const spec = JSON.parse(JSON.stringify(limparSpec(b as Record<string, unknown>)))
  const visao = await prisma.relatorioVisao.upsert({
    where: { usuarioId_dominio_nome: { usuarioId: usuario.userId, dominio: DOMINIO_VISAO_TORRE, nome } },
    update: { spec, usadaEm: new Date(), ...(b?.compartilhada !== undefined ? { compartilhada: !!b.compartilhada } : {}) },
    create: { usuarioId: usuario.userId, dominio: DOMINIO_VISAO_TORRE, nome, spec, usadaEm: new Date(), compartilhada: !!b?.compartilhada },
    select: { id: true, nome: true, spec: true, compartilhada: true },
  })
  await prisma.logAuditoria.create({
    data: {
      acao: 'VISAO_TORRE_SALVA', entidade: 'RelatorioVisao', entidadeId: visao.id, usuarioId: usuario.userId,
      descricao: `Visão "${nome}" da Torre salva${visao.compartilhada ? ' e compartilhada com a equipe' : ''}.`,
      detalhes: JSON.parse(JSON.stringify({ visaoId: visao.id, spec, compartilhada: visao.compartilhada })),
    },
  })
  return NextResponse.json({ visao })
}

export async function PATCH(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const id = Number(b?.id)
  if (!Number.isInteger(id) || id <= 0 || typeof b?.compartilhada !== 'boolean') return NextResponse.json({ error: 'id e compartilhada (true/false) são obrigatórios' }, { status: 400 })
  // O `where` inclui o dono: só quem criou a visão decide se a equipe a vê.
  const r = await prisma.relatorioVisao.updateMany({ where: { id, usuarioId: usuario.userId, dominio: DOMINIO_VISAO_TORRE }, data: { compartilhada: b.compartilhada } })
  if (r.count === 0) return NextResponse.json({ error: 'Visão não encontrada.' }, { status: 404 })
  const v = await prisma.relatorioVisao.findUnique({ where: { id }, select: { nome: true } })
  await prisma.logAuditoria.create({
    data: {
      acao: b.compartilhada ? 'VISAO_COMPARTILHADA' : 'VISAO_DESCOMPARTILHADA', entidade: 'RelatorioVisao', entidadeId: id, usuarioId: usuario.userId,
      descricao: `Visão "${v?.nome ?? id}" da Torre ${b.compartilhada ? 'passou a ser compartilhada com a equipe' : 'deixou de ser compartilhada'}.`,
      detalhes: { visaoId: id, compartilhada: b.compartilhada },
    },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Visão inválida.' }, { status: 400 })
  const v = await prisma.relatorioVisao.findFirst({ where: { id, usuarioId: usuario.userId, dominio: DOMINIO_VISAO_TORRE }, select: { nome: true } })
  if (!v) return NextResponse.json({ error: 'Visão não encontrada.' }, { status: 404 })
  await prisma.relatorioVisao.delete({ where: { id } })
  await prisma.logAuditoria.create({
    data: { acao: 'VISAO_TORRE_REMOVIDA', entidade: 'RelatorioVisao', entidadeId: id, usuarioId: usuario.userId, descricao: `Visão "${v.nome}" da Torre removida.` },
  })
  return NextResponse.json({ ok: true })
}
