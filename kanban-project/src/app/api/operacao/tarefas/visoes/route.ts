// src/app/api/operacao/tarefas/visoes/route.ts
// ============================================================================
// "MINHAS VISÕES" DE MINHA OPERAÇÃO — reaproveita `RelatorioVisao`, a MESMA
// tabela genérica (domínio/nome/spec JSON/usuário) que Tarefas e Projetos já
// usa (`/api/operacao/visao-global/visoes`) e o motor de Relatórios também
// usa. `dominio` fixo em "minha-operacao" separa estas linhas das outras,
// na MESMA tabela — nenhuma tabela nova.
//
// Diferente de Tarefas e Projetos: aqui é `tarefas.ver` (não `.editar`) —
// Minha Operação é de QUALQUER operacional, não só de quem gere a operação
// inteira.
//
// GET    lista as visões do dono
// POST   cria/atualiza pelo nome
// DELETE remove
// ============================================================================
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

const DOMINIO = 'minha-operacao'

async function dono(request: Request): Promise<number | null> {
  const u = await extrairUsuarioComPermissoes(request as never)
  return u?.userId ?? null
}

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro
  const usuarioId = await dono(request)
  if (!usuarioId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const visoes = await prisma.relatorioVisao.findMany({
    where: { usuarioId, dominio: DOMINIO },
    orderBy: [{ usadaEm: 'desc' }, { nome: 'asc' }],
    select: { id: true, nome: true, spec: true },
  })
  return NextResponse.json({ visoes })
}

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro
  const usuarioId = await dono(request)
  if (!usuarioId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const nome = String(b?.nome ?? '').trim().slice(0, 80)
  if (!nome) return NextResponse.json({ error: 'Dê um nome à visão.' }, { status: 400 })
  // O RESULTADO NÃO ENTRA — só a pergunta (filtros + categoria + modo).
  const spec = { filtros: b?.filtros ?? {}, categoria: b?.categoria ?? 'paraAgirAgora', visaoModo: b?.visaoModo ?? 'familia' }

  const visao = await prisma.relatorioVisao.upsert({
    where: { usuarioId_dominio_nome: { usuarioId, dominio: DOMINIO, nome } },
    update: { spec, usadaEm: new Date() },
    create: { usuarioId, dominio: DOMINIO, nome, spec, usadaEm: new Date() },
    select: { id: true, nome: true, spec: true },
  })
  return NextResponse.json({ visao })
}

export async function DELETE(request: Request) {
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro
  const usuarioId = await dono(request)
  if (!usuarioId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Visão inválida.' }, { status: 400 })
  const r = await prisma.relatorioVisao.deleteMany({ where: { id, usuarioId, dominio: DOMINIO } })
  if (r.count === 0) return NextResponse.json({ error: 'Visão não encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
