// src/services/precisa-de-voce-acoes.ts
// ============================================================================
// AS AÇÕES DO "PRECISA DE VOCÊ" — Torre de Controle, Bloco F (29/09/2026).
//
// Cada ação é REAL (grava estado) e AUDITADA (Regra 6 do mandato). Nenhuma
// ação nova reimplementa uma porta que já existe: atribuir, cancelar,
// desbloquear e redistribuir são as MESMAS de `tarefa-comandos.ts`/
// `tarefa-ciclo.ts`; reconciliar é a MESMA projeção de `passo-tarefa-
// projecao.ts`; cobrança é a MESMA de `subtarefas-da-etapa.ts`.
//
// DESFAZER (Regra do Bloco F): toda atribuição pode ser revertida. A reversão
// lê o PRÓPRIO LogAuditoria da atribuição (`de`/`para`) — não existe uma
// segunda tabela de "pendências de desfazer": a auditoria já é a fonte.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { atribuirTarefa, redistribuirTarefas } from '@/lib/operacional/tarefa-comandos'
import { bloquearTarefa, cancelarTarefa, desbloquearTarefa, devolverAFila } from '@/lib/operacional/tarefa-ciclo'
import {
  sugerirResponsavelPrecisaDeVoce, semDonoDoProcesso, planoDeAtribuicao, planejarRedistribuicaoDaCarga, carregarContextoDeSugestao, alvosDeSugestao,
} from '@/lib/operacional/precisa-de-voce'
import { visaoGerencial } from '@/lib/operacional/tarefa-projecoes'
import { pessoasNoLimite } from '@/lib/operacional/torre-equipe'
import { certidoes } from '@/lib/operacional/precisa-de-voce-decisoes'
import { advance, forceAdvance } from '@/src/lib/motor/phase-advance'
import { JUSTIFICATIVA_MINIMA } from '@/src/services/processo-pausa'
import { ignorarAchado } from '@/lib/saude/persistencia'
import { subtarefaCorrenteDaTarefa, registrarCobranca, RESULTADOS_DE_CONTATO } from '@/src/services/subtarefas-da-etapa'
import { projetarTarefaDoPasso, paresCoerentes, STATUS_TAREFA_POR_PASSO } from '@/src/services/passo-tarefa-projecao'
import { humanizarEstadosNoTexto } from '@/src/lib/home/rotulo-status-tarefa'

type Resultado = { ok: true; mensagem: string; [k: string]: unknown } | { ok: false; erro: string; [k: string]: unknown }

async function registrarAuditoriaSimples(args: {
  acao: string; entidade: string; entidadeId: number | null; usuarioId: number; descricao: string; detalhes?: unknown
}) {
  await prisma.logAuditoria.create({
    data: {
      acao: args.acao, entidade: args.entidade, entidadeId: args.entidadeId, usuarioId: args.usuarioId,
      descricao: args.descricao, detalhes: args.detalhes == null ? undefined : JSON.parse(JSON.stringify(args.detalhes)),
    },
  })
}

// ─── FASE DEIXADA / SEM DONO ────────────────────────────────────────────────

// ─── CONFIRMAÇÃO EXPLÍCITA (06/10/2026) ─────────────────────────────────────
// Sugestão NUNCA atribui sozinha nem com um clique solto: o servidor devolve a PRÉVIA ("Atribuir X a Y?") e só grava quando o cliente
// reenvia `confirmado: true` COM a mesma assinatura da prévia (se a sugestão mudou no meio, recusa e mostra a nova).

export interface PreviaDeAtribuicao {
  pergunta: string
  itens: Array<{ pessoa: string; quantidade: number; tarefas: string[] }>
  /** Identifica o que está sendo confirmado: tarefa→pessoa, ordenado. A execução recalcula e compara. */
  assinatura: string
}

const assinar = (pares: Array<[number, number]>): string => pares.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([t, u]) => `${t}:${u}`).join(',')

async function titulosDe(ids: number[]): Promise<Map<number, string>> {
  const ts = await prisma.tarefa.findMany({ where: { id: { in: ids } }, select: { id: true, titulo: true } })
  return new Map(ts.map((t) => [t.id, t.titulo]))
}

