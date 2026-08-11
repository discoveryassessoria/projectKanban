// lib/operacional/tarefa-projecoes.ts
// ============================================================================
// AS PROJEÇÕES DA TAREFA — Minha Fila, Fila da Equipe e o dossiê de uma tarefa.
//
// Nenhuma delas é entidade. Todas leem a MESMA `Tarefa` e devolvem o mesmo
// `taskId` — é isso que faz a Central, a tela de Tarefas e a fila de quem
// executa falarem do mesmo trabalho em vez de cada uma inventar a sua verdade.
//
// ─── ATRASO É CONDIÇÃO, NÃO ESTADO ──────────────────────────────────────────
// "Atrasada" não pode ser um `statusTarefa`: uma tarefa bloqueada E atrasada
// precisa continuar dizendo que está bloqueada — é o bloqueio que alguém tem de
// resolver. Transformar atraso em estado apagaria o motivo pelo qual ela parou,
// justamente no caso em que ele mais importa.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma, StatusTarefa } from '@prisma/client'
import { STATUS_ATIVOS } from './tarefa-canonica'

export interface LinhaDeFila {
  taskId: number
  titulo: string
  processoId: number | null
  processoNome: string | null
  pessoaNome: string | null
  faseMacroKey: string | null
  etapaAtual: string | null
  statusTarefa: StatusTarefa
  equipeKey: string | null
  responsavelId: number | null
  responsavelNome: string | null
  prioridade: string
  dataPrazo: string | null
  /** Condição derivada, não estado: convive com bloqueada, aguardando etc. */
  atrasada: boolean
  diasParaPrazo: number | null
  /** Dependência obrigatória ainda aberta — a tarefa existe, mas não pode andar. */
  aguardandoDependencia: boolean
  /** Perdeu a causa depois de iniciada e espera decisão humana. */
  requerDecisao: boolean
  /** O que se está obtendo: o item do catálogo por trás da obrigação. */
  servico: string | null
  criadaEm: string | null
  /** Quando a responsabilidade foi definida — nulo enquanto ninguém a assumiu. */
  atribuidaEm: string | null
}

const SELECT = {
  id: true, titulo: true, processoId: true, faseMacroKey: true, statusTarefa: true,
  equipeKey: true, responsavelId: true, prioridade: true, dataPrazo: true, causaRemovidaEm: true,
  processo: { select: { nome: true } },
  responsavel: { select: { nome: true } },
  // `pessoaId` é ref SOLTA a Pessoa (sem relation no modelo) — o nome é
  // resolvido em lote por quem projeta, nunca com uma consulta por linha.
  pessoaId: true,
  createdAt: true, dataAtribuicao: true,
  necessidade: { select: { itemCatalogo: { select: { name: true } } } },
  workflowStepInstance: { select: { stepKey: true, snapshot: true } },
  dependeDe: { select: { obrigatoria: true, dependeDe: { select: { statusTarefa: true } } } },
} satisfies Prisma.TarefaSelect

type Bruta = Prisma.TarefaGetPayload<{ select: typeof SELECT }>

function projetar(t: Bruta, agora: Date, nomes?: Map<number, string>): LinhaDeFila {
  const snap = t.workflowStepInstance?.snapshot as { label?: string } | null
  const dias = t.dataPrazo ? Math.ceil((t.dataPrazo.getTime() - agora.getTime()) / 86400000) : null
  const terminal = !STATUS_ATIVOS.includes(t.statusTarefa)
  return {
    taskId: t.id,
    titulo: t.titulo,
    processoId: t.processoId,
    processoNome: t.processo?.nome ?? null,
    pessoaNome: t.pessoaId != null ? nomes?.get(t.pessoaId) ?? null : null,
    faseMacroKey: t.faseMacroKey,
    etapaAtual: snap?.label ?? t.workflowStepInstance?.stepKey ?? null,
    statusTarefa: t.statusTarefa,
    equipeKey: t.equipeKey,
    responsavelId: t.responsavelId,
    responsavelNome: t.responsavel?.nome ?? null,
    prioridade: t.prioridade,
    dataPrazo: t.dataPrazo?.toISOString() ?? null,
    // Só o que ainda é trabalho a fazer pode estar atrasado: tarefa concluída
    // ontem com prazo de anteontem não é uma pendência de hoje.
    atrasada: !terminal && t.dataPrazo != null && t.dataPrazo < agora,
    diasParaPrazo: dias,
    aguardandoDependencia: t.dependeDe.some(
      (d) => d.obrigatoria && !['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'].includes(d.dependeDe.statusTarefa),
    ),
    requerDecisao: t.causaRemovidaEm != null,
    servico: t.necessidade?.itemCatalogo?.name ?? null,
    criadaEm: t.createdAt?.toISOString() ?? null,
    atribuidaEm: t.dataAtribuicao?.toISOString() ?? null,
  }
}

