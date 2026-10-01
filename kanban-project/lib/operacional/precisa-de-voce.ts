// lib/operacional/precisa-de-voce.ts
// ============================================================================
// TORRE DE CONTROLE — BLOCO F: O MOTOR "PRECISA DE VOCÊ" (29/09/2026).
//
// UMA FONTE POR DADO (Regra 5 do mandato): tudo aqui lê `lerLinhasOperacionais`
// (a MESMA varredura que o sino do gestor já usa, `avisos-sino.ts`) e
// `conferirCoerenciaPassoTarefa` (o MESMO comparador que trava a transação de
// projeção passo→tarefa, `passo-tarefa-projecao.ts`). Nada é recalculado.
//
// SCORE — Decisões do Passo 0, item 4 (29/09/2026), que substitui o texto
// original do Bloco F para estes pesos:
//   sem dono +3 · vencida +4 · acompanhamento vencido +2 ·
//   2+ cobranças sem resposta +2 · fase deixada +3 · divergência +3 ·
//   bloqueada +2 · fase Apostilamento/Retificação +1 (baseline)
// Faixas: ≥6 crítico, ≥3 atenção, senão ok.
//
// GRANULARIDADE DO ITEM — como no protótipo: uma tarefa entra em NO MÁXIMO UM
// dos três tipos "primários" (Fase deixada > Divergência > Sem dono, nesta
// prioridade — mutuamente exclusivos), e PODE ADEMAIS entrar em Escalada e/ou
// Bloqueada (esses dois não competem com o primário: a mesma tarefa pode
// aparecer duas vezes na lista, uma por motivo). Carga e Parede à frente são
// agregados (por pessoa / por fase), não por tarefa.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { lerLinhasOperacionais } from './avisos-sino'
import { visaoGerencial, type LinhaGerencial } from './tarefa-projecoes'
import { semFaseFutura } from './fase-futura'
import { STATUS_ATIVOS } from './tarefa-canonica'
import { FUSO_OPERACIONAL, janelaDoDiaOperacionalDe, diaOperacional } from './tempo-operacional'
import { conferirCoerenciaPassoTarefa } from '@/src/services/passo-tarefa-projecao'
import { ordensDeFase } from '@/src/services/documento-operacao'
import { lerOrganizacao, unidadesDasTarefas, capacidadeMedidaPorUsuario, rotulosDasUnidades } from './organizacao'
import { equipeExigida } from './elegibilidade'
import { pessoasNoLimite } from './torre-equipe'
import { idsDeProcessosPausados, semProcessosPausados } from '@/src/services/processo-pausa'
import { calcularPermissoes, temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'
import { ONDE_PROCESSO_NAO_PAUSADO } from '@/src/services/processo-pausa'
import { entradaNaFase, RESULTADOS_QUE_MOVEM_DE_FASE } from './metricas-processo'
import { resolverMacroWorkflowDoProcesso } from '@/src/lib/motor/resolver-macro-workflow'
import { proximaFaseDoCaminho } from '@/src/lib/motor/phase-advance-helpers'
import { resolveWorkflowRuntime } from '@/src/lib/workflow-runtime'
import { labelDaFasePorPhaseKey, FASES } from '@/src/lib/process-stage/fases-catalog'
import {
  ROTULO_DO_TIPO, TIPOS_DO_PAINEL, ESCALAR_APOS_PADRAO, bloqueioPedeDecisao, certidoes, contagemPorTipo, diasDeCalendario,
  identidadeDaCertidao, planoDoSemDono, quantoMoverDaCarga, textosDaBloqueada, textosDaCarga, textosDaDivergencia, textosDaEscalada,
  textosDaFaseDeixada, textosDoSemDono, type PlanoDoSemDono, type SugestaoParaTexto, type TipoDoPainel,
} from './precisa-de-voce-decisoes'
import {
  urlDistribuicaoDoProcesso, urlOperacaoDaFamilia, urlVisaoGlobalDaFamilia,
} from './navegacao'

type Db = typeof prisma | Prisma.TransactionClient

// ─── SCORE ───────────────────────────────────────────────────────────────────

export interface FatoresDeRisco {
  semDono: boolean
  vencida: boolean
  acompanhamentoVencido: boolean
  cobrancasSemRespostaMuitas: boolean
  faseDeixada: boolean
  divergente: boolean
  bloqueada: boolean
  faseApostilamentoOuRetificacao: boolean
}

const PESOS_RISCO = {
  semDono: 3, vencida: 4, acompanhamentoVencido: 2, cobrancasSemRespostaMuitas: 2,
  faseDeixada: 3, divergente: 3, bloqueada: 2, faseApostilamentoOuRetificacao: 1,
} as const

export function scoreDeRisco(f: FatoresDeRisco): number {
  let s = 0
  if (f.semDono) s += PESOS_RISCO.semDono
  if (f.vencida) s += PESOS_RISCO.vencida
  if (f.acompanhamentoVencido) s += PESOS_RISCO.acompanhamentoVencido
  if (f.cobrancasSemRespostaMuitas) s += PESOS_RISCO.cobrancasSemRespostaMuitas
  if (f.faseDeixada) s += PESOS_RISCO.faseDeixada
  if (f.divergente) s += PESOS_RISCO.divergente
  if (f.bloqueada) s += PESOS_RISCO.bloqueada
  if (f.faseApostilamentoOuRetificacao) s += PESOS_RISCO.faseApostilamentoOuRetificacao
  return s
}

export type FaixaDeRisco = 'CRITICO' | 'ATENCAO' | 'OK'

export function faixaDoScore(score: number): FaixaDeRisco {
  if (score >= 6) return 'CRITICO'
  if (score >= 3) return 'ATENCAO'
  return 'OK'
}

/**
 * AS FASES DE APOSTILAMENTO/RETIFICAÇÃO — do CADASTRO, nunca uma phaseKey
 * fixa em outro lugar do código (Regra 8 do mandato). A correspondência com
 * "apostilamento"/"retificação" é textual (nome/chave do próprio catálogo,
 * lida agora) — se o cadastro renomear ou adicionar uma fase equivalente,
 * esta função já a vê, sem precisar de outra decisão de código.
 */
async function fasesApostilamentoOuRetificacao(db: Db): Promise<Set<string>> {
  const fases = await db.faseMacro.findMany({
    where: { OR: [{ phaseKey: { contains: 'apostil', mode: 'insensitive' } }, { phaseKey: { contains: 'retific', mode: 'insensitive' } }] },
    select: { phaseKey: true },
    distinct: ['phaseKey'],
  })
  return new Set(fases.map((f) => f.phaseKey))
}

// ─── SUGESTÃO DE RESPONSÁVEL (Bloco F) ──────────────────────────────────────
//
// Regra do mandato, distinta da recomendação geral de `elegibilidade.ts`:
//   apto → menos ativas → empate pelos últimos 30 dias → ausente vai para o
//   sucessor sugerido (Bloco E2). As PRIMITIVAS (permissão, disponibilidade,
//   aptidão opt-in, carga) são as MESMAS de `lerOrganizacao`/`classificarCarga`
//   — só o critério de ordenação é próprio deste motor.

export interface SugestaoDeResponsavel {
  usuarioId: number
  nome: string
  motivo: string
  /**
   * `true` = SEM APTIDÃO CADASTRADA para esta tarefa (nem a unidade de trabalho, nem o país, nem a equipe exigida
   * definem quem é apto): o nome é só o de MENOR CARGA entre quem tem permissão de executar — nunca uma aptidão
   * inventada. A tela diz isso com todas as letras, e a regra automática (r1) NÃO atribui com ele.
   */
  fallback?: boolean
  /** As ativas de quem foi sugerido (a carga que decidiu o fallback). */
  ativas?: number
  /**
   * A APTIDÃO COMPROVADA que justificou a escolha, estruturada (só do cadastro — nunca inferida): o país do processo (M3), a unidade
   * de trabalho, a equipe exigida. Ausente no fallback e no sucessor de ausente (nenhuma aptidão a citar).
   */
  aptoEm?: string | null
  aptoA?: string | null
  equipe?: string | null
}

/** O que da TAREFA decide quem é apto: a unidade de trabalho, o país do processo e a equipe exigida (todos do cadastro). */
export interface AlvoDaSugestao {
  unidadeOperacionalId: number | null
  equipeExigida: string | null
  /** O país do processo (`Processo.paisId`) — a aptidão por país (M3) compara com ele. Ausente/`null` = o critério não se aplica. */
  paisId?: number | null
}

/**
 * Lê, em lote, o que decide a aptidão de cada tarefa: a unidade de trabalho (cadeia canônica) e a equipe
 * exigida (da tarefa ou do passo publicado — a MESMA `equipeExigida` da recomendação).
 */
export async function alvosDeSugestao(tarefaIds: number[], db: Db = prisma): Promise<Map<number, AlvoDaSugestao>> {
  const saida = new Map<number, AlvoDaSugestao>()
  if (tarefaIds.length === 0) return saida
  const [unidades, tarefas] = await Promise.all([
    unidadesDasTarefas(tarefaIds),
    db.tarefa.findMany({
      where: { id: { in: tarefaIds } },
      select: { id: true, equipeKey: true, workflowStepInstance: { select: { papel: true, equipe: true } }, processo: { select: { paisId: true } } },
    }),
  ])
  const porId = new Map(tarefas.map((t) => [t.id, t]))
  for (const id of tarefaIds) {
    const t = porId.get(id)
    saida.set(id, {
      unidadeOperacionalId: unidades.get(id) ?? null,
      paisId: t?.processo?.paisId ?? null,
      equipeExigida: t ? equipeExigida({ equipeKey: t.equipeKey, equipeDoPasso: t.workflowStepInstance?.equipe ?? null, papelDoPasso: t.workflowStepInstance?.papel ?? null }) : null,
    })
  }
  return saida
}

/**
 * O QUE A SUGESTÃO PRECISA SABER DO SISTEMA — lido UMA vez por requisição e reaproveitado por
 * todos os itens (achado de desempenho, 30/09/2026: a lista chamava a sugestão item a item e cada
 * chamada refazia ~9 leituras idênticas — usuários, organização, cargas, log de 30 dias, rótulos).
 * A regra em si (`escolherResponsavel`) é pura sobre este contexto.
 */
export interface ContextoDeSugestao {
  organizacao: Awaited<ReturnType<typeof lerOrganizacao>>
  usuarios: Array<{ id: number; nome: string; tipo: string; permissoesCustom: unknown; perfil: { permissoes: unknown } | null }>
  ativasPorUsuario: Map<number, number>
  atribuicoes30dPorUsuario: Map<number, number>
  unidadesComAptidao: Set<number>
  /** Os países em que alguém já foi declarado apto (M3) — opcional: contexto montado sem ele = a aptidão por país não restringe. */
  paisesComAptidao?: Set<number>
  rotulos: Awaited<ReturnType<typeof rotulosDasUnidades>>
  /** Equipes ATIVAS do cadastro (código em minúsculas → membros): só elas restringem quem é apto. */
  equipes: Map<string, Set<number>>
}

export async function carregarContextoDeSugestao(
  agora = new Date(), db: Db = prisma, organizacaoJaLida?: ContextoDeSugestao['organizacao'],
): Promise<ContextoDeSugestao> {
  const trintaDiasAtras = new Date(agora.getTime() - 30 * 86_400_000)
  const [organizacao, usuarios, ativas, atribuicoesRecentes, rotulos, grupos] = await Promise.all([
    organizacaoJaLida ?? lerOrganizacao(agora),
    db.usuario.findMany({
      select: { id: true, nome: true, tipo: true, permissoesCustom: true, perfil: { select: { permissoes: true } } },
    }),
    db.tarefa.groupBy({
      by: ['responsavelId'],
      where: { responsavelId: { not: null }, statusTarefa: { in: ['NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE', 'BLOQUEADA'] } },
      _count: { _all: true },
    }),
    db.logAuditoria.findMany({
      where: { acao: { in: ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA'] }, criadoEm: { gte: trintaDiasAtras } },
      select: { detalhes: true },
    }),
    rotulosDasUnidades(),
    db.grupoUsuario.findMany({ where: { ativo: true }, select: { code: true, membros: { select: { usuarioId: true } } } }),
  ])
  const equipes = new Map<string, Set<number>>()
  for (const g of grupos) if (g.code) equipes.set(g.code.trim().toLowerCase(), new Set(g.membros.map((m) => m.usuarioId)))
  const ativasPorUsuario = new Map<number, number>()
  for (const g of ativas) if (g.responsavelId != null) ativasPorUsuario.set(g.responsavelId, g._count._all)
  const atribuicoes30dPorUsuario = new Map<number, number>()
  for (const l of atribuicoesRecentes) {
    const para = (l.detalhes as { para?: number } | null)?.para
    if (para == null) continue
    atribuicoes30dPorUsuario.set(para, (atribuicoes30dPorUsuario.get(para) ?? 0) + 1)
  }
  return {
    organizacao, usuarios, ativasPorUsuario, atribuicoes30dPorUsuario, rotulos, equipes,
    unidadesComAptidao: new Set([...organizacao.values()].flatMap((o) => o.aptidoes)),
    paisesComAptidao: new Set([...organizacao.values()].flatMap((o) => o.paisesAptos ?? [])),
  }
}

/**
 * A regra pura. QUEM PODE SER SUGERIDO é decidido em camadas — cada uma só TIRA gente, nenhuma inventa aptidão:
 *   1. permissão de executar tarefa (`tarefas.iniciar_concluir`);
 *   2. a EQUIPE exigida pela tarefa, quando ela existe como equipe ativa no cadastro (só membros);
 *   3. a APTIDÃO da unidade de trabalho, quando alguém já foi declarado apto a ela (só os declarados);
 *   4. a APTIDÃO POR PAÍS do processo (M3), quando alguém já foi declarado apto naquele país (só os declarados).
 * Se (2), (3) ou (4) definiram quem é apto, o ranking é entre os aptos: menos ativas → empate 30 d → ausente vai
 * para o sucessor sugerido (que também precisa ser apto e estar disponível).
 *
 * Se NENHUMA delas definiu aptidão, não há aptidão cadastrada para esta tarefa: a sugestão é um
 * FALLBACK explícito por menor carga, e nunca recai sobre administrador — ser administrador dá todas as
 * permissões, não prova que a pessoa executa este trabalho (achado real, 30/09/2026: "Sugiro Marco Rovatti:
 * 0 ativa(s)" só porque o gestor tinha carga zero). Sem ninguém que execute, não há sugestão (`null`).
 */
export function escolherResponsavel(
  ctx: ContextoDeSugestao, alvo: AlvoDaSugestao | number | null, extraAtivas?: ReadonlyMap<number, number>,
  /** Quem NÃO pode ser sugerido (ex.: a origem de uma redistribuição, quem já está no limite). Ausente = ninguém é excluído. */
  excluir?: ReadonlySet<number>,
): SugestaoDeResponsavel | null {
  const { unidadeOperacionalId, equipeExigida: exigida, paisId = null }: AlvoDaSugestao =
    alvo != null && typeof alvo === 'object' ? alvo : { unidadeOperacionalId: alvo, equipeExigida: null }
  const { organizacao } = ctx
  const aptidaoEhRegra = unidadeOperacionalId != null && ctx.unidadesComAptidao.has(unidadeOperacionalId)
  // APTIDÃO POR PAÍS (M3) — opt-in por país, como a da unidade: só restringe o país em que alguém já foi declarado apto.
  const paisEhRegra = paisId != null && (ctx.paisesComAptidao?.has(paisId) ?? false)
  const nomeDoPais = paisEhRegra ? [...organizacao.values()].flatMap((o) => o.paisesAptosDetalhados ?? []).find((p) => p.paisId === paisId)?.nome ?? null : null
  const membrosDaEquipe = exigida != null ? ctx.equipes.get(exigida) ?? null : null
  const equipeEhRegra = membrosDaEquipe != null
  // NOME DA UNIDADE — como no protótipo ("apta a Espanha"), nunca só "apto".
  const nomeDaUnidade = aptidaoEhRegra ? ctx.rotulos.get(unidadeOperacionalId!)?.nome ?? null : null
  const semAptidaoCadastrada = !aptidaoEhRegra && !equipeEhRegra && !paisEhRegra

  // DISPONIBILIDADE NÃO É PRÉ-FILTRO AQUI, DE PROPÓSITO: o mandato pede
  // "apto → menos ativas → empate 30 d → AUSENTE vai para o sucessor
  // sugerido" — ausente pode legitimamente vencer o ranking (0 ativas,
  // porque não está recebendo trabalho novo) e só então é redirecionado
  // para quem ele mesmo sugeriu como sucessor (Bloco E2).
  const elegiveis = ctx.usuarios.filter((u) => {
    if (excluir?.has(u.id)) return false
    const permissoes = calcularPermissoes(u.tipo, u.perfil?.permissoes as MapaPermissoes | null, u.permissoesCustom as MapaPermissoes | null)
    if (!temPermissao(permissoes, 'tarefas.iniciar_concluir')) return false
    if (equipeEhRegra && !membrosDaEquipe!.has(u.id)) return false
    const org = organizacao.get(u.id)
    if (aptidaoEhRegra && !(org?.aptidoes ?? []).includes(unidadeOperacionalId!)) return false
    if (paisEhRegra && !(org?.paisesAptos ?? []).includes(paisId!)) return false
    // Sem aptidão cadastrada, o administrador não é candidato: a permissão dele vem do tipo, não de executar este trabalho.
    if (semAptidaoCadastrada && u.tipo === 'admin') return false
    return true
  })
  if (elegiveis.length === 0) return null
  const idsElegiveis = new Set(elegiveis.map((u) => u.id))

  const ordenados = elegiveis
    .map((u) => ({
      id: u.id, nome: u.nome,
      ativas: (ctx.ativasPorUsuario.get(u.id) ?? 0) + (extraAtivas?.get(u.id) ?? 0),
      atribuicoes30d: ctx.atribuicoes30dPorUsuario.get(u.id) ?? 0,
    }))
    .sort((a, b) => (a.ativas - b.ativas) || (a.atribuicoes30d - b.atribuicoes30d) || (a.id - b.id))

  // PERCORRE o ranking na ordem: se o candidato está disponível, é ele. Se
  // está ausente, a sugestão vira o SUCESSOR SUGERIDO dele (Bloco E2,
  // `Indisponibilidade.sucessorSugerido` — sem consulta extra) — desde que o
  // sucessor também seja APTO e esteja disponível; ausente SEM sucessor válido
  // não é uma sugestão, e o ranking segue para o próximo — nunca sugere
  // alguém que não vai ver o trabalho nem alguém que não é apto.
  for (const c of ordenados) {
    const indisponivel = organizacao.get(c.id)?.indisponivelPor
    if (!indisponivel) {
      return {
        usuarioId: c.id, nome: c.nome, ativas: c.ativas,
        ...(semAptidaoCadastrada
          ? { fallback: true, motivo: `sem aptidão cadastrada para esta tarefa; menor carga (${c.ativas} ativa(s))` }
          : {
              motivo: `${c.ativas} ativa(s)${nomeDaUnidade ? `, apto a ${nomeDaUnidade}` : ''}${paisEhRegra ? `, apto em ${nomeDoPais ?? `país #${paisId}`}` : ''}${equipeEhRegra ? `, da equipe ${exigida}` : ''}`,
              aptoEm: paisEhRegra ? nomeDoPais ?? `país #${paisId}` : null, aptoA: nomeDaUnidade, equipe: equipeEhRegra ? exigida : null,
            }),
      }
    }
    const sucessor = indisponivel.sucessorSugerido
    if (sucessor && idsElegiveis.has(sucessor.usuarioId) && !organizacao.get(sucessor.usuarioId)?.indisponivelPor) {
      return {
        usuarioId: sucessor.usuarioId, nome: sucessor.nome,
        motivo: `${c.nome} está ausente — sucessor sugerido para a carteira.`,
        ...(semAptidaoCadastrada
          ? { fallback: true }
          : { aptoEm: paisEhRegra ? nomeDoPais ?? `país #${paisId}` : null, aptoA: nomeDaUnidade, equipe: equipeEhRegra ? exigida : null }),
      }
    }
  }
  return null
}

/**
 * A SUGESTÃO — apto → menos ativas → empate pelos últimos 30 dias → se o
 * escolhido está ausente, a sugestão passa a ser o SUCESSOR SUGERIDO dele
 * (Bloco E2, `IndisponibilidadeOperacional.sucessorSugeridoId`).
 */
export async function sugerirResponsavelPrecisaDeVoce(
  tarefaId: number, agora = new Date(), db: Db = prisma,
  /**
   * Tarefas que JÁ FORAM decididas para cada pessoa mas ainda não gravadas — quem planeja um
   * LOTE (regra r1, Bloco H3) soma aqui o que já distribuiu, para o plano balancear como a
   * execução sequencial balancearia, em vez de mandar tudo para quem está com menos AGORA.
   * Ausente = comportamento de sempre.
   */
  extraAtivas?: ReadonlyMap<number, number>,
): Promise<SugestaoDeResponsavel | null> {
  const [alvos, ctx] = await Promise.all([alvosDeSugestao([tarefaId], db), carregarContextoDeSugestao(agora, db)])
  return escolherResponsavel(ctx, alvos.get(tarefaId) ?? null, extraAtivas)
}

// ─── OS 7 TIPOS ──────────────────────────────────────────────────────────────

export type TipoItemPrecisaDeVoce =
  | 'FASE_DEIXADA' | 'DIVERGENCIA' | 'SEM_DONO' | 'ESCALADA' | 'BLOQUEADA' | 'CARGA' | 'PAREDE_A_FRENTE'

export interface AcaoDoItem {
  rotulo: string
  acao: string
}

export interface ItemPrecisaDeVoceTorre {
  tipo: TipoItemPrecisaDeVoce
  score: number
  faixa: FaixaDeRisco
  tarefaId: number | null
  processoId: number | null
  familiaNome: string | null
  titulo: string
  detalhe: string
  sugestao: string | null
  acao1: AcaoDoItem
  acao2: AcaoDoItem
  link: string
  /** Contexto extra que a ação precisa (ids de tarefas do lote, usuarioId sugerido, achado). */
  contexto: Record<string, unknown>
}

const rotuloDaFamilia = (l: LinhaGerencial) => l.familiaNome ?? l.processoNome ?? null

/**
 * A LISTA — ordenada por score, maior primeiro. `agora` e `linhas` são
 * injetáveis para os testes conferirem um instante fixo sem esperar o
 * relógio real.
 */
export async function itensPrecisaDeVoce(
  opts: { agora?: Date; linhas?: LinhaGerencial[]; db?: Db; organizacao?: ContextoDeSugestao['organizacao']; adiantadas?: LeiturasAdiantadas } = {},
): Promise<ItemPrecisaDeVoceTorre[]> {
  return (await lerBaseDoPrecisa(opts)).itens
}

/**
 * A LEITURA-BASE do "Precisa de você": os itens POR TAREFA (o que o score, o Radar e a regra r1 leem) e o que as DECISÕES do dia
 * (`montarPrecisaDeVoce`) precisam para se apresentar — as linhas abertas, as divergências, o score de cada tarefa, quem está no limite.
 * `itensPrecisaDeVoce` é esta função devolvendo só os itens: um caminho só.
 */
export interface BaseDoPrecisa {
  itens: ItemPrecisaDeVoceTorre[]
  /** Só tarefa ABERTA, de processo não pausado, nunca de fase futura — o universo de todos os itens. */
  linhas: LinhaGerencial[]
  divergencias: Awaited<ReturnType<typeof conferirCoerenciaPassoTarefa>>
  tarefasDivergentes: Set<number>
  scorePorTarefa: Map<number, number>
  fasesEspeciais: Set<string>
  noLimite: Awaited<ReturnType<typeof pessoasNoLimite>>
  /** A fase ATUAL de cada processo das linhas (`Processo.faseAtualKey`) — a linha traz o rótulo, não a chave. */
  faseAtualPorProcesso: Map<number, string | null>
}

export async function lerBaseDoPrecisa(
  opts: { agora?: Date; linhas?: LinhaGerencial[]; db?: Db; organizacao?: ContextoDeSugestao['organizacao']; adiantadas?: LeiturasAdiantadas } = {},
): Promise<BaseDoPrecisa> {
  const agora = opts.agora ?? new Date()
  const db = opts.db ?? prisma
  // PROCESSO PAUSADO FICA FORA DA TORRE (M2, filtro canônico `semProcessosPausados`): a lista de decisões é da Torre, então
  // não acusa nada de um processo que o gestor pausou. A Operação (sino, fila) lê as linhas por outro caminho e não muda.
  const [brutasLidas, pausados] = await Promise.all([opts.linhas ?? lerLinhasOperacionais(agora, db), idsDeProcessosPausados(db)])
  const brutas = semProcessosPausados(brutasLidas, pausados)

  // SÓ TAREFA ABERTA (achado real, 30/09/2026): `lerLinhasOperacionais` usa a
  // MESMA leitura do Kanban (`visaoGerencial` sem filtro de status devolve
  // ativas + concluídas — é o padrão certo pra um board com coluna
  // "Concluído", errado pra uma lista de DECISÕES pendentes). Filtra pelo
  // MESMO `STATUS_ATIVOS` que a Operação usa em toda parte — nunca uma
  // segunda definição de "aberta".
  //
  // E NUNCA TAREFA DE FASE FUTURA: uma tarefa cuja fase ainda não chegou
  // (ordem maior que a fase atual do processo, pelo CADASTRO — mesma leitura
  // de `ordensDeFase`, a correção do reconciliador NEC-001) não é uma
  // decisão de hoje. `null` (fase fora do cadastro do tipo) nunca exclui —
  // fase desconhecida é neutra, não "no futuro".
  const tipoPorProcesso = new Map<number, number | null>()
  const faseAtualPorProcesso = new Map<number, string | null>()
  const processoIds = [...new Set(brutas.map((l) => l.processoId).filter((id): id is number => id != null))]
  if (processoIds.length) {
    const processos = await db.processo.findMany({
      where: { id: { in: processoIds } },
      select: { id: true, tipoProcessoMotorId: true, faseAtualKey: true },
    })
    for (const p of processos) { tipoPorProcesso.set(p.id, p.tipoProcessoMotorId); faseAtualPorProcesso.set(p.id, p.faseAtualKey) }
  }
  const ordensPorTipo = new Map<number, Map<string, number>>()
  const tiposDistintos = [...new Set([...tipoPorProcesso.values()].filter((t): t is number => t != null))]
  // Um tipo não depende do outro: as leituras de ordem correm juntas (achado de desempenho, 30/09/2026).
  const ordens = await Promise.all(tiposDistintos.map((tipoId) => ordensDeFase(tipoId)))
  tiposDistintos.forEach((tipoId, i) => ordensPorTipo.set(tipoId, ordens[i]))
  const ehFaseFutura = (l: LinhaGerencial): boolean => {
    if (l.processoId == null || l.faseMacroKey == null) return false
    const tipoId = tipoPorProcesso.get(l.processoId)
    const faseAtual = faseAtualPorProcesso.get(l.processoId)
    if (tipoId == null || faseAtual == null) return false
    const ordens = ordensPorTipo.get(tipoId)
    const ordemTarefa = ordens?.get(l.faseMacroKey)
    const ordemAtual = ordens?.get(faseAtual)
    if (ordemTarefa == null || ordemAtual == null) return false
    return ordemTarefa > ordemAtual
  }
  const linhas = brutas.filter((l) => STATUS_ATIVOS.includes(l.statusTarefa) && !ehFaseFutura(l))

  // As leituras abaixo são independentes entre si: correm juntas, uma ida ao banco de espera só.
  // DIVERGÊNCIA — mesmo comparador que trava a transação de projeção
  // (`paresCoerentes`), em lote, contra os passos das tarefas ativas.
  const lerDivergencias = async () => {
    const tarefasComStep = await db.tarefa.findMany({
      where: { id: { in: linhas.map((l) => l.taskId) }, workflowStepInstanceId: { not: null } },
      select: { workflowStepInstanceId: true },
    })
    const stepInstanceIds = [...new Set(tarefasComStep.map((t) => t.workflowStepInstanceId as number))]
    return conferirCoerenciaPassoTarefa(db as Prisma.TransactionClient, stepInstanceIds)
  }
  const adiantadas = opts.adiantadas ?? iniciarLeiturasIndependentes(agora, db, opts.organizacao)
  const [fasesEspeciais, divergencias, noLimite] = await Promise.all([
    adiantadas.fasesEspeciais,
    lerDivergencias(),
    adiantadas.noLimite,
  ])
  const tarefasDivergentes = new Set(divergencias.map((d) => d.tarefaId))

  const itens: ItemPrecisaDeVoceTorre[] = []
  const scorePorTarefa = new Map<number, number>()

  for (const l of linhas) {
    const fatores: FatoresDeRisco = {
      semDono: l.responsavelId == null,
      vencida: l.atrasada === true,
      acompanhamentoVencido: l.acompanhamentoVencido === true,
      // ESCALADA = cobrança sem resposta ≥ o limite do CADASTRO do passo (`escalarApos`): a linha traz `escalada`, ligada pelo
      // próprio motor de cobrança quando a contagem de cobranças sem resposta atinge esse limite — nunca um "2" fixo aqui.
      cobrancasSemRespostaMuitas: l.escalada === true,
      faseDeixada: (l as unknown as { faseAnteriorAFaseAtual?: boolean }).faseAnteriorAFaseAtual === true,
      divergente: tarefasDivergentes.has(l.taskId),
      bloqueada: l.statusTarefa === 'BLOQUEADA',
      faseApostilamentoOuRetificacao: l.faseMacroKey != null && fasesEspeciais.has(l.faseMacroKey),
    }
    const score = scoreDeRisco(fatores)
    scorePorTarefa.set(l.taskId, score)
    if (score === 0) continue
    const faixa = faixaDoScore(score)
    const familia = rotuloDaFamilia(l)
    const linkFamilia = l.processoId != null ? urlOperacaoDaFamilia(l.processoId) : '/tarefas'

    // PRIMÁRIO — mutuamente exclusivo, prioridade: Fase deixada > Divergência > Sem dono.
    if (fatores.faseDeixada) {
      itens.push({
        tipo: 'FASE_DEIXADA', score, faixa, tarefaId: l.taskId, processoId: l.processoId, familiaNome: familia,
        titulo: `#${l.taskId} · ${l.titulo}`,
        detalhe: `Tarefa continua aberta em ${l.faseMacroKey ?? 'fase anterior'} e o processo já está em ${l.faseAtualDoProcessoLabel ?? 'outra fase'}.` +
          (l.dataPrazo ? ` Prazo: ${l.dataPrazo.slice(0, 10)}.` : ''),
        sugestao: null, // preenchida por quem monta a resposta (precisa de leitura assíncrona por item)
        acao1: { rotulo: 'Atribuir a {sugerido}', acao: 'ATRIBUIR_SUGERIDO' },
        acao2: { rotulo: 'Encerrar (não devida)', acao: 'ENCERRAR_NAO_DEVIDA' },
        link: linkFamilia, contexto: { tarefaId: l.taskId },
      })
    } else if (fatores.divergente) {
      const d = divergencias.find((x) => x.tarefaId === l.taskId)
      itens.push({
        tipo: 'DIVERGENCIA', score, faixa, tarefaId: l.taskId, processoId: l.processoId, familiaNome: familia,
        titulo: `#${l.taskId} · ${l.titulo}`,
        detalhe: `O passo está "${d?.statusPasso ?? '?'}" e a tarefa está "${d?.statusTarefa ?? l.statusTarefa}" — estados contraditórios.`,
        sugestao: `Reconciliar: a tarefa passa a espelhar o passo (esperado: ${d?.esperado ?? '—'}).`,
        acao1: { rotulo: 'Reconciliar', acao: 'RECONCILIAR' },
        acao2: { rotulo: 'Ver 3 fontes', acao: 'VER_3_FONTES' },
        link: linkFamilia, contexto: { tarefaId: l.taskId },
      })
    } else if (fatores.semDono) {
      itens.push({
        tipo: 'SEM_DONO', score, faixa, tarefaId: l.taskId, processoId: l.processoId, familiaNome: familia,
        titulo: `#${l.taskId} · ${l.titulo}`,
        detalhe: `${familia ?? 'Sem família'} · ${l.faseMacroKey ?? '—'} · ${l.etapaAtual ?? '—'}`,
        sugestao: null,
        acao1: { rotulo: 'Atribuir a {sugerido}', acao: 'ATRIBUIR_SUGERIDO' },
        acao2: { rotulo: 'Escolher outro', acao: 'ATRIBUIR_ESCOLHIDO' },
        link: urlDistribuicaoDoProcesso(l.processoId ?? 0), contexto: { tarefaId: l.taskId },
      })
    }

    // ADITIVOS — não competem com o primário, mesma tarefa pode aparecer de novo.
    if (fatores.cobrancasSemRespostaMuitas) {
      itens.push({
        tipo: 'ESCALADA', score, faixa, tarefaId: l.taskId, processoId: l.processoId, familiaNome: familia,
        titulo: `${l.terceiroNome ?? 'Terceiro'} · ${l.titulo}`,
        detalhe: `${l.cobrancasSemResposta} cobrança(s) sem resposta. Pedido em acompanhamento há ${l.esperandoHaDias ?? '?'} dia(s).`,
        sugestao: 'Ligar hoje. Sem retorno, trocar o canal.',
        acao1: { rotulo: 'Registrar ligação', acao: 'REGISTRAR_LIGACAO' },
        acao2: { rotulo: 'Trocar canal', acao: 'TROCAR_CANAL' },
        link: linkFamilia, contexto: { tarefaId: l.taskId },
      })
    }
    if (fatores.bloqueada) {
      itens.push({
        tipo: 'BLOQUEADA', score, faixa, tarefaId: l.taskId, processoId: l.processoId, familiaNome: familia,
        titulo: `${l.titulo}`,
        detalhe: `Motivo: ${l.motivoBloqueio ?? '—'}. O prazo continua contando.`,
        sugestao: 'Cobrar o cliente pelo canal cadastrado.',
        acao1: { rotulo: 'Cobrar cliente', acao: 'COBRAR_CLIENTE' },
        acao2: { rotulo: 'Desbloquear', acao: 'DESBLOQUEAR' },
        link: linkFamilia, contexto: { tarefaId: l.taskId },
      })
    }
  }

  // CARGA — pessoa no limite (executáveis ≥ limite do cadastro). A MESMA conta da aba Equipe e da
  // regra r3 (`pessoasNoLimite`, sobre as linhas da Operação) — nunca uma segunda contagem sobre
  // `Tarefa` cru, que divergia da Operação nas certidões (status/prazo são projeção).
  const pessoasCarga = [...noLimite.values()]
  // Uma leitura só para todas as pessoas no limite (a função já é em lote; antes era uma ida por pessoa).
  const capacidades = await capacidadeMedidaPorUsuario(
    pessoasCarga.map((u) => u.usuarioId), new Map(pessoasCarga.map((u) => [u.usuarioId, u.executaveis])), agora,
  )
  for (const u of pessoasCarga) {
    const capacidadeMedida = capacidades.get(u.usuarioId)
    const score = 3 // ATENÇÃO — carga é achado estrutural, não soma de fatores por tarefa.
    itens.push({
      tipo: 'CARGA', score, faixa: faixaDoScore(score), tarefaId: null, processoId: null, familiaNome: u.nome,
      titulo: `${u.nome} no limite: ${u.executaveis} ativas, fecha ~${capacidadeMedida?.mediaSemanal ?? '?'} por semana`,
      detalhe: `Fila estimada de ${capacidadeMedida?.filaEmSemanas ?? '?'} semana(s).`,
      sugestao: 'Redistribuir as tarefas "a enviar" para quem tem carga menor.',
      acao1: { rotulo: 'Redistribuir N', acao: 'REDISTRIBUIR_CARGA' },
      acao2: { rotulo: 'Ver equipe', acao: 'VER_EQUIPE' },
      link: '/operacao/distribuicao', contexto: { usuarioId: u.usuarioId },
    })
  }

  // PAREDE À FRENTE / achados de CADASTRO (CAD-*): NÃO entram aqui (01/10/2026). Cadastro e saúde do sistema moram no
  // Gerenciamento › Saúde do sistema; a Torre serve só à gestão de processo. O tipo continua existindo, mas nunca é produzido.

  itens.sort((a, b) => b.score - a.score || a.tipo.localeCompare(b.tipo) || (a.tarefaId ?? 0) - (b.tarefaId ?? 0))
  return { itens, linhas, divergencias, tarefasDivergentes, scorePorTarefa, fasesEspeciais, noLimite, faseAtualPorProcesso }
}

/** O texto que a tela mostra: com aptidão, "Sugiro X: motivo"; sem aptidão cadastrada, o FALLBACK dito com todas as letras. */
export function textoDaSugestao(s: SugestaoDeResponsavel | null): string {
  if (!s) return 'Nenhum candidato apto e disponível encontrado.'
  if (s.fallback) return `Sem aptidão cadastrada para esta tarefa; sugiro ${s.nome} por menor carga${s.ativas != null ? ` (${s.ativas} ativa(s))` : ''}.`
  return `Sugiro ${s.nome}: ${s.motivo}`
}

/**
 * As leituras que NÃO dependem das linhas da Operação. Quem monta a resposta as dispara ANTES de esperar as
 * linhas (a leitura mais lenta) e passa aqui: correm durante essa espera em vez de depois dela. O resultado
 * é o mesmo — só muda quando a leitura começa.
 */
export interface LeiturasAdiantadas {
  fasesEspeciais: Promise<Set<string>>
  noLimite: ReturnType<typeof pessoasNoLimite>
}

export function iniciarLeiturasIndependentes(agora: Date, db: Db, organizacao?: ContextoDeSugestao['organizacao'] | Promise<ContextoDeSugestao['organizacao']>): LeiturasAdiantadas {
  const l: LeiturasAdiantadas = {
    fasesEspeciais: fasesApostilamentoOuRetificacao(db),
    noLimite: Promise.resolve(organizacao).then((org) => pessoasNoLimite(agora, undefined, org)),
  }
  // Se quem chamou falhar antes de esperar por elas, a rejeição não vira "não tratada" — quem as espera continua vendo o erro.
  for (const p of Object.values(l)) p.catch(() => undefined)
  return l
}

/**
 * PREENCHE `sugestao` dos itens FASE_DEIXADA/SEM_DONO — feito depois da lista
 * pronta porque a sugestão é uma leitura assíncrona por item (não vale a pena
 * pagar o custo pra quem só quer o número, ex. o KPI de "sem dono").
 */
export async function comSugestoes(
  itens: ItemPrecisaDeVoceTorre[], agora = new Date(), db: Db = prisma,
  opts: { organizacao?: ContextoDeSugestao['organizacao'] } = {},
): Promise<ItemPrecisaDeVoceTorre[]> {
  const precisam = itens.filter((it) => (it.tipo === 'FASE_DEIXADA' || it.tipo === 'SEM_DONO') && it.tarefaId != null)
  // UMA leitura do sistema e UMA das unidades para a lista toda; a sugestão só depende da unidade,
  // então cada unidade distinta é decidida uma vez e reaproveitada pelos itens dela.
  const [ctx, alvos] = precisam.length
    ? await Promise.all([
        carregarContextoDeSugestao(agora, db, opts.organizacao),
        alvosDeSugestao(precisam.map((it) => it.tarefaId as number), db),
      ])
    : [null, null]
  const porAlvo = new Map<string, SugestaoDeResponsavel | null>()
  const sugestaoDe = (tarefaId: number): SugestaoDeResponsavel | null => {
    const alvo = alvos!.get(tarefaId) ?? { unidadeOperacionalId: null, equipeExigida: null }
    const chave = `${alvo.unidadeOperacionalId ?? '-'}|${alvo.equipeExigida ?? '-'}`
    if (!porAlvo.has(chave)) porAlvo.set(chave, escolherResponsavel(ctx!, alvo))
    return porAlvo.get(chave) ?? null
  }
  return itens.map((it) => {
    if ((it.tipo === 'FASE_DEIXADA' || it.tipo === 'SEM_DONO') && it.tarefaId != null) {
      const s = sugestaoDe(it.tarefaId)
      return {
        ...it,
        sugestao: textoDaSugestao(s),
        acao1: { ...it.acao1, rotulo: s ? `Atribuir a ${s.nome}` : it.acao1.rotulo },
        contexto: { ...it.contexto, sugeridoId: s?.usuarioId ?? null, sugeridoNome: s?.nome ?? null },
      }
    }
    return it
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// AS DECISÕES DO DIA — o que a Torre MOSTRA (frente B2, 01/10/2026)
//
// Os itens por TAREFA acima (`lerBaseDoPrecisa`) são a base. As decisões são a apresentação do protótipo (inventário §2.4):
// "Sem responsável" e "Fase deixada" agregam por PROCESSO; Escalada, Divergência e Bloqueada seguem por tarefa; Carga por pessoa.
// Cada texto vem de `precisa-de-voce-decisoes.ts` (puro). A sugestão NUNCA aponta quem não tem aptidão comprovada.
// ═══════════════════════════════════════════════════════════════════════════

const linkDoProcesso = (processoId: number) => `/torre/processo/${processoId}`

/** A tarefa entra em "Sem responsável"? Aberta (a base já filtrou), sem dono, e não é Divergência (que tem prioridade). UMA definição: lista e ação leem esta. */
export const ehSemDonoDoPainel = (l: Pick<LinhaGerencial, 'responsavelId' | 'taskId'>, divergentes: ReadonlySet<number>): boolean =>
  l.responsavelId == null && !divergentes.has(l.taskId)

/**
 * As certidões sem responsável de UM processo, do jeito que o item da lista as conta: abertas, fora de fase futura, não administrativas
 * e não-divergentes. A ação "Atribuir" age exatamente neste conjunto — o que a pessoa viu é o que é atribuído.
 */
export async function semDonoDoProcesso(processoId: number, agora: Date, db: Db = prisma): Promise<number[]> {
  const { linhas } = await visaoGerencial({ processoId, semResponsavel: true, porPagina: 500 }, agora, db)
  const abertas = semFaseFutura(linhas).filter((l) => STATUS_ATIVOS.includes(l.statusTarefa))
  if (abertas.length === 0) return []
  const admin = await db.tarefa.findMany({ where: { id: { in: abertas.map((l) => l.taskId) }, tipo: 'ADMINISTRATIVA' }, select: { id: true } })
  const ehAdmin = new Set(admin.map((a) => a.id))
  const candidatas = abertas.filter((l) => !ehAdmin.has(l.taskId))
  const comPasso = await db.tarefa.findMany({ where: { id: { in: candidatas.map((l) => l.taskId) }, workflowStepInstanceId: { not: null } }, select: { workflowStepInstanceId: true } })
  const divergentes = new Set(
    (await conferirCoerenciaPassoTarefa(db as Prisma.TransactionClient, [...new Set(comPasso.map((t) => t.workflowStepInstanceId as number))])).map((d) => d.tarefaId),
  )
  return candidatas.filter((l) => ehSemDonoDoPainel(l, divergentes)).map((l) => l.taskId)
}

/** A sugestão de UMA tarefa, no formato do texto — com a aptidão por extenso e a "fila livre" (abaixo do limite cadastrado). */
export function sugestaoParaTexto(ctx: ContextoDeSugestao, s: SugestaoDeResponsavel | null): SugestaoParaTexto | null {
  if (!s) return null
  const limite = ctx.organizacao.get(s.usuarioId)?.limiteExecutaveis ?? null
  const aptidao = s.aptoEm ? [`apto em ${s.aptoEm}`] : s.aptoA ? [`apto a ${s.aptoA}`] : s.equipe ? [`da equipe ${s.equipe}`] : []
  const ativas = s.ativas ?? ctx.ativasPorUsuario.get(s.usuarioId) ?? 0
  return {
    usuarioId: s.usuarioId, nome: s.nome, fallback: s.fallback === true, aptidao, ativas,
    filaLivre: limite != null && ativas < limite,
  }
}

/**
 * O PLANO de atribuição de um conjunto de tarefas sem responsável: cada tarefa vai para QUEM TEM APTIDÃO comprovada (a regra de
 * `escolherResponsavel`), agrupadas por pessoa; sem apto → fica para decisão humana. A lista e a ação usam ESTA função.
 */
export async function planoDeAtribuicao(
  tarefaIds: number[], agora: Date, db: Db = prisma, ctxJaLido?: ContextoDeSugestao, alvosJaLidos?: ReadonlyMap<number, AlvoDaSugestao>,
): Promise<PlanoDoSemDono> {
  if (tarefaIds.length === 0) return { atribuicoes: [], semAptidao: [] }
  const [ctx, alvos] = await Promise.all([
    ctxJaLido ? Promise.resolve(ctxJaLido) : carregarContextoDeSugestao(agora, db),
    alvosJaLidos && tarefaIds.every((id) => alvosJaLidos.has(id)) ? Promise.resolve(alvosJaLidos) : alvosDeSugestao(tarefaIds, db),
  ])
  const porAlvo = new Map<string, SugestaoParaTexto | null>()
  const sugestaoDe = (id: number): SugestaoParaTexto | null => {
    const alvo = alvos.get(id) ?? { unidadeOperacionalId: null, equipeExigida: null }
    const chave = `${alvo.unidadeOperacionalId ?? '-'}|${alvo.equipeExigida ?? '-'}|${alvo.paisId ?? '-'}`
    if (!porAlvo.has(chave)) porAlvo.set(chave, sugestaoParaTexto(ctx, escolherResponsavel(ctx, alvo)))
    return porAlvo.get(chave) ?? null
  }
  return planoDoSemDono(tarefaIds.map((taskId) => ({ taskId, sugestao: sugestaoDe(taskId) })))
}

// ─── FASE DEIXADA — "fase sem próxima ação" ─────────────────────────────────

export interface ProcessoSemProximaAcao {
  processoId: number
  familia: string
  pais: string | null
  faseKey: string
  faseLabel: string
  proximaFaseKey: string
  proximaFaseLabel: string
  /** A conclusão mais recente de uma tarefa DESTA fase (registro real); `null` = a fase nunca teve tarefa concluída. */
  ultimaConclusao: Date | null
  /** Quando entrou na fase (`entradaNaFase`, registro real); `null` = sem registro. */
  entrouNaFase: Date | null
}

/**
 * OS PROCESSOS EM FASE SEM PRÓXIMA AÇÃO: ativos (não concluídos, não pausados), no motor v2, cuja fase atual NÃO tem nenhuma tarefa
 * aberta (nem de trabalho nem de espera) e que ainda têm para onde ir (a próxima fase do caminho, com o desvio condicional da Análise).
 * Fase por-processo de avanço MANUAL (Apostilamento, Tradução…) é o caso típico: terminou o trabalho e ninguém clicou "avançar".
 */
export async function processosSemProximaAcao(db: Db = prisma): Promise<ProcessoSemProximaAcao[]> {
  const cfg = await db.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const v2Global = cfg?.runtimeV2Habilitado ?? false
  if (!v2Global) return []
  const procs = (await db.processo.findMany({
    where: { dataConclusao: null, ...ONDE_PROCESSO_NAO_PAUSADO, faseAtualKey: { not: null }, tipoProcessoMotorId: { not: null }, modalidadeId: { not: null } },
    orderBy: { id: 'asc' },
    select: {
      id: true, nome: true, faseAtualKey: true, tipoProcessoMotorId: true, modalidadeId: true, workflowRuntime: true,
      familia: { select: { nome: true } }, paisCanonico: { select: { countryLabel: true } },
    },
  })).filter((p) => resolveWorkflowRuntime(p.workflowRuntime, v2Global) === 'v2')
  if (procs.length === 0) return []
  const ids = procs.map((p) => p.id)

  // Tarefa ABERTA da fase atual (ou sem fase: transversal) = há próxima ação. Uma leitura para todos os processos.
  const abertas = await db.tarefa.groupBy({
    by: ['processoId', 'faseMacroKey'], where: { processoId: { in: ids }, statusTarefa: { in: STATUS_ATIVOS } }, _count: { _all: true },
  })
  const comAcao = new Set<number>()
  const fasePorProcesso = new Map(procs.map((p) => [p.id, p.faseAtualKey as string]))
  for (const a of abertas) {
    if (a.processoId == null) continue
    if (a.faseMacroKey == null || a.faseMacroKey === fasePorProcesso.get(a.processoId)) comAcao.add(a.processoId)
  }
  const candidatos = procs.filter((p) => !comAcao.has(p.id))
  if (candidatos.length === 0) return []

  const candIds = candidatos.map((p) => p.id)
  const [macros, analises, concluidas] = await Promise.all([
    Promise.all([...new Set(candidatos.map((p) => `${p.tipoProcessoMotorId}:${p.modalidadeId}`))].map(async (par) => {
      const [t, m] = par.split(':').map(Number)
      return [par, await resolverMacroWorkflowDoProcesso(t, m, db)] as const
    })),
    db.analiseDocumental.findMany({ where: { processoId: { in: candIds } }, select: { processoId: true, requerRetificacao: true } }),
    db.tarefa.groupBy({
      by: ['processoId', 'faseMacroKey'],
      where: { processoId: { in: candIds }, statusTarefa: { in: ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] }, dataConclusao: { not: null } },
      _max: { dataConclusao: true },
    }),
  ])
  const macroPorPar = new Map(macros)
  const requerRetificacao = new Map(analises.map((a) => [a.processoId, a.requerRetificacao === true]))
  const ultimaPorProcessoFase = new Map<string, Date>()
  for (const c of concluidas) if (c.processoId != null && c._max.dataConclusao) ultimaPorProcessoFase.set(`${c.processoId}|${c.faseMacroKey ?? ''}`, c._max.dataConclusao)

  const saida: ProcessoSemProximaAcao[] = []
  const prontos = candidatos.flatMap((p) => {
    const macro = macroPorPar.get(`${p.tipoProcessoMotorId}:${p.modalidadeId}`)
    if (!macro) return []
    const proxima = proximaFaseDoCaminho(macro.fases, p.faseAtualKey as string, requerRetificacao.get(p.id) === true)
    if (!proxima) return [] // última fase: não há para onde ir
    const rotuloDe = (k: string) => macro.fases.find((f) => f.phaseKey === k)?.label ?? labelDaFasePorPhaseKey(k) ?? k
    return [{ p, faseLabel: rotuloDe(p.faseAtualKey as string), proxima, proximaLabel: rotuloDe(proxima) }]
  })
  // A ENTRADA NA FASE vem da função canônica única; em blocos, como o resto da Torre (pool de conexões pequeno).
  for (let i = 0; i < prontos.length; i += 4) {
    const bloco = await Promise.all(prontos.slice(i, i + 4).map(async ({ p, faseLabel, proxima, proximaLabel }): Promise<ProcessoSemProximaAcao> => {
      const entrada = await entradaNaFase(p.id, p.faseAtualKey as string)
      return {
        processoId: p.id, familia: p.familia?.nome ?? p.nome, pais: p.paisCanonico?.countryLabel ?? null,
        faseKey: p.faseAtualKey as string, faseLabel, proximaFaseKey: proxima, proximaFaseLabel: proximaLabel,
        ultimaConclusao: ultimaPorProcessoFase.get(`${p.id}|${p.faseAtualKey}`) ?? null,
        entrouNaFase: entrada.desde ? new Date(entrada.desde) : null,
      }
    }))
    saida.push(...bloco)
  }
  return saida
}

// ─── ESCALADA / BLOQUEADA — o que a linha não traz ──────────────────────────

async function lerExtrasDaEscalada(ids: number[], db: Db) {
  if (ids.length === 0) return { pedidoEm: new Map<number, Date>(), contatos: new Map<number, Array<{ canal: string; resultado: string }>>(), orgaoPorTarefa: new Map<number, string>() }
  const [pedidos, contatos, comOrgao] = await Promise.all([
    db.solicitacaoDocumento.findMany({ where: { tarefaId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { tarefaId: true, dataEnvio: true } }),
    db.contatoTerceiro.findMany({ where: { tarefaId: { in: ids }, estornadoEm: null }, orderBy: [{ registradoEm: 'desc' }, { id: 'desc' }], select: { tarefaId: true, canal: true, resultado: true } }),
    db.tarefa.findMany({ where: { id: { in: ids }, orgaoId: { not: null } }, select: { id: true, orgaoId: true } }),
  ])
  const pedidoEm = new Map<number, Date>()
  for (const x of pedidos) if (x.tarefaId != null && x.dataEnvio && !pedidoEm.has(x.tarefaId)) pedidoEm.set(x.tarefaId, x.dataEnvio)
  const porTarefa = new Map<number, Array<{ canal: string; resultado: string }>>()
  for (const c of contatos) if (c.tarefaId != null) porTarefa.set(c.tarefaId, [...(porTarefa.get(c.tarefaId) ?? []), { canal: String(c.canal), resultado: String(c.resultado) }])
  // O ÓRGÃO canônico da tarefa (`Tarefa.orgaoId`): a linha só traz o nome quando o Documento o resolve — este é o mesmo cadastro (OrgaoProtocolo).
  const orgaos = comOrgao.length ? await db.orgaoProtocolo.findMany({ where: { id: { in: comOrgao.map((t) => t.orgaoId as number) } }, select: { id: true, name: true } }) : []
  const nomeDoOrgao = new Map(orgaos.map((o) => [o.id, o.name]))
  const orgaoPorTarefa = new Map<number, string>()
  for (const t of comOrgao) { const n = nomeDoOrgao.get(t.orgaoId as number); if (n) orgaoPorTarefa.set(t.id, n) }
  return { pedidoEm, contatos: porTarefa, orgaoPorTarefa }
}

/** Desde quando cada tarefa está BLOQUEADA (o último bloqueio registrado) e quantas cobranças ao cliente já houve. Sem registro → ausente (nunca inventado). */
async function lerExtrasDaBloqueada(ids: number[], db: Db) {
  const desde = new Map<number, Date>()
  const cobrancas = new Map<number, number>()
  if (ids.length === 0) return { desde, cobrancas }
  const [logs, eventos, cobr] = await Promise.all([
    db.logAuditoria.findMany({ where: { entidade: 'Tarefa', entidadeId: { in: ids }, acao: 'TAREFA_BLOQUEADA' }, select: { entidadeId: true, criadoEm: true } }),
    db.workflowEvento.findMany({ where: { entityType: 'tarefa', entityId: { in: ids }, tipo: 'TAREFA_BLOQUEADA' }, select: { entityId: true, criadoEm: true } }),
    db.logAuditoria.groupBy({ by: ['entidadeId'], where: { entidade: 'Tarefa', entidadeId: { in: ids }, acao: 'COBRANCA_CLIENTE_BLOQUEIO' }, _count: { _all: true } }),
  ])
  const ver = (id: number | null, quando: Date) => { if (id != null && (!desde.has(id) || desde.get(id)! < quando)) desde.set(id, quando) }
  for (const l of logs) ver(l.entidadeId, l.criadoEm)
  for (const e of eventos) ver(e.entityId, e.criadoEm)
  for (const c of cobr) if (c.entidadeId != null) cobrancas.set(c.entidadeId, c._count._all)
  return { desde, cobrancas }
}

/** O limite de cobranças sem resposta que ESCALA, do cadastro (o valor mais usado nos passos); o padrão do cadastro quando nada diz. */
export async function escalarAposDoCadastro(db: Db = prisma): Promise<number> {
  const grupos = await db.phaseInternalWorkflowStep.groupBy({ by: ['escalarApos'], where: { escalarApos: { not: null } }, _count: { _all: true } }).catch(() => [])
  const mais = [...grupos].sort((a, b) => b._count._all - a._count._all || (a.escalarApos ?? 0) - (b.escalarApos ?? 0))[0]
  return mais?.escalarApos ?? ESCALAR_APOS_PADRAO
}

// ─── CARGA — o plano de redistribuição ──────────────────────────────────────

export interface PlanoDaCarga {
  usuarioId: number
  nome: string
  executaveis: number
  limite: number
  vencidas: number
  /** As certidões "a iniciar" (ainda não iniciadas) que sairiam da carteira, cada uma com a pessoa APTA e de fila livre que a receberia. */
  movimentos: Array<{ tarefaId: number; paraUsuarioId: number; paraNome: string; pais: string | null }>
  filaEmSemanas: number | null
}

/**
 * O PLANO de uma pessoa no limite: quantas certidões a iniciar mover (o bastante para ficar UMA abaixo do limite) e para quem — só
 * aptos comprovados, fora a própria pessoa e fora quem também está no limite. A lista (texto + rótulo do botão) e a ação usam ESTA função.
 */
export function planejarRedistribuicaoDaCarga(args: {
  pessoa: { usuarioId: number; nome: string; executaveis: number; limite: number }
  linhas: LinhaGerencial[]; ctx: ContextoDeSugestao; alvos: Map<number, AlvoDaSugestao>; noLimite: ReadonlySet<number>
}): Omit<PlanoDaCarga, 'filaEmSemanas'> {
  const { pessoa, linhas, ctx, alvos } = args
  const dela = linhas.filter((l) => l.responsavelId === pessoa.usuarioId)
  const aIniciar = dela.filter((l) => l.statusTarefa === 'NAO_INICIADA')
    .sort((a, b) => (a.dataPrazo ?? '9999').localeCompare(b.dataPrazo ?? '9999') || a.taskId - b.taskId)
  const quanto = quantoMoverDaCarga({ executaveis: pessoa.executaveis, limite: pessoa.limite, aIniciar: aIniciar.length })
  const excluir = new Set<number>([pessoa.usuarioId, ...args.noLimite])
  const extra = new Map<number, number>()
  const movimentos: PlanoDaCarga['movimentos'] = []
  for (const l of aIniciar) {
    if (movimentos.length >= quanto) break
    const alvo = alvos.get(l.taskId) ?? { unidadeOperacionalId: null, equipeExigida: null }
    const s = escolherResponsavel(ctx, alvo, extra, excluir)
    if (!s || s.fallback) continue // sem apto comprovado: não se move por chute
    const limite = ctx.organizacao.get(s.usuarioId)?.limiteExecutaveis ?? null
    const carga = (ctx.ativasPorUsuario.get(s.usuarioId) ?? 0) + (extra.get(s.usuarioId) ?? 0)
    if (limite != null && carga >= limite) continue // "fila livre": quem receberia não pode estourar o próprio limite
    extra.set(s.usuarioId, (extra.get(s.usuarioId) ?? 0) + 1)
    movimentos.push({ tarefaId: l.taskId, paraUsuarioId: s.usuarioId, paraNome: s.nome, pais: l.pais })
  }
  return {
    usuarioId: pessoa.usuarioId, nome: pessoa.nome, executaveis: pessoa.executaveis, limite: pessoa.limite,
    vencidas: dela.filter((l) => l.atrasada).length, movimentos,
  }
}

// ─── A MONTAGEM ──────────────────────────────────────────────────────────────

/** Ordem dos tipos para desempate (a dos cartões do protótipo). */
const ORDEM_DO_TIPO = new Map<string, number>(TIPOS_DO_PAINEL.map((t, i) => [t, i]))

export async function decisoesDoDia(
  base: BaseDoPrecisa, agora: Date, db: Db = prisma, organizacao?: ContextoDeSugestao['organizacao'],
): Promise<{ itens: ItemPrecisaDeVoceTorre[]; escaladaApos: number }> {
  const { linhas, divergencias, tarefasDivergentes, scorePorTarefa, fasesEspeciais, noLimite, faseAtualPorProcesso } = base
  const porTarefa = new Map(linhas.map((l) => [l.taskId, l]))
  const decisoes: ItemPrecisaDeVoceTorre[] = []

  const semDono = linhas.filter((l) => ehSemDonoDoPainel(l, tarefasDivergentes))
  const escaladas = base.itens.filter((i) => i.tipo === 'ESCALADA' && i.tarefaId != null)
  const bloqueadas = base.itens.filter((i) => i.tipo === 'BLOQUEADA' && i.tarefaId != null)
  const cargas = base.itens.filter((i) => i.tipo === 'CARGA')
  const divergentes = base.itens.filter((i) => i.tipo === 'DIVERGENCIA' && i.tarefaId != null)

  // Uma leitura de contexto para a lista toda; as demais correm juntas.
  const precisaCtx = semDono.length > 0 || cargas.length > 0
  const [ctx, alvos, semProximaAcao, extrasEscalada, extrasBloqueada, escaladaApos, capacidades] = await Promise.all([
    precisaCtx ? carregarContextoDeSugestao(agora, db, organizacao) : Promise.resolve(null),
    // O alvo (unidade, país, equipe) das certidões que a lista decide: as sem responsável e as ainda não iniciadas de quem está no limite.
    precisaCtx
      ? alvosDeSugestao([...semDono.map((l) => l.taskId), ...linhas.filter((l) => l.statusTarefa === 'NAO_INICIADA' && l.responsavelId != null && noLimite.has(l.responsavelId)).map((l) => l.taskId)], db)
      : Promise.resolve(new Map<number, AlvoDaSugestao>()),
    processosSemProximaAcao(db),
    lerExtrasDaEscalada(escaladas.map((i) => i.tarefaId as number), db),
    lerExtrasDaBloqueada(bloqueadas.map((i) => i.tarefaId as number), db),
    escalarAposDoCadastro(db),
    cargas.length
      ? capacidadeMedidaPorUsuario(cargas.map((i) => Number(i.contexto.usuarioId)), new Map([...noLimite.values()].map((u) => [u.usuarioId, u.executaveis])), agora)
      : Promise.resolve(new Map() as Awaited<ReturnType<typeof capacidadeMedidaPorUsuario>>),
  ])

  // ── SEM RESPONSÁVEL — um item por processo ────────────────────────────────
  const porProcesso = new Map<number, LinhaGerencial[]>()
  const soltas: LinhaGerencial[] = []
  for (const l of semDono) {
    if (l.processoId == null) soltas.push(l)
    else porProcesso.set(l.processoId, [...(porProcesso.get(l.processoId) ?? []), l])
  }
  const grupos: Array<{ processoId: number | null; ls: LinhaGerencial[] }> = [
    ...[...porProcesso].map(([processoId, ls]) => ({ processoId: processoId as number | null, ls })),
    ...soltas.map((l) => ({ processoId: null as number | null, ls: [l] })),
  ]
  const entradas = new Map<number, Date | null>()
  const comFase = grupos.filter((g) => g.processoId != null)
  for (let i = 0; i < comFase.length; i += 4) {
    await Promise.all(comFase.slice(i, i + 4).map(async (g) => {
      const faseKey = faseAtualPorProcesso.get(g.processoId as number) ?? null
      if (!faseKey) { entradas.set(g.processoId as number, null); return }
      const e = await entradaNaFase(g.processoId as number, faseKey)
      entradas.set(g.processoId as number, e.desde ? new Date(e.desde) : null)
    }))
  }
  for (const g of grupos) {
    const ids = g.ls.map((l) => l.taskId)
    const plano = await planoDeAtribuicao(ids, agora, db, ctx ?? undefined, alvos)
    const l0 = g.ls[0]
    const familia = l0.familiaNome ?? l0.processoNome ?? 'Sem família'
    const t = textosDoSemDono({
      familia, pais: l0.pais, faseLabel: l0.faseAtualDoProcessoLabel, entrouNaFase: g.processoId != null ? entradas.get(g.processoId) ?? null : null,
      agora, total: ids.length, plano,
    })
    const score = Math.max(...ids.map((id) => scorePorTarefa.get(id) ?? 0))
    decisoes.push({
      tipo: 'SEM_DONO', score, faixa: faixaDoScore(score), tarefaId: null, processoId: g.processoId, familiaNome: familia,
      titulo: t.titulo, detalhe: t.detalhe, sugestao: t.sugestao, acao1: t.acao1, acao2: t.acao2,
      link: g.processoId != null ? linkDoProcesso(g.processoId) : `/torre?aba=tarefas&visao=semdono`,
      contexto: {
        processoId: g.processoId, tarefaIds: ids, plano,
        sugeridoId: plano.atribuicoes.length === 1 ? plano.atribuicoes[0].usuarioId : null,
        sugeridoNome: plano.atribuicoes.length === 1 ? plano.atribuicoes[0].nome : null,
      },
    })
  }

  // ── FASE DEIXADA — um item por processo ───────────────────────────────────
  for (const p of semProximaAcao) {
    const t = textosDaFaseDeixada({
      familia: p.familia, pais: p.pais, faseLabel: p.faseLabel, proximaFaseLabel: p.proximaFaseLabel,
      ultimaConclusao: p.ultimaConclusao, entrouNaFase: p.entrouNaFase, agora,
    })
    const score = scoreDeRisco({
      semDono: false, vencida: false, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: false, faseDeixada: true,
      divergente: false, bloqueada: false, faseApostilamentoOuRetificacao: fasesEspeciais.has(p.faseKey),
    })
    decisoes.push({
      tipo: 'FASE_DEIXADA', score, faixa: faixaDoScore(score), tarefaId: null, processoId: p.processoId, familiaNome: p.familia,
      titulo: t.titulo, detalhe: t.detalhe, sugestao: t.sugestao,
      acao1: { rotulo: 'Avançar fase', acao: 'AVANCAR_FASE' }, acao2: { rotulo: 'Encerrar (não devida)', acao: 'ENCERRAR_FASE_NAO_DEVIDA' },
      link: linkDoProcesso(p.processoId),
      contexto: { processoId: p.processoId, faseKey: p.faseKey, proximaFaseKey: p.proximaFaseKey, proximaFaseLabel: p.proximaFaseLabel },
    })
  }

  // ── ESCALADA — por tarefa ─────────────────────────────────────────────────
  for (const i of escaladas) {
    const l = porTarefa.get(i.tarefaId as number)
    if (!l) continue
    const contatos = extrasEscalada.contatos.get(l.taskId) ?? []
    const semResposta: string[] = []
    for (const c of contatos) { if (c.resultado !== 'SEM_RESPOSTA') break; semResposta.unshift(c.canal) } // do mais antigo para o mais recente
    const pedido = extrasEscalada.pedidoEm.get(l.taskId) ?? (l.esperandoDesde ? new Date(l.esperandoDesde) : null)
    const t = textosDaEscalada({
      orgao: l.terceiroNome ?? extrasEscalada.orgaoPorTarefa.get(l.taskId) ?? null, certidao: identidadeDaCertidao(l), familia: rotuloDaFamilia(l), pais: l.pais,
      pedidoHaDias: pedido ? Math.max(0, diasDeCalendario(pedido, agora)) : null, cobrancas: l.cobrancasSemResposta, canais: semResposta,
    })
    decisoes.push({ ...i, titulo: t.titulo, detalhe: t.detalhe, sugestao: t.sugestao, link: l.processoId != null ? linkDoProcesso(l.processoId) : i.link })
  }

  // ── DIVERGÊNCIA — por tarefa ──────────────────────────────────────────────
  for (const i of divergentes) {
    const l = porTarefa.get(i.tarefaId as number)
    const d = divergencias.find((x) => x.tarefaId === i.tarefaId)
    if (!l) continue
    const t = textosDaDivergencia({
      familia: rotuloDaFamilia(l), certidao: identidadeDaCertidao(l), pais: l.pais,
      statusTarefa: d?.statusTarefa ?? l.statusTarefa, statusPasso: d?.statusPasso ?? '', esperado: d?.esperado ?? null,
    })
    decisoes.push({ ...i, titulo: t.titulo, detalhe: t.detalhe, sugestao: t.sugestao, link: l.processoId != null ? linkDoProcesso(l.processoId) : i.link })
  }

  // ── BLOQUEADA — por tarefa, bloqueada há 10+ dias e esperando o cliente ───
  for (const i of bloqueadas) {
    const l = porTarefa.get(i.tarefaId as number)
    if (!l || l.esperandoDe === 'terceiro') continue // bloqueada esperando o TERCEIRO é Escalada/cobrança, não "esperando o cliente"
    const desde = extrasBloqueada.desde.get(l.taskId) ?? null
    const haDias = desde ? Math.max(0, diasDeCalendario(desde, agora)) : null
    if (!bloqueioPedeDecisao(haDias)) continue
    const t = textosDaBloqueada({
      familia: rotuloDaFamilia(l), certidao: identidadeDaCertidao(l), pais: l.pais, faseLabel: l.faseAtualDoProcessoLabel,
      bloqueadaHaDias: haDias, cobrancasAoCliente: extrasBloqueada.cobrancas.get(l.taskId) ?? 0, motivo: l.motivoBloqueio,
    })
    decisoes.push({ ...i, titulo: t.titulo, detalhe: t.detalhe, sugestao: t.sugestao, link: l.processoId != null ? linkDoProcesso(l.processoId) : i.link })
  }

  // ── CARGA — por pessoa ────────────────────────────────────────────────────
  const idsNoLimite = new Set(noLimite.keys())
  for (const i of cargas) {
    const usuarioId = Number(i.contexto.usuarioId)
    const pessoa = noLimite.get(usuarioId)
    if (!pessoa || !ctx) continue
    const plano = planejarRedistribuicaoDaCarga({ pessoa, linhas, ctx, alvos, noLimite: idsNoLimite })
    const paises = [...new Set(plano.movimentos.map((m) => m.pais).filter((x): x is string => !!x))]
    const destinos = [...new Map(plano.movimentos.map((m) => [m.paraUsuarioId, m.paraNome])).values()]
    const t = textosDaCarga({
      nome: pessoa.nome, executaveis: pessoa.executaveis, limite: pessoa.limite, vencidas: plano.vencidas,
      filaEmSemanas: capacidades.get(usuarioId)?.filaEmSemanas ?? null, mover: plano.movimentos.length,
      paisDasMovidas: paises.length === 1 ? paises[0] : null, destinos,
    })
    decisoes.push({
      ...i, titulo: t.titulo, detalhe: t.detalhe, sugestao: t.sugestao, link: '/torre?aba=equipe',
      acao1: { rotulo: t.rotuloAcao1, acao: 'REDISTRIBUIR_CARGA' }, acao2: { rotulo: 'Ver equipe', acao: 'VER_EQUIPE' },
      contexto: { usuarioId, executaveis: pessoa.executaveis, limite: pessoa.limite, quantidade: plano.movimentos.length, tarefaIds: plano.movimentos.map((m) => m.tarefaId) },
    })
  }

  decisoes.sort((a, b) => b.score - a.score || (ORDEM_DO_TIPO.get(a.tipo) ?? 9) - (ORDEM_DO_TIPO.get(b.tipo) ?? 9)
    || (a.processoId ?? 0) - (b.processoId ?? 0) || (a.tarefaId ?? 0) - (b.tarefaId ?? 0))
  // O limite de cobranças que escala (do cadastro) viaja em cada decisão: a regra escrita no cartão "Escalada" é a verdadeira.
  return { itens: decisoes.map((d) => ({ ...d, contexto: { ...d.contexto, escaladaApos } })), escaladaApos }
}

// ─── BRIEFING DO DIA ────────────────────────────────────────────────────────

/** A saudação pelo relógio de SÃO PAULO, nunca o do servidor (achado real,
 * 30/09/2026: em UTC "23h40 de terça" virava "Bom dia" — o servidor não
 * mora no fuso da operação). Bom dia 5h–12h, boa tarde 12h–18h, boa noite depois. */
function saudacao(agora: Date): string {
  const hora = Number(agora.toLocaleString('en-US', { timeZone: FUSO_OPERACIONAL, hour: 'numeric', hourCycle: 'h23' }))
  if (hora >= 5 && hora < 12) return 'Bom dia'
  if (hora >= 12 && hora < 18) return 'Boa tarde'
  return 'Boa noite'
}

/** Os números do dia que o texto do Briefing cita ALÉM das decisões — todos de leitura real; ausente = a frase correspondente não aparece. */
export interface ExtrasDoBriefing {
  nome?: string | null
  ativos?: number
  noRitmo?: number
  fechadasOntem?: number
  protocoladosOntem?: number
  vencemHoje?: number
}

const juntar = (partes: string[]): string => (partes.length <= 1 ? partes[0] ?? '' : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`)
const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * O TEXTO DO BRIEFING — a estrutura do protótipo ("Bom dia, <nome>. N processos ativos, M no ritmo. Ontem… Hoje vencem… N decisões
 * esperam você: …"), com os números REAIS. O que o sistema não mede (gargalo da semana, cobranças a fazer) não é escrito.
 */
export function briefingDoDia(itens: ItemPrecisaDeVoceTorre[], agora = new Date(), extras: ExtrasDoBriefing = {}): string {
  const dataFmt = agora.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL, weekday: 'long', day: '2-digit', month: 'long' })
  const primeiroNome = extras.nome?.trim().split(/\s+/)[0]
  const abertura = `${saudacao(agora)}${primeiroNome ? `, ${primeiroNome}` : ''}.`
  if (itens.length === 0) return `${abertura} Hoje, ${dataFmt}: nada precisa de você agora.`

  const frases: string[] = [abertura]
  if (extras.ativos != null) frases.push(`${pl(extras.ativos, 'processo ativo', 'processos ativos')}${extras.noRitmo != null ? `, ${extras.noRitmo} no ritmo` : ''}.`)
  if (extras.fechadasOntem != null || extras.protocoladosOntem != null) {
    const partes: string[] = []
    if (extras.fechadasOntem != null) partes.push(`a equipe fechou ${certidoes(extras.fechadasOntem)}`)
    if (extras.protocoladosOntem != null) partes.push(`${pl(extras.protocoladosOntem, 'processo foi protocolado', 'processos foram protocolados')}`)
    frases.push(`Ontem ${partes.join(' e ')}.`)
  }
  if (extras.vencemHoje != null) frases.push(extras.vencemHoje === 1 ? 'Hoje vence 1 prazo.' : `Hoje vencem ${extras.vencemHoje} prazos.`)

  const c = contagemPorTipo(itens)
  const semDono = itens.filter((i) => i.tipo === 'SEM_DONO')
  const detalhes: string[] = []
  if (c.SEM_DONO > 0) {
    const grandes = semDono
      .filter((i) => i.familiaNome)
      .map((i) => ({ familia: i.familiaNome as string, n: Array.isArray(i.contexto.tarefaIds) ? (i.contexto.tarefaIds as number[]).length : 1 }))
      .sort((a, b) => b.n - a.n).slice(0, 2)
    const concentram = grandes.length >= 2
      ? ` (${grandes[0].familia} e ${grandes[1].familia} concentram ${grandes[0].n + grandes[1].n})`
      : grandes.length === 1 ? ` (${grandes[0].familia} concentra ${grandes[0].n})` : ''
    detalhes.push(`${pl(c.SEM_DONO, 'processo com certidões sem responsável', 'processos com certidões sem responsável')}${concentram}`)
  }
  if (c.FASE_DEIXADA > 0) detalhes.push(pl(c.FASE_DEIXADA, 'fase deixada sem próxima ação', 'fases deixadas sem próxima ação'))
  if (c.ESCALADA > 0) detalhes.push(pl(c.ESCALADA, 'cobrança escalada sem resposta', 'cobranças escaladas sem resposta'))
  if (c.DIVERGENCIA > 0) detalhes.push(pl(c.DIVERGENCIA, 'divergência para reconciliar', 'divergências para reconciliar'))
  if (c.BLOQUEADA > 0) detalhes.push(pl(c.BLOQUEADA, 'tarefa bloqueada há 10+ dias', 'tarefas bloqueadas há 10+ dias'))
  if (c.CARGA > 0) {
    const cargas = itens.filter((i) => i.tipo === 'CARGA')
    const maior = cargas.map((i) => ({ nome: i.familiaNome ?? '', ...(i.contexto as { executaveis?: number; limite?: number }) }))
      .filter((x) => x.executaveis != null && x.limite)
      .sort((a, b) => (b.executaveis! / b.limite!) - (a.executaveis! / a.limite!))[0]
    const acima = maior ? ` (${maior.nome} está com ${maior.executaveis} executáveis, ${Math.round((maior.executaveis! / maior.limite! - 1) * 100)}% ${maior.executaveis! >= maior.limite! ? 'acima do' : 'abaixo do'} limite de ${maior.limite})` : ''
    detalhes.push(`${pl(c.CARGA, 'aviso de carga', 'avisos de carga')}${acima}`)
  }
  frases.push(`${itens.length === 1 ? '1 decisão espera' : `${itens.length} decisões esperam`} você: ${juntar(detalhes)}.`)
  return frases.join(' ')
}

// ─── A RESPOSTA DO ENDPOINT, MONTADA EM UM LUGAR ────────────────────────────

export interface RespostaPrecisaDeVoce {
  itens: ItemPrecisaDeVoceTorre[]
  briefing: string
  resumo: { total: number; criticos: number; atencao: number; porTipo: Record<TipoDoPainel, number>; escaladaApos: number }
}

/** Os números do dia do Briefing (processos ativos, no ritmo, fechadas e protocolados de ontem, prazos de hoje). */
async function extrasDoBriefing(base: BaseDoPrecisa, agora: Date, db: Db): Promise<ExtrasDoBriefing> {
  const ontem = diaOperacional(new Date(agora.getTime() - 86_400_000))
  const janela = janelaDoDiaOperacionalDe(ontem)
  const [ativos, fechadas, protocolados] = await Promise.all([
    db.processo.count({ where: { dataConclusao: null, ...ONDE_PROCESSO_NAO_PAUSADO } }),
    db.tarefa.count({
      where: {
        statusTarefa: { in: ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI'] }, dataConclusao: { gte: janela.inicio, lt: janela.fim },
        OR: [{ processoId: null }, { processo: ONDE_PROCESSO_NAO_PAUSADO }],
      },
    }),
    db.phaseAdvanceLog.findMany({
      where: { resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] }, fasePretendida: FASES.PROTOCOLADO.phaseKey, criadoEm: { gte: janela.inicio, lt: janela.fim } },
      select: { processoId: true },
    }),
  ])
  // "No ritmo" = o processo ativo que NÃO tem decisão pendente de atenção ou crítica (o mesmo corte do Radar: score < 3).
  const maxPorProcesso = new Map<number, number>()
  for (const i of base.itens) if (i.processoId != null) maxPorProcesso.set(i.processoId, Math.max(maxPorProcesso.get(i.processoId) ?? 0, i.score))
  const foraDoRitmo = [...maxPorProcesso.values()].filter((sc) => faixaDoScore(sc) !== 'OK').length
  return {
    ativos, noRitmo: Math.max(0, ativos - foraDoRitmo), fechadasOntem: fechadas,
    protocoladosOntem: new Set(protocolados.map((p) => p.processoId)).size,
    vencemHoje: base.linhas.filter((l) => l.venceHoje).length,
  }
}

/**
 * O que `GET /api/torre/precisa-de-voce` devolve. As leituras que a lista e as sugestões compartilham (linhas da Operação,
 * organização) são feitas UMA vez aqui e passadas adiante.
 */
export async function montarPrecisaDeVoce(
  agora = new Date(), db: Db = prisma, opts: { nomeDoUsuario?: string | null } = {},
): Promise<RespostaPrecisaDeVoce> {
  const organizacaoP = lerOrganizacao(agora)
  organizacaoP.catch(() => undefined)
  // As leituras que não dependem das linhas começam já, enquanto a mais lenta (as linhas) é esperada.
  const adiantadas = iniciarLeiturasIndependentes(agora, db, organizacaoP)
  const [organizacao, linhas] = await Promise.all([organizacaoP, lerLinhasOperacionais(agora, db)])
  const base = await lerBaseDoPrecisa({ agora, db, linhas, organizacao, adiantadas })
  const [{ itens, escaladaApos }, extras] = await Promise.all([decisoesDoDia(base, agora, db, organizacao), extrasDoBriefing(base, agora, db)])
  return {
    itens,
    briefing: briefingDoDia(itens, agora, { ...extras, nome: opts.nomeDoUsuario ?? null }),
    resumo: {
      total: itens.length,
      criticos: itens.filter((i) => i.faixa === 'CRITICO').length,
      atencao: itens.filter((i) => i.faixa === 'ATENCAO').length,
      porTipo: contagemPorTipo(itens),
      escaladaApos,
    },
  }
}

/** O nome que a tela mostra de cada tipo — reexportado para quem monta texto no servidor. */
export { ROTULO_DO_TIPO }
