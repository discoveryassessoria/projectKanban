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
import { cancelarTarefa, desbloquearTarefa, devolverAFila } from '@/lib/operacional/tarefa-ciclo'
import { sugerirResponsavelPrecisaDeVoce } from '@/lib/operacional/precisa-de-voce'
import { ignorarAchado } from '@/lib/saude/persistencia'
import { subtarefaCorrenteDaTarefa, registrarCobranca, RESULTADOS_DE_CONTATO } from '@/src/services/subtarefas-da-etapa'
import { projetarTarefaDoPasso, paresCoerentes, STATUS_TAREFA_POR_PASSO } from '@/src/services/passo-tarefa-projecao'

type Resultado = { ok: true; mensagem: string; [k: string]: unknown } | { ok: false; erro: string }

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

export async function atribuirSugerido(tarefaId: number, autorId: number): Promise<Resultado> {
  const s = await sugerirResponsavelPrecisaDeVoce(tarefaId)
  if (!s) return { ok: false, erro: 'Nenhum candidato apto e disponível encontrado.' }
  const r = await atribuirTarefa({ tarefaId, responsavelId: s.usuarioId, autorId, motivo: `sugestão do Precisa de você: ${s.motivo}` })
  if (!r.ok) return { ok: false, erro: r.mensagem }
  return { ok: true, mensagem: `Atribuída a ${s.nome}.`, tarefaId, responsavelId: s.usuarioId }
}

export async function atribuirEscolhido(tarefaId: number, responsavelId: number, autorId: number): Promise<Resultado> {
  const r = await atribuirTarefa({ tarefaId, responsavelId, autorId, motivo: 'escolhido manualmente no Precisa de você (não a sugestão)' })
  if (!r.ok) return { ok: false, erro: r.mensagem }
  return { ok: true, mensagem: 'Atribuída.', tarefaId, responsavelId }
}

export async function encerrarNaoDevida(tarefaId: number, justificativa: string, autorId: number): Promise<Resultado> {
  const r = await cancelarTarefa({ tarefaId, autorId, motivo: justificativa, codigo: 'NAO_DEVIDA' })
  if (!r.ok) return { ok: false, erro: r.mensagem }
  return { ok: true, mensagem: 'Encerrada como não devida.', tarefaId }
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
  return { ok: true, mensagem: `Reconciliada: ${de} → ${resultado.para}.`, tarefaId }
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

export async function redistribuirPorCarga(usuarioId: number, autorId: number, limite = 5): Promise<Resultado> {
  const aEnviar = await prisma.tarefa.findMany({
    where: { responsavelId: usuarioId, statusTarefa: 'NAO_INICIADA' },
    select: { id: true }, orderBy: { dataPrazo: 'asc' }, take: Math.max(limite, 1),
  })
  if (aEnviar.length === 0) return { ok: false, erro: 'nenhuma tarefa "a enviar" para redistribuir' }
  const destino = await sugerirResponsavelPrecisaDeVoce(aEnviar[0].id)
  if (!destino || destino.usuarioId === usuarioId) return { ok: false, erro: 'sem candidato alternativo de menor carga' }
  const r = await redistribuirTarefas({
    tarefaIds: aEnviar.map((t) => t.id), novoResponsavelId: destino.usuarioId, autorId,
    motivo: `redistribuição por carga (Precisa de você): ${destino.motivo}`,
  })
  return { ok: true, mensagem: `${r.sucesso} de ${r.total} tarefa(s) movida(s) para ${destino.nome}.`, ...r, responsavelId: destino.usuarioId }
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
