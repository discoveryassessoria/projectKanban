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
import { temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'
import { minhaFila, semResponsavel, concluidasHojeDoUsuario, concluidasRecentesDoUsuario, acompanhamentoDoUsuario, type FiltrosGerenciais } from '@/lib/operacional/tarefa-projecoes'
import { parseFiltrosGerenciais } from '@/lib/operacional/parse-filtros-gerenciais'
import { comDuracaoLogada, respostaSeIndisponibilidade } from '@/lib/operacional/erro-indisponibilidade-prisma'

/**
 * ESCOPO DE EQUIPE (Torre de Controle, Bloco A, 29/09/2026) — "ver a fila de
 * todo mundo" é ato de gestão, mesma régua de `visao=sem_responsavel`: exige
 * `tipo:admin` OU a permissão que já representa "gestor operacional" no
 * sistema (`operacao.distribuirTarefas` — quem decide de quem é o trabalho
 * sem dono já é, por definição, quem pode ver o trabalho de todo mundo).
 * Operador comum que mandar `escopo=equipe` é simplesmente ignorado — nunca
 * um erro 403 por um parâmetro que ele não devia ter mandado mas mandou.
 */
function podeVerEscopoDeEquipe(usuario: { tipo: string; permissoes: MapaPermissoes }): boolean {
  return usuario.tipo === 'admin' || temPermissao(usuario.permissoes, 'operacao.distribuirTarefas')
}

/**
 * Os filtros de escopo de equipe, quando autorizados — só as chaves que a
 * query REALMENTE mandou, nunca `undefined` explícito.
 *
 * Achado real (mandato "Operação/Antão", correção pós-conferência,
 * 29/09/2026): `?escopo=equipe&processoId=675` devolvia 675 E 651 juntos.
 * Causa dupla — (a) esta função lia só a chave `processoId`, divergente da
 * convenção do resto do código (`parseFiltrosGerenciais`/`/api/operacao/
 * central` leem `processo`); (b) o objeto sempre retornava TODAS as 5 chaves,
 * mesmo as não pedidas, como `undefined` — e `{ ...filtrosDaQuery(sp),
 * ...filtrosDeEquipe }` faz um `undefined` explícito APAGAR um valor real já
 * resolvido do outro lado do spread (`{a:1}` + `{a:undefined}` = `{a:
 * undefined}`, não `{a:1}`). Um caller que mandasse `?processo=675` (a
 * convenção certa) tinha o `processoId:675` de `filtrosDaQuery` zerado pelo
 * `processoId:undefined` desta função. Aceita as duas chaves e só inclui o
 * que veio, pra nenhum filtro real ser apagado no merge.
 */
function filtrosDeEquipeDaQuery(sp: URLSearchParams): Pick<FiltrosGerenciais, 'responsavelId' | 'pais' | 'faseMacroKey' | 'processoId' | 'estadoOperacao'> {
  const out: Pick<FiltrosGerenciais, 'responsavelId' | 'pais' | 'faseMacroKey' | 'processoId' | 'estadoOperacao'> = {}
  const responsavelId = sp.get('responsavelId')
  if (responsavelId) out.responsavelId = Number(responsavelId)
  const pais = sp.get('pais')
  if (pais) out.pais = pais
  const faseMacroKey = sp.get('faseMacroKey')
  if (faseMacroKey) out.faseMacroKey = faseMacroKey
  const processoId = sp.get('processoId') ?? sp.get('processo')
  if (processoId) out.processoId = Number(processoId)
  const estado = sp.get('estadoOperacao')
  if (estado === 'FILA' || estado === 'AGUARDANDO' || estado === 'CONCLUIDA') out.estadoOperacao = estado
  return out
}

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

  // ESCOPO DE EQUIPE — só some quando quem pediu pode ver o trabalho de todo
  // mundo; pra qualquer outro perfil, o parâmetro é como se não tivesse vindo
  // ("continua minha fila", nunca um 403 por um `?escopo=` de mais).
  const pediuEquipe = request.nextUrl.searchParams.get('escopo') === 'equipe'
  const escopoEquipe = pediuEquipe && podeVerEscopoDeEquipe(usuario)
  const usuarioIdDoRecorte = escopoEquipe ? null : usuario.userId
  const filtrosDeEquipe = escopoEquipe ? filtrosDeEquipeDaQuery(request.nextUrl.searchParams) : {}

  const agora = new Date()
  try {
    if (visao === 'sem_responsavel') {
      const linhas = await comDuracaoLogada('operacao.tarefas.semResponsavel', () => semResponsavel(agora, {
        faseMacroKey: filtrosDeEquipe.faseMacroKey, processoId: filtrosDeEquipe.processoId,
        pais: filtrosDeEquipe.pais, estadoOperacao: filtrosDeEquipe.estadoOperacao,
      }))
      return NextResponse.json({ visao, total: linhas.length, linhas })
    }
    if (visao === 'minha_fila') {
      // Sempre o usuário do TOKEN — a menos que o escopo de equipe já tenha
      // sido autorizado acima. Aceitar um `usuarioId` no query string sem essa
      // autorização deixaria qualquer pessoa ler a fila de qualquer outra só
      // trocando um número.
      const linhas = await comDuracaoLogada('operacao.tarefas.minhaFila', () =>
        minhaFila(usuarioIdDoRecorte, agora, undefined, { ...filtrosDaQuery(request.nextUrl.searchParams), ...filtrosDeEquipe }),
      )
      return NextResponse.json({ visao, total: linhas.length, linhas, escopo: escopoEquipe ? 'equipe' : 'individual' })
    }
    // KPI "Concluídas hoje" de Minha Operação — `minhaFila` exclui CONCLUIDA de
    // propósito, então este é o recorte OPOSTO, sempre do usuário do TOKEN.
    // Fora do escopo de equipe deste bloco (mandato Torre de Controle Bloco A,
    // 29/09/2026, lista só minha_fila/sem_responsavel/acompanhamento/feito).
    if (visao === 'concluidas_hoje') {
      const linhas = await comDuracaoLogada('operacao.tarefas.concluidasHoje', () => concluidasHojeDoUsuario(usuario.userId, agora))
      return NextResponse.json({ visao, total: linhas.length, linhas })
    }
    // ACOMPANHAMENTO (Etapa 2, motor de cobrança) — o recorte de `minhaFila`
    // que precisa de atenção agora: acompanhamento vencido ou escalada.
    if (visao === 'acompanhamento') {
      const linhas = await comDuracaoLogada('operacao.tarefas.acompanhamento', () =>
        acompanhamentoDoUsuario(usuarioIdDoRecorte, agora, undefined, { ...filtrosDaQuery(request.nextUrl.searchParams), ...filtrosDeEquipe }),
      )
      return NextResponse.json({ visao, total: linhas.length, linhas, escopo: escopoEquipe ? 'equipe' : 'individual' })
    }
    // FEITO (Etapa 3, aba "Feito") — concluídas dos últimos 14 dias; a tela
    // agrupa em Hoje/Ontem/Antes no cliente, a partir de `concluidaEm`.
    if (visao === 'feito') {
      const linhas = await comDuracaoLogada('operacao.tarefas.feito', () =>
        concluidasRecentesDoUsuario(usuarioIdDoRecorte, agora, 14, undefined, filtrosDeEquipe),
      )
      return NextResponse.json({ visao, total: linhas.length, linhas, escopo: escopoEquipe ? 'equipe' : 'individual' })
    }
  } catch (e) {
    const indisponivel = respostaSeIndisponibilidade(e)
    if (indisponivel) return indisponivel
    throw e
  }
  return NextResponse.json({ error: `visão desconhecida: "${visao}"`, visoes: ['minha_fila', 'sem_responsavel', 'concluidas_hoje', 'acompanhamento', 'feito'] }, { status: 400 })
}
