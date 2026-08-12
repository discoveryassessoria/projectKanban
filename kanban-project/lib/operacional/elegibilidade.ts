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
// ─── A ORDEM DA ELEGIBILIDADE ───────────────────────────────────────────────
// Os critérios são avaliados nesta ordem, e cada um só RESTRINGE:
//
//   1. PERMISSÃO       `tarefas.iniciar_concluir` — sem isto, nada mais importa
//   2. DISPONIBILIDADE indisponibilidade vigente (férias, afastamento, bloqueio)
//   3. APTIDÃO         quando a UNIDADE DE TRABALHO da tarefa tem aptidão
//                      declarada por alguém
//   4. EQUIPE/ESCOPO   quando a tarefa exige uma equipe que EXISTE no cadastro
//   5. CAPACIDADE      quando há teto configurado e ele já está cheio
//   6. então, e só então, o score de carga decide entre os que sobraram
//
// Nenhum dos cinco concede elegibilidade a quem não tem permissão. A camada
// operacional (`lib/operacional/organizacao.ts`) restringe; autorização
// continua inteiramente em Perfil/permissoesCustom.
//
// ─── QUANDO UMA REGRA NÃO SE APLICA ─────────────────────────────────────────
// Aptidão e equipe são OPT-IN, e isso não é frouxidão: é o que impede uma
// tabela recém-criada de tornar toda a operação inelegível de um dia para o
// outro.
//
//   APTIDÃO só restringe a UNIDADE em que ALGUÉM já foi declarado apto. Enquanto
//   ninguém for, a unidade não tem regra — e não ter regra é diferente de
//   reprovar todo mundo. A política é POR UNIDADE: implantar uma não trava as
//   outras.
//
//   A unidade da tarefa é DERIVADA da cadeia canônica (necessidade/documento →
//   tipo → perfil operacional). Fase macro não entra nesta conta: ela diz onde o
//   processo está, não que trabalho é.
//
//   EQUIPE só restringe quando a tarefa nomeia um código que EXISTE como equipe
//   ativa no cadastro. Um `equipeKey` que não resolve não é uma regra: é um
//   dado sem contraparte, e aparece como observação no auditor.
//
// Mas quando a regra EXISTE e ninguém passa, o resultado é ABSTENÇÃO — nunca
// relaxar em silêncio para conseguir devolver um nome.
//
// ─── O QUE CONTINUA NÃO EXISTINDO ───────────────────────────────────────────
// Declarado em `CRITERIOS_AUSENTES` e devolvido em toda simulação. Depois desta
// camada, restam poucos: usuário ativo/inativo (`Usuario` não tem o campo) e
// escopo por processo/cliente. Nenhum foi inventado.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { StatusTarefa } from '@prisma/client'
import { STATUS_ATIVOS } from './tarefa-canonica'
import { calcularPermissoes, temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'
import {
  lerOrganizacao, unidadesComAptidaoDeclarada, unidadesDasTarefas, rotulosDasUnidades,
  type OrganizacaoDoUsuario, type UnidadeOperacional,
} from './organizacao'

/** Os tipos de indisponibilidade em português — a tela e o auditor leem isto. */
const ROTULO_INDISPONIBILIDADE: Record<string, string> = {
  FERIAS: 'férias',
  AFASTAMENTO: 'afastamento',
  AUSENCIA: 'ausência',
  BLOQUEIO_OPERACIONAL: 'bloqueio operacional',
}

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

export type CodigoInelegibilidade =
  | 'SEM_PERMISSAO_EXECUTAR'
  | 'INDISPONIVEL'
  | 'SEM_APTIDAO'
  | 'FORA_DA_EQUIPE_EXIGIDA'
  | 'CAPACIDADE_ESGOTADA'

/**
 * O QUE O SISTEMA NÃO SABE — devolvido em toda simulação.
 *
 * Um recomendador que se cala sobre o que ignora convida quem lê a supor que
 * ele considerou tudo.
 */
export const CRITERIOS_AUSENTES: Array<{ criterio: string; porque: string }> = [
  { criterio: 'usuário ativo/inativo', porque: 'o cadastro de Usuário não tem esse campo; desligar alguém da distribuição se faz com uma indisponibilidade de BLOQUEIO_OPERACIONAL' },
  { criterio: 'escopo por processo ou cliente', porque: 'não existe vínculo de atuação por processo ou cliente — nenhum foi inventado' },
]

/** O veredito de UM critério — é isto que o modo auditor imprime linha a linha. */
export interface Criterio {
  chave: 'PERMISSAO' | 'DISPONIBILIDADE' | 'APTIDAO' | 'EQUIPE' | 'CAPACIDADE'
  /** `nao_aplicavel` é diferente de `ok`: a regra não existe para esta tarefa. */
  veredito: 'ok' | 'reprovado' | 'nao_aplicavel'
  detalhe: string
}

export interface Avaliacao {
  usuarioId: number
  nome: string
  elegivel: boolean
  motivos: Array<{ codigo: CodigoInelegibilidade; texto: string }>
  /** Os cinco critérios, sempre todos — inclusive os que não se aplicam. */
  criterios: Criterio[]
  carga: Carga
  score: number
  parcelas: ParcelaDoScore[]
  /** Organização da pessoa, para a tela: equipes, aptidões, teto. */
  equipes: string[]
  aptidoes: string[]
  limiteExecutaveis: number | null
}

export type CodigoAbstencao =
  | 'JA_TEM_RESPONSAVEL'
  | 'TAREFA_ENCERRADA'
  | 'NENHUM_ELEGIVEL'
  | 'NENHUM_DISPONIVEL_E_APTO'
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
  /** A unidade de trabalho que a tarefa exige — o que a aptidão compara. */
  unidadeOperacional: { id: number; nome: string; familia: string | null } | null
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
  /** Aptidão, disponibilidade e capacidade de cada pessoa. */
  organizacao: Map<number, OrganizacaoDoUsuario>
  /** As unidades em que ALGUÉM já foi declarado apto — é o que liga a regra. */
  unidadesComAptidao: Set<number>
  /** Nome e família de cada unidade, para a explicação. */
  rotulos: Map<number, UnidadeOperacional>
}

