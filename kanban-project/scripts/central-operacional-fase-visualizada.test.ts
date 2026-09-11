// scripts/central-operacional-fase-visualizada.test.ts
// ============================================================================
// FASE VISUALIZADA ≠ FASE ATIVA — a Central não pode mostrar, dentro do painel
// de uma fase CONCLUÍDA, a tarefa VIVA de uma fase POSTERIOR.
//
// Achado real (relato da Daniela, ASSISTENTE, 11/09/2026), reproduzido contra o
// processo 589 (Santin): Genealogia estava CONCLUÍDA, Emissão Documental era a
// fase ATIVA. Clicar em Genealogia (consulta, somente leitura) mostrava dentro
// do painel uma linha "Em andamento"/"Iniciar" com o taskId de uma Tarefa que
// pertencia à Emissão — não à Genealogia.
//
// CAUSA RAIZ: `tarefasVivasDasUnidades` (lib/operacional/identidade-da-tarefa.ts)
// resolve "a tarefa viva desta OBRIGAÇÃO" (necessidade/documento) sem saber de
// fase — é a resposta certa para "existe tarefa duplicada?" (o caso do Ademir:
// scripts/fase-nao-duplica-tarefa.test.ts). Mas a MESMA obrigação atravessa
// várias fases: Genealogia LOCALIZA o registro, Emissão SOLICITA a certidão. Se
// a tarefa da fase anterior já está TERMINAL quando a fase seguinte materializa
// (fluxo normal — Genealogia acaba antes de Emissão começar), o materializador
// cria uma Tarefa NOVA para a fase nova (src/services/passo-tarefa.ts, branch
// `jaEncerrada` → `daUnidade = null` → `tx.tarefa.create`). Consultar a fase
// ANTIGA (agora concluída) reusava a MESMA busca por obrigação e encontrava essa
// tarefa nova — da fase seguinte — e a projetava como se fosse dali.
//
// CORREÇÃO: `getPhaseOperationalSummary` (src/lib/process-stage/
// estrutura-operacional.ts) agora só aceita a tarefa viva encontrada quando o
// `workflowInstanceId` dela bate com a INSTÂNCIA que esta leitura está
// escopando (`instanciaId`, devolvido por `getPhaseOperationalStructure`). Não
// mexe em `tarefasVivasDasUnidades` (que continua certa para quem pergunta
// "existe duplicata?") nem na reancoragem (que continua movendo a MESMA tarefa
// quando ela está ABERTA na hora da transição — ver seção 2 abaixo).
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" \
//   npx tsx scripts/central-operacional-fase-visualizada.test.ts
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { concluirPasso } from "../src/services/task-step-sync"
import { getPhaseOperationalStructure, getPhaseOperationalSummary } from "../src/lib/process-stage/estrutura-operacional"
import { garantirOferta } from "./_fixture-oferta"

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.error("\n❌ Este teste ESCREVE. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.\n")
  process.exit(1)
}

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const prisma = new PrismaClient()
const MARCA = "FASEVIS"
const FASES = ["genealogia", "emissao_documental"] as const

