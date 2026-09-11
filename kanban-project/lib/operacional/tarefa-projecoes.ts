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
import {
  diaOperacional,
  janelaDoDiaOperacional,
  janelaDoDiaOperacionalDe,
  inicioDoDiaOperacional,
  estadoTemporal,
} from '@/lib/operacional/tempo-operacional'
import type { AdvanceResultado, Prisma, PrioridadeTarefa, PrismaClient, StatusTarefa, TipoTarefa } from '@prisma/client'

/**
 * O LEITOR — o cliente global por padrão, outro quando quem chama precisa.
 *
 * Existe pelo mesmo motivo que na leitura da fase: para que dê para MEDIR
 * quantas idas ao banco a projeção faz. Sem isto, "a fila não tem N+1" é uma
 * afirmação sobre o código, não um fato verificado com volume.
 */
type Leitor = PrismaClient | Prisma.TransactionClient
import { STATUS_ATIVOS, STATUS_TERMINAIS, STATUS_EM_ESPERA, executavelAgora as tarefaExecutavelAgora } from './tarefa-canonica'
import { resolveWorkflowStepEditor } from '@/src/lib/process-stage/step-editor-registry'
import { phaseKeyToFaseCode, faseCodeToPhaseKey, rotuloDoPasso, labelDaFasePorPhaseKey, getOrdemFase } from '@/src/lib/process-stage/fases-catalog'
import { fasesAnterioresA } from '@/src/services/regularizacao-historica'

/** Estados concluídos — fora deles, "atrasada"/"sem movimentação"/etc. deixam de fazer sentido. */
const STATUS_CONCLUIDOS: StatusTarefa[] = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI']
/** Tudo que aparece no quadro operacional: em curso + concluído (fora cancelada/supersedida). */
const STATUS_NO_QUADRO: StatusTarefa[] = [...STATUS_ATIVOS, ...STATUS_CONCLUIDOS]

/** Fragmento Prisma: a tarefa TEM (ou não) dependência obrigatória ainda aberta — mesma regra de `podeExecutar`, em SQL. */
function whereDependenciaAberta(aberta: boolean): Prisma.TarefaWhereInput {
  const condicao: Prisma.TarefaDependenciaWhereInput = {
    obrigatoria: true,
    dependeDe: { statusTarefa: { notIn: STATUS_CONCLUIDOS } },
  }
  return aberta ? { dependeDe: { some: condicao } } : { dependeDe: { none: condicao } }
}

/**
 * "EXECUTÁVEL AGORA" como filtro de BANCO — o mesmo predicado de
 * `executavelAgora` (`tarefa-canonica.ts`), traduzido para SQL em vez de
 * aplicado linha a linha: terminal, em espera (bloqueada/aguardando
 * terceiro/cliente), com dependência obrigatória aberta, ou com causa
 * removida pendente de decisão — nenhuma dessas tem ação sobre o TRABALHO
 * disponível agora.
 */
function whereExecutavelAgora(executavel: boolean): Prisma.TarefaWhereInput {
  const naoExecutavel: Prisma.TarefaWhereInput = {
    OR: [
      { statusTarefa: { in: [...STATUS_TERMINAIS, ...STATUS_EM_ESPERA] } },
      { causaRemovidaEm: { not: null } },
      whereDependenciaAberta(true),
    ],
  }
  return executavel ? { NOT: naoExecutavel } : naoExecutavel
}

/**
 * A ÚLTIMA ATIVIDADE REAL de cada tarefa — a última linha da auditoria com
 * `entidade='Tarefa'` para aquele id, NUNCA `updatedAt`: `updatedAt` sobe por
 * efeitos em cascata de OUTROS registros (ex.: necessidade documental
 * recalculada por um documento vizinho), sem que ninguém tenha de fato
 * trabalhado nesta tarefa. "Sem movimentação" precisa da atividade que
 * alguém REGISTROU, não da que o banco marcou.
 */
async function ultimaAtividadeReal(ids: number[], db: Leitor = prisma): Promise<Map<number, Date>> {
  const mapa = new Map<number, Date>()
  if (ids.length === 0) return mapa
  const logs = await db.logAuditoria.groupBy({
    by: ['entidadeId'],
    where: { entidade: 'Tarefa', entidadeId: { in: ids } },
    _max: { criadoEm: true },
  })
  for (const l of logs) {
    if (l.entidadeId != null && l._max.criadoEm) mapa.set(l.entidadeId, l._max.criadoEm)
  }
  return mapa
}

/**
 * IDs de tarefas SEM MOVIMENTAÇÃO REAL há N dias, dentro de um recorte já
 * filtrado (`where`) — dois passos porque `LogAuditoria` não tem relação
 * declarada com `Tarefa` (é polimórfica): primeiro os candidatos do recorte,
 * depois a última atividade real deles em lote. O resultado entra como
 * `id: { in: [...] }` no `where` final, então paginação e contagem continuam
 * batendo com o que é devolvido — o filtro nunca corta a lista já paginada.
 */
async function idsSemMovimentacao(
  where: Prisma.TarefaWhereInput, diasSemAtividade: number, agora: Date, db: Leitor = prisma,
): Promise<number[]> {
  const candidatos = await db.tarefa.findMany({ where, select: { id: true, createdAt: true } })
  if (candidatos.length === 0) return []
  const ultimas = await ultimaAtividadeReal(candidatos.map((c) => c.id), db)
  const limite = new Date(agora.getTime() - diasSemAtividade * 86400000)
  return candidatos.filter((c) => (ultimas.get(c.id) ?? c.createdAt) < limite).map((c) => c.id)
}

/**
 * IDs de tarefa com atividade REAL (auditoria, não `updatedAt`) DENTRO do
 * período — a resposta a "o que Fulano fez hoje", quando combinado com
 * `responsavelId`. Sem atividade real registrada, a tarefa nunca entra aqui:
 * `createdAt` não é usado como substituto (isso é `dataTipo: 'criada'`).
 */
async function idsComAtividadeNoPeriodo(
  where: Prisma.TarefaWhereInput, dataInicio: string | null | undefined, dataFim: string | null | undefined, db: Leitor = prisma,
): Promise<number[]> {
  const candidatos = await db.tarefa.findMany({ where, select: { id: true } })
  if (candidatos.length === 0) return []
  const ultimas = await ultimaAtividadeReal(candidatos.map((c) => c.id), db)
  // Mesma régua de `janelaDoDiaOperacionalDe` — `dataFim` precisa ir até o
  // ÚLTIMO instante do dia, nunca até a meia-noite dele.
  const de = dataInicio ? janelaDoDiaOperacionalDe(dataInicio).inicio.getTime() : -Infinity
  const ate = dataFim ? janelaDoDiaOperacionalDe(dataFim).fim.getTime() : Infinity
  return candidatos.filter((c) => { const t = ultimas.get(c.id); return t != null && t.getTime() >= de && t.getTime() <= ate }).map((c) => c.id)
}

/**
 * PENDÊNCIAS DE FASES ANTERIORES — como filtro de banco para a leitura linha a
 * linha (`visaoGerencial`/`indicadoresGerenciais`): tarefa ativa cujo
 * `faseMacroKey` mapeia para uma fase ANTERIOR à fase atual do PRÓPRIO
 * processo dela (`fasesAnterioresA`, catálogo canônico). O avanço de fase do
 * processo nunca conclui essas tarefas — é exatamente essa lacuna que a Home
 * hoje ignora por design (`carregarBase`) e que este filtro existe para
 * expor, aditivamente, sem mudar o que a Home já faz.
 */
async function whereFasesAnteriores(
  escopo: { processoId?: number | null; familiaId?: number | null }, db: Leitor = prisma,
): Promise<Prisma.TarefaWhereInput> {
  const whereProcesso: Prisma.ProcessoWhereInput = { faseAtualKey: { not: null } }
  if (escopo.processoId != null) whereProcesso.id = escopo.processoId
  if (escopo.familiaId != null) whereProcesso.familiaId = escopo.familiaId
  const processos = await db.processo.findMany({ where: whereProcesso, select: { id: true, faseAtualKey: true } })

  const clauses: Prisma.TarefaWhereInput[] = []
  for (const p of processos) {
    // `fasesAnterioresA` recebe a PHASE KEY (não o `FaseCode`) e resolve
    // sozinha — chamar `phaseKeyToFaseCode` aqui é só para descartar chave
    // que não pertence ao fluxo oficial, sem deixar a função lançar.
    if (!phaseKeyToFaseCode(p.faseAtualKey)) continue
    const anteriores = fasesAnterioresA(p.faseAtualKey as string)
      .map((c) => faseCodeToPhaseKey(c))
      .filter((k): k is string => k != null)
    if (anteriores.length === 0) continue
    clauses.push({ processoId: p.id, faseMacroKey: { in: anteriores }, statusTarefa: { in: STATUS_ATIVOS } })
  }
  // Nenhum processo no escopo tem fase anterior pendente: `id: -1` nunca bate
  // com nenhuma tarefa real, em vez de um `where` vazio que bateria com todas.
  return clauses.length > 0 ? { OR: clauses } : { id: -1 }
}

// O TEMPO VEM DE UM LUGAR SÓ.
//
// Estas funções moravam aqui, e a Central Operacional tinha as suas: uma
// comparava o DIA no fuso da operação, a outra comparava blocos de 24 horas a
// partir do instante. Às 23h, a mesma tarefa "vencia amanhã" numa tela e
// "vencia hoje" na outra. Agora as duas telas importam a MESMA régua.
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
  /** A frase única do prazo — a MESMA que a Central e o Kanban mostram. */
  rotuloDoPrazo: string
  diasParaPrazo: number | null
  /** Dependência obrigatória ainda aberta — a tarefa existe, mas não pode andar. */
  aguardandoDependencia: boolean
  /** Perdeu a causa depois de iniciada e espera decisão humana. */
  requerDecisao: boolean
  /**
   * EXISTE AÇÃO SOBRE O TRABALHO AGORA? Ver `executavelAgora` em
   * `tarefa-canonica.ts` — não é `!aguardandoDependencia` sozinho: também
   * exclui terminal, bloqueada/aguardando terceiro-cliente e `requerDecisao`.
   */
  executavelAgora: boolean
  /**
   * QUEM é o terceiro esperado — SÓ quando `Documento.orgao` resolve, nunca
   * usado para decidir SE a tarefa está esperando (isso é `statusTarefa`).
   * `null` = espera real, terceiro não identificado.
   */
  terceiroNome: string | null
  /** O que se está obtendo: o item do catálogo por trás da obrigação. */
  servico: string | null
  criadaEm: string | null
  /** Quando a responsabilidade foi definida — nulo enquanto ninguém a assumiu. */
  atribuidaEm: string | null
}

const SELECT = {
  id: true, titulo: true, processoId: true, faseMacroKey: true, statusTarefa: true,
  equipeKey: true, responsavelId: true, prioridade: true, dataPrazo: true, causaRemovidaEm: true,
  // O ESTADO TEMPORAL precisa destes: conclusão congela o atraso, e a pausa de
  // SLA é o que separa "parado esperando o cartório" de "parado devendo".
  dataConclusao: true, slaPausadoEm: true, slaPausaAcumuladaMin: true,
  processo: { select: { nome: true } },
  responsavel: { select: { nome: true } },
  // `pessoaId` é ref SOLTA a Pessoa (sem relation no modelo) — o nome é
  // resolvido em lote por quem projeta, nunca com uma consulta por linha.
  pessoaId: true,
  createdAt: true, dataAtribuicao: true,
  necessidade: { select: { itemCatalogo: { select: { name: true } } } },
  workflowStepInstance: { select: { stepKey: true, snapshot: true, stepDefinitionId: true } },
  dependeDe: { select: { obrigatoria: true, dependeDe: { select: { statusTarefa: true } } } },
  // SÓ para IDENTIFICAR o terceiro quando a tarefa já está esperando um — o
  // vínculo em si nunca decide o estado (ver `aguardandoTerceiro` em
  // `whereGerencial`).
  documento: { select: { orgao: { select: { name: true } } } },
} satisfies Prisma.TarefaSelect

