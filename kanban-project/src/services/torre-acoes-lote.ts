// src/services/torre-acoes-lote.ts
// ============================================================================
// AÇÕES EM LOTE DA TORRE — Bloco G1 (30/09/2026).
//
// Atribuir a {pessoa} · Prioridade alta · Repactuar prazo (UMA justificativa) ·
// Cobrar cartório · e o DESFAZER de cada uma.
//
// NENHUMA regra nova: cada ação é a porta individual repetida, item a item —
//   atribuir   → `redistribuirTarefas`  (tarefa-comandos.ts; notificação agrupada)
//   prioridade → `redistribuirPrioridade` (idem)
//   repactuar  → `alterarPrazo`         (tarefa-ciclo.ts — a MESMA regra e a MESMA
//                                        validação da repactuação individual:
//                                        motivo obrigatório, tarefa encerrada
//                                        recusada, certidão com solicitação grava
//                                        `previsaoRetorno` E espelha `dataPrazo`)
//   cobrar     → `cobrarTarefas`        (cobranca-terceiros.ts)
// Cada tarefa grava a SUA linha de LogAuditoria; o lote acrescenta um resumo.
//
// ─── DESFAZER ───────────────────────────────────────────────────────────────
// Lê o PRÓPRIO LogAuditoria da ação (`de`/`para` de cada tarefa) — nunca uma
// tabela paralela de "pendências de desfazer" — e só reverte se a tarefa ainda
// está exatamente como a ação a deixou; se alguém mexeu depois, RECUSA (desfazer
// apagaria a decisão mais recente). Cada reversão grava a própria auditoria.
//
// COBRAR NÃO TEM DESFAZER, de propósito: cobrança é um fato histórico append-only
// (`ContatoTerceiro` — o terceiro FOI contatado; apagar o registro seria mentir
// sobre o que aconteceu). O toast dela não oferece "Desfazer".
// ============================================================================
import { prisma } from '@/lib/prisma'
import { redistribuirTarefas, redistribuirPrioridade, type ItemDaRedistribuicao } from '@/lib/operacional/tarefa-comandos'
import { alterarPrazo, alterarPrioridade } from '@/lib/operacional/tarefa-ciclo'
import { desfazerAtribuicao } from '@/src/services/precisa-de-voce-acoes'
import { cobrarTarefas, type CobrancaIgnorada } from '@/src/services/cobranca-terceiros'
import { encerrarIndisponibilidade } from '@/lib/operacional/organizacao'

export const LIMITE_DO_LOTE = 200

/**
 * A JANELA DO DESFAZER. O toast oferece 6 s; o servidor aceita até 30 s (rede, clique no
 * último segundo) — e SÓ do autor da própria ação. Sem isto, "Desfazer" seria um botão
 * que desmancha, dias depois, qualquer decisão antiga de qualquer pessoa.
 */
export const JANELA_DO_DESFAZER_MS = 30_000

export type TipoDesfazer = 'ATRIBUICAO' | 'PRIORIDADE' | 'PRAZO'

export interface ResultadoDoLote {
  acao: 'ATRIBUIR' | 'PRIORIDADE_ALTA' | 'REPACTUAR' | 'COBRAR'
  total: number
  sucesso: number
  falha: number
  itens: Array<{ tarefaId: number; ok: boolean; mensagem?: string }>
  /** O que o toast precisa para oferecer "Desfazer" (6 s). `null` = a ação não se desfaz. */
  desfazer: { tipo: TipoDesfazer; tarefaIds: number[] } | null
}

const itensDe = (r: ItemDaRedistribuicao[]) => r.map((i) => ({ tarefaId: i.tarefaId, ok: i.ok, mensagem: i.mensagem }))

async function auditarLote(autorId: number, acao: string, descricao: string, detalhes: unknown) {
  await prisma.logAuditoria.create({
    data: { acao, entidade: 'Tarefa', entidadeId: 0, usuarioId: autorId, descricao, detalhes: JSON.parse(JSON.stringify(detalhes)) },
  })
}

