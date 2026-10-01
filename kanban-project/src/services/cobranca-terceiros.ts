// src/services/cobranca-terceiros.ts
// ============================================================================
// COBRAR TERCEIROS — a porta ÚNICA das cobranças em massa e por órgão
// (Torre de Controle, Bloco G, 30/09/2026).
//
// Não existe implementação nova de cobrança aqui: cada cobrança é
// `registrarCobranca` (subtarefas-da-etapa.ts) — o mesmo fato `ContatoTerceiro`,
// o mesmo reagendamento e a mesma escalada do cadastro. Este arquivo só resolve
// (a) QUAL subtarefa, (b) QUAL canal e (c) A QUAL ÓRGÃO o contato pertence, e
// aplica a regra de posse. Antes ele vivia dentro da rota `cobrar-todos-vencidos`;
// virou serviço para a cobrança POR ÓRGÃO e o lote da Torre usarem a MESMA conta.
//
// O ÓRGÃO É SEMPRE GRAVADO no contato (`Tarefa.orgaoId`, ou o do documento para
// as tarefas anteriores ao Bloco C): é o que faz o histórico do órgão ("Contatos")
// enxergar cobrança feita por qualquer porta, sem duplicar registro.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { dentroDaJanelaDoDesfazer } from '@/lib/operacional/torre-desfazer'
import {
  registrarCobranca, subtarefaCorrenteDaTarefa, estadoOperacaoDaTarefa,
  CANAIS_DE_CONTATO, RESULTADOS_DE_CONTATO,
} from '@/src/services/subtarefas-da-etapa'

export const CANAIS_VALIDOS = new Set<string>(CANAIS_DE_CONTATO)
export const RESULTADOS_VALIDOS = new Set<string>(RESULTADOS_DE_CONTATO)

/** Canal da SOLICITAÇÃO → canal de CONTATO com o terceiro. Só os que têm equivalente direto. */
const CONTATO_DA_SOLICITACAO: Record<string, string> = {
  EMAIL: 'EMAIL', WHATSAPP: 'WHATSAPP', BALCAO: 'PRESENCIAL', CORREIOS: 'OFICIO',
}

/**
 * O CANAL CADASTRADO de cada tarefa — para "cobrar pelo canal cadastrado":
 *   1. o canal da SOLICITAÇÃO mais recente, quando tem equivalente de contato;
 *   2. senão o que o cadastro do ÓRGÃO permite (e-mail, depois telefone);
 *   3. senão EMAIL (o padrão histórico das cobranças).
 * Em lote, sem uma consulta por tarefa.
 */
export async function canaisCadastrados(tarefaIds: number[]): Promise<Map<number, { canal: string; origem: 'solicitacao' | 'orgao' | 'padrao' }>> {
  const saida = new Map<number, { canal: string; origem: 'solicitacao' | 'orgao' | 'padrao' }>()
  if (tarefaIds.length === 0) return saida
  const [tarefas, solicitacoes] = await Promise.all([
    prisma.tarefa.findMany({
      where: { id: { in: tarefaIds } },
      select: { id: true, orgao: { select: { email: true, telefone: true } }, documento: { select: { orgao: { select: { email: true, telefone: true } } } } },
    }),
    prisma.solicitacaoDocumento.findMany({
      where: { tarefaId: { in: tarefaIds } }, orderBy: { id: 'desc' }, select: { tarefaId: true, canal: true },
    }),
  ])
  const ultima = new Map<number, string>()
  for (const s of solicitacoes) if (s.tarefaId != null && !ultima.has(s.tarefaId)) ultima.set(s.tarefaId, s.canal)
  for (const t of tarefas) {
    const daSolicitacao = ultima.get(t.id)
    if (daSolicitacao && CONTATO_DA_SOLICITACAO[daSolicitacao]) { saida.set(t.id, { canal: CONTATO_DA_SOLICITACAO[daSolicitacao], origem: 'solicitacao' }); continue }
    const orgao = t.orgao ?? t.documento?.orgao ?? null
    if (orgao?.email) saida.set(t.id, { canal: 'EMAIL', origem: 'orgao' })
    else if (orgao?.telefone) saida.set(t.id, { canal: 'TELEFONE', origem: 'orgao' })
    else saida.set(t.id, { canal: 'EMAIL', origem: 'padrao' })
  }
  return saida
}

export interface CobrancaIgnorada { tarefaId: number; motivo: string }

