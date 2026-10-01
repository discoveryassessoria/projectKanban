// lib/operacional/regras-torre.ts
// ============================================================================
// AS TRÊS REGRAS DA TORRE — Bloco H3 (30/09/2026). SÓ estas três:
//
//   r1  Atribuição automática por país e fase   — nasce DESLIGADA
//   r2  Régua de cobrança                        — nasce ATIVA (lê o cadastro real)
//   r3  Limite de carga por pessoa               — nasce DESLIGADA
//
// NÃO existe r4 (ausência redireciona carteira: eliminada, Decisão 2 do Passo 0),
// NÃO existe r5 nem "tempo aprendido" (E8: eliminado, Decisão 1).
//
// ─── ONDE FICA O ESTADO ─────────────────────────────────────────────────────
// `ConfiguracaoSistema` (chave/valor, grupo "torre") — a tabela que já guarda a
// configuração global. Nenhuma migration, nenhuma tabela paralela. Ausência de
// linha = o PADRÃO acima (por isso r1/r3 "nascem desligadas" sem ninguém ter que
// gravar nada, e a regra só liga por um ato auditado de quem gere).
//
// ─── O QUE "REGRA DESLIGADA NÃO EXECUTA NADA" SIGNIFICA AQUI ────────────────
// Cada regra tem UM ponto de execução, e é ELE que consulta o estado:
//   r1  → `executarR1`            (atribui de verdade)
//   r3  → `executarR1`            (segura quem já está no limite)
//   r2  → `registrarCobranca`     (reagenda o acompanhamento e liga a escalada)
// Desligada, o ponto de execução devolve sem escrever nada (r1) ou só registra o
// FATO do contato sem mexer em acompanhamento/escalada (r2). A SIMULAÇÃO não
// consulta o estado: ela responde "o que aconteceria com os dados de hoje" tanto
// para regra ligada quanto desligada — e nunca grava.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { STATUS_ATIVOS } from './tarefa-canonica'
import { lerOrganizacao } from './organizacao'
import { cargasComLimite, pessoasNoLimite, type PessoaNoLimite } from './torre-equipe'
import { atribuirTarefa } from './tarefa-comandos'
import { lerLinhasOperacionais } from './avisos-sino'
import { itensPrecisaDeVoce, sugerirResponsavelPrecisaDeVoce } from './precisa-de-voce'
import { lerVersaoPublicada } from '@/src/services/versao-publicada'

type Db = typeof prisma | Prisma.TransactionClient

export const CHAVES_REGRA = ['r1', 'r2', 'r3'] as const
export type ChaveRegra = (typeof CHAVES_REGRA)[number]

/** O PADRÃO de cada regra quando nada foi gravado. Decisão do mandato H3. */
export const PADRAO_REGRA: Record<ChaveRegra, boolean> = { r1: false, r2: true, r3: false }

export const NOME_REGRA: Record<ChaveRegra, string> = {
  r1: 'Atribuição automática por país e fase',
  r2: 'Régua de cobrança',
  r3: 'Limite de carga por pessoa',
}

const GRUPO = 'torre'
const chaveConfig = (k: ChaveRegra) => `torre.regra.${k}`
export const ehChaveRegra = (k: string): k is ChaveRegra => (CHAVES_REGRA as readonly string[]).includes(k)

export interface EstadoDaRegra {
  chave: ChaveRegra
  nome: string
  ativa: boolean
  /** `true` = ninguém nunca gravou: vale o padrão. */
  padrao: boolean
  atualizadoEm: string | null
  atualizadoPorId: number | null
}

export async function lerRegras(db: Db = prisma): Promise<EstadoDaRegra[]> {
  const linhas = await db.configuracaoSistema.findMany({
    where: { chave: { in: CHAVES_REGRA.map(chaveConfig) } },
    select: { chave: true, valor: true, atualizadoEm: true, atualizadoPor: true },
  })
  const porChave = new Map(linhas.map((l) => [l.chave, l]))
  return CHAVES_REGRA.map((k) => {
    const l = porChave.get(chaveConfig(k))
    return {
      chave: k, nome: NOME_REGRA[k],
      ativa: l ? l.valor === '1' : PADRAO_REGRA[k],
      padrao: !l,
      atualizadoEm: l?.atualizadoEm.toISOString() ?? null,
      atualizadoPorId: l?.atualizadoPor ?? null,
    }
  })
}

