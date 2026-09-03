// src/services/tarefa-transversal.ts
//
// TAREFA TRANSVERSAL — ação operacional ANTECIPADA de OUTRA fase, executada para resolver
// uma necessidade da fase ATUAL, SEM avançar o Macro Workflow. É uma Tarefa oficial
// (tipo=TRANSVERSAL) estendida — NÃO é uma WorkflowStepInstance da fase futura (isso
// iniciaria indevidamente o workflow da fase seguinte). O documento e seu workflow oficial
// continuam sendo a execução real; a Transversal é o VÍNCULO + objetivo.
//
// Regras: nunca altera a fase ativa; nunca materializa a fase futura; ao concluir com
// resolução da necessidade, chama os MOTORES OFICIAIS (atenderNecessidade → BlockingEngine
// via projeção → PhaseAdvanceService via tentarAvancoAutomatico). Idempotente onde aplicável.

import { prisma } from "@/lib/prisma"
import { criarTarefaManual, concluirTarefaSemWorkflow, cancelarTarefa } from "@/lib/operacional/tarefa-ciclo"
import { type FaseCode } from "@prisma/client"
import { atenderNecessidade } from "@/src/services/necessidade-documental"
import { tentarAvancoAutomaticoSeNecessidadeDaFaseAtual } from "@/src/lib/motor/auto-avanco"
import { phaseKeyToFaseCode, FASES } from "@/src/lib/process-stage/fases-catalog"

const INSTANCIA_ATIVA = ["ATIVO", "AGUARDANDO", "BLOQUEADO"] as const

async function audit(acao: string, tarefaId: number, descricao: string, usuarioId?: number | null) {
  await prisma.logAuditoria.create({
    data: { acao, entidade: "TAREFA_TRANSVERSAL", entidadeId: tarefaId, descricao: descricao.slice(0, 500), usuarioId: usuarioId ?? null },
  }).catch(() => {})
}

/** Ações de catálogo válidas de uma fase (steps + processSteps). Sem texto livre. */
export function acoesDaFase(faseCode: FaseCode): Array<{ stepKey: string; title: string }> {
  const def = FASES[faseCode]
  if (!def) return []
  const de = (arr: Array<{ stepKey: string; title: string }> | undefined) => (arr ?? []).map((s) => ({ stepKey: s.stepKey, title: s.title }))
  return [...de(def.steps as never), ...de(def.processSteps as never)]
}

export interface CriarTransversalInput {
  processoId: number
  necessidadeOrigemId: number
  faseReferenciaCode: string
  acaoStepKey: string
  pessoaId?: number | null
  documentoId?: number | null
  tipoDocumentoId?: number | null
  motivo?: string | null
  resultadoEsperado?: string | null
  responsavelId?: number | null
  prazo?: Date | null
  titulo?: string
  usuarioId?: number | null
}