/** Os nomes das pessoas das linhas — UMA consulta, nunca uma por tarefa. */
async function nomesDasPessoas(linhas: Array<{ pessoaId: number | null }>): Promise<Map<number, string>> {
  const ids = [...new Set(linhas.map((l) => l.pessoaId).filter((x): x is number => x != null))]
  if (ids.length === 0) return new Map()
  const pessoas = await prisma.pessoa.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, sobrenome: true } })
  return new Map(pessoas.map((p) => [p.id, [p.nome, p.sobrenome].filter(Boolean).join(' ')]))
}

/**
 * MINHA FILA — o que ESTA pessoa tem para fazer.
 *
 * Ordenada pelo que a operação olha primeiro: atrasado, depois prazo mais
 * próximo, depois prioridade. Tarefa sem prazo vai para o fim, não para o
 * começo: ausência de prazo não é urgência.
 */
export async function minhaFila(usuarioId: number, agora = new Date()): Promise<LinhaDeFila[]> {
  const linhas = await prisma.tarefa.findMany({
    where: { responsavelId: usuarioId, statusTarefa: { in: STATUS_ATIVOS } },
    select: SELECT,
    orderBy: [{ dataPrazo: { sort: 'asc', nulls: 'last' } }, { prioridade: 'desc' }, { id: 'asc' }],
  })
  const nomes = await nomesDasPessoas(linhas)
  return ordenarFila(linhas.map((t) => projetar(t, agora, nomes)))
}

/**
 * FILA DA EQUIPE — o trabalho que ainda não tem dono.
 *
 * É a tela do gestor: tudo aqui está esperando uma decisão de distribuição, e
 * não uma execução. Tarefa com responsável sai daqui e aparece na fila dele.
 */
export async function filaDaEquipe(equipeKey: string, agora = new Date()): Promise<LinhaDeFila[]> {
  const linhas = await prisma.tarefa.findMany({
    where: { equipeKey, responsavelId: null, statusTarefa: { in: STATUS_ATIVOS } },
    select: SELECT,
    orderBy: [{ dataPrazo: { sort: 'asc', nulls: 'last' } }, { prioridade: 'desc' }, { id: 'asc' }],
  })
  const nomes = await nomesDasPessoas(linhas)
  return ordenarFila(linhas.map((t) => projetar(t, agora, nomes)))
}

/**
 * A ORDEM QUE A OPERAÇÃO OLHA — determinística, e não `createdAt`.
 *
 * Ordenar pela data de criação diz em que ordem o sistema criou o trabalho, o
 * que não interessa a ninguém às sete da manhã. O que interessa é o que já
 * estourou, o que é urgente e o que vence primeiro.
 *
 * Os degraus são excludentes e nesta ordem: atrasadas, urgentes, com prazo,
 * sem prazo. Ausência de prazo NÃO é urgência — vai para o fim. Dentro do mesmo
 * degrau, o prazo mais próximo primeiro; empate resolve pelo id, para que duas
 * leituras seguidas nunca devolvam ordens diferentes.
 */
function degrau(l: LinhaDeFila): number {
  if (l.atrasada) return 0
  if (l.prioridade === 'URGENTE') return 1
  if (l.dataPrazo != null) return 2
  return 3
}

export function ordenarFila(linhas: LinhaDeFila[]): LinhaDeFila[] {
  const peso: Record<string, number> = { URGENTE: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 }
  return [...linhas].sort((a, b) => {
    const d = degrau(a) - degrau(b)
    if (d !== 0) return d
    const pa = a.dataPrazo ? Date.parse(a.dataPrazo) : Number.POSITIVE_INFINITY
    const pb = b.dataPrazo ? Date.parse(b.dataPrazo) : Number.POSITIVE_INFINITY
    if (pa !== pb) return pa - pb
    const pr = (peso[a.prioridade] ?? 9) - (peso[b.prioridade] ?? 9)
    if (pr !== 0) return pr
    return a.taskId - b.taskId
  })
}

/**
 * SEM RESPONSÁVEL — o trabalho que existe e ainda não é de ninguém.
 *
 * É a tela de quem distribui. `responsavelId = null` é estado operacional
 * NORMAL: a tarefa nasceu porque a obrigação virou executável, e espera uma
 * decisão humana sobre quem a executa. Não é órfã, não é erro, e o motor não
 * inventa um dono para ela.
 *
 * Diferente de `filaDaEquipe`, esta projeção NÃO exige `equipeKey`: enquanto
 * não existir cadastro de equipe, exigir a chave esconderia da gestão
 * exatamente as tarefas que ninguém reivindicou.
 */
export async function semResponsavel(agora = new Date(), filtro: { equipeKey?: string | null } = {}): Promise<LinhaDeFila[]> {
  const linhas = await prisma.tarefa.findMany({
    where: {
      responsavelId: null,
      statusTarefa: { in: STATUS_ATIVOS },
      ...(filtro.equipeKey ? { equipeKey: filtro.equipeKey } : {}),
    },
    select: SELECT,
  })
  const nomes = await nomesDasPessoas(linhas)
  return ordenarFila(linhas.map((t) => projetar(t, agora, nomes)))
}