/**
 * COBRA UM CONJUNTO DE TAREFAS. Uma cobrança por tarefa (fato próprio de cada
 * uma). `canal` ausente = o canal cadastrado de CADA tarefa. Não-admin só cobra
 * as próprias (a mesma regra de posse das outras portas de cobrança).
 * `exigirAguardando` (lote da Torre) recusa tarefa que NÃO está com o terceiro —
 * cobrar quem não está esperando ninguém não é cobrança, é ruído no histórico.
 */
export async function cobrarTarefas(args: {
  tarefaIds: number[]
  autor: { userId: number; tipo: string }
  canal?: string | null
  resultado?: string
  observacao?: string | null
  dataContato?: Date | null
  /** "Próxima cobrança em (dias)" (Torre › Terceiros): dias corridos a partir de agora. Ausente = a régua do cadastro. */
  proximaEmDias?: number | null
  exigirAguardando?: boolean
}): Promise<{ cobradas: Array<{ tarefaId: number; contatoId: number; canal: string; orgaoId: number | null }>; ignoradas: CobrancaIgnorada[] }> {
  const ids = [...new Set(args.tarefaIds)]
  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, responsavelId: true, statusTarefa: true, dataPrazo: true, workflowStepInstanceId: true,
      orgaoId: true, documentoId: true, documento: { select: { orgaoId: true } },
    },
  })
  const cobradas: Array<{ tarefaId: number; contatoId: number; canal: string; orgaoId: number | null }> = []
  const ignoradas: CobrancaIgnorada[] = []
  const achadas = new Set(tarefas.map((t) => t.id))
  for (const id of ids) if (!achadas.has(id)) ignoradas.push({ tarefaId: id, motivo: 'tarefa não encontrada' })

  const canais = args.canal ? null : await canaisCadastrados(tarefas.map((t) => t.id))
  const resultado = args.resultado ?? 'SEM_RESPOSTA'

  for (const t of tarefas) {
    if (args.autor.tipo !== 'admin' && t.responsavelId !== args.autor.userId) {
      ignoradas.push({ tarefaId: t.id, motivo: 'não é o responsável' }); continue
    }
    if (args.exigirAguardando) {
      const e = await estadoOperacaoDaTarefa({ stepInstanceId: t.workflowStepInstanceId, statusTarefa: t.statusTarefa, dataPrazo: t.dataPrazo })
      if (e.estado !== 'AGUARDANDO') { ignoradas.push({ tarefaId: t.id, motivo: 'não está com o terceiro — nada a cobrar' }); continue }
    }
    const corrente = await subtarefaCorrenteDaTarefa(t.id)
    if (!corrente) { ignoradas.push({ tarefaId: t.id, motivo: 'sem subtarefa em aberto' }); continue }
    const canal = args.canal ?? canais?.get(t.id)?.canal ?? 'EMAIL'
    const orgaoId = t.orgaoId ?? t.documento?.orgaoId ?? null
    const r = await registrarCobranca({
      stepInstanceId: corrente.stepInstanceId, subtaskKey: corrente.subtaskKey, canal, resultado,
      observacao: args.observacao ?? null, documentoId: t.documentoId ?? null, orgaoId,
      registradoPorId: args.autor.userId, dataContato: args.dataContato ?? null, proximaEmDias: args.proximaEmDias ?? null,
    })
    if (r.ok) cobradas.push({ tarefaId: t.id, contatoId: r.contatoId, canal, orgaoId })
    else ignoradas.push({ tarefaId: t.id, motivo: r.motivo })
  }
  return { cobradas, ignoradas }
}

// ─── ESTORNO (DESFAZER "REGISTRAR COBRANÇA") ─────────────────────────────────

export interface ResultadoDoEstorno { contatoId: number; tarefaId: number | null; ok: boolean; mensagem: string }

const mesmoInstante = (a: Date | null | undefined, b: Date | null | undefined) => (a?.getTime() ?? null) === (b?.getTime() ?? null)

/**
 * ESTORNA uma cobrança — o "Desfazer" de "Registrar cobrança". `ContatoTerceiro` é fato append-only: o estorno NÃO apaga a linha,
 * MARCA-A (`estornadoEm/estornadoPorId`) e devolve à execução da subtarefa o estado que a cobrança encontrou (próxima cobrança e escalada),
 * guardado na própria linha ao cobrar. Todo leitor que conta "sem resposta", escalada, última cobrança ou histórico ignora (ou risca) o estornado.
 *
 * As MESMAS regras dos outros Desfazer da Torre: só o AUTOR da cobrança, só dentro da janela única (`lib/operacional/torre-desfazer.ts`) e só se
 * NADA MUDOU DEPOIS — a cobrança é a última não estornada da execução, a execução é a vigente e ainda espera, e a próxima cobrança agendada
 * ainda é a que esta cobrança marcou. Cobrança antiga (sem o estado guardado) não se desfaz. Grava a própria auditoria (`COBRANCA_ESTORNADA`).
 */
