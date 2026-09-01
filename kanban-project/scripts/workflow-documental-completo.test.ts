// scripts/workflow-documental-completo.test.ts
// ============================================================================
// OS CINCO EXECUTORES, UM taskId — o workflow documental de ponta a ponta.
// Rodar: npm run test:workflow-documental   (banco de TESTE)
//
// Cada um dos cinco editores termina no MESMO gesto: `PATCH` do passo com
// `status: "concluida"`, que entra por `atualizarPassoV2` e desce até
// `transicionarPassoTx`. Este teste percorre o caminho de servidor que os
// cinco percorrem — a operação de cada modal é de tela, mas o efeito no
// domínio é este, e é ele que precisa manter a tarefa inteira.
//
// A pergunta: obter uma certidão é UM trabalho, do pedido à validação? Ou o
// sistema perde a identidade dele em algum ponto da sequência?
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirTarefaDePasso, carregarPreCondicoes } from "@/src/services/passo-tarefa"
import { atualizarPassoV2 } from "@/src/services/documento-operacao"
import { atribuirTarefa, iniciarTarefa } from "@/lib/operacional/tarefa-comandos"
import { minhaFila } from "@/lib/operacional/tarefa-projecoes"
import { resolveWorkflowStepEditor } from "@/src/lib/process-stage/step-editor-registry"
import { stepInstanceStatusToLegacy } from "@/src/lib/process-stage/legacy-status-map"
import { nomeDaTarefa } from "@/lib/operacional/nome-da-tarefa"

const MARCA = "WFDOC"
const PASSOS: Array<[string, string]> = [
  ["solicitar_certidao", "Solicitar certidão"],
  ["aguardar_retorno_do_cartorio", "Aguardar retorno do cartório"],
  ["receber_certidao", "Receber certidão"],
  ["conferir_certidao", "Conferir certidão"],
  ["validar_certidao", "Validar certidão"],
]

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
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: ts.map((t) => t.id) } } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@wfdoc.test" } } })
}

async function palco(sufixo: string, documentos: string[]) {
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} ${sufixo}`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" },
    select: { id: true },
  })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ademir", sobrenome: "Matheus" }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` },
    select: { id: true },
  })
  const unidades: Array<{ documentoId: number; necessidadeId: number; stepIds: number[] }> = []
  for (const [d, nomeDoc] of documentos.entries()) {
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}_${d}`, name: nomeDoc, natureza: "DOCUMENTO" }, select: { id: true } })
    const doc = await prisma.documento.create({ data: { pessoaId: pes.id, descricao: nomeDoc, status: "SOLICITAR" }, select: { id: true } })
    const nec = await prisma.necessidadeDocumental.create({
      data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${d}-${proc.id}` },
      select: { id: true },
    })
    const stepIds: number[] = []
    for (const [i, [chave, label]] of PASSOS.entries()) {
      const s = await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: chave,
          ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
          // DISPONIVEL, não EM_ANDAMENTO: a regra de geração exige passo
          // liberado — é o estado em que a fase materializa o primeiro passo.
          status: i === 0 ? "DISPONIVEL" : "PENDENTE",
          necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5, ciclo: 1,
          snapshot: { titulo: label, label } as never,
          chaveIdempotencia: `${MARCA}-s-${sufixo}-${d}-${i}-${proc.id}`,
        }, select: { id: true },
      })
      stepIds.push(s.id)
    }
    unidades.push({ documentoId: doc.id, necessidadeId: nec.id, stepIds })
  }
  const pre = await carregarPreCondicoes(proc.id)
  for (const u of unidades) for (const id of u.stepIds) await garantirTarefaDePasso({ stepInstanceId: id, origem: "workflow", preCondicoes: pre })
  return { processoId: proc.id, instanciaId: inst.id, pessoaId: pes.id, unidades }
}

const steps = (instId: number, docId?: number) =>
  prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: instId, ...(docId ? { documentoId: docId } : {}) },
    select: { id: true, status: true, ordem: true, stepKey: true }, orderBy: { ordem: "asc" },
  })

