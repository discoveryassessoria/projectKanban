// lib/operacional/elegibilidade.ts
// ============================================================================
// QUEM PODE RECEBER ESTA TAREFA — e por quê.
//
// Este módulo NÃO distribui. Ele responde quatro perguntas e some:
//
//   1. quais funcionários são ELEGÍVEIS para esta tarefa?
//   2. qual é o mais adequado?
//   3. por quê?
//   4. quando o sistema deve se ABSTER?
//
// A quarta é a mais importante. Um distribuidor automático que sempre devolve
// um nome é pior do que nenhum: ele transforma "eu não sei" em "confie em
// mim". Aqui, não saber é uma resposta de primeira classe, com motivo.
//
// ─── NADA AQUI ESCREVE ──────────────────────────────────────────────────────
// Sem `update`, sem `create`, sem notificação. Quem atribui continua sendo o
// gestor, pela porta `atribuirTarefa`. Isto é uma LEITURA que opina.
//
// ─── O QUE É REGRA E O QUE É POLÍTICA ───────────────────────────────────────
// ELEGIBILIDADE é regra do sistema: ou a pessoa pode executar a tarefa, ou não
// pode. Não tem peso, não tem ajuste, não admite "quase".
//
// SCORE é POLÍTICA: os pesos abaixo são uma escolha explícita sobre o que
// cansa mais uma pessoa. Eles vivem numa tabela só, com o motivo escrito ao
// lado, justamente para que discordar deles seja editar um número — e não
// caçar uma heurística escondida no meio de um `sort`.
//
// ─── UMA REGRA SÓ, PORQUE SÓ UMA EXISTE ─────────────────────────────────────
// A elegibilidade tem UM critério neste sistema: PERMISSÃO DE EXECUTAR
// (`tarefas.iniciar_concluir`). Não é minimalismo — é o que há.
//
// EQUIPE (`Tarefa.equipeKey`, `GrupoUsuario`) existe como dado e NÃO restringe:
// o próprio cadastro de Equipes declara "Grupo NÃO concede permissão —
// autorização continua em Perfis e Permissões", e nenhum ponto do sistema
// valida o responsável contra a equipe da tarefa. Transformar equipe em filtro
// aqui seria criar uma regra de autorização nova, escondida dentro de um
// recomendador. Ela entra como CONTEXTO — o gestor vê que a tarefa nomeia uma
// equipe e quem pertence a ela —, nunca como veto.
//
// Os critérios abaixo são pedidos com frequência e NÃO EXISTEM no modelo. São
// declarados em `CRITERIOS_AUSENTES` e devolvidos em toda simulação, para que
// a ausência seja visível em vez de silenciosa:
//
//   • usuário ativo/inativo   — `Usuario` não tem esse campo
//   • férias / afastamento    — não existe entidade de ausência
//   • capacidade cadastrada   — não existe limite por usuário (§12)
//   • especialidade           — não existe cadastro de habilidade
//   • escopo por processo/cliente — não existe vínculo de atuação
//
// Inventar qualquer um deles no código seria a pior saída possível: uma regra
// de negócio que ninguém decidiu, aplicada como se tivesse sido.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { StatusTarefa } from '@prisma/client'
import { STATUS_ATIVOS } from './tarefa-canonica'
import { calcularPermissoes, temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'

/** A permissão sem a qual a tarefa nasce travada na fila de quem a recebeu. */
const PERMISSAO_EXECUTAR = 'tarefas.iniciar_concluir'

// ─── CARGA ──────────────────────────────────────────────────────────────────

export interface Carga {
  /** Tudo que ainda é trabalho: a soma dos estados ativos. */
  ativas: number
  /**
   * O que depende DESTA PESSOA agora — é este o número que compete pelo tempo
   * dela. Tarefa esperando cartório não ocupa a execução de ninguém.
   */
  executaveis: number
  emAndamento: number
  naoIniciadas: number
  aguardandoTerceiro: number
  bloqueadas: number
  atrasadas: number
  urgentes: number
  /** Quando esta pessoa recebeu trabalho pela última vez (desempate §6.4). */
  ultimaAtribuicaoEm: Date | null
}

const CARGA_ZERO: Carga = {
  ativas: 0, executaveis: 0, emAndamento: 0, naoIniciadas: 0,
  aguardandoTerceiro: 0, bloqueadas: 0, atrasadas: 0, urgentes: 0,
  ultimaAtribuicaoEm: null,
}

/**
 * OS PESOS — política operacional, explícita e num lugar só.
 *
 * Contagem bruta mente. Três tarefas atrasadas e urgentes pesam mais do que
 * cinco tarefas, quatro delas esperando cartório. Cada peso abaixo responde a
 * "quanto isto consome de quem carrega":
 */
export const PESOS = {
  /** Trabalho que depende desta pessoa agora. É a unidade de medida. */
  executavel: 1,
  /** Já devendo. Mandar mais para quem está atrasado atrasa duas coisas. */
  atrasada: 2,
  /** Urgente consome atenção desproporcional ao seu número. */
  urgente: 1.5,
  /** Espera externa ocupa a atenção (cobrar, acompanhar), não a execução. */
  aguardandoTerceiro: 0.25,
  /** Bloqueada idem: alguém precisa destravar, mas não é execução. */
  bloqueada: 0.25,
} as const

export interface ParcelaDoScore {
  componente: keyof typeof PESOS
  quantidade: number
  peso: number
  subtotal: number
  /** Em português, para o modo auditor. */
  explicacao: string
}

/** O custo operacional de uma pessoa — MENOR é melhor candidato. */
export function pontuar(c: Carga): { score: number; parcelas: ParcelaDoScore[] } {
  const parcelas: ParcelaDoScore[] = [
    { componente: 'executavel', quantidade: c.executaveis, peso: PESOS.executavel,
      subtotal: c.executaveis * PESOS.executavel,
      explicacao: `${c.executaveis} tarefa(s) que dependem desta pessoa agora` },
    { componente: 'atrasada', quantidade: c.atrasadas, peso: PESOS.atrasada,
      subtotal: c.atrasadas * PESOS.atrasada,
      explicacao: `${c.atrasadas} atrasada(s) — quem já está devendo pesa em dobro` },
    { componente: 'urgente', quantidade: c.urgentes, peso: PESOS.urgente,
      subtotal: c.urgentes * PESOS.urgente,
      explicacao: `${c.urgentes} urgente(s)` },
    { componente: 'aguardandoTerceiro', quantidade: c.aguardandoTerceiro, peso: PESOS.aguardandoTerceiro,
      subtotal: c.aguardandoTerceiro * PESOS.aguardandoTerceiro,
      explicacao: `${c.aguardandoTerceiro} aguardando terceiro — ocupa a atenção, não a execução` },
    { componente: 'bloqueada', quantidade: c.bloqueadas, peso: PESOS.bloqueada,
      subtotal: c.bloqueadas * PESOS.bloqueada,
      explicacao: `${c.bloqueadas} bloqueada(s)` },
  ]
  // Duas casas: o score é comparado, e ponto flutuante compara mal.
  const score = Math.round(parcelas.reduce((s, p) => s + p.subtotal, 0) * 100) / 100
  return { score, parcelas }
}

// ─── ELEGIBILIDADE ──────────────────────────────────────────────────────────

export type CodigoInelegibilidade = 'SEM_PERMISSAO_EXECUTAR'

/**
 * O QUE O SISTEMA NÃO SABE — devolvido em toda simulação.
 *
 * Um recomendador que se cala sobre o que ignora convida quem lê a supor que
 * ele considerou tudo.
 */
export const CRITERIOS_AUSENTES: Array<{ criterio: string; porque: string }> = [
  { criterio: 'usuário ativo/inativo', porque: 'o cadastro de Usuário não tem esse campo — todo usuário cadastrado é considerado disponível' },
  { criterio: 'férias e afastamentos', porque: 'não existe entidade de ausência no sistema' },
  { criterio: 'capacidade máxima por pessoa', porque: 'não existe cadastro de capacidade; a recomendação é RELATIVA à carga real de cada um' },
  { criterio: 'especialidade / habilidade', porque: 'não existe cadastro de especialidade — nenhuma foi inventada' },
  { criterio: 'escopo por processo ou cliente', porque: 'não existe vínculo de atuação por processo ou cliente' },
  { criterio: 'equipe como restrição', porque: 'equipe existe como dado, mas o cadastro declara que grupo NÃO concede permissão — entra como contexto, não como veto' },
]

export interface Avaliacao {
  usuarioId: number
  nome: string
  elegivel: boolean
  motivos: Array<{ codigo: CodigoInelegibilidade; texto: string }>
  carga: Carga
  score: number
  parcelas: ParcelaDoScore[]
}

export type CodigoAbstencao =
  | 'JA_TEM_RESPONSAVEL'
  | 'TAREFA_ENCERRADA'
  | 'NENHUM_ELEGIVEL'
  | 'TAREFA_INEXISTENTE'

/** O que a tarefa diz sobre equipe — informação para o gestor, não filtro. */
export interface ContextoDaEquipe {
  exigidaPelaTarefa: string | null
  cadastrada: boolean
  membros: number[]
  nota: string
}

export interface Recomendacao {
  taskId: number
  titulo: string
  /** Nulo é uma resposta legítima — e sempre vem com `abstencao`. */
  recomendado: { usuarioId: number; nome: string; score: number } | null
  abstencao: { codigo: CodigoAbstencao; texto: string } | null
  /** Em português, para o gestor ler antes de confirmar. */
  explicacao: string[]
  /** Se a decisão só se resolveu no desempate técnico, o gestor precisa saber. */
  decididoNoDesempateTecnico: boolean
  avaliacoes: Avaliacao[]
  equipe: ContextoDaEquipe | null
  criteriosAusentes: typeof CRITERIOS_AUSENTES
}

// ─── LEITURA EM LOTE ────────────────────────────────────────────────────────

interface Universo {
  usuarios: Array<{ id: number; nome: string; permissoes: MapaPermissoes }>
  cargas: Map<number, Carga>
  /** code da equipe (minúsculo) → ids dos membros. Só grupos ATIVOS. */
  equipes: Map<string, Set<number>>
  /** Todos os codes cadastrados, para distinguir "não é membro" de "não existe". */
  equipesCadastradas: Set<string>
}

/**
 * TUDO DE UMA VEZ — usuários, permissões, cargas e equipes.
 *
 * Sem isto, simular 50 tarefas contra 8 usuários faria 400 consultas de carga.
 * São cinco consultas, independentemente do tamanho do lote.
 */
async function lerUniverso(agora: Date): Promise<Universo> {
  const [brutos, ativas, grupos] = await Promise.all([
    prisma.usuario.findMany({
      select: { id: true, nome: true, tipo: true, permissoesCustom: true, perfil: { select: { permissoes: true } } },
      orderBy: { id: 'asc' },
    }),
    prisma.tarefa.findMany({
      where: { statusTarefa: { in: STATUS_ATIVOS }, responsavelId: { not: null } },
      select: { responsavelId: true, statusTarefa: true, prioridade: true, dataPrazo: true, dataAtribuicao: true },
    }),
    prisma.grupoUsuario.findMany({
      where: { ativo: true },
      select: { code: true, membros: { select: { usuarioId: true } } },
    }),
  ])

  const usuarios = brutos.map((u) => ({
    id: u.id,
    nome: u.nome,
    permissoes: calcularPermissoes(
      u.tipo,
      u.perfil?.permissoes as MapaPermissoes | null,
      u.permissoesCustom as MapaPermissoes | null,
    ),
  }))

  const cargas = new Map<number, Carga>()
  for (const u of usuarios) cargas.set(u.id, { ...CARGA_ZERO })
  // Mesma régua de atraso da operação: o DIA no fuso operacional, não o instante.
  const { inicioDoDiaOperacional } = await import('./tarefa-projecoes')
  const corteDoAtraso = inicioDoDiaOperacional(agora)
  for (const t of ativas) {
    const c = cargas.get(t.responsavelId!)
    if (!c) continue
    c.ativas++
    if (t.statusTarefa === 'AGUARDANDO_TERCEIRO' || t.statusTarefa === 'AGUARDANDO_CLIENTE') c.aguardandoTerceiro++
    else if (t.statusTarefa === 'BLOQUEADA') c.bloqueadas++
    else {
      c.executaveis++
      if (t.statusTarefa === 'EM_ANDAMENTO') c.emAndamento++
      else c.naoIniciadas++
    }
    if (t.dataPrazo != null && t.dataPrazo < corteDoAtraso) c.atrasadas++
    if (t.prioridade === 'URGENTE') c.urgentes++
    if (t.dataAtribuicao != null && (c.ultimaAtribuicaoEm == null || t.dataAtribuicao > c.ultimaAtribuicaoEm)) {
      c.ultimaAtribuicaoEm = t.dataAtribuicao
    }
  }

  const equipes = new Map<string, Set<number>>()
  const equipesCadastradas = new Set<string>()
  for (const g of grupos) {
    if (!g.code) continue
    const chave = g.code.trim().toLowerCase()
    equipesCadastradas.add(chave)
    equipes.set(chave, new Set(g.membros.map((m) => m.usuarioId)))
  }

  return { usuarios, cargas, equipes, equipesCadastradas }
}

// ─── A AVALIAÇÃO DE UMA TAREFA ──────────────────────────────────────────────

interface TarefaParaSimular {
  id: number
  titulo: string
  responsavelId: number | null
  statusTarefa: StatusTarefa
  equipeKey: string | null
  prioridade: string
  dataPrazo: Date | null
  /** Do passo corrente: o workflow publicado pode exigir uma equipe. */
  papelDoPasso: string | null
  equipeDoPasso: string | null
}

const SELECT_SIMULACAO = {
  id: true, titulo: true, responsavelId: true, statusTarefa: true, equipeKey: true,
  prioridade: true, dataPrazo: true,
  workflowStepInstance: { select: { papel: true, equipe: true } },
} as const

/**
 * A EQUIPE QUE A TAREFA EXIGE, se exigir alguma.
 *
 * Vem da tarefa (`equipeKey`) ou do passo publicado (`equipe`/`papel`) — nessa
 * ordem, porque a tarefa é a unidade de trabalho e o passo é o detalhe dela.
 */
function equipeExigida(t: TarefaParaSimular): string | null {
  const bruta = t.equipeKey ?? t.equipeDoPasso ?? t.papelDoPasso
  return bruta ? bruta.trim().toLowerCase() : null
}

/**
 * AVALIA UMA TAREFA contra o universo, com as cargas VIRTUAIS do lote.
 *
 * `cargasVirtuais` é o que torna o lote honesto: quando a simulação recomenda
 * Daniela para a tarefa 1, a carga dela sobe ANTES de a tarefa 2 ser avaliada.
 * Sem isso, dez tarefas iriam todas para quem começou com menos — que é o
 * defeito mais comum de um distribuidor ingênuo.
 */
function avaliar(
  t: TarefaParaSimular,
  u: Universo,
  cargasVirtuais: Map<number, Carga>,
): Recomendacao {
  const base = {
    taskId: t.id,
    titulo: t.titulo,
    recomendado: null,
    explicacao: [] as string[],
    decididoNoDesempateTecnico: false,
    avaliacoes: [] as Avaliacao[],
    equipe: null as ContextoDaEquipe | null,
    criteriosAusentes: CRITERIOS_AUSENTES,
  }

  // §11 — distribuição automática é só para quem não tem dono. Redistribuir é
  // outro problema, com outras consequências, e não se resolve por engano.
  if (t.responsavelId != null) {
    return { ...base, abstencao: { codigo: 'JA_TEM_RESPONSAVEL', texto: 'A tarefa já tem responsável. Redistribuir é outra decisão.' } }
  }
  if (!STATUS_ATIVOS.includes(t.statusTarefa)) {
    return { ...base, abstencao: { codigo: 'TAREFA_ENCERRADA', texto: `A tarefa está ${t.statusTarefa} — não há o que distribuir.` } }
  }

  // EQUIPE É CONTEXTO, NÃO VETO.
  //
  // A tarefa pode nomear uma equipe, e o gestor merece ver isso. Mas o cadastro
  // de Equipes declara que grupo NÃO concede permissão, e nenhum ponto do
  // sistema valida o responsável contra a equipe da tarefa. Usar equipe como
  // filtro aqui inventaria uma regra de autorização — e, pior, ela apareceria
  // como "ninguém é elegível" num sistema onde ninguém cadastrou equipe.
  const exigida = equipeExigida(t)
  const membrosDaEquipe = exigida ? u.equipes.get(exigida) ?? null : null
  const equipe: ContextoDaEquipe | null = exigida
    ? {
        exigidaPelaTarefa: exigida,
        cadastrada: u.equipesCadastradas.has(exigida),
        membros: membrosDaEquipe ? [...membrosDaEquipe].sort((a, b) => a - b) : [],
        nota: u.equipesCadastradas.has(exigida)
          ? `A tarefa é da equipe "${exigida}". Equipe organiza o trabalho e NÃO concede permissão — por isso não restringe a elegibilidade aqui.`
          : `A tarefa nomeia a equipe "${exigida}", que não está cadastrada. Isso NÃO impede a recomendação: equipe não concede permissão neste sistema. ` +
            `Se a intenção for restringir por equipe, cadastre-a em Gerenciamento › Usuários e Acessos › Equipes — e essa passa a ser uma decisão de produto, não do recomendador.`,
      }
    : null

  const avaliacoes: Avaliacao[] = u.usuarios.map((usr) => {
    const motivos: Avaliacao['motivos'] = []
    if (!temPermissao(usr.permissoes, PERMISSAO_EXECUTAR)) {
      motivos.push({
        codigo: 'SEM_PERMISSAO_EXECUTAR',
        texto: 'Não tem permissão de executar tarefa — receberia trabalho que não conseguiria mover.',
      })
    }
    const carga = cargasVirtuais.get(usr.id) ?? { ...CARGA_ZERO }
    const { score, parcelas } = pontuar(carga)
    return { usuarioId: usr.id, nome: usr.nome, elegivel: motivos.length === 0, motivos, carga, score, parcelas }
  })

  const elegiveis = avaliacoes.filter((a) => a.elegivel)
  if (elegiveis.length === 0) {
    return {
      ...base,
      abstencao: {
        codigo: 'NENHUM_ELEGIVEL',
        texto: 'Nenhum usuário tem permissão para executar esta tarefa. Conceda `tarefas.iniciar_concluir` a quem deve executá-la.',
      },
      avaliacoes,
      equipe,
    }
  }

  const ordenados = [...elegiveis].sort(comparar)
  const escolhido = ordenados[0]
  const segundo = ordenados[1]
  const tecnico = segundo != null && empateAteOId(escolhido, segundo)

  return {
    ...base,
    recomendado: { usuarioId: escolhido.usuarioId, nome: escolhido.nome, score: escolhido.score },
    abstencao: null,
    decididoNoDesempateTecnico: tecnico,
    explicacao: explicar(escolhido, ordenados, tecnico, equipe),
    avaliacoes,
    equipe,
  }
}

/**
 * O DESEMPATE — determinístico, nesta ordem, sem aleatoriedade.
 *
 *   1. menor custo operacional (o score)
 *   2. menos atrasadas
 *   3. menos tarefas executáveis
 *   4. quem está há mais tempo sem receber trabalho novo
 *   5. o id, e SÓ como último recurso técnico
 *
 * O quinto critério não é operacional: se a decisão chegar nele, os candidatos
 * eram equivalentes para todo efeito prático — e a recomendação diz isso, em
 * vez de fingir que houve um vencedor.
 */
function comparar(a: Avaliacao, b: Avaliacao): number {
  if (a.score !== b.score) return a.score - b.score
  if (a.carga.atrasadas !== b.carga.atrasadas) return a.carga.atrasadas - b.carga.atrasadas
  if (a.carga.executaveis !== b.carga.executaveis) return a.carga.executaveis - b.carga.executaveis
  const ta = a.carga.ultimaAtribuicaoEm?.getTime() ?? 0 // nunca recebeu → há mais tempo
  const tb = b.carga.ultimaAtribuicaoEm?.getTime() ?? 0
  if (ta !== tb) return ta - tb
  return a.usuarioId - b.usuarioId
}

/** Verdadeiro quando dois candidatos só se diferenciam pelo id. */
function empateAteOId(a: Avaliacao, b: Avaliacao): boolean {
  return a.score === b.score
    && a.carga.atrasadas === b.carga.atrasadas
    && a.carga.executaveis === b.carga.executaveis
    && (a.carga.ultimaAtribuicaoEm?.getTime() ?? 0) === (b.carga.ultimaAtribuicaoEm?.getTime() ?? 0)
}

/** A recomendação em português — é o que o gestor lê antes de confirmar. */
function explicar(escolhido: Avaliacao, ordenados: Avaliacao[], tecnico: boolean, equipe: ContextoDaEquipe | null): string[] {
  const c = escolhido.carga
  const linhas = [
    `Recomendação: ${escolhido.nome} — porque:`,
    '• tem permissão para executar esta tarefa',
    `• ${c.executaveis} tarefa(s) dependendo desta pessoa agora`,
    `• ${c.atrasadas} atrasada(s)`,
    `• ${c.urgentes} urgente(s)`,
    `• ${c.aguardandoTerceiro} aguardando terceiro (não ocupa a execução)`,
    `• custo operacional ${escolhido.score} — o menor entre ${ordenados.length} elegível(is)`,
  ]
  const perdedor = ordenados[1]
  if (perdedor) {
    linhas.push(
      tecnico
        ? `⚠ ${perdedor.nome} está exatamente empatado(a) no custo ${perdedor.score}. A escolha caiu no desempate técnico pelo id — para a operação, tanto faz.`
        : `Segunda melhor: ${perdedor.nome}, custo ${perdedor.score}.`,
    )
  }
  if (equipe) linhas.push(`ℹ ${equipe.nota}`)
  return linhas
}

// ─── AS DUAS ENTRADAS PÚBLICAS ──────────────────────────────────────────────

async function carregarTarefas(ids: number[]): Promise<TarefaParaSimular[]> {
  const brutas = await prisma.tarefa.findMany({ where: { id: { in: ids } }, select: SELECT_SIMULACAO })
  return brutas.map((t) => ({
    id: t.id, titulo: t.titulo, responsavelId: t.responsavelId, statusTarefa: t.statusTarefa,
    equipeKey: t.equipeKey, prioridade: t.prioridade, dataPrazo: t.dataPrazo,
    papelDoPasso: t.workflowStepInstance?.papel ?? null,
    equipeDoPasso: t.workflowStepInstance?.equipe ?? null,
  }))
}

/** SIMULAR UMA TAREFA. Não escreve nada. */
export async function simularTarefa(taskId: number, agora = new Date()): Promise<Recomendacao> {
  const [tarefas, universo] = await Promise.all([carregarTarefas([taskId]), lerUniverso(agora)])
  const t = tarefas[0]
  if (!t) {
    return {
      taskId, titulo: '', recomendado: null,
      abstencao: { codigo: 'TAREFA_INEXISTENTE', texto: 'Tarefa não encontrada.' },
      explicacao: [], decididoNoDesempateTecnico: false, avaliacoes: [],
      equipe: null, criteriosAusentes: CRITERIOS_AUSENTES,
    }
  }
  return avaliar(t, universo, universo.cargas)
}

/**
 * A ORDEM DO LOTE — o trabalho mais crítico consome a capacidade primeiro.
 *
 * Atrasadas, depois urgentes, depois prazo mais próximo, depois o resto. É a
 * mesma régua da fila operacional: se a capacidade disponível fosse consumida
 * pela ordem de criação, a tarefa que estourou ontem receberia quem sobrou.
 */
function ordemDoLote(a: TarefaParaSimular, b: TarefaParaSimular, corte: Date): number {
  const grau = (t: TarefaParaSimular) => {
    if (t.dataPrazo != null && t.dataPrazo < corte) return 0
    if (t.prioridade === 'URGENTE') return 1
    if (t.dataPrazo != null) return 2
    return 3
  }
  const g = grau(a) - grau(b)
  if (g !== 0) return g
  const pa = a.dataPrazo?.getTime() ?? Number.POSITIVE_INFINITY
  const pb = b.dataPrazo?.getTime() ?? Number.POSITIVE_INFINITY
  if (pa !== pb) return pa - pb
  return a.id - b.id
}

/**
 * SIMULAR O LOTE — todas as tarefas sem responsável, com carga VIRTUAL.
 *
 * A carga virtual é a diferença entre uma simulação útil e uma lista de dez
 * vezes o mesmo nome: cada recomendação incrementa a carga de quem foi
 * recomendado, em memória, antes da tarefa seguinte ser avaliada.
 *
 * Nada disso toca o banco. As cargas virtuais morrem com a função.
 */
export async function simularLote(
  opts: { taskIds?: number[]; limite?: number } = {},
  agora = new Date(),
): Promise<{ criteriosAusentes: typeof CRITERIOS_AUSENTES; recomendacoes: Recomendacao[]; resumo: { total: number; comRecomendacao: number; semRecomendacao: number; porUsuario: Array<{ usuarioId: number; nome: string; recebeu: number }> } }> {
  const universo = await lerUniverso(agora)
  const alvos = opts.taskIds?.length
    ? await carregarTarefas(opts.taskIds)
    : await carregarTarefas(
        (await prisma.tarefa.findMany({
          where: { responsavelId: null, statusTarefa: { in: STATUS_ATIVOS } },
          select: { id: true },
          take: Math.min(Math.max(opts.limite ?? 200, 1), 500),
        })).map((t) => t.id),
      )

  const { inicioDoDiaOperacional } = await import('./tarefa-projecoes')
  const corte = inicioDoDiaOperacional(agora)
  const fila = [...alvos].sort((a, b) => ordemDoLote(a, b, corte))

  // Cópia das cargas reais: é sobre ESTA cópia que o lote raciocina.
  const virtuais = new Map<number, Carga>()
  for (const [id, c] of universo.cargas) virtuais.set(id, { ...c })

  const recomendacoes: Recomendacao[] = []
  const recebeu = new Map<number, number>()
  for (const t of fila) {
    const r = avaliar(t, universo, virtuais)
    recomendacoes.push(r)
    if (r.recomendado) {
      const c = virtuais.get(r.recomendado.usuarioId)!
      // A tarefa recomendada entraria como NÃO INICIADA: soma em `executaveis`
      // e em `ativas`, e em `urgentes` se for urgente. Nada mais — supor que
      // ela já nasceria atrasada seria inventar.
      c.ativas++
      c.executaveis++
      c.naoIniciadas++
      if (t.prioridade === 'URGENTE') c.urgentes++
      if (t.dataPrazo != null && t.dataPrazo < corte) c.atrasadas++
      c.ultimaAtribuicaoEm = agora
      recebeu.set(r.recomendado.usuarioId, (recebeu.get(r.recomendado.usuarioId) ?? 0) + 1)
    }
  }

  return {
    criteriosAusentes: CRITERIOS_AUSENTES,
    recomendacoes,
    resumo: {
      total: recomendacoes.length,
      comRecomendacao: recomendacoes.filter((r) => r.recomendado).length,
      semRecomendacao: recomendacoes.filter((r) => !r.recomendado).length,
      porUsuario: [...recebeu.entries()]
        .map(([usuarioId, n]) => ({ usuarioId, nome: universo.usuarios.find((u) => u.id === usuarioId)?.nome ?? `#${usuarioId}`, recebeu: n }))
        .sort((a, b) => b.recebeu - a.recebeu || a.usuarioId - b.usuarioId),
    },
  }
}