async function montarPalco() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Processo","Arvore","Pessoa","Uniao","Documento","NecessidadeDocumental","NecessidadeDocumentalEvento","PhaseWorkflowInstance","PhaseWorkflowStepInstance","PhaseInternalWorkflow","PhaseInternalWorkflowStep","WorkflowEvento","DomainOutbox","Tarefa","MacroWorkflow","FaseMacro","MatrizDocumental","TipoDocumentoCadastro","ItemCatalogo","LogAuditoria","PhaseAdvanceLog" RESTART IDENTITY CASCADE',
  )
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const oferta = await garantirOferta(prisma, { countryKey: "italia", countryLabel: "Itália", nationalityKey: "italiana", nationalityLabel: "Italiana", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const tipo = await prisma.tipoProcessoNacionalidade.upsert({
    where: { code: `${MARCA}_ITA` }, update: {},
    create: { code: `${MARCA}_ITA`, name: "Nacionalidade Italiana", paisId: oferta.paisId, modalidadeId: oferta.modalidadeId, processFamily: "CIDADANIA", serviceNature: "PROCESSO" },
  })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `${MARCA} macro`, versao: 1 } })
  for (const [i, phaseKey] of FASES.entries()) {
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey, label: phaseKey, ordem: i, versao: 1, required: true, conditional: false } })
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: null, versao: 1, execucao: "SEQUENCIAL", escopoExecucao: "DOCUMENTO", exigeDocumento: false, exigePessoa: true },
      select: { id: true },
    })
    // MESMA necessidade atravessa as duas fases, com um passo próprio em cada
    // uma — exatamente o padrão real (Genealogia "localizar_registro", Emissão
    // "solicitar_certidao"): a OBRIGAÇÃO é uma só, o TRABALHO de cada fase é outro.
    await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Trabalhar em ${phaseKey}`, ordem: 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 5, cardinalidade: "NECESSIDADE" },
    })
  }
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_NASC`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_NASC_TIPO`, name: "Certidão de Nascimento", itemCatalogoId: item.id, nature: "certidao" } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const admin = await prisma.usuario.upsert({
    where: { email: `admin@${MARCA.toLowerCase()}.test` }, update: {},
    create: { nome: "Admin Teste", email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" }, select: { id: true },
  })
  const pessoa = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Lucia", sobrenome: "Teste", linhaReta: true, requerente: "nao" }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, tipoProcessoMotorId: tipo.id, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "genealogia" },
    select: { id: true },
  })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pessoa.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec` },
    select: { id: true },
  })
  return { processoId: proc.id, adminId: admin.id, pessoaId: pessoa.id, necessidadeId: nec.id }
}