export async function estornarCobranca(args: { contatoId: number; autorId: number; agora?: Date }): Promise<ResultadoDoEstorno> {
  const agora = args.agora ?? new Date()
  const recusa = (mensagem: string, tarefaId: number | null = null): ResultadoDoEstorno => ({ contatoId: args.contatoId, tarefaId, ok: false, mensagem })
  const contato = await prisma.contatoTerceiro.findUnique({ where: { id: args.contatoId } })
  if (!contato) return recusa('cobrança não encontrada')
  const tarefaId = contato.tarefaId
  if (contato.estornadoEm) return recusa('esta cobrança já foi desfeita', tarefaId)
  if (contato.registradoPorId !== args.autorId) return recusa('só se desfaz a ação recente, feita por você — passou o tempo do "Desfazer"', tarefaId)
  if (!dentroDaJanelaDoDesfazer(contato.registradoEm, agora)) return recusa('só se desfaz a ação recente, feita por você — passou o tempo do "Desfazer"', tarefaId)
  if (contato.antesEscalada == null) return recusa('cobrança anterior ao Desfazer — não há estado guardado para devolver', tarefaId)

  const exec = await prisma.subtaskExecution.findUnique({
    where: { id: contato.subtaskExecutionId },
    select: { id: true, stepInstanceId: true, subtaskKey: true, supersededAt: true, status: true, proximoAcompanhamentoEm: true },
  })
  if (!exec || exec.supersededAt != null) return recusa('a etapa foi reaberta desde então — desfazer recusado', tarefaId)
  if (exec.status === 'CONCLUIDO') return recusa('a etapa já foi concluída desde então — desfazer recusado', tarefaId)
  const posterior = await prisma.contatoTerceiro.findFirst({
    where: { subtaskExecutionId: contato.subtaskExecutionId, estornadoEm: null, id: { gt: contato.id } }, select: { id: true },
  })
  if (posterior) return recusa('houve outro contato com o terceiro depois desta cobrança — desfazer recusado', tarefaId)
  if (!mesmoInstante(exec.proximoAcompanhamentoEm, contato.depoisProximoAcompanhamentoEm)) return recusa('a próxima cobrança foi reagendada desde então — desfazer recusado', tarefaId)

  const { registrarNaExecucao } = await import('@/src/services/execucao-da-subtarefa')
  const marcado = await prisma.contatoTerceiro.updateMany({ where: { id: contato.id, estornadoEm: null }, data: { estornadoEm: agora, estornadoPorId: args.autorId } })
  if (marcado.count === 0) return recusa('esta cobrança já foi desfeita', tarefaId)
  await registrarNaExecucao(exec.stepInstanceId, exec.subtaskKey, {
    proximoAcompanhamentoEm: contato.antesProximoAcompanhamentoEm, escalada: contato.antesEscalada, escaladaEm: contato.antesEscaladaEm,
  })
  await prisma.logAuditoria.create({
    data: {
      acao: 'COBRANCA_ESTORNADA', entidade: 'Tarefa', entidadeId: tarefaId, usuarioId: args.autorId,
      descricao: `Cobrança a terceiro desfeita (estornada): o contato #${contato.id} fica no histórico, riscado, e a próxima cobrança volta a ${contato.antesProximoAcompanhamentoEm ? contato.antesProximoAcompanhamentoEm.toISOString().slice(0, 10) : 'nenhuma data marcada'}.`,
      detalhes: JSON.parse(JSON.stringify({ contatoId: contato.id, canal: contato.canal, resultado: contato.resultado, restaurado: { proximoAcompanhamentoEm: contato.antesProximoAcompanhamentoEm, escalada: contato.antesEscalada, escaladaEm: contato.antesEscaladaEm } })),
    },
  })
  return { contatoId: contato.id, tarefaId, ok: true, mensagem: 'cobrança desfeita' }
}

export async function estornarCobrancas(args: { contatoIds: number[]; autorId: number; agora?: Date }): Promise<{ total: number; desfeitas: number; itens: ResultadoDoEstorno[] }> {
  const itens: ResultadoDoEstorno[] = []
  // Do mais novo ao mais antigo: o estorno de duas cobranças da mesma execução só passa na ordem inversa ("nada mudou depois").
  for (const id of [...new Set(args.contatoIds)].sort((a, b) => b - a)) itens.push(await estornarCobranca({ contatoId: id, autorId: args.autorId, agora: args.agora }))
  return { total: itens.length, desfeitas: itens.filter((i) => i.ok).length, itens }
}
