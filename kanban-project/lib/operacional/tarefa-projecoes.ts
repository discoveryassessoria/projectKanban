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
  inicioDoDiaOperacional,
  estadoTemporal,
} from '@/lib/operacional/tempo-operacional'
import type { Prisma, PrioridadeTarefa, StatusTarefa } from '@prisma/client'
import { STATUS_ATIVOS } from './tarefa-canonica'
import { resolveWorkflowStepEditor } from '@/src/lib/process-stage/step-editor-registry'

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
} satisfies Prisma.TarefaSelect

type Bruta = Prisma.TarefaGetPayload<{ select: typeof SELECT }>

function projetar(
  t: Bruta, agora: Date,
  nomes?: Map<number, string>,
  rotulosDePasso?: Map<number, string>,
): LinhaDeFila {
  const snap = t.workflowStepInstance?.snapshot as { label?: string } | null
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
    etapaAtual:
      snap?.label
      ?? (t.workflowStepInstance?.stepDefinitionId != null
        ? rotulosDePasso?.get(t.workflowStepInstance.stepDefinitionId) ?? null
        : null)
      ?? t.workflowStepInstance?.stepKey
      ?? null,
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
    aguardandoDependencia: t.dependeDe.some(
      (d) => d.obrigatoria && !['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'].includes(d.dependeDe.statusTarefa),
    ),
    requerDecisao: t.causaRemovidaEm != null,
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
async function rotulosDosPassos(linhas: Bruta[]): Promise<Map<number, string>> {
  const ids = [...new Set(
    linhas.map((l) => l.workflowStepInstance?.stepDefinitionId).filter((x): x is number => x != null),
  )]
  if (ids.length === 0) return new Map()
  const defs = await prisma.phaseInternalWorkflowStep.findMany({
    where: { id: { in: ids } }, select: { id: true, label: true },
  })
  return new Map(defs.map((d) => [d.id, d.label]))
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
export async function minhaFila(usuarioId: number, agora = new Date()): Promise<LinhaGerencial[]> {
  // UMA FONTE, DUAS TELAS.
  //
  // A Minha Fila lia uma projeção mais pobre que a da visão gerencial: sem
  // "vence hoje", sem há-quanto-tempo-espera, sem motivo do bloqueio. O
  // funcionário via menos do que o gestor sobre o próprio trabalho — e duas
  // projeções do mesmo fato acabam divergindo.
  //
  // Agora é a MESMA consulta, com o recorte de quem executa.
  const { linhas } = await visaoGerencial({ responsavelId: usuarioId, porPagina: 500 }, agora)
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
        select: { id: true, numeroProtocolo: true, tipoProtocolo: true, createdAt: true, solicitacaoId: true },
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
      tipo: p.tipoProtocolo,
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
  /** Busca por tarefa, pessoa ou processo — uma caixa só, como se procura. */
  busca?: string | null
  /** Encerradas sem entrega (cancelada/supersedida) ficam fora por padrão. */
  incluirEncerradas?: boolean
  pagina?: number
  porPagina?: number
}

const STATUS_CONCLUIDOS: StatusTarefa[] = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI']
const STATUS_NO_QUADRO: StatusTarefa[] = [...STATUS_ATIVOS, ...STATUS_CONCLUIDOS]

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

  // Atrasada é condição derivada, mas se traduz exatamente em SQL: prazo no
  // passado e trabalho ainda por fazer.
  if (f.atrasadas) e.push({ dataPrazo: { lt: inicioDoDiaOperacional(agora) }, statusTarefa: { in: STATUS_ATIVOS } })
  if (f.venceHoje) {
    const { inicio, fim } = janelaDoDiaOperacional(agora)
    e.push({ dataPrazo: { gte: inicio, lte: fim } })
  }

  // A busca é uma caixa só porque é assim que se procura: o gestor lembra do
  // nome da pessoa OU do processo OU do que é a tarefa, não de qual campo.
  const q = f.busca?.trim()
  if (q) e.push({ OR: [{ titulo: { contains: q, mode: 'insensitive' } }, { processo: { nome: { contains: q, mode: 'insensitive' } } }] })

  if (e.length) where.AND = e
  return where
}

/** Desde quando cada tarefa espera / por que bloqueou — UMA consulta, em lote. */
async function contextoDeParada(ids: number[]): Promise<Map<number, { esperandoDesde?: Date; motivo?: string }>> {
  const mapa = new Map<number, { esperandoDesde?: Date; motivo?: string }>()
  if (ids.length === 0) return mapa
  // Ordem crescente e sobrescrita: o último registro de cada tarefa vence, que
  // é o que interessa — a espera ATUAL, não a primeira que já houve.
  const logs = await prisma.logAuditoria.findMany({
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
}

/**
 * OS INDICADORES SÃO CONTAGENS NO BANCO, não `linhas.filter(...)`.
 *
 * Contar em memória obrigaria a carregar a operação inteira para escrever seis
 * números no topo — e o número passaria a depender da página aberta, que é
 * pior do que não ter o número.
 */
export async function indicadoresGerenciais(f: FiltrosGerenciais = {}, agora = new Date()): Promise<IndicadoresGerenciais> {
  const base = { ...f, atrasadas: false, venceHoje: false, coluna: null, status: undefined }
  const w = (extra: Prisma.TarefaWhereInput) => ({ AND: [whereGerencial(base, agora), extra] })
  const janela = janelaDoDiaOperacional(agora)
  const [total, semResp, andamento, aguardando, bloqueadas, atrasadas, venceHoje, concluidas] = await Promise.all([
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
  ])
  return {
    total, semResponsavel: semResp, emAndamento: andamento, aguardandoTerceiro: aguardando,
    bloqueadas, atrasadas, venceHoje, concluidas,
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
): Promise<{ linhas: LinhaGerencial[]; total: number; pagina: number; porPagina: number }> {
  const porPagina = Math.min(Math.max(f.porPagina ?? 200, 1), 500)
  const pagina = Math.max(f.pagina ?? 1, 1)
  const where = whereGerencial(f, agora)

  const [total, brutas] = await Promise.all([
    prisma.tarefa.count({ where }),
    prisma.tarefa.findMany({
      where,
      select: SELECT_GERENCIAL,
      orderBy: [{ dataPrazo: { sort: 'asc', nulls: 'last' } }, { prioridade: 'desc' }, { id: 'asc' }],
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ])

  const [nomes, rotulos] = await Promise.all([nomesDasPessoas(brutas), rotulosDosPassos(brutas)])
  const paradas = await contextoDeParada(
    brutas.filter((t) => t.statusTarefa === 'BLOQUEADA' || t.statusTarefa === 'AGUARDANDO_TERCEIRO').map((t) => t.id),
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
  const [porFase, porResponsavel, usuarios] = await Promise.all([
    prisma.tarefa.groupBy({ by: ['faseMacroKey'], where: ativas, _count: { _all: true } }),
    prisma.tarefa.groupBy({ by: ['responsavelId'], where: ativas, _count: { _all: true } }),
    prisma.usuario.findMany({ select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
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
  }
}