/** Os recortes que a fila mostra separados — sem virar estados novos. */
export function agruparFila(linhas: LinhaDeFila[]) {
  return {
    atrasadas: linhas.filter((l) => l.atrasada),
    emAndamento: linhas.filter((l) => l.statusTarefa === 'EM_ANDAMENTO' && !l.atrasada),
    aguardandoTerceiro: linhas.filter((l) => l.statusTarefa === 'AGUARDANDO_TERCEIRO'),
    bloqueadas: linhas.filter((l) => l.statusTarefa === 'BLOQUEADA'),
    aguardandoDependencia: linhas.filter((l) => l.aguardandoDependencia),
    proximas: linhas.filter((l) => l.statusTarefa === 'NAO_INICIADA' && !l.atrasada),
  }
}

/**
 * O DOSSIÊ DE UMA TAREFA — "por que eu existo?" respondido por completo.
 *
 * Reúne num lugar só o que hoje exigiria abrir quatro telas: a causa, o
 * responsável, a etapa, o prazo, as dependências e a última transição. É a
 * ferramenta de diagnóstico quando alguém pergunta por que uma tarefa está
 * onde está.
 */
export async function dossieDaTarefa(tarefaId: number) {
  const t = await prisma.tarefa.findUnique({
    where: { id: tarefaId },
    select: {
      ...SELECT,
      origem: true, ciclo: true, chaveIdempotencia: true, justificativa: true, motivoCodigo: true,
      dataInicio: true, dataAtribuicao: true, dataConclusao: true, createdAt: true,
      slaPausadoEm: true, slaPausaAcumuladaMin: true, causaRemovidaMotivo: true,
      workflowInstanceId: true,
      necessidade: { select: { id: true, itemCatalogo: { select: { code: true, name: true } } } },
      documento: { select: { id: true, tipo: true } },
      workflowInstance: {
        select: {
          id: true, faseMacroKey: true, status: true, workflowDefinitionId: true, workflowVersion: true,
          steps: { select: { id: true, stepKey: true, ordem: true, status: true, obrigatorio: true, completedAt: true }, orderBy: { ordem: 'asc' } },
        },
      },
    },
  })
  if (!t) return null

  const historico = await prisma.logAuditoria.findMany({
    where: { entidade: 'Tarefa', entidadeId: tarefaId },
    orderBy: { id: 'desc' },
    take: 30,
    select: { id: true, acao: true, usuarioId: true, descricao: true, criadoEm: true },
  })

  const linha = projetar(t as unknown as Bruta, new Date(), await nomesDasPessoas([t]))
  return {
    ...linha,
    // PROVENANCE: a cadeia inteira do "por quê", por IDs canônicos.
    porQueExisto: {
      origem: t.origem,
      chaveIdempotencia: t.chaveIdempotencia,
      processoId: t.processoId,
      faseMacroKey: t.faseMacroKey,
      ciclo: t.ciclo,
      necessidade: t.necessidade ? { id: t.necessidade.id, item: t.necessidade.itemCatalogo?.code ?? null } : null,
      documentoId: t.documento?.id ?? null,
      workflowInstanceId: t.workflowInstanceId,
      // A versão com que a tarefa nasceu — publicar uma versão nova do workflow
      // não reescreve o roteiro de quem já está trabalhando.
      workflowVersao: t.workflowInstance?.workflowVersion ?? null,
      justificativa: t.justificativa,
    },
    tempos: {
      criadaEm: t.createdAt?.toISOString() ?? null,
      atribuidaEm: t.dataAtribuicao?.toISOString() ?? null,
      iniciadaEm: t.dataInicio?.toISOString() ?? null,
      concluidaEm: t.dataConclusao?.toISOString() ?? null,
      slaPausadoDesde: t.slaPausadoEm?.toISOString() ?? null,
      minutosPausados: t.slaPausaAcumuladaMin,
    },
    etapas: t.workflowInstance?.steps ?? [],
    causaRemovida: t.causaRemovidaEm ? { em: t.causaRemovidaEm, motivo: t.causaRemovidaMotivo } : null,
    historico,
  }
}

/**
 * CARGA DE TRABALHO — conta TAREFAS, nunca etapas.
 *
 * Cinco certidões com oito passos cada são cinco trabalhos, não quarenta.
 * Contar etapa faria a carga de quem faz trabalho longo parecer oito vezes
 * maior do que é, e a distribuição seguiria esse número errado.
 */
export async function cargaPorResponsavel(agora = new Date()) {
  const linhas = await prisma.tarefa.groupBy({
    by: ['responsavelId'],
    where: { statusTarefa: { in: STATUS_ATIVOS }, responsavelId: { not: null } },
    _count: { _all: true },
  })
  const atrasadas = await prisma.tarefa.groupBy({
    by: ['responsavelId'],
    where: { statusTarefa: { in: STATUS_ATIVOS }, responsavelId: { not: null }, dataPrazo: { lt: agora } },
    _count: { _all: true },
  })
  const mapaAtraso = new Map(atrasadas.map((a) => [a.responsavelId, a._count._all]))
  return linhas.map((l) => ({
    responsavelId: l.responsavelId!,
    tarefasAtivas: l._count._all,
    atrasadas: mapaAtraso.get(l.responsavelId) ?? 0,
  }))
}
