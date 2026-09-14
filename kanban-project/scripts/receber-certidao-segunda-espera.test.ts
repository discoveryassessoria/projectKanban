// scripts/receber-certidao-segunda-espera.test.ts
// ============================================================================
// CORREÇÃO — "Receber certidão" tem sua PRÓPRIA espera de terceiro.
//
// O passo 2 ("Aguardar retorno do cartório") cobre a espera pelo COMPROVANTE
// do pedido. O passo 3 ("Receber certidão") cobre uma espera DIFERENTE: depois
// que o cartório confirmou o pedido, ainda falta a certidão física/digital
// chegar. Antes desta correção o passo 3 só tinha "Registrar recebimento" —
// sem jeito de declarar "ainda aguardando", então a Tarefa parada nessa espera
// aparecia como ação interna pendente, nunca como espera externa.
//
// A correção REAPROVEITA o mecanismo já testado (`PAUSE_FOR_EXTERNAL_WAIT`,
// ver scripts/mandato-pausa-relogios.test.ts) — nenhum efeito novo, nenhum
// campo de schema novo:
//   - src/lib/motor/registro-de-executores.ts: o executor `recebimento_documento`
//     passa a declarar PAUSE_FOR_EXTERNAL_WAIT/suportaEsperaExterna (sem isso a
//     publicação e `executarAcaoCadastrada` recusam a ação por capacidade não
//     declarada — ver validacao-de-publicacao.ts:393 e executorSuportaEfeito).
//   - scripts/adicionar-aguardando-receber-certidao.ts: cadastra a StepAction
//     "aguardando_cartorio" (PAUSE_FOR_EXTERNAL_WAIT) no passo "receber_certidao".
//   - src/components/kanban/workflow/StepEditors.tsx (FormReceberCertidao):
//     botão "Ainda aguardando o cartório" chamando a ação cadastrada.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { montarWorkflowReal } from "./_fixture-workflow-real"
import { unificarConferirValidar } from "./unificar-conferir-validar"
import { adicionarAguardandoEmReceberCertidao } from "./adicionar-aguardando-receber-certidao"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { executarAcaoCadastrada } from "@/src/services/executar-acao-cadastrada"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { estadosTemporaisDasOperacoes } from "@/lib/operacional/proximo-acontecimento"

const MARCA = "RECEBERCERT2ESPERA"

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
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@receber2espera.test" } } })
}

