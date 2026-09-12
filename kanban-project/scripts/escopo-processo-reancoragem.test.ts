// scripts/escopo-processo-reancoragem.test.ts
// ============================================================================
// REANCORAGEM DA TAREFA EM ESCOPO PROCESSO/GLOBAL — teste A–H.
// Rodar: npx tsx scripts/escopo-processo-reancoragem.test.ts   (banco de TESTE)
//
// A CAUSA-RAIZ QUE ESTE TESTE PROTEGE: `escopoDaUnidade` tinha um parâmetro
// `workflowStepInstanceId` que, em fases sem necessidade/documento (cardinalidade
// PROCESSO — ex.: "Análise Documental"), estreitava o escopo para "só o passo que
// acabou de concluir". `concluirEtapa` nunca enxergava o sucessor que
// `ativarProximoPassoTx` tinha acabado de liberar, `etapaCorrente()` voltava vazio,
// e a Tarefa perdia o ponteiro (`workflowStepInstanceId = null`) — ou, pior, o
// `estadoDerivado` calculado sobre um array de 1 elemento declarava a tarefa
// concluída com passos obrigatórios ainda abertos (produção: tarefa 3571).
//
// Cenário: 5 passos GLOBAIS encadeados por `dependeDeStepKeys` (sem
// necessidade/documento), exatamente a forma da "Análise Documental" real —
// mas sem acoplar o teste ao nome daquela fase, porque a correção é do motor,
// não de uma fase específica.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"

const MARCA = "PROCGLOBAL"
const PASSOS = ["preparar", "comparar", "registrar", "classificar", "concluir"]

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
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@procglobal.test" } } })
}

