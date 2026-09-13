// scripts/fix-exigencia-evidencia-bridge.test.ts
// ============================================================================
// FIX REAL: `ExigenciaEvidenciaEtapa` era ignorada pelo único portão real de
// execução de passo (`executarAcaoCadastrada`/`requisitosPendentes`).
//
// Achado durante o mandato de Emissão Documental: o item 08 da suíte de 110
// testes ("evidência obrigatória bloqueia") só tinha sido provado via
// `concluirEtapa` (lib/operacional/tarefa-etapa.ts) — mas o passo real
// "solicitar_certidao" em PRODUÇÃO tem 3 `ExigenciaEvidenciaEtapa` reais
// (doc 27) e ZERO `StepRequirement`. Confirmado por leitura direta de
// produção: `StepRequirement` para o passo 255 (solicitar_certidao, workflow
// id=12) = []. Como `executarAcaoCadastrada` (a porta que a UI real usa,
// confirmado pelo E2E de 38 passos) só consulta `requisitosPendentes`, que
// só lia `StepRequirement` — a exigência cadastrada em produção NUNCA era
// cobrada na execução real. Configuração salva e ignorada pelo runtime é
// defeito (invariante #48 do mandato).
//
// Este teste prova, isolado (workflow de 1 passo, SEM nenhum
// StepRequirement — só ExigenciaEvidenciaEtapa, replicando exatamente a
// config real de produção), que a ponte adicionada em
// `src/services/requisitos-da-etapa.ts` fecha o gap: `executarAcaoCadastrada`
// agora recusa sem a evidência e aceita com ela.
//
// Rodar:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   npx tsx scripts/fix-exigencia-evidencia-bridge.test.ts
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { executarAcaoCadastrada } from "@/src/services/executar-acao-cadastrada"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"

