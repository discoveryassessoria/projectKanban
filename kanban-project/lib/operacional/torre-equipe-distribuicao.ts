// lib/operacional/torre-equipe-distribuicao.ts
// ============================================================================
// ABA EQUIPE (Torre nova, frente F) — DISTRIBUIR POR APTIDÃO E CARGA e REDISTRIBUIR.
//
//   quemAbsorve                 quais tarefas um destino é APTO a executar (unidade E país, opt-in)
//   sugestaoDeRedistribuicao    o que o rodapé do cartão propõe (SÓ LEITURA, nunca grava)
//   distribuirSemResponsavel    o botão da linha "Sem responsável"
//   executarRedistribuicao      o botão "Redistribuir" (excesso de quem passou do limite + sem dono)
//
// ─── NENHUMA REGRA NOVA ─────────────────────────────────────────────────────
// • Quem recebe uma tarefa sem dono é decidido por `escolherResponsavel` (precisa-de-voce.ts), aplicada em lote por
//   `planoDaR1` (regras-torre.ts): permissão → equipe exigida → aptidão por UNIDADE → aptidão por PAÍS → menos ativas →
//   ausente vai para o sucessor sugerido. NUNCA atribui a quem não tem aptidão comprovada: sem apto, a tarefa FICA sem dono
//   e continua no "Precisa de você". O limite de carga do cadastro SEGURA quem já está nele.
// • O que vai de quem passou do limite usa a mesma primitiva de "Mover carteira" (`redistribuirTarefas`): item a item,
//   auditado, uma notificação agrupada, e DESFAZER pela mesma porta (`desfazerLote`).
// ============================================================================
import { prisma } from '@/lib/prisma'
import {
  lerOrganizacao, unidadesDasTarefas, unidadesComAptidaoDeclarada, paisesDasTarefas, paisesComAptidaoDeclarada,
} from './organizacao'
import { sugerirSucessor } from './elegibilidade'
import { redistribuirTarefas } from './tarefa-comandos'
import { planoDaR1 } from './regras-torre'
import { cargaPorPessoa, ehExecutavel } from './torre-predicados'
import { listarTarefasDaTorre, type LinhaDaTorre } from '@/src/services/torre-tarefas'

type Organizacao = Awaited<ReturnType<typeof lerOrganizacao>>

/**
 * Regra de aptidão opt-in, a MESMA de `escolherResponsavel` e de `sugerirSucessor`: a unidade (ou o país) só restringe
 * quando ALGUÉM declarou aptidão para ela; sem isso, qualquer um é apto. As duas aptidões SOMAM.
 */
export async function quemAbsorve(tarefaIds: number[], destinoId: number | null, agora: Date): Promise<Set<number>> {
  if (destinoId == null || tarefaIds.length === 0) return new Set()
  const [unidades, comAptidao, org, paises, paisesComApt] = await Promise.all([
    unidadesDasTarefas(tarefaIds), unidadesComAptidaoDeclarada(), lerOrganizacao(agora), paisesDasTarefas(tarefaIds), paisesComAptidaoDeclarada(),
  ])
  const aptoA = new Set(org.get(destinoId)?.aptidoes ?? [])
  const aptoNosPaises = new Set(org.get(destinoId)?.paisesAptos ?? [])
  return new Set(tarefaIds.filter((id) => {
    const u = unidades.get(id) ?? null
    const p = paises.get(id) ?? null
    return (u == null || !comAptidao.has(u) || aptoA.has(u)) && (p == null || !paisesComApt.has(p) || aptoNosPaises.has(p))
  }))
}

// ─── A SUGESTÃO (SÓ LEITURA) ────────────────────────────────────────────────

export interface MovimentoSugerido {
  deUsuarioId: number
  deNome: string
  paraUsuarioId: number
  paraNome: string
  quantidade: number
  /** Quanto a pessoa de origem excede o limite do cadastro (executáveis − limite). */
  excesso: number
}
export interface DistribuicaoPlanejada {
  /** As abertas sem dono (a conta da linha "Sem responsável"). */
  total: number
  /** Quantas a regra atribuiria agora e para quem. */
  porPessoa: Array<{ usuarioId: number; nome: string; quantidade: number }>
  /** Sem apto comprovado: ficam sem dono e continuam no "Precisa de você". */
  semApto: number
  /** O apto escolhido já está no limite: segura para decisão humana. */
  seguradas: number
}
export interface SugestaoDeRedistribuicao {
  movimentos: MovimentoSugerido[]
  semResponsavel: DistribuicaoPlanejada
  /** Há algo que o botão "Redistribuir" faria agora? */
  temAcao: boolean
}