export async function previaDaSugestaoDaTarefa(tarefaId: number): Promise<PreviaDeAtribuicao | null> {
  const s = await sugerirResponsavelPrecisaDeVoce(tarefaId)
  if (!s) return null
  const titulo = (await titulosDe([tarefaId])).get(tarefaId) ?? `tarefa #${tarefaId}`
  return { pergunta: `Atribuir "${titulo}" a ${s.nome}?`, itens: [{ pessoa: s.nome, quantidade: 1, tarefas: [titulo] }], assinatura: assinar([[tarefaId, s.usuarioId]]) }
}

export async function previaDaSugestaoDoProcesso(processoId: number, agora = new Date()): Promise<PreviaDeAtribuicao | null> {
  const ids = await semDonoDoProcesso(processoId, agora)
  if (ids.length === 0) return null
  const plano = await planoDeAtribuicao(ids, agora)
  if (plano.atribuicoes.length === 0) return null
  const tit = await titulosDe(plano.atribuicoes.flatMap((a) => a.tarefaIds))
  const itens = plano.atribuicoes.map((a) => ({ pessoa: a.nome, quantidade: a.tarefaIds.length, tarefas: a.tarefaIds.map((t) => tit.get(t) ?? `#${t}`) }))
  const total = itens.reduce((n, i) => n + i.quantidade, 0)
  return { pergunta: `Atribuir ${total} ${total === 1 ? 'tarefa' : 'tarefas'}: ${itens.map((i) => `${i.quantidade} a ${i.pessoa}`).join(', ')}?`, itens, assinatura: assinar(plano.atribuicoes.flatMap((a) => a.tarefaIds.map((t) => [t, a.usuarioId] as [number, number]))) }
}

const origemDaSugestao = (autorNome?: string | null) => `via sugestão do Precisa de você (confirmada${autorNome ? ` por ${autorNome}` : ''})`

export async function atribuirSugerido(tarefaId: number, autorId: number, o: { autorNome?: string | null; assinaturaConfirmada?: string | null } = {}): Promise<Resultado> {
  const s = await sugerirResponsavelPrecisaDeVoce(tarefaId)
  if (!s) return { ok: false, erro: 'Nenhum candidato apto e disponível encontrado.' }
  if (o.assinaturaConfirmada != null && o.assinaturaConfirmada !== assinar([[tarefaId, s.usuarioId]])) return { ok: false, erro: 'A sugestão mudou desde que você confirmou. Revise e confirme de novo.', mudou: true }
  const r = await atribuirTarefa({ tarefaId, responsavelId: s.usuarioId, autorId, motivo: `${origemDaSugestao(o.autorNome)}: ${s.motivo}` })
  if (!r.ok) return { ok: false, erro: r.mensagem }
  return { ok: true, mensagem: `Atribuída a ${s.nome}.`, tarefaId, responsavelId: s.usuarioId }
}

export async function atribuirEscolhido(tarefaId: number, responsavelId: number, autorId: number): Promise<Resultado> {
  const r = await atribuirTarefa({ tarefaId, responsavelId, autorId, motivo: 'manual: escolhido no Precisa de você (não a sugestão)' })
  if (!r.ok) return { ok: false, erro: r.mensagem }
  return { ok: true, mensagem: 'Atribuída.', tarefaId, responsavelId }
}

export async function encerrarNaoDevida(tarefaId: number, justificativa: string, autorId: number): Promise<Resultado> {
  const r = await cancelarTarefa({ tarefaId, autorId, motivo: justificativa, codigo: 'NAO_DEVIDA' })
  if (!r.ok) return { ok: false, erro: r.mensagem }
  return { ok: true, mensagem: 'Encerrada como não devida.', tarefaId }
}

// ─── SEM RESPONSÁVEL — por PROCESSO ─────────────────────────────────────────