export async function criarTarefaTransversal(input: CriarTransversalInput) {
  const proc = await prisma.processo.findUnique({ where: { id: input.processoId }, select: { id: true, faseAtualKey: true } })
  if (!proc) throw new Error("Processo não encontrado")

  const faseRefCode = phaseKeyToFaseCode(input.faseReferenciaCode) ?? (FASES[input.faseReferenciaCode as FaseCode] ? (input.faseReferenciaCode as FaseCode) : null)
  if (!faseRefCode) throw new Error(`Fase de referência inválida: ${input.faseReferenciaCode}`)
  // ação DEVE existir no catálogo da fase de referência (não permitir texto livre)
  const acaoOk = acoesDaFase(faseRefCode).some((a) => a.stepKey === input.acaoStepKey)
  if (!acaoOk) throw new Error(`Ação "${input.acaoStepKey}" não existe no catálogo da fase ${faseRefCode}`)

  // necessidade de origem tem de pertencer ao processo
  const nec = await prisma.necessidadeDocumental.findUnique({ where: { id: input.necessidadeOrigemId }, select: { id: true, processoId: true, pessoaId: true } })
  if (!nec || nec.processoId !== input.processoId) throw new Error("Necessidade de origem não pertence ao processo")

  const faseOrigemKey = proc.faseAtualKey ?? null
  const faseOrigemCode = phaseKeyToFaseCode(faseOrigemKey)
  const inst = faseOrigemKey
    ? await prisma.phaseWorkflowInstance.findFirst({ where: { processoId: input.processoId, faseMacroKey: faseOrigemKey, status: { in: INSTANCIA_ATIVA as unknown as never } }, orderBy: { ciclo: "desc" }, select: { id: true } })
    : null

  const labelRef = FASES[faseRefCode]?.label ?? faseRefCode
  const titulo = (input.titulo ?? `Transversal · ${input.acaoStepKey} (${labelRef})`).slice(0, 200)

  // A TAREFA NASCE PELA PORTA CANÔNICA.
  //
  // Aqui havia um `prisma.tarefa.create` próprio — a segunda origem de tarefa
  // do sistema, com o seu próprio jeito de definir status inicial e
  // responsabilidade. O que é DA TRANSVERSAL (fase de referência, ação do
  // catálogo, resultado esperado) viaja como campos de domínio na MESMA
  // criação; o que é da mecânica da tarefa é da porta.
  const criada = await criarTarefaManual({
    processoId: input.processoId,
    titulo,
    autorId: input.usuarioId ?? 0,
    faseMacroKey: faseOrigemKey,
    pessoaId: input.pessoaId ?? nec.pessoaId ?? null,
    documentoId: input.documentoId ?? null,
    necessidadeId: input.necessidadeOrigemId,
    responsavelId: input.responsavelId ?? null,
    dataPrazo: input.prazo ?? null,
    motivo: input.motivo ?? `Operação antecipada: ${input.acaoStepKey} (${labelRef})`,
    // A transversal é trabalho ANTECIPADO e deliberado: existir outra tarefa
    // aberta para a mesma necessidade é o caso normal, não duplicidade.
    confirmarDuplicidade: true,
    origem: "TRANSVERSAL",
    camposDeDominio: {
      tipo: "TRANSVERSAL",
      faseOrigemCode: (faseOrigemCode ?? faseOrigemKey) ?? null,
      faseReferenciaCode: faseRefCode,
      workflowInstanceOrigemId: inst?.id ?? null,
      tipoDocumentoId: input.tipoDocumentoId ?? null,
      acaoStepKey: input.acaoStepKey,
      resultadoEsperado: input.resultadoEsperado ?? null,
      createdBy: input.usuarioId ?? null,
    },
  })
  if (!criada.ok) throw new Error(criada.mensagem)
  const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: criada.tarefaId } })
  // VÍNCULO com a OPERAÇÃO OFICIAL: a Transversal NÃO possui workflow próprio. Ela aponta para
  // a operação documental oficial da necessidade de origem (o mesmo Documento operado no drawer
  // padrão "Abrir operação", com seu workflow real). Se a necessidade ainda não materializou o
  // Documento (ex.: genealogia), o vínculo fica só por necessidadeId e o drawer o cria sob demanda.
  let documentoId = input.documentoId ?? null
  if (documentoId == null) {
    const doc = await prisma.documento.findFirst({ where: { necessidadeId: input.necessidadeOrigemId }, orderBy: { id: "desc" }, select: { id: true } })
    documentoId = doc?.id ?? null
  }
  // Vincular o Documento é dado de DOMÍNIO (a que operação esta transversal se
  // refere), não transição de estado — por isso não passa pelas portas.
  if (documentoId != null) await prisma.tarefa.update({ where: { id: t.id }, data: { documentoId } })
  await audit("CRIADA", t.id, `Transversal "${titulo}" (ref ${faseRefCode}) p/ necessidade ${input.necessidadeOrigemId}${documentoId ? `; vínculo operação doc ${documentoId}` : " (operação sob demanda)"}`, input.usuarioId)
  return { ...t, documentoId }
}

/** Conclui a transversal REGISTRANDO o resultado. resolveuNecessidade=false ⇒ resultado
 *  negativo: a necessidade permanece pendente e o bloqueio continua. */
