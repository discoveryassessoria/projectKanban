// scripts/motor-operacional-fases.test.ts
// ============================================================================
// O MOTOR OPERACIONAL ATRAVÉS DAS FASES — §70 a §78.
// Rodar: npm run test:motor-fases-tarefas   (banco de TESTE)
//
// A pergunta que este arquivo responde: o processo se mexe — avança, volta,
// avança de novo — e o TRABALHO sobrevive intacto?
//
// É onde as arquiteturas de tarefa costumam morrer. Avançar de fase parece um
// bom momento para "limpar" as pendências da fase anterior, e voltar parece um
// bom momento para "recomeçar". Os dois instintos destroem trabalho real: a
// certidão que o cartório ainda não devolveu não deixa de ser esperada porque o
// processo seguiu, e o pedido já enviado não precisa ser reenviado porque
// alguém voltou a fase para investigar outra coisa.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { criarTarefaManual, reabrirTarefa, bloquearTarefa, desbloquearTarefa, devolverAFila, declararDependencia, podeExecutar } from "@/lib/operacional/tarefa-ciclo"
import { atribuirTarefa, iniciarTarefa } from "@/lib/operacional/tarefa-comandos"
import { minhaFila, filaDaEquipe, dossieDaTarefa, cargaPorResponsavel } from "@/lib/operacional/tarefa-projecoes"

const MARCA = "MOTOR-FASE"

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
  await prisma.tarefaDependencia.deleteMany({ where: { OR: [{ tarefaId: { in: ts.map((t) => t.id) } }, { dependeDeId: { in: ts.map((t) => t.id) } }] } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@motor.test" } } })
}

interface Ctx { processoId: number; arvoreId: number; pessoaId: number }

async function processo(): Promise<Ctx> {
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, pais: "espanha", arvoreId: arv.id, faseAtualKey: "genealogia" }, select: { id: true },
  })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ademir", sobrenome: "Matheus" }, select: { id: true } })
  return { processoId: proc.id, arvoreId: arv.id, pessoaId: pes.id }
}

