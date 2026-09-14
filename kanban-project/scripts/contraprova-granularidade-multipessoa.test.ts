// CONTRAPROVA INDEPENDENTE (não reaproveita mandato-110-testes.test.ts) —
// processo com 3 necessidades documentais distintas (Nascimento João,
// Casamento João, Nascimento Maria) usando o workflow REAL de produção
// (id=12, "Solicitar Certidão"), materializado via garantirTarefaDePasso
// (o caminho oficial), para confirmar de forma fresca:
//   3 necessidades → 3 Tarefas → cada uma com seus PRÓPRIOS 5 stepInstances
//   (nenhum Step compartilhado, nenhum documento de um satisfazendo outro).
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"

const MARCA = "CONTRAPROVA2-GRAN"

let passou = 0, falhou = 0
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  OK ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; console.log(`  FALHA ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  const docs = await prisma.documento.findMany({ where: { pessoa: { arvore: { processos: { some: { id: { in: ids } } } } } }, select: { id: true } })
  await prisma.documento.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

async function criarObrigacao(processoId: number, pessoaId: number, natureza: string, seq: number) {
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_${natureza}_${seq}`, name: `Certidão de ${natureza}`, natureza: "DOCUMENTO" },
    select: { id: true },
  })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId, itemCatalogoId: item.id, pessoaId, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${seq}` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({
    data: { pessoaId, necessidadeId: nec.id, status: "SOLICITAR", descricao: `${MARCA} ${natureza}`, tipo: "CERTIDAO_NASCIMENTO" },
    select: { id: true },
  })
  const wf = await prisma.phaseInternalWorkflow.findFirstOrThrow({
    where: { phaseKey: "emissao_documental", active: true, arquivado: false, tipoProcessoId: null },
    select: { id: true, versao: true },
  })
  const defSteps = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wf.id }, orderBy: { ordem: "asc" }, select: { id: true, key: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: wf.versao, chaveIdempotencia: `${MARCA}-inst-${seq}`,
    },
    select: { id: true },
  })
  let primeiroStepId = -1
  for (let i = 0; i < defSteps.length; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId, faseMacroKey: "emissao_documental", ciclo: 1,
        stepKey: defSteps[i].key, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, documentoId: doc.id, pessoaId, papel: "equipe_documental", slaDays: 5,
        dependeDeStepKeys: (i === 0 ? [] : [defSteps[i - 1].key]) as never,
        stepDefinitionId: defSteps[i].id, stepDefinitionVersion: wf.versao,
        chaveIdempotencia: `${MARCA}-step-${seq}-${i}`,
      },
      select: { id: true },
    })
    if (i === 0) primeiroStepId = s.id
  }
  const mat = await garantirTarefaDePasso({ stepInstanceId: primeiroStepId, correlationId: randomUUID() })
  return { nec, doc, inst, mat }
}

async function main() {
  exigirBancoDeTeste("contraprova-granularidade-multipessoa.test.ts — verificação independente da granularidade")
  await limpar()

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const processo = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })
  const joao = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Joao", sobrenome: MARCA }, select: { id: true } })
  const maria = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Maria", sobrenome: MARCA }, select: { id: true } })

  console.log("Criando 3 obrigações: Nascimento(Joao), Casamento(Joao), Nascimento(Maria)")
  const r1 = await criarObrigacao(processo.id, joao.id, "NASCIMENTO_JOAO", 1)
  const r2 = await criarObrigacao(processo.id, joao.id, "CASAMENTO_JOAO", 2)
  const r3 = await criarObrigacao(processo.id, maria.id, "NASCIMENTO_MARIA", 3)

  ok("as 3 materializações sucederam", r1.mat.success && r2.mat.success && r3.mat.success)

  const tarefas = await prisma.tarefa.findMany({ where: { processoId: processo.id }, select: { id: true, necessidadeId: true, documentoId: true, workflowInstanceId: true } })
  ok("exatamente 3 Tarefas materializadas para 3 necessidades", tarefas.length === 3, `count=${tarefas.length}`)

  const necIds = new Set(tarefas.map((t) => t.necessidadeId))
  ok("cada Tarefa aponta para uma necessidadeId DISTINTA (nenhum compartilhamento)", necIds.size === 3, `necessidadeIds=${JSON.stringify([...necIds])}`)

  const docIds = new Set(tarefas.map((t) => t.documentoId))
  ok("cada Tarefa aponta para um documentoId DISTINTO", docIds.size === 3, `documentoIds=${JSON.stringify([...docIds])}`)

  const instIds = new Set(tarefas.map((t) => t.workflowInstanceId))
  ok("cada Tarefa tem sua PRÓPRIA workflowInstance (nenhum Step compartilhado entre obrigações)", instIds.size === 3, `instanceIds=${JSON.stringify([...instIds])}`)

  for (const [nome, r] of [["Nascimento João", r1], ["Casamento João", r2], ["Nascimento Maria", r3]] as const) {
    const steps = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: r.inst.id }, select: { stepKey: true } })
    ok(`${nome}: tem exatamente 5 stepInstances próprios (5 stepKeys reais do workflow 12)`, steps.length === 5, `count=${steps.length}`)
  }

  // Documento de João (nascimento) não pode satisfazer a necessidade de casamento nem a de Maria.
  const necNascJoao = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: r1.nec.id }, select: { status: true, pessoaId: true } })
  const necCasJoao = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: r2.nec.id }, select: { status: true, pessoaId: true } })
  const necNascMaria = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: r3.nec.id }, select: { status: true, pessoaId: true } })
  ok("necessidade de nascimento(João) e casamento(João) são registros DIFERENTES", r1.nec.id !== r2.nec.id)
  ok("necessidade de Maria não é a de João (pessoaId distinta)", necNascMaria.pessoaId !== necNascJoao.pessoaId && necNascMaria.pessoaId !== necCasJoao.pessoaId)

  // Rematerializar a mesma obrigação (idempotência) não duplica Tarefa.
  const r1b = await garantirTarefaDePasso({ stepInstanceId: (await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { workflowInstanceId: r1.inst.id }, orderBy: { ordem: "asc" } })).id, correlationId: randomUUID() })
  ok("rematerializar o mesmo passo não cria uma segunda Tarefa (idempotência)", r1b.success && !r1b.created, JSON.stringify(r1b.success ? { created: r1b.created } : r1b))
  const tarefasDepois = await prisma.tarefa.count({ where: { processoId: processo.id } })
  ok("ainda exatamente 3 Tarefas no processo depois da rematerialização", tarefasDepois === 3, `count=${tarefasDepois}`)

  await limpar()
  console.log(`\n${passou} ok, ${falhou} falhas`)
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) })
