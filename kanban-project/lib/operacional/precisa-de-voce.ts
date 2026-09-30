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
import { conferirCoerenciaPassoTarefa } from '@/src/services/passo-tarefa-projecao'
import { lerOrganizacao, unidadesDasTarefas, capacidadeMedidaPorUsuario } from './organizacao'
import { classificarCarga, type Carga } from './elegibilidade'
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
}

/**
 * A SUGESTÃO — apto → menos ativas → empate pelos últimos 30 dias → se o
 * escolhido está ausente, a sugestão passa a ser o SUCESSOR SUGERIDO dele
 * (Bloco E2, `IndisponibilidadeOperacional.sucessorSugeridoId`).
 */
export async function sugerirResponsavelPrecisaDeVoce(
  tarefaId: number, agora = new Date(), db: Db = prisma,
): Promise<SugestaoDeResponsavel | null> {
  const unidades = await unidadesDasTarefas([tarefaId])
  const unidadeOperacionalId = unidades.get(tarefaId) ?? null

  const organizacao = await lerOrganizacao(agora)

  const usuarios = await db.usuario.findMany({
    select: { id: true, nome: true, tipo: true, permissoesCustom: true, perfil: { select: { permissoes: true } } },
  })
  const unidadesComAptidao = new Set([...organizacao.values()].flatMap((o) => o.aptidoes))
  const aptidaoEhRegra = unidadeOperacionalId != null && unidadesComAptidao.has(unidadeOperacionalId)

  // DISPONIBILIDADE NÃO É PRÉ-FILTRO AQUI, DE PROPÓSITO: o mandato pede
  // "apto → menos ativas → empate 30 d → AUSENTE vai para o sucessor
  // sugerido" — ausente pode legitimamente vencer o ranking (0 ativas,
  // porque não está recebendo trabalho novo) e só então é redirecionado
  // para quem ele mesmo sugeriu como sucessor (Bloco E2).
  const elegiveis = usuarios.filter((u) => {
    const permissoes = calcularPermissoes(u.tipo, u.perfil?.permissoes as MapaPermissoes | null, u.permissoesCustom as MapaPermissoes | null)
    if (!temPermissao(permissoes, 'tarefas.iniciar_concluir')) return false
    const org = organizacao.get(u.id)
    if (aptidaoEhRegra && !(org?.aptidoes ?? []).includes(unidadeOperacionalId!)) return false
    return true
  })
  if (elegiveis.length === 0) return null

  const ids = elegiveis.map((u) => u.id)
  const trintaDiasAtras = new Date(agora.getTime() - 30 * 86_400_000)
  const [ativas, atribuicoesRecentes] = await Promise.all([
    db.tarefa.findMany({
      where: { responsavelId: { in: ids }, statusTarefa: { in: ['NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE', 'BLOQUEADA'] } },
      select: { responsavelId: true },
    }),
    db.logAuditoria.findMany({
      where: { acao: { in: ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA'] }, criadoEm: { gte: trintaDiasAtras } },
      select: { detalhes: true },
    }),
  ])
  const ativasPorUsuario = new Map<number, number>()
  for (const t of ativas) {
    if (t.responsavelId == null) continue
    ativasPorUsuario.set(t.responsavelId, (ativasPorUsuario.get(t.responsavelId) ?? 0) + 1)
  }
  const atribuicoes30dPorUsuario = new Map<number, number>()
  for (const l of atribuicoesRecentes) {
    const para = (l.detalhes as { para?: number } | null)?.para
    if (para == null) continue
    atribuicoes30dPorUsuario.set(para, (atribuicoes30dPorUsuario.get(para) ?? 0) + 1)
  }

  const ordenados = elegiveis
    .map((u) => ({
      id: u.id, nome: u.nome,
      ativas: ativasPorUsuario.get(u.id) ?? 0,
      atribuicoes30d: atribuicoes30dPorUsuario.get(u.id) ?? 0,
    }))
    .sort((a, b) => (a.ativas - b.ativas) || (a.atribuicoes30d - b.atribuicoes30d) || (a.id - b.id))

  // PERCORRE o ranking na ordem: se o candidato está disponível, é ele. Se
  // está ausente, a sugestão vira o SUCESSOR SUGERIDO dele (Bloco E2,
  // `Indisponibilidade.sucessorSugerido` — sem consulta extra); ausente SEM
  // sucessor sugerido não é uma sugestão válida, e o ranking segue para o
  // próximo — nunca sugere alguém que não vai ver o trabalho.
  for (const c of ordenados) {
    const indisponivel = organizacao.get(c.id)?.indisponivelPor
    if (!indisponivel) {
      return { usuarioId: c.id, nome: c.nome, motivo: `${c.ativas} ativa(s)${aptidaoEhRegra ? ', apto' : ''}` }
    }
    const sucessor = indisponivel.sucessorSugerido
    if (sucessor) {
      return {
        usuarioId: sucessor.usuarioId, nome: sucessor.nome,
        motivo: `${c.nome} está ausente — sucessor sugerido para a carteira.`,
      }
    }
  }
  return null
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
  opts: { agora?: Date; linhas?: LinhaGerencial[]; db?: Db } = {},
): Promise<ItemPrecisaDeVoceTorre[]> {
  const agora = opts.agora ?? new Date()
  const db = opts.db ?? prisma
  const linhas = opts.linhas ?? await lerLinhasOperacionais(agora, db)
  const fasesEspeciais = await fasesApostilamentoOuRetificacao(db)

  // DIVERGÊNCIA — mesmo comparador que trava a transação de projeção
  // (`paresCoerentes`), em lote, contra os passos das tarefas ativas.
  const tarefasComStep = await db.tarefa.findMany({
    where: { id: { in: linhas.map((l) => l.taskId) }, workflowStepInstanceId: { not: null } },
    select: { workflowStepInstanceId: true },
  })
  const stepInstanceIds = [...new Set(tarefasComStep.map((t) => t.workflowStepInstanceId as number))]
  const divergencias = await conferirCoerenciaPassoTarefa(db as Prisma.TransactionClient, stepInstanceIds)
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

  // CARGA — pessoa no limite (ativas ≥ limite do cadastro).
  const organizacao = await lerOrganizacao(agora)
  const usuarios = [...organizacao.values()].filter((o) => o.limiteExecutaveis != null)
  if (usuarios.length) {
    const ativasBrutas = await db.tarefa.findMany({
      where: { responsavelId: { in: usuarios.map((u) => u.usuarioId) }, statusTarefa: { in: ['NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE', 'BLOQUEADA'] } },
      select: { responsavelId: true, statusTarefa: true, dataPrazo: true, prioridade: true, motivoCodigo: true },
    })
    const cargas = classificarCarga(usuarios.map((u) => u.usuarioId), ativasBrutas, agora)
    for (const u of usuarios) {
      const c: Carga | undefined = cargas.get(u.usuarioId)
      if (!c || u.limiteExecutaveis == null || c.executaveis < u.limiteExecutaveis) continue
      const capacidadeMedida = (await capacidadeMedidaPorUsuario([u.usuarioId], new Map([[u.usuarioId, c.executaveis]]), agora)).get(u.usuarioId)
      const score = 3 // ATENÇÃO — carga é achado estrutural, não soma de fatores por tarefa.
      itens.push({
        tipo: 'CARGA', score, faixa: faixaDoScore(score), tarefaId: null, processoId: null, familiaNome: u.nome,
        titulo: `${u.nome} no limite: ${c.executaveis} ativas, fecha ~${capacidadeMedida?.mediaSemanal ?? '?'} por semana`,
        detalhe: `Fila estimada de ${capacidadeMedida?.filaEmSemanas ?? '?'} semana(s).`,
        sugestao: 'Redistribuir as tarefas "a enviar" para quem tem carga menor.',
        acao1: { rotulo: 'Redistribuir N', acao: 'REDISTRIBUIR_CARGA' },
        acao2: { rotulo: 'Ver equipe', acao: 'VER_EQUIPE' },
        link: '/operacao/distribuicao', contexto: { usuarioId: u.usuarioId },
      })
    }
  }

  // PAREDE À FRENTE — achados CAD-012/WF-004, abertos e não ignorados agora.
  const achados = await db.saudeAchado.findMany({
    where: {
      codigo: { in: ['CAD-012', 'WF-004'] },
      status: { notIn: ['RESOLVIDO'] },
      OR: [{ status: { not: 'IGNORADO' } }, { ignoradoAte: { lt: agora } }],
    },
    orderBy: { ultimaDeteccao: 'desc' },
    take: 20,
  })
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

/**
 * PREENCHE `sugestao` dos itens FASE_DEIXADA/SEM_DONO — feito depois da lista
 * pronta porque a sugestão é uma leitura assíncrona por item (não vale a pena
 * pagar o custo pra quem só quer o número, ex. o KPI de "sem dono").
 */
export async function comSugestoes(itens: ItemPrecisaDeVoceTorre[], agora = new Date(), db: Db = prisma): Promise<ItemPrecisaDeVoceTorre[]> {
  const saida: ItemPrecisaDeVoceTorre[] = []
  for (const it of itens) {
    if ((it.tipo === 'FASE_DEIXADA' || it.tipo === 'SEM_DONO') && it.tarefaId != null) {
      const s = await sugerirResponsavelPrecisaDeVoce(it.tarefaId, agora, db)
      saida.push({
        ...it,
        sugestao: s ? `Sugiro ${s.nome}: ${s.motivo}` : 'Nenhum candidato apto e disponível encontrado.',
        acao1: { ...it.acao1, rotulo: s ? `Atribuir a ${s.nome}` : it.acao1.rotulo },
        contexto: { ...it.contexto, sugeridoId: s?.usuarioId ?? null, sugeridoNome: s?.nome ?? null },
      })
    } else {
      saida.push(it)
    }
  }
  return saida
}

// ─── BRIEFING DO DIA ────────────────────────────────────────────────────────

export function briefingDoDia(itens: ItemPrecisaDeVoceTorre[], agora = new Date()): string {
  const criticos = itens.filter((i) => i.faixa === 'CRITICO').length
  const atencao = itens.filter((i) => i.faixa === 'ATENCAO').length
  const semDono = itens.filter((i) => i.tipo === 'SEM_DONO').length
  const escaladas = itens.filter((i) => i.tipo === 'ESCALADA').length
  const bloqueadas = itens.filter((i) => i.tipo === 'BLOQUEADA').length
  const carga = itens.filter((i) => i.tipo === 'CARGA').length
  const parede = itens.filter((i) => i.tipo === 'PAREDE_A_FRENTE').length

  const dataFmt = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  if (itens.length === 0) return `Bom dia. Hoje, ${dataFmt}: nada precisa de você agora.`

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

  return `Bom dia. Hoje, ${dataFmt}: ${resumoFaixas} precisam de você` +
    (detalhes.length ? ` (${detalhes.join(' · ')}).` : '.')
}
