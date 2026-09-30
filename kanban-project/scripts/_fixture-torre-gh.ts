// scripts/_fixture-torre-gh.ts
// ============================================================================
// FIXTURE COMPARTILHADA DOS TESTES DA TORRE (Blocos G e H, 30/09/2026).
// Monta, no banco de TESTE, um tipo de processo + workflow publicado (passo com
// duas subtarefas: enviar → aguardar o cartório) e cria, sob demanda, "obrigações":
// um processo, uma Tarefa canônica materializada pelo motor, opcionalmente já
// AGUARDANDO o terceiro. Nada aqui é dado de produção.
// ============================================================================
import { prisma } from "../lib/prisma"
import { publicarWorkflow } from "../src/services/publicacao-de-workflow"
import { instanciarWorkflowDaFase } from "../src/services/phase-workflow"
import { garantirTarefaDePasso } from "../src/services/passo-tarefa"
import { concluirSubtarefaCorrentePeloPasso } from "../src/services/subtarefas-da-etapa"

export interface Obrigacao { processoId: number; tarefaId: number; stepInstanceId: number }

export interface SubtarefaDaFixture { key: string; label: string; ordem: number; espera: boolean; dependeDe: string[] }

/** `subs` (opcional) troca as duas subtarefas padrão — p.ex. pelas chaves reais da Emissão (enviar → confirmar → receber → validar). */
export async function montarCenario(MARCA: string, opcoes: { diasAposCobranca?: number; escalarApos?: number; slaDays?: number; subs?: SubtarefaDaFixture[] } = {}) {
  const TIPO_CODE = "TST-" + MARCA.replace(/[^A-Z0-9]/gi, "").slice(0, 30)
  const PHASE_KEY = `${MARCA.toLowerCase()}_fase`

  async function limpar() {
    const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
    const ids = procs.map((p) => p.id)
    const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })).map((t) => t.id)
    await prisma.contatoTerceiro.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ entidade: "Tarefa", entidadeId: { in: [0, ...tarefaIds] } }, { descricao: { contains: MARCA } }, { entidade: { in: ["RegraTorre", "OrgaoProtocolo"] } }] } })
    await prisma.solicitacaoDocumento.deleteMany({ where: { tarefaId: { in: tarefaIds } } })
    await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
    for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
    await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.faseMacro.deleteMany({ where: { phaseKey: PHASE_KEY } })
    await prisma.macroWorkflow.deleteMany({ where: { name: { startsWith: MARCA } } })
    await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
    await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcesso: { code: TIPO_CODE } } })
    await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: TIPO_CODE } })
    await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } })
    await prisma.configuracaoSistema.deleteMany({ where: { chave: { startsWith: "torre.regra." } } })
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  }

  await limpar()
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const modalidadeBase = await prisma.modalidadePais.findFirstOrThrow({ where: { ativo: true }, orderBy: { id: "asc" } })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: TIPO_CODE }, update: {},
    create: { code: TIPO_CODE, name: `${MARCA} tipo`, paisId: modalidadeBase.paisId, processFamily: "cidadania", serviceNature: "main_process" },
    select: { id: true },
  })
  let habilitacao = await prisma.tipoProcessoModalidadeHabilitada.findFirst({ where: { tipoProcessoId: tipo.id } })
  if (!habilitacao) {
    habilitacao = await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: modalidadeBase.id, ativo: true } })
  }
  const macro = await prisma.macroWorkflow.upsert({
    where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId } },
    update: {}, create: { tipoProcessoId: tipo.id, modalidadeId: habilitacao.modalidadeId, name: `${MARCA} macro` }, select: { id: true },
  })
  await prisma.faseMacro.upsert({
    where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY } },
    update: {}, create: { macroWorkflowId: macro.id, phaseKey: PHASE_KEY, label: PHASE_KEY }, select: { id: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}-wf`, phaseKey: PHASE_KEY, name: `${MARCA} wf`, active: true, tipoProcessoId: tipo.id, escopoExecucao: "PROCESSO" }, select: { id: true },
  })
  const step = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: "solicitar_certidao", label: `${MARCA} Solicitar certidão`, ordem: 1, slaDays: opcoes.slaDays ?? 0, cardinalidade: "PROCESSO",
      diasParaIniciar: 2, diasAposCobranca: opcoes.diasAposCobranca ?? 1, escalarApos: opcoes.escalarApos ?? 2,
    },
    select: { id: true },
  })
  const SUBS: SubtarefaDaFixture[] = opcoes.subs ?? [
    { key: "enviar_requerimento", label: "Enviar requerimento", ordem: 0, espera: false, dependeDe: [] as string[] },
    { key: "aguardar_retorno", label: "Aguardar retorno do cartório", ordem: 1, espera: true, dependeDe: ["enviar_requerimento"] },
  ]
  for (const s of SUBS) {
    const criada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: step.id, key: s.key, label: s.label, ordem: s.ordem, esperaExternaAoLiberar: s.espera,
        acompanhamentoAtivo: s.espera, acompanhamentoPrimeiroDias: s.espera ? 5 : null, dependeDe: s.dependeDe,
      },
      select: { id: true },
    })
    await prisma.stepAction.create({ data: { stepId: step.id, subtaskId: criada.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
  }
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
  if (!pub.ok) throw new Error(`publicação da fixture falhou: ${JSON.stringify(pub).slice(0, 200)}`)

  let seq = 0
  /** Uma obrigação: processo + tarefa materializada. `aguardando` já conclui a entrada (fica com o terceiro). */
  async function novaObrigacao(o: { aguardando?: boolean; orgaoId?: number | null; responsavelId?: number | null; dataPrazo?: Date | null; comSolicitacao?: { canal: 'CRC' | 'ECARTORIO' | 'EMAIL' | 'WHATSAPP' | 'BALCAO' | 'COMUNE' | 'CORREIOS' | 'CONSULADO' } } = {}): Promise<Obrigacao & { documentoId: number | null }> {
    seq++
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv ${seq}` }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `${MARCA} proc ${seq}`, arvoreId: arv.id, faseAtualKey: PHASE_KEY, workflowRuntime: "v2", tipoProcessoMotorId: tipo.id, modalidadeId: habilitacao!.modalidadeId },
      select: { id: true },
    })
    const r = await instanciarWorkflowDaFase({ processoId: proc.id, faseMacroKey: PHASE_KEY })
    if (!r.success) throw new Error(`instanciar falhou: ${JSON.stringify(r).slice(0, 200)}`)
    const stepInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { workflowInstanceId: r.workflowInstance.id }, select: { id: true } })
    await garantirTarefaDePasso({ stepInstanceId: stepInst.id })
    const tarefa = await prisma.tarefa.findFirstOrThrow({ where: { workflowStepInstanceId: stepInst.id }, select: { id: true } })
    if (o.aguardando) await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: stepInst.id, executadoPorId: null, payload: {} })
    await prisma.tarefa.update({
      where: { id: tarefa.id },
      data: {
        ...(o.orgaoId !== undefined ? { orgaoId: o.orgaoId } : {}),
        ...(o.responsavelId !== undefined ? { responsavelId: o.responsavelId, dataAtribuicao: o.responsavelId ? new Date() : null } : {}),
        ...(o.dataPrazo !== undefined ? { dataPrazo: o.dataPrazo } : {}),
      },
    })
    // Solicitação real (canal do pedido): precisa de Pessoa + Documento na árvore do processo.
    let documentoId: number | null = null
    if (o.comSolicitacao) {
      const pessoa = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `${MARCA} P${seq}`, sobrenome: "Teste", linhaReta: true, requerente: "nao" }, select: { id: true } })
      const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: `${MARCA} doc ${seq}` }, select: { id: true } })
      documentoId = doc.id
      await prisma.tarefa.update({ where: { id: tarefa.id }, data: { documentoId: doc.id } })
      await prisma.solicitacaoDocumento.create({
        data: {
          documentoId: doc.id, processoId: proc.id, pessoaId: pessoa.id, faseMacroKey: PHASE_KEY, tarefaId: tarefa.id,
          canal: o.comSolicitacao.canal, dataEnvio: new Date(), orgaoId: o.orgaoId ?? null, chaveIdempotencia: `${MARCA}-sol-${seq}`,
        },
      })
    }
    return { processoId: proc.id, tarefaId: tarefa.id, stepInstanceId: stepInst.id, documentoId }
  }

  async function novoOrgao(nome: string, extra: { email?: string; telefone?: string; state?: string } = {}) {
    return prisma.orgaoProtocolo.create({ data: { name: `${MARCA} ${nome}`, type: "cartorio", ...extra }, select: { id: true, name: true } })
  }

  return { PHASE_KEY, TIPO_CODE, novaObrigacao, novoOrgao, limpar, tipoId: tipo.id }
}
