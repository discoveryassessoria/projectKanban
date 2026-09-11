// lib/operacional/parse-filtros-gerenciais.ts
// ============================================================================
// UMA LEITURA DE QUERYSTRING, DUAS ROTAS.
//
// `/api/operacao/visao-global` (Lista/Kanban) e `/api/operacao/visao-global/
// familias` (Visão Geral) precisam entender EXATAMENTE os mesmos filtros —
// "Fase = Genealogia" tem que recortar o mesmo universo nas duas telas. Cada
// rota reimplementando o parse é a receita para a mesma pergunta divergir por
// um `p.get()` esquecido numa das duas.
// ============================================================================
import type { NextRequest } from 'next/server'
import type { PrioridadeTarefa, StatusTarefa, TipoTarefa } from '@prisma/client'
import type { ColunaKanban, FiltrosGerenciais } from '@/lib/operacional/tarefa-projecoes'

const COLUNAS: ColunaKanban[] = [
  'SEM_RESPONSAVEL', 'A_FAZER', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'BLOQUEADA', 'CONCLUIDA',
]
const DATA_TIPOS: NonNullable<FiltrosGerenciais['dataTipo']>[] = [
  'criada', 'concluida', 'vencimento', 'ultimaAtividade', 'mudancaFase',
]

const inteiro = (v: string | null): number | null => {
  const n = Number(v)
  return v != null && Number.isInteger(n) && n > 0 ? n : null
}
const bandeira = (v: string | null) => v === '1' || v === 'true'

export function parseFiltrosGerenciais(request: NextRequest): FiltrosGerenciais {
  const p = request.nextUrl.searchParams
  const colunaPedida = p.get('coluna')
  const dias = inteiro(p.get('semMovimentacaoDias'))
  const dataTipoPedido = p.get('dataTipo')
  const statusProcessoPedido = p.get('statusProcesso')
  const tipoTarefaPedido = p.getAll('tipoTarefa').filter(Boolean)

  return {
    responsavelId: inteiro(p.get('responsavel')),
    semResponsavel: bandeira(p.get('semResponsavel')),
    faseMacroKey: p.get('fase') || null,
    status: (p.getAll('status').filter(Boolean) as StatusTarefa[]) || undefined,
    coluna: colunaPedida && (COLUNAS as string[]).includes(colunaPedida) ? (colunaPedida as ColunaKanban) : null,
    prioridade: (p.getAll('prioridade').filter(Boolean) as PrioridadeTarefa[]) || undefined,
    atrasadas: bandeira(p.get('atrasadas')),
    venceHoje: bandeira(p.get('venceHoje')),
    processoId: inteiro(p.get('processo')),
    pessoaId: inteiro(p.get('pessoa')),
    familiaId: inteiro(p.get('familia')),
    etapaKey: p.getAll('etapa').filter(Boolean).length ? p.getAll('etapa').filter(Boolean) : null,
    equipeKey: p.getAll('equipe').filter(Boolean).length ? p.getAll('equipe').filter(Boolean) : null,
    executavelAgora: p.has('executavelAgora') ? bandeira(p.get('executavelAgora')) : undefined,
    proximos7Dias: bandeira(p.get('proximos7Dias')),
    aguardandoTerceiro: bandeira(p.get('aguardandoTerceiro')),
    bloqueada: bandeira(p.get('bloqueada')),
    pendenciasFasesAnteriores: bandeira(p.get('pendenciasFasesAnteriores')),
    semMovimentacao: dias != null ? { diasSemAtividade: dias } : null,
    busca: p.get('busca'),
    incluirEncerradas: bandeira(p.get('incluirEncerradas')),
    tipoTarefa: tipoTarefaPedido.length ? (tipoTarefaPedido as TipoTarefa[]) : null,
    statusProcesso: statusProcessoPedido === 'ATIVO' || statusProcessoPedido === 'CONCLUIDO' ? statusProcessoPedido : null,
    dataTipo: dataTipoPedido && (DATA_TIPOS as string[]).includes(dataTipoPedido) ? (dataTipoPedido as FiltrosGerenciais['dataTipo']) : null,
    dataInicio: p.get('dataInicio') || null,
    dataFim: p.get('dataFim') || null,
    marcoFaseConcluida: bandeira(p.get('marcoFaseConcluida')),
    pagina: inteiro(p.get('pagina')) ?? 1,
    porPagina: inteiro(p.get('porPagina')) ?? 300,
  }
}