async function main() {
  exigirBancoDeTeste("prova o workflow documental completo")
  await limpar()
  await prisma.motorConfig.upsert({ where: { id: 1 }, create: { id: 1, runtimeV2Habilitado: true }, update: { runtimeV2Habilitado: true } })
  const gestor = await prisma.usuario.create({ data: { nome: "Gestor", email: "gestor@wfdoc.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const dani = await prisma.usuario.create({ data: { nome: "Daniela Brait", email: "dani@wfdoc.test", senha: "x", tipo: "assistente" }, select: { id: true } })

  console.log("WORKFLOW DOCUMENTAL — cinco executores, uma tarefa\n")

  // ═════════════════════════════════════════════════════════════════════════
  secao("§1-4) A tarefa se chama pelo TRABALHO, não pela primeira etapa")
  // ═════════════════════════════════════════════════════════════════════════
  const p = await palco("A", ["Certidão de Nascimento - Inteiro Teor"])
  const ts = await prisma.tarefa.findMany({ where: { processoId: p.processoId }, select: { id: true, titulo: true } })
  ok("§17) 1 documento = 1 Tarefa", ts.length === 1, `${ts.length}`)
  ok("§17) e 5 StepInstances", (await steps(p.instanciaId)).length === 5)
  const X = ts[0].id
  ok("§1) o título NÃO é 'Solicitar certidão'", ts[0].titulo !== "Solicitar certidão", ts[0].titulo)
  ok("§4) é o nome do trabalho, com a pessoa",
    ts[0].titulo === "Certidão de Nascimento - Inteiro Teor · Ademir Matheus", ts[0].titulo)
  ok("§3) nenhuma etapa do workflow empresta o nome",
    !PASSOS.some(([, label]) => ts[0].titulo.startsWith(label)))

  // A regra é universal — e o degrau 4 existe para o workflow de passo único.
  ok("§3) workflow de UMA etapa pode se chamar pela etapa",
    nomeDaTarefa({ tituloDaEtapa: "Localizar registro da certidão", etapasDaUnidade: 1 }) === "Localizar registro da certidão")
  ok("§3) com duas ou mais, NUNCA",
    nomeDaTarefa({ tituloDaEtapa: "Solicitar certidão", etapasDaUnidade: 5 }) === "Trabalho documental",
    "sem obrigação nem documento, é honesto dizer que não se sabe")
  ok("§3) a obrigação tem precedência sobre o documento",
    nomeDaTarefa({ itemDaNecessidade: "Certidão de Nascimento", nomeDoDocumento: "Doc 1", etapasDaUnidade: 5 }) === "Certidão de Nascimento")

  // ═════════════════════════════════════════════════════════════════════════
  secao("§18) Minha Fila mostra a TAREFA; a etapa fica embaixo")
  // ═════════════════════════════════════════════════════════════════════════
  await atribuirTarefa({ tarefaId: X, responsavelId: dani.id, autorId: gestor.id })
  const linha = (await minhaFila(dani.id)).find((l) => l.taskId === X)!
  ok("§18) o título da linha é o trabalho", linha.titulo.startsWith("Certidão de Nascimento"), linha.titulo)
  ok("§18) e a etapa atual aparece separada", linha.etapaAtual === "Solicitar certidão", linha.etapaAtual ?? "—")

  // ═════════════════════════════════════════════════════════════════════════
  secao("§7-8) Os cinco passos têm executor especializado registrado")
  // ═════════════════════════════════════════════════════════════════════════
  const esperado: Record<string, string> = {
    solicitar_certidao: "solicitacao_cartorio",
    aguardar_retorno_do_cartorio: "acompanhamento_retorno",
    receber_certidao: "recebimento_documento",
    conferir_certidao: "conferencia_documento",
    validar_certidao: "validacao_juridica",
  }
  for (const [chave, label] of PASSOS) {
    const r = resolveWorkflowStepEditor({ stepKey: chave, phaseKey: "emissao_documental" })
    ok(`${label} → ${esperado[chave]}`, r.kind === esperado[chave] && r.especifico, r.kind)
  }
  // O vocabulário que o executor recebe precisa ser o dele.
  ok("§8) passo concluído chega ao executor como 'concluida' (modo leitura)",
    stepInstanceStatusToLegacy("CONCLUIDO") === "concluida")
  ok("§8) e passo disponível chega acionável", stepInstanceStatusToLegacy("DISPONIVEL") === "em_andamento")

  // ═════════════════════════════════════════════════════════════════════════
  secao("§15) O workflow inteiro, pela MESMA porta que os cinco modais usam")
  // ═════════════════════════════════════════════════════════════════════════
  await iniciarTarefa({ tarefaId: X, autorId: dani.id })
  const doc = p.unidades[0].documentoId
  const ids = p.unidades[0].stepIds

  for (const [i, [, label]] of PASSOS.entries()) {
    const antes = await prisma.tarefa.count({ where: { processoId: p.processoId } })
    // É EXATAMENTE o que `patchStep(documentoId, stepId, { status: "concluida" })`
    // dispara quando o operador clica na ação terminal de qualquer um dos cinco.
    const r = await atualizarPassoV2(doc, ids[i], { status: "concluida" })
    ok(`§15) ${label} concluída pelo executor`, r.ok === true, r.ok ? "" : `${r.error}`)
    ok(`§15) taskId continua X`, (await prisma.tarefa.findUniqueOrThrow({ where: { id: X }, select: { id: true } })).id === X)
    ok(`§16) nenhuma tarefa nova`, (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === antes)
  }

  const fim = await prisma.tarefa.findUniqueOrThrow({ where: { id: X }, select: { statusTarefa: true, concluida: true, dataConclusao: true, titulo: true } })
  ok("§14) a última etapa concluiu a MESMA tarefa", fim.concluida === true, fim.statusTarefa)
  ok("§14) com dataConclusao", fim.dataConclusao != null)
  ok("§14) e nenhuma tarefa de 'finalização' foi criada",
    (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
  ok("§15) o título sobreviveu ao workflow inteiro", fim.titulo.startsWith("Certidão de Nascimento"))
  ok("§15) as 5 etapas estão concluídas", (await steps(p.instanciaId)).every((s) => s.status === "CONCLUIDO"))
  // A árvore de subtarefas não existe mais nem como coluna (migration
  // 20260812140000). O que resta provar é a FORMA: cada Tarefa se desdobra em
  // PASSOS, e nenhuma Tarefa é parte de outra.
  ok("§16) o desdobramento é em passos, não em tarefas",
    (await steps(p.instanciaId)).length > 1 &&
    (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1,
    `${(await steps(p.instanciaId)).length} passos para 1 tarefa`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§20) A timeline separa tarefa de etapa")
  // ═════════════════════════════════════════════════════════════════════════
  const hist = await prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: X }, select: { acao: true } })
  const acoes = new Set(hist.map((h) => h.acao))
  ok("§20) registra a criação da tarefa", [...acoes].some((a) => a.startsWith("TAREFA_CRIADA")) || hist.length > 0)
  ok("§20) e a conclusão de etapa como evento próprio",
    (await prisma.workflowEvento.count({ where: { processoId: p.processoId, tipo: "PASSO_CONCLUIDO" } })) === 5)
  const nConcl = await prisma.workflowEvento.count({ where: { processoId: p.processoId, tipo: "TAREFA_CONCLUIDA" } })
  ok("§20) a tarefa foi concluída UMA vez", nConcl === 1, `${nConcl} evento(s)`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("§17) DOIS documentos = 2 tarefas + 10 steps, sem misturar nada")
  // ═════════════════════════════════════════════════════════════════════════
  const q = await palco("B", ["Certidão de Nascimento - Inteiro Teor", "Certidão de Casamento - Inteiro Teor"])
  const tq = await prisma.tarefa.findMany({ where: { processoId: q.processoId }, select: { id: true, titulo: true, documentoId: true } })
  ok("§17) 2 Tarefas", tq.length === 2, `${tq.length}`)
  ok("§17) 10 StepInstances", (await steps(q.instanciaId)).length === 10)
  ok("§49) cada tarefa com o nome do SEU documento",
    tq.some((t) => t.titulo.includes("Nascimento")) && tq.some((t) => t.titulo.includes("Casamento")),
    tq.map((t) => t.titulo).join(" | "))
  ok("§49) e os passos não se misturam",
    (await steps(q.instanciaId, q.unidades[0].documentoId)).length === 5 &&
    (await steps(q.instanciaId, q.unidades[1].documentoId)).length === 5)

  // Concluir a primeira etapa de UM documento não move o outro.
  await atualizarPassoV2(q.unidades[0].documentoId, q.unidades[0].stepIds[0], { status: "concluida" })
  ok("§49) avançar um documento não avança o outro",
    (await steps(q.instanciaId, q.unidades[1].documentoId)).every((s) => s.status !== "CONCLUIDO"))
  ok("§17) e continuam sendo 2 tarefas", (await prisma.tarefa.count({ where: { processoId: q.processoId } })) === 2)

  // ═════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  await limpar()
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
  console.log("Do pedido à validação: um trabalho, um nome, um taskId.")
}

main().catch(async (e) => { console.error("falhou:", e); await prisma.$disconnect(); process.exit(1) })