export async function regraAtiva(chave: ChaveRegra, db: Db = prisma): Promise<boolean> {
  const l = await db.configuracaoSistema.findUnique({ where: { chave: chaveConfig(chave) }, select: { valor: true } })
  return l ? l.valor === '1' : PADRAO_REGRA[chave]
}

/** Ativar / desativar — SEMPRE auditado (quem, quando, antes → depois). */
export async function definirRegra(
  chave: ChaveRegra, ativa: boolean, autorId: number,
): Promise<{ ok: true; mudou: boolean; ativa: boolean } | { ok: false; erro: string }> {
  if (!ehChaveRegra(chave)) return { ok: false, erro: `regra desconhecida: ${chave}` }
  return prisma.$transaction(async (tx) => {
    const antes = await regraAtiva(chave, tx)
    if (antes === ativa) return { ok: true as const, mudou: false, ativa }
    await tx.configuracaoSistema.upsert({
      where: { chave: chaveConfig(chave) },
      create: { chave: chaveConfig(chave), valor: ativa ? '1' : '0', grupo: GRUPO, atualizadoPor: autorId },
      update: { valor: ativa ? '1' : '0', atualizadoPor: autorId },
    })
    await tx.logAuditoria.create({
      data: {
        acao: ativa ? 'REGRA_TORRE_ATIVADA' : 'REGRA_TORRE_DESATIVADA', entidade: 'RegraTorre', entidadeId: null, usuarioId: autorId,
        descricao: `Regra ${chave} "${NOME_REGRA[chave]}" ${ativa ? 'ATIVADA' : 'DESATIVADA'} (era ${antes ? 'ativa' : 'inativa'}).`,
        detalhes: { chave, de: antes, para: ativa },
      },
    })
    return { ok: true as const, mudou: true, ativa }
  })
}

// ─── A RÉGUA (r2): O TEXTO VEM DO CADASTRO, NUNCA DE NÚMERO FIXO ───────────

export interface LinhaDaRegua {
  workflow: string
  passoKey: string
  passo: string
  diasParaIniciar: number | null
  diasAposCobranca: number | null
  escalarApos: number | null
  /** Esperas de subtarefa cadastradas (acompanhamento / previsão do terceiro) — texto pronto. */
  esperas: string[]
}

/**
 * A régua como o CADASTRO PUBLICADO a define: a versão vigente de cada workflow
 * ativo (o mesmo snapshot congelado que o motor lê em `definicaoHistoricaDoPasso`),
 * nunca a definição viva em rascunho. Só entram passos que declaram algum dos
 * três parâmetros ou alguma espera.
 */
export async function lerReguaDeCobranca(db: Db = prisma): Promise<LinhaDaRegua[]> {
  const workflows = await db.phaseInternalWorkflow.findMany({
    where: { active: true, arquivado: false }, select: { id: true, name: true, versao: true }, orderBy: { id: 'asc' },
  })
  const linhas: LinhaDaRegua[] = []
  for (const wf of workflows) {
    const v = await lerVersaoPublicada(wf.id, wf.versao, db as typeof prisma)
    if (!v) continue
    for (const p of v.passos) {
      const esperas: string[] = []
      for (const s of p.subtarefas ?? []) {
        if (s.ativo === false) continue
        if (s.acompanhamentoAtivo && s.acompanhamentoPrimeiroDias != null) esperas.push(`${s.label}: acompanhar em ${s.acompanhamentoPrimeiroDias} d`)
        if (s.regraTemporalAtiva && s.regraTemporalDias != null) esperas.push(`${s.label}: previsão do terceiro ${s.regraTemporalDias} d`)
      }
      if (p.diasParaIniciar == null && p.diasAposCobranca == null && p.escalarApos == null && esperas.length === 0) continue
      linhas.push({
        workflow: wf.name, passoKey: p.key, passo: p.label,
        diasParaIniciar: p.diasParaIniciar, diasAposCobranca: p.diasAposCobranca, escalarApos: p.escalarApos, esperas,
      })
    }
  }
  return linhas
}

