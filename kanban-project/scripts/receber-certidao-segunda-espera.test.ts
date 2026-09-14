// scripts/receber-certidao-segunda-espera.test.ts
// ============================================================================
// CORREÇÃO CONCEITUAL — "Aguardar retorno do cartório" e "Receber certidão"
// SÃO espera de terceiro, por definição, desde o instante em que ficam
// disponíveis. Uma correção anterior (revertida) tratava isso como uma AÇÃO
// que o operador precisava disparar manualmente ("Ainda aguardando o
// cartório"). Está errado: o cadastro do PASSO
// (`PhaseInternalWorkflowStep.esperaExternaAoLiberar`) é quem decide, e o
// motor entra em AGUARDANDO_TERCEIRO sozinho, na MESMA transação que libera o
// passo — nunca stepKey hardcoded, vale para qualquer workflow configurado
// assim (ver `aplicarEsperaExternaSeConfigurado`, task-step-sync.ts).
//
// Prova as DUAS transições:
//   1→2: concluir "Solicitar certidão" já deixa "Aguardar retorno do
//        cartório" nascendo em espera — sem clicar em nada.
//   2→3: concluir "Aguardar retorno do cartório" já deixa "Receber certidão"
//        nascendo em espera — sem clicar em nada.
// E que "Registrar recebimento" (MARK_DOCUMENT_RECEIVED) continua
// funcionando com a Tarefa BLOQUEADA e desbloqueando sozinha ao concluir.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { montarWorkflowReal } from "./_fixture-workflow-real"
import { unificarConferirValidar } from "./unificar-conferir-validar"
import { configurarEsperaExternaAutomatica } from "./configurar-espera-externa-automatica"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { executarAcaoCadastrada } from "@/src/services/executar-acao-cadastrada"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { estadosTemporaisDasOperacoes } from "@/lib/operacional/proximo-acontecimento"
import { colunaDaTarefa, visaoGerencial } from "@/lib/operacional/tarefa-projecoes"

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
  console.log("ESPERA DE TERCEIRO AUTOMÁTICA — 'Aguardar retorno do cartório' e 'Receber certidão' nascem esperando\n")

  const wfId = await montarWorkflowReal()
  await unificarConferirValidar(wfId)
  const cfg = await configurarEsperaExternaAutomatica(wfId)
  ok("00) aguardar_retorno_do_cartorio marcado esperaExternaAoLiberar", cfg["aguardar_retorno_do_cartorio"]?.depois === true, JSON.stringify(cfg["aguardar_retorno_do_cartorio"]))
  ok("00b) receber_certidao marcado esperaExternaAoLiberar", cfg["receber_certidao"]?.depois === true, JSON.stringify(cfg["receber_certidao"]))
  const cfg2 = await configurarEsperaExternaAutomatica(wfId)
  ok("00c) idempotente — 2ª chamada não muda nada (antes já era true)", cfg2["aguardar_retorno_do_cartorio"]?.antes === true && cfg2["receber_certidao"]?.antes === true)

  const stepReceber = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({
    where: { workflowId: wfId, key: "receber_certidao" }, select: { acoes: { select: { key: true } } },
  })
  ok("00d) a ação manual 'aguardando_cartorio' NÃO existe mais no cadastro (era o botão removido)",
    !stepReceber.acoes.some((a) => a.key === "aguardando_cartorio"), JSON.stringify(stepReceber.acoes.map((a) => a.key)))

  const pub = await publicarWorkflow({ workflowId: wfId, actorId: null })
  ok("01) publicação sucede com os dois passos marcados", pub.ok === true, JSON.stringify(pub).slice(0, 250))
  const wfVersao = pub.ok ? pub.versaoNova! : 0

  const daniela = await usuario("Daniela")
  const ctx = { usuarioId: daniela.id, permissoes: ["tarefas.editar", "documentos.editar"], correlationId: randomUUID(), origem: "USER" as const }

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const processo = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })
  const p = await palco(wfId, wfVersao, "Beatriz", arv, processo)
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: null })

  const agora = () => new Date()

  // ══════════════════════════════════════════════════════════════════════
  secao("1-7) TRANSIÇÃO 1→2 — concluir 'Solicitar certidão' já deixa a Tarefa esperando o cartório, sem clique nenhum")
  // ══════════════════════════════════════════════════════════════════════
  const antesDeEnviar = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { statusTarefa: true } })
  ok("01) antes de enviar, Tarefa NÃO está bloqueada", antesDeEnviar.statusTarefa !== "BLOQUEADA", antesDeEnviar.statusTarefa)

  const r1 = await executarAcaoCadastrada(p.stepIds[0], "enviado", {}, ctx)
  ok("02) passo 1 (solicitar) conclui", r1.ok === true, JSON.stringify(r1).slice(0, 150))

  const step1Depois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[0] }, select: { status: true } })
  ok("03) passo 1 fica CONCLUIDO (não fica preso em BLOQUEADO)", step1Depois.status === "CONCLUIDO", step1Depois.status)

  const step2Depois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[1] }, select: { status: true, stepKey: true } })
  ok("04) passo 2 (aguardar_retorno_do_cartorio) já nasce BLOQUEADO — automático", step2Depois.status === "BLOQUEADO" && step2Depois.stepKey === "aguardar_retorno_do_cartorio", JSON.stringify(step2Depois))

  const tarefaAposEnviar = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { statusTarefa: true, motivoCodigo: true, justificativa: true, workflowStepInstanceId: true } })
  ok("05) Tarefa vira BLOQUEADA SOZINHA — sem nenhuma ação manual 'ainda aguardando'", tarefaAposEnviar.statusTarefa === "BLOQUEADA", tarefaAposEnviar.statusTarefa)
  ok("06) motivoCodigo é AGUARDANDO_TERCEIRO", tarefaAposEnviar.motivoCodigo === "AGUARDANDO_TERCEIRO", String(tarefaAposEnviar.motivoCodigo))
  ok("07) ponteiro da Tarefa já aponta para o passo 2", tarefaAposEnviar.workflowStepInstanceId === p.stepIds[1])

  const estados1 = await estadosTemporaisDasOperacoes(prisma, [p.tarefaId], agora())
  const estado1 = estados1.get(p.tarefaId)
  ok("08) motor temporal já lê ESPERA EXTERNA para o passo 2 (aguardandoTerceiro=true)", estado1?.proximoAcontecimento.aguardandoTerceiro === true, JSON.stringify(estado1?.proximoAcontecimento).slice(0, 200))
  ok("08b) nunca atraso interno enquanto espera automática (Etapa 3, item 3)", estado1?.atrasoInterno === false)
  // CORREÇÃO (15/09/2026) — a PROJEÇÃO (coluna, cards de Minha Operação/
  // Tarefas e Projetos/Kanban) tem que ler o mesmo estado que o motor
  // temporal já lia corretamente — não uma checagem paralela que só olhava
  // `statusTarefa` literal.
  ok("08c) colunaDaTarefa lê AGUARDANDO_TERCEIRO (não BLOQUEADA) — mesma semântica de ehEsperaExterna",
    colunaDaTarefa({ statusTarefa: tarefaAposEnviar.statusTarefa, motivoCodigo: tarefaAposEnviar.motivoCodigo, responsavelId: daniela.id }) === "AGUARDANDO_TERCEIRO")
  const visaoAguardando1 = await visaoGerencial({ processoId: processo.id, coluna: "AGUARDANDO_TERCEIRO" }, agora(), prisma)
  ok("08d) visaoGerencial(coluna=AGUARDANDO_TERCEIRO) inclui a Tarefa", visaoAguardando1.linhas.some((l) => l.taskId === p.tarefaId), `total=${visaoAguardando1.total}`)
  const visaoBloqueada1 = await visaoGerencial({ processoId: processo.id, coluna: "BLOQUEADA" }, agora(), prisma)
  ok("08e) visaoGerencial(coluna=BLOQUEADA) NÃO inclui a Tarefa (não é bloqueio interno)", !visaoBloqueada1.linhas.some((l) => l.taskId === p.tarefaId))

  // ══════════════════════════════════════════════════════════════════════
  secao("9-16) TRANSIÇÃO 2→3 — concluir 'Aguardar retorno do cartório' já deixa 'Receber certidão' esperando, sem clique nenhum")
  // ══════════════════════════════════════════════════════════════════════
  const r2 = await executarAcaoCadastrada(p.stepIds[1], "retorno_chegou", {}, ctx)
  ok("09) passo 2 conclui mesmo com a Tarefa BLOQUEADA (a mesma ação que sempre concluiu)", r2.ok === true, JSON.stringify(r2).slice(0, 200))

  const step2FinalStatus = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[1] }, select: { status: true } })
  ok("10) passo 2 fica CONCLUIDO", step2FinalStatus.status === "CONCLUIDO", step2FinalStatus.status)

  const step3Depois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[2] }, select: { status: true, stepKey: true } })
  ok("11) passo 3 (receber_certidao) já nasce BLOQUEADO — automático, de novo", step3Depois.status === "BLOQUEADO" && step3Depois.stepKey === "receber_certidao", JSON.stringify(step3Depois))

  const tarefaAposRetorno = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { statusTarefa: true, motivoCodigo: true, workflowStepInstanceId: true } })
  ok("12) Tarefa CONTINUA BLOQUEADA — a espera passou do cartório-protocolo para o cartório-certidão sem sair da espera", tarefaAposRetorno.statusTarefa === "BLOQUEADA", tarefaAposRetorno.statusTarefa)
  ok("13) motivoCodigo continua AGUARDANDO_TERCEIRO", tarefaAposRetorno.motivoCodigo === "AGUARDANDO_TERCEIRO")
  ok("14) ponteiro avança para o passo 3", tarefaAposRetorno.workflowStepInstanceId === p.stepIds[2])

  const estados2 = await estadosTemporaisDasOperacoes(prisma, [p.tarefaId], agora())
  const estado2 = estados2.get(p.tarefaId)
  ok("15) motor temporal lê ESPERA EXTERNA para o passo 3 também", estado2?.proximoAcontecimento.aguardandoTerceiro === true, JSON.stringify(estado2?.proximoAcontecimento).slice(0, 200))
  ok("16) nunca atraso interno", estado2?.atrasoInterno === false)

  // ══════════════════════════════════════════════════════════════════════
  secao("17-22) certidão chega → 'Registrar recebimento' funciona bloqueado e desbloqueia sozinho")
  // ══════════════════════════════════════════════════════════════════════
  await prisma.documentoArquivo.create({ data: { documentoId: p.doc.id, tipo: "OUTRO", url: `https://x/${MARCA}/cert.pdf`, nome: "cert.pdf" } })
  const r3 = await executarAcaoCadastrada(p.stepIds[2], "recebido", { documento_url: `https://x/${MARCA}/cert.pdf` }, ctx)
  ok("17) 'Registrar recebimento' sucede com a Tarefa BLOQUEADA", r3.ok === true, JSON.stringify(r3).slice(0, 200))

  const step3Final = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[2] }, select: { status: true } })
  ok("18) passo 3 conclui", step3Final.status === "CONCLUIDO", step3Final.status)

  const tarefaFinal = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { statusTarefa: true, workflowStepInstanceId: true } })
  ok("19) Tarefa SAI de BLOQUEADA sozinha", tarefaFinal.statusTarefa !== "BLOQUEADA", tarefaFinal.statusTarefa)
  ok("20) ponteiro avança para o passo 4", tarefaFinal.workflowStepInstanceId === p.stepIds[3])

  const step4 = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[3] }, select: { status: true, stepKey: true } })
  ok("21) passo 4 (conferir e validar) fica DISPONÍVEL — não é espera externa, é ação interna normal", step4.status === "DISPONIVEL" && step4.stepKey === "conferir_e_validar_certidao", JSON.stringify(step4))

  const estados3 = await estadosTemporaisDasOperacoes(prisma, [p.tarefaId], agora())
  const estado3 = estados3.get(p.tarefaId)
  ok("22) motor temporal não lê mais espera externa depois do recebimento", estado3?.proximoAcontecimento.aguardandoTerceiro === false, String(estado3?.proximoAcontecimento.aguardandoTerceiro))

  console.log(`\n${"─".repeat(70)}\nRESULTADO: ${passou} passaram, ${falhou} falharam\n${"─".repeat(70)}`)
  if (falhou > 0) { console.log("FALHAS:", falhas); process.exit(1) }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