const MARCA = "EXIGBRIDGE-TEST"
const M = MARCA.toLowerCase()

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tids = ts.map((t) => t.id)
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documentoArquivo.deleteMany({ where: { documento: { pessoa: { arvore: { processos: { some: { id: { in: ids } } } } } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  const docs = await prisma.documento.findMany({ where: { pessoa: { arvore: { processos: { some: { id: { in: ids } } } } } }, select: { id: true } })
  const docIds = docs.map((d) => d.id)
  await prisma.documento.deleteMany({ where: { id: { in: docIds } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.exigenciaEvidenciaEtapa.deleteMany({ where: { stepKey: `${M}_unico` } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { name: { startsWith: MARCA } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::exigbridge` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
}

async function main() {
  exigirBancoDeTeste("fix-exigencia-evidencia-bridge.test.ts — ponte ExigenciaEvidenciaEtapa × executarAcaoCadastrada")
  await limpar()
  console.log("FIX: ExigenciaEvidenciaEtapa agora é cobrada por executarAcaoCadastrada\n")

  secao("1) Cadastro — workflow de 1 passo, SEM StepRequirement, replicando a config real de produção")
  const tipoEvidencia = await prisma.tipoDocumentoCadastro.create({
    data: { name: `${MARCA} Requerimento`, ativo: true, category: "civil_registry" },
    select: { id: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::exigbridge`, phaseKey: "emissao_documental", name: `${MARCA} Workflow`,
      versao: 1, execucao: "SEQUENCIAL", escopoExecucao: "DOCUMENTO",
      passos: { create: [{ key: `${M}_unico`, label: "Único passo", ordem: 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 5, cardinalidade: "DOCUMENTO", dependeDe: [] as never }] },
    },
    select: { id: true, passos: { select: { id: true, key: true } } },
  })
  const stepDefId = wf.passos[0].id
  await prisma.stepAction.create({
    data: { stepId: stepDefId, key: "concluir", label: "Concluir", effectKey: "COMPLETE_STEP", ordem: 1 },
  })
  // DELIBERADAMENTE NENHUM StepRequirement aqui — só a exigência antiga.
  await prisma.exigenciaEvidenciaEtapa.create({
    data: {
      stepKey: `${M}_unico`, evidenciaTipoId: tipoEvidencia.id,
      finalidade: "REQUERIMENTO_ENVIADO", obrigatoria: true, cardinalidadeMax: 1, ativo: true,
      chaveExigencia: `${M}_unico|null|null|${tipoEvidencia.id}`,
    },
  })
  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, versaoEsperada: 1 })
  ok("1) workflow publicado com sucesso", pub.ok === true, JSON.stringify(pub.ok ? { versao: pub.versaoNova } : pub))
  if (!pub.ok) { await limpar(); process.exit(1) }

  secao("2) Palco — processo/pessoa/necessidade/documento/instância real")
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} Arvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { arvoreId: arvore.id, nome: MARCA, sobrenome: "Teste" }, select: { id: true } })
  const processo = await prisma.processo.create({ data: { nome: `${MARCA} Processo`, arvoreId: arvore.id }, select: { id: true } })
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM`, name: "Certidão de Teste", natureza: "DOCUMENTO" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: processo.id, itemCatalogoId: item.id, pessoaId: pessoa.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec` },
    select: { id: true },
  })
  const documento = await prisma.documento.create({
    data: { pessoaId: pessoa.id, necessidadeId: nec.id, status: "SOLICITAR", descricao: `${MARCA} Documento`, tipo: "CERTIDAO_NASCIMENTO" },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: processo.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: pub.versaoNova!, chaveIdempotencia: `${MARCA}-inst`,
    },
    select: { id: true },
  })
  const stepInst = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: processo.id, faseMacroKey: "emissao_documental",
      ciclo: 1, stepKey: `${M}_unico`, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
      status: "DISPONIVEL", necessidadeId: nec.id, documentoId: documento.id, pessoaId: pessoa.id,
      papel: "equipe_documental", slaDays: 5, dependeDeStepKeys: [] as never,
      stepDefinitionId: stepDefId, stepDefinitionVersion: pub.versaoNova!,
      chaveIdempotencia: `${MARCA}-step`,
    },
    select: { id: true },
  })
  const mat = await garantirTarefaDePasso({ stepInstanceId: stepInst.id, correlationId: randomUUID() })
  ok("2) Tarefa materializada", mat.success === true, JSON.stringify(mat.success ? { tarefaId: mat.tarefa.id } : mat))

  secao("3) SEM evidência: executarAcaoCadastrada recusa (a ponte cobra ExigenciaEvidenciaEtapa mesmo sem StepRequirement)")
  const ctx = { usuarioId: null, permissoes: ["tarefas.editar"], correlationId: randomUUID(), origem: "USER" as const }
  const semEvidencia = await executarAcaoCadastrada(stepInst.id, "concluir", {}, ctx)
  ok("3) recusado com REQUISITO_PENDENTE", semEvidencia.ok === false && semEvidencia.codigo === "REQUISITO_PENDENTE", JSON.stringify(semEvidencia))
  const stepAindaDisponivel = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepInst.id }, select: { status: true } })
  ok("3) o passo continua DISPONIVEL (não concluiu por engano)", stepAindaDisponivel.status === "DISPONIVEL", stepAindaDisponivel.status)

  secao("4) COM evidência (REQUERIMENTO_ENVIADO anexado ao documento): a mesma ação sucede")
  await prisma.documentoArquivo.create({
    data: { documentoId: documento.id, tipo: "REQUERIMENTO_ENVIADO", url: `https://arquivos.test/${MARCA}/req.pdf`, nome: "requerimento.pdf" },
  })
  const comEvidencia = await executarAcaoCadastrada(stepInst.id, "concluir", {}, ctx)
  ok("4) a ação sucede", comEvidencia.ok === true, JSON.stringify(comEvidencia))
  const stepFinal = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepInst.id }, select: { status: true } })
  ok("4) o passo está CONCLUIDO", stepFinal.status === "CONCLUIDO", stepFinal.status)

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