/** A régua num fôlego só, sem repetir o mesmo par: "cobrar a cada 1 d · escalar na 2ª sem resposta". */
export function reguaResumida(linhas: LinhaDaRegua[]): string {
  const vistos = new Set<string>()
  for (const l of linhas) {
    const partes: string[] = []
    if (l.diasAposCobranca != null) partes.push(`cobrar a cada ${l.diasAposCobranca} d`)
    if (l.escalarApos != null) partes.push(`escalar na ${l.escalarApos}ª sem resposta`)
    if (partes.length) vistos.add(partes.join(' · '))
  }
  return vistos.size ? [...vistos].join(' | ') : 'sem régua de cobrança cadastrada'
}

/**
 * O texto da régua, COMPACTO: passos com os mesmos parâmetros viram UMA frase ("… em: Solicitar
 * certidão, Emitir certidão retificada, +5"), e as esperas de subtarefa aparecem uma vez cada.
 * Em produção há ~11 passos com a mesma régua — repeti-los um a um enterraria a informação.
 */
export function textoDaRegua(linhas: LinhaDaRegua[]): string {
  if (linhas.length === 0) return 'Nenhum passo publicado declara régua de cobrança no Gerenciamento.'
  const grupos = new Map<string, Set<string>>()
  const esperas = new Set<string>()
  for (const l of linhas) {
    const partes: string[] = []
    if (l.diasParaIniciar != null) partes.push(`iniciar em ${l.diasParaIniciar} d`)
    if (l.diasAposCobranca != null) partes.push(`cobrar a cada ${l.diasAposCobranca} d`)
    if (l.escalarApos != null) partes.push(`escalar na ${l.escalarApos}ª sem resposta`)
    if (partes.length) {
      const chave = partes.join(' · ')
      if (!grupos.has(chave)) grupos.set(chave, new Set())
      grupos.get(chave)!.add(l.passo)
    }
    for (const e of l.esperas) esperas.add(e)
  }
  const lista = (nomes: string[]) => (nomes.length <= 3 ? nomes.join(', ') : `${nomes.slice(0, 3).join(', ')}, +${nomes.length - 3}`)
  const blocos = [...grupos].map(([chave, passos]) => `${chave} (nos passos: ${lista([...passos])})`)
  if (esperas.size) blocos.push(`esperas: ${[...esperas].join('; ')}`)
  return blocos.join(' | ')
}

// ─── r1 (+ r3): O PLANO E A EXECUÇÃO ────────────────────────────────────────

export interface PropostaDeAtribuicao {
  tarefaId: number
  titulo: string
  paraId: number | null
  paraNome: string | null
  motivo: string
  /** `true` = seria atribuída; `false` = fica sem dono (sem apto, ou segurada por r3). */
  atribui: boolean
  seguradaPorLimite: boolean
  /**
   * `true` = NENHUM candidato com aptidão COMPROVADA (unidade com aptidão cadastrada ou equipe exigida que existe).
   * A sugestão manual pode mostrar o fallback por menor carga a um humano; a regra automática NUNCA o usa.
   * A tarefa continua sem dono e aparecendo em "Precisa de você".
   */
  semApto: boolean
}

/** O motivo gravado no plano/simulação quando a r1 não encontra apto (mesma regra da sugestão: só atribui a quem tem aptidão). */
export const MOTIVO_SEM_APTO = 'sem apto — fica no Precisa de você'

/**
 * O PLANO DA r1: para cada tarefa SEM DONO que o "Precisa de você" lista (mesma
 * fonte — nada recalculado), quem a regra de atribuição sugeriria. `respeitarR3`
 * segura quem já está no limite (e vai somando na memória, para o plano de um lote
 * não estourar o limite de ninguém no meio). NÃO grava nada.
 */