/** Uma obrigação de uma fase: necessidade + instância + etapas. */
async function obrigacao(c: Ctx, fase: string, sufixo: string, etapas = 3) {
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_${sufixo}`, name: `Trabalho ${sufixo}`, natureza: "DOCUMENTO" }, select: { id: true },
  })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: c.processoId, itemCatalogoId: item.id, pessoaId: c.pessoaId, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${sufixo}-${c.processoId}` },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: c.processoId, faseMacroKey: fase, ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${sufixo}-${c.processoId}` },
    select: { id: true },
  })
  const stepIds: number[] = []
  for (let i = 0; i < etapas; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: c.processoId, faseMacroKey: fase, stepKey: `${sufixo}_e${i + 1}`,
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, pessoaId: c.pessoaId, papel: "equipe_documental", slaDays: 5,
        chaveIdempotencia: `${MARCA}-step-${sufixo}-${c.processoId}-${i}`,
      },
      select: { id: true },
    })
    stepIds.push(s.id)
  }
  return { necessidadeId: nec.id, instanciaId: inst.id, stepIds }
}

const tarefas = (processoId: number) =>
  prisma.tarefa.findMany({
    where: { processoId },
    select: { id: true, titulo: true, statusTarefa: true, faseMacroKey: true, origem: true, concluida: true, workflowInstanceId: true },
    orderBy: { id: "asc" },
  })

/** Muda a fase macro do processo — só a POSIÇÃO, nada mais. */
const moverFase = (processoId: number, fase: string) =>
  prisma.processo.update({ where: { id: processoId }, data: { faseAtualKey: fase } })

async function main() {
  exigirBancoDeTeste("prova o motor operacional através das fases")
  await limpar()

  console.log("MOTOR OPERACIONAL ATRAVÉS DAS FASES\n")
  const c = await processo()
  const gen = await obrigacao(c, "genealogia", "GEN")

  // ═════════════════════════════════════════════════════════════════════════
  secao("70) Criar processo → tarefas da fase inicial nascem sozinhas")
  // ═════════════════════════════════════════════════════════════════════════
  await reconciliarTarefas({ processoId: c.processoId })
  let ts = await tarefas(c.processoId)
  ok("a obrigação virou UMA tarefa", ts.length === 1, `${ts.length}`)
  ok("sem ninguém ter pedido à mão", ts[0]?.origem === "RECONCILIADOR", String(ts[0]?.origem))
  const tarefaGen = ts[0].id

  // ═════════════════════════════════════════════════════════════════════════
  secao("4/5) Avançar fase — a pendência anterior SOBREVIVE")
  // ═════════════════════════════════════════════════════════════════════════
  // A tarefa da genealogia está no meio do caminho quando o processo avança.
  await atribuirTarefa({ tarefaId: tarefaGen, responsavelId: (await prisma.usuario.create({ data: { nome: "Dani", email: "dani@motor.test", senha: "x", tipo: "assistente" }, select: { id: true } })).id, autorId: null })
  const dani = (await prisma.usuario.findFirstOrThrow({ where: { email: "dani@motor.test" }, select: { id: true } })).id
  await iniciarTarefa({ tarefaId: tarefaGen, autorId: dani })

  await moverFase(c.processoId, "emissao")
  const emi = await obrigacao(c, "emissao", "EMI")
  await reconciliarTarefas({ processoId: c.processoId })

  ts = await tarefas(c.processoId)
  ok("nasceu a tarefa da fase nova", ts.length === 2, `${ts.length}`)
  const gAntes = ts.find((t) => t.id === tarefaGen)
  ok("a tarefa da fase ANTERIOR continua existindo", !!gAntes)
  ok("e continua EM_ANDAMENTO — não foi concluída pelo avanço", gAntes?.statusTarefa === "EM_ANDAMENTO", gAntes?.statusTarefa)
  ok("e não foi cancelada nem invalidada", gAntes?.concluida === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("7/8/9) Voltar fase — nada recria, nada reabre, nada reseta")
  // ═════════════════════════════════════════════════════════════════════════
  const antesVolta = JSON.stringify(await tarefas(c.processoId))
  await moverFase(c.processoId, "genealogia")
  await reconciliarTarefas({ processoId: c.processoId })
  const depoisVolta = await tarefas(c.processoId)
  ok("nenhuma tarefa foi criada ao voltar", depoisVolta.length === 2, `${depoisVolta.length}`)
  ok("nenhum estado mudou", JSON.stringify(depoisVolta) === antesVolta)
  ok("a tarefa da emissão NÃO foi removida por a fase ter voltado",
    depoisVolta.some((t) => t.faseMacroKey === "emissao"))

  // Uma tarefa concluída na fase para onde voltamos permanece concluída.
  for (const id of gen.stepIds) await prisma.phaseWorkflowStepInstance.update({ where: { id }, data: { status: "CONCLUIDO" } })
  await reconciliarTarefas({ processoId: c.processoId })
  const gConcluida = (await tarefas(c.processoId)).find((t) => t.id === tarefaGen)
  ok("a tarefa concluiu quando o workflow terminou", gConcluida?.concluida === true, gConcluida?.statusTarefa)
  await moverFase(c.processoId, "emissao")
  await moverFase(c.processoId, "genealogia")
  await reconciliarTarefas({ processoId: c.processoId })
  const gDepois = (await tarefas(c.processoId)).find((t) => t.id === tarefaGen)
  ok("voltar para a fase dela NÃO a reabre", gDepois?.concluida === true, gDepois?.statusTarefa)
  ok("e não gera uma duplicata", (await tarefas(c.processoId)).filter((t) => t.workflowInstanceId === gen.instanciaId).length === 1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("10/55/72) Voltar fase e criar TRABALHO NOVO à mão")
  // ═════════════════════════════════════════════════════════════════════════
  const manual = await criarTarefaManual({
    processoId: c.processoId, titulo: "Investigar divergência registral adicional",
    autorId: dani, faseMacroKey: "genealogia", pessoaId: c.pessoaId,
    motivo: "Divergência de grafia encontrada na certidão do pai", equipeKey: "equipe_documental",
  })
  ok("a tarefa manual foi criada", manual.ok === true, manual.ok ? "" : manual.mensagem)
  const idManual = manual.ok ? manual.tarefaId : 0
  const tm = await prisma.tarefa.findUniqueOrThrow({ where: { id: idManual }, select: { origem: true, justificativa: true, workflowInstanceId: true } })
  ok("com origem MANUAL", tm.origem === "MANUAL")
  ok("e motivo registrado", !!tm.justificativa)
  ok("sem workflow — trabalho que ninguém modelou ainda", tm.workflowInstanceId === null)

  // Avançar de novo não a apaga.
  await moverFase(c.processoId, "emissao")
  await reconciliarTarefas({ processoId: c.processoId })
  const aindaManual = await prisma.tarefa.findUnique({ where: { id: idManual }, select: { statusTarefa: true } })
  ok("a tarefa manual sobrevive ao avanço", aindaManual?.statusTarefa === "NAO_INICIADA", aindaManual?.statusTarefa)
  ok("e o reconciliador NÃO a cancela por não ter obrigação automática",
    aindaManual?.statusTarefa !== "CANCELADA")

  // ═════════════════════════════════════════════════════════════════════════
  secao("13) Aviso de possível duplicidade — avisa, não bloqueia")
  // ═════════════════════════════════════════════════════════════════════════
  // Pessoa sozinha NÃO dispara aviso: a mesma pessoa tem várias obrigações
  // legítimas abertas, e avisar em todas faria o operador confirmar por reflexo.
  const soPessoa = await criarTarefaManual({
    processoId: c.processoId, titulo: "Trabalho novo da mesma pessoa", autorId: dani,
    pessoaId: c.pessoaId, motivo: "outra frente de investigação",
  })
  ok("coincidir só a pessoa NÃO dispara aviso", soPessoa.ok === true, soPessoa.ok ? "" : soPessoa.mensagem)

  // Já a MESMA obrigação dispara: aí é provável retrabalho disfarçado.
  const mesmaObrigacao = await criarTarefaManual({
    processoId: c.processoId, titulo: "Refazer o mesmo trabalho", autorId: dani,
    necessidadeId: emi.necessidadeId, motivo: "teste de duplicidade",
  })
  ok("coincidir a OBRIGAÇÃO dispara o aviso", mesmaObrigacao.ok === false && mesmaObrigacao.codigo === "CONFLITO",
    mesmaObrigacao.ok ? "" : mesmaObrigacao.mensagem)
  const confirmada = await criarTarefaManual({
    processoId: c.processoId, titulo: "Refazer o mesmo trabalho", autorId: dani,
    necessidadeId: emi.necessidadeId, motivo: "teste de duplicidade", confirmarDuplicidade: true,
  })
  ok("e passa quando o usuário confirma explicitamente", confirmada.ok === true)

  // ═════════════════════════════════════════════════════════════════════════
  secao("73) Retrabalho — reabrir é a MESMA tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  const antesReabrir = await prisma.tarefa.count({ where: { processoId: c.processoId } })
  const re = await reabrirTarefa({ tarefaId: tarefaGen, autorId: dani, motivo: "cartório enviou certidão com erro" })
  ok("a reabertura deu certo", re.ok === true, re.ok ? "" : re.mensagem)
  ok("mesmo taskId", re.ok && re.tarefaId === tarefaGen)
  ok("nenhuma tarefa nova", (await prisma.tarefa.count({ where: { processoId: c.processoId } })) === antesReabrir)
  const gRe = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaGen }, select: { statusTarefa: true, concluida: true, dataConclusao: true, justificativa: true } })
  ok("voltou a EM_ANDAMENTO", gRe.statusTarefa === "EM_ANDAMENTO")
  ok("sem data de conclusão", gRe.dataConclusao === null)
  ok("com o motivo registrado", /erro/.test(gRe.justificativa ?? ""))
  ok("as etapas voltaram a ficar disponíveis",
    (await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: gen.instanciaId, status: "DISPONIVEL" } })) > 0)
  ok("reabrir tarefa que não está encerrada é recusado",
    (await reabrirTarefa({ tarefaId: tarefaGen, autorId: dani, motivo: "x" })).ok === false)
  ok("reabrir sem motivo é recusado",
    (await reabrirTarefa({ tarefaId: tarefaGen, autorId: dani, motivo: "  " })).ok === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("75) Dependência — duas obrigações, não etapa de uma delas")
  // ═════════════════════════════════════════════════════════════════════════
  const tarefaEmi = (await tarefas(c.processoId)).find((t) => t.workflowInstanceId === emi.instanciaId)!.id
  await declararDependencia({ tarefaId: tarefaEmi, dependeDeId: tarefaGen, motivo: "traduzir exige a certidão" })
  let dep = await podeExecutar(tarefaEmi)
  ok("enquanto a pré-requisito está aberta, a outra não pode executar", dep.pode === false, JSON.stringify(dep))
  ok("e ela diz QUEM a está travando", dep.bloqueadaPor.includes(tarefaGen))
  ok("mas continua existindo na fila (não some)",
    (await prisma.tarefa.count({ where: { id: tarefaEmi } })) === 1)

  for (const id of gen.stepIds) await prisma.phaseWorkflowStepInstance.update({ where: { id }, data: { status: "CONCLUIDO" } })
  await reconciliarTarefas({ processoId: c.processoId })
  dep = await podeExecutar(tarefaEmi)
  ok("concluída a pré-requisito, a outra libera", dep.pode === true)
  ok("declarar a mesma dependência 2x não empilha",
    (await prisma.tarefaDependencia.count({ where: { tarefaId: tarefaEmi, dependeDeId: tarefaGen } })) === 1)
  await declararDependencia({ tarefaId: tarefaEmi, dependeDeId: tarefaGen })
  ok("mesmo depois de repetir", (await prisma.tarefaDependencia.count({ where: { tarefaId: tarefaEmi, dependeDeId: tarefaGen } })) === 1)
  ok("ciclo é recusado", (await declararDependencia({ tarefaId: tarefaGen, dependeDeId: tarefaEmi })).ok === false)
  ok("depender de si mesma é recusado", (await declararDependencia({ tarefaId: tarefaGen, dependeDeId: tarefaGen })).ok === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("33/34) Bloquear e desbloquear — mesma tarefa, ponto preservado")
  // ═════════════════════════════════════════════════════════════════════════
  await atribuirTarefa({ tarefaId: tarefaEmi, responsavelId: dani, autorId: dani })
  await iniciarTarefa({ tarefaId: tarefaEmi, autorId: dani })
  const nAntes = await prisma.tarefa.count({ where: { processoId: c.processoId } })
  ok("bloquear sem motivo é recusado", (await bloquearTarefa({ tarefaId: tarefaEmi, autorId: dani, motivo: "" })).ok === false)
  await bloquearTarefa({ tarefaId: tarefaEmi, autorId: dani, motivo: "cartório exige procuração" })
  const bl = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEmi }, select: { statusTarefa: true, blockedPreviousStatus: true } })
  ok("a tarefa fica BLOQUEADA", bl.statusTarefa === "BLOQUEADA")
  ok("guardando o estado anterior para voltar certo", bl.blockedPreviousStatus === "EM_ANDAMENTO", String(bl.blockedPreviousStatus))
  ok("sem criar tarefa de desbloqueio", (await prisma.tarefa.count({ where: { processoId: c.processoId } })) === nAntes)
  await desbloquearTarefa({ tarefaId: tarefaEmi, autorId: dani })
  ok("desbloquear devolve ao estado de antes",
    (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEmi }, select: { statusTarefa: true } })).statusTarefa === "EM_ANDAMENTO")

  // ═════════════════════════════════════════════════════════════════════════
  secao("24/25) Devolver à fila — redistribuição sem perder nada")
  // ═════════════════════════════════════════════════════════════════════════
  await devolverAFila({ tarefaId: tarefaEmi, autorId: dani, motivo: "férias" })
  const dev = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaEmi }, select: { responsavelId: true, equipeKey: true, statusTarefa: true, dataInicio: true } })
  ok("perde o responsável", dev.responsavelId === null)
  ok("mantém a equipe", dev.equipeKey === "equipe_documental")
  ok("mantém o que já foi trabalhado (dataInicio)", dev.dataInicio != null)
  ok("e continua sendo a mesma tarefa", (await prisma.tarefa.count({ where: { processoId: c.processoId } })) === nAntes)

  // ═════════════════════════════════════════════════════════════════════════
  secao("62/63/66) Projeções — mesmo taskId, carga em TAREFAS")
  // ═════════════════════════════════════════════════════════════════════════
  const fila = await filaDaEquipe("equipe_documental")
  ok("a fila da equipe mostra a tarefa sem dono", fila.some((l) => l.taskId === tarefaEmi))
  ok("e não mostra tarefa com dono", !fila.some((l) => l.responsavelId != null))
  await atribuirTarefa({ tarefaId: tarefaEmi, responsavelId: dani, autorId: dani })
  const minha = await minhaFila(dani)
  ok("Minha Fila mostra a tarefa atribuída", minha.some((l) => l.taskId === tarefaEmi))
  ok("com o MESMO taskId da fila da equipe", minha.find((l) => l.taskId === tarefaEmi)?.taskId === tarefaEmi)
  ok("a fila da equipe deixa de mostrá-la", !(await filaDaEquipe("equipe_documental")).some((l) => l.taskId === tarefaEmi))

  const carga = await cargaPorResponsavel()
  const daCarga = carga.find((x) => x.responsavelId === dani)
  const tarefasAtivasDela = await prisma.tarefa.count({ where: { responsavelId: dani, statusTarefa: { in: ["NAO_INICIADA", "EM_ANDAMENTO", "AGUARDANDO_CLIENTE", "AGUARDANDO_TERCEIRO", "BLOQUEADA"] } } })
  ok("a carga conta TAREFAS, não etapas", daCarga?.tarefasAtivas === tarefasAtivasDela, `${daCarga?.tarefasAtivas} vs ${tarefasAtivasDela} tarefas`)
  const etapasDela = await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstance: { tarefas: { some: { responsavelId: dani } } } } })
  ok("e o número é MENOR que o de etapas (a prova de que não conta step)",
    (daCarga?.tarefasAtivas ?? 0) < etapasDela, `${daCarga?.tarefasAtivas} tarefas para ${etapasDela} etapas`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("19) Atraso é CONDIÇÃO — convive com o estado operacional")
  // ═════════════════════════════════════════════════════════════════════════
  await prisma.tarefa.update({ where: { id: tarefaEmi }, data: { dataPrazo: new Date(Date.now() - 86400000) } })
  await bloquearTarefa({ tarefaId: tarefaEmi, autorId: dani, motivo: "aguardando procuração" })
  const linha = (await minhaFila(dani)).find((l) => l.taskId === tarefaEmi)
  ok("a tarefa está atrasada", linha?.atrasada === true)
  ok("E continua dizendo que está bloqueada", linha?.statusTarefa === "BLOQUEADA", linha?.statusTarefa)
  await desbloquearTarefa({ tarefaId: tarefaEmi, autorId: dani })

  // ═════════════════════════════════════════════════════════════════════════
  secao("60/68) Provenance — a tarefa responde 'por que eu existo?'")
  // ═════════════════════════════════════════════════════════════════════════
  const dossie = await dossieDaTarefa(tarefaGen)
  ok("o dossiê existe", !!dossie)
  ok("aponta o processo", dossie?.porQueExisto.processoId === c.processoId)
  ok("aponta a necessidade que o exigiu", dossie?.porQueExisto.necessidade?.id === gen.necessidadeId)
  ok("aponta o workflow", dossie?.porQueExisto.workflowInstanceId === gen.instanciaId)
  ok("tem a chave de identidade", !!dossie?.porQueExisto.chaveIdempotencia)
  ok("lista as etapas internas", (dossie?.etapas.length ?? 0) === gen.stepIds.length, `${dossie?.etapas.length}`)
  ok("e traz o histórico auditado", (dossie?.historico.length ?? 0) > 0, `${dossie?.historico.length} registro(s)`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("74) Perder a causa — o que acontece depende do trabalho já feito")
  // ═════════════════════════════════════════════════════════════════════════
  // (a) nunca iniciada → cancela.
  const c2 = await processo()
  const o2 = await obrigacao(c2, "genealogia", "NUNCA")
  await reconciliarTarefas({ processoId: c2.processoId })
  const tNunca = (await tarefas(c2.processoId))[0].id
  await prisma.phaseWorkflowInstance.update({ where: { id: o2.instanciaId }, data: { status: "CANCELADO" } })
  const r2 = await reconciliarTarefas({ processoId: c2.processoId })
  ok("nunca iniciada → cancelada pelo reconciliador", r2.tarefasEncerradasSemCausa === 1, JSON.stringify({ e: r2.tarefasEncerradasSemCausa, d: r2.tarefasAguardandoDecisao }))
  const tn = await prisma.tarefa.findUniqueOrThrow({ where: { id: tNunca }, select: { statusTarefa: true, motivoCodigo: true } })
  ok("com motivo CAUSA_REMOVIDA", tn.statusTarefa === "CANCELADA" && tn.motivoCodigo === "CAUSA_REMOVIDA")
  ok("mas NÃO apagada", (await prisma.tarefa.count({ where: { id: tNunca } })) === 1)

  // (b) já iniciada → requer decisão, ninguém cancela sozinho.
  const c3 = await processo()
  const o3 = await obrigacao(c3, "genealogia", "INICIADA")
  await reconciliarTarefas({ processoId: c3.processoId })
  const tIni = (await tarefas(c3.processoId))[0].id
  await atribuirTarefa({ tarefaId: tIni, responsavelId: dani, autorId: dani })
  await iniciarTarefa({ tarefaId: tIni, autorId: dani })
  await prisma.phaseWorkflowInstance.update({ where: { id: o3.instanciaId }, data: { status: "CANCELADO" } })
  const r3 = await reconciliarTarefas({ processoId: c3.processoId })
  ok("já iniciada → NÃO é cancelada automaticamente", r3.tarefasEncerradasSemCausa === 0, `${r3.tarefasEncerradasSemCausa}`)
  ok("e fica marcada aguardando decisão", r3.tarefasAguardandoDecisao === 1, `${r3.tarefasAguardandoDecisao}`)
  const ti = await prisma.tarefa.findUniqueOrThrow({ where: { id: tIni }, select: { statusTarefa: true, causaRemovidaEm: true } })
  ok("o trabalho é preservado (segue EM_ANDAMENTO)", ti.statusTarefa === "EM_ANDAMENTO", ti.statusTarefa)
  ok("com a marca de causa removida", ti.causaRemovidaEm != null)
  ok("e a projeção avisa que requer decisão",
    (await minhaFila(dani)).find((l) => l.taskId === tIni)?.requerDecisao === true)
  const r3b = await reconciliarTarefas({ processoId: c3.processoId })
  ok("reconciliar de novo não remarca nem cancela", r3b.tarefasAguardandoDecisao === 0 && r3b.tarefasEncerradasSemCausa === 0)

  // (c) concluída → permanece histórica.
  const c4 = await processo()
  const o4 = await obrigacao(c4, "genealogia", "CONCLUI")
  await reconciliarTarefas({ processoId: c4.processoId })
  const tCon = (await tarefas(c4.processoId))[0].id
  for (const id of o4.stepIds) await prisma.phaseWorkflowStepInstance.update({ where: { id }, data: { status: "CONCLUIDO" } })
  await reconciliarTarefas({ processoId: c4.processoId })
  await prisma.phaseWorkflowInstance.update({ where: { id: o4.instanciaId }, data: { status: "CANCELADO" } })
  await reconciliarTarefas({ processoId: c4.processoId })
  const tc = await prisma.tarefa.findUniqueOrThrow({ where: { id: tCon }, select: { statusTarefa: true, concluida: true } })
  ok("concluída permanece concluída mesmo perdendo a causa", tc.concluida === true, tc.statusTarefa)

  // ═════════════════════════════════════════════════════════════════════════
  secao("77) Reconciliar 10 vezes — convergência")
  // ═════════════════════════════════════════════════════════════════════════
  const antes10 = await prisma.tarefa.count({ where: { processoId: c.processoId } })
  const notif10 = await prisma.notificacaoOperacional.count()
  let criadasDepois = 0
  for (let i = 0; i < 10; i++) criadasDepois += (await reconciliarTarefas({ processoId: c.processoId })).tarefasCriadas
  ok("zero tarefas novas em 10 rodadas", criadasDepois === 0, `${criadasDepois}`)
  ok("a contagem não mudou", (await prisma.tarefa.count({ where: { processoId: c.processoId } })) === antes10)
  ok("zero notificações novas", (await prisma.notificacaoOperacional.count()) === notif10)

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("O processo se mexe; o trabalho sobrevive.\n")
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
