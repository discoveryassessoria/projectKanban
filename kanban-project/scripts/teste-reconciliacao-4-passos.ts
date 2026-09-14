// Testa scripts/reconciliar-4-passos.ts contra uma réplica fiel de produção:
// monta 2 Tarefas abertas (classe A: nem chegou no passo 4; classe B: já no
// passo 4, não iniciado) + 1 Tarefa CONCLUÍDA (5/5, intocável) usando o
// cadastro ANTIGO (conferir_certidao + validar_certidao separados), depois
// unifica o cadastro, roda a reconciliação em dry-run e depois --apply, e
// confirma o resultado.
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { executarAcaoCadastrada } from "@/src/services/executar-acao-cadastrada"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { unificarConferirValidar } from "./unificar-conferir-validar"
import { planejar, aplicar } from "./reconciliar-4-passos"

const MARCA = "RECONC4P"

let passou = 0, falhou = 0
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  const docs = await prisma.documento.findMany({ where: { pessoa: { arvore: { processos: { some: { id: { in: ids } } } } } }, select: { id: true } })
  await prisma.documentoArquivo.deleteMany({ where: { documentoId: { in: docs.map((d) => d.id) } } })
  await prisma.documento.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@reconc4p.test" } } })
  const wf = await prisma.phaseInternalWorkflow.findFirst({ where: { wfUid: `${MARCA}::emissao` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
}

async function montarWorkflowAntigo(): Promise<{ id: number; versao: number }> {
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${MARCA}::emissao`, phaseKey: `emissao_documental_${MARCA.toLowerCase()}`, name: `${MARCA} wf`,
      versao: 1, execucao: "SEQUENCIAL", escopoExecucao: "DOCUMENTO", active: true,
      passos: {
        create: [
          { key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, createsTask: true, required: true, slaDays: 7, cardinalidade: "DOCUMENTO" },
          { key: "aguardar_retorno_do_cartorio", label: "Aguardar retorno", ordem: 2, createsTask: true, required: true, slaDays: 15, cardinalidade: "DOCUMENTO" },
          { key: "receber_certidao", label: "Receber certidão", ordem: 3, createsTask: true, required: true, slaDays: 2, cardinalidade: "DOCUMENTO" },
          { key: "conferir_certidao", label: "Conferir certidão", ordem: 4, createsTask: true, required: true, slaDays: 0, cardinalidade: "DOCUMENTO", executorKey: "conferencia_documento" },
          { key: "validar_certidao", label: "Validar certidão", ordem: 5, createsTask: true, required: true, slaDays: 0, cardinalidade: "DOCUMENTO", executorKey: "validacao_juridica" },
        ],
      },
    },
    select: { id: true, passos: { select: { id: true, key: true } } },
  })
  const porChave = new Map(wf.passos.map((p) => [p.key, p.id]))
  await prisma.stepAction.createMany({ data: [{ stepId: porChave.get("solicitar_certidao")!, key: "enviado", label: "Enviar", effectKey: "COMPLETE_STEP", ordem: 1 }] })
  await prisma.stepAction.createMany({ data: [{ stepId: porChave.get("aguardar_retorno_do_cartorio")!, key: "retorno_chegou", label: "Retorno", effectKey: "COMPLETE_STEP", ordem: 1 }] })
  await prisma.stepAction.createMany({ data: [{ stepId: porChave.get("receber_certidao")!, key: "recebido", label: "Recebido", effectKey: "MARK_DOCUMENT_RECEIVED", ordem: 1 }] })
  await prisma.stepAction.createMany({ data: [{ stepId: porChave.get("conferir_certidao")!, key: "aprovado", label: "Aprovado", effectKey: "COMPLETE_STEP", ordem: 1 }] })
  await prisma.stepAction.createMany({ data: [{ stepId: porChave.get("validar_certidao")!, key: "aprovado", label: "Validado", effectKey: "APPROVE_FOR_ANALYSIS", ordem: 1 }] })
  await prisma.stepField.createMany({
    data: [
      { stepId: porChave.get("validar_certidao")!, key: "parecer", label: "Parecer", tipo: "textarea", obrigatorio: true, ordem: 1 },
      { stepId: porChave.get("validar_certidao")!, key: "motivo", label: "Motivo", tipo: "textarea", obrigatorio: false, ordem: 2 },
    ],
  })
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null })
  if (!pub.ok) throw new Error(JSON.stringify(pub))
  return { id: wf.id, versao: pub.versaoNova! }
}

let seq = 0
async function palcoAntigo(wf: { id: number; versao: number }, arv: { id: number }, processo: { id: number }, nome: string) {
  seq++
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM_${seq}`, name: "Certidão", natureza: "DOCUMENTO" }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome, sobrenome: MARCA }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({ data: { processoId: processo.id, itemCatalogoId: item.id, pessoaId: pessoa.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${seq}` }, select: { id: true } })
  const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, necessidadeId: nec.id, status: "SOLICITAR", descricao: `${MARCA} doc`, tipo: "CERTIDAO_NASCIMENTO" }, select: { id: true } })
  const defSteps = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wf.id }, orderBy: { ordem: "asc" }, select: { id: true, key: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: `emissao_documental_${MARCA.toLowerCase()}`, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: wf.versao, chaveIdempotencia: `${MARCA}-inst-${seq}` },
    select: { id: true },
  })
  const stepIds: number[] = []
  for (let i = 0; i < defSteps.length; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: processo.id, faseMacroKey: `emissao_documental_${MARCA.toLowerCase()}`, ciclo: 1,
        stepKey: defSteps[i].key, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, documentoId: doc.id, pessoaId: pessoa.id, papel: "equipe_documental", slaDays: 5,
        dependeDeStepKeys: (i === 0 ? [] : [defSteps[i - 1].key]) as never,
        stepDefinitionId: defSteps[i].id, stepDefinitionVersion: wf.versao,
        chaveIdempotencia: `${MARCA}-step-${seq}-${i}`,
      },
      select: { id: true },
    })
    stepIds.push(s.id)
  }
  const mat = await garantirTarefaDePasso({ stepInstanceId: stepIds[0], correlationId: randomUUID() })
  if (!mat.success) throw new Error(JSON.stringify(mat))
  return { pessoa, nec, doc, inst, stepIds, tarefaId: mat.tarefa.id }
}

async function main() {
  exigirBancoDeTeste("teste-reconciliacao-4-passos.ts")
  await limpar()
  console.log("TESTE DA RECONCILIAÇÃO — RÉPLICA FIEL DOS 4 CASOS REAIS DE PRODUÇÃO\n")

  const wf = await montarWorkflowAntigo()
  const daniela = await prisma.usuario.create({ data: { nome: "Daniela", email: `daniela.${Date.now()}@reconc4p.test`, senha: "x", tipo: "assistente" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const processo = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })

  // Classe A — ainda não chegou no passo 4 (como Tarefas 3562/3564 reais)
  const a = await palcoAntigo(wf, arv, processo, "ClasseA")
  await atribuirTarefa({ tarefaId: a.tarefaId, responsavelId: daniela.id, autorId: null })
  const ctx = { usuarioId: daniela.id, permissoes: ["tarefas.editar", "documentos.editar"], correlationId: randomUUID(), origem: "USER" as const }
  await executarAcaoCadastrada(a.stepIds[0], "enviado", {}, ctx)
  // fica parado no passo 2 — nunca chega no 4

  // Classe B — já no passo 4, DISPONIVEL, não iniciado (como Tarefas 3565/3566 reais)
  const b = await palcoAntigo(wf, arv, processo, "ClasseB")
  await atribuirTarefa({ tarefaId: b.tarefaId, responsavelId: daniela.id, autorId: null })
  await executarAcaoCadastrada(b.stepIds[0], "enviado", {}, ctx)
  await executarAcaoCadastrada(b.stepIds[1], "retorno_chegou", {}, ctx)
  await prisma.documentoArquivo.create({ data: { documentoId: b.doc.id, tipo: "OUTRO", url: `https://x/${MARCA}/b.pdf`, nome: "b.pdf" } })
  await executarAcaoCadastrada(b.stepIds[2], "recebido", { documento_url: `https://x/${MARCA}/b.pdf` }, ctx)
  const step4B = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: b.stepIds[3] }, select: { status: true } })
  console.log("Classe B — status do passo 4 antes da reconciliação:", step4B.status)

  // Classe E — CONCLUÍDA (5/5), intocável (como Tarefas 3570/3561 reais)
  const e = await palcoAntigo(wf, arv, processo, "ClasseConcluida")
  await atribuirTarefa({ tarefaId: e.tarefaId, responsavelId: daniela.id, autorId: null })
  await executarAcaoCadastrada(e.stepIds[0], "enviado", {}, ctx)
  await executarAcaoCadastrada(e.stepIds[1], "retorno_chegou", {}, ctx)
  await prisma.documentoArquivo.create({ data: { documentoId: e.doc.id, tipo: "OUTRO", url: `https://x/${MARCA}/e.pdf`, nome: "e.pdf" } })
  await executarAcaoCadastrada(e.stepIds[2], "recebido", { documento_url: `https://x/${MARCA}/e.pdf` }, ctx)
  await executarAcaoCadastrada(e.stepIds[3], "aprovado", {}, ctx)
  await executarAcaoCadastrada(e.stepIds[4], "aprovado", { parecer: "ok" }, ctx)
  const tarefaEDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: e.tarefaId }, select: { statusTarefa: true } })
  console.log("Classe E (concluída) — statusTarefa:", tarefaEDepois.statusTarefa)

  // ── UNIFICA O CADASTRO ──
  await unificarConferirValidar(wf.id)
  const rPub2 = await publicarWorkflow({ workflowId: wf.id, actorId: null })
  if (!rPub2.ok) throw new Error(`publicação da unificação falhou: ${JSON.stringify(rPub2)}`)

  // ── DRY-RUN ──
  console.log("\n--- DRY-RUN ---")
  const { elegiveis, foraDeEscopo } = await planejar()
  const elegiveisDoTeste = elegiveis.filter((el) => [a.tarefaId, b.tarefaId].includes(el.tarefaId))
  ok("dry-run identifica exatamente as 2 Tarefas abertas elegíveis (A e B)", elegiveisDoTeste.length === 2, `count=${elegiveisDoTeste.length}`)
  const foraDoTeste = foraDeEscopo.filter((f) => f.documentoId === e.doc.id)
  console.log("fora de escopo (classe E, esperado, concluída):", JSON.stringify(foraDoTeste))

  const stepsAntesA = await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: a.inst.id } })
  ok("dry-run não escreve nada (classe A continua com 5 steps)", stepsAntesA === 5, `count=${stepsAntesA}`)

  // ── APPLY ──
  console.log("\n--- APPLY ---")
  for (const el of elegiveisDoTeste) await aplicar(el)

  const stepsA = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: a.inst.id }, select: { stepKey: true } })
  ok("classe A: agora tem 4 steps (não 5)", stepsA.length === 4, `stepKeys=${JSON.stringify(stepsA.map((s) => s.stepKey))}`)
  ok("classe A: passo 4 é o unificado", stepsA.some((s) => s.stepKey === "conferir_e_validar_certidao"))

  const stepsB = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: b.inst.id }, select: { stepKey: true, status: true } })
  ok("classe B: agora tem 4 steps (não 5)", stepsB.length === 4, `stepKeys=${JSON.stringify(stepsB.map((s) => s.stepKey))}`)
  const step4BDepois = stepsB.find((s) => s.stepKey === "conferir_e_validar_certidao")
  ok("classe B: passo 4 unificado preserva o status DISPONIVEL que já tinha", step4BDepois?.status === "DISPONIVEL", step4BDepois?.status)

  const tarefaBDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: b.tarefaId }, select: { workflowStepInstanceId: true } })
  const novoStep4B = await prisma.phaseWorkflowStepInstance.findFirst({ where: { workflowInstanceId: b.inst.id, stepKey: "conferir_e_validar_certidao" }, select: { id: true } })
  ok("classe B: Tarefa.workflowStepInstanceId foi repontado para o novo step unificado", tarefaBDepois.workflowStepInstanceId === novoStep4B?.id)

  // Classe E (concluída) — NUNCA TOCADA
  const stepsEDepois = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: e.inst.id }, select: { stepKey: true, status: true } })
  ok("classe E (concluída) continua com 5 steps — histórico intocado", stepsEDepois.length === 5, `count=${stepsEDepois.length}`)
  ok("classe E: todos ainda CONCLUIDO", stepsEDepois.every((s) => s.status === "CONCLUIDO"))
  const tarefaEFinal = await prisma.tarefa.findUniqueOrThrow({ where: { id: e.tarefaId }, select: { statusTarefa: true } })
  ok("classe E: Tarefa continua concluída, sem alteração", tarefaEFinal.statusTarefa === tarefaEDepois.statusTarefa)

  // ── IDEMPOTÊNCIA: rodar de novo não encontra mais nada elegível para A/B ──
  const { elegiveis: elegiveis2 } = await planejar()
  const restam = elegiveis2.filter((el) => [a.tarefaId, b.tarefaId].includes(el.tarefaId))
  ok("reconciliação é idempotente — rodar de novo não encontra A/B novamente elegíveis", restam.length === 0, `count=${restam.length}`)

  // ── A Tarefa da classe B consegue operar normalmente no novo passo unificado ──
  const rContinua = await executarAcaoCadastrada(novoStep4B!.id, "aprovado", {
    checklist: { legivel: true, integro: true, dados_minimos: true, apostila_ok: true, traducao_ok: true },
  }, { usuarioId: daniela.id, permissoes: ["tarefas.editar", "documentos.editar"], correlationId: randomUUID(), origem: "USER" as const, subtaskKey: "conferencia" })
  ok("classe B reconciliada: consegue executar a subtarefa 'conferencia' normalmente", rContinua.ok === true, JSON.stringify(rContinua))

  await limpar()
  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) })
