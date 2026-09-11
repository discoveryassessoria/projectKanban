// src/app/api/operacao/visao-global/visoes/route.ts
// ============================================================================
// "MINHAS VISÕES" DE TAREFAS E PROJETOS — reaproveita `RelatorioVisao`, a
// mesma tabela genérica de visão salva (domínio/nome/spec JSON/usuário/
// favorita) que `/api/relatorios/visoes` já usa para o motor de Relatórios.
//
// NÃO reaproveita a ROTA (`/api/relatorios/visoes`): aquela valida `spec`
// contra `QuerySpec` do motor de Relatórios (domínio/agruparPor/colunas
// próprios) e exige `relatorios.ver` — um contrato que não é o nosso. Aqui o
// `spec` é `{ filtros: FiltrosGerenciais, modo }`, exatamente a forma que
// `/api/operacao/visao-global[/familias]` já aceita como querystring — salvar
// uma visão é só congelar esses parâmetros. `dominio` fixo em
// "tarefas-e-projetos" separa estas linhas das do motor de Relatórios na
// MESMA tabela, sem misturar os dois contratos.
//
// GET    lista as visões do dono
// POST   cria/atualiza pelo nome
// DELETE remove
// ============================================================================
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'

const DOMINIO = 'tarefas-e-projetos'

async function dono(request: Request): Promise<number | null> {
  const u = await extrairUsuarioComPermissoes(request as never)
  return u?.userId ?? null
}

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const usuarioId = await dono(request)
  if (!usuarioId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const visoes = await prisma.relatorioVisao.findMany({
    where: { usuarioId, dominio: DOMINIO },
    orderBy: [{ usadaEm: 'desc' }, { nome: 'asc' }],
    select: { id: true, nome: true, spec: true, usadaEm: true, criadoEm: true },
  })
  return NextResponse.json({ visoes })
}

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const usuarioId = await dono(request)
  if (!usuarioId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const b = await request.json().catch(() => ({}))
  const nome = String(b?.nome ?? '').trim().slice(0, 80)
  if (!nome) return NextResponse.json({ error: 'Dê um nome à visão.' }, { status: 400 })
  // O RESULTADO NÃO ENTRA — só a pergunta (filtros + aba).
  const spec = { filtros: b?.filtros ?? {}, modo: typeof b?.modo === 'string' ? b.modo : 'visaoGeral' }

  const visao = await prisma.relatorioVisao.upsert({
    where: { usuarioId_dominio_nome: { usuarioId, dominio: DOMINIO, nome } },
    update: { spec, usadaEm: new Date() },
    create: { usuarioId, dominio: DOMINIO, nome, spec, usadaEm: new Date() },
    select: { id: true, nome: true, spec: true },
  })
  return NextResponse.json({ visao })
}

export async function DELETE(request: Request) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const usuarioId = await dono(request)
  if (!usuarioId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Visão inválida.' }, { status: 400 })
  // O `where` inclui o dono e o domínio: ninguém apaga visão de outra tela ou de outro operador.
  const r = await prisma.relatorioVisao.deleteMany({ where: { id, usuarioId, dominio: DOMINIO } })
  if (r.count === 0) return NextResponse.json({ error: 'Visão não encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
