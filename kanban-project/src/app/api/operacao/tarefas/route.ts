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
import { minhaFila, semResponsavel, concluidasHojeDoUsuario, acompanhamentoDoUsuario, type FiltrosGerenciais } from '@/lib/operacional/tarefa-projecoes'
import { parseFiltrosGerenciais } from '@/lib/operacional/parse-filtros-gerenciais'

/**
 * OS FILTROS DA QUERY STRING → `FiltrosGerenciais` — o MESMO parser que
 * `/api/operacao/visao-global` e `/api/operacao/central` já usam
 * (`parseFiltrosGerenciais`), nunca uma segunda leitura de querystring.
 * Achado real 25/09/2026: a versão antiga desta função só entendia
 * `busca`/`fase`/`terceiro`/`prazo` — os chips de condição (Executável
 * agora/Atrasadas/Vence hoje/Aguardando terceiro/Sem responsável/…) da
 * Central Operacional não tinham efeito nenhum na tabela por família, que
 * lê esta rota em "Minha fila". `responsavelId`/`porPagina` do resultado
 * são ignorados de propósito — quem chama (`minhaFila`) já os fixa.
 */
function filtrosDaQuery(sp: URLSearchParams): Omit<FiltrosGerenciais, 'responsavelId' | 'porPagina'> {
  const req = { nextUrl: { searchParams: sp } } as unknown as NextRequest
  const f = parseFiltrosGerenciais(req)
  const terceiro = sp.get('terceiro')?.trim()
  if (terceiro) f.terceiro = terceiro
  // `prazo` (açúcar legado desta rota, ainda usado por chamadores antigos):
  // só aplica se as condições canônicas (atrasadas/venceHoje/proximos7Dias)
  // não vieram, pra não sobrescrever silenciosamente o que a Central manda.
  const prazo = sp.get('prazo')
  if (prazo === 'atrasadas' && !sp.has('atrasadas')) f.atrasadas = true
  else if (prazo === 'hoje' && !sp.has('venceHoje')) f.venceHoje = true
  else if (prazo === '7dias' && !sp.has('proximos7Dias')) f.proximos7Dias = true
  return f
}

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
    const linhas = await minhaFila(usuario.userId, agora, undefined, filtrosDaQuery(request.nextUrl.searchParams))
    return NextResponse.json({ visao, total: linhas.length, linhas })
  }
  // KPI "Concluídas hoje" de Minha Operação — `minhaFila` exclui CONCLUIDA de
  // propósito, então este é o recorte OPOSTO, sempre do usuário do TOKEN.
  if (visao === 'concluidas_hoje') {
    const linhas = await concluidasHojeDoUsuario(usuario.userId, agora)
    return NextResponse.json({ visao, total: linhas.length, linhas })
  }
  // ACOMPANHAMENTO (Etapa 2, motor de cobrança) — o recorte de `minhaFila`
  // que precisa de atenção agora: acompanhamento vencido ou escalada.
  if (visao === 'acompanhamento') {
    const linhas = await acompanhamentoDoUsuario(usuario.userId, agora, undefined, filtrosDaQuery(request.nextUrl.searchParams))
    return NextResponse.json({ visao, total: linhas.length, linhas })
  }
  return NextResponse.json({ error: `visão desconhecida: "${visao}"`, visoes: ['minha_fila', 'sem_responsavel', 'concluidas_hoje', 'acompanhamento'] }, { status: 400 })
}