type Bruta = Prisma.TarefaGetPayload<{ select: typeof SELECT }>

function projetar(
  t: Bruta, agora: Date,
  nomes?: Map<number, string>,
  rotulosDePasso?: Map<number, string>,
): LinhaDeFila {
  // A RÉGUA CANÔNICA — a mesma da Central, do Kanban e da notificação.
  const tempo = estadoTemporal({
    dataPrazo: t.dataPrazo,
    dataConclusao: t.dataConclusao,
    statusTarefa: t.statusTarefa,
    aguardandoTerceiro: t.statusTarefa === 'AGUARDANDO_TERCEIRO',
    slaPausadoEm: t.slaPausadoEm,
    slaPausaAcumuladaMin: t.slaPausaAcumuladaMin,
    criadaEm: t.createdAt,
    agora,
  })
  const aguardandoDependencia = t.dependeDe.some(
    (d) => d.obrigatoria && !['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'].includes(d.dependeDe.statusTarefa),
  )
  return {
    taskId: t.id,
    titulo: t.titulo,
    processoId: t.processoId,
    processoNome: t.processo?.nome ?? null,
    pessoaNome: t.pessoaId != null ? nomes?.get(t.pessoaId) ?? null : null,
    faseMacroKey: t.faseMacroKey,
    // O NOME DO PASSO, na ordem da fonte mais próxima do que foi publicado:
    // o snapshot do momento da instanciação, depois a DEFINIÇÃO publicada, e a
    // chave técnica só como último recurso. A instância da Emissão Documental
    // nasceu sem label no snapshot, e por isso a fila mostrava
    // "solicitar_certidao" para quem só queria ler "Solicitar certidão" — o
    // nome existia o tempo todo, no passo publicado.
    // O NOME DO PASSO pela resolução ÚNICA (`rotuloDoPasso`): snapshot →
    // definição publicada → catálogo da fase → chave, e só então a chave.
    //
    // Esta cadeia parava um degrau antes do catálogo, e a Central não parava. A
    // instância da Emissão Documental nasceu sem `label` no snapshot: a mesma
    // etapa da mesma tarefa era "Solicitar certidão" numa tela e
    // "solicitar_certidao" na outra.
    etapaAtual: t.workflowStepInstance
      ? rotuloDoPasso({
          stepKey: t.workflowStepInstance.stepKey,
          snapshot: t.workflowStepInstance.snapshot,
          labelPublicado:
            t.workflowStepInstance.stepDefinitionId != null
              ? rotulosDePasso?.get(t.workflowStepInstance.stepDefinitionId) ?? null
              : null,
          faseCode: phaseKeyToFaseCode(t.faseMacroKey),
        })
      : null,
    statusTarefa: t.statusTarefa,
    equipeKey: t.equipeKey,
    responsavelId: t.responsavelId,
    responsavelNome: t.responsavel?.nome ?? null,
    prioridade: t.prioridade,
    dataPrazo: t.dataPrazo?.toISOString() ?? null,
    // Atrasada, vence hoje e dias restantes são do estado temporal canônico:
    // uma tarefa concluída ontem com prazo de anteontem não é pendência de
    // hoje, e dentro do dia de vencimento ela não está atrasada — está vencendo
    // hoje, que é outra coisa e leva outra cor.
    atrasada: tempo.atrasado,
    diasParaPrazo: tempo.diasParaPrazo,
    rotuloDoPrazo: tempo.rotulo,
    aguardandoDependencia: aguardandoDependencia,
    requerDecisao: t.causaRemovidaEm != null,
    executavelAgora: tarefaExecutavelAgora({
      statusTarefa: t.statusTarefa, aguardandoDependencia, causaRemovidaEm: t.causaRemovidaEm,
    }),
    terceiroNome: t.documento?.orgao?.name ?? null,
    servico: t.necessidade?.itemCatalogo?.name ?? null,
    criadaEm: t.createdAt?.toISOString() ?? null,
    atribuidaEm: t.dataAtribuicao?.toISOString() ?? null,
  }
}

/**
 * OS NOMES PUBLICADOS DOS PASSOS — uma consulta, nunca uma por tarefa.
 *
 * `stepDefinitionId` é FK solta (sem relation no modelo), então o join não vem
 * de graça no `select`: resolve-se em lote, como os nomes de pessoa.
 */
async function rotulosDosPassos(linhas: Bruta[], db: Leitor = prisma): Promise<Map<number, string>> {
  const ids = [...new Set(
    linhas.map((l) => l.workflowStepInstance?.stepDefinitionId).filter((x): x is number => x != null),
  )]
  if (ids.length === 0) return new Map()
  const defs = await db.phaseInternalWorkflowStep.findMany({
    where: { id: { in: ids } }, select: { id: true, label: true },
  })
  return new Map(defs.map((d) => [d.id, d.label]))
}

/** Os nomes das pessoas das linhas — UMA consulta, nunca uma por tarefa. */
async function nomesDasPessoas(linhas: Array<{ pessoaId: number | null }>, db: Leitor = prisma): Promise<Map<number, string>> {
  const ids = [...new Set(linhas.map((l) => l.pessoaId).filter((x): x is number => x != null))]
  if (ids.length === 0) return new Map()
  const pessoas = await db.pessoa.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, sobrenome: true } })
  return new Map(pessoas.map((p) => [p.id, [p.nome, p.sobrenome].filter(Boolean).join(' ')]))
}

/**
 * MINHA FILA — o que ESTA pessoa tem para fazer.
 *
 * Ordenada pelo que a operação olha primeiro: atrasado, depois prazo mais
 * próximo, depois prioridade. Tarefa sem prazo vai para o fim, não para o
 * começo: ausência de prazo não é urgência.
 */