export async function concluirTarefaTransversal(
  tarefaId: number,
  opts: { resultadoObtido?: string | null; resolveuNecessidade: boolean; usuarioId?: number | null },
) {
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId } })
  if (!t || t.tipo !== "TRANSVERSAL") throw new Error("Tarefa transversal não encontrada")

  // A CONCLUSÃO PASSA PELA PORTA. A transversal não tem workflow — é o caso
  // exato para o qual `concluirTarefaSemWorkflow` existe. Escrever
  // `statusTarefa` aqui era a última exceção operacional do sistema.
  const r = await concluirTarefaSemWorkflow({
    tarefaId,
    autorId: opts.usuarioId ?? 0,
    resultado: opts.resultadoObtido ?? null,
  })
  if (!r.ok) throw new Error(r.mensagem)
  await audit("CONCLUIDA", tarefaId, `Concluída ${opts.resolveuNecessidade ? "COM" : "SEM"} resolução. Resultado: ${opts.resultadoObtido ?? "—"}`, opts.usuarioId)

  // A conclusão sozinha NÃO resolve a necessidade — o resultado precisa ser avaliado.
  if (opts.resolveuNecessidade && t.necessidadeId != null) {
    await atenderNecessidade(t.necessidadeId) // motor oficial da necessidade
    await audit("NECESSIDADE_RESOLVIDA", tarefaId, `Necessidade ${t.necessidadeId} → ATENDIDA por transversal`, opts.usuarioId)
    // Escopado à fase ATUAL: a transversal referencia uma necessidade de origem que
    // pode não estar mais na fase corrente do processo (regularização histórica).
    if (t.processoId) await tentarAvancoAutomaticoSeNecessidadeDaFaseAtual(t.processoId, t.necessidadeId) // BlockingEngine + PhaseAdvanceService (oficiais)
  }
  return t
}

export async function cancelarTarefaTransversal(tarefaId: number, opts: { motivo?: string | null; usuarioId?: number | null }) {
  const t = await prisma.tarefa.findUnique({ where: { id: tarefaId }, select: { id: true, tipo: true } })
  if (!t || t.tipo !== "TRANSVERSAL") throw new Error("Tarefa transversal não encontrada")
  // Cancelar é ato humano com motivo — a porta canônica já o exige e o audita.
  const rc = await cancelarTarefa({
    tarefaId,
    autorId: opts.usuarioId ?? 0,
    motivo: opts.motivo?.trim() || "Operação antecipada cancelada",
  })
  if (!rc.ok) throw new Error(rc.mensagem)
  await audit("CANCELADA", tarefaId, `Cancelada. Motivo: ${opts.motivo ?? "—"}`, opts.usuarioId)
  return t
}

/**
 * RECONCILIAÇÃO idempotente: quando a fase de REFERÊNCIA se torna ATIVA, reaproveita o
 * trabalho antecipado — associa a necessidade oficial ao Documento já existente (sem
 * duplicar), preservando auditoria. Chamada no phase.entered. Executar N vezes NÃO duplica.
 */
export async function reconciliarTransversaisNaFase(processoId: number, faseMacroKey: string): Promise<{ reaproveitadas: number }> {
  const faseCode = phaseKeyToFaseCode(faseMacroKey)
  if (!faseCode) return { reaproveitadas: 0 }
  const transversais = await prisma.tarefa.findMany({
    where: { processoId, tipo: "TRANSVERSAL", faseReferenciaCode: faseCode, documentoId: { not: null } },
    select: { id: true, documentoId: true, necessidadeId: true },
  })
  let reaproveitadas = 0
  for (const t of transversais) {
    if (t.documentoId == null) continue
    const doc = await prisma.documento.findUnique({ where: { id: t.documentoId }, select: { id: true, necessidadeId: true } })
    if (!doc) continue
    // associa a necessidade ao doc já existente se ainda não estiver (idempotente)
    if (doc.necessidadeId == null && t.necessidadeId != null) {
      await prisma.documento.update({ where: { id: doc.id }, data: { necessidadeId: t.necessidadeId } })
      reaproveitadas++
      await audit("REAPROVEITADA", t.id, `Documento ${doc.id} reaproveitado na fase ${faseMacroKey} (sem duplicação)`, null)
    }
  }
  return { reaproveitadas }
}