/** Atribui as certidões sem responsável de um PROCESSO, cada uma a quem tem APTIDÃO comprovada (o plano da lista). Sem apto → nada, decisão humana. */
export async function atribuirSugeridoDoProcesso(processoId: number, autorId: number, agora = new Date(), o: { autorNome?: string | null; assinaturaConfirmada?: string | null } = {}): Promise<Resultado> {
  const ids = await semDonoDoProcesso(processoId, agora)
  if (ids.length === 0) return { ok: false, erro: 'este processo não tem mais certidões sem responsável' }
  const plano = await planoDeAtribuicao(ids, agora)
  if (plano.atribuicoes.length === 0) return { ok: false, erro: 'Sem aptidão cadastrada para estas certidões — escolha o responsável' }
  const assinaturaAgora = assinar(plano.atribuicoes.flatMap((a) => a.tarefaIds.map((t) => [t, a.usuarioId] as [number, number])))
  if (o.assinaturaConfirmada != null && o.assinaturaConfirmada !== assinaturaAgora) return { ok: false, erro: 'A sugestão mudou desde que você confirmou. Revise e confirme de novo.', mudou: true }
  const itens: Array<{ tarefaId: number; ok: boolean; mensagem?: string }> = []
  for (const a of plano.atribuicoes) {
    const r = await redistribuirTarefas({
      tarefaIds: a.tarefaIds, novoResponsavelId: a.usuarioId, autorId,
      motivo: `${origemDaSugestao(o.autorNome)}${a.motivo ? `: ${a.motivo}` : ''}`,
    })
    itens.push(...r.itens)
  }
  const feitas = itens.filter((i) => i.ok)
  if (feitas.length === 0) return { ok: false, erro: itens.find((i) => !i.ok)?.mensagem ?? 'nenhuma certidão pôde ser atribuída' }
  const quem = plano.atribuicoes.map((a) => `${a.nome} (${a.tarefaIds.length})`).join(', ')
  const sobra = plano.semAptidao.length ? ` ${certidoes(plano.semAptidao.length)} sem aptidão cadastrada continuam sem responsável.` : ''
  return {
    ok: true, mensagem: `${feitas.length} de ${itens.length} ${itens.length === 1 ? 'certidão atribuída' : 'certidões atribuídas'}: ${quem}.${sobra}`,
    total: itens.length, sucesso: feitas.length, itens, processoId,
  }
}

/** Atribui as certidões sem responsável de um PROCESSO à pessoa escolhida. */
export async function atribuirEscolhidoDoProcesso(processoId: number, responsavelId: number, autorId: number, agora = new Date()): Promise<Resultado> {
  const ids = await semDonoDoProcesso(processoId, agora)
  if (ids.length === 0) return { ok: false, erro: 'este processo não tem mais certidões sem responsável' }
  const r = await redistribuirTarefas({ tarefaIds: ids, novoResponsavelId: responsavelId, autorId, motivo: 'manual: escolhido no Precisa de você (não a sugestão)' })
  if (r.sucesso === 0) return { ok: false, erro: r.itens.find((i) => !i.ok)?.mensagem ?? 'nenhuma certidão pôde ser atribuída' }
  return { ok: true, mensagem: `${r.sucesso} de ${r.total} ${r.total === 1 ? 'certidão atribuída' : 'certidões atribuídas'}.`, total: r.total, sucesso: r.sucesso, itens: r.itens, processoId }
}

// ─── FASE DEIXADA — AVANÇAR A FASE pela PORTA CANÔNICA ──────────────────────

/**
 * AVANÇAR FASE: a porta canônica do avanço (`advance`, o PhaseAdvanceService — gate `computeGate`, CAS, idempotência, auditoria em
 * PhaseAdvanceLog). Nunca escreve `faseAtualKey`. Se o gate recusa, devolve as pendências (`pendencias`) e `podeForcar: true` — o
 * "avançar na marra" é outra ação, com justificativa obrigatória (`avancarFaseForcado`).
 */
export async function avancarFase(processoId: number, autorId: number): Promise<Resultado> {
  const r = await advance(processoId, { origem: 'torre:precisa', solicitadoPorId: autorId })
  if (r.success) return { ok: true, mensagem: `Avançou de ${r.faseAnterior} para ${r.faseAtual}.`, processoId, faseAnterior: r.faseAnterior, faseAtual: r.faseAtual, logId: r.logId }
  if (r.resultado === 'BLOQUEADO') {
    return {
      ok: false, erro: 'O avanço está bloqueado por pendências obrigatórias da fase.', podeForcar: true,
      pendencias: (r.blockingIssues ?? []).map((b) => ({ code: b.code, message: b.message })),
    }
  }
  return { ok: false, erro: r.message }
}

function justificativaDoAvanco(texto: unknown): string | null {
  const t = typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim() : ''
  return t.length >= JUSTIFICATIVA_MINIMA ? t : null
}

