// lib/operacional/avisos-sino.ts
// ============================================================================
// OS FATOS DO SINO — redesenho de 29/09/2026.
//
// Aqui mora a REGRA de quando um aviso nasce; a ESCRITA mora em
// `notificacao-canonica.ts` (`somarAoAviso` / `gravarFotoDoAviso`). Nenhuma função
// daqui escreve Tarefa, workflow, prazo, fase ou histórico: aviso é consequência.
//
// ─── OPERADOR: TRÊS TIPOS, SEMPRE POR (PESSOA, FAMÍLIA) ─────────────────────
//   CHEGOU_TRABALHO  o gestor atribuiu            → `avisarChegouTrabalho`
//   MUDOU_DE_MAO     o gestor removeu/reatribuiu  → `avisarMudouDeMao`
//   PRECISA_AGIR     resumo do dia, 07:00         → `avaliarPrecisaAgir`
// Os avisos por tarefa (PRAZO/HOJE/ATRASO/ACOMPANHAMENTO_VENCIDO/RETORNO_TERCEIRO/
// EM_RISCO/TERCEIRO_ATRASADO) deixaram de existir para o operador: viraram parte do
// PRECISA_AGIR ("vencidas · vencem hoje · vencem amanhã · cobranças a fazer").
//
// ─── GESTOR: UMA LISTA, UMA FUNÇÃO ──────────────────────────────────────────
// `precisaDeVoce` é a fonte ÚNICA do que exige decisão do Administrador (2ª cobrança
// sem resposta, tarefa sem dono há mais de 1 dia, incidente crítico de integridade).
// O sino do gestor a consome; o "Precisa de você" da Torre deve consumir a MESMA
// função — nunca uma segunda definição de "exige decisão".
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { STATUS_TERMINAIS } from './tarefa-canonica'
import { diaOperacional, estadoTemporal } from './tempo-operacional'
import { visaoGerencial, type LinhaGerencial } from './tarefa-projecoes'
import { semFaseFutura } from './fase-futura'
import { motivosAtivos } from './atencao-operacional'
import { urlOperacaoDaFamilia, urlVisaoGlobalDaFamilia, LINK_SEM_RESPONSAVEL_NA_TORRE, urlDaSaudeDoSistema } from './navegacao'
import {
  gravarFotoDoAviso, sincronizarAvisosDeTarefas, expurgarAvisos, removerAviso,
  rotuloDaFamilia, SELECT_ROTULO_FAMILIA,
  type ResumoDoAviso,
} from './notificacao-canonica'
import { novosDoResumo } from './aviso-texto'

type Db = typeof prisma | Prisma.TransactionClient

export { avisarChegouTrabalho, avisarMudouDeMao, aoMudarDeDono } from './avisos-fatos'

// ═══════════════════════════════════════════════════════════════════════════
// A LEITURA OPERACIONAL — uma varredura, dois consumidores
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TODAS as linhas operacionais abertas (a MESMA projeção da Minha Operação), lidas uma
 * vez por rodada. Tarefa administrativa (obrigação de distribuir) fica de fora: ela é do
 * gestor e tem o próprio aviso (SEM_RESPONSAVEL).
 */
export async function lerLinhasOperacionais(agora: Date, db: Db = prisma): Promise<LinhaGerencial[]> {
  const todas: LinhaGerencial[] = []
  const porPagina = 500
  for (let pagina = 1; ; pagina++) {
    const { linhas, total } = await visaoGerencial({ pagina, porPagina }, agora, db)
    const admin = linhas.length
      ? await db.tarefa.findMany({
          where: { id: { in: linhas.map((l) => l.taskId) }, tipo: 'ADMINISTRATIVA' },
          select: { id: true },
        })
      : []
    const ids = new Set(admin.map((a) => a.id))
    // Tarefa de FASE FUTURA não gera aviso (regra única — `fase-futura.ts`).
    for (const l of semFaseFutura(linhas)) if (!ids.has(l.taskId)) todas.push(l)
    if (pagina * porPagina >= total) break
  }
  return todas
}