export async function minhaFila(usuarioId: number, agora = new Date(), db: Leitor = prisma): Promise<LinhaGerencial[]> {
  // UMA FONTE, DUAS TELAS.
  //
  // A Minha Fila lia uma projeção mais pobre que a da visão gerencial: sem
  // "vence hoje", sem há-quanto-tempo-espera, sem motivo do bloqueio. O
  // funcionário via menos do que o gestor sobre o próprio trabalho — e duas
  // projeções do mesmo fato acabam divergindo.
  //
  // Agora é a MESMA consulta, com o recorte de quem executa.
  const { linhas } = await visaoGerencial({ responsavelId: usuarioId, porPagina: 500 }, agora, db)
  // Encerradas não são fila: o que já foi entregue não é trabalho de hoje.
  return ordenarFila(linhas.filter((l) => l.coluna !== 'CONCLUIDA')) as LinhaGerencial[]
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
  const [nomes, rotulos] = await Promise.all([nomesDasPessoas(linhas), rotulosDosPassos(linhas)])
  return ordenarFila(linhas.map((t) => projetar(t, agora, nomes, rotulos)))
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
  const [nomes, rotulos] = await Promise.all([nomesDasPessoas(linhas), rotulosDosPassos(linhas)])
  return ordenarFila(linhas.map((t) => projetar(t, agora, nomes, rotulos)))
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

/** Um fato da vida da tarefa, já em linguagem de gente. */
export interface FatoDaTimeline {
  em: string
  tipo: 'tarefa' | 'etapa' | 'observacao' | 'anexo' | 'protocolo'
  texto: string
  autor: string | null
}

/** Os eventos do motor em português — o vocabulário técnico não vai para a tela. */
/** Finalidade do arquivo em português — o enum é do banco, não da leitura. */
const ROTULO_FINALIDADE: Record<string, string> = {
  REQUERIMENTO_ENVIADO: 'Requerimento enviado',
  COMPROVANTE_PROTOCOLO: 'Comprovante de protocolo',
  COMPROVANTE_CONTATO: 'Comprovante de contato',
  DOCUMENTO_RECEBIDO: 'Documento recebido',
  OUTRO: 'Arquivo',
}

const FRASE_DO_EVENTO: Record<string, string> = {
  PASSO_DISPONIBILIZADO: 'Etapa liberada',
  PASSO_INICIADO: 'Etapa iniciada',
  PASSO_CONCLUIDO: 'Etapa concluída',
  PASSO_BLOQUEADO: 'Etapa bloqueada',
  PASSO_REABERTO: 'Etapa reaberta',
  PASSO_CANCELADO: 'Etapa cancelada',
  PASSO_DISPENSADO: 'Etapa dispensada',
  PASSO_EXECUTADO: 'Etapa executada, aguardando aprovação',
  PASSO_APROVADO: 'Etapa aprovada',
  TAREFA_CONCLUIDA: 'Trabalho concluído',
  TAREFA_GERADA: 'Tarefa criada',
  TAREFA_ATRIBUIDA: 'Tarefa atribuída',
  TAREFA_INICIADA: 'Trabalho iniciado',
  TAREFA_SINCRONIZADA: 'Estado da tarefa recalculado',
}

/**
 * REÚNE OS FATOS DAS FONTES CANÔNICAS NUMA HISTÓRIA SÓ.
 *
 * Ordem decrescente: quem abre a tarefa quer saber o que aconteceu por último.
 * Nenhum fato é inventado aqui — cada linha existe porque existe um registro.
 */
export function montarTimeline(fontes: {
  historico: Array<{ id: number; acao: string; descricao: string | null; criadoEm: Date }>
  eventos: Array<{ id: number; tipo: string; criadoEm: Date; nomeDaEtapa: string | null }>
  observacoes: Array<{ id: number; texto: string; createdAt: Date; criadoPor: { nome: string } | null }>
  anexos: Array<{ id: number; nome: string; tipo: string; createdAt: Date; criadoPor: { nome: string } | null; documentType: { name: string } | null }>
  protocolos: Array<{ id: number; numeroProtocolo: string | null; createdAt: Date }>
}): FatoDaTimeline[] {
  const fatos: FatoDaTimeline[] = []

  // A auditoria da TAREFA já escreve em português — é a fonte mais legível.
  for (const h of fontes.historico) {
    fatos.push({ em: h.criadoEm.toISOString(), tipo: 'tarefa', texto: h.descricao ?? h.acao, autor: null })
  }
  // Os eventos do WORKFLOW dizem o que aconteceu com as ETAPAS, e ganham o
  // nome publicado do passo — "Etapa concluída: Solicitar certidão" responde
  // mais do que "PASSO_CONCLUIDO".
  //
  // ─── UM FATO, UMA LINHA ───────────────────────────────────────────────────
  // Iniciar a tarefa deixa rastro nas DUAS fontes: a auditoria escreve
  // "Tarefa iniciada" e o motor emite `TAREFA_INICIADA` no workflow, porque o
  // passo começou junto. São o mesmo acontecimento visto de dois lugares — e a
  // timeline mostrava os dois, o que fazia parecer que a tarefa tinha sido
  // iniciada duas vezes.
  //
  // A auditoria vence: ela já está em português e é a fonte que narra a TAREFA.
  // Os eventos que falam da tarefa (e não da etapa) saem daqui.
  const EVENTOS_QUE_A_AUDITORIA_JA_CONTA = new Set(['TAREFA_INICIADA', 'TAREFA_CONCLUIDA'])
  for (const e of fontes.eventos) {
    if (EVENTOS_QUE_A_AUDITORIA_JA_CONTA.has(e.tipo)) continue
    const base = FRASE_DO_EVENTO[e.tipo]
    if (!base) continue
    fatos.push({ em: e.criadoEm.toISOString(), tipo: 'etapa', texto: e.nomeDaEtapa ? `${base}: ${e.nomeDaEtapa}` : base, autor: null })
  }
  for (const o of fontes.observacoes) {
    fatos.push({ em: o.createdAt.toISOString(), tipo: 'observacao', texto: o.texto, autor: o.criadoPor?.nome ?? null })
  }
  for (const a of fontes.anexos) {
    const oque = a.documentType?.name ?? 'Arquivo'
    fatos.push({ em: a.createdAt.toISOString(), tipo: 'anexo', texto: `${oque} anexado: ${a.nome}`, autor: a.criadoPor?.nome ?? null })
  }
  for (const p of fontes.protocolos) {
    if (!p.numeroProtocolo) continue
    fatos.push({ em: p.createdAt.toISOString(), tipo: 'protocolo', texto: `Protocolo registrado: ${p.numeroProtocolo}`, autor: null })
  }

  return fatos.sort((a, b) => Date.parse(b.em) - Date.parse(a.em))
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
      necessidadeId: true, documentoId: true, workflowStepInstanceId: true, descricao: true,
      dataInicio: true, dataAtribuicao: true, dataConclusao: true, createdAt: true,
      slaPausadoEm: true, slaPausaAcumuladaMin: true, causaRemovidaMotivo: true,
      workflowInstanceId: true,
      necessidade: { select: { id: true, itemCatalogo: { select: { code: true, name: true } } } },
      documento: { select: { id: true, tipo: true } },
      workflowInstance: {
        select: {
          id: true, faseMacroKey: true, status: true, workflowDefinitionId: true, workflowVersion: true,
          steps: {
            select: {
              id: true, stepKey: true, ordem: true, status: true, obrigatorio: true, completedAt: true,
              snapshot: true, necessidadeId: true, documentoId: true, prazo: true, responsavelId: true,
            },
            orderBy: { ordem: 'asc' },
          },
        },
      },
    },
  })
  if (!t) return null

  // ═══════════════════════════════════════════════════════════════════════
  // O QUE A TAREFA MOSTRA — E DE ONDE VEM
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Nada aqui é armazenado pela Tarefa. Anexo é `DocumentoArquivo`, protocolo é
  // `Protocolo`, observação é `DocumentoObservacao` — as três já existiam, com
  // autor, data e vínculos próprios. A Tarefa PROJETA: mostra o que pertence ao
  // trabalho dela e some quando o trabalho acaba.
  //
  // O recorte é o DOCUMENTO da tarefa. Sem documento não há o que projetar:
  // uma tarefa administrativa de fase não tem anexo nem protocolo.
  const anexos = t.documentoId != null
    ? await prisma.documentoArquivo.findMany({
        where: { documentoId: t.documentoId },
        select: {
          id: true, nome: true, url: true, tipo: true, tamanho: true, mimeType: true,
          createdAt: true, stepInstanceId: true, protocoloId: true,
          documentType: { select: { name: true } },
          criadoPor: { select: { nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    : []

  // O protocolo é do PROCESSO e alcança o documento pela junção oficial
  // (`ProtocoloDocumento`) — não existe um `protocolo.documentoId`, e inventar
  // um seria a segunda fonte que o cadastro evitou de propósito.
  const protocolos = t.documentoId != null
    ? await prisma.protocolo.findMany({
        where: { numeroProtocolo: { not: null }, documentos: { some: { documentoId: t.documentoId } } },
        select: { id: true, numeroProtocolo: true, tipo: { select: { nome: true } }, createdAt: true, solicitacaoId: true },
        orderBy: { createdAt: 'desc' },
      })
    : []

  const observacoes = t.documentoId != null
    ? await prisma.documentoObservacao.findMany({
        where: { documentoId: t.documentoId },
        select: { id: true, texto: true, createdAt: true, stepInstanceId: true, criadoPor: { select: { nome: true } } },
        orderBy: { createdAt: 'desc' },
      })
    : []

  // Os eventos do WORKFLOW desta tarefa — as transições de etapa que a
  // auditoria da tarefa não registra (ela fala da tarefa, não dos passos).
  const eventosDoWorkflow = t.workflowInstanceId != null
    ? await prisma.workflowEvento.findMany({
        where: { workflowInstanceId: t.workflowInstanceId },
        select: { id: true, tipo: true, criadoEm: true, stepInstanceId: true },
        orderBy: { id: 'desc' },
        take: 120,
      })
    : []

  // `WorkflowEvento` guarda o id do passo, não uma relação — os nomes vêm numa
  // consulta só, e o mesmo mapa filtra os eventos que são DESTA unidade de
  // trabalho (a instância é da fase e carrega os passos de vários documentos).
  const passosDaUnidade = new Map(
    (t.workflowInstance?.steps ?? [])
      .filter((st) =>
        t.necessidadeId != null ? st.necessidadeId === t.necessidadeId
        : t.documentoId != null ? st.documentoId === t.documentoId
        : st.id === t.workflowStepInstanceId,
      )
      .map((st) => {
        const snap = st.snapshot as { label?: string; titulo?: string } | null
        return [st.id, snap?.label ?? snap?.titulo ?? st.stepKey]
      }),
  )

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
    // AS ETAPAS DESTA TAREFA — não as da fase inteira.
    //
    // A instância do workflow é da FASE: numa Emissão Documental com quatro
    // certidões, ela guarda os passos das quatro. Devolver todos aqui faria o
    // funcionário ver, dentro da tarefa da certidão de nascimento, as etapas da
    // certidão de casamento de outra pessoa.
    //
    // O recorte é a própria unidade de trabalho da tarefa. Sem obrigação
    // identificada (passo administrativo de fase), o recorte é o passo corrente.
    etapas: (t.workflowInstance?.steps ?? [])
      .filter((s) =>
        t.necessidadeId != null ? s.necessidadeId === t.necessidadeId
        : t.documentoId != null ? s.documentoId === t.documentoId
        : s.id === t.workflowStepInstanceId,
      )
      .map((s) => ({
        id: s.id,
        ordem: s.ordem,
        // O EXECUTOR VEM DA CONFIGURAÇÃO, NUNCA DA FASE.
        //
        // `if (fase === "Emissão Documental") abrirModalSolicitar` amarraria a
        // operação a uma fase e deixaria qualquer fase futura sem superfície. O
        // binding é do REGISTRY, por stepKey publicado — o mesmo mapa que a
        // Central da Etapa consulta, então as duas entradas montam o MESMO
        // executor.
        editorKind: resolveWorkflowStepEditor({ stepKey: s.stepKey, phaseKey: t.faseMacroKey }).kind,
        especializado: resolveWorkflowStepEditor({ stepKey: s.stepKey, phaseKey: t.faseMacroKey }).especifico,
        // O executor é documental: sem documento ele não tem o que operar.
        documentoId: s.documentoId,
        // O rótulo publicado vem do snapshot; a chave técnica é o último recurso.
        titulo: (s.snapshot as { label?: string; titulo?: string } | null)?.label
          ?? (s.snapshot as { label?: string; titulo?: string } | null)?.titulo
          ?? s.stepKey,
        stepKey: s.stepKey,
        status: s.status,
        obrigatorio: s.obrigatorio,
        concluidaEm: s.completedAt?.toISOString() ?? null,
        prazo: s.prazo?.toISOString() ?? null,
        atual: s.id === t.workflowStepInstanceId,
      })),
    causaRemovida: t.causaRemovidaEm ? { em: t.causaRemovidaEm, motivo: t.causaRemovidaMotivo } : null,
    documentoId: t.documentoId,
    // A LINHA DO TEMPO É PROJEÇÃO — não uma quinta tabela de histórico.
    //
    // Os fatos já existem em quatro lugares canônicos: a auditoria da tarefa,
    // os eventos do workflow, as observações e os arquivos. Cada um responde a
    // uma pergunta diferente e nenhum deles conta a história inteira; gravar um
    // quinto registro "unificado" seria criar a divergência que este sistema
    // passou meses eliminando. Aqui eles são LIDOS e ordenados juntos.
    timeline: montarTimeline({
      historico,
      eventos: eventosDoWorkflow
        .filter((e) => e.stepInstanceId == null || passosDaUnidade.has(e.stepInstanceId))
        .map((e) => ({ ...e, nomeDaEtapa: e.stepInstanceId != null ? passosDaUnidade.get(e.stepInstanceId) ?? null : null })),
      observacoes,
      anexos,
      protocolos,
    }),
    anexos: anexos.map((a) => ({
      id: a.id,
      nome: a.nome,
      url: a.url,
      // O que o arquivo É pelo cadastro mestre; o `tipo` é a finalidade dele
      // dentro da operação. Os dois juntos respondem "que papel esse arquivo
      // cumpre aqui" sem que ninguém precise abrir o PDF.
      classificacao: a.documentType?.name ?? null,
      finalidade: a.tipo,
      tamanho: a.tamanho,
      mimeType: a.mimeType,
      autor: a.criadoPor?.nome ?? null,
      em: a.createdAt.toISOString(),
      /** Etapa em que o arquivo entrou — é o que liga o anexo ao momento. */
      etapaId: a.stepInstanceId,
      temProtocolo: a.protocoloId != null,
    })),
    protocolos: protocolos.map((p) => ({
      id: p.id,
      numero: p.numeroProtocolo,
      tipo: p.tipo?.nome ?? null,
      em: p.createdAt.toISOString(),
      solicitacaoId: p.solicitacaoId,
    })),
    observacoes: observacoes.map((o) => ({
      id: o.id,
      texto: o.texto,
      autor: o.criadoPor?.nome ?? null,
      em: o.createdAt.toISOString(),
      etapaId: o.stepInstanceId,
    })),
    historico,
  }
}

const FRASE_DO_RESULTADO_DE_FASE: Partial<Record<AdvanceResultado, (de: string, para: string | null) => string>> = {
  AVANCADO: (de, para) => `Fase concluída: ${de} → ${para ?? '—'}`,
  FORCADO: (de, para) => `Fase concluída (avanço forçado): ${de} → ${para ?? '—'}`,
  REABERTO: (de) => `Fase reaberta: ${de}`,
  RETORNADO: (de, para) => `Processo retornado para ${para ?? de}`,
  MOVIDO: (de, para) => `Movimentação manual de fase: ${de} → ${para ?? '—'}`,
}

/** Um fato do PROCESSO — mesma forma de `FatoDaTimeline`, grain maior (todas as tarefas do processo, não uma). */
export interface AtividadeDoProcesso {
  em: string
  tipo: 'marco' | 'tarefa' | 'etapa' | 'observacao' | 'anexo'
  texto: string
  autor: string | null
}

/**
 * O HISTÓRICO DE ATIVIDADES DE UM PROCESSO — a granularidade completa (spec
 * §10/§11), incluindo os marcos gerenciais (spec §12) na MESMA linha do
 * tempo, sem tabela nova: cada fato já mora em `LogAuditoria` (por tarefa),
 * `PhaseAdvanceLog` (transição de fase), `DocumentoObservacao` e
 * `DocumentoArquivo` (via os documentos das tarefas deste processo) — aqui
 * eles são só LIDOS e intercalados por data, como `montarTimeline` já faz por
 * tarefa.
 */
export async function atividadesDoProcesso(processoId: number, opts: { limite?: number } = {}): Promise<AtividadeDoProcesso[]> {
  const limite = Math.min(Math.max(opts.limite ?? 200, 1), 500)

  const tarefas = await prisma.tarefa.findMany({
    where: { processoId }, select: { id: true, documentoId: true, workflowInstanceId: true },
  })
  const tarefaIds = tarefas.map((t) => t.id)
  const documentoIds = [...new Set(tarefas.map((t) => t.documentoId).filter((x): x is number => x != null))]
  const workflowInstanceIds = [...new Set(tarefas.map((t) => t.workflowInstanceId).filter((x): x is number => x != null))]

  const [historico, logsDeFase, observacoes, anexos, eventosDeWorkflow] = await Promise.all([
    tarefaIds.length
      ? prisma.logAuditoria.findMany({
          where: { entidade: 'Tarefa', entidadeId: { in: tarefaIds } },
          orderBy: { id: 'desc' }, take: limite,
          select: { id: true, acao: true, descricao: true, criadoEm: true, usuario: { select: { nome: true } } },
        })
      : [],
    prisma.phaseAdvanceLog.findMany({
      where: { processoId, resultado: { in: RESULTADOS_TRANSICAO_REAL } },
      orderBy: { criadoEm: 'desc' }, take: limite,
      select: { id: true, faseAtual: true, fasePretendida: true, resultado: true, criadoEm: true },
    }),
    documentoIds.length
      ? prisma.documentoObservacao.findMany({
          where: { documentoId: { in: documentoIds } },
          orderBy: { createdAt: 'desc' }, take: limite,
          select: { id: true, texto: true, createdAt: true, criadoPor: { select: { nome: true } } },
        })
      : [],
    documentoIds.length
      ? prisma.documentoArquivo.findMany({
          where: { documentoId: { in: documentoIds } },
          orderBy: { createdAt: 'desc' }, take: limite,
          select: { id: true, nome: true, createdAt: true, criadoPor: { select: { nome: true } }, documentType: { select: { name: true } } },
        })
      : [],
    workflowInstanceIds.length
      ? prisma.workflowEvento.findMany({
          where: { workflowInstanceId: { in: workflowInstanceIds } },
          orderBy: { id: 'desc' }, take: limite,
          select: { id: true, tipo: true, criadoEm: true, stepInstanceId: true },
        })
      : [],
  ])

  const fatos: AtividadeDoProcesso[] = []
  for (const h of historico) fatos.push({ em: h.criadoEm.toISOString(), tipo: 'tarefa', texto: h.descricao ?? h.acao, autor: h.usuario?.nome ?? null })

  for (const l of logsDeFase) {
    const frase = FRASE_DO_RESULTADO_DE_FASE[l.resultado]
    if (!frase) continue
    const de = labelDaFasePorPhaseKey(l.faseAtual) ?? l.faseAtual
    const para = l.fasePretendida ? labelDaFasePorPhaseKey(l.fasePretendida) ?? l.fasePretendida : null
    fatos.push({ em: l.criadoEm.toISOString(), tipo: 'marco', texto: frase(de, para), autor: null })
  }

  // Mesma regra de `montarTimeline`: "tarefa iniciada"/"tarefa concluída" já
  // vêm da auditoria em português — os eventos do workflow que sobram aqui
  // são só os de ETAPA.
  const EVENTOS_JA_CONTADOS_PELA_AUDITORIA = new Set(['TAREFA_INICIADA', 'TAREFA_CONCLUIDA'])
  for (const e of eventosDoWorkflowComFrase(eventosDeWorkflow, EVENTOS_JA_CONTADOS_PELA_AUDITORIA)) fatos.push(e)

  for (const o of observacoes) fatos.push({ em: o.createdAt.toISOString(), tipo: 'observacao', texto: o.texto, autor: o.criadoPor?.nome ?? null })
  for (const a of anexos) {
    const oque = a.documentType?.name ?? 'Arquivo'
    fatos.push({ em: a.createdAt.toISOString(), tipo: 'anexo', texto: `${oque} anexado: ${a.nome}`, autor: a.criadoPor?.nome ?? null })
  }

  return fatos.sort((a, b) => Date.parse(b.em) - Date.parse(a.em)).slice(0, limite)
}

/** Fração compartilhada com `montarTimeline`: eventos de ETAPA em português, sem os que a auditoria da tarefa já narra. */
function eventosDoWorkflowComFrase(
  eventos: Array<{ id: number; tipo: string; criadoEm: Date; stepInstanceId: number | null }>,
  jaContados: Set<string>,
): AtividadeDoProcesso[] {
  const fatos: AtividadeDoProcesso[] = []
  for (const e of eventos) {
    if (jaContados.has(e.tipo)) continue
    const base = FRASE_DO_EVENTO[e.tipo]
    if (!base) continue
    fatos.push({ em: e.criadoEm.toISOString(), tipo: 'etapa', texto: base, autor: null })
  }
  return fatos
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
    where: { statusTarefa: { in: STATUS_ATIVOS }, responsavelId: { not: null }, dataPrazo: { lt: inicioDoDiaOperacional(agora) } },
    _count: { _all: true },
  })
  const mapaAtraso = new Map(atrasadas.map((a) => [a.responsavelId, a._count._all]))
  return linhas.map((l) => ({
    responsavelId: l.responsavelId!,
    tarefasAtivas: l._count._all,
    atrasadas: mapaAtraso.get(l.responsavelId) ?? 0,
  }))
}

// ============================================================================
// A VISÃO GERENCIAL — a operação inteira, numa consulta só.
//
// Minha Fila responde "o que EU faço agora". Sem responsável responde "o que
// ainda não é de ninguém". Falta a pergunta do gestor, que é outra: "o que
// existe, onde está, com quem, e o que já estourou".
//
// É a MESMA `Tarefa` das outras duas projeções, com o mesmo `taskId`. O que
// muda é o recorte e o que se deriva por cima dele. Não existe tabela de
// board, não existe cópia, não existe status paralelo: a coluna do Kanban é
// função do `statusTarefa` canônico, calculada na leitura.
//
// ─── A COLUNA NÃO É UM ESTADO ───────────────────────────────────────────────
// `coluna` é derivada, como `atrasada`. Se fosse persistida, existiriam duas
// respostas para "em que pé está esta tarefa" — e a segunda ficaria para trás.
// Por isso ela também NÃO se move: arrastar um card executa um COMANDO, e a
// coluna muda porque o estado mudou. Nunca o contrário.
// ============================================================================

export type ColunaKanban =
  | 'SEM_RESPONSAVEL' | 'A_FAZER' | 'EM_ANDAMENTO'
  | 'AGUARDANDO_TERCEIRO' | 'BLOQUEADA' | 'CONCLUIDA'

export const COLUNAS_KANBAN: ColunaKanban[] = [
  'SEM_RESPONSAVEL', 'A_FAZER', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'BLOQUEADA', 'CONCLUIDA',
]

/**
 * DE ESTADO CANÔNICO PARA COLUNA — mapeamento visual, sem inventar estado.
 *
 * "Sem responsável" vem PRIMEIRO porque responde à pergunta mais urgente do
 * gestor: uma tarefa sem dono não anda, esteja em que estado estiver.
 *
 * `AGUARDANDO_CLIENTE` e `AGUARDANDO_TERCEIRO` são estados DIFERENTES no
 * domínio e continuam diferentes no banco. Dividem coluna porque a decisão do
 * gestor é a mesma — cobrar quem está devendo —, e o card diz de quem se
 * espera. Sétima coluna dividiria a atenção sem mudar a ação.
 *
 * `CANCELADA` e `SUPERSEDIDA` NÃO viram "Concluída": nada foi entregue. Ficam
 * fora do quadro, e só aparecem se o filtro de status pedir explicitamente.
 */
export function colunaDaTarefa(l: { statusTarefa: StatusTarefa; responsavelId: number | null }): ColunaKanban | null {
  if (l.statusTarefa === 'CONCLUIDO_RECEBIDO' || l.statusTarefa === 'CONCLUIDO_NAO_POSSUI') return 'CONCLUIDA'
  if (l.statusTarefa === 'CANCELADA' || l.statusTarefa === 'SUPERSEDIDA') return null
  if (l.responsavelId == null) return 'SEM_RESPONSAVEL'
  if (l.statusTarefa === 'BLOQUEADA') return 'BLOQUEADA'
  if (l.statusTarefa === 'AGUARDANDO_TERCEIRO' || l.statusTarefa === 'AGUARDANDO_CLIENTE') return 'AGUARDANDO_TERCEIRO'
  if (l.statusTarefa === 'EM_ANDAMENTO') return 'EM_ANDAMENTO'
  return 'A_FAZER'
}

export interface LinhaGerencial extends LinhaDeFila {
  /** Derivado do prazo no fuso operacional — não é status. */
  venceHoje: boolean
  coluna: ColunaKanban
  /** De quem se espera: o card precisa dizer, já que a coluna é uma só. */
  esperandoDe: 'terceiro' | 'cliente' | null
  /** Desde quando espera — vem da auditoria, não de coluna nova. */
  esperandoDesde: string | null
  esperandoHaDias: number | null
  /** Por que parou. Bloqueio sem motivo visível obriga a abrir cinco telas. */
  motivoBloqueio: string | null
  concluidaEm: string | null
}

export interface FiltrosGerenciais {
  responsavelId?: number | null
  /** `true` recorta o que não é de ninguém — é filtro, não estado. */
  semResponsavel?: boolean
  faseMacroKey?: string | null
  status?: StatusTarefa[]
  coluna?: ColunaKanban | null
  prioridade?: PrioridadeTarefa[]
  atrasadas?: boolean
  venceHoje?: boolean
  processoId?: number | null
  pessoaId?: number | null
  /** Agrupamento visual da Central Operacional — nunca dono da tarefa. */
  familiaId?: number | null
  etapaKey?: string[] | null
  equipeKey?: string[] | null
  /** Negação de `aguardandoDependencia`/em-espera/terminal/causa-removida — ver `tarefa-canonica.ts`. */
  executavelAgora?: boolean
  proximos7Dias?: boolean
  /** Açúcar sobre `status`: idêntico a `status: ['AGUARDANDO_TERCEIRO','AGUARDANDO_CLIENTE']`. */
  aguardandoTerceiro?: boolean
  /** Açúcar sobre `status`: idêntico a `status: ['BLOQUEADA']`. */
  bloqueada?: boolean
  /** Sem atividade REAL (auditoria, não `updatedAt`) há N dias — ver `ultimaAtividadeReal`. */
  semMovimentacao?: { diasSemAtividade: number } | null
  /** Tarefa ativa numa fase anterior à fase ATUAL do próprio processo — ver `whereFasesAnteriores`. */
  pendenciasFasesAnteriores?: boolean
  /** Busca por tarefa, pessoa, processo, família, documento, protocolo ou órgão — uma caixa só, como se procura. */
  busca?: string | null
  /** Encerradas sem entrega (cancelada/supersedida) ficam fora por padrão. */
  incluirEncerradas?: boolean
  /** NORMAL (obrigação da fase) ou TRANSVERSAL (Operação Antecipada) — ver `motor-antecipacao`. */
  tipoTarefa?: TipoTarefa[] | null
  /**
   * Derivado de `Processo.dataConclusao` — não existe enum de status do
   * processo (removido como legado, ver `docs/architecture`). CONCLUIDO =
   * `dataConclusao` preenchida; ATIVO = ainda não.
   */
  statusProcesso?: 'ATIVO' | 'CONCLUIDO' | null
  /**
   * QUAL DATA o período (`dataInicio`/`dataFim`) recorta — "data" nunca é um
   * conceito único (CLAUDE.md + spec Tarefas e Projetos §5): criação, entrega,
   * vencimento, última atividade REAL e mudança de fase são perguntas
   * diferentes e usam fontes diferentes. Default `vencimento` preserva o
   * comportamento anterior de quem só passava `dataInicio`/`dataFim`.
   */
  dataTipo?: 'criada' | 'concluida' | 'vencimento' | 'ultimaAtividade' | 'mudancaFase' | null
  dataInicio?: string | null
  dataFim?: string | null
  /**
   * MARCO GERENCIAL: recorta por PROCESSO que teve uma fase real e
   * efetivamente concluída (`PhaseAdvanceLog.resultado` em AVANCADO/FORCADO)
   * — nunca por contagem de tarefas. Combinado com `faseMacroKey`, filtra pela
   * fase de ORIGEM da transição ("Fase = Genealogia + Marco = fase concluída"
   * = processos que SAÍRAM de Genealogia). Combinado com `dataTipo:
   * 'mudancaFase'` + período, recorta pela data da transição, não da tarefa.
   */
  marcoFaseConcluida?: boolean
  pagina?: number
  porPagina?: number
  /**
   * Ordenação da LISTA DE FAMÍLIAS (`agregacaoPorFamilia`) — nunca um score
   * artificial: cada modo é uma ordenação lexicográfica sobre contagens reais.
   * `atencao` (padrão) = mais atrasadas primeiro, depois mais paradas
   * (bloqueadas+aguardando terceiro), depois mais executáveis agora — cada
   * critério é um número que já aparece na tela, então dá para explicar
   * qualquer posição só apontando pra ele.
   */
  ordenacaoFamilia?: 'atencao' | 'prazo' | 'familia' | 'ultimaAtividade'
}

/**
 * O `where` do Prisma para os filtros gerenciais.
 *
 * Tudo que dá para filtrar no BANCO é filtrado no banco: paginar em cima de um
 * array já carregado é buscar mil linhas para mostrar vinte. O que sobra em
 * memória é só o que é DERIVADO (atrasada, vence hoje, coluna) — e mesmo esses
 * viram condição de data no `where` quando dá.
 */
function whereGerencial(f: FiltrosGerenciais, agora: Date): Prisma.TarefaWhereInput {
  const where: Prisma.TarefaWhereInput = {}
  const e: Prisma.TarefaWhereInput[] = []

  if (f.status?.length) where.statusTarefa = { in: f.status }
  else if (f.incluirEncerradas) where.statusTarefa = { in: [...STATUS_NO_QUADRO, 'CANCELADA', 'SUPERSEDIDA'] }
  else where.statusTarefa = { in: STATUS_NO_QUADRO }

  if (f.semResponsavel) where.responsavelId = null
  else if (f.responsavelId != null) where.responsavelId = f.responsavelId

  if (f.faseMacroKey) where.faseMacroKey = f.faseMacroKey
  if (f.prioridade?.length) where.prioridade = { in: f.prioridade }
  if (f.processoId != null) where.processoId = f.processoId
  if (f.pessoaId != null) where.pessoaId = f.pessoaId
  if (f.etapaKey?.length) e.push({ workflowStepInstance: { stepKey: { in: f.etapaKey } } })
  if (f.equipeKey?.length) where.equipeKey = { in: f.equipeKey }
  if (f.tipoTarefa?.length) where.tipo = { in: f.tipoTarefa }

  // `familiaId` e `statusProcesso` recortam pelo mesmo relacionamento
  // (`Tarefa.processo`) — um único objeto, nunca dois `where.processo`
  // sobrescrevendo um ao outro.
  if (f.familiaId != null || f.statusProcesso) {
    where.processo = {
      ...(f.familiaId != null ? { familiaId: f.familiaId } : {}),
      // Não existe enum de status do processo (legado removido, ver
      // `docs/architecture`): ATIVO/CONCLUIDO é derivado de `dataConclusao`.
      ...(f.statusProcesso ? { dataConclusao: f.statusProcesso === 'CONCLUIDO' ? { not: null } : null } : {}),
    }
  }

  // "DATA" NÃO É UM CONCEITO ÚNICO — cada `dataTipo` filtra uma COLUNA
  // diferente. `ultimaAtividade` e `mudancaFase` exigem ida assíncrona ao
  // banco (auditoria / PhaseAdvanceLog) e são resolvidos em
  // `mergeFiltrosAssincronos`, não aqui.
  if ((f.dataInicio || f.dataFim) && f.dataTipo && f.dataTipo !== 'ultimaAtividade' && f.dataTipo !== 'mudancaFase') {
    // `dataInicio`/`dataFim` são "AAAA-MM-DD" (o dia escolhido na tela) — o
    // FIM precisa ir até o ÚLTIMO instante daquele dia operacional, nunca até
    // a meia-noite dele. `new Date("2026-09-11")` nos dois extremos do MESMO
    // dia vira um único instante (meia-noite UTC): um `gte`/`lte` apontando
    // para o mesmo ponto não casa com nada que aconteceu durante o dia. Ver
    // `janelaDoDiaOperacionalDe` — a mesma régua de fuso do resto do sistema.
    const range: Prisma.DateTimeFilter = {}
    if (f.dataInicio) range.gte = janelaDoDiaOperacionalDe(f.dataInicio).inicio
    if (f.dataFim) range.lte = janelaDoDiaOperacionalDe(f.dataFim).fim
    if (f.dataTipo === 'criada') e.push({ createdAt: range })
    else if (f.dataTipo === 'concluida') e.push({ dataConclusao: range })
    else if (f.dataTipo === 'vencimento') e.push({ dataPrazo: range })
  }

  // Atrasada é condição derivada, mas se traduz exatamente em SQL: prazo no
  // passado e trabalho ainda por fazer.
  if (f.atrasadas) e.push({ dataPrazo: { lt: inicioDoDiaOperacional(agora) }, statusTarefa: { in: STATUS_ATIVOS } })
  if (f.venceHoje) {
    const { inicio, fim } = janelaDoDiaOperacional(agora)
    e.push({ dataPrazo: { gte: inicio, lte: fim } })
  }
  if (f.proximos7Dias) {
    const limite = new Date(inicioDoDiaOperacional(agora))
    limite.setDate(limite.getDate() + 7)
    e.push({ dataPrazo: { gte: inicioDoDiaOperacional(agora), lte: limite }, statusTarefa: { in: STATUS_ATIVOS } })
  }

  // AGUARDANDO TERCEIRO — CANÔNICO e EVENTADO: `statusTarefa` só chega a
  // AGUARDANDO_TERCEIRO/AGUARDANDO_CLIENTE por `aguardarTerceiro()` (ação
  // humana registrada) ou por uma etapa do workflow em `AGUARDANDO`
  // (`estadoDerivado`) — nunca por inferência. QUEM é o terceiro é outra
  // pergunta (identificação, não estado): ver `terceiroNome` na projeção da
  // linha, resolvido via `Documento.orgao` SÓ quando esse vínculo existe, e
  // nunca usado para DECIDIR se a tarefa está esperando.
  if (f.aguardandoTerceiro) e.push({ statusTarefa: { in: ['AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE'] } })
  if (f.bloqueada) e.push({ statusTarefa: 'BLOQUEADA' })
  if (f.executavelAgora != null) e.push(whereExecutavelAgora(f.executavelAgora))

  // A busca é uma caixa só porque é assim que se procura: o gestor lembra do
  // nome da pessoa, do processo, da família, do documento, do protocolo ou do
  // órgão — não de qual campo exatamente guarda o que ele lembra.
  const q = f.busca?.trim()
  if (q) {
    e.push({
      OR: [
        { titulo: { contains: q, mode: 'insensitive' } },
        { processo: { nome: { contains: q, mode: 'insensitive' } } },
        { processo: { familia: { nome: { contains: q, mode: 'insensitive' } } } },
        { pessoa: { nome: { contains: q, mode: 'insensitive' } } },
        { pessoa: { sobrenome: { contains: q, mode: 'insensitive' } } },
        { documento: { descricao: { contains: q, mode: 'insensitive' } } },
        { documento: { orgao: { name: { contains: q, mode: 'insensitive' } } } },
        { processo: { protocolos: { some: { OR: [
          { numeroProtocolo: { contains: q, mode: 'insensitive' } },
          { numeroProcesso: { contains: q, mode: 'insensitive' } },
        ] } } } },
      ],
    })
  }

  if (e.length) where.AND = e
  return where
}

/** Desde quando cada tarefa espera / por que bloqueou — UMA consulta, em lote. */
async function contextoDeParada(ids: number[], db: Leitor = prisma): Promise<Map<number, { esperandoDesde?: Date; motivo?: string }>> {
  const mapa = new Map<number, { esperandoDesde?: Date; motivo?: string }>()
  if (ids.length === 0) return mapa
  // Ordem crescente e sobrescrita: o último registro de cada tarefa vence, que
  // é o que interessa — a espera ATUAL, não a primeira que já houve.
  const logs = await db.logAuditoria.findMany({
    where: { entidade: 'Tarefa', entidadeId: { in: ids }, acao: { in: ['TAREFA_AGUARDANDO_TERCEIRO', 'TAREFA_BLOQUEADA'] } },
    select: { entidadeId: true, acao: true, criadoEm: true, detalhes: true },
    orderBy: { criadoEm: 'asc' },
  })
  for (const l of logs) {
    if (l.entidadeId == null) continue
    const atual = mapa.get(l.entidadeId) ?? {}
    const motivo = (l.detalhes as { motivo?: string } | null)?.motivo
    if (l.acao === 'TAREFA_AGUARDANDO_TERCEIRO') atual.esperandoDesde = l.criadoEm
    else atual.motivo = motivo ?? undefined
    mapa.set(l.entidadeId, atual)
  }
  return mapa
}

/**
 * RESULTADOS que representam uma transição de fase REAL e efetiva — nunca
 * `BLOQUEADO` (tentativa negada), `CONFLITO` (CAS perdido) ou `IDEMPOTENTE`
 * (retry do mesmo pedido: o motor já garantiu que não é uma segunda
 * transição). É esta lista, e só ela, que decide "quantas vezes a fase
 * realmente mudou" — nunca contar linhas de `PhaseAdvanceLog` cruas.
 */
const RESULTADOS_TRANSICAO_REAL: AdvanceResultado[] = ['AVANCADO', 'FORCADO', 'REABERTO', 'RETORNADO', 'MOVIDO']
/** Dentre as transições reais, as que representam "esta fase terminou" — não reabertura/retorno/movimentação administrativa. */
const RESULTADOS_FASE_CONCLUIDA: AdvanceResultado[] = ['AVANCADO', 'FORCADO']

/**
 * IDs de PROCESSO com uma mudança de fase real dentro do período — a fonte é
 * `PhaseAdvanceLog`, o MESMO log que decide se um avanço aconteceu (nunca
 * contagem de tarefa, nunca `WorkflowEvento` recontado à parte). Combinado com
 * `faseMacroKey`, filtra pela fase de ORIGEM (`faseAtual` no log) — responde
 * "quais processos SAÍRAM desta fase", que é a pergunta gerencial real.
 */
async function processosComMudancaDeFase(
  args: { dataInicio?: string | null; dataFim?: string | null; faseOrigemKey?: string | null; apenasConcluida: boolean },
  db: Leitor = prisma,
): Promise<number[]> {
  const where: Prisma.PhaseAdvanceLogWhereInput = {
    resultado: { in: args.apenasConcluida ? RESULTADOS_FASE_CONCLUIDA : RESULTADOS_TRANSICAO_REAL },
  }
  if (args.faseOrigemKey) where.faseAtual = args.faseOrigemKey
  if (args.dataInicio || args.dataFim) {
    where.criadoEm = {
      ...(args.dataInicio ? { gte: janelaDoDiaOperacionalDe(args.dataInicio).inicio } : {}),
      ...(args.dataFim ? { lte: janelaDoDiaOperacionalDe(args.dataFim).fim } : {}),
    }
  }
  const logs = await db.phaseAdvanceLog.findMany({ where, select: { processoId: true }, distinct: ['processoId'] })
  return logs.map((l) => l.processoId)
}

/**
 * Os dois filtros que `whereGerencial` não consegue expressar sozinho, porque
 * dependem de outra tabela (auditoria, para "sem movimentação") ou do estado
 * de OUTROS registros (a fase atual do processo, para "pendências de fases
 * anteriores") — mesclados SEMPRE antes de contar/paginar, para que o número
 * do card e a página do drill-down nunca discordem.
 */
async function mergeFiltrosAssincronos(
  f: FiltrosGerenciais, where: Prisma.TarefaWhereInput, agora: Date, db: Leitor,
): Promise<Prisma.TarefaWhereInput> {
  const extra: Prisma.TarefaWhereInput[] = []
  if (f.semMovimentacao) {
    const ids = await idsSemMovimentacao(where, f.semMovimentacao.diasSemAtividade, agora, db)
    extra.push({ id: { in: ids } })
  }
  if (f.pendenciasFasesAnteriores) {
    extra.push(await whereFasesAnteriores({ processoId: f.processoId, familiaId: f.familiaId }, db))
  }
  if (f.dataTipo === 'ultimaAtividade' && (f.dataInicio || f.dataFim)) {
    const ids = await idsComAtividadeNoPeriodo(where, f.dataInicio, f.dataFim, db)
    extra.push({ id: { in: ids } })
  }
  if (f.marcoFaseConcluida || f.dataTipo === 'mudancaFase') {
    const processoIds = await processosComMudancaDeFase(
      { dataInicio: f.dataInicio, dataFim: f.dataFim, faseOrigemKey: f.faseMacroKey, apenasConcluida: !!f.marcoFaseConcluida },
      db,
    )
    extra.push({ processoId: { in: processoIds } })
  }
  return extra.length > 0 ? { AND: [where, ...extra] } : where
}

/** O que o topo da tela mostra — contagens, não uma tela de BI. */
export interface IndicadoresGerenciais {
  total: number
  semResponsavel: number
  emAndamento: number
  aguardandoTerceiro: number
  bloqueadas: number
  atrasadas: number
  venceHoje: number
  concluidas: number
  /** Concluídas HOJE (dia operacional) — distinto de `concluidas` (todo o recorte). */
  concluidasHoje: number
  /** Ver `executavelAgora` em `tarefa-canonica.ts` — não é `total - bloqueadas - aguardando`. */
  executavelAgora: number
}

/**
 * OS INDICADORES SÃO CONTAGENS NO BANCO, não `linhas.filter(...)`.
 *
 * Contar em memória obrigaria a carregar a operação inteira para escrever seis
 * números no topo — e o número passaria a depender da página aberta, que é
 * pior do que não ter o número.
 */
export async function indicadoresGerenciais(
  f: FiltrosGerenciais = {}, agora = new Date(),
): Promise<IndicadoresGerenciais> {
  const base = { ...f, atrasadas: false, venceHoje: false, coluna: null, status: undefined }
  const baseWhere = await mergeFiltrosAssincronos(base, whereGerencial(base, agora), agora, prisma)
  const w = (extra: Prisma.TarefaWhereInput) => ({ AND: [baseWhere, extra] })
  const janela = janelaDoDiaOperacional(agora)
  const [total, semResp, andamento, aguardando, bloqueadas, atrasadas, venceHoje, concluidas, concluidasHoje, executavel] = await Promise.all([
    prisma.tarefa.count({ where: w({ statusTarefa: { in: STATUS_ATIVOS } }) }),
    prisma.tarefa.count({ where: w({ statusTarefa: { in: STATUS_ATIVOS }, responsavelId: null }) }),
    prisma.tarefa.count({ where: w({ statusTarefa: 'EM_ANDAMENTO' }) }),
    prisma.tarefa.count({ where: w({ statusTarefa: { in: ['AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE'] } }) }),
    prisma.tarefa.count({ where: w({ statusTarefa: 'BLOQUEADA' }) }),
    prisma.tarefa.count({ where: w({ statusTarefa: { in: STATUS_ATIVOS }, dataPrazo: { lt: inicioDoDiaOperacional(agora) } }) }),
    prisma.tarefa.count({
      where: w({
        statusTarefa: { in: STATUS_ATIVOS },
        dataPrazo: { gte: janela.inicio, lte: janela.fim },
      }),
    }),
    prisma.tarefa.count({ where: w({ statusTarefa: { in: STATUS_CONCLUIDOS } }) }),
    // CANCELADA/SUPERSEDIDA nunca contam aqui: `STATUS_CONCLUIDOS` já as
    // exclui por desenho (spec: CANCELADA ≠ CONCLUÍDA).
    prisma.tarefa.count({ where: w({ statusTarefa: { in: STATUS_CONCLUIDOS }, dataConclusao: { gte: janela.inicio, lte: janela.fim } }) }),
    prisma.tarefa.count({ where: w(whereExecutavelAgora(true)) }),
  ])
  return {
    total, semResponsavel: semResp, emAndamento: andamento, aguardandoTerceiro: aguardando,
    bloqueadas, atrasadas, venceHoje, concluidas, concluidasHoje, executavelAgora: executavel,
  }
}

const SELECT_GERENCIAL = {
  ...SELECT,
  dataConclusao: true,
  justificativa: true,
  motivoCodigo: true,
} satisfies Prisma.TarefaSelect

/**
 * A VISÃO GLOBAL — Lista e Kanban leem ESTA função, e só ela.
 *
 * Duas telas, uma consulta: é o que garante que o card e a linha nunca discordem
 * sobre a mesma tarefa. A troca Lista ↔ Kanban não busca nada diferente, não
 * cria estado e não escreve — reagrupa o que já está na tela.
 */
export async function visaoGerencial(
  f: FiltrosGerenciais = {},
  agora = new Date(),
  db: Leitor = prisma,
): Promise<{ linhas: LinhaGerencial[]; total: number; pagina: number; porPagina: number }> {
  const porPagina = Math.min(Math.max(f.porPagina ?? 200, 1), 500)
  const pagina = Math.max(f.pagina ?? 1, 1)
  const where = await mergeFiltrosAssincronos(f, whereGerencial(f, agora), agora, db)

  const [total, brutas] = await Promise.all([
    db.tarefa.count({ where }),
    db.tarefa.findMany({
      where,
      select: SELECT_GERENCIAL,
      orderBy: [{ dataPrazo: { sort: 'asc', nulls: 'last' } }, { prioridade: 'desc' }, { id: 'asc' }],
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ])

  // TUDO EM LOTE, e o número de consultas NÃO depende do número de linhas:
  // uma contagem, uma página de tarefas, os nomes das pessoas, os rótulos dos
  // passos e o contexto de parada. Cinco idas ao banco para 10 tarefas e cinco
  // para 500.
  const [nomes, rotulos] = await Promise.all([nomesDasPessoas(brutas, db), rotulosDosPassos(brutas, db)])
  const paradas = await contextoDeParada(
    brutas.filter((t) => t.statusTarefa === 'BLOQUEADA' || t.statusTarefa === 'AGUARDANDO_TERCEIRO').map((t) => t.id),
    db,
  )
  const hoje = diaOperacional(agora)

  const linhas = brutas.map((t): LinhaGerencial => {
    const base = projetar(t, agora, nomes, rotulos)
    const parada = paradas.get(t.id)
    const espera = parada?.esperandoDesde ?? null
    const esperando = t.statusTarefa === 'AGUARDANDO_TERCEIRO' || t.statusTarefa === 'AGUARDANDO_CLIENTE'
    return {
      ...base,
      // Vence hoje é o DIA no fuso operacional — não "menos de 24 horas".
      venceHoje: t.dataPrazo != null && diaOperacional(t.dataPrazo) === hoje,
      coluna: colunaDaTarefa(t) ?? 'CONCLUIDA',
      esperandoDe: esperando ? (t.statusTarefa === 'AGUARDANDO_CLIENTE' ? 'cliente' : 'terceiro') : null,
      esperandoDesde: esperando ? espera?.toISOString() ?? null : null,
      esperandoHaDias: esperando && espera ? Math.floor((agora.getTime() - espera.getTime()) / 86400000) : null,
      motivoBloqueio: t.statusTarefa === 'BLOQUEADA' ? t.justificativa ?? parada?.motivo ?? null : null,
      concluidaEm: t.dataConclusao?.toISOString() ?? null,
    }
  })

  // Filtros DERIVADOS que não existem como coluna no banco entram por último,
  // sobre a página já lida. `coluna` é o único caso, e é o que o Kanban usa
  // para recortar sem uma segunda consulta.
  const recortadas = f.coluna ? linhas.filter((l) => l.coluna === f.coluna) : linhas
  return { linhas: ordenarFila(recortadas) as LinhaGerencial[], total, pagina, porPagina }
}

/**
 * AS OPÇÕES DOS FILTROS — vêm do que EXISTE, não de uma lista fixa.
 *
 * Oferecer uma fase que nenhuma tarefa tem produz filtro que devolve vazio e
 * parece defeito. Aqui as opções são agregações da própria operação, com a
 * contagem junto: o gestor escolhe sabendo quanto vai encontrar.
 */
export async function facetasGerenciais(agora = new Date()) {
  const ativas = { statusTarefa: { in: STATUS_ATIVOS } }
  const [porFase, porResponsavel, usuarios, porEquipe] = await Promise.all([
    prisma.tarefa.groupBy({ by: ['faseMacroKey'], where: ativas, _count: { _all: true } }),
    prisma.tarefa.groupBy({ by: ['responsavelId'], where: ativas, _count: { _all: true } }),
    prisma.usuario.findMany({ select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
    // `equipeKey` é texto livre (não há cadastro de Equipe ainda) — as opções
    // vêm do que EXISTE na operação, nunca de uma lista fixa.
    prisma.tarefa.groupBy({ by: ['equipeKey'], where: ativas, _count: { _all: true } }),
  ])
  const nomeDe = new Map(usuarios.map((u) => [u.id, u.nome]))
  const carga = new Map((await cargaPorResponsavel(agora)).map((c) => [c.responsavelId, c]))
  return {
    fases: porFase
      .filter((f) => f.faseMacroKey)
      .map((f) => ({ faseMacroKey: f.faseMacroKey as string, tarefas: f._count._all }))
      .sort((a, b) => b.tarefas - a.tarefas),
    responsaveis: porResponsavel
      .filter((r) => r.responsavelId != null)
      .map((r) => ({
        responsavelId: r.responsavelId as number,
        nome: nomeDe.get(r.responsavelId as number) ?? `#${r.responsavelId}`,
        tarefas: r._count._all,
        atrasadas: carga.get(r.responsavelId as number)?.atrasadas ?? 0,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
    equipes: porEquipe
      .filter((e) => e.equipeKey)
      .map((e) => ({ equipeKey: e.equipeKey as string, tarefas: e._count._all }))
      .sort((a, b) => b.tarefas - a.tarefas),
  }
}

/**
 * O MARCO GERENCIAL de um processo — a transição de fase mais recente, com o
 * contexto que o Administrador precisa para não abrir mais nada: quantas
 * obrigações da fase que terminou foram cumpridas, quem as executava, e quem
 * (se alguém) já é responsável pela fase nova.
 *
 * Fonte única: `PhaseAdvanceLog` (o mesmo log que decide se um avanço
 * aconteceu — nunca `WorkflowEvento` recontado, nunca contagem de tarefa
 * inferindo conclusão). "Concluídas/total" e "responsável" são CONTAGENS
 * ABSOLUTAS da fase (não recortadas pelo filtro da tela): o marco descreve um
 * fato que já aconteceu, e não muda porque o Administrador aplicou um filtro.
 */
export interface MarcoGerencial {
  processoId: number
  resultado: AdvanceResultado
  faseAnteriorKey: string
  faseAnteriorLabel: string
  faseNovaKey: string | null
  faseNovaLabel: string | null
  em: string
  concluidasNaFaseAnterior: number
  totalNaFaseAnterior: number
  /** `null` = ninguém executava (fase sem tarefa atribuída ainda). `'VARIOS'` = mais de um dono distinto. */
  responsavelAnterior: { id: number; nome: string } | 'VARIOS' | null
  /**
   * Quem já responde pela fase nova. `null` quando a fase nova tem tarefa
   * ATIVA mas nenhuma ainda tem responsável — é o "AGUARDANDO ATRIBUIÇÃO" que
   * o Administrador precisa ver sem abrir o processo (spec §16): o motor NÃO
   * atribui automaticamente quem termina uma fase à fase seguinte.
   */
  responsavelNovo: { id: number; nome: string } | 'VARIOS' | null
  /** A fase nova já tem QUALQUER tarefa materializada? `false` = ainda não deu para saber quem assume. */
  faseNovaMaterializada: boolean
}

/** Quem executa (distinto, não-nulo) as tarefas ATIVAS+CONCLUÍDAS de uma `(processo, fase)` — em lote, nunca um groupBy por linha. */
async function responsavelDaFase(
  pares: Array<{ processoId: number; faseMacroKey: string }>, db: Leitor,
): Promise<Map<string, { id: number; nome: string } | 'VARIOS' | null>> {
  const mapa = new Map<string, { id: number; nome: string } | 'VARIOS' | null>()
  if (pares.length === 0) return mapa
  const linhas = await db.tarefa.findMany({
    where: {
      OR: pares.map((p) => ({ processoId: p.processoId, faseMacroKey: p.faseMacroKey })),
      statusTarefa: { in: STATUS_NO_QUADRO },
      responsavelId: { not: null },
    },
    select: { processoId: true, faseMacroKey: true, responsavelId: true, responsavel: { select: { nome: true } } },
  })
  const porPar = new Map<string, Map<number, string>>()
  for (const l of linhas) {
    const chave = `${l.processoId}::${l.faseMacroKey}`
    let m = porPar.get(chave)
    if (!m) { m = new Map(); porPar.set(chave, m) }
    if (l.responsavelId != null) m.set(l.responsavelId, l.responsavel?.nome ?? `#${l.responsavelId}`)
  }
  for (const p of pares) {
    const chave = `${p.processoId}::${p.faseMacroKey}`
    const m = porPar.get(chave)
    if (!m || m.size === 0) mapa.set(chave, null)
    else if (m.size === 1) { const [id, nome] = [...m.entries()][0]; mapa.set(chave, { id, nome }) }
    else mapa.set(chave, 'VARIOS')
  }
  return mapa
}

/**
 * A FASE ATUAL de cada processo tem tarefa ATIVA materializada, e quem já
 * responde por ela — uma consulta em lote, base do "AGUARDANDO ATRIBUIÇÃO"
 * (spec §16): só é `true` quando existe trabalho ativo real e ninguém o
 * possui, nunca por presunção de fase recém-chegada.
 */
async function statusDaFaseAtual(
  pares: Array<{ processoId: number; faseMacroKey: string }>, db: Leitor,
): Promise<Map<string, { temTarefaAtiva: boolean; responsavel: { id: number; nome: string } | 'VARIOS' | null }>> {
  const mapa = new Map<string, { temTarefaAtiva: boolean; responsavel: { id: number; nome: string } | 'VARIOS' | null }>()
  if (pares.length === 0) return mapa
  const linhas = await db.tarefa.findMany({
    where: { OR: pares.map((p) => ({ processoId: p.processoId, faseMacroKey: p.faseMacroKey })), statusTarefa: { in: STATUS_ATIVOS } },
    select: { processoId: true, faseMacroKey: true, responsavelId: true, responsavel: { select: { nome: true } } },
  })
  const porPar = new Map<string, Map<number, string>>()
  const temAtivaPorPar = new Set<string>()
  for (const l of linhas) {
    const chave = `${l.processoId}::${l.faseMacroKey}`
    temAtivaPorPar.add(chave)
    if (l.responsavelId != null) {
      let m = porPar.get(chave)
      if (!m) { m = new Map(); porPar.set(chave, m) }
      m.set(l.responsavelId, l.responsavel?.nome ?? `#${l.responsavelId}`)
    }
  }
  for (const p of pares) {
    const chave = `${p.processoId}::${p.faseMacroKey}`
    const m = porPar.get(chave)
    const responsavel = !m || m.size === 0 ? null : m.size === 1 ? (() => { const [id, nome] = [...m.entries()][0]; return { id, nome } })() : 'VARIOS' as const
    mapa.set(chave, { temTarefaAtiva: temAtivaPorPar.has(chave), responsavel })
  }
  return mapa
}

/**
 * O MARCO GERENCIAL mais recente de cada processo pedido — uma consulta em
 * lote (nunca uma por processo). `null` quando o processo nunca teve uma
 * transição de fase real.
 */
export async function marcosGerenciaisPorProcesso(
  processoIds: number[], db: Leitor = prisma,
): Promise<Map<number, MarcoGerencial>> {
  const mapa = new Map<number, MarcoGerencial>()
  if (processoIds.length === 0) return mapa

  // Um log por processo: o mais recente, entre resultados que são transição
  // REAL (nunca BLOQUEADO/CONFLITO/IDEMPOTENTE).
  const logs = await db.phaseAdvanceLog.findMany({
    where: { processoId: { in: processoIds }, resultado: { in: RESULTADOS_TRANSICAO_REAL } },
    orderBy: { criadoEm: 'desc' },
    select: { processoId: true, faseAtual: true, fasePretendida: true, resultado: true, criadoEm: true },
  })
  const maisRecentePorProcesso = new Map<number, (typeof logs)[number]>()
  for (const l of logs) if (!maisRecentePorProcesso.has(l.processoId)) maisRecentePorProcesso.set(l.processoId, l)
  if (maisRecentePorProcesso.size === 0) return mapa

  const entradas = [...maisRecentePorProcesso.values()]
  const paresAnterior = entradas.map((l) => ({ processoId: l.processoId, faseMacroKey: l.faseAtual }))
  const paresNova = entradas.filter((l) => l.fasePretendida).map((l) => ({ processoId: l.processoId, faseMacroKey: l.fasePretendida! }))

  // Contagens ABSOLUTAS da fase de origem — total e concluídas, direto da
  // Tarefa canônica, sem recorte de filtro de tela.
  const contagens = await db.tarefa.groupBy({
    by: ['processoId', 'faseMacroKey', 'statusTarefa'],
    where: { OR: paresAnterior.map((p) => ({ processoId: p.processoId, faseMacroKey: p.faseMacroKey })) },
    _count: { _all: true },
  })
  const contagemPorPar = new Map<string, { total: number; concluidas: number }>()
  for (const c of contagens) {
    if (!c.faseMacroKey) continue
    const chave = `${c.processoId}::${c.faseMacroKey}`
    const atual = contagemPorPar.get(chave) ?? { total: 0, concluidas: 0 }
    atual.total += c._count._all
    if ((STATUS_CONCLUIDOS as string[]).includes(c.statusTarefa)) atual.concluidas += c._count._all
    contagemPorPar.set(chave, atual)
  }

  const [responsaveisAnterior, responsaveisNova] = await Promise.all([
    responsavelDaFase(paresAnterior, db),
    responsavelDaFase(paresNova, db),
  ])
  // A fase nova já tem QUALQUER tarefa materializada (independente de responsável)?
  const materializacaoNova = paresNova.length > 0
    ? await db.tarefa.groupBy({ by: ['processoId', 'faseMacroKey'], where: { OR: paresNova } })
    : []
  const materializadaSet = new Set(materializacaoNova.map((m) => `${m.processoId}::${m.faseMacroKey}`))

  for (const l of entradas) {
    const chaveAnterior = `${l.processoId}::${l.faseAtual}`
    const chaveNova = l.fasePretendida ? `${l.processoId}::${l.fasePretendida}` : null
    const c = contagemPorPar.get(chaveAnterior) ?? { total: 0, concluidas: 0 }
    mapa.set(l.processoId, {
      processoId: l.processoId,
      resultado: l.resultado,
      faseAnteriorKey: l.faseAtual,
      faseAnteriorLabel: labelDaFasePorPhaseKey(l.faseAtual) ?? l.faseAtual,
      faseNovaKey: l.fasePretendida,
      faseNovaLabel: l.fasePretendida ? labelDaFasePorPhaseKey(l.fasePretendida) ?? l.fasePretendida : null,
      em: l.criadoEm.toISOString(),
      totalNaFaseAnterior: c.total,
      concluidasNaFaseAnterior: c.concluidas,
      responsavelAnterior: responsaveisAnterior.get(chaveAnterior) ?? null,
      responsavelNovo: chaveNova ? responsaveisNova.get(chaveNova) ?? null : null,
      faseNovaMaterializada: chaveNova ? materializadaSet.has(chaveNova) : false,
    })
  }
  return mapa
}

/** Contagens de um recorte (fase, processo ou família) — sempre os mesmos cinco números. */
export interface ContagensAgrupadas {
  total: number
  aFazer: number
  concluidas: number
  atrasadas: number
  venceEm7Dias: number
  semResponsavel: number
  bloqueadas: number
  aguardandoTerceiro: number
  /** Ver `executavelAgora` em `tarefa-canonica.ts` — não é `aFazer - bloqueadas - aguardandoTerceiro`. */
  executavelAgora: number
}

export interface FaseAgrupada extends ContagensAgrupadas {
  faseMacroKey: string
  label: string
  ordem: number
}

export interface ProcessoAgrupado extends ContagensAgrupadas {
  processoId: number
  nomeProcesso: string
  faseAtualKey: string | null
  fases: FaseAgrupada[]
  /**
   * Tarefas ATIVAS numa fase ANTERIOR à fase atual DESTE processo — o avanço
   * de fase não as conclui, e a Home hoje as ignora por design. Soma de
   * `fases[].aFazer` para toda fase com `ordem` menor que a da fase atual.
   */
  pendenciasFaseAnterior: number
  /** Derivado de `Processo.dataConclusao` — não existe enum de status do processo. */
  statusProcesso: 'ATIVO' | 'CONCLUIDO'
  /** A transição de fase mais recente deste processo — `null` se nunca avançou por este motor. */
  ultimoMarco: MarcoGerencial | null
  /**
   * A fase ATUAL já tem tarefa materializada sem NENHUM responsável — o
   * "AGUARDANDO ATRIBUIÇÃO" da spec §16. Nunca presumido: só `true` quando
   * existe tarefa ativa na fase atual e todas estão sem dono.
   */
  aguardandoAtribuicao: boolean
}

export interface FamiliaAgrupada extends ContagensAgrupadas {
  /** `null` quando o processo ainda não tem família (dado legado, pré-backfill). */
  familiaId: number | null
  nomeFamilia: string
  processos: ProcessoAgrupado[]
  /**
   * Quem tem mais tarefas ATIVAS (não concluídas) nesta família — informação,
   * não atribuição. Com processos de responsáveis diferentes ou sem nenhum
   * responsável ativo, fica `null` e a tela mostra "Vários"/"Sem responsável".
   */
  responsavelPrincipal: { id: number; nome: string } | null
  ultimaAtividade: string | null
  /** O prazo mais próximo entre as tarefas ATIVAS da família — `null` quando nenhuma tem prazo. */
  prazoMaisProximo: string | null
  /** Soma de `processos[].pendenciasFaseAnterior`. */
  pendenciasFaseAnterior: number
  /** O marco gerencial mais recente entre os processos da família — para priorizar na "última atividade". */
  ultimoMarco: MarcoGerencial | null
}

const zero = (): ContagensAgrupadas => ({
  total: 0, aFazer: 0, concluidas: 0, atrasadas: 0, venceEm7Dias: 0,
  semResponsavel: 0, bloqueadas: 0, aguardandoTerceiro: 0, executavelAgora: 0,
})
const somar = (a: ContagensAgrupadas, b: ContagensAgrupadas) => {
  a.total += b.total; a.aFazer += b.aFazer; a.concluidas += b.concluidas
  a.atrasadas += b.atrasadas; a.venceEm7Dias += b.venceEm7Dias
  a.semResponsavel += b.semResponsavel; a.bloqueadas += b.bloqueadas
  a.aguardandoTerceiro += b.aguardandoTerceiro; a.executavelAgora += b.executavelAgora
}

/**
 * A OPERAÇÃO AGRUPADA POR FAMÍLIA — para não rolar uma lista de centenas de
 * tarefas quando o que se quer é "como está a família Medina Olivares".
 *
 * Lê a MESMA Tarefa canônica (nada de tabela de resumo pré-calculada, que
 * ficaria velha), e o MESMO `whereGerencial` da Lista/Kanban/Central: o
 * conjunto de tarefas que entra nesta agregação é EXATAMENTE o que
 * `visaoGerencial` devolveria com o mesmo `filtro` — é isso que garante que a
 * contagem da família bate com o drill-down, sem duas implementações do
 * mesmo predicado divergindo.
 *
 * O volume atual da operação (centenas de tarefas, dezenas de processos) cabe
 * inteiro em memória de uma vez — agregar em SQL exigiria um groupBy por
 * processo×fase e outro por responsável, para um ganho que não existe nesta
 * escala.
 */
export async function agregacaoPorFamilia(
  agora = new Date(),
  filtro: FiltrosGerenciais = {},
): Promise<FamiliaAgrupada[]> {
  const em7Dias = inicioDoDiaOperacional(agora)
  em7Dias.setDate(em7Dias.getDate() + 7)
  const hojeInicio = inicioDoDiaOperacional(agora)

  const escopo = await mergeFiltrosAssincronos(filtro, whereGerencial(filtro, agora), agora, prisma)
  const registros = await prisma.tarefa.findMany({
    where: { AND: [{ processoId: { not: null } }, escopo] },
    select: {
      id: true, processoId: true, faseMacroKey: true, statusTarefa: true, dataPrazo: true,
      responsavelId: true, updatedAt: true, causaRemovidaEm: true,
      dependeDe: { select: { obrigatoria: true, dependeDe: { select: { statusTarefa: true } } } },
    },
  })
  if (registros.length === 0) return []

  const processoIds = [...new Set(registros.map((r) => r.processoId as number))]
  const [processos, responsaveis] = await Promise.all([
    prisma.processo.findMany({
      where: { id: { in: processoIds } },
      select: { id: true, nome: true, faseAtualKey: true, familiaId: true, familia: { select: { nome: true } }, dataConclusao: true },
    }),
    prisma.usuario.findMany({
      where: { id: { in: [...new Set(registros.map((r) => r.responsavelId).filter((id): id is number => id != null))] } },
      select: { id: true, nome: true },
    }),
  ])
  const processoDe = new Map(processos.map((p) => [p.id, p]))
  const nomeResponsavelDe = new Map(responsaveis.map((u) => [u.id, u.nome]))

  // MARCO GERENCIAL e "AGUARDANDO ATRIBUIÇÃO" — em lote, absolutos (não
  // recortados pelo filtro da tela), fonte `PhaseAdvanceLog`/`Tarefa` direto.
  const paresFaseAtual = processos
    .filter((p): p is typeof p & { faseAtualKey: string } => p.faseAtualKey != null)
    .map((p) => ({ processoId: p.id, faseMacroKey: p.faseAtualKey }))
  const [marcosPorProcesso, statusFaseAtualPorPar] = await Promise.all([
    marcosGerenciaisPorProcesso(processoIds),
    statusDaFaseAtual(paresFaseAtual, prisma),
  ])

  // processoId -> faseMacroKey -> contagens
  const porProcessoFase = new Map<number, Map<string, ContagensAgrupadas>>()
  // familiaId sintético (familiaId real, ou "p:<processoId>" sem família) -> responsavelId -> nº de tarefas ATIVAS
  const cargaPorFamilia = new Map<string, Map<number, number>>()
  // familiaId sintético -> última atividade
  const ultimaPorFamilia = new Map<string, Date>()
  // familiaId sintético -> prazo mais próximo entre as tarefas ainda ATIVAS (para ordenação "atenção")
  const prazoMaisProximoPorFamilia = new Map<string, Date>()

  for (const r of registros) {
    const processoId = r.processoId as number
    const p = processoDe.get(processoId)
    if (!p) continue // processo apagado/inacessível — não inventa família para ele
    const chaveFamilia = p.familiaId != null ? `f:${p.familiaId}` : `p:${processoId}`
    const fase = r.faseMacroKey ?? '—'

    let porFase = porProcessoFase.get(processoId)
    if (!porFase) { porFase = new Map(); porProcessoFase.set(processoId, porFase) }
    let c = porFase.get(fase)
    if (!c) { c = zero(); porFase.set(fase, c) }

    const concluida = (STATUS_CONCLUIDOS as string[]).includes(r.statusTarefa)
    const atrasada = !concluida && r.dataPrazo != null && r.dataPrazo < hojeInicio
    const venceEm7 = !concluida && r.dataPrazo != null && r.dataPrazo >= hojeInicio && r.dataPrazo <= em7Dias
    const aguardandoDependencia = r.dependeDe.some(
      (d) => d.obrigatoria && !STATUS_CONCLUIDOS.includes(d.dependeDe.statusTarefa),
    )
    const executavel = tarefaExecutavelAgora({
      statusTarefa: r.statusTarefa, aguardandoDependencia, causaRemovidaEm: r.causaRemovidaEm,
    })
    c.total += 1
    if (concluida) c.concluidas += 1
    else c.aFazer += 1
    if (atrasada) c.atrasadas += 1
    if (venceEm7) c.venceEm7Dias += 1
    if (!concluida && r.responsavelId == null) c.semResponsavel += 1
    if (r.statusTarefa === 'BLOQUEADA') c.bloqueadas += 1
    if (r.statusTarefa === 'AGUARDANDO_TERCEIRO' || r.statusTarefa === 'AGUARDANDO_CLIENTE') c.aguardandoTerceiro += 1
    if (executavel) c.executavelAgora += 1

    if (!concluida) {
      let carga = cargaPorFamilia.get(chaveFamilia)
      if (!carga) { carga = new Map(); cargaPorFamilia.set(chaveFamilia, carga) }
      if (r.responsavelId != null) carga.set(r.responsavelId, (carga.get(r.responsavelId) ?? 0) + 1)
    }
    const atual = ultimaPorFamilia.get(chaveFamilia)
    if (!atual || r.updatedAt > atual) ultimaPorFamilia.set(chaveFamilia, r.updatedAt)

    if (!concluida && r.dataPrazo != null) {
      const menor = prazoMaisProximoPorFamilia.get(chaveFamilia)
      if (!menor || r.dataPrazo < menor) prazoMaisProximoPorFamilia.set(chaveFamilia, r.dataPrazo)
    }
  }

  const familias = new Map<string, FamiliaAgrupada>()
  for (const [processoId, porFase] of porProcessoFase) {
    const p = processoDe.get(processoId)!
    const chaveFamilia = p.familiaId != null ? `f:${p.familiaId}` : `p:${processoId}`

    const fases: FaseAgrupada[] = [...porFase.entries()]
      .map(([faseMacroKey, contagens]) => {
        const code = phaseKeyToFaseCode(faseMacroKey)
        return {
          ...contagens,
          faseMacroKey,
          label: labelDaFasePorPhaseKey(faseMacroKey) ?? faseMacroKey,
          ordem: code ? getOrdemFase(code) : 999,
        }
      })
      .sort((a, b) => a.ordem - b.ordem)

    const totalProcesso = zero()
    for (const f of fases) somar(totalProcesso, f)

    // PENDÊNCIAS DE FASES ANTERIORES: soma do que falta fazer em toda fase
    // com `ordem` menor que a da fase ATUAL deste processo. Não é consulta
    // nova — é a MESMA repartição por fase que a família já mostra, só
    // recortada pela ordem canônica do catálogo.
    const faseAtualCode = phaseKeyToFaseCode(p.faseAtualKey)
    const ordemAtual = faseAtualCode ? getOrdemFase(faseAtualCode) : null
    const pendenciasFaseAnterior = ordemAtual != null
      ? fases.filter((f) => f.ordem < ordemAtual).reduce((n, f) => n + f.aFazer, 0)
      : 0

    const chaveFaseAtual = p.faseAtualKey != null ? `${processoId}::${p.faseAtualKey}` : null
    const statusFaseAtual = chaveFaseAtual ? statusFaseAtualPorPar.get(chaveFaseAtual) : undefined

    const processoAgrupado: ProcessoAgrupado = {
      ...totalProcesso, processoId, nomeProcesso: p.nome, faseAtualKey: p.faseAtualKey, fases,
      pendenciasFaseAnterior,
      statusProcesso: p.dataConclusao != null ? 'CONCLUIDO' : 'ATIVO',
      ultimoMarco: marcosPorProcesso.get(processoId) ?? null,
      // Só é "aguardando atribuição" quando existe trabalho ATIVO real na fase
      // atual e nenhuma dessas tarefas tem dono — nunca por a fase ser nova.
      aguardandoAtribuicao: !!statusFaseAtual?.temTarefaAtiva && statusFaseAtual.responsavel == null,
    }

    let familia = familias.get(chaveFamilia)
    if (!familia) {
      familia = {
        ...zero(),
        familiaId: p.familiaId,
        nomeFamilia: p.familia?.nome ?? p.nome,
        processos: [],
        responsavelPrincipal: null,
        ultimaAtividade: null,
        prazoMaisProximo: null,
        pendenciasFaseAnterior: 0,
        ultimoMarco: null,
      }
      familias.set(chaveFamilia, familia)
    }
    if (processoAgrupado.ultimoMarco && (!familia.ultimoMarco || processoAgrupado.ultimoMarco.em > familia.ultimoMarco.em)) {
      familia.ultimoMarco = processoAgrupado.ultimoMarco
    }
    familia.processos.push(processoAgrupado)
    somar(familia, totalProcesso)
    familia.pendenciasFaseAnterior += pendenciasFaseAnterior
  }

  for (const [chaveFamilia, familia] of familias) {
    const carga = cargaPorFamilia.get(chaveFamilia)
    if (carga && carga.size > 0) {
      const [responsavelId, maior] = [...carga.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
      // Só é "principal" se ninguém mais empata — empate é "vários", não um palpite.
      const empatados = [...carga.values()].filter((n) => n === maior).length
      if (empatados === 1) {
        familia.responsavelPrincipal = { id: responsavelId, nome: nomeResponsavelDe.get(responsavelId) ?? `#${responsavelId}` }
      }
    }
    const ultima = ultimaPorFamilia.get(chaveFamilia)
    // "ÚLTIMA ATIVIDADE" PRIORIZA O MARCO GERENCIAL quando ele é o fato mais
    // recente — "Genealogia concluída → Emissão Documental" conta mais do que
    // "Daniela concluiu tarefa" na mesma janela de tempo (spec §15). As nove
    // conclusões individuais continuam no Histórico de Atividades; aqui só o
    // fato mais recente aparece.
    const marcoEm = familia.ultimoMarco?.em ? new Date(familia.ultimoMarco.em) : null
    const maisRecente = marcoEm && (!ultima || marcoEm > ultima) ? marcoEm : ultima
    familia.ultimaAtividade = maisRecente ? maisRecente.toISOString() : null
    const menorPrazo = prazoMaisProximoPorFamilia.get(chaveFamilia)
    familia.prazoMaisProximo = menorPrazo ? menorPrazo.toISOString() : null
    familia.processos.sort((a, b) => a.nomeProcesso.localeCompare(b.nomeProcesso))
  }

  const porNome = (a: FamiliaAgrupada, b: FamiliaAgrupada) => a.nomeFamilia.localeCompare(b.nomeFamilia)
  // Ascendente com nulo por último (prazo: sem prazo não é "mais urgente").
  const tempoOuMaisInfinito = (iso: string | null) => (iso ? new Date(iso).getTime() : Infinity)
  // Descendente com nulo por último (última atividade: nunca ter mexido não é "mais recente").
  const tempoOuMenosInfinito = (iso: string | null) => (iso ? new Date(iso).getTime() : -Infinity)
  const ORDENADORES: Record<NonNullable<FiltrosGerenciais['ordenacaoFamilia']>, (a: FamiliaAgrupada, b: FamiliaAgrupada) => number> = {
    // "Atenção necessária": lexicográfico sobre contagens já visíveis na tela —
    // nunca uma fórmula ponderada que ninguém consegue explicar de cabeça.
    atencao: (a, b) =>
      b.atrasadas - a.atrasadas ||
      (b.bloqueadas + b.aguardandoTerceiro) - (a.bloqueadas + a.aguardandoTerceiro) ||
      b.executavelAgora - a.executavelAgora ||
      porNome(a, b),
    prazo: (a, b) => tempoOuMaisInfinito(a.prazoMaisProximo) - tempoOuMaisInfinito(b.prazoMaisProximo) || porNome(a, b),
    familia: porNome,
    ultimaAtividade: (a, b) => tempoOuMenosInfinito(b.ultimaAtividade) - tempoOuMenosInfinito(a.ultimaAtividade) || porNome(a, b),
  }
  return [...familias.values()].sort(ORDENADORES[filtro.ordenacaoFamilia ?? 'atencao'])
}