/** "Avançar na marra": ignora as pendências, EXIGE justificativa (mínimo de 5 letras) e fica no histórico como PhaseAdvanceLog FORÇADO. */
export async function avancarFaseForcado(processoId: number, justificativa: unknown, autorId: number, motivoCodigo = 'AVANCO_FORCADO_PELA_TORRE'): Promise<Resultado> {
  const j = justificativaDoAvanco(justificativa)
  if (!j) return { ok: false, erro: `Informe a justificativa (mínimo de ${JUSTIFICATIVA_MINIMA} letras).` }
  const r = await forceAdvance(processoId, { justificativa: j, motivoCodigo, origem: 'torre:precisa', solicitadoPorId: autorId })
  if (r.success) return { ok: true, mensagem: `Avançou (forçado) de ${r.faseAnterior} para ${r.faseAtual}.`, processoId, faseAnterior: r.faseAnterior, faseAtual: r.faseAtual, logId: r.logId, forcado: true }
  return { ok: false, erro: r.message }
}

/** "Encerrar (não devida)": a fase não é devida a este processo — encerra e segue, pelo avanço FORÇADO, com a justificativa no histórico. */
export async function encerrarFaseNaoDevida(processoId: number, justificativa: unknown, autorId: number): Promise<Resultado> {
  const j = justificativaDoAvanco(justificativa)
  if (!j) return { ok: false, erro: `Informe a justificativa (mínimo de ${JUSTIFICATIVA_MINIMA} letras).` }
  const r = await avancarFaseForcado(processoId, `Fase não devida: ${j}`, autorId, 'FASE_NAO_DEVIDA')
  return r.ok ? { ...r, mensagem: `Fase encerrada como não devida: ${r.mensagem}` } : r
}

// ─── DIVERGÊNCIA ─────────────────────────────────────────────────────────────

export async function reconciliar(tarefaId: number, autorId: number): Promise<Resultado> {
  const tarefa = await prisma.tarefa.findUnique({
    where: { id: tarefaId },
    select: { id: true, statusTarefa: true, workflowStepInstanceId: true, workflowStepInstance: { select: { id: true, status: true } } },
  })
  if (!tarefa) return { ok: false, erro: 'tarefa não encontrada' }
  if (!tarefa.workflowStepInstance) return { ok: false, erro: 'tarefa sem passo vinculado — nada para reconciliar' }
  if (paresCoerentes(tarefa.workflowStepInstance.status, tarefa.statusTarefa)) {
    return { ok: false, erro: 'a tarefa já está coerente com o passo — nada para reconciliar' }
  }
  const de = tarefa.statusTarefa
  const resultado = await prisma.$transaction((tx) =>
    projetarTarefaDoPasso(tx, { stepInstanceId: tarefa.workflowStepInstance!.id, statusPasso: tarefa.workflowStepInstance!.status, usuarioId: autorId }))
  if (!resultado.changed) return { ok: false, erro: 'a projeção não encontrou o que reconciliar' }
  await registrarAuditoriaSimples({
    acao: 'TAREFA_RECONCILIADA_DIVERGENCIA', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: autorId,
    descricao: `Tarefa #${tarefaId} reconciliada pelo Precisa de você: ${de} → ${resultado.para} (espelhando o passo ${tarefa.workflowStepInstance.status}).`,
    detalhes: { de, para: resultado.para, statusPasso: tarefa.workflowStepInstance.status, esperado: STATUS_TAREFA_POR_PASSO[tarefa.workflowStepInstance.status] },
  })
  return { ok: true, mensagem: humanizarEstadosNoTexto(`Reconciliada: ${de} → ${resultado.para}.`), tarefaId }
}

export async function ver3Fontes(tarefaId: number): Promise<Resultado> {
  const tarefa = await prisma.tarefa.findUnique({
    where: { id: tarefaId },
    select: {
      id: true, statusTarefa: true, workflowStepInstance: { select: { status: true, stepKey: true } },
    },
  })
  if (!tarefa) return { ok: false, erro: 'tarefa não encontrada' }
  return {
    ok: true, mensagem: '3 fontes do mesmo trabalho.', tarefaId,
    fontes: {
      tarefa: { statusTarefa: tarefa.statusTarefa },
      passo: tarefa.workflowStepInstance ? { statusPasso: tarefa.workflowStepInstance.status, stepKey: tarefa.workflowStepInstance.stepKey } : null,
      central: { esperado: tarefa.workflowStepInstance ? STATUS_TAREFA_POR_PASSO[tarefa.workflowStepInstance.status] : null },
    },
  }
}