// ═══════════════════════════════════════════════════════════════════════════
// PRECISA_AGIR — resumo do dia
// ═══════════════════════════════════════════════════════════════════════════

export interface GrupoPrecisaAgir {
  destinatarioId: number
  processoId: number | null
  familiaNome: string | null
  vencidas: number[]
  hoje: number[]
  amanha: number[]
  cobrancas: number[]
}

/**
 * O QUE CADA PESSOA TEM PARA FAZER, por família — derivado das linhas da Operação:
 *   vencidas   prazo final da tarefa já passou
 *   hoje       vence hoje
 *   amanhã     vence amanhã
 *   cobranças  acompanhamento devido, terceiro atrasado ou retorno recebido
 * Só o responsável ATUAL (linha sem responsável não entra: é da lista do gestor).
 */
export function agruparPrecisaAgir(linhas: LinhaGerencial[], agora: Date): GrupoPrecisaAgir[] {
  const grupos = new Map<string, GrupoPrecisaAgir>()
  for (const l of linhas) {
    if (l.responsavelId == null) continue
    const tempo = l.dataPrazo
      ? estadoTemporal({ dataPrazo: new Date(l.dataPrazo), dataConclusao: null, statusTarefa: l.statusTarefa, agora })
      : null
    const vencida = l.atrasada === true
    const hoje = !vencida && tempo?.venceHoje === true
    const amanha = !vencida && !hoje && tempo?.venceAmanha === true
    const motivos = motivosAtivos(l)
    const cobranca = motivos.includes('ACOMPANHAMENTO_DEVIDO') || motivos.includes('TERCEIRO_ATRASADO') || l.retornoRecebido === true
    if (!vencida && !hoje && !amanha && !cobranca) continue

    const chave = `${l.responsavelId}|${l.processoId ?? 0}`
    let g = grupos.get(chave)
    if (!g) {
      g = {
        destinatarioId: l.responsavelId, processoId: l.processoId,
        familiaNome: l.familiaNome ?? l.processoNome ?? null,
        vencidas: [], hoje: [], amanha: [], cobrancas: [],
      }
      grupos.set(chave, g)
    }
    if (vencida) g.vencidas.push(l.taskId)
    if (hoje) g.hoje.push(l.taskId)
    if (amanha) g.amanha.push(l.taskId)
    if (cobranca) g.cobrancas.push(l.taskId)
  }
  return [...grupos.values()]
}

export type ModoDaVarredura = 'FOTO' | 'INCREMENTAL'

export interface RelatorioPrecisaAgir {
  modo: ModoDaVarredura
  ensaio: boolean
  grupos: number
  criados: number
  atualizados: number
  removidos: number
  semMudanca: number
  /** No ensaio: o que seria gravado. */
  previa: Array<{ destinatarioId: number; processoId: number | null; familia: string | null; vencidas: number; hoje: number; amanha: number; cobrancas: number; acao: string }>
}

const sv = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b)

/**
 * O PRECISA_AGIR de UMA (pessoa, família), dado o que ela tem hoje. Decide entre:
 *   • há aviso ABERTO  → atualiza NO LUGAR (FOTO recompõe tudo; INCREMENTAL preserva o
 *     modo "só o que é novo" do aviso aberto);
 *   • ela já clicou    → FOTO (07:00) recompõe a foto do dia se o último clique foi de
 *     outro dia; INCREMENTAL só abre aviso se há FATO NOVO (nova vencida, nova
 *     cobrança) em relação ao que ela viu no clique — e o texto diz o que é novo;
 *   • nunca houve aviso → FOTO cria; INCREMENTAL espera as 07:00 (quem acabou de
 *     receber trabalho já tem o CHEGOU_TRABALHO).
 */