interface MovimentoComIds extends MovimentoSugerido { tarefaIds: number[] }

const abertas = (linhas: LinhaDaTorre[]) => linhas.filter((l) => l.estadoOperacao !== 'CONCLUIDA')

/** As tarefas EXECUTÁVEIS de quem passou do limite, na ordem em que saem primeiro: as não iniciadas, depois as de prazo mais curto. */
const ordemDeSaida = (a: LinhaDaTorre, b: LinhaDaTorre): number => {
  const na = a.statusTarefa === 'NAO_INICIADA' ? 0 : 1, nb = b.statusTarefa === 'NAO_INICIADA' ? 0 : 1
  if (na !== nb) return na - nb
  const pa = a.dataPrazo ? Date.parse(a.dataPrazo) : Number.POSITIVE_INFINITY
  const pb = b.dataPrazo ? Date.parse(b.dataPrazo) : Number.POSITIVE_INFINITY
  return pa - pb || a.taskId - b.taskId
}

/**
 * Quem está ACIMA do limite cadastrado (executáveis > limite — a barra vermelha) passa o EXCESSO ao sucessor sugerido
 * (apto e disponível, menor custo), só do que ele é apto a executar e só até onde o limite DELE comporta.
 */
async function planejarMovimentos(linhas: LinhaDaTorre[], organizacao: Organizacao, agora: Date): Promise<MovimentoComIds[]> {
  const cargas = cargaPorPessoa(linhas)
  const execDe = new Map([...cargas].map(([id, c]) => [id, c.executaveis]))
  const saida: MovimentoComIds[] = []
  for (const o of organizacao.values()) {
    if (o.limiteExecutaveis == null || o.indisponivelPor) continue
    const exec = execDe.get(o.usuarioId) ?? 0
    const excesso = exec - o.limiteExecutaveis
    if (excesso <= 0) continue
    const sucessor = await sugerirSucessor(o.usuarioId, agora)
    if (!sucessor) continue
    const doDestino = organizacao.get(sucessor.usuarioId)
    const folga = doDestino?.limiteExecutaveis != null ? Math.max(0, doDestino.limiteExecutaveis - (execDe.get(sucessor.usuarioId) ?? 0)) : Number.POSITIVE_INFINITY
    const minhas = linhas.filter((l) => l.responsavelId === o.usuarioId && l.estadoOperacao !== 'CONCLUIDA' && ehExecutavel(l.statusTarefa)).sort(ordemDeSaida)
    const aptas = await quemAbsorve(minhas.map((l) => l.taskId), sucessor.usuarioId, agora)
    const vao = minhas.filter((l) => aptas.has(l.taskId)).slice(0, Math.min(excesso, folga))
    if (vao.length === 0) continue
    execDe.set(o.usuarioId, exec - vao.length)
    execDe.set(sucessor.usuarioId, (execDe.get(sucessor.usuarioId) ?? 0) + vao.length)
    saida.push({
      deUsuarioId: o.usuarioId, deNome: o.nome, paraUsuarioId: sucessor.usuarioId, paraNome: sucessor.nome,
      quantidade: vao.length, excesso, tarefaIds: vao.map((l) => l.taskId),
    })
  }
  return saida
}

async function planejarSemResponsavel(linhas: LinhaDaTorre[], organizacao: Organizacao, agora: Date) {
  const sem = abertas(linhas).filter((l) => l.responsavelId == null)
  // O limite de carga SEMPRE segura aqui: é a leitura de "por aptidão e CARGA" — ninguém recebe acima do limite do cadastro.
  const plano = await planoDaR1(agora, true, { alvos: sem.map((l) => ({ tarefaId: l.taskId, titulo: l.titulo })), linhas, organizacao, pularQuemEstaNoLimite: true })
  return { total: sem.length, plano }
}

