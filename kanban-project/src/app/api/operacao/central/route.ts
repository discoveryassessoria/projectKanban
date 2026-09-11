// src/app/api/operacao/central/route.ts
// ============================================================================
// A CENTRAL OPERACIONAL — "o que a empresa precisa fazer agora", SEMPRE
// agrupado por FAMÍLIA (Família → Processo → Fase; Etapa/Tarefa vêm por
// drill-down de /api/operacao/visao-global, escopado por `familia`).
//
//   GET /api/operacao/central?escopo=minha_fila
//   GET /api/operacao/central?escopo=tudo&executavelAgora=1&atrasadas=1
//
// NENHUM motor novo: `agregacaoPorFamilia` é a MESMA agregação de Tarefas e
// Projetos, só com o filtro completo. Os contadores desta rota e os da
// visão-global batem porque as duas chamam `whereGerencial` por baixo.
//
// FAMÍLIA É AGRUPAMENTO VISUAL — nunca dona de tarefa. Ações em lote (ver
// /api/tarefas/redistribuir e /api/tarefas/repriorizar) agem sobre uma lista
// de IDs de tarefa, nunca sobre "a família": quem decide isso é a tela, a
// partir do drill-down, não esta rota.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { agregacaoPorFamilia, facetasGerenciais, type FiltrosGerenciais } from '@/lib/operacional/tarefa-projecoes'
import { fasesParaSelecao } from '@/src/lib/process-stage/fases-catalog'

const ESCOPOS = ['minha_fila', 'sem_responsavel', 'tudo'] as const
type Escopo = (typeof ESCOPOS)[number]

const ORDENACOES = ['atencao', 'prazo', 'familia', 'ultimaAtividade'] as const
type OrdenacaoFamilia = (typeof ORDENACOES)[number]

const inteiro = (v: string | null): number | null => {
  const n = Number(v)
  return v != null && Number.isInteger(n) && n > 0 ? n : null
}
const bandeira = (v: string | null) => v === '1' || v === 'true'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.ver')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const p = request.nextUrl.searchParams
  const escopoPedido = p.get('escopo') || 'minha_fila'
  const escopo: Escopo = (ESCOPOS as readonly string[]).includes(escopoPedido) ? (escopoPedido as Escopo) : 'minha_fila'

  // 🔒 MESMA HIERARQUIA das rotas de família existentes: ver a operação
  // inteira ou a fila sem dono é ato de gestão — só admin.
  if ((escopo === 'sem_responsavel' || escopo === 'tudo') && usuario.tipo !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores veem além da própria fila.' }, { status: 403 })
  }

  // Dentro de "toda a operação", o admin pode ainda recortar por UM
  // responsável específico — é filtro, não um quarto escopo: continua sendo
  // "toda a operação", só que olhando a fatia de uma pessoa.
  const responsavelPedido = escopo === 'tudo' ? inteiro(p.get('responsavel')) : null

  const dias = inteiro(p.get('semMovimentacaoDias'))
  const filtros: FiltrosGerenciais = {
    ...(escopo === 'sem_responsavel'
      ? { semResponsavel: true }
      : escopo === 'minha_fila'
        ? { responsavelId: usuario.userId }
        : responsavelPedido != null
          ? { responsavelId: responsavelPedido }
          : {}),
    faseMacroKey: p.get('fase') || null,
    etapaKey: p.getAll('etapa').filter(Boolean).length ? p.getAll('etapa').filter(Boolean) : null,
    equipeKey: p.getAll('equipe').filter(Boolean).length ? p.getAll('equipe').filter(Boolean) : null,
    prioridade: p.getAll('prioridade').filter(Boolean).length ? (p.getAll('prioridade').filter(Boolean) as FiltrosGerenciais['prioridade']) : undefined,
    processoId: inteiro(p.get('processo')),
    familiaId: inteiro(p.get('familia')),
    atrasadas: bandeira(p.get('atrasadas')),
    venceHoje: bandeira(p.get('venceHoje')),
    proximos7Dias: bandeira(p.get('proximos7Dias')),
    executavelAgora: p.has('executavelAgora') ? bandeira(p.get('executavelAgora')) : undefined,
    aguardandoTerceiro: bandeira(p.get('aguardandoTerceiro')),
    bloqueada: bandeira(p.get('bloqueada')),
    pendenciasFasesAnteriores: bandeira(p.get('pendenciasFasesAnteriores')),
    semMovimentacao: dias != null ? { diasSemAtividade: dias } : null,
    busca: p.get('busca'),
    ordenacaoFamilia: ORDENACOES.includes(p.get('ordenacao') as OrdenacaoFamilia) ? (p.get('ordenacao') as OrdenacaoFamilia) : 'atencao',
  }

  // PAGINAÇÃO NO BACKEND: a agregação inteira decide quem entra (filtro +
  // ordenação), e só DEPOIS a página é recortada — os indicadores usam a
  // lista completa, a página só limita o que desce pro cliente.
  const porPagina = Math.min(Math.max(inteiro(p.get('porPagina')) ?? 30, 1), 100)
  const pagina = Math.max(inteiro(p.get('pagina')) ?? 1, 1)

  const [todasAsFamilias, facetas] = await Promise.all([
    agregacaoPorFamilia(new Date(), filtros),
    facetasGerenciais(new Date()),
  ])
  const totalPaginas = Math.max(1, Math.ceil(todasAsFamilias.length / porPagina))
  const paginaValida = Math.min(pagina, totalPaginas)
  const familias = todasAsFamilias.slice((paginaValida - 1) * porPagina, paginaValida * porPagina)
  const processos = new Set(todasAsFamilias.flatMap((f) => f.processos.map((pr) => pr.processoId)))

  return NextResponse.json({
    familias,
    total: todasAsFamilias.length,
    paginacao: { pagina: paginaValida, porPagina, totalPaginas, totalFamilias: todasAsFamilias.length },
    fases: fasesParaSelecao(),
    // Opções que EXISTEM na operação — não uma lista fixa. `equipeKey` é texto
    // livre (decisão 1 do contrato): filtrável, mas sem cadastro próprio ainda.
    equipes: facetas.equipes,
    responsaveis: facetas.responsaveis,
    indicadores: {
      tarefas: todasAsFamilias.reduce((n, f) => n + f.total, 0),
      aFazer: todasAsFamilias.reduce((n, f) => n + f.aFazer, 0),
      executavelAgora: todasAsFamilias.reduce((n, f) => n + f.executavelAgora, 0),
      atrasadas: todasAsFamilias.reduce((n, f) => n + f.atrasadas, 0),
      venceEm7Dias: todasAsFamilias.reduce((n, f) => n + f.venceEm7Dias, 0),
      semResponsavel: todasAsFamilias.reduce((n, f) => n + f.semResponsavel, 0),
      bloqueadas: todasAsFamilias.reduce((n, f) => n + f.bloqueadas, 0),
      aguardandoTerceiro: todasAsFamilias.reduce((n, f) => n + f.aguardandoTerceiro, 0),
      pendenciasFaseAnterior: todasAsFamilias.reduce((n, f) => n + f.pendenciasFaseAnterior, 0),
      familias: todasAsFamilias.length,
      processos: processos.size,
    },
  })
}
