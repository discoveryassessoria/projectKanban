// scripts/visita-atual-nunca-fase-futura.test.ts
// ============================================================================
// A VISITA ATUAL DE UM DOCUMENTO NUNCA APONTA PARA UMA FASE À FRENTE DA FASE
// ATUAL DO PROCESSO — mandato "Correção do reconciliador NEC-001" (29/09/2026).
//
// Achado real (processo 651/Cibils): o processo avançou até Emissão Retificada/
// Apostilamento e depois retrocedeu para Emissão Documental normal. Retroceder
// fase, por desenho (`retrocesso-de-fase.ts`), NUNCA mexe em execução — as
// Tarefas das fases futuras foram canceladas por outro caminho, mas os PASSOS
// (`PhaseWorkflowStepInstance`) ficaram `em_andamento` pra trás. `GET /api/
// documentos/[id]/workflow` (via `visitaAtualDoDocumento`, documento-
// operacao.ts) escolhia o passo ativo mais RECENTEMENTE CRIADO (`orderBy: id
// desc`) entre TODOS — inclusive o da fase que o processo já deixou de estar
// — e mostrava a etapa errada (Retificada/Apostilamento) para 16 tarefas que a
// Operação já sabia estarem em Emissão Documental normal.
//
// Este teste prova que `visitaAtualDoDocumento`/`montarWorkflowV2` agora
// ignoram candidatos de fase À FRENTE da fase atual do processo — sem tocar em
// nenhuma escrita de retrocesso (que continua, corretamente, não mexendo em
// execução nenhuma).
//
//   npx tsx scripts/visita-atual-nunca-fase-futura.test.ts
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirOferta } from "./_fixture-oferta"
import { visitaAtualDoDocumento, montarWorkflowV2 } from "../src/services/documento-operacao"

const MARCA = "VISITAFUT"
const FASES = ["genealogia", "emissao_documental", "emissao_documental_retificada"] as const

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipos.map((t) => t.id) } }, select: { id: true } })
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  if (ids.length) {
    await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: (await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })).map((t) => t.id) } } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvIds.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipos.map((t) => t.id) } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@visitafut.test" } } })
}

