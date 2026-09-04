// src/app/api/operacao/tarefas/route.ts
// ============================================================================
// A LEITURA DA OPERAÇÃO — Minha Fila e Sem responsável.
//
//   GET /api/operacao/tarefas?visao=minha_fila
//   GET /api/operacao/tarefas?visao=sem_responsavel
//
// As duas são PROJEÇÕES da mesma `Tarefa`. Não existe tabela "MinhaFila", não
// existe "FilaSemResponsavel": existe a tarefa canônica, lida por dois
// recortes. É isso que garante que o gestor e quem executa estejam falando do
// MESMO `taskId` — e que atribuir mova o trabalho de um recorte para o outro
// sem copiar nada.
//
// Rota de leitura: não escreve, e por isso não tem porta de comando aqui. Quem
// muda a tarefa é `POST /api/tarefas/{id}/comando`.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { minhaFila, semResponsavel } from '@/lib/operacional/tarefa-projecoes'

export async function GET(request: NextRequest) {
  const visao = request.nextUrl.searchParams.get('visao') ?? 'minha_fila'

  // Ver a fila alheia é ato de gestão; ver a própria, não. A permissão exigida
  // muda com o recorte pedido — não com o que a tela resolveu mostrar.
  const permissao = visao === 'sem_responsavel' ? 'tarefas.editar' : 'tarefas.ver'
  const erro = await verificarPermissao(request, permissao)
  if (erro) return erro

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  // 🔒 HIERARQUIA: "sem responsável" é a fila de DISTRIBUIÇÃO — quem decide de
  // quem é o trabalho. `tarefas.editar` também autoriza editar a PRÓPRIA
  // tarefa, então não basta como prova de que a pessoa distribui: só o admin
  // vê o que ainda não é de ninguém.
  if (visao === 'sem_responsavel' && usuario.tipo !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores veem a fila sem responsável.' }, { status: 403 })
  }

  const agora = new Date()
  if (visao === 'sem_responsavel') {
    const linhas = await semResponsavel(agora)
    return NextResponse.json({ visao, total: linhas.length, linhas })
  }
  if (visao === 'minha_fila') {
    // Sempre o usuário do TOKEN. Aceitar um `usuarioId` no query string deixaria
    // qualquer pessoa ler a fila de qualquer outra só trocando um número.
    const linhas = await minhaFila(usuario.userId, agora)
    return NextResponse.json({ visao, total: linhas.length, linhas })
  }
  return NextResponse.json({ error: `visão desconhecida: "${visao}"`, visoes: ['minha_fila', 'sem_responsavel'] }, { status: 400 })
}
