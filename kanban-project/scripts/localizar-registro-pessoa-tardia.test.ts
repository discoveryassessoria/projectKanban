// scripts/localizar-registro-pessoa-tardia.test.ts
// ============================================================================
// PESSOA/UNIÃO QUE ENTRA NA LINHAGEM DEPOIS DE A GENEALOGIA CONCLUIR (achado real 06/10/2026, processo 683 Fogli):
// o Rodolfo entrou com o processo já na Emissão → NÃO nasceu "Localizar registro", a Genealogia seguiu em 100% e as 3 certidões
// dele nasceram na Emissão sem dados registrais. E a Carlota (processo 676): "Localizar registro" reaberto depois de a Genealogia
// avançar, sem que nada reagisse.
//
// Regra provada: (1) o passo nasce (pessoa E união/casamento); (2) a Genealogia reabre (ATIVO), nunca dá 100% com passo aberto e o
// histórico registra "Genealogia reaberta"; (3) a Emissão da MESMA necessidade fica BLOQUEADA "Aguardando Genealogia" e as outras
// não são tocadas; (4) concluir o "Localizar registro" libera sozinho e a Genealogia fecha de novo; (5) passo reaberto depois do
// avanço (caso Carlota) reabre a Genealogia e trava a emissão; (6) idempotente.
//
//   node scripts/ci/gate-build.mjs --so localizar-registro-pessoa-tardia
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "LRPT"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("localizar-registro-pessoa-tardia.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  await P.montarMacroDuasFases()
  console.log("LOCALIZAR REGISTRO — PESSOA/UNIÃO TARDIA\n")

  const { reconciliarMotorDeFases } = await import("../src/lib/motor/reconciliar-motor-fases")
  const { calcularPendencias } = await import("../src/lib/motor/blocking-engine")
  const { reconciliarGenealogiaEEmissao, MOTIVO_AGUARDANDO_GENEALOGIA } = await import("../src/services/genealogia/trava-emissao-por-genealogia")
  const { transicionarPassoTx } = await import("../src/services/task-step-sync")

  const c = await P.novoCenario("tardia", { conjuge: true })
  await P.putPessoa(c.titularId, { casado: true })
  await P.postUniao(c.titularId, c.conjugeId!)
  let f = await P.foto(c.processoId)
  for (const p of f.passos.filter((x) => x.stepKey === "localizar_registro")) {
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.id }, data: { status: "CONCLUIDO", completedAt: new Date() } })
    await prisma.tarefa.updateMany({ where: { workflowStepInstanceId: p.id }, data: { statusTarefa: "CONCLUIDO_RECEBIDO" } })
  }
  const av = await reconciliarMotorDeFases(c.processoId, { origem: "teste-avanco" })
  const proc0 = await prisma.processo.findUniqueOrThrow({ where: { id: c.processoId }, select: { faseAtualKey: true } })
  ok("pré: processo avançou para a Emissão com a Genealogia CONCLUÍDA", proc0.faseAtualKey === "emissao_documental" && (await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: c.instanciaId } })).status === "CONCLUIDO", `${proc0.faseAtualKey} ${av.code} ${JSON.stringify(av.pendencias.map((x) => `${x.code}:${x.entityId}`))} passos=${JSON.stringify(f.passos.map((x) => `${x.stepKey}:${x.status}`))}`)
  f = await P.foto(c.processoId)
  const emissaoDoTitular = f.passos.filter((p) => p.stepKey === "solicitar_certidao")
  ok("pré: a Emissão tem certidões do titular, todas disponíveis", emissaoDoTitular.length >= 1 && emissaoDoTitular.every((p) => p.status === "DISPONIVEL"), JSON.stringify(emissaoDoTitular.map((p) => p.status)))

  // ── (A) PESSOA nova depois da Genealogia concluída ─────────────────────────────────────────────────────────────────────
  secao("(A) Pessoa entra na linhagem com o processo já na Emissão")
  const r = await P.postPessoa({ nome: "Rodolfo", sobrenome: `${MARCA}-pai`, arvoreId: c.arvoreId, linhaReta: true, documentacao: true, paiId: c.titularId })
  ok("POST /api/pessoas responde 201", r.status === 201, String(r.status))
  const rodolfoId = (await r.json()).id as number
  f = await P.foto(c.processoId)
  const nascR = f.necDe("NAS", { pessoaId: rodolfoId })[0]
  ok("nasceu a necessidade de nascimento do Rodolfo", !!nascR)
  const locR = f.passos.filter((p) => p.necessidadeId === nascR?.id && p.stepKey === "localizar_registro")
  ok("NASCEU o passo 'Localizar registro' dele (antes: nenhum)", locR.length === 1 && locR[0].status === "DISPONIVEL", JSON.stringify(locR))
  const instG = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: c.instanciaId } })
  ok("a Genealogia REABRIU (ATIVO, sem data de conclusão) — a mesma instância, nada recriado", instG.status === "ATIVO" && instG.completedAt === null, instG.status)
  const tarefaLoc = f.tarefas.filter((t) => t.necessidadeId === nascR?.id && !P.TAREFA_FECHADA.includes(t.statusTarefa) && t.id)
  ok("o passo virou TAREFA aberta na Genealogia", tarefaLoc.length >= 1, JSON.stringify(tarefaLoc.map((t) => t.titulo)))
  const log = await prisma.logAuditoria.findMany({ where: { acao: "GENEALOGIA_REABERTA", entidade: "Processo", entidadeId: c.processoId } })
  ok("histórico do processo: 'Genealogia reaberta: pessoa Rodolfo … adicionada à linhagem'", log.length === 1 && /Genealogia reaberta: pessoa Rodolfo .* adicionada à linhagem/.test(log[0].descricao), log[0]?.descricao)
  const g = await calcularPendencias(c.processoId, "genealogia")
  ok("a Genealogia NÃO está liberada (nunca 100% com Localizar registro aberto)", g.canAdvance === false, JSON.stringify(g.blocking?.map((b) => b.code)))

  const emR = f.passos.filter((p) => p.stepKey === "solicitar_certidao" && f.docs.find((d) => d.id === p.documentoId)?.necessidadeId === nascR?.id)
  ok("a certidão de nascimento do Rodolfo existe na Emissão e está BLOQUEADA", emR.length === 1 && emR[0].status === "BLOQUEADO", JSON.stringify(emR))
  // As tarefas da Emissão nascem pelo reconciliador canônico (cron/propagação): uma tarefa que nasce DEPOIS do bloqueio nasce bloqueada.
  const { reconciliarTarefas } = await import("../lib/operacional/reconciliar-tarefas")
  await reconciliarTarefas({ processoId: c.processoId })
  if (emR[0]) {
    const passoR = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: emR[0].id }, select: { motivo: true } })
    ok(`motivo do bloqueio = "${MOTIVO_AGUARDANDO_GENEALOGIA}"`, passoR.motivo === MOTIVO_AGUARDANDO_GENEALOGIA, String(passoR.motivo))
    const tarR = await prisma.tarefa.findMany({ where: { necessidadeId: nascR!.id, statusTarefa: { notIn: P.TAREFA_FECHADA as never } }, select: { id: true, faseMacroKey: true, statusTarefa: true } })
    ok("UMA tarefa aberta para a obrigação, e ela mostra o 'Localizar registro' (Genealogia)", tarR.length === 1 && tarR[0].faseMacroKey === "genealogia", JSON.stringify(tarR))
  }
  const outras = f.passos.filter((p) => p.stepKey === "solicitar_certidao" && p.id !== emR[0]?.id)
  ok("as certidões das OUTRAS pessoas não foram tocadas", outras.length >= 1 && outras.every((p) => p.status === "DISPONIVEL"), JSON.stringify(outras.map((p) => p.status)))

  // ── (B) UNIÃO (casamento) tardia ───────────────────────────────────────────────────────────────────────────────────────
  secao("(B) Casamento (união) do Rodolfo entra depois — o 'Localizar registro' também nasce para a UNIÃO")
  await P.putPessoa(rodolfoId, { casado: true })
  const esposa = await P.postPessoa({ nome: "Esposa", sobrenome: `${MARCA}-esp`, arvoreId: c.arvoreId, linhaReta: false, documentacao: true })
  const esposaId = (await esposa.json()).id as number
  const ru = await P.postUniao(rodolfoId, esposaId)
  ok("POST /api/unioes responde 2xx", ru.status < 300, String(ru.status))
  const uniao = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: rodolfoId } })
  f = await P.foto(c.processoId)
  const casR = f.necDe("CAS", { uniaoId: uniao.id })[0]
  ok("nasceu a necessidade de casamento da UNIÃO", !!casR)
  const locCas = f.passos.filter((p) => p.necessidadeId === casR?.id && p.stepKey === "localizar_registro")
  ok("nasceu o 'Localizar registro' do casamento (identidade = necessidade da união)", locCas.length === 1 && locCas[0].status === "DISPONIVEL", JSON.stringify(locCas))
  const emCas = f.passos.filter((p) => p.stepKey === "solicitar_certidao" && f.docs.find((d) => d.id === p.documentoId)?.necessidadeId === casR?.id)
  ok("a certidão de casamento na Emissão está BLOQUEADA", emCas.length === 1 && emCas[0].status === "BLOQUEADO", JSON.stringify(emCas))

  // ── (C) idempotência ───────────────────────────────────────────────────────────────────────────────────────────────────
  secao("(C) Idempotência — reconciliar de novo não duplica nada")
  const antesN = (await P.foto(c.processoId)).passos.length
  await reconciliarGenealogiaEEmissao(c.processoId)
  await reconciliarMotorDeFases(c.processoId, { origem: "teste-idem" })
  const depoisN = (await P.foto(c.processoId)).passos.length
  ok("nenhum passo novo", antesN === depoisN, `${antesN} → ${depoisN}`)
  ok("um único log de reabertura", (await prisma.logAuditoria.count({ where: { acao: "GENEALOGIA_REABERTA", entidade: "Processo", entidadeId: c.processoId } })) <= 2)

  // ── (D) concluir o 'Localizar registro' libera sozinho ─────────────────────────────────────────────────────────────────
  secao("(D) Concluir o 'Localizar registro' libera a certidão sozinho; a Genealogia fecha de novo")
  const concluir = async (stepId: number) => prisma.$transaction(async (tx) => {
    const st = await tx.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { ciclo: true, workflowInstanceId: true } })
    return transicionarPassoTx(tx, stepId, "CONCLUIDO", { correlationId: `lrpt|${stepId}`, operacao: "teste", ciclo: st.ciclo ?? 1, processoId: c.processoId, workflowInstanceId: st.workflowInstanceId, ignorarDependencias: true })
  })
  await concluir(locR[0].id)
  f = await P.foto(c.processoId)
  ok("nascimento do Rodolfo: certidão LIBERADA (DISPONIVEL)", f.passos.find((p) => p.id === emR[0].id)?.status === "DISPONIVEL")
  const tarLib = await prisma.tarefa.findMany({ where: { necessidadeId: nascR!.id, statusTarefa: { notIn: P.TAREFA_FECHADA as never } }, select: { statusTarefa: true, motivoCodigo: true, faseMacroKey: true, workflowStepInstanceId: true } })
  ok("e a tarefa da obrigação segue para a Emissão (NÃO INICIADA, ligada ao passo da certidão)", tarLib.length === 1 && tarLib[0].statusTarefa === "NAO_INICIADA" && tarLib[0].faseMacroKey === "emissao_documental" && tarLib[0].workflowStepInstanceId === emR[0].id, JSON.stringify(tarLib))
  ok("o casamento continua BLOQUEADO (o registro dele ainda não foi localizado)", f.passos.find((p) => p.id === emCas[0].id)?.status === "BLOQUEADO")
  ok("a Genealogia segue aberta enquanto houver Localizar registro aberto", (await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: c.instanciaId } })).status === "ATIVO")
  await concluir(locCas[0].id)
  f = await P.foto(c.processoId)
  ok("casamento: certidão LIBERADA", f.passos.find((p) => p.id === emCas[0].id)?.status === "DISPONIVEL")
  ok("a Genealogia FECHOU de novo (CONCLUÍDO) — histórico preservado", (await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: c.instanciaId } })).status === "CONCLUIDO")
  ok("o processo continua na Emissão (a fase do processo não se mexe)", (await prisma.processo.findUniqueOrThrow({ where: { id: c.processoId }, select: { faseAtualKey: true } })).faseAtualKey === "emissao_documental")

  // ── (E) caso Carlota: passo REABERTO depois do avanço ──────────────────────────────────────────────────────────────────
  secao("(E) Passo 'Localizar registro' reaberto depois de a Genealogia avançar (caso Carlota)")
  const locTit = f.passos.find((p) => p.stepKey === "localizar_registro" && p.necessidadeId === f.necDe("NAS", { pessoaId: c.titularId })[0].id)!
  const emTit = f.passos.find((p) => p.stepKey === "solicitar_certidao" && f.docs.find((d) => d.id === p.documentoId)?.necessidadeId === f.necDe("NAS", { pessoaId: c.titularId })[0].id)!
  const { reabrirPassoTx } = await import("../src/services/task-step-sync")
  await prisma.$transaction(async (tx) => {
    await reabrirPassoTx(tx, locTit.id, "DISPONIVEL", { correlationId: "lrpt|reabrir", operacao: "teste", ciclo: 1, processoId: c.processoId, workflowInstanceId: c.instanciaId, ignorarDependencias: true })
  })
  ok("a Genealogia REABRIU por causa do passo reaberto", (await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: c.instanciaId } })).status === "ATIVO")
  ok("a certidão do titular na Emissão TRAVOU", (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: emTit.id } })).status === "BLOQUEADO")
  await concluir(locTit.id)
  ok("concluído de novo: certidão liberada e Genealogia fechada", (await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: emTit.id } })).status === "DISPONIVEL" && (await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: c.instanciaId } })).status === "CONCLUIDO")

  // ── (F) tarefa JÁ na Emissão (caso Fogli/Carlota em produção): mesma tarefa, taskId preservado ───────────────────────────
  secao("(F) A tarefa que já estava na Emissão passa a mostrar o 'Localizar registro' (mesmo taskId) e volta quando localizar")
  f = await P.foto(c.processoId)
  const nasTit = f.necDe("NAS", { pessoaId: c.titularId })[0]
  const tarefaEmissao = await prisma.tarefa.findFirstOrThrow({ where: { necessidadeId: nasTit.id, statusTarefa: { notIn: P.TAREFA_FECHADA as never } }, select: { id: true, workflowStepInstanceId: true } })
  await prisma.$transaction(async (tx) => {
    await reabrirPassoTx(tx, locTit.id, "DISPONIVEL", { correlationId: "lrpt|reabrir2", operacao: "teste", ciclo: 1, processoId: c.processoId, workflowInstanceId: c.instanciaId, ignorarDependencias: true })
  })
  const tReanc = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEmissao.id }, select: { faseMacroKey: true, workflowStepInstanceId: true, statusTarefa: true } })
  ok("a MESMA tarefa (taskId) agora está no 'Localizar registro'", tReanc.faseMacroKey === "genealogia" && tReanc.workflowStepInstanceId === locTit.id && tReanc.statusTarefa === "NAO_INICIADA", JSON.stringify(tReanc))
  await concluir(locTit.id)
  const tVolta = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEmissao.id }, select: { faseMacroKey: true, workflowStepInstanceId: true, statusTarefa: true } })
  ok("localizado: a MESMA tarefa volta para a certidão da Emissão, aberta", tVolta.faseMacroKey === "emissao_documental" && tVolta.workflowStepInstanceId === tarefaEmissao.workflowStepInstanceId && tVolta.statusTarefa === "NAO_INICIADA", JSON.stringify(tVolta))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} LOCALIZAR REGISTRO — PESSOA/UNIÃO TARDIA — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