function resumirPlano(total: number, plano: Awaited<ReturnType<typeof planejarSemResponsavel>>['plano']): DistribuicaoPlanejada {
  const por = new Map<number, { usuarioId: number; nome: string; quantidade: number }>()
  for (const p of plano) {
    if (!p.atribui || p.paraId == null) continue
    const atual = por.get(p.paraId) ?? { usuarioId: p.paraId, nome: p.paraNome ?? '', quantidade: 0 }
    atual.quantidade++
    por.set(p.paraId, atual)
  }
  return {
    total,
    porPessoa: [...por.values()].sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR')),
    semApto: plano.filter((p) => p.semApto).length,
    seguradas: plano.filter((p) => p.seguradaPorLimite).length,
  }
}

export async function sugestaoDeRedistribuicao(linhas: LinhaDaTorre[], organizacao: Organizacao, agora: Date): Promise<SugestaoDeRedistribuicao> {
  const [movimentos, sem] = await Promise.all([planejarMovimentos(linhas, organizacao, agora), planejarSemResponsavel(linhas, organizacao, agora)])
  const semResponsavel = resumirPlano(sem.total, sem.plano)
  return {
    movimentos: movimentos.map(({ tarefaIds: _ids, ...m }) => m),
    semResponsavel,
    temAcao: movimentos.length > 0 || semResponsavel.porPessoa.length > 0,
  }
}

// ─── EXECUÇÃO ───────────────────────────────────────────────────────────────

export interface ResultadoDaDistribuicao {
  total: number
  atribuidas: number
  porPessoa: Array<{ usuarioId: number; nome: string; quantidade: number }>
  semApto: number
  seguradas: number
  falhas: number
  tarefaIds: number[]
  itens: Array<{ tarefaId: number; ok: boolean; mensagem?: string }>
}

/**
 * "Distribuir as N por aptidão e carga": atribui as abertas SEM DONO a quem a regra escolhe (apto → menor carga → ausente vai
 * ao sucessor), UM destino por vez (`redistribuirTarefas`: item a item, auditado, uma notificação agrupada). A justificativa
 * de cada atribuição fica no próprio histórico da tarefa; o lote acrescenta um resumo. O que não tem apto NÃO é atribuído.
 */
export async function distribuirSemResponsavel(args: { autorId: number; agora?: Date; linhas?: LinhaDaTorre[]; organizacao?: Organizacao }): Promise<ResultadoDaDistribuicao> {
  const agora = args.agora ?? new Date()
  const linhas = args.linhas ?? (await listarTarefasDaTorre({}, agora)).linhas
  const organizacao = args.organizacao ?? (await lerOrganizacao(agora))
  const { total, plano } = await planejarSemResponsavel(linhas, organizacao, agora)
  const grupos = new Map<number, { nome: string; ids: number[] }>()
  for (const p of plano) {
    if (!p.atribui || p.paraId == null) continue
    const g = grupos.get(p.paraId) ?? { nome: p.paraNome ?? '', ids: [] }
    g.ids.push(p.tarefaId)
    grupos.set(p.paraId, g)
  }
  const itens: ResultadoDaDistribuicao['itens'] = []
  const porPessoa: ResultadoDaDistribuicao['porPessoa'] = []
  for (const [usuarioId, g] of grupos) {
    const r = await redistribuirTarefas({
      tarefaIds: g.ids, novoResponsavelId: usuarioId, autorId: args.autorId,
      motivo: `distribuição por aptidão e carga (Torre › Equipe): ${g.nome} é apto(a) e tem a menor carga entre os aptos; sem apto comprovado a tarefa não é atribuída`,
    })
    itens.push(...r.itens.map((i) => ({ tarefaId: i.tarefaId, ok: i.ok, mensagem: i.mensagem })))
    if (r.sucesso > 0) porPessoa.push({ usuarioId, nome: g.nome, quantidade: r.sucesso })
  }
  porPessoa.sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'))
  const resumo: ResultadoDaDistribuicao = {
    total, atribuidas: itens.filter((i) => i.ok).length, porPessoa,
    semApto: plano.filter((p) => p.semApto).length, seguradas: plano.filter((p) => p.seguradaPorLimite).length,
    falhas: itens.filter((i) => !i.ok).length, tarefaIds: itens.filter((i) => i.ok).map((i) => i.tarefaId), itens,
  }
  if (resumo.atribuidas > 0 || resumo.semApto > 0 || resumo.seguradas > 0) {
    await prisma.logAuditoria.create({
      data: {
        acao: 'TORRE_EQUIPE_SEM_RESPONSAVEL_DISTRIBUIDAS', entidade: 'Tarefa', entidadeId: 0, usuarioId: args.autorId,
        descricao: `Distribuição por aptidão e carga (Torre › Equipe): ${resumo.atribuidas} de ${total} sem responsável atribuída(s)` +
          `${porPessoa.length ? ` (${porPessoa.map((p) => `${p.nome} ${p.quantidade}`).join(' · ')})` : ''}; ` +
          `${resumo.semApto} sem apto (continuam no "Precisa de você"); ${resumo.seguradas} seguradas pelo limite de carga; ${resumo.falhas} falha(s).`,
        detalhes: JSON.parse(JSON.stringify({ total, atribuidas: resumo.atribuidas, porPessoa, semApto: resumo.semApto, seguradas: resumo.seguradas, falhas: resumo.falhas, itens })),
      },
    })
  }
  return resumo
}