// ─── ESCALADA ────────────────────────────────────────────────────────────────

export async function registrarLigacao(
  tarefaId: number, autorId: number, observacao?: string | null, resultado = 'SEM_RESPOSTA',
): Promise<Resultado> {
  if (!(RESULTADOS_DE_CONTATO as readonly string[]).includes(resultado)) return { ok: false, erro: `resultado inválido; use um de ${RESULTADOS_DE_CONTATO.join(', ')}` }
  const corrente = await subtarefaCorrenteDaTarefa(tarefaId)
  if (!corrente) return { ok: false, erro: 'sem subtarefa corrente — nada para registrar' }
  // O ÓRGÃO E O DOCUMENTO DO CONTATO vêm da própria tarefa (Bloco G5): o MESMO
  // `ContatoTerceiro` aparece no Andamento da tarefa (por `tarefaId`) e no
  // histórico do órgão (por `orgaoId`) — um registro, duas projeções.
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { orgaoId: true, documentoId: true, documento: { select: { orgaoId: true } } } })
  const r = await registrarCobranca({
    stepInstanceId: corrente.stepInstanceId, subtaskKey: corrente.subtaskKey,
    canal: 'TELEFONE', resultado, observacao: observacao ?? 'Ligação registrada pela Torre.',
    documentoId: t?.documentoId ?? null, orgaoId: t?.orgaoId ?? t?.documento?.orgaoId ?? null,
    registradoPorId: autorId,
  })
  if (!r.ok) return { ok: false, erro: r.motivo }
  return { ok: true, mensagem: 'Ligação registrada.', tarefaId, contatoId: r.contatoId, cobrancasSemResposta: r.cobrancasSemResposta }
}

const CANAIS_SOLICITACAO = ['CRC', 'ECARTORIO', 'EMAIL', 'WHATSAPP', 'BALCAO', 'COMUNE', 'CORREIOS', 'CONSULADO'] as const

export async function trocarCanal(tarefaId: number, novoCanal: string, autorId: number): Promise<Resultado> {
  if (!(CANAIS_SOLICITACAO as readonly string[]).includes(novoCanal)) return { ok: false, erro: `canal inválido; use um de ${CANAIS_SOLICITACAO.join(', ')}` }
  const solicitacao = await prisma.solicitacaoDocumento.findFirst({ where: { tarefaId }, orderBy: { createdAt: 'desc' }, select: { id: true, canal: true } })
  if (!solicitacao) return { ok: false, erro: 'nenhuma solicitação vinculada a esta tarefa' }
  const de = solicitacao.canal
  if (de === novoCanal) return { ok: false, erro: 'a solicitação já usa este canal' }
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { orgaoId: true, documento: { select: { orgaoId: true } } } })
  await prisma.solicitacaoDocumento.update({ where: { id: solicitacao.id }, data: { canal: novoCanal as never } })
  // UMA linha de auditoria, gravada sob a TAREFA (Bloco G5): é dali que o
  // Andamento da tarefa lê, e o histórico do órgão a encontra por `detalhes.orgaoId`.
  await registrarAuditoriaSimples({
    acao: 'SOLICITACAO_CANAL_ALTERADO', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: autorId,
    descricao: `Canal da solicitação #${solicitacao.id} (tarefa #${tarefaId}) alterado: ${de} → ${novoCanal}.`,
    detalhes: { tarefaId, solicitacaoId: solicitacao.id, orgaoId: t?.orgaoId ?? t?.documento?.orgaoId ?? null, de, para: novoCanal },
  })
  return { ok: true, mensagem: `Canal alterado para ${novoCanal}.`, tarefaId }
}

// ─── BLOQUEADA ───────────────────────────────────────────────────────────────