async function decidirPrecisaAgir(
  db: Db, g: GrupoPrecisaAgir, modo: ModoDaVarredura, agora: Date, ensaio: boolean,
): Promise<{ acao: string; id: number | null }> {
  const base: ResumoDoAviso = {
    vencidas: sv(g.vencidas), hoje: sv(g.hoje), amanha: sv(g.amanha), cobrancas: sv(g.cobrancas),
  }
  const chaveAviso = { destinatarioId: g.destinatarioId, processoId: g.processoId, tipo: 'PRECISA_AGIR', agrupado: true }

  const aberto = await db.notificacaoOperacional.findFirst({
    where: { ...chaveAviso, lidaEm: null }, select: { id: true, resumo: true },
  })
  const foto = (resumo: ResumoDoAviso) => ({
    tipo: 'PRECISA_AGIR' as const, destinatarioId: g.destinatarioId, processoId: g.processoId,
    familiaNome: g.familiaNome, resumo, link: urlOperacaoDaFamilia(g.processoId, 'acompanhamento'),
  })
  const gravar = async (resumo: ResumoDoAviso, previa: string) => {
    if (ensaio) return { acao: previa, id: aberto?.id ?? null }
    const r = await gravarFotoDoAviso(db, foto(resumo))
    return { acao: r.acao, id: r.id }
  }

  if (aberto) {
    const atual = (aberto.resumo ?? {}) as ResumoDoAviso
    if (modo === 'INCREMENTAL' && atual.modo === 'NOVOS') {
      return gravar({ ...base, modo: 'NOVOS', base: atual.base ?? { vencidas: [], cobrancas: [] } }, 'ATUALIZADO')
    }
    return gravar({ ...base, modo: 'FOTO' }, 'ATUALIZADO')
  }

  const ultimoLido = await db.notificacaoOperacional.findFirst({
    where: { ...chaveAviso, lidaEm: { not: null } }, orderBy: { lidaEm: 'desc' }, select: { lidaEm: true, resumo: true },
  })

  if (modo === 'FOTO' && (!ultimoLido || diaOperacional(ultimoLido.lidaEm!) !== diaOperacional(agora))) {
    return gravar({ ...base, modo: 'FOTO' }, 'CRIADO')
  }
  if (!ultimoLido) return { acao: 'NADA', id: null }

  // FATO NOVO em relação ao que ela viu no último clique.
  const visto = (ultimoLido.resumo ?? {}) as ResumoDoAviso
  const vistoAntes = {
    vencidas: sv([...(visto.vencidas ?? []), ...(visto.base?.vencidas ?? [])]),
    cobrancas: sv([...(visto.cobrancas ?? []), ...(visto.base?.cobrancas ?? [])]),
  }
  const candidato: ResumoDoAviso = { ...base, modo: 'NOVOS', base: vistoAntes }
  const nv = novosDoResumo(candidato)
  if (nv.vencidas.length + nv.cobrancas.length === 0) return { acao: 'NADA', id: null }
  return gravar(candidato, 'CRIADO')
}

/**
 * A VARREDURA DO PRECISA_AGIR. `FOTO` = as 07:00 (recompõe a foto do dia);
 * `INCREMENTAL` = de hora em hora (só atualiza aviso aberto e abre aviso por FATO NOVO).
 * O que a pessoa já não tem mais (foto vazia) tem o aviso aberto removido.
 */
