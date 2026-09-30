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
import type { LinhaGerencial } from './tarefa-projecoes'
import { STATUS_ATIVOS } from './tarefa-canonica'
import { FUSO_OPERACIONAL } from './tempo-operacional'
import { conferirCoerenciaPassoTarefa } from '@/src/services/passo-tarefa-projecao'
import { ordensDeFase } from '@/src/services/documento-operacao'
import { lerOrganizacao, unidadesDasTarefas, capacidadeMedidaPorUsuario, rotulosDasUnidades } from './organizacao'
import { equipeExigida } from './elegibilidade'
import { achadosVigentesDaParede } from '@/lib/saude/parede-a-frente'
import { pessoasNoLimite } from './torre-equipe'
import { calcularPermissoes, temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'
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
   * `true` = NINGUÉM tem aptidão cadastrada para esta tarefa (nem a unidade de trabalho, nem a equipe exigida
   * definem quem é apto): o nome é só o de MENOR CARGA entre quem tem permissão de executar — nunca uma aptidão
   * inventada. A tela diz isso com todas as letras.
   */
  fallback?: boolean
  /** As ativas de quem foi sugerido (a carga que decidiu o fallback). */
  ativas?: number
}

/** O que da TAREFA decide quem é apto: a unidade de trabalho e a equipe exigida (ambas do cadastro). */
export interface AlvoDaSugestao {
  unidadeOperacionalId: number | null
  equipeExigida: string | null
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
      select: { id: true, equipeKey: true, workflowStepInstance: { select: { papel: true, equipe: true } } },
    }),
  ])
  const porId = new Map(tarefas.map((t) => [t.id, t]))
  for (const id of tarefaIds) {
    const t = porId.get(id)
    saida.set(id, {
      unidadeOperacionalId: unidades.get(id) ?? null,
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
  }
}

/**
 * A regra pura. QUEM PODE SER SUGERIDO é decidido em camadas — cada uma só TIRA gente, nenhuma inventa aptidão:
 *   1. permissão de executar tarefa (`tarefas.iniciar_concluir`);
 *   2. a EQUIPE exigida pela tarefa, quando ela existe como equipe ativa no cadastro (só membros);
 *   3. a APTIDÃO da unidade de trabalho, quando alguém já foi declarado apto a ela (só os declarados).
 * Se (2) ou (3) definiram quem é apto, o ranking é entre os aptos: menos ativas → empate 30 d → ausente vai
 * para o sucessor sugerido (que também precisa ser apto e estar disponível).
 *
 * Se NENHUMA das duas definiu aptidão, ninguém tem aptidão cadastrada para esta tarefa: a sugestão é um
 * FALLBACK explícito por menor carga, e nunca recai sobre administrador — ser administrador dá todas as
 * permissões, não prova que a pessoa executa este trabalho (achado real, 30/09/2026: "Sugiro Marco Rovatti:
 * 0 ativa(s)" só porque o gestor tinha carga zero). Sem ninguém que execute, não há sugestão (`null`).
 */
export function escolherResponsavel(
  ctx: ContextoDeSugestao, alvo: AlvoDaSugestao | number | null, extraAtivas?: ReadonlyMap<number, number>,
): SugestaoDeResponsavel | null {
  const { unidadeOperacionalId, equipeExigida: exigida }: AlvoDaSugestao =
    alvo != null && typeof alvo === 'object' ? alvo : { unidadeOperacionalId: alvo, equipeExigida: null }
  const { organizacao } = ctx
  const aptidaoEhRegra = unidadeOperacionalId != null && ctx.unidadesComAptidao.has(unidadeOperacionalId)
  const membrosDaEquipe = exigida != null ? ctx.equipes.get(exigida) ?? null : null
  const equipeEhRegra = membrosDaEquipe != null
  // NOME DA UNIDADE — como no protótipo ("apta a Espanha"), nunca só "apto".
  const nomeDaUnidade = aptidaoEhRegra ? ctx.rotulos.get(unidadeOperacionalId!)?.nome ?? null : null
  const semAptidaoCadastrada = !aptidaoEhRegra && !equipeEhRegra

  // DISPONIBILIDADE NÃO É PRÉ-FILTRO AQUI, DE PROPÓSITO: o mandato pede
  // "apto → menos ativas → empate 30 d → AUSENTE vai para o sucessor
  // sugerido" — ausente pode legitimamente vencer o ranking (0 ativas,
  // porque não está recebendo trabalho novo) e só então é redirecionado
  // para quem ele mesmo sugeriu como sucessor (Bloco E2).
  const elegiveis = ctx.usuarios.filter((u) => {
    const permissoes = calcularPermissoes(u.tipo, u.perfil?.permissoes as MapaPermissoes | null, u.permissoesCustom as MapaPermissoes | null)
    if (!temPermissao(permissoes, 'tarefas.iniciar_concluir')) return false
    if (equipeEhRegra && !membrosDaEquipe!.has(u.id)) return false
    const org = organizacao.get(u.id)
    if (aptidaoEhRegra && !(org?.aptidoes ?? []).includes(unidadeOperacionalId!)) return false
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
          ? { fallback: true, motivo: `ninguém com aptidão cadastrada para esta tarefa; menor carga (${c.ativas} ativa(s))` }
          : { motivo: `${c.ativas} ativa(s)${nomeDaUnidade ? `, apto a ${nomeDaUnidade}` : ''}${equipeEhRegra ? `, da equipe ${exigida}` : ''}` }),
      }
    }
    const sucessor = indisponivel.sucessorSugerido
    if (sucessor && idsElegiveis.has(sucessor.usuarioId) && !organizacao.get(sucessor.usuarioId)?.indisponivelPor) {
      return {
        usuarioId: sucessor.usuarioId, nome: sucessor.nome,
        motivo: `${c.nome} está ausente — sucessor sugerido para a carteira.`,
        ...(semAptidaoCadastrada ? { fallback: true } : {}),
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
  const agora = opts.agora ?? new Date()
  const db = opts.db ?? prisma
  const brutas = opts.linhas ?? await lerLinhasOperacionais(agora, db)

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
  const [fasesEspeciais, divergencias, noLimite, achados] = await Promise.all([
    adiantadas.fasesEspeciais,
    lerDivergencias(),
    adiantadas.noLimite,
    adiantadas.achadosDaParede,
  ])
  const tarefasDivergentes = new Set(divergencias.map((d) => d.tarefaId))

  const itens: ItemPrecisaDeVoceTorre[] = []

  for (const l of linhas) {
    const fatores: FatoresDeRisco = {
      semDono: l.responsavelId == null,
      vencida: l.atrasada === true,
      acompanhamentoVencido: l.acompanhamentoVencido === true,
      cobrancasSemRespostaMuitas: (l.cobrancasSemResposta ?? 0) >= 2,
      faseDeixada: (l as unknown as { faseAnteriorAFaseAtual?: boolean }).faseAnteriorAFaseAtual === true,
      divergente: tarefasDivergentes.has(l.taskId),
      bloqueada: l.statusTarefa === 'BLOQUEADA',
      faseApostilamentoOuRetificacao: l.faseMacroKey != null && fasesEspeciais.has(l.faseMacroKey),
    }
    const score = scoreDeRisco(fatores)
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

  // PAREDE À FRENTE — achados CAD-012/WF-004, abertos e não ignorados agora (lidos acima, junto das demais leituras).
  for (const a of achados) {
    const score = 3 // ATENÇÃO — achado preventivo do painel de Saúde, ainda não bloqueou ninguém.
    itens.push({
      tipo: 'PAREDE_A_FRENTE', score, faixa: faixaDoScore(score), tarefaId: null, processoId: null,
      familiaNome: a.registroNome ?? null,
      titulo: a.titulo,
      detalhe: a.descricao,
      sugestao: a.recomendacao ?? null,
      acao1: { rotulo: 'Abrir Gerenciamento', acao: 'ABRIR_GERENCIAMENTO' },
      acao2: { rotulo: 'Ignorar 7 d', acao: 'IGNORAR_7_DIAS' },
      link: a.link ?? '/administrator?screen=syshealth', contexto: { achadoId: a.id, chave: a.chave },
    })
  }

  itens.sort((a, b) => b.score - a.score || a.tipo.localeCompare(b.tipo) || (a.tarefaId ?? 0) - (b.tarefaId ?? 0))
  return itens
}

/** O texto que a tela mostra: com aptidão, "Sugiro X: motivo"; sem aptidão cadastrada, o FALLBACK dito com todas as letras. */
export function textoDaSugestao(s: SugestaoDeResponsavel | null): string {
  if (!s) return 'Nenhum candidato apto e disponível encontrado.'
  if (s.fallback) return `Ninguém com aptidão cadastrada para esta tarefa; sugiro ${s.nome} por menor carga${s.ativas != null ? ` (${s.ativas} ativa(s))` : ''}.`
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
  achadosDaParede: ReturnType<typeof lerAchadosDaParede>
}

export function iniciarLeiturasIndependentes(agora: Date, db: Db, organizacao?: ContextoDeSugestao['organizacao'] | Promise<ContextoDeSugestao['organizacao']>): LeiturasAdiantadas {
  const l: LeiturasAdiantadas = {
    fasesEspeciais: fasesApostilamentoOuRetificacao(db),
    noLimite: Promise.resolve(organizacao).then((org) => pessoasNoLimite(agora, undefined, org)),
    achadosDaParede: lerAchadosDaParede(db, agora),
  }
  // Se quem chamou falhar antes de esperar por elas, a rejeição não vira "não tratada" — quem as espera continua vendo o erro.
  for (const p of Object.values(l)) p.catch(() => undefined)
  return l
}

/** Achados CAD-012/WF-004 abertos e não ignorados agora — a matéria-prima da "Parede à frente". */
async function lerAchadosDaParede(db: Db, agora: Date) {
  // Só o que a verificação de HOJE ainda acusa (ver `lib/saude/parede-a-frente.ts`): o achado antigo de uma
  // verificação já corrigida continua aberto no banco até a Saúde rodar de novo, mas não é decisão do gestor.
  return achadosVigentesDaParede(db, agora)
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

export function briefingDoDia(itens: ItemPrecisaDeVoceTorre[], agora = new Date()): string {
  const criticos = itens.filter((i) => i.faixa === 'CRITICO').length
  const atencao = itens.filter((i) => i.faixa === 'ATENCAO').length
  const semDono = itens.filter((i) => i.tipo === 'SEM_DONO').length
  const escaladas = itens.filter((i) => i.tipo === 'ESCALADA').length
  const bloqueadas = itens.filter((i) => i.tipo === 'BLOQUEADA').length
  const carga = itens.filter((i) => i.tipo === 'CARGA').length
  const parede = itens.filter((i) => i.tipo === 'PAREDE_A_FRENTE').length

  const cumprimento = saudacao(agora)
  const dataFmt = agora.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL, weekday: 'long', day: '2-digit', month: 'long' })
  if (itens.length === 0) return `${cumprimento}. Hoje, ${dataFmt}: nada precisa de você agora.`

  const partes: string[] = []
  if (criticos > 0) partes.push(`${criticos} crítica(s)`)
  if (atencao > 0) partes.push(`${atencao} em atenção`)
  const resumoFaixas = partes.length ? partes.join(' e ') : `${itens.length} decisão(ões)`

  const detalhes: string[] = []
  if (semDono > 0) detalhes.push(`${semDono} sem dono`)
  if (escaladas > 0) detalhes.push(`${escaladas} escalada(s)`)
  if (bloqueadas > 0) detalhes.push(`${bloqueadas} bloqueada(s)`)
  if (carga > 0) detalhes.push(`${carga} pessoa(s) no limite`)
  if (parede > 0) detalhes.push(`${parede} parede(s) à frente`)

  return `${cumprimento}. Hoje, ${dataFmt}: ${resumoFaixas} precisam de você` +
    (detalhes.length ? ` (${detalhes.join(' · ')}).` : '.')
}

// ─── A RESPOSTA DO ENDPOINT, MONTADA EM UM LUGAR ────────────────────────────

export interface RespostaPrecisaDeVoce {
  itens: ItemPrecisaDeVoceTorre[]
  briefing: string
  resumo: { total: number; criticos: number; atencao: number }
}

/**
 * O que `GET /api/torre/precisa-de-voce` devolve. As leituras que a lista e as sugestões
 * compartilham (linhas da Operação, organização) são feitas UMA vez aqui e passadas adiante —
 * o resultado é o mesmo de encadear `itensPrecisaDeVoce` + `comSugestoes` + `briefingDoDia`.
 */
export async function montarPrecisaDeVoce(agora = new Date(), db: Db = prisma): Promise<RespostaPrecisaDeVoce> {
  const organizacaoP = lerOrganizacao(agora)
  organizacaoP.catch(() => undefined)
  // As leituras que não dependem das linhas começam já, enquanto a mais lenta (as linhas) é esperada.
  const adiantadas = iniciarLeiturasIndependentes(agora, db, organizacaoP)
  const [organizacao, linhas] = await Promise.all([organizacaoP, lerLinhasOperacionais(agora, db)])
  const brutos = await itensPrecisaDeVoce({ agora, db, linhas, organizacao, adiantadas })
  const itens = await comSugestoes(brutos, agora, db, { organizacao })
  return {
    itens,
    briefing: briefingDoDia(itens, agora),
    resumo: {
      total: itens.length,
      criticos: itens.filter((i) => i.faixa === 'CRITICO').length,
      atencao: itens.filter((i) => i.faixa === 'ATENCAO').length,
    },
  }
}