export async function cobrarCliente(tarefaId: number, autorId: number, texto?: string | null): Promise<Resultado> {
  const tarefa = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { id: true, processoId: true, titulo: true } })
  if (!tarefa) return { ok: false, erro: 'tarefa não encontrada' }
  if (tarefa.processoId == null) return { ok: false, erro: 'tarefa sem processo — sem chat para cobrar' }
  const conteudo = texto?.trim() || `Olá! A tarefa "${tarefa.titulo}" está bloqueada aguardando um retorno seu. Pode nos ajudar?`
  const msg = await prisma.mensagem.create({ data: { processoId: tarefa.processoId, conteudo, usuarioId: autorId } })
  await registrarAuditoriaSimples({
    acao: 'COBRANCA_CLIENTE_BLOQUEIO', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: autorId,
    descricao: `Cobrança ao cliente enviada pelo chat do processo #${tarefa.processoId} (tarefa #${tarefaId} bloqueada). O prazo continua contando.`,
    detalhes: { tarefaId, processoId: tarefa.processoId, mensagemId: msg.id },
  })
  return { ok: true, mensagem: 'Cobrança enviada pelo chat do processo.', tarefaId, mensagemId: msg.id }
}

export async function desbloquear(tarefaId: number, autorId: number, motivo?: string | null): Promise<Resultado> {
  const r = await desbloquearTarefa({ tarefaId, autorId, motivo: motivo ?? null })
  if (!r.ok) return { ok: false, erro: r.mensagem }
  return { ok: true, mensagem: 'Desbloqueada.', tarefaId }
}

// ─── CARGA ───────────────────────────────────────────────────────────────────

