// scripts/minha-operacao-semantica.test.ts
// ============================================================================
// CORREÇÃO EXECUTIVA FINAL — Minha Operação: semântica operacional real.
//
// Prova, com dado real (réplica fiel do workflow real de produção):
//   1. a "próxima ação" de um passo executável usa o RÓTULO REAL do passo
//      publicado — nunca só "Responsável deve agir até X";
//   2. o motivo de risco chega humanizado (nunca o código técnico cru) e o
//      código continua disponível para diagnóstico;
//   3. filtros de Minha Operação (fase/terceiro/prazo/busca) são SERVER-SIDE
//      — aplicados no `where` do banco, antes da paginação;
//   4. EMI-021/EMI-022 (Saúde do Sistema) distinguem histórico legítimo de
//      estado atual inválido, e detectam risco real sem falso positivo.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { montarWorkflowReal } from "./_fixture-workflow-real"
import { unificarConferirValidar } from "./unificar-conferir-validar"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { executarAcaoCadastrada } from "@/src/services/executar-acao-cadastrada"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { minhaFila } from "@/lib/operacional/tarefa-projecoes"
import { humanizarMotivoRisco } from "@/lib/operacional/atencao-operacional"
import { catalogo } from "@/lib/saude/catalogo"
import "@/lib/saude/verificacoes/emissao-documental"

const MARCA = "MINHAOP-SEM"

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
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@minhaop-sem.test" } } })
}