async function main() {
  exigirBancoDeTeste("prova que a visita atual do documento nunca aponta para uma fase futura")
  await limpar()
  console.log("VISITA ATUAL NUNCA APONTA PARA FASE À FRENTE DA FASE ATUAL DO PROCESSO\n")

  const admin = await prisma.usuario.create({ data: { nome: "Admin VisitaFut", email: "admin@visitafut.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const oferta = await garantirOferta(prisma, { countryKey: "espanha", countryLabel: "Espanha", nationalityKey: "espanhola", nationalityLabel: "Espanhola", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_ESP`, name: `${MARCA} Espanha`, paisId: oferta.paisId }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })
  for (const [i, phaseKey] of FASES.entries()) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey, label: phaseKey, ordem: i, versao: 1 } })
  }
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_CERT`, name: "Certidão", natureza: "DOCUMENTO" }, select: { id: true } })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Fulano", sobrenome: MARCA, arvoreId: arvore.id, linhaReta: true }, select: { id: true } })

  secao("1) Processo AVANÇOU até emissao_documental_retificada e RETROCEDEU para emissao_documental")
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} Família`, arvoreId: arvore.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental", tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId },
    select: { id: true },
  })
  const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, status: "PENDENTE" }, select: { id: true } })

  // A instância/passo da fase ANTERIOR (genealogia) — CONCLUÍDO, histórico legítimo.
  const instGenealogia = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: "genealogia", ciclo: 1, status: "CONCLUIDO", chaveIdempotencia: `${MARCA}-i-gen-${processo.id}` },
    select: { id: true },
  })
  await prisma.phaseWorkflowStepInstance.create({
    data: { workflowInstanceId: instGenealogia.id, processoId: processo.id, faseMacroKey: "genealogia", stepKey: "localizar_registro", ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "CONCLUIDO", documentoId: doc.id, pessoaId: pessoa.id, papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-s-gen-${processo.id}` },
  })

  // A instância/passo da fase ATUAL (emissao_documental) — o que DEVE ganhar.
  const instEmissao = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-emi-${processo.id}` },
    select: { id: true },
  })
  const stepEmissao = await prisma.phaseWorkflowStepInstance.create({
    data: { workflowInstanceId: instEmissao.id, processoId: processo.id, faseMacroKey: "emissao_documental", stepKey: "solicitar_certidao", ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "EM_ANDAMENTO", startedAt: new Date(), documentoId: doc.id, pessoaId: pessoa.id, papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-s-emi-${processo.id}` },
    select: { id: true },
  })

  // A instância/passo da fase FUTURA (retificada) — criada quando o processo
  // chegou a avançar, e NUNCA superseded pelo retrocesso (comportamento real e
  // intencional de `retrocesso-de-fase.ts`: "mover a fase não mexe em
  // execução"). O id dela é MAIOR (criada depois) — é isso que fazia o bug.
  const instRetificada = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: "emissao_documental_retificada", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-ret-${processo.id}` },
    select: { id: true },
  })
  const stepRetificada = await prisma.phaseWorkflowStepInstance.create({
    data: { workflowInstanceId: instRetificada.id, processoId: processo.id, faseMacroKey: "emissao_documental_retificada", stepKey: "emissao_retificada_certidao", ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "EM_ANDAMENTO", documentoId: doc.id, pessoaId: pessoa.id, papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-s-ret-${processo.id}` },
    select: { id: true },
  })
  ok("id do passo futuro (retificada) é MAIOR que o da fase atual — a condição real do bug", stepRetificada.id > stepEmissao.id)

  secao("2) visitaAtualDoDocumento ignora a fase futura, mesmo sendo o id mais recente")
  const visita = await visitaAtualDoDocumento(doc.id)
  ok("resolve para emissao_documental (fase atual), não emissao_documental_retificada", visita?.faseMacroKey === "emissao_documental", JSON.stringify(visita))
  ok("aponta para o workflowInstanceId da fase atual", visita?.workflowInstanceId === instEmissao.id)

  secao("3) montarWorkflowV2 (o que /api/documentos/[id]/workflow devolve) mostra a etapa certa")
  const wf = await montarWorkflowV2(doc.id, { usuarioId: admin.id, permissoes: null, isAdmin: true })
  ok("currentStepId é o passo da fase atual", wf?.currentStepId === stepEmissao.id, `currentStepId=${wf?.currentStepId}, esperado=${stepEmissao.id}`)
  ok("a etapa da fase futura NÃO aparece na lista de steps", !wf?.steps.some((s: any) => s.id === stepRetificada.id))
  ok("faseCode bate com a fase atual do processo (EMISSAO_DOCUMENTAL)", wf?.faseCode === "EMISSAO_DOCUMENTAL", wf?.faseCode ?? "—")

  secao("4) Regressão: incidente 573 continua funcionando — trabalho ATIVO numa fase ANTERIOR à atual continua visível")
  // Processo avançou para emissao_documental, mas a Genealogia deste OUTRO
  // documento ainda está DISPONIVEL (trabalho de verdade, não terminado) — a
  // visita tem de continuar achando esse trabalho, nunca "fase atual" cego.
  const doc2 = await prisma.documento.create({ data: { pessoaId: pessoa.id, status: "PENDENTE" }, select: { id: true } })
  const instGenealogia2 = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-gen2-${processo.id}` },
    select: { id: true },
  })
  const stepGenealogia2 = await prisma.phaseWorkflowStepInstance.create({
    data: { workflowInstanceId: instGenealogia2.id, processoId: processo.id, faseMacroKey: "genealogia", stepKey: "localizar_registro", ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", documentoId: doc2.id, pessoaId: pessoa.id, papel: "equipe_documental", slaDays: 5, chaveIdempotencia: `${MARCA}-s-gen2-${processo.id}` },
    select: { id: true },
  })
  const visita2 = await visitaAtualDoDocumento(doc2.id)
  ok("trabalho ATIVO numa fase ANTERIOR à atual continua achável (incidente 573 não regrediu)", visita2?.faseMacroKey === "genealogia" && visita2?.workflowInstanceId === instGenealogia2.id, JSON.stringify(visita2))
  void stepGenealogia2

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