const STATUS_ATIVOS_CARGA = ['NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'AGUARDANDO_CLIENTE', 'BLOQUEADA'] as const

/**
 * REDISTRIBUI A CARGA de uma pessoa no limite — o MESMO plano que a lista mostra (`planejarRedistribuicaoDaCarga`): as certidões
 * ainda não iniciadas, o bastante para ficar abaixo do limite, cada uma para quem tem APTIDÃO comprovada e fila livre. Sem apto,
 * nada se move por chute. Cada tarefa é movida pela porta de sempre (`redistribuirTarefas` → `atribuirTarefa`, auditada).
 */
export async function redistribuirPorCarga(usuarioId: number, autorId: number, agora = new Date()): Promise<Resultado> {
  const noLimite = await pessoasNoLimite(agora)
  const pessoa = noLimite.get(usuarioId)
  if (!pessoa) return { ok: false, erro: 'a pessoa não está mais no limite de carga — nada para redistribuir' }
  const [{ linhas }, ctx] = await Promise.all([visaoGerencial({ responsavelId: usuarioId, porPagina: 500 }, agora), carregarContextoDeSugestao(agora)])
  const aIniciar = linhas.filter((l) => l.statusTarefa === 'NAO_INICIADA')
  if (aIniciar.length === 0) return { ok: false, erro: 'nenhuma certidão ainda não iniciada para redistribuir' }
  const alvos = await alvosDeSugestao(aIniciar.map((l) => l.taskId))
  const plano = planejarRedistribuicaoDaCarga({ pessoa, linhas, ctx, alvos, noLimite: new Set(noLimite.keys()) })
  if (plano.movimentos.length === 0) return { ok: false, erro: 'sem pessoa com aptidão comprovada e fila livre para receber — decida pela Equipe' }
  const porDestino = new Map<number, { nome: string; tarefaIds: number[] }>()
  for (const m of plano.movimentos) {
    const d = porDestino.get(m.paraUsuarioId) ?? { nome: m.paraNome, tarefaIds: [] }
    d.tarefaIds.push(m.tarefaId)
    porDestino.set(m.paraUsuarioId, d)
  }
  const itens: Array<{ tarefaId: number; ok: boolean; mensagem?: string }> = []
  for (const [destinoId, d] of porDestino) {
    const r = await redistribuirTarefas({
      tarefaIds: d.tarefaIds, novoResponsavelId: destinoId, autorId,
      motivo: `redistribuição por carga (Precisa de você): ${pessoa.nome} está no limite (${pessoa.executaveis}/${pessoa.limite}); ${d.nome} tem aptidão e fila livre`,
    })
    itens.push(...r.itens)
  }
  const movidas = itens.filter((i) => i.ok)
  if (movidas.length === 0) return { ok: false, erro: itens.find((i) => !i.ok)?.mensagem ?? 'nenhuma certidão pôde ser movida' }
  const resumo = [...porDestino.values()].map((d) => `${d.nome} (${d.tarefaIds.length})`).join(', ')
  return {
    ok: true, mensagem: `${movidas.length} de ${itens.length} ${itens.length === 1 ? 'certidão movida' : 'certidões movidas'} de ${pessoa.nome} para ${resumo}.`,
    total: itens.length, sucesso: movidas.length, itens, responsavelId: [...porDestino.keys()][0],
  }
}

export async function verEquipe(usuarioId: number): Promise<Resultado> {
  const { lerOrganizacao } = await import('@/lib/operacional/organizacao')
  const org = await lerOrganizacao()
  const alvo = org.get(usuarioId)
  const equipe = alvo?.equipes.map((e) => e.id) ?? []
  const colegas = [...org.values()].filter((o) => o.usuarioId !== usuarioId && o.equipes.some((e) => equipe.includes(e.id)))
  return { ok: true, mensagem: 'Equipe.', colegas: colegas.map((c) => ({ usuarioId: c.usuarioId, nome: c.nome, limiteExecutaveis: c.limiteExecutaveis })) }
}

// ─── PAREDE À FRENTE ─────────────────────────────────────────────────────────

export async function abrirGerenciamento(achadoId: number): Promise<Resultado> {
  const achado = await prisma.saudeAchado.findUnique({ where: { id: achadoId }, select: { link: true, titulo: true } })
  if (!achado) return { ok: false, erro: 'achado não encontrado' }
  return { ok: true, mensagem: 'Link do Gerenciamento.', link: achado.link ?? '/administrator?screen=syshealth', titulo: achado.titulo }
}

export async function ignorar7Dias(achadoId: number, justificativa: string, autorId: number): Promise<Resultado> {
  const r = await ignorarAchado({ achadoId, dias: 7, justificativa, autorId })
  if (!r.ok) return { ok: false, erro: r.erro }
  await registrarAuditoriaSimples({
    acao: 'SAUDE_ACHADO_IGNORADO', entidade: 'SaudeAchado', entidadeId: achadoId, usuarioId: autorId,
    descricao: `Achado #${achadoId} ignorado por 7 dias (Precisa de você). Justificativa: ${justificativa}`,
    detalhes: { achadoId, ignoradoAte: r.ignoradoAte.toISOString() },
  })
  return { ok: true, mensagem: `Ignorado até ${r.ignoradoAte.toISOString().slice(0, 10)}.`, achadoId }
}

// ─── DESFAZER ────────────────────────────────────────────────────────────────

/**
 * DESFAZ uma atribuição — individual ou em lote (o caller passa 1 ou N ids).
 * Lê o PRÓPRIO LogAuditoria da atribuição (nunca uma tabela paralela de
 * "pendências de desfazer"): se a tarefa ainda está exatamente como a
 * atribuição a deixou (`para` == responsável atual), volta para `de`
 * (ou para a fila, se `de` era nulo). Se algo mudou depois, recusa — desfazer
 * uma decisão que já foi sobreposta por outra apagaria a mais recente.
 */
export async function desfazerAtribuicao(tarefaIds: number[], autorId: number, origem = 'Precisa de você'): Promise<{
  total: number; desfeitas: number; itens: Array<{ tarefaId: number; ok: boolean; mensagem: string }>
}> {
  const itens: Array<{ tarefaId: number; ok: boolean; mensagem: string }> = []
  for (const tarefaId of [...new Set(tarefaIds)]) {
    const tarefa = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { id: true, responsavelId: true, titulo: true } })
    if (!tarefa) { itens.push({ tarefaId, ok: false, mensagem: 'tarefa não encontrada' }); continue }

    const ultimaAtribuicao = await prisma.logAuditoria.findFirst({
      where: { entidade: 'Tarefa', entidadeId: tarefaId, acao: { in: ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA'] } },
      orderBy: { criadoEm: 'desc' }, select: { id: true, detalhes: true },
    })
    const detalhes = ultimaAtribuicao?.detalhes as { de: number | null; para: number | null } | null
    if (!ultimaAtribuicao || detalhes == null) { itens.push({ tarefaId, ok: false, mensagem: 'nenhuma atribuição para desfazer' }); continue }
    if (detalhes.para !== tarefa.responsavelId) {
      itens.push({ tarefaId, ok: false, mensagem: 'a tarefa mudou de responsável desde então — desfazer recusado' })
      continue
    }

    const r = detalhes.de == null
      ? await devolverAFila({ tarefaId, autorId, motivo: `desfazer atribuição (${origem})` })
      : await atribuirTarefa({ tarefaId, responsavelId: detalhes.de, autorId, motivo: `desfazer atribuição (${origem})` })
    if (!r.ok) { itens.push({ tarefaId, ok: false, mensagem: r.mensagem }); continue }

    await registrarAuditoriaSimples({
      acao: 'TAREFA_ATRIBUICAO_DESFEITA', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: autorId,
      descricao: `Atribuição de "${tarefa.titulo}" desfeita: volta para ${detalhes.de ?? 'a fila'}.`,
      detalhes: { tarefaId, revertidoDe: tarefa.responsavelId, revertidoPara: detalhes.de },
    })
    itens.push({ tarefaId, ok: true, mensagem: 'desfeita' })
  }
  return { total: itens.length, desfeitas: itens.filter((i) => i.ok).length, itens }
}

/**
 * DESFAZ UM DESBLOQUEIO: bloqueia de novo, com o motivo que a tarefa tinha. Só desfaz se o último fato da tarefa AINDA é o desbloqueio
 * (nada aconteceu depois) e ela não está bloqueada.
 */
export async function desfazerDesbloqueio(tarefaId: number, autorId: number): Promise<Resultado> {
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { id: true, statusTarefa: true, justificativa: true } })
  if (!t) return { ok: false, erro: 'tarefa não encontrada' }
  if (t.statusTarefa === 'BLOQUEADA') return { ok: false, erro: 'a tarefa já está bloqueada' }
  const ultimo = await prisma.logAuditoria.findFirst({ where: { entidade: 'Tarefa', entidadeId: tarefaId }, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], select: { acao: true } })
  if (ultimo?.acao !== 'TAREFA_DESBLOQUEADA') return { ok: false, erro: 'a tarefa mudou desde o desbloqueio — desfazer recusado' }
  const r = await bloquearTarefa({ tarefaId, autorId, motivo: t.justificativa?.trim() || 'bloqueio restaurado (desfazer)' })
  if (!r.ok) return { ok: false, erro: r.mensagem }
  await registrarAuditoriaSimples({
    acao: 'TAREFA_DESBLOQUEIO_DESFEITO', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: autorId,
    descricao: `Desbloqueio da tarefa #${tarefaId} desfeito: a tarefa voltou a BLOQUEADA.`, detalhes: { tarefaId },
  })
  return { ok: true, mensagem: 'Desbloqueio desfeito.', tarefaId }
}