export function validarIds(tarefaIds: unknown): { ok: true; ids: number[] } | { ok: false; erro: string } {
  const ids = Array.isArray(tarefaIds) ? [...new Set(tarefaIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []
  if (ids.length === 0) return { ok: false, erro: 'tarefaIds é obrigatório' }
  if (ids.length > LIMITE_DO_LOTE) return { ok: false, erro: `lote acima de ${LIMITE_DO_LOTE} tarefas` }
  return { ok: true, ids }
}

// ─── ATRIBUIR A {PESSOA} ─────────────────────────────────────────────────────

export async function atribuirEmLote(args: { tarefaIds: number[]; responsavelId: number; autorId: number }): Promise<ResultadoDoLote> {
  const destino = await prisma.usuario.findUnique({ where: { id: args.responsavelId }, select: { id: true, nome: true } })
  if (!destino) {
    return { acao: 'ATRIBUIR', total: args.tarefaIds.length, sucesso: 0, falha: args.tarefaIds.length, desfazer: null,
      itens: args.tarefaIds.map((tarefaId) => ({ tarefaId, ok: false, mensagem: 'destinatário não encontrado' })) }
  }
  // `atribuirTarefa` já recusa: encerrada, mesma pessoa, destino indisponível. E uma tarefa
  // REATIVADA volta sem responsável (regra do motor, com log) — aqui ela é só mais uma sem dono.
  const r = await redistribuirTarefas({
    tarefaIds: args.tarefaIds, novoResponsavelId: args.responsavelId, autorId: args.autorId,
    motivo: `atribuição em lote pela Torre para ${destino.nome}`,
  })
  const itens = itensDe(r.itens)
  return {
    acao: 'ATRIBUIR', total: r.total, sucesso: r.sucesso, falha: r.falha, itens,
    desfazer: r.sucesso > 0 ? { tipo: 'ATRIBUICAO', tarefaIds: itens.filter((i) => i.ok).map((i) => i.tarefaId) } : null,
  }
}

// ─── PRIORIDADE ALTA ─────────────────────────────────────────────────────────

export async function prioridadeAltaEmLote(args: { tarefaIds: number[]; autorId: number }): Promise<ResultadoDoLote> {
  const atuais = await prisma.tarefa.findMany({ where: { id: { in: args.tarefaIds } }, select: { id: true, prioridade: true } })
  const prioridade = new Map(atuais.map((t) => [t.id, t.prioridade]))
  // Já ALTA ou URGENTE não muda: baixar URGENTE→ALTA seria rebaixar, e reescrever ALTA→ALTA só polui a auditoria.
  const aMudar = args.tarefaIds.filter((id) => prioridade.has(id) && prioridade.get(id) !== 'ALTA' && prioridade.get(id) !== 'URGENTE')
  const puladas = args.tarefaIds.filter((id) => !aMudar.includes(id)).map((tarefaId) => ({
    tarefaId, ok: false,
    mensagem: !prioridade.has(tarefaId) ? 'tarefa não encontrada' : `já está com prioridade ${String(prioridade.get(tarefaId)).toLowerCase()}`,
  }))
  const r = aMudar.length
    ? await redistribuirPrioridade({ tarefaIds: aMudar, novaPrioridade: 'ALTA', autorId: args.autorId, motivo: 'prioridade alta em lote pela Torre' })
    : { total: 0, sucesso: 0, falha: 0, itens: [] as ItemDaRedistribuicao[] }
  const itens = [...itensDe(r.itens), ...puladas]
  const sucesso = itens.filter((i) => i.ok).length
  return {
    acao: 'PRIORIDADE_ALTA', total: itens.length, sucesso, falha: itens.length - sucesso, itens,
    desfazer: sucesso > 0 ? { tipo: 'PRIORIDADE', tarefaIds: itens.filter((i) => i.ok).map((i) => i.tarefaId) } : null,
  }
}

// ─── REPACTUAR PRAZO (UMA JUSTIFICATIVA PARA TODAS) ─────────────────────────

export async function repactuarEmLote(args: {
  tarefaIds: number[]; novoPrazo: Date; justificativa: string; autorId: number
}): Promise<ResultadoDoLote> {
  const motivo = args.justificativa.trim().slice(0, 300)
  const itens: ResultadoDoLote['itens'] = []
  for (const tarefaId of args.tarefaIds) {
    // A MESMA primitiva da repactuação individual (`comando alterar_prazo`) — nenhuma
    // regra reimplementada aqui. Cada chamada grava a própria `TAREFA_PRAZO_ALTERADO`.
    const r = await alterarPrazo({ tarefaId, autorId: args.autorId, novoPrazo: args.novoPrazo, motivo })
    itens.push(r.ok ? { tarefaId, ok: true } : { tarefaId, ok: false, mensagem: r.mensagem })
  }
  const sucesso = itens.filter((i) => i.ok).length
  // Lote que não mudou nada não é fato a registrar: cada tarefa que MUDOU tem a sua linha.
  if (sucesso > 0) {
    await auditarLote(args.autorId, 'TAREFAS_PRAZO_REPACTUADO_LOTE',
      `Repactuação em lote pela Torre: ${sucesso} de ${itens.length} tarefa(s) para ${args.novoPrazo.toISOString().slice(0, 10)}. Justificativa única: ${motivo}`,
      { novoPrazo: args.novoPrazo.toISOString(), justificativa: motivo, itens })
  }
  return {
    acao: 'REPACTUAR', total: itens.length, sucesso, falha: itens.length - sucesso, itens,
    desfazer: sucesso > 0 ? { tipo: 'PRAZO', tarefaIds: itens.filter((i) => i.ok).map((i) => i.tarefaId) } : null,
  }
}

// ─── COBRAR CARTÓRIO ─────────────────────────────────────────────────────────

export async function cobrarCartorioEmLote(args: {
  tarefaIds: number[]; autor: { userId: number; tipo: string }
}): Promise<ResultadoDoLote & { ignoradas: CobrancaIgnorada[] }> {
  const { cobradas, ignoradas } = await cobrarTarefas({ tarefaIds: args.tarefaIds, autor: args.autor, exigirAguardando: true })
  const itens = [
    ...cobradas.map((c) => ({ tarefaId: c.tarefaId, ok: true, mensagem: `cobrado por ${c.canal}` })),
    ...ignoradas.map((i) => ({ tarefaId: i.tarefaId, ok: false, mensagem: i.motivo })),
  ]
  if (cobradas.length > 0) {
    await auditarLote(args.autor.userId, 'TAREFAS_COBRADAS_LOTE',
      `Cobrança de cartório em lote pela Torre: ${cobradas.length} de ${itens.length} tarefa(s).`, { cobradas, ignoradas })
  }
  return { acao: 'COBRAR', total: itens.length, sucesso: cobradas.length, falha: ignoradas.length, itens, desfazer: null, ignoradas }
}

// ─── DESFAZER ────────────────────────────────────────────────────────────────

const ACOES_DE_ATRIBUICAO = ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA']

/** A última ação do tipo sobre a tarefa foi FEITA POR ESTE AUTOR, agora há pouco? */
async function dentroDaJanela(tarefaId: number, acoes: string[], autorId: number, agora: Date): Promise<boolean> {
  const log = await prisma.logAuditoria.findFirst({
    where: { entidade: 'Tarefa', entidadeId: tarefaId, acao: { in: acoes } },
    orderBy: { criadoEm: 'desc' }, select: { usuarioId: true, criadoEm: true },
  })
  return !!log && log.usuarioId === autorId && agora.getTime() - log.criadoEm.getTime() <= JANELA_DO_DESFAZER_MS
}

export async function desfazerLote(args: { tipo: TipoDesfazer; tarefaIds: number[]; autorId: number; agora?: Date; ausenciaId?: number | null }): Promise<{
  total: number; desfeitas: number; ausenciaEncerrada?: boolean; itens: Array<{ tarefaId: number; ok: boolean; mensagem: string }>
}> {
  const agora = args.agora ?? new Date()

  // DESFAZER "APLICAR SAÍDA": a ausência registrada junto com a mudança de carteira precisa ser
  // encerrada ANTES — quem está ausente não pode receber trabalho de volta (`atribuirTarefa` recusa).
  // Só a ausência que ESTE autor abriu agora há pouco; nunca uma antiga nem de outra pessoa.
  let ausenciaEncerrada: boolean | undefined
  if (args.ausenciaId != null) {
    const aus = await prisma.indisponibilidadeOperacional.findUnique({
      where: { id: args.ausenciaId }, select: { id: true, usuarioId: true, criadoPorId: true, criadoEm: true, usuario: { select: { nome: true } } },
    })
    if (aus && aus.criadoPorId === args.autorId && agora.getTime() - aus.criadoEm.getTime() <= JANELA_DO_DESFAZER_MS) {
      const r = await encerrarIndisponibilidade(aus.id, agora)
      ausenciaEncerrada = r.ok
      if (r.ok) {
        await prisma.logAuditoria.create({
          data: {
            acao: 'EDITAR', entidade: 'CapacidadeOperacional', entidadeId: aus.usuarioId, usuarioId: args.autorId,
            descricao: `Ausência de ${aus.usuario.nome} desfeita junto com a mudança de carteira (Desfazer da simulação de saída da Torre).`,
            detalhes: { indisponibilidadeId: aus.id, origem: 'torre-desfazer-saida' },
          },
        })
      }
    } else ausenciaEncerrada = false
  }
  const itens: Array<{ tarefaId: number; ok: boolean; mensagem: string }> = []
  const ids = [...new Set(args.tarefaIds)]
  const acoesDoTipo = args.tipo === 'ATRIBUICAO' ? ACOES_DE_ATRIBUICAO : args.tipo === 'PRIORIDADE' ? ['TAREFA_PRIORIDADE_ALTERADA'] : ['TAREFA_PRAZO_ALTERADO']

  const elegiveis: number[] = []
  for (const tarefaId of ids) {
    if (await dentroDaJanela(tarefaId, acoesDoTipo, args.autorId, agora)) elegiveis.push(tarefaId)
    else itens.push({ tarefaId, ok: false, mensagem: 'só se desfaz a ação recente, feita por você — passou o tempo do "Desfazer"' })
  }

  if (args.tipo === 'ATRIBUICAO') {
    const r = await desfazerAtribuicao(elegiveis, args.autorId, 'Torre')
    itens.push(...r.itens)
    return { total: itens.length, desfeitas: itens.filter((i) => i.ok).length, ausenciaEncerrada, itens }
  }

  for (const tarefaId of elegiveis) {
    const tarefa = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { id: true, titulo: true, prioridade: true, dataPrazo: true } })
    if (!tarefa) { itens.push({ tarefaId, ok: false, mensagem: 'tarefa não encontrada' }); continue }

    if (args.tipo === 'PRIORIDADE') {
      const log = await prisma.logAuditoria.findFirst({
        where: { entidade: 'Tarefa', entidadeId: tarefaId, acao: 'TAREFA_PRIORIDADE_ALTERADA' },
        orderBy: { criadoEm: 'desc' }, select: { detalhes: true },
      })
      const d = log?.detalhes as { de?: string; para?: string } | null
      if (!d?.de || !d?.para) { itens.push({ tarefaId, ok: false, mensagem: 'nenhuma mudança de prioridade para desfazer' }); continue }
      if (d.para !== tarefa.prioridade) { itens.push({ tarefaId, ok: false, mensagem: 'a prioridade mudou desde então — desfazer recusado' }); continue }
      const r = await alterarPrioridade({ tarefaId, autorId: args.autorId, prioridade: d.de as 'BAIXA', motivo: 'desfazer prioridade em lote (Torre)' })
      if (!r.ok) { itens.push({ tarefaId, ok: false, mensagem: r.mensagem }); continue }
      await prisma.logAuditoria.create({
        data: {
          acao: 'TAREFA_PRIORIDADE_DESFEITA', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: args.autorId,
          descricao: `Prioridade de "${tarefa.titulo}" restaurada: ${d.para} → ${d.de}.`, detalhes: { tarefaId, revertidoDe: d.para, revertidoPara: d.de },
        },
      })
      itens.push({ tarefaId, ok: true, mensagem: 'desfeita' })
      continue
    }

    // PRAZO
    const log = await prisma.logAuditoria.findFirst({
      where: { entidade: 'Tarefa', entidadeId: tarefaId, acao: 'TAREFA_PRAZO_ALTERADO' },
      orderBy: { criadoEm: 'desc' }, select: { detalhes: true },
    })
    const d = log?.detalhes as { de?: string | null; para?: string | null } | null
    if (!log || d == null || !('de' in d) || !('para' in d)) { itens.push({ tarefaId, ok: false, mensagem: 'nenhuma repactuação para desfazer' }); continue }
    const atual = tarefa.dataPrazo?.toISOString() ?? null
    if ((d.para ?? null) !== atual) { itens.push({ tarefaId, ok: false, mensagem: 'o prazo mudou desde então — desfazer recusado' }); continue }
    const r = await alterarPrazo({
      tarefaId, autorId: args.autorId, novoPrazo: d.de ? new Date(d.de) : null,
      motivo: 'desfazer repactuação em lote (Torre)',
    })
    if (!r.ok) { itens.push({ tarefaId, ok: false, mensagem: r.mensagem }); continue }
    await prisma.logAuditoria.create({
      data: {
        acao: 'TAREFA_PRAZO_REPACTUACAO_DESFEITA', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: args.autorId,
        descricao: `Repactuação de prazo de "${tarefa.titulo}" desfeita: volta para ${d.de ? d.de.slice(0, 10) : 'sem prazo'}.`,
        detalhes: { tarefaId, revertidoDe: d.para, revertidoPara: d.de },
      },
    })
    itens.push({ tarefaId, ok: true, mensagem: 'desfeita' })
  }
  return { total: itens.length, desfeitas: itens.filter((i) => i.ok).length, ausenciaEncerrada, itens }
}