let seq = 0
async function usuario(nome: string) {
  seq++
  return prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${seq}@receber2espera.test`, senha: "x", tipo: "assistente" }, select: { id: true, nome: true } })
}

async function palco(wfId: number, wfVersao: number, pessoaNome: string, arv: { id: number }, processo: { id: number }) {
  seq++
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM_${seq}`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: pessoaNome, sobrenome: MARCA }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({ data: { processoId: processo.id, itemCatalogoId: item.id, pessoaId: pessoa.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${seq}` }, select: { id: true } })
  const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, necessidadeId: nec.id, status: "SOLICITAR", descricao: `${MARCA} doc`, tipo: "CERTIDAO_NASCIMENTO" }, select: { id: true } })
  const defSteps = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wfId }, orderBy: { ordem: "asc" }, select: { id: true, key: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: "emissao_documental_realwf", ciclo: 1, status: "ATIVO", workflowDefinitionId: wfId, workflowVersion: wfVersao, chaveIdempotencia: `${MARCA}-inst-${seq}` },
    select: { id: true },
  })
  const stepIds: number[] = []
  for (let i = 0; i < defSteps.length; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: processo.id, faseMacroKey: "emissao_documental_realwf", ciclo: 1,
        stepKey: defSteps[i].key, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, documentoId: doc.id, pessoaId: pessoa.id, papel: "equipe_documental", slaDays: 5,
        dependeDeStepKeys: (i === 0 ? [] : [defSteps[i - 1].key]) as never,
        stepDefinitionId: defSteps[i].id, stepDefinitionVersion: wfVersao,
        chaveIdempotencia: `${MARCA}-step-${seq}-${i}`,
      },
      select: { id: true },
    })
    stepIds.push(s.id)
  }
  const mat = await garantirTarefaDePasso({ stepInstanceId: stepIds[0], correlationId: randomUUID() })
  if (!mat.success) throw new Error(`materialização falhou: ${JSON.stringify(mat)}`)
  return { pessoa, nec, doc, inst, stepIds, defSteps, tarefaId: mat.tarefa.id }
}

async function main() {
  exigirBancoDeTeste("receber-certidao-segunda-espera.test.ts")
  await limpar()
  console.log("RECEBER CERTIDÃO — SEGUNDA ESPERA DE TERCEIRO (reaproveita PAUSE_FOR_EXTERNAL_WAIT)\n")

  const wfId = await montarWorkflowReal()
  await unificarConferirValidar(wfId)
  const cad = await adicionarAguardandoEmReceberCertidao(wfId)
  ok("00) migração adiciona a ação ao cadastro (1ª vez)", cad.adicionado === true, JSON.stringify(cad))
  const cad2 = await adicionarAguardandoEmReceberCertidao(wfId)
  ok("00b) migração é idempotente (2ª vez não duplica)", cad2.jaExistia === true && cad2.adicionado === false, JSON.stringify(cad2))

  const pub = await publicarWorkflow({ workflowId: wfId, actorId: null })
  ok("01) publicação sucede com a nova ação no cadastro", pub.ok === true, JSON.stringify(pub).slice(0, 200))
  const wfVersao = pub.ok ? pub.versaoNova! : 0

  const daniela = await usuario("Daniela")
  const ctx = { usuarioId: daniela.id, permissoes: ["tarefas.editar", "documentos.editar"], correlationId: randomUUID(), origem: "USER" as const }

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const processo = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })
  const p = await palco(wfId, wfVersao, "Beatriz", arv, processo)
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: null })

  // ══════════════════════════════════════════════════════════════════════
  secao("1-2) avança até 'Receber certidão' (passos 1 e 2 concluídos)")
  // ══════════════════════════════════════════════════════════════════════
  const r1 = await executarAcaoCadastrada(p.stepIds[0], "enviado", {}, ctx)
  ok("01) passo 1 (solicitar) conclui", r1.ok === true, JSON.stringify(r1).slice(0, 150))
  const r2 = await executarAcaoCadastrada(p.stepIds[1], "retorno_chegou", {}, ctx)
  ok("02) passo 2 (aguardar retorno) conclui", r2.ok === true, JSON.stringify(r2).slice(0, 150))

  const step3Antes = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[2] }, select: { status: true, stepKey: true } })
  ok("03) passo 3 é 'receber_certidao' e está DISPONÍVEL", step3Antes.stepKey === "receber_certidao" && step3Antes.status === "DISPONIVEL", JSON.stringify(step3Antes))

  // ══════════════════════════════════════════════════════════════════════
  secao("3-8) a NOVA ação: 'ainda aguardando o cartório' (PAUSE_FOR_EXTERNAL_WAIT)")
  // ══════════════════════════════════════════════════════════════════════
  const rAguardando = await executarAcaoCadastrada(p.stepIds[2], "aguardando_cartorio", {}, ctx)
  ok("04) ação 'aguardando_cartorio' é aceita (capacidade declarada no executor)", rAguardando.ok === true, JSON.stringify(rAguardando).slice(0, 200))

  const tarefaBloqueada = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { statusTarefa: true, motivoCodigo: true, justificativa: true } })
  ok("05) Tarefa vira BLOQUEADA", tarefaBloqueada.statusTarefa === "BLOQUEADA", tarefaBloqueada.statusTarefa)
  ok("06) motivoCodigo é AGUARDANDO_TERCEIRO (mesmo mecanismo do passo 2)", tarefaBloqueada.motivoCodigo === "AGUARDANDO_TERCEIRO", String(tarefaBloqueada.motivoCodigo))

  const step3Bloqueado = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[2] }, select: { status: true } })
  ok("07) o PASSO também bloqueia — mesma transação, mesma verdade", step3Bloqueado.status === "BLOQUEADO", step3Bloqueado.status)

  const agora = new Date()
  const estados = await estadosTemporaisDasOperacoes(prisma, [p.tarefaId], agora)
  const estadoBloqueado = estados.get(p.tarefaId)
  ok("08) motor temporal lê como ESPERA EXTERNA (aguardandoTerceiro=true), não ação interna",
    estadoBloqueado?.proximoAcontecimento.aguardandoTerceiro === true, JSON.stringify(estadoBloqueado?.proximoAcontecimento).slice(0, 200))
  ok("08b) NUNCA vira atraso interno enquanto aguarda o cartório (Etapa 3, item 3)",
    estadoBloqueado?.atrasoInterno === false, String(estadoBloqueado?.atrasoInterno))

  // ══════════════════════════════════════════════════════════════════════
  secao("9-13) certidão chega → 'Registrar recebimento' DESBLOQUEIA automaticamente")
  // ══════════════════════════════════════════════════════════════════════
  await prisma.documentoArquivo.create({ data: { documentoId: p.doc.id, tipo: "OUTRO", url: `https://x/${MARCA}/cert.pdf`, nome: "cert.pdf" } })
  const rRecebido = await executarAcaoCadastrada(p.stepIds[2], "recebido", { documento_url: `https://x/${MARCA}/cert.pdf` }, ctx)
  ok("09) 'Registrar recebimento' sucede mesmo com a Tarefa BLOQUEADA", rRecebido.ok === true, JSON.stringify(rRecebido).slice(0, 200))

  const step3Depois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[2] }, select: { status: true } })
  ok("10) passo 3 conclui", step3Depois.status === "CONCLUIDO", step3Depois.status)

  const tarefaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { statusTarefa: true, motivoCodigo: true, workflowStepInstanceId: true } })
  ok("11) Tarefa SAI de BLOQUEADA sozinha (sincronizarTarefaComWorkflow deriva de volta pelos passos)", tarefaDepois.statusTarefa !== "BLOQUEADA", tarefaDepois.statusTarefa)
  ok("12) ponteiro da Tarefa avança para o passo 4 (conferir e validar)", tarefaDepois.workflowStepInstanceId === p.stepIds[3])

  const step4 = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[3] }, select: { status: true, stepKey: true } })
  ok("13) passo 4 fica DISPONÍVEL", step4.status === "DISPONIVEL", JSON.stringify(step4))

  const estadosDepois = await estadosTemporaisDasOperacoes(prisma, [p.tarefaId], agora)
  const estadoDepois = estadosDepois.get(p.tarefaId)
  ok("14) motor temporal não lê mais espera externa depois do recebimento", estadoDepois?.proximoAcontecimento.aguardandoTerceiro === false, String(estadoDepois?.proximoAcontecimento.aguardandoTerceiro))

  console.log(`\n${"─".repeat(70)}\nRESULTADO: ${passou} passaram, ${falhou} falharam\n${"─".repeat(70)}`)
  if (falhou > 0) { console.log("FALHAS:", falhas); process.exit(1) }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