export async function planoDaR1(agora = new Date(), respeitarR3: boolean): Promise<PropostaDeAtribuicao[]> {
  const itens = (await itensPrecisaDeVoce({ agora })).filter((i) => i.tipo === 'SEM_DONO' && i.tarefaId != null)
  // Só lê a carga quando r3 vale: desligada, o limite não interfere em nada.
  const cargas = respeitarR3 ? await cargasComLimite(agora) : new Map<number, PessoaNoLimite>()
  const plano: PropostaDeAtribuicao[] = []
  // O que este plano JÁ distribuiu: entra no ranking da próxima tarefa (balanceia como a execução sequencial).
  const jaDistribuido = new Map<number, number>()
  for (const it of itens) {
    const tarefaId = it.tarefaId as number
    const s = await sugerirResponsavelPrecisaDeVoce(tarefaId, agora, prisma, jaDistribuido)
    // Sem sugestão, ou só o FALLBACK (sem aptidão cadastrada): a regra automática não atribui a quem não é apto.
    if (!s || s.fallback) {
      plano.push({ tarefaId, titulo: it.titulo, paraId: null, paraNome: null, motivo: MOTIVO_SEM_APTO, atribui: false, seguradaPorLimite: false, semApto: true })
      continue
    }
    const c = cargas.get(s.usuarioId)
    if (c && c.executaveis >= c.limite) {
      plano.push({
        tarefaId, titulo: it.titulo, paraId: s.usuarioId, paraNome: s.nome,
        motivo: `${s.nome} está no limite (${c.executaveis}/${c.limite}) — segurada para decisão em "Precisa de você"`,
        atribui: false, seguradaPorLimite: true, semApto: false,
      })
      continue
    }
    // Quem ainda cabe recebe UMA a mais na memória: o plano de um lote não pode estourar o limite de ninguém no meio.
    if (c) c.executaveis++
    jaDistribuido.set(s.usuarioId, (jaDistribuido.get(s.usuarioId) ?? 0) + 1)
    plano.push({ tarefaId, titulo: it.titulo, paraId: s.usuarioId, paraNome: s.nome, motivo: s.motivo, atribui: true, seguradaPorLimite: false, semApto: false })
  }
  return plano
}

export type ResultadoR1 =
  | { executou: false; motivo: 'REGRA_DESLIGADA' }
  | { executou: true; atribuidas: number; seguradas: number; semApto: number; falhas: number; itens: Array<{ tarefaId: number; ok: boolean; para?: string; mensagem?: string }> }

/**
 * EXECUTA A r1. É AQUI que "regra desligada não executa nada" é garantido:
 * a primeira linha lê o estado e, desligada, devolve sem sequer calcular o plano.
 * `autorId = null` = execução do sistema (cron).
 */
export async function executarR1(autorId: number | null, agora = new Date()): Promise<ResultadoR1> {
  if (!(await regraAtiva('r1'))) return { executou: false, motivo: 'REGRA_DESLIGADA' }
  const respeitarR3 = await regraAtiva('r3')
  const plano = await planoDaR1(agora, respeitarR3)
  const itens: Array<{ tarefaId: number; ok: boolean; para?: string; mensagem?: string }> = []
  let atribuidas = 0, seguradas = 0, semApto = 0, falhas = 0
  for (const p of plano) {
    if (!p.atribui || p.paraId == null) { if (p.seguradaPorLimite) seguradas++; else if (p.semApto) semApto++; continue }
    const r = await atribuirTarefa({
      tarefaId: p.tarefaId, responsavelId: p.paraId, autorId,
      motivo: `auto-atribuição (regra r1): ${p.motivo}`,
    })
    if (r.ok) { atribuidas++; itens.push({ tarefaId: p.tarefaId, ok: true, para: p.paraNome ?? undefined }) }
    else { falhas++; itens.push({ tarefaId: p.tarefaId, ok: false, mensagem: r.mensagem }) }
  }
  await prisma.logAuditoria.create({
    data: {
      acao: 'REGRA_TORRE_EXECUTADA', entidade: 'RegraTorre', entidadeId: null, usuarioId: autorId ?? undefined,
      descricao: `Regra r1 executada: ${atribuidas} atribuída(s), ${seguradas} segurada(s) pelo limite (r3), ${semApto} sem apto (ficam no "Precisa de você"), ${falhas} falha(s).`,
      detalhes: { chave: 'r1', respeitouR3: respeitarR3, atribuidas, seguradas, semApto, falhas, itens } as unknown as Prisma.InputJsonValue,
    },
  })
  return { executou: true, atribuidas, seguradas, semApto, falhas, itens }
}

// ─── SIMULAÇÃO — SÓ LEITURA, NUNCA GRAVA ────────────────────────────────────

export interface Simulacao {
  chave: ChaveRegra
  titulo: string
  /** A regra está ligada AGORA? (a simulação responde igual nos dois casos). */
  ativaAgora: boolean
  texto: string
  numeros: Record<string, number>
  itens: Array<{ tarefaId: number | null; texto: string }>
}

