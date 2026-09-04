// src/app/api/operacao/tarefas/familias/route.ts
// ============================================================================
// A LEITURA AGRUPADA DA OPERAÇÃO — Minha Fila e Sem responsável, por família.
//
//   GET /api/operacao/tarefas/familias?visao=minha_fila
//   GET /api/operacao/tarefas/familias?visao=sem_responsavel
//
// A MESMA agregação de Tarefas e Projetos (`agregacaoPorFamilia`), recortada
// pelo escopo de cada visão — nunca uma segunda tabela de resumo. Existe para
// não rolar uma lista de tarefas em várias famílias quando a pergunta é "como
// está a família X" dentro do que é MEU ou do que está SEM RESPONSÁVEL.
//
// Mesma regra de permissão da leitura detalhada (`/api/operacao/tarefas`):
// "sem responsável" é ato de gestão e exige admin; "minha fila" é sempre a do
// próprio usuário do token.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { agregacaoPorFamilia } from '@/lib/operacional/tarefa-projecoes'

export async function GET(request: NextRequest) {
  const visao = request.nextUrl.searchParams.get('visao') ?? 'minha_fila'

  const permissao = visao === 'sem_responsavel' ? 'tarefas.editar' : 'tarefas.ver'
  const erro = await verificarPermissao(request, permissao)
  if (erro) return erro

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  // 🔒 MESMA HIERARQUIA de `/api/operacao/tarefas`: `tarefas.editar` também
  // autoriza editar a PRÓPRIA tarefa — só o admin vê o que ainda não é de
  // ninguém, agrupado ou não.
  if (visao === 'sem_responsavel' && usuario.tipo !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores veem a fila sem responsável.' }, { status: 403 })
  }
  if (visao !== 'minha_fila' && visao !== 'sem_responsavel') {
    return NextResponse.json({ error: `visão desconhecida: "${visao}"`, visoes: ['minha_fila', 'sem_responsavel'] }, { status: 400 })
  }

  const agora = new Date()
  const familias = await agregacaoPorFamilia(
    agora,
    // Sempre o usuário do TOKEN — aceitar um `usuarioId` no query string
    // deixaria qualquer pessoa ler o resumo agrupado de qualquer outra.
    visao === 'sem_responsavel' ? { semResponsavel: true } : { responsavelId: usuario.userId },
  )
  const processos = new Set(familias.flatMap((f) => f.processos.map((p) => p.processoId)))
  return NextResponse.json({
    familias,
    total: familias.length,
    indicadores: {
      tarefas: familias.reduce((n, f) => n + f.total, 0),
      aFazer: familias.reduce((n, f) => n + f.aFazer, 0),
      atrasadas: familias.reduce((n, f) => n + f.atrasadas, 0),
      venceEm7Dias: familias.reduce((n, f) => n + f.venceEm7Dias, 0),
      familias: familias.length,
      processos: processos.size,
    },
  })
}