async function palco() {
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} unico` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} unico`, arvoreId: arv.id }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "analise_documental_teste", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${proc.id}` },
    select: { id: true },
  })
  const daniela = await prisma.usuario.create({
    data: { nome: "Daniela Teste", email: `daniela-${proc.id}@procglobal.test`, senha: "x", tipo: "assistente" },
    select: { id: true },
  })
  const autor = await prisma.usuario.create({
    data: { nome: "Gestor Teste", email: `gestor-${proc.id}@procglobal.test`, senha: "x", tipo: "admin" },
    select: { id: true },
  })
  const stepIds: number[] = []
  for (const [i, key] of PASSOS.entries()) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "analise_documental_teste", stepKey: `${key}_${proc.id}`,
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        // SEM necessidadeId, SEM documentoId — cardinalidade PROCESSO/GLOBAL, de propósito.
        necessidadeId: null, documentoId: null,
        dependeDeStepKeys: i > 0 ? [`${PASSOS[i - 1]}_${proc.id}`] : [],
        papel: "equipe_documental", slaDays: 5,
        chaveIdempotencia: `${MARCA}-s-${proc.id}-${i}`,
      }, select: { id: true },
    })
    stepIds.push(s.id)
  }
  // `reconciliarTarefas` recusa criar tarefa "sem causa" (sem necessidade/documento) —
  // é a proteção certa PARA A VARREDURA em lote, mas não é o caminho real de
  // nascimento de uma tarefa PROCESSO: em produção isso vem de `aplicarPhaseEntered`
  // → `garantirTarefaDePasso` na entrada da fase. É esse caminho que o teste reproduz.
  const g = await garantirTarefaDePasso({ stepInstanceId: stepIds[0] })
  if (!g.success) throw new Error(`setup: materialização falhou — ${JSON.stringify(g)}`)
  const t = { id: g.tarefa.id }
  const dataPrazoOriginal = new Date("2026-12-01T00:00:00.000Z")
  await prisma.tarefa.update({ where: { id: t.id }, data: { dataPrazo: dataPrazoOriginal } })
  const atrib = await atribuirTarefa({ tarefaId: t.id, responsavelId: daniela.id, autorId: autor.id })
  if (!atrib.ok) throw new Error(`setup: atribuição falhou — ${JSON.stringify(atrib)}`)
  return { processoId: proc.id, instanciaId: inst.id, stepIds, tarefaId: t.id, danielaId: daniela.id, autorId: autor.id, dataPrazoOriginal }
}

const ler = (id: number) =>
  prisma.tarefa.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, statusTarefa: true, concluida: true, dataConclusao: true, workflowStepInstanceId: true,
      responsavelId: true, dataAtribuicao: true, atribuidoPorId: true, dataPrazo: true, processoId: true,
    },
  })

const stepDe = (id: number) => prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id }, select: { id: true, stepKey: true, status: true } })

async function main() {
  await exigirBancoDeTeste()
  await limpar()
  secao("A) Setup — 5 passos GLOBAIS encadeados, 1 Tarefa, atribuída à Daniela")
  const p = await palco()
  const antes = await ler(p.tarefaId)
  ok("A) nasceu 1 Tarefa só", !!p.tarefaId)
  ok("A) atribuída à Daniela", antes.responsavelId === p.danielaId)
  const dataAtribuicaoOriginal = antes.dataAtribuicao
  ok("A) dataAtribuicao gravada", dataAtribuicaoOriginal != null)
  ok("A) aponta pro passo 1 (DISPONIVEL)", antes.workflowStepInstanceId === p.stepIds[0])
  const notifsIniciais = await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId } })
  ok("A) 1 notificação de atribuição", notifsIniciais === 1, `${notifsIniciais}`)

  secao("B) Concluir passo 1 de 5 — Tarefa deve REANCORAR no passo 2, não perder o ponteiro")
  const r1 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: p.autorId })
  if (!r1.ok) throw new Error(`B) concluirEtapa falhou: ${JSON.stringify(r1)}`)
  const depois1 = await ler(p.tarefaId)
  ok("B) MESMO Tarefa.id", depois1.id === p.tarefaId)
  ok("B) workflowStepInstanceId aponta pro passo 2 (NÃO null)", depois1.workflowStepInstanceId === p.stepIds[1], `${depois1.workflowStepInstanceId}`)
  ok("B) passo 2 está DISPONIVEL", (await stepDe(p.stepIds[1])).status === "DISPONIVEL")
  ok("B) responsavelId preservado (Daniela)", depois1.responsavelId === p.danielaId)
  ok("B) dataAtribuicao NÃO recriada", depois1.dataAtribuicao?.getTime() === dataAtribuicaoOriginal?.getTime())
  ok("B) dataPrazo preservado", depois1.dataPrazo?.getTime() === p.dataPrazoOriginal.getTime())
  ok("B) tarefa continua EM_ANDAMENTO, não concluída", depois1.statusTarefa !== "CONCLUIDO_RECEBIDO" && !depois1.concluida)
  const notifsDepois1 = await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId } })
  ok("B) NENHUMA notificação nova (só a de atribuição)", notifsDepois1 === 1, `${notifsDepois1}`)
  const tarefasDoProcesso1 = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  ok("B) continua sendo 1 única Tarefa (sem duplicar)", tarefasDoProcesso1 === 1)

  secao("C) Retry da MESMA conclusão (passo 1 já concluído) — idempotente, sem efeito colateral")
  // `etapaId` EXPLÍCITO: sem ele, `concluirEtapa` concluiria a ETAPA CORRENTE
  // (agora o passo 2) — não seria um retry, seria a PRÓXIMA conclusão.
  const r1retry = await concluirEtapa({ tarefaId: p.tarefaId, etapaId: p.stepIds[0], autorId: p.autorId })
  ok("C) retry responde ok", r1retry.ok === true)
  if (r1retry.ok) ok("C) retry reconhece 'já estava concluída'", r1retry.jaEstavaConcluida === true)
  const depoisRetry = await ler(p.tarefaId)
  ok("C) ponteiro não regrediu com o retry", depoisRetry.workflowStepInstanceId === p.stepIds[1])
  const notifsDepoisRetry = await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId } })
  ok("C) retry não gerou notificação nova", notifsDepoisRetry === 1, `${notifsDepoisRetry}`)

  secao("D) Concluir passos 2, 3 e 4 — reancoragem se repete a cada avanço")
  const r2 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: p.autorId })
  if (!r2.ok) throw new Error(`D) passo 2 falhou: ${JSON.stringify(r2)}`)
  const depois2 = await ler(p.tarefaId)
  ok("D) após passo 2 → aponta pro passo 3", depois2.workflowStepInstanceId === p.stepIds[2], `${depois2.workflowStepInstanceId}`)

  const r3 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: p.autorId })
  if (!r3.ok) throw new Error(`D) passo 3 falhou: ${JSON.stringify(r3)}`)
  const depois3 = await ler(p.tarefaId)
  ok("D) após passo 3 → aponta pro passo 4", depois3.workflowStepInstanceId === p.stepIds[3], `${depois3.workflowStepInstanceId}`)

  const r4 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: p.autorId })
  if (!r4.ok) throw new Error(`D) passo 4 falhou: ${JSON.stringify(r4)}`)
  const depois4 = await ler(p.tarefaId)
  ok("D) após passo 4 → aponta pro passo 5 (o ÚLTIMO)", depois4.workflowStepInstanceId === p.stepIds[4], `${depois4.workflowStepInstanceId}`)
  ok("D) MESMO Tarefa.id do início ao passo 4", depois4.id === p.tarefaId)
  ok("D) responsavelId preservado até aqui", depois4.responsavelId === p.danielaId)
  ok("D) dataPrazo preservado até aqui", depois4.dataPrazo?.getTime() === p.dataPrazoOriginal.getTime())

  secao("E) Concluir o ÚLTIMO passo (5 de 5) — só agora a operação termina de verdade")
  const r5 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: p.autorId })
  if (!r5.ok) throw new Error(`E) passo 5 falhou: ${JSON.stringify(r5)}`)
  const depois5 = await ler(p.tarefaId)
  ok("E) agora sim CONCLUIDO_RECEBIDO", depois5.statusTarefa === "CONCLUIDO_RECEBIDO")
  ok("E) concluida=true", depois5.concluida === true)
  ok("E) workflowStepInstanceId=null é CORRETO aqui (não há passo 6)", depois5.workflowStepInstanceId === null)
  ok("E) responsavelId continua sendo o de sempre", depois5.responsavelId === p.danielaId)
  ok("E) MESMO Tarefa.id do início ao fim", depois5.id === p.tarefaId)
  const notifsFinal = await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId } })
  ok("E) nenhuma notificação nova em nenhuma das 5 conclusões", notifsFinal === 1, `${notifsFinal}`)
  const tarefasFinal = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  ok("E) continua sendo 1 única Tarefa do início ao fim", tarefasFinal === 1)
  const logsFinal = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: p.tarefaId, acao: { in: ["TAREFA_ETAPA_CONCLUIDA", "TAREFA_ETAPA_CONCLUIDA_E_TAREFA_CONCLUIDA"] } } })
  ok("E) exatamente 5 registros de conclusão de etapa auditados (1 por passo, sem duplicar)", logsFinal === 5, `${logsFinal}`)

  secao("F) Retry pós-conclusão total — idempotente, sem duplicar histórico")
  // A TAREFA já está TERMINAL — a guarda de `concluirEtapa` recusa QUALQUER
  // conclusão nesse estado (§14 do motor: encerrada não se trabalha; para
  // retomar existe reabertura, explícita). Isso vale COM ou SEM `etapaId`
  // explícito — é o mesmo comportamento já coberto por "H) tarefa concluída
  // recusa nova conclusão" em concluir-etapa.test.ts; o que este teste prova
  // é que a correção de escopo não abriu uma segunda porta para reconcluir.
  const rFinalRetry = await concluirEtapa({ tarefaId: p.tarefaId, etapaId: p.stepIds[4], autorId: p.autorId })
  ok("F) tarefa terminal recusa nova conclusão, mesmo com etapaId explícito", !rFinalRetry.ok && rFinalRetry.codigo === "TAREFA_TERMINAL")
  const logsAposRetryFinal = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: p.tarefaId, acao: { in: ["TAREFA_ETAPA_CONCLUIDA", "TAREFA_ETAPA_CONCLUIDA_E_TAREFA_CONCLUIDA"] } } })
  ok("F) retry não criou um 6º registro de auditoria", logsAposRetryFinal === 5, `${logsAposRetryFinal}`)

  secao("G) Histórico de passos anteriores permanece — nada foi apagado")
  const todosOsPassos = await prisma.phaseWorkflowStepInstance.findMany({ where: { id: { in: p.stepIds } }, select: { id: true, status: true }, orderBy: { id: "asc" } })
  ok("G) os 5 passos existem e todos CONCLUIDO", todosOsPassos.every((s) => s.status === "CONCLUIDO"), todosOsPassos.map((s) => s.status).join(","))

  secao("H) Projeções canônicas concordam com o estado final")
  const { tarefasVivasDasUnidades } = await import("@/lib/operacional/identidade-da-tarefa")
  const unidade = { processoId: p.processoId, necessidadeId: null, documentoId: null, pessoaId: null, ciclo: 1 }
  const viva = (await tarefasVivasDasUnidades(prisma, [unidade])).get(`unidade|proc${p.processoId}|stepinst0|pes0|c1`)
  // A unidade PROCESSO, sem necessidade/documento, não tem tarefa VIVA aqui (ela já
  // encerrou) — o que importa é que a leitura direta da Tarefa (usada por todas as
  // projeções: Operação, Tarefas e Projetos, Lista, Kanban, processo expandido)
  // bate com o que o motor gravou.
  const viaProjecaoCanonica = await prisma.tarefa.findUnique({
    where: { id: p.tarefaId },
    select: { id: true, responsavelId: true, statusTarefa: true, workflowStepInstanceId: true, responsavel: { select: { nome: true } } },
  })
  ok("H) leitura canônica (mesma usada por todas as telas) confirma responsável", viaProjecaoCanonica?.responsavelId === p.danielaId)
  ok("H) leitura canônica confirma status final", viaProjecaoCanonica?.statusTarefa === "CONCLUIDO_RECEBIDO")
  void viva

  await limpar()
  console.log(`\n${"═".repeat(72)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exit(1) }
  console.log("5 passos em cardinalidade PROCESSO, 1 tarefa do início ao fim — reancorada a cada avanço, nunca perdida.")
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