export async function simularRegra(chave: ChaveRegra, agora = new Date()): Promise<Simulacao> {
  const ativaAgora = await regraAtiva(chave)
  if (chave === 'r1') {
    // Simula respeitando r3 SE r3 estiver ligada (é assim que rodaria de verdade).
    const plano = await planoDaR1(agora, await regraAtiva('r3'))
    const atribuiria = plano.filter((p) => p.atribui)
    const seguradas = plano.filter((p) => p.seguradaPorLimite)
    const semApto = plano.filter((p) => p.semApto)
    const porPessoa = new Map<string, number>()
    for (const p of atribuiria) porPessoa.set(p.paraNome as string, (porPessoa.get(p.paraNome as string) ?? 0) + 1)
    const dist = [...porPessoa.entries()].map(([n, q]) => `${q} para ${n}`).join('; ')
    return {
      chave, titulo: NOME_REGRA.r1, ativaAgora,
      texto: plano.length === 0
        ? 'Hoje: nenhuma tarefa aberta está sem dono — a regra não teria o que atribuir.'
        : `Hoje: ${atribuiria.length} tarefa(s) sem dono seriam atribuídas${dist ? ` (${dist})` : ''}` +
          `${seguradas.length ? `; ${seguradas.length} ficariam seguradas pelo limite de carga` : ''}` +
          `${semApto.length ? `; ${semApto.length} seguradas por falta de apto (continuam em "Precisa de você")` : ''}.`,
      numeros: { semDono: plano.length, atribuiria: atribuiria.length, seguradas: seguradas.length, semApto: semApto.length },
      itens: plano.map((p) => ({ tarefaId: p.tarefaId, texto: `${p.titulo} → ${p.paraNome ?? 'Sem responsável'} (${p.motivo})` })),
    }
  }
  if (chave === 'r3') {
    const noLimite = [...(await pessoasNoLimite(agora)).values()]
    const organizacao = await lerOrganizacao(agora)
    const comLimite = [...organizacao.values()].filter((o) => o.limiteExecutaveis != null).length
    const plano = noLimite.length ? await planoDaR1(agora, true) : []
    const seguradas = plano.filter((p) => p.seguradaPorLimite)
    return {
      chave, titulo: NOME_REGRA.r3, ativaAgora,
      texto: comLimite === 0
        ? 'Nenhuma pessoa tem limite de carga cadastrado (Gerenciamento › Capacidade Operacional) — a regra não teria o que aplicar.'
        : noLimite.length === 0
          ? `Hoje: ${comLimite} pessoa(s) com limite cadastrado e nenhuma no limite — nenhuma atribuição seria segurada.`
          : `Hoje: ${noLimite.map((n) => `${n.nome} em ${n.executaveis}/${n.limite}`).join(', ')}. ` +
            `${seguradas.length} tarefa(s) sem dono cairiam em "Precisa de você" em vez de serem atribuídas automaticamente.`,
      numeros: { comLimite, noLimite: noLimite.length, seguradas: seguradas.length },
      itens: [
        ...noLimite.map((n) => ({ tarefaId: null, texto: `${n.nome}: ${n.executaveis} executáveis de ${n.limite}` })),
        ...seguradas.map((s) => ({ tarefaId: s.tarefaId, texto: `${s.titulo} — ${s.motivo}` })),
      ],
    }
  }
  // r2 — aplica a régua do cadastro às solicitações abertas de hoje.
  const regua = await lerReguaDeCobranca()
  const linhas = (await lerLinhasOperacionais(agora)).filter((l) => STATUS_ATIVOS.includes(l.statusTarefa) && l.estadoOperacao === 'AGUARDANDO')
  const vencidas = linhas.filter((l) => l.acompanhamentoVencido)
  const escaladas = linhas.filter((l) => l.escalada)
  return {
    chave, titulo: NOME_REGRA.r2, ativaAgora,
    texto: `Régua do cadastro — ${textoDaRegua(regua)}. Aplicada às ${linhas.length} solicitação(ões) aguardando terceiro hoje: ` +
      `${vencidas.length} com acompanhamento vencido, ${escaladas.length} já escalada(s).`,
    numeros: { aguardando: linhas.length, acompanhamentoVencido: vencidas.length, escaladas: escaladas.length, passosComRegua: regua.length },
    itens: vencidas.map((l) => ({ tarefaId: l.taskId, texto: `${l.titulo} — acompanhamento vencido${l.escalada ? ', escalada' : ''}` })),
  }
}