export async function avaliarPrecisaAgir(
  opts: { agora?: Date; modo: ModoDaVarredura; ensaio?: boolean; linhas?: LinhaGerencial[]; db?: Db },
): Promise<RelatorioPrecisaAgir> {
  const agora = opts.agora ?? new Date()
  const db = opts.db ?? prisma
  const ensaio = opts.ensaio === true
  const linhas = opts.linhas ?? await lerLinhasOperacionais(agora, db)
  const grupos = agruparPrecisaAgir(linhas, agora)

  const r: RelatorioPrecisaAgir = {
    modo: opts.modo, ensaio, grupos: grupos.length, criados: 0, atualizados: 0, removidos: 0, semMudanca: 0, previa: [],
  }
  const conta = (acao: string) => {
    if (acao === 'CRIADO') r.criados++
    else if (acao === 'ATUALIZADO') r.atualizados++
    else if (acao === 'REMOVIDO') r.removidos++
    else if (acao === 'SEM_MUDANCA') r.semMudanca++
  }

  const vivos = new Set<string>()
  for (const g of grupos) {
    vivos.add(`${g.destinatarioId}|${g.processoId ?? 0}`)
    const { acao } = await decidirPrecisaAgir(db, g, opts.modo, agora, ensaio)
    conta(acao)
    if (ensaio) {
      r.previa.push({
        destinatarioId: g.destinatarioId, processoId: g.processoId, familia: g.familiaNome,
        vencidas: g.vencidas.length, hoje: g.hoje.length, amanha: g.amanha.length, cobrancas: g.cobrancas.length, acao,
      })
    }
  }

  // Aviso aberto de quem já não tem nada nesta família: some.
  const abertos = await db.notificacaoOperacional.findMany({
    where: { tipo: 'PRECISA_AGIR', agrupado: true, lidaEm: null },
    select: { id: true, destinatarioId: true, processoId: true },
  })
  for (const a of abertos) {
    if (vivos.has(`${a.destinatarioId}|${a.processoId ?? 0}`)) continue
    if (!ensaio) await removerAviso(db, a.id)
    r.removidos++
  }
  return r
}

// ═══════════════════════════════════════════════════════════════════════════
// GESTOR — "Precisa de você"
// ═══════════════════════════════════════════════════════════════════════════

export type TipoPrecisaDeVoce = 'ESCALADA' | 'SEM_RESPONSAVEL' | 'INTEGRIDADE'

export interface ItemPrecisaDeVoce {
  tipo: TipoPrecisaDeVoce
  processoId: number | null
  /** `null` = não é de uma família (INTEGRIDADE do sistema). */
  familiaNome: string | null
  tarefaIds: number[]
  /** Fatos que não são tarefa (alerta de integridade) — chave estável de cada um. */
  itens: string[]
  link: string
}

/** Tarefa aberta sem dono há mais de 1 dia. */
export const DIAS_SEM_DONO_PARA_ALERTAR = 1

/**
 * "PRECISA DE VOCÊ" — a FUNÇÃO ÚNICA do que exige decisão do Administrador, por família:
 *   ESCALADA         a 2ª cobrança ficou sem resposta (`LinhaGerencial.escalada`, o mesmo
 *                    dado que a Operação mostra — nunca uma segunda contagem)
 *   SEM_RESPONSAVEL  tarefa aberta sem dono há mais de 1 dia (desde a criação ou desde a
 *                    última devolução à fila, o que for mais recente)
 *   INTEGRIDADE      incidente CRÍTICO confirmado pela última rodada da Saúde do Sistema
 * Reutilizável: o sino do gestor (`avisarGestores`) e o "Precisa de você" da Torre
 * chamam esta mesma função. Só lê.
 */