export interface ResultadoDaRedistribuicao {
  movimentos: Array<{ deUsuarioId: number; deNome: string; paraUsuarioId: number; paraNome: string; solicitadas: number; movidas: number }>
  distribuicao: ResultadoDaDistribuicao
  /** Todas as tarefas que mudaram de dono (movimentos + distribuição): o que o "Desfazer" devolve. */
  tarefaIds: number[]
}

/**
 * "Redistribuir": (1) passa o excesso de quem está acima do limite ao sucessor sugerido (só o que ele é apto a executar) e
 * (2) distribui as sem dono por aptidão e carga. Reavalia TUDO na hora (a sugestão do rodapé pode ter envelhecido).
 */
export async function executarRedistribuicao(args: { autorId: number; agora?: Date }): Promise<ResultadoDaRedistribuicao> {
  const agora = args.agora ?? new Date()
  const linhas = (await listarTarefasDaTorre({}, agora)).linhas
  const organizacao = await lerOrganizacao(agora)
  const movimentos = await planejarMovimentos(linhas, organizacao, agora)
  const feitos: ResultadoDaRedistribuicao['movimentos'] = []
  const ids: number[] = []
  for (const m of movimentos) {
    const r = await redistribuirTarefas({
      tarefaIds: m.tarefaIds, novoResponsavelId: m.paraUsuarioId, autorId: args.autorId,
      motivo: `redistribuição sugerida pela Torre › Equipe: ${m.deNome} está ${m.excesso} acima do limite de carga; ${m.paraNome} é apto(a) e disponível`,
    })
    feitos.push({ deUsuarioId: m.deUsuarioId, deNome: m.deNome, paraUsuarioId: m.paraUsuarioId, paraNome: m.paraNome, solicitadas: m.tarefaIds.length, movidas: r.sucesso })
    ids.push(...r.itens.filter((i) => i.ok).map((i) => i.tarefaId))
  }
  // As sem dono são decididas DEPOIS dos movimentos, com a carga já refeita.
  const distribuicao = await distribuirSemResponsavel({ autorId: args.autorId, agora })
  if (feitos.length > 0) {
    await prisma.logAuditoria.create({
      data: {
        acao: 'TORRE_EQUIPE_REDISTRIBUIDA', entidade: 'Tarefa', entidadeId: 0, usuarioId: args.autorId,
        descricao: `Redistribuição sugerida (Torre › Equipe): ${feitos.map((f) => `${f.movidas} de ${f.deNome} para ${f.paraNome}`).join(' · ')}; ${distribuicao.atribuidas} sem responsável distribuída(s).`,
        detalhes: JSON.parse(JSON.stringify({ movimentos: feitos, semResponsavel: { atribuidas: distribuicao.atribuidas, semApto: distribuicao.semApto } })),
      },
    })
  }
  return { movimentos: feitos, distribuicao, tarefaIds: [...ids, ...distribuicao.tarefaIds] }
}
