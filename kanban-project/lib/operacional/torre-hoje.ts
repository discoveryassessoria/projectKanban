// lib/operacional/torre-hoje.ts
// ============================================================================
// HOJE — "O que está pegando hoje?" (consolidação da Torre, 06/10/2026). PURO.
//
// Só ALARMES, no máximo SEIS números, todos clicáveis (L3: o número é o tamanho da lista que o clique abre — o MESMO predicado). Nenhum botão de
// ação aqui: cada linha leva ao lugar onde se resolve (Tarefas atribui e age na linha; a página do processo concentra as decisões do processo).
//   Atrasadas · Vencem hoje · Vencem amanhã · Sem responsável (aguardando distribuição) · Bloqueadas · Aguardando terceiros há tempo demais
// ============================================================================
import { linhasDoKpi, type ChaveKpi, type LinhaParaKpi } from './torre-kpis'
import { predicadoDaVisao, type LinhaParaVisao, type VisaoTarefas } from './torre-tarefas-tela'

export interface AlarmeDeHoje {
  chave: string
  rotulo: string
  cor: 'red' | 'amb' | 'blu'
  /** O que o clique abre na aba Tarefas: um KPI (`?kpi=`) ou uma visão (`?visao=`). */
  abre: { tipo: 'kpi'; kpi: ChaveKpi } | { tipo: 'visao'; visao: VisaoTarefas }
  /** A regra, por extenso (o `title` do cartão). */
  regra: string
}

export const ALARMES_DE_HOJE: readonly AlarmeDeHoje[] = [
  { chave: 'atrasadas', rotulo: 'Atrasadas', cor: 'red', abre: { tipo: 'kpi', kpi: 'venc' }, regra: 'Prazo da tarefa já passou (dia operacional).' },
  { chave: 'hoje', rotulo: 'Vencem hoje', cor: 'amb', abre: { tipo: 'kpi', kpi: 'hoje' }, regra: 'O prazo da tarefa é hoje.' },
  { chave: 'amanha', rotulo: 'Vencem amanhã', cor: 'blu', abre: { tipo: 'kpi', kpi: 'amanha' }, regra: 'O prazo da tarefa é amanhã.' },
  { chave: 'semdono', rotulo: 'Sem responsável', cor: 'red', abre: { tipo: 'kpi', kpi: 'ninguem' }, regra: 'Aguardando distribuição: tarefa aberta sem responsável. Quem atribui é a aba Tarefas.' },
  { chave: 'bloqueadas', rotulo: 'Bloqueadas', cor: 'amb', abre: { tipo: 'visao', visao: 'bloqueadas' }, regra: 'Bloqueio de verdade (espera de terceiro não é bloqueio).' },
  { chave: 'terceiros', rotulo: 'Aguardando terceiros há tempo demais', cor: 'amb', abre: { tipo: 'kpi', kpi: 'cob' }, regra: 'Esperando resposta de fora com a cobrança vencida.' },
]

type LinhaDeHoje = LinhaParaKpi & LinhaParaVisao

/** As linhas que o alarme conta — a MESMA função que filtra a aba Tarefas quando o cartão é clicado. */
export function linhasDoAlarme<T extends LinhaDeHoje>(a: AlarmeDeHoje, linhas: T[], agora: Date): T[] {
  return a.abre.tipo === 'kpi' ? linhasDoKpi(a.abre.kpi, linhas, agora) : linhas.filter(predicadoDaVisao(a.abre.visao, null, agora))
}

/** O número do alarme = o tamanho da lista que ele abre. */
export const numeroDoAlarme = (a: AlarmeDeHoje, linhas: LinhaDeHoje[], agora: Date): number => linhasDoAlarme(a, linhas, agora).length

/** Onde o alarme leva (a mesma URL que a Torre escreve ao abrir a aba Tarefas com aquele filtro). */
export const urlDoAlarme = (a: AlarmeDeHoje): string => `/torre?aba=tarefas&${a.abre.tipo === 'kpi' ? `kpi=${a.abre.kpi}` : `visao=${a.abre.visao}`}`

/** Onde se RESOLVE cada decisão do "Precisa de você" (só link — nenhum botão em Hoje). */
export function destinoDaDecisao(i: { tipo: string; processoId: number | null; link: string }): { href: string; rotulo: string } {
  if (i.tipo === 'SEM_DONO') return { href: '/torre?aba=tarefas&visao=semdono', rotulo: 'Atribuir em Tarefas' }
  if (i.tipo === 'CARGA') return { href: '/torre?aba=equipe', rotulo: 'Ver a Equipe' }
  return { href: i.processoId != null ? `/torre/processo/${i.processoId}#decisoes` : i.link, rotulo: 'Resolver no processo' }
}