/**
 * TUDO DE UMA VEZ — usuários, permissões, cargas e equipes.
 *
 * Sem isto, simular 50 tarefas contra 8 usuários faria 400 consultas de carga.
 * São cinco consultas, independentemente do tamanho do lote.
 */
async function lerUniverso(agora: Date): Promise<Universo> {
  const [brutos, ativas, grupos, organizacao, unidadesComAptidao, rotulos] = await Promise.all([
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
    lerOrganizacao(agora),
    unidadesComAptidaoDeclarada(),
    rotulosDasUnidades(),
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

  return { usuarios, cargas, equipes, equipesCadastradas, organizacao, unidadesComAptidao, rotulos }
}

// ─── A AVALIAÇÃO DE UMA TAREFA ──────────────────────────────────────────────

interface TarefaParaSimular {
  id: number
  titulo: string
  responsavelId: number | null
  statusTarefa: StatusTarefa
  equipeKey: string | null
  /** Só para contexto/ordenação — NUNCA para aptidão. */
  faseMacroKey: string | null
  /** A unidade de trabalho, derivada da cadeia canônica. */
  unidadeOperacionalId: number | null
  prioridade: string
  dataPrazo: Date | null
  /** Do passo corrente: o workflow publicado pode exigir uma equipe. */
  papelDoPasso: string | null
  equipeDoPasso: string | null
}

const SELECT_SIMULACAO = {
  id: true, titulo: true, responsavelId: true, statusTarefa: true, equipeKey: true,
  faseMacroKey: true, prioridade: true, dataPrazo: true,
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
    unidadeOperacional: null as Recomendacao['unidadeOperacional'],
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

  // ─── AS DUAS REGRAS OPT-IN: quando elas EXISTEM para esta tarefa? ─────────
  //
  // EQUIPE só é regra se o código nomeado pela tarefa existir como equipe ativa.
  // Um `equipeKey` sem contraparte no cadastro não é restrição — é um dado sem
  // dono, e tratá-lo como veto tornaria a tarefa impossível de distribuir por
  // causa de um cadastro que ninguém fez.
  const exigida = equipeExigida(t)
  const equipeEhRegra = exigida != null && u.equipesCadastradas.has(exigida)
  const membrosDaEquipe = equipeEhRegra ? u.equipes.get(exigida!) ?? new Set<number>() : null
  const equipe: ContextoDaEquipe | null = exigida
    ? {
        exigidaPelaTarefa: exigida,
        cadastrada: equipeEhRegra,
        membros: membrosDaEquipe ? [...membrosDaEquipe].sort((a, b) => a - b) : [],
        nota: equipeEhRegra
          ? `A tarefa é da equipe "${exigida}", que existe no cadastro: só membros dela entram. Pertencer à equipe NÃO concede permissão — apenas restringe quem já tem.`
          : `A tarefa nomeia a equipe "${exigida}", que não existe como equipe ativa no cadastro. Por isso ela não restringe ninguém aqui: ` +
            `um código sem contraparte não é uma regra. Para que passe a valer, cadastre-a em Gerenciamento › Usuários e Acessos › Equipes.`,
      }
    : null

  // APTIDÃO só é regra na UNIDADE em que alguém já foi declarado apto.
  const unidade = t.unidadeOperacionalId
  const unidadeNome = unidade != null ? u.rotulos.get(unidade)?.nome ?? `unidade #${unidade}` : null
  const aptidaoEhRegra = unidade != null && u.unidadesComAptidao.has(unidade)
  const unidadeOperacional = unidade != null
    ? { id: unidade, nome: unidadeNome!, familia: u.rotulos.get(unidade)?.familia ?? null }
    : null

  const avaliacoes: Avaliacao[] = u.usuarios.map((usr) => {
    const org = u.organizacao.get(usr.id)
    const carga = cargasVirtuais.get(usr.id) ?? { ...CARGA_ZERO }
    const motivos: Avaliacao['motivos'] = []
    const criterios: Criterio[] = []

    // 1 · PERMISSÃO — a única que concede alguma coisa; as demais só tiram.
    const podeExecutar = temPermissao(usr.permissoes, PERMISSAO_EXECUTAR)
    criterios.push({
      chave: 'PERMISSAO',
      veredito: podeExecutar ? 'ok' : 'reprovado',
      detalhe: podeExecutar ? 'tem permissão de executar tarefa' : 'não tem `tarefas.iniciar_concluir`',
    })
    if (!podeExecutar) {
      motivos.push({
        codigo: 'SEM_PERMISSAO_EXECUTAR',
        texto: 'Não tem permissão de executar tarefa — receberia trabalho que não conseguiria mover.',
      })
    }

    // 2 · DISPONIBILIDADE
    const ind = org?.indisponivelPor ?? null
    criterios.push({
      chave: 'DISPONIBILIDADE',
      veredito: ind ? 'reprovado' : 'ok',
      detalhe: ind
        ? `${ROTULO_INDISPONIBILIDADE[ind.tipo] ?? ind.tipo}${ind.motivo ? ` — ${ind.motivo}` : ''}` +
          `${ind.fim ? ` (até ${ind.fim.slice(0, 10)})` : ' (sem data de retorno)'}`
        : 'sem indisponibilidade vigente',
    })
    if (ind) {
      motivos.push({
        codigo: 'INDISPONIVEL',
        texto: `Indisponível: ${ROTULO_INDISPONIBILIDADE[ind.tipo] ?? ind.tipo}` +
          `${ind.motivo ? ` (${ind.motivo})` : ''}${ind.fim ? ` até ${ind.fim.slice(0, 10)}` : ', sem data de retorno'}.`,
      })
    }

    // 3 · APTIDÃO — só quando a UNIDADE DE TRABALHO tem aptidão declarada.
    const apto = unidade != null && (org?.aptidoes ?? []).includes(unidade)
    criterios.push({
      chave: 'APTIDAO',
      veredito: !aptidaoEhRegra ? 'nao_aplicavel' : apto ? 'ok' : 'reprovado',
      detalhe: !aptidaoEhRegra
        ? unidade == null
          ? 'a tarefa não tem unidade de trabalho definida no cadastro'
          : `ninguém foi declarado apto para "${unidadeNome}" — a unidade ainda não tem regra de aptidão`
        : apto ? `apto para "${unidadeNome}"` : `não é apto para "${unidadeNome}"`,
    })
    if (aptidaoEhRegra && !apto) {
      motivos.push({ codigo: 'SEM_APTIDAO', texto: `Não está declarado apto para "${unidadeNome}".` })
    }

    // 4 · EQUIPE / ESCOPO — só quando a tarefa exige uma equipe que existe.
    const naEquipe = membrosDaEquipe?.has(usr.id) ?? false
    criterios.push({
      chave: 'EQUIPE',
      veredito: !equipeEhRegra ? 'nao_aplicavel' : naEquipe ? 'ok' : 'reprovado',
      detalhe: !equipeEhRegra
        ? exigida ? `a tarefa nomeia "${exigida}", que não existe como equipe ativa` : 'a tarefa não exige equipe'
        : naEquipe ? `é membro de "${exigida}"` : `não é membro de "${exigida}"`,
    })
    if (equipeEhRegra && !naEquipe) {
      motivos.push({ codigo: 'FORA_DA_EQUIPE_EXIGIDA', texto: `Não é membro da equipe "${exigida}", exigida por esta tarefa.` })
    }

    // 5 · CAPACIDADE — só quando há teto configurado.
    const limite = org?.limiteExecutaveis ?? null
    const cheio = limite != null && carga.executaveis >= limite
    criterios.push({
      chave: 'CAPACIDADE',
      veredito: limite == null ? 'nao_aplicavel' : cheio ? 'reprovado' : 'ok',
      detalhe: limite == null
        ? 'sem teto configurado — a comparação é relativa à carga real'
        : `${carga.executaveis} de ${limite} executáveis`,
    })
    if (cheio) {
      motivos.push({
        codigo: 'CAPACIDADE_ESGOTADA',
        texto: `Capacidade esgotada: ${carga.executaveis} de ${limite} executáveis configurados.`,
      })
    }

    const { score, parcelas } = pontuar(carga)
    return {
      usuarioId: usr.id, nome: usr.nome, elegivel: motivos.length === 0, motivos, criterios,
      carga, score, parcelas,
      equipes: (org?.equipes ?? []).map((e) => e.nome),
      aptidoes: (org?.aptidoesDetalhadas ?? []).map((a) => a.nome),
      limiteExecutaveis: limite,
    }
  })

  const elegiveis = avaliacoes.filter((a) => a.elegivel)
  if (elegiveis.length === 0) {
    // A ABSTENÇÃO PRECISA DIZER O QUE DERRUBOU TODO MUNDO.
    //
    // "Ninguém é elegível" manda o gestor caçar a causa em cinco telas. Aqui o
    // motivo é o critério que reprovou MAIS gente entre quem tinha permissão —
    // e, se ninguém tinha permissão, é a permissão mesmo.
    const comPermissao = avaliacoes.filter((a) => a.criterios.find((c) => c.chave === 'PERMISSAO')?.veredito === 'ok')
    const contar = (codigo: CodigoInelegibilidade) =>
      comPermissao.filter((a) => a.motivos.some((m) => m.codigo === codigo)).length
    const porAptidao = contar('SEM_APTIDAO')
    const porEquipe = contar('FORA_DA_EQUIPE_EXIGIDA')
    const porDisponibilidade = contar('INDISPONIVEL')
    const porCapacidade = contar('CAPACIDADE_ESGOTADA')

    let abstencao: { codigo: CodigoAbstencao; texto: string }
    if (comPermissao.length === 0) {
      abstencao = {
        codigo: 'NENHUM_ELEGIVEL',
        texto: 'Nenhum usuário tem permissão para executar esta tarefa. Conceda `tarefas.iniciar_concluir` a quem deve executá-la.',
      }
    } else {
      const partes: string[] = []
      if (porAptidao) partes.push(`${porAptidao} sem a aptidão exigida${unidadeNome ? ` ("${unidadeNome}")` : ''}`)
      if (porEquipe) partes.push(`${porEquipe} fora da equipe "${exigida}"`)
      if (porDisponibilidade) partes.push(`${porDisponibilidade} indisponível(is)`)
      if (porCapacidade) partes.push(`${porCapacidade} com a capacidade esgotada`)
      abstencao = {
        codigo: (porAptidao || porEquipe) ? 'NENHUM_DISPONIVEL_E_APTO' : 'NENHUM_ELEGIVEL',
        texto: `Nenhum funcionário disponível e apto para esta tarefa. Entre os ${comPermissao.length} com permissão: ${partes.join('; ')}. ` +
          `A regra não foi relaxada — se ela estiver errada, corrija o cadastro (aptidão, equipe, disponibilidade ou capacidade).`,
      }
    }
    return { ...base, abstencao, avaliacoes, equipe, unidadeOperacional }
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
    explicacao: explicar(escolhido, ordenados, tecnico, equipe, unidadeOperacional),
    avaliacoes,
    equipe,
    unidadeOperacional,
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
const SIMBOLO: Record<Criterio['veredito'], string> = { ok: '✓', reprovado: '✗', nao_aplicavel: '—' }
const NOME_DO_CRITERIO: Record<Criterio['chave'], string> = {
  PERMISSAO: 'Permissão', DISPONIBILIDADE: 'Disponibilidade', APTIDAO: 'Aptidão',
  EQUIPE: 'Equipe/escopo', CAPACIDADE: 'Capacidade',
}

function explicar(
  escolhido: Avaliacao, ordenados: Avaliacao[], tecnico: boolean,
  equipe: ContextoDaEquipe | null, unidade: Recomendacao['unidadeOperacional'],
): string[] {
  const c = escolhido.carga
  const linhas = [
    // A UNIDADE VEM PRIMEIRO: sem saber que trabalho é, o resto não se julga.
    unidade
      ? `Unidade operacional: ${unidade.nome}${unidade.familia ? ` · ${unidade.familia}` : ''}`
      : 'Unidade operacional: não definida no cadastro para esta tarefa',
    `Recomendação: ${escolhido.nome} — porque:`,
    // Os cinco critérios, na ordem em que foram avaliados. "—" é diferente de
    // "✓": a regra não se aplica a esta tarefa, e dizer isso evita que o gestor
    // suponha que ela foi verificada e passou.
    ...escolhido.criterios.map((k) => `${SIMBOLO[k.veredito]} ${NOME_DO_CRITERIO[k.chave]}: ${k.detalhe}`),
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
  // A unidade sai da cadeia canônica, em lote — a Tarefa não guarda cópia dela.
  const unidades = await unidadesDasTarefas(brutas.map((t) => t.id))
  return brutas.map((t) => ({
    id: t.id, titulo: t.titulo, responsavelId: t.responsavelId, statusTarefa: t.statusTarefa,
    equipeKey: t.equipeKey, faseMacroKey: t.faseMacroKey, prioridade: t.prioridade, dataPrazo: t.dataPrazo,
    unidadeOperacionalId: unidades.get(t.id) ?? null,
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
      equipe: null, unidadeOperacional: null, criteriosAusentes: CRITERIOS_AUSENTES,
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