async function main() {
  console.log("FASE VISUALIZADA ≠ FASE ATIVA — a tarefa da fase seguinte não pode vazar para a anterior\n")

  const p = await montarPalco()

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) Genealogia materializa e CONCLUI — antes de Emissão sequer existir")
  // ══════════════════════════════════════════════════════════════════════════
  const relGen = await materializarExecucaoDaFase({ processoId: p.processoId, fonte: "PROCESSO_CRIADO" })
  check("1a) Genealogia materializou", relGen.passosTotais > 0, `${relGen.estado} · ${relGen.passosTotais} passo(s)`)

  const passoGenealogia = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({
    where: { processoId: p.processoId, faseMacroKey: "genealogia" }, select: { id: true },
  })
  const rConcluir = await concluirPasso(passoGenealogia.id, { origem: "USER", usuarioId: p.adminId, correlationId: "fasevis-1" })
  check("1b) o passo de Genealogia foi concluído", rConcluir.success === true, JSON.stringify(rConcluir))

  const tarefaGenealogia = await prisma.tarefa.findFirstOrThrow({
    where: { processoId: p.processoId, faseMacroKey: "genealogia" },
    select: { id: true, statusTarefa: true, workflowInstanceId: true },
  })
  check("1c) a tarefa de Genealogia ficou TERMINAL (concluída)", tarefaGenealogia.statusTarefa === "CONCLUIDO_RECEBIDO", tarefaGenealogia.statusTarefa)

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) Avança para Emissão — a MESMA obrigação, tarefa NOVA (Genealogia já estava terminal)")
  // ══════════════════════════════════════════════════════════════════════════
  const mov = await movePhaseManual(p.processoId, {
    faseAlvo: "emissao_documental", justificativa: "genealogia concluída", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: p.adminId,
  })
  check("2a) a movimentação foi aceita", mov.success, mov.success ? mov.resultado : `${mov.code}: ${mov.message}`)
  const relEmi = await materializarExecucaoDaFase({ processoId: p.processoId, fonte: "MOVIMENTACAO_MANUAL" })
  check("2b) Emissão materializou", relEmi.passosTotais > 0, `${relEmi.estado} · ${relEmi.passosTotais} passo(s)`)

  const tarefaEmissao = await prisma.tarefa.findFirstOrThrow({
    where: { processoId: p.processoId, faseMacroKey: "emissao_documental" },
    select: { id: true, statusTarefa: true, workflowInstanceId: true },
  })
  check("2c) nasceu uma tarefa NOVA para Emissão (não reaproveitou a de Genealogia)", tarefaEmissao.id !== tarefaGenealogia.id, `Genealogia=#${tarefaGenealogia.id} · Emissão=#${tarefaEmissao.id}`)
  check("2d) a tarefa de Emissão está VIVA (NAO_INICIADA)", tarefaEmissao.statusTarefa === "NAO_INICIADA", tarefaEmissao.statusTarefa)
  check("2e) e a tarefa de Genealogia continua terminal, intocada", (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaGenealogia.id }, select: { statusTarefa: true } })).statusTarefa === "CONCLUIDO_RECEBIDO")

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) O RELATO DA DANIELA — consultar Genealogia (concluída) NÃO pode mostrar a tarefa da Emissão")
  // ══════════════════════════════════════════════════════════════════════════
  const { estrutura: estGen, instanciaId: instGen } = await getPhaseOperationalStructure({ processoId: p.processoId, faseMacroKey: "genealogia" })
  check("3a) a instância escopada é a de Genealogia, não a de Emissão", instGen != null && instGen !== tarefaEmissao.workflowInstanceId)
  const alvoGen = [...estGen.linhaPrincipal, ...estGen.foraDaLinha, ...estGen.pendenteClassificacao]
    .flatMap((l) => l.documentos).find((d) => d.necessidadeId === p.necessidadeId)
  check("3b) o alvo de Genealogia existe na estrutura (não sumiu)", alvoGen != null)
  check("3c) o PASSO de Genealogia aparece concluído (a fonte que a fase realmente tem)", alvoGen?.concluido === true)

  const { indice: idxGen } = await getPhaseOperationalSummary({ processoId: p.processoId, faseMacroKey: "genealogia" })
  const linhaGen = [...idxGen.linhaPrincipal, ...idxGen.foraDaLinha, ...idxGen.pendenteClassificacao]
    .flatMap((p) => p.documentos).find((d) => d.necessidadeId === p.necessidadeId)!
  check("3d) taskId NUNCA é o da Emissão", linhaGen.naFase.taskId !== tarefaEmissao.id, `taskId=${linhaGen.naFase.taskId}`)
  check("3e) taskId é null (Genealogia não tem tarefa VIVA — a dela já terminou)", linhaGen.naFase.taskId === null, `taskId=${linhaGen.naFase.taskId}`)
  check("3f) estado = CONCLUIDA (o passo da própria fase, não 'A_FAZER'/'EM_ANDAMENTO' emprestado da Emissão)", linhaGen.naFase.estado === "CONCLUIDA", linhaGen.naFase.estado)
  check("3g) estadoLabel = 'Concluída', nunca 'Iniciar'/'Continuar' — o botão que a Daniela via", linhaGen.naFase.estadoLabel === "Concluída", linhaGen.naFase.estadoLabel)
  check("3h) responsável NÃO vaza da tarefa de Emissão", linhaGen.naFase.responsavelId === null)

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) Consultar Emissão (a fase ATIVA) continua mostrando a tarefa DELA, normalmente")
  // ══════════════════════════════════════════════════════════════════════════
  const { indice: idxEmi } = await getPhaseOperationalSummary({ processoId: p.processoId, faseMacroKey: "emissao_documental" })
  const linhaEmi = [...idxEmi.linhaPrincipal, ...idxEmi.foraDaLinha, ...idxEmi.pendenteClassificacao]
    .flatMap((p) => p.documentos).find((d) => d.necessidadeId === p.necessidadeId)!
  check("4a) taskId = o da Emissão (nada foi escondido demais)", linhaEmi.naFase.taskId === tarefaEmissao.id, `taskId=${linhaEmi.naFase.taskId}`)
  check("4b) estado = A_FAZER (tarefa nova, ninguém começou)", linhaEmi.naFase.estado === "A_FAZER", linhaEmi.naFase.estado)
  check("4c) estadoLabel = 'A fazer' (o botão 'Iniciar' É legítimo AQUI)", linhaEmi.naFase.estadoLabel === "A fazer", linhaEmi.naFase.estadoLabel)

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) UMA fase futura (nunca materializada) não mostra nada, e não quebra")
  // ══════════════════════════════════════════════════════════════════════════
  const { indice: idxFutura } = await getPhaseOperationalSummary({ processoId: p.processoId, faseMacroKey: "fase_que_nao_existe_ainda" })
  check("5a) resumo vazio, sem erro", idxFutura.resumo.documentos === 0)

  // A reancoragem (caso Ademir — tarefa ABERTA na hora da transição MOVE, não
  // duplica) é uma regra JÁ COBERTA por scripts/fase-nao-duplica-tarefa.test.ts
  // e não é alterada por esta correção (nenhum arquivo dela foi tocado). Ver o
  // relatório de entrega para a confirmação de que essa suíte continua 100%.

  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length) console.log("Falhas:", falhas.join(", "))
  await prisma.$disconnect()
  process.exit(falhas.length > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