/** DESFAZ A TROCA DE CANAL: devolve à solicitação o canal anterior (lido do PRÓPRIO log da troca). Recusa se o canal já mudou de novo. */
export async function desfazerTrocaDeCanal(tarefaId: number, autorId: number): Promise<Resultado> {
  const log = await prisma.logAuditoria.findFirst({
    where: { entidade: 'Tarefa', entidadeId: tarefaId, acao: 'SOLICITACAO_CANAL_ALTERADO' }, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], select: { detalhes: true },
  })
  const d = log?.detalhes as { solicitacaoId?: number; de?: string; para?: string } | null
  if (!d?.solicitacaoId || !d.de || !d.para) return { ok: false, erro: 'nenhuma troca de canal para desfazer' }
  const sol = await prisma.solicitacaoDocumento.findUnique({ where: { id: d.solicitacaoId }, select: { canal: true } })
  if (!sol || sol.canal !== d.para) return { ok: false, erro: 'o canal mudou desde a troca — desfazer recusado' }
  await prisma.solicitacaoDocumento.update({ where: { id: d.solicitacaoId }, data: { canal: d.de as never } })
  await registrarAuditoriaSimples({
    acao: 'SOLICITACAO_CANAL_ALTERADO', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: autorId,
    descricao: `Troca de canal da solicitação #${d.solicitacaoId} (tarefa #${tarefaId}) desfeita: ${d.para} → ${d.de}.`,
    detalhes: { tarefaId, solicitacaoId: d.solicitacaoId, de: d.para, para: d.de, desfazer: true },
  })
  return { ok: true, mensagem: `Canal devolvido para ${d.de}.`, tarefaId }
}