export async function precisaDeVoce(
  opts: { agora?: Date; linhas?: LinhaGerencial[]; db?: Db } = {},
): Promise<ItemPrecisaDeVoce[]> {
  const agora = opts.agora ?? new Date()
  const db = opts.db ?? prisma
  const itens: ItemPrecisaDeVoce[] = []

  // ── ESCALADA ────────────────────────────────────────────────────────────
  const linhas = opts.linhas ?? await lerLinhasOperacionais(agora, db)
  const escaladas = new Map<number | null, { nome: string | null; ids: number[] }>()
  for (const l of linhas) {
    if (!l.escalada) continue
    const g = escaladas.get(l.processoId) ?? { nome: l.familiaNome ?? l.processoNome ?? null, ids: [] }
    g.ids.push(l.taskId)
    escaladas.set(l.processoId, g)
  }
  for (const [processoId, g] of escaladas) {
    itens.push({
      tipo: 'ESCALADA', processoId, familiaNome: g.nome, tarefaIds: sv(g.ids), itens: [],
      link: processoId != null ? urlVisaoGlobalDaFamilia(processoId) : '/tarefas',
    })
  }

  // ── SEM_RESPONSAVEL ─────────────────────────────────────────────────────
  const limite = new Date(agora.getTime() - DIAS_SEM_DONO_PARA_ALERTAR * 86_400_000)
  const semDono = await db.tarefa.findMany({
    where: { responsavelId: null, statusTarefa: { notIn: STATUS_TERMINAIS }, tipo: { not: 'ADMINISTRATIVA' }, createdAt: { lt: limite } },
    select: { id: true, processoId: true, processo: SELECT_ROTULO_FAMILIA },
  })
  if (semDono.length) {
    const devolvidas = await db.logAuditoria.groupBy({
      by: ['entidadeId'], where: { acao: 'TAREFA_DEVOLVIDA_A_FILA', entidade: 'Tarefa', entidadeId: { in: semDono.map((t) => t.id) } },
      _max: { criadoEm: true },
    })
    const ultimaDevolucao = new Map(devolvidas.map((d) => [d.entidadeId, d._max.criadoEm]))
    const porProc = new Map<number | null, { nome: string | null; ids: number[] }>()
    for (const t of semDono) {
      const dev = ultimaDevolucao.get(t.id)
      if (dev && dev >= limite) continue // devolvida há menos de 1 dia: o relógio recomeça
      const g = porProc.get(t.processoId) ?? { nome: rotuloDaFamilia(t.processo), ids: [] }
      g.ids.push(t.id)
      porProc.set(t.processoId, g)
    }
    for (const [processoId, g] of porProc) {
      itens.push({
        tipo: 'SEM_RESPONSAVEL', processoId, familiaNome: g.nome, tarefaIds: sv(g.ids), itens: [],
        link: LINK_SEM_RESPONSAVEL_NA_TORRE,
      })
    }
  }

  // ── INTEGRIDADE (crítica) ───────────────────────────────────────────────
  const duasHorasAtras = new Date(agora.getTime() - 2 * 3_600_000)
  const incidente = await db.logAuditoria.findFirst({
    where: { entidade: 'SAUDE', acao: 'SAUDE_INCIDENTE', criadoEm: { gte: duasHorasAtras } },
    orderBy: { criadoEm: 'desc' }, select: { detalhes: true },
  })
  const d = incidente?.detalhes as { criticos?: number; assinatura?: string } | null
  if (incidente && (d?.criticos ?? 0) > 0) {
    itens.push({
      tipo: 'INTEGRIDADE', processoId: null, familiaNome: 'Sistema', tarefaIds: [],
      itens: Array.from({ length: d!.criticos! }, (_, i) => `saude::${d!.assinatura ?? 'incidente'}::${i}`),
      link: urlDaSaudeDoSistema('integridade'),
    })
  }
  return itens
}

export interface RelatorioGestor {
  ensaio: boolean
  destinatarios: number
  itens: number
  criados: number
  atualizados: number
  removidos: number
  semMudanca: number
}

/**
 * OS AVISOS DO GESTOR — cada administrador recebe `precisaDeVoce`, por família.
 * Depois do clique, só volta com FATO NOVO (tarefa/alerta que ele ainda não tinha visto).
 * O que deixou de precisar de decisão sai do aviso aberto.
 */