let seq = 0
async function usuario(nome: string) {
  seq++
  return prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${seq}@minhaop-sem.test`, senha: "x", tipo: "assistente" }, select: { id: true, nome: true } })
}

async function palco(wfId: number, wfVersao: number, pessoaNome: string, arv: { id: number }, processo: { id: number }, faseKey = "emissao_documental_realwf") {
  seq++
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM_${seq}`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: pessoaNome, sobrenome: MARCA }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({ data: { processoId: processo.id, itemCatalogoId: item.id, pessoaId: pessoa.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${seq}` }, select: { id: true } })
  const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, necessidadeId: nec.id, status: "SOLICITAR", descricao: `${MARCA} doc`, tipo: "CERTIDAO_NASCIMENTO" }, select: { id: true } })
  const defSteps = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wfId }, orderBy: { ordem: "asc" }, select: { id: true, key: true, label: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: processo.id, faseMacroKey: faseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wfId, workflowVersion: wfVersao, chaveIdempotencia: `${MARCA}-inst-${seq}` },
    select: { id: true },
  })
  const stepIds: number[] = []
  for (let i = 0; i < defSteps.length; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: processo.id, faseMacroKey: faseKey, ciclo: 1,
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
  exigirBancoDeTeste("minha-operacao-semantica.test.ts — próxima ação, humanização, filtros server-side, EMI novos")
  await limpar()
  console.log("MINHA OPERAÇÃO — SEMÂNTICA OPERACIONAL REAL\n")

  const wfId = await montarWorkflowReal()
  await unificarConferirValidar(wfId)
  const pub = await publicarWorkflow({ workflowId: wfId, actorId: null })
  if (!pub.ok) throw new Error(`publicação falhou: ${JSON.stringify(pub)}`)
  const wfVersao = pub.versaoNova!

  const daniela = await usuario("Daniela")
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const processo = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) PRÓXIMA AÇÃO usa o rótulo REAL do passo — não só a data")
  // ══════════════════════════════════════════════════════════════════════
  const a = await palco(wfId, wfVersao, "Antonio", arv, processo)
  await atribuirTarefa({ tarefaId: a.tarefaId, responsavelId: daniela.id, autorId: null })
  await prisma.tarefa.update({ where: { id: a.tarefaId }, data: { dataPrazo: new Date(Date.now() + 5 * 86400_000) } })
  const filaComPrazo = await minhaFila(daniela.id)
  const linhaA = filaComPrazo.find((l) => l.taskId === a.tarefaId)
  ok("01) próxima ação existe", !!linhaA?.proximoAcontecimento?.descricao, linhaA?.proximoAcontecimento?.descricao)
  ok("02) NÃO é o texto genérico antigo ('Responsável deve agir até')", !linhaA?.proximoAcontecimento?.descricao?.startsWith("Responsável deve agir até"), linhaA?.proximoAcontecimento?.descricao)
  ok("03) é o rótulo real do passo publicado (o mesmo de etapaAtual)", linhaA?.proximoAcontecimento?.descricao === linhaA?.etapaAtual, `próxima ação="${linhaA?.proximoAcontecimento?.descricao}" · etapaAtual="${linhaA?.etapaAtual}"`)
  ok("04) a DATA continua disponível separadamente (não desapareceu, só não está embutida na frase)", !!linhaA?.proximoAcontecimento?.data)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) HUMANIZAÇÃO DE RISCO — nunca o código técnico cru")
  // ══════════════════════════════════════════════════════════════════════
  const h1 = humanizarMotivoRisco("CONFLITO_PRAZO_TAREFA_PASSO: Tarefa.dataPrazo=2026-09-21 × PhaseWorkflowStepInstance.prazo=2026-09-15 (6d de diferença)")
  ok("05) texto humanizado não contém o nome de tabela/campo cru", !h1.texto.includes("PhaseWorkflowStepInstance") && !h1.texto.includes("Tarefa.dataPrazo"), h1.texto)
  ok("06) texto humanizado é uma frase legível", h1.texto.length > 10 && /[a-z]/.test(h1.texto))
  ok("07) o código técnico continua disponível (nunca apagado)", h1.codigo === "CONFLITO_PRAZO_TAREFA_PASSO", h1.codigo)
  const h2 = humanizarMotivoRisco("SEM_RESPONSAVEL_PARA_PROXIMA_ACAO")
  ok("08) SEM_RESPONSAVEL_PARA_PROXIMA_ACAO humanizado", h2.texto === "Esta operação não possui responsável definido para agir.", h2.texto)
  const hDesconhecido = humanizarMotivoRisco("CODIGO_NUNCA_VISTO_ANTES")
  ok("09) código desconhecido cai num texto humano genérico, nunca no código cru", !hDesconhecido.texto.includes("CODIGO_NUNCA_VISTO"), hDesconhecido.texto)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) FILTROS SERVER-SIDE — aplicados no banco, antes da paginação")
  // ══════════════════════════════════════════════════════════════════════
  const b = await palco(wfId, wfVersao, "Bianca", arv, processo)
  await atribuirTarefa({ tarefaId: b.tarefaId, responsavelId: daniela.id, autorId: null })
  const semFiltro = await minhaFila(daniela.id, new Date(), undefined, {})
  ok("10) sem filtro, a fila tem as 2 Tarefas (Antonio + Bianca)", semFiltro.filter((l) => [a.tarefaId, b.tarefaId].includes(l.taskId)).length === 2)
  const comBuscaAntonio = await minhaFila(daniela.id, new Date(), undefined, { busca: "Antonio" })
  ok("11) busca server-side por pessoa encontra só a Tarefa correspondente", comBuscaAntonio.some((l) => l.taskId === a.tarefaId) && !comBuscaAntonio.some((l) => l.taskId === b.tarefaId), `ids=${comBuscaAntonio.map((l) => l.taskId).join(",")}`)
  const comBuscaBianca = await minhaFila(daniela.id, new Date(), undefined, { busca: "Bianca" })
  ok("12) busca server-side por outra pessoa encontra só a dela", comBuscaBianca.some((l) => l.taskId === b.tarefaId) && !comBuscaBianca.some((l) => l.taskId === a.tarefaId))
  const comFaseInexistente = await minhaFila(daniela.id, new Date(), undefined, { faseMacroKey: "fase_que_nao_existe_nunca" })
  ok("13) filtro de fase inexistente devolve vazio (prova que o filtro realmente restringe no banco)", comFaseInexistente.filter((l) => [a.tarefaId, b.tarefaId].includes(l.taskId)).length === 0)
  const comPrazo7Dias = await minhaFila(daniela.id, new Date(), undefined, { proximos7Dias: true })
  ok("14) filtro de prazo (7 dias) encontra a Tarefa com prazo em 5 dias", comPrazo7Dias.some((l) => l.taskId === a.tarefaId))

  // ══════════════════════════════════════════════════════════════════════
  secao("4) EMI-021/EMI-022 — histórico legítimo × estado atual inválido")
  // ══════════════════════════════════════════════════════════════════════
  const todasVerificacoes = catalogo()
  const emi21 = todasVerificacoes.find((v) => v.codigo === "EMI-021")
  const emi22 = todasVerificacoes.find((v) => v.codigo === "EMI-022")
  ok("15) EMI-021 está registrada no catálogo", !!emi21)
  ok("16) EMI-022 está registrada no catálogo", !!emi22)
  // EMI-021 filtra pela phaseKey REAL de produção ('emissao_documental') —
  // as Tarefas a/b acima usam o namespace de teste ('..._realwf', o mesmo
  // isolamento que `_fixture-workflow-real.ts` já usava), então não entram
  // no alcance dela. Para provar EMI-021 de verdade (sem falso positivo E
  // com detecção real), estas duas usam a phaseKey real deliberadamente —
  // seguro: só existe no banco de TESTE local (`exigirBancoDeTeste`).
  const d = await palco(wfId, wfVersao, "Diana", arv, processo, "emissao_documental")
  await atribuirTarefa({ tarefaId: d.tarefaId, responsavelId: daniela.id, autorId: null })
  if (emi21) {
    const r21 = await emi21.executar({ agora: new Date(), modo: "PROFUNDO" })
    const achadoDiana = r21.achados.find((ac) => String(ac.evidencia?.documentoId) === String(d.doc.id))
    ok("17) EMI-021 não falsa-positiva uma Tarefa aberta com os 4 passos corretos", !achadoDiana, JSON.stringify(achadoDiana))
  }
  // Um documento novo, com Tarefa aberta e cadeia CORROMPIDA manualmente
  // para 5 linhas, prova que EMI-021 detecta o caso real.
  const c = await palco(wfId, wfVersao, "Carla", arv, processo, "emissao_documental")
  await atribuirTarefa({ tarefaId: c.tarefaId, responsavelId: daniela.id, autorId: null })
  await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: c.inst.id, processoId: processo.id, faseMacroKey: "emissao_documental", ciclo: 1,
      stepKey: "step_fantasma_de_teste", ordem: 99, tipo: "HUMANO", obrigatorio: false, geraTarefa: false,
      status: "PENDENTE", necessidadeId: c.nec.id, documentoId: c.doc.id, pessoaId: c.pessoa.id, papel: "equipe_documental", slaDays: 1,
      chaveIdempotencia: `${MARCA}-step-fantasma-${c.doc.id}`,
    },
  })
  if (emi21) {
    const r21b = await emi21.executar({ agora: new Date(), modo: "PROFUNDO" })
    const achadoCarla = r21b.achados.find((ac) => String(ac.evidencia?.documentoId) === String(c.doc.id))
    ok("18) EMI-021 detecta a cadeia real corrompida (5 steps em vez de 4)", !!achadoCarla, JSON.stringify(achadoCarla))
  }
  if (emi22) {
    const r22 = await emi22.executar({ agora: new Date(), modo: "PROFUNDO" })
    ok("19) EMI-022 continua sem achado para as Tarefas com próxima ação determinável (Diana/Carla têm passo 1 disponível)", !r22.achados.some((ac) => [d.tarefaId, c.tarefaId].includes(Number((ac.evidencia as { tarefaId?: number })?.tarefaId))), JSON.stringify(r22.achados.map((a2) => a2.evidencia)))
  }

  await limpar()
  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch(async (e) => { console.error(e); await limpar().catch(() => {}); process.exit(1) })