export async function avisarGestores(
  opts: { agora?: Date; ensaio?: boolean; linhas?: LinhaGerencial[]; db?: Db } = {},
): Promise<RelatorioGestor> {
  const agora = opts.agora ?? new Date()
  const db = opts.db ?? prisma
  const ensaio = opts.ensaio === true
  const [itens, admins] = await Promise.all([
    precisaDeVoce({ agora, linhas: opts.linhas, db }),
    db.usuario.findMany({ where: { tipo: 'admin' }, select: { id: true } }),
  ])
  const r: RelatorioGestor = { ensaio, destinatarios: admins.length, itens: itens.length, criados: 0, atualizados: 0, removidos: 0, semMudanca: 0 }
  const conta = (acao: string) => {
    if (acao === 'CRIADO') r.criados++
    else if (acao === 'ATUALIZADO') r.atualizados++
    else if (acao === 'REMOVIDO') r.removidos++
    else if (acao === 'SEM_MUDANCA') r.semMudanca++
  }

  const vivos = new Set<string>()
  for (const admin of admins) {
    for (const it of itens) {
      vivos.add(`${admin.id}|${it.processoId ?? 0}|${it.tipo}`)
      // O QUE ELE JÁ VIU (avisos lidos) não volta.
      const lidos = await db.notificacaoOperacional.findMany({
        where: { destinatarioId: admin.id, processoId: it.processoId, tipo: it.tipo, agrupado: true, lidaEm: { not: null } },
        select: { tarefaIds: true, resumo: true },
      })
      const vistosTarefas = new Set(lidos.flatMap((l) => l.tarefaIds))
      const vistosItens = new Set(lidos.flatMap((l) => ((l.resumo as ResumoDoAviso | null)?.itens ?? [])))
      const tarefaIds = it.tarefaIds.filter((id) => !vistosTarefas.has(id))
      const novosItens = it.itens.filter((k) => !vistosItens.has(k))
      if (ensaio) {
        conta(tarefaIds.length + novosItens.length > 0 ? 'CRIADO' : 'NADA')
        continue
      }
      const g = await gravarFotoDoAviso(db, {
        tipo: it.tipo, destinatarioId: admin.id, processoId: it.processoId, familiaNome: it.familiaNome,
        tarefaIds, itens: novosItens, link: it.link,
      })
      conta(g.acao)
    }
  }

  // Aviso aberto de gestor que já não precisa de decisão: some.
  const abertos = await db.notificacaoOperacional.findMany({
    where: { tipo: { in: ['ESCALADA', 'SEM_RESPONSAVEL', 'INTEGRIDADE'] }, agrupado: true, lidaEm: null },
    select: { id: true, destinatarioId: true, processoId: true, tipo: true },
  })
  for (const a of abertos) {
    if (vivos.has(`${a.destinatarioId}|${a.processoId ?? 0}|${a.tipo}`)) continue
    if (!ensaio) await removerAviso(db, a.id)
    r.removidos++
  }
  return r
}

// ═══════════════════════════════════════════════════════════════════════════
// AS DUAS RODADAS DO CRON
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O RESUMO DIÁRIO — 07:00 America/Sao_Paulo. Recompõe a foto do dia (PRECISA_AGIR)
 * mesmo para quem clicou ontem, e atualiza a lista do gestor.
 */
export async function rodarResumoDiario(opts: { agora?: Date; ensaio?: boolean } = {}) {
  const agora = opts.agora ?? new Date()
  const linhas = await lerLinhasOperacionais(agora)
  const precisaAgir = await avaliarPrecisaAgir({ agora, modo: 'FOTO', ensaio: opts.ensaio, linhas })
  const gestor = await avisarGestores({ agora, ensaio: opts.ensaio, linhas })
  return { precisaAgir, gestor }
}

/**
 * A VARREDURA HORÁRIA — só o que é FATO NOVO: atualiza aviso aberto, abre aviso para
 * nova vencida/nova cobrança, reconcilia posse (regra 5) e expurga o que expirou.
 */
export async function rodarVarreduraHoraria(opts: { agora?: Date; ensaio?: boolean } = {}) {
  const agora = opts.agora ?? new Date()
  const linhas = await lerLinhasOperacionais(agora)
  const precisaAgir = await avaliarPrecisaAgir({ agora, modo: 'INCREMENTAL', ensaio: opts.ensaio, linhas })
  const gestor = await avisarGestores({ agora, ensaio: opts.ensaio, linhas })
  const posse = opts.ensaio ? null : await sincronizarAvisosDeTarefas(prisma)
  const expurgo = opts.ensaio ? null : await expurgarAvisos(prisma, agora)
  return { precisaAgir, gestor, posse, expurgo }
}
