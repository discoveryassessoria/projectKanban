// scripts/retrocesso-de-fase.test.ts
//
// RETROCEDER NÃO É CANCELAR, E REABRIR NÃO É APAGAR.
//
// O defeito que este arquivo persegue não estava no motor: `movePhaseManual` sempre
// reposicionou a fase sem tocar em obrigação nenhuma. Estava no que vinha depois — o
// administrador retrocedia para refazer o trabalho e encontrava, para uma operação
// concluída, apenas "Pausar", "Cancelar" e "Invalidar". O único botão que mudava algo
// era Cancelar, e cancelar diz o contrário de refazer.
//
// Aqui se prova o comando novo: planejar (o que existe na fase de destino, o que pode
// ser reexecutado, o que cada reabertura alcança) e executar (mover, e reabrir só o
// que foi marcado — criando execução nova, nunca desconcluindo a anterior).
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/retrocesso-de-fase.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { planejarRetrocesso, executarRetrocesso } from "../src/services/retrocesso-de-fase"
import { tentativasDoPasso, garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { congelarVersaoVigente } from "../src/services/versao-publicada"
import { gravarOperacao, historicoDaOperacao } from "../src/services/operacao-da-etapa"

const ROOT = join(__dirname, "..")
const ler = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

const prisma = new PrismaClient()
const M = "RETRO"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

// ════════════════════════════════════════════════════════════════
console.log("\n(A) OS COMANDOS SÃO DISTINTOS")
// ════════════════════════════════════════════════════════════════

const servico = semComentarios(ler("src/services/retrocesso-de-fase.ts"))
check("existe um serviço próprio de retrocesso", servico.includes("export async function executarRetrocesso"))
check("RETROCEDER NÃO CHAMA CANCELAR",
  !/cancelarOperacao|cancelarPasso|cancelarTarefa|status:\s*"CANCELADO"/.test(servico))
check("nem invalidar", !/invalidarOperacao|INVALIDATE_DOCUMENT/.test(servico))
check("nem conclui nada por conta própria", !/concluirPasso|concluirTarefa/.test(servico))
check("move a fase pela porta canônica", servico.includes("movePhaseManual("))
check("e reabre pela porta canônica", servico.includes("reabrirPassoTx("))
check("sem seleção, não reabre nada",
  servico.includes("if (p.reabrir.length === 0)") && /reabertas: \[\]/.test(servico))

const rota = semComentarios(ler("src/app/api/processos/[processoId]/phase/rollback/route.ts"))
check("a rota de retrocesso é separada da de avanço", rota.includes("planejarRetrocesso") && rota.includes("executarRetrocesso"))
check("e exige a permissão exclusiva", rota.includes('verificarPermissao(request, "processos.moverFaseManual")'))

// ════════════════════════════════════════════════════════════════
console.log("\n(A2) A INTERFACE NÃO EMPURRA PARA CANCELAR")
// ════════════════════════════════════════════════════════════════

const modal = semComentarios(ler("src/components/kanban/MovimentarFaseModal.tsx"))
check("o modal pergunta o plano do retrocesso ao servidor", modal.includes("/phase/rollback?faseDestino="))
check("  e envia o retrocesso pela rota própria, não pela de avanço",
  modal.includes("`/api/processos/${processoId}/phase/rollback`"))
check("  oferece reabrir a cadeia dependente", modal.includes("Reabrir a cadeia dependente"))
check("  e deixa claro que dá para SÓ retroceder", modal.includes("Somente retroceder"))
check("  o botão diz o que vai fazer", modal.includes('"Retroceder e reabrir"'))
check("  a correlação é estável por abertura do modal — duplo clique não vira duas execuções",
  modal.includes("correlationId: correlacao.current"))

const drawer = semComentarios(ler("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx"))
check("a Central abre o modal de reabertura em vez de um confirm()", drawer.includes("<ReabrirEtapaModal"))
check("  e não descreve o impacto à mão", !/Bloquear a próxima etapa ativa/.test(drawer))

const reabrir = semComentarios(ler("src/components/kanban/workflow/ReabrirEtapaModal.tsx"))
check("o modal de reabertura pede o impacto ao servidor", reabrir.includes("/reexecutar"))
check("  mostra reexecutada, reavaliadas, herdadas e intactas",
  reabrir.includes("seraReexecutado") && reabrir.includes("seraoReavaliados") &&
  reabrir.includes("herdados") && reabrir.includes("intactos"))
check("  exige justificativa", reabrir.includes("justificativa.trim().length < 5"))
check("  e diz que a execução anterior é ARQUIVADA, não apagada",
  reabrir.includes("arquivada com o que foi registrado nela"))

const cfg = semComentarios(ler("src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx"))
check("a política de reabertura é cadastrável na interface", cfg.includes('"reabertura"'))
check("  com permitir, estratégia, justificativa e permissão",
  cfg.includes("reaberturaPermitida") && cfg.includes("reaberturaEstrategia") &&
  cfg.includes("reaberturaExigeJustificativa") && cfg.includes("reaberturaPermissao"))

// ════════════════════════════════════════════════════════════════
const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("\n(B) Comportamento — PULADO (sem banco de teste local)")
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  process.exit(0)
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) {
    await prisma.documentoObservacao.deleteMany({ where: { documento: { pessoa: { arvoreId: p.arvoreId } } } })
    await prisma.documentoArquivo.deleteMany({ where: { documento: { pessoa: { arvoreId: p.arvoreId } } } }).catch(() => null)
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: p.arvoreId } } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  }
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: `${M}::` } }, select: { id: true } })
  for (const wf of wfs) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.macroWorkflow.deleteMany({ where: { name: { startsWith: M } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { name: { startsWith: M } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: "retro_" } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: M } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${M.toLowerCase()}-` } } })
}

interface Palco {
  processoId: number
  instEmissao: number
  si: Record<string, number>
  docId: number
  necId: number
  actorId: number
  faseEmissao: string
  faseAnalise: string
}

/**
 * O PALCO REPRODUZ O CASO QUE QUEBROU: duas fases, a Emissão com um roteiro em que
 * quatro etapas encadeiam e uma quinta NÃO depende de nenhuma delas — é ela que prova
 * que ordem visual não é dependência.
 */
async function montar(marca: string): Promise<Palco> {
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: `${M}_${marca}`.toUpperCase().slice(0, 40), name: `${M} ${marca}`, ativo: true,
      countryKey: "retro", countryLabel: "Retro", nationalityKey: "retro", nationalityLabel: "Retro",
      modalityKey: "retro", modalityLabel: "Retro",
    },
    select: { id: true },
  })
  const fEmissao = await prisma.catalogoFase.upsert({
    where: { phaseKey: "retro_emissao" }, update: {},
    create: { phaseKey: "retro_emissao", label: "Emissão (retro)", escopo: "DOCUMENTO", ordemPadrao: 10 },
    select: { phaseKey: true },
  })
  const fAnalise = await prisma.catalogoFase.upsert({
    where: { phaseKey: "retro_analise" }, update: {},
    create: { phaseKey: "retro_analise", label: "Análise (retro)", escopo: "DOCUMENTO", ordemPadrao: 20 },
    select: { phaseKey: true },
  })
  const macro = await prisma.macroWorkflow.create({
    data: {
      tipoProcessoId: tipo.id, name: `${M} macro ${marca}`, versao: 1,
      fases: {
        create: [
          { phaseKey: fEmissao.phaseKey, label: "Emissão (retro)", ordem: 1, required: true },
          { phaseKey: fAnalise.phaseKey, label: "Análise (retro)", ordem: 2, required: true },
        ],
      },
    },
    select: { id: true },
  })
  void macro

  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::${marca}::emissao`, phaseKey: fEmissao.phaseKey, name: `${M} emissão`, versao: 1, execucao: "SEQUENCIAL",
      passos: {
        create: [
          { key: "solicitar", label: "Solicitar certidão", ordem: 1, cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 3, executorKey: "padrao", dependeDe: [] },
          { key: "aguardar", label: "Aguardar retorno", ordem: 2, cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 10, executorKey: "padrao", dependeDe: ["solicitar"] },
          { key: "receber", label: "Receber certidão", ordem: 3, cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 2, executorKey: "padrao", dependeDe: ["aguardar"] },
          { key: "conferir", label: "Conferir certidão", ordem: 4, cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 2, executorKey: "padrao", dependeDe: ["receber"] },
          // INDEPENDENTE, e de propósito ÚLTIMA na ordem: se a reabertura a alcançar,
          // é porque está usando ordem em vez de dependência.
          { key: "arquivar", label: "Arquivar cópia", ordem: 5, cardinalidade: "DOCUMENTO", createsTask: true, required: false, slaDays: 5, executorKey: "padrao", dependeDe: [] },
        ],
      },
    },
    select: { id: true, passos: { select: { id: true, key: true } } },
  })
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const actor = await prisma.usuario.create({
    data: { nome: `${M} Admin ${marca}`, email: `${M.toLowerCase()}-${marca}@teste.local`, senha: "x", tipo: "admin" },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${M} ${marca}` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Titular", sobrenome: marca, arvoreId: arv.id }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: {
      nome: `${M} ${marca}`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2",
      faseAtualKey: fAnalise.phaseKey, tipoProcessoMotorId: tipo.id,
    },
    select: { id: true },
  })
  const item = await prisma.itemCatalogo.create({ data: { code: `${M}_${marca}`, name: "Certidão", natureza: "SERVICO" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, pessoaId: pessoa.id, status: "ATENDIDA", itemCatalogoId: item.id, chaveIdempotencia: `${M}-${marca}-nec` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({
    data: { pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO", status: "RECEBIDO", necessidadeId: nec.id, cartorio: "2º Ofício", livro: "B-3", folha: "88" },
    select: { id: true },
  })

  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: fEmissao.phaseKey, ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-${marca}-ie`,
    },
    select: { id: true },
  })
  const DEPS: Record<string, string[]> = { solicitar: [], aguardar: ["solicitar"], receber: ["aguardar"], conferir: ["receber"], arquivar: [] }
  const si: Record<string, number> = {}
  const concluidoEm = new Date("2026-08-12T14:00:00Z")
  for (const [i, k] of ["solicitar", "aguardar", "receber", "conferir", "arquivar"].entries()) {
    const r = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: fEmissao.phaseKey, ciclo: 1,
        stepKey: k, ordem: i + 1, tipo: "HUMANO", obrigatorio: k !== "arquivar", geraTarefa: true,
        status: "CONCLUIDO", completedAt: concluidoEm, dependeDeStepKeys: DEPS[k] as never,
        documentoId: doc.id, necessidadeId: nec.id,
        stepDefinitionId: wf.passos.find((p) => p.key === k)!.id, stepDefinitionVersion: 1,
        chaveIdempotencia: `${M}-${marca}-${k}`,
      },
      select: { id: true },
    })
    await garantirTentativa(r.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "CONCLUIDO", completedAt: concluidoEm })
    si[k] = r.id
  }
  await gravarOperacao(si.solicitar, { canal: "CRC", protocolo: "CRC-2026-77", notes: "Pedido enviado na primeira via." })
  await prisma.documentoObservacao.create({
    data: { documentoId: doc.id, stepInstanceId: si.solicitar, texto: `${M} observação da primeira execução`, chaveIdempotencia: `${M}-${marca}-obs` },
  })
  await prisma.tarefa.create({
    data: {
      titulo: `${M} ${marca} certidão`, processoId: proc.id, workflowInstanceId: inst.id,
      workflowStepInstanceId: si.conferir, documentoId: doc.id, necessidadeId: nec.id,
      statusTarefa: "CONCLUIDO_RECEBIDO", concluida: true, dataConclusao: concluidoEm,
      chaveIdempotencia: `${M}-${marca}-tarefa`,
    },
  })
  // A fase de Análise também foi visitada — é o histórico que não pode sumir.
  await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: fAnalise.phaseKey, ciclo: 1, status: "ATIVO",
      chaveIdempotencia: `${M}-${marca}-ia`,
    },
  })
  return {
    processoId: proc.id, instEmissao: inst.id, si, docId: doc.id, necId: nec.id,
    actorId: actor.id, faseEmissao: fEmissao.phaseKey, faseAnalise: fAnalise.phaseKey,
  }
}

/**
 * A OBRIGAÇÃO VIGENTE DE UMA CHAVE — a linha da visita que vale agora.
 *
 * Depois de um retrocesso que abre visita nova, o id que a tela mostrou antes é
 * histórico. Seguir o id fixo mediria a visita errada, e foi o que fez as primeiras
 * versões destas provas reprovarem código correto.
 */
async function passoVigente(processoId: number, faseMacroKey: string, stepKey: string): Promise<number> {
  const inst = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey, status: "ATIVO" }, orderBy: { ciclo: "desc" }, select: { id: true },
  })
  const p = await prisma.phaseWorkflowStepInstance.findFirst({
    where: { workflowInstanceId: inst!.id, stepKey }, select: { id: true },
  })
  return p!.id
}

const estados = async (si: Record<string, number>) => {
  const rows = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: Object.values(si) } }, select: { id: true, stepKey: true, status: true, completedAt: true },
  })
  return Object.fromEntries(rows.map((r) => [r.stepKey, r.status]))
}

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════
  secao("(B) O PLANO — o impacto antes da escrita")
  // ══════════════════════════════════════════════════════════════
  const p1 = await montar("plano")
  const plano = await planejarRetrocesso(p1.processoId, p1.faseEmissao)
  check("o plano existe", plano != null)
  check("  reconhece que é um RETROCESSO", plano?.ehRetrocesso === true)
  check("  lista as 5 obrigações da fase de destino", plano?.obrigacoes.length === 5, String(plano?.obrigacoes.length))
  check("  todas concluídas, e por isso reexecutáveis", plano!.obrigacoes.every((o) => o.podeReabrir))
  check("  diz de que cada uma depende, pelo cadastro",
    plano!.obrigacoes.find((o) => o.stepKey === "aguardar")?.dependeDe.join() === "solicitar")
  const solicitar = plano!.obrigacoes.find((o) => o.stepKey === "solicitar")!
  check("  e o que reabrir SOLICITAR alcançaria: aguardar, receber, conferir",
    JSON.stringify(solicitar.alcancaSeReaberta.map((a) => a.stepKey)) === '["aguardar","receber","conferir"]',
    JSON.stringify(solicitar.alcancaSeReaberta.map((a) => a.stepKey)))
  check("  ARQUIVAR não é alcançada — ela não depende de solicitar, só vem depois",
    !solicitar.alcancaSeReaberta.some((a) => a.stepKey === "arquivar"))
  check("  a fase posterior visitada aparece como histórico que permanece",
    (plano?.fasesPosterioresVisitadas.length ?? 0) >= 1)
  check("  cada obrigação informa quantas execuções já teve", plano!.obrigacoes.every((o) => o.execucoes === 1))

  // ══════════════════════════════════════════════════════════════
  secao("(C) A. Retroceder SEM reabrir — só reposiciona")
  // ══════════════════════════════════════════════════════════════
  const p2 = await montar("semreabrir")
  const antes2 = await estados(p2.si)
  const r2 = await executarRetrocesso({
    processoId: p2.processoId, faseDestino: p2.faseEmissao, motivoCodigo: "CORRECAO_CADASTRO",
    justificativa: "Reposicionar a fase, sem refazer trabalho.", reabrir: [], actorId: p2.actorId,
  })
  check("o retrocesso acontece", r2.ok, JSON.stringify(r2))
  check("  a fase do processo passou a ser a de destino",
    (await prisma.processo.findUnique({ where: { id: p2.processoId }, select: { faseAtualKey: true } }))?.faseAtualKey === p2.faseEmissao)
  check("  NENHUMA obrigação foi reaberta", r2.reabertas.length === 0)
  check("  e nenhuma mudou de estado", JSON.stringify(await estados(p2.si)) === JSON.stringify(antes2))
  const tarefa2 = await prisma.tarefa.findFirst({ where: { processoId: p2.processoId }, select: { statusTarefa: true } })
  check("  a tarefa concluída continua concluída", tarefa2?.statusTarefa === "CONCLUIDO_RECEBIDO")

  // ══════════════════════════════════════════════════════════════
  secao("(D) B+C+D. Reabrir UMA, com dependentes — e o independente intacto")
  // ══════════════════════════════════════════════════════════════
  const p3 = await montar("cascata")
  const arquivarAntes = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: p3.si.arquivar }, select: { status: true, completedAt: true },
  })
  const r3 = await executarRetrocesso({
    processoId: p3.processoId, faseDestino: p3.faseEmissao, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Certidão veio com o nome da mãe errado; refazer o pedido.",
    reabrir: [{ stepInstanceId: p3.si.solicitar, comDependentes: true }], actorId: p3.actorId,
  })
  check("o retrocesso com reabertura acontece", r3.ok, JSON.stringify(r3).slice(0, 200))
  check("  UMA obrigação foi reaberta", r3.reabertas.length === 1 && r3.reabertas[0].stepKey === "solicitar")

  // A REABERTURA ACONTECE NA VISITA VIGENTE. Voltar para a fase abre uma visita nova,
  // que herda o progresso; é nela que o retrabalho acontece. As linhas da visita
  // anterior continuam onde estavam — e a checagem abaixo cobra as duas coisas.
  const vigente3 = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: p3.processoId, faseMacroKey: p3.faseEmissao, status: "ATIVO" },
    orderBy: { ciclo: "desc" }, select: { id: true, ciclo: true },
  })
  const passos3 = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: vigente3!.id },
    select: { id: true, stepKey: true, status: true, completedAt: true },
  })
  const st3 = Object.fromEntries(passos3.map((x) => [x.stepKey, x.status]))
  const idDe = (k: string) => passos3.find((x) => x.stepKey === k)!.id

  check("  SOLICITAR está em execução de novo", st3.solicitar === "EM_ANDAMENTO", String(st3.solicitar))
  check("  AGUARDAR voltou a esperar", st3.aguardar === "BLOQUEADO", String(st3.aguardar))
  check("  RECEBER voltou a esperar", st3.receber === "BLOQUEADO", String(st3.receber))
  check("  CONFERIR voltou a esperar", st3.conferir === "BLOQUEADO", String(st3.conferir))
  check("  ARQUIVAR — independente — CONTINUA CONCLUÍDA",
    st3.arquivar === "CONCLUIDO" && passos3.find((x) => x.stepKey === "arquivar")?.completedAt != null,
    String(st3.arquivar))

  // A VISITA ANTERIOR NÃO FOI TOCADA — é o histórico do que já tinha acontecido.
  const antigos3 = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: Object.values(p3.si) } }, select: { stepKey: true, status: true, completedAt: true },
  })
  check("  a visita anterior continua inteira, com as datas dela",
    antigos3.every((a) => a.status === "CONCLUIDO" && a.completedAt?.toISOString() === "2026-08-12T14:00:00.000Z"),
    JSON.stringify(antigos3.map((a) => [a.stepKey, a.status])))

  // ── E. A execução anterior permanece ──
  const tSolicitar = await tentativasDoPasso(idDe("solicitar"))
  check("SOLICITAR tem DUAS execuções", tSolicitar.length === 2, String(tSolicitar.length))
  check("  a #1 continua CONCLUÍDA, com o fim dela",
    tSolicitar[0].status === "CONCLUIDO" && tSolicitar[0].completedAt?.toISOString() === "2026-08-12T14:00:00.000Z")
  check("  arquivada, apontando para a sucessora",
    tSolicitar[0].supersededAt != null && tSolicitar[0].supersededPorId === tSolicitar[1].id)
  check("  a #2 é a vigente, e é outra linha",
    tSolicitar[1].supersededAt == null && tSolicitar[1].id !== tSolicitar[0].id)
  const tConferir = await tentativasDoPasso(idDe("conferir"))
  check("CONFERIR, alcançada pela cadeia, também arquivou a execução dela",
    tConferir.length === 2 && tConferir[0].completedAt != null)

  // ── F+G. Anexos, observações e o que foi preenchido ──
  // A OPERAÇÃO DA VISITA ANTERIOR continua legível na obrigação anterior; a visita
  // nova começa com a própria folha.
  const histAntigo3 = await historicoDaOperacao(p3.si.solicitar)
  const hist3 = await historicoDaOperacao(idDe("solicitar"))
  check("o que foi preenchido na execução anterior continua legível",
    (histAntigo3[0]?.payload as { protocolo?: string })?.protocolo === "CRC-2026-77",
    JSON.stringify(histAntigo3.map((h) => h.payload)))
  check("  e a execução NOVA começa vazia — não herda como se tivesse produzido",
    hist3.every((h) => Object.keys(h.payload).length === 0), JSON.stringify(hist3.map((h) => h.payload)))
  check("as observações do documento permanecem",
    (await prisma.documentoObservacao.count({ where: { documentoId: p3.docId } })) >= 1)
  const doc3 = await prisma.documento.findUnique({ where: { id: p3.docId }, select: { livro: true, folha: true, cartorio: true, status: true } })
  check("os dados registrais do documento não foram tocados",
    doc3?.livro === "B-3" && doc3.folha === "88" && doc3.cartorio === "2º Ofício")

  // ── L. Progresso: a fase deixa de estar 100% ──
  const obrig3 = await prisma.phaseWorkflowStepInstance.count({
    where: { workflowInstanceId: vigente3!.id, obrigatorio: true },
  })
  const concl3 = await prisma.phaseWorkflowStepInstance.count({
    where: { workflowInstanceId: vigente3!.id, obrigatorio: true, status: "CONCLUIDO" },
  })
  check("o progresso corrente deixou de ser 100%", concl3 < obrig3, `${concl3}/${obrig3}`)

  // ── M. As fases posteriores permanecem ──
  check("a instância da fase posterior continua existindo",
    (await prisma.phaseWorkflowInstance.count({ where: { processoId: p3.processoId, faseMacroKey: p3.faseAnalise } })) === 1)

  // ── N. O dependente não anda antes do predecessor ──
  const { transicionarPassoTx } = await import("../src/services/task-step-sync")
  const tentaAndar = await prisma.$transaction((tx) =>
    transicionarPassoTx(tx, idDe("aguardar"), "EM_ANDAMENTO", {
      correlationId: `${M}-dep`, operacao: "teste", ciclo: 1, processoId: p3.processoId, workflowInstanceId: vigente3!.id,
    }))
  check("AGUARDAR não pode começar antes de SOLICITAR concluir de novo",
    !tentaAndar.changed && tentaAndar.code === "DEPENDENCIA_PENDENTE", JSON.stringify(tentaAndar))

  // ── 11. Auditoria ──
  const audRetro = await prisma.logAuditoria.findFirst({
    where: { acao: "PROCESS_PHASE_ROLLED_BACK", entidadeId: p3.processoId },
    select: { detalhes: true, usuarioId: true },
  })
  check("o retrocesso deixou evento estruturado", audRetro != null)
  const d = (audRetro?.detalhes ?? {}) as Record<string, unknown>
  check("  com de/para, motivo, justificativa, seleção e correlação",
    !!d.deFase && !!d.paraFase && !!d.motivoCodigo && !!d.justificativa && !!d.reaberturasSelecionadas && !!d.correlationId,
    JSON.stringify(Object.keys(d)))
  check("  e com o autor", audRetro?.usuarioId === p3.actorId)
  const audReab = await prisma.logAuditoria.findFirst({
    where: { acao: "OPERATION_REOPENED", entidadeId: idDe("solicitar") }, select: { detalhes: true },
  })
  check("cada reabertura deixou o próprio evento", audReab != null)
  const dr = (audReab?.detalhes ?? {}) as Record<string, unknown>
  check("  com a execução anterior e a nova", dr.execucaoAnterior === 1 && dr.execucaoNova === 2, JSON.stringify(dr))

  // ══════════════════════════════════════════════════════════════
  secao("(E) I+J+K. Duplo clique, duas sessões e retry")
  // ══════════════════════════════════════════════════════════════
  const p4 = await montar("idem")
  const pedido = {
    processoId: p4.processoId, faseDestino: p4.faseEmissao, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Refazer o pedido ao cartório.",
    reabrir: [{ stepInstanceId: p4.si.solicitar, comDependentes: true }],
    actorId: p4.actorId, correlationId: `${M}-idem-fixo`,
  }
  const [a, b] = await Promise.allSettled([executarRetrocesso(pedido), executarRetrocesso(pedido)])
  void a; void b
  const t4 = await tentativasDoPasso(await passoVigente(p4.processoId, p4.faseEmissao, "solicitar"))
  check("duplo clique/duas sessões: UMA execução nova, não duas", t4.length === 2, `${t4.length} execuções`)
  check("  e uma vigente só", t4.filter((t) => t.supersededAt == null).length === 1)
  const r4c = await executarRetrocesso(pedido)
  check("retry do MESMO comando não cria uma terceira",
    (await tentativasDoPasso(await passoVigente(p4.processoId, p4.faseEmissao, "solicitar"))).length === 2)
  void r4c

  // ══════════════════════════════════════════════════════════════
  secao("(F) T. Três gerações de histórico")
  // ══════════════════════════════════════════════════════════════
  const p5 = await montar("geracoes")
  if (process.env.DBG) {
    const insts = await prisma.phaseWorkflowInstance.findMany({ where: { processoId: p5.processoId }, select: { id: true, faseMacroKey: true, ciclo: true, status: true } })
    console.log("      [antes]", JSON.stringify(insts))
  }
  for (const n of [1, 2]) {
    // Cada geração parte da obrigação VIGENTE: a primeira reabertura pode ter aberto
    // visita nova, e é nela que a segunda acontece.
    const alvoGer = await passoVigente(p5.processoId, p5.faseEmissao, "solicitar")
    await prisma.phaseWorkflowStepInstance.update({
      where: { id: alvoGer }, data: { status: "CONCLUIDO", completedAt: new Date(`2026-08-1${n + 2}T10:00:00Z`) },
    })
    const rg = await executarRetrocesso({
      processoId: p5.processoId, faseDestino: p5.faseEmissao, motivoCodigo: "ERRO_OPERACIONAL",
      justificativa: `Reabertura número ${n} do teste de gerações.`,
      reabrir: [{ stepInstanceId: alvoGer, comDependentes: false }],
      actorId: p5.actorId, correlationId: `${M}-ger-${n}`,
    })
    if (process.env.DBG) console.log(`      [ger ${n}]`, JSON.stringify(rg).slice(0, 260))
  }
  if (process.env.DBG) {
    const insts = await prisma.phaseWorkflowInstance.findMany({ where: { processoId: p5.processoId }, select: { id: true, faseMacroKey: true, ciclo: true, status: true } })
    console.log("      [depois]", JSON.stringify(insts))
  }
  // A OBRIGAÇÃO ATRAVESSA O CICLO, a linha não. Depois de um retrocesso que abre
  // visita nova, "Solicitar certidão desta certidão" é outra linha — e é nela que as
  // gerações seguintes se acumulam. Seguir o id fixo mediria a visita errada.
  const t5 = await tentativasDoPasso(await passoVigente(p5.processoId, p5.faseEmissao, "solicitar"))
  check("três gerações coexistem na obrigação vigente", t5.length === 3, String(t5.length))
  const arquivadas5 = t5.filter((t) => t.supersededAt != null)
  check("  as duas anteriores estão arquivadas", arquivadas5.length === 2, String(arquivadas5.length))
  check("  e cada uma guarda o próprio desfecho",
    arquivadas5.every((t) => (t.status === "CONCLUIDO" ? t.completedAt != null : true)),
    JSON.stringify(t5.map((t) => ({ seq: t.sequencia, st: t.status, fim: !!t.completedAt, arq: !!t.supersededAt }))))
  check("  a sequência não tem buraco", JSON.stringify(t5.map((t) => t.sequencia)) === "[1,2,3]")
  // E a visita ANTERIOR continua legível, com o que houve nela.
  const t5antiga = await tentativasDoPasso(p5.si.solicitar)
  check("  e a visita anterior continua com o histórico dela",
    t5antiga.length >= 1 && t5antiga[0].completedAt != null)

  // ══════════════════════════════════════════════════════════════
  secao("(G) P+Q. Política de reabertura e recusa transacional")
  // ══════════════════════════════════════════════════════════════
  const p6 = await montar("politica")
  const wf6 = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::politica::emissao` }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.updateMany({
    where: { workflowId: wf6!.id, key: "conferir" }, data: { reaberturaPermitida: false },
  })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf6!.id } })
  await congelarVersaoVigente(wf6!.id, "PUBLICACAO")

  const plano6 = await planejarRetrocesso(p6.processoId, p6.faseEmissao)
  check("o cadastro pode proibir a reabertura de uma etapa",
    plano6?.obrigacoes.find((o) => o.stepKey === "conferir")?.podeReabrir === false)
  check("  e a tela recebe o motivo, não só um botão desabilitado",
    (plano6?.obrigacoes.find((o) => o.stepKey === "conferir")?.motivoNaoPode ?? "").includes("não permite"))

  const estados6antes = await estados(p6.si)
  const r6 = await executarRetrocesso({
    processoId: p6.processoId, faseDestino: p6.faseEmissao, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Tentar reabrir uma etapa que o cadastro proíbe.",
    reabrir: [{ stepInstanceId: p6.si.solicitar, comDependentes: false }, { stepInstanceId: p6.si.conferir, comDependentes: false }],
    actorId: p6.actorId,
  })
  check("reabrir o proibido é RECUSADO", !r6.ok && r6.code === "REABERTURA_NAO_PERMITIDA", JSON.stringify(r6))
  check("  e nada foi reaberto — nem a que era permitida",
    JSON.stringify(await estados(p6.si)) === JSON.stringify(estados6antes),
    "a recusa tem de ser do pedido inteiro, não de metade dele")

  const semJust = await executarRetrocesso({
    processoId: p6.processoId, faseDestino: p6.faseEmissao, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "", reabrir: [{ stepInstanceId: p6.si.solicitar, comDependentes: false }], actorId: p6.actorId,
  })
  check("reabrir sem justificativa, quando o cadastro exige, é recusado",
    !semJust.ok && semJust.code === "JUSTIFICATIVA_OBRIGATORIA")

  // ══════════════════════════════════════════════════════════════
  secao("(H) R. Workflow de uma fase só")
  // ══════════════════════════════════════════════════════════════
  const p7 = await montar("umafase")
  await prisma.processo.update({ where: { id: p7.processoId }, data: { faseAtualKey: p7.faseEmissao } })
  const plano7 = await planejarRetrocesso(p7.processoId, p7.faseEmissao)
  check("planejar para a fase ATUAL não é retrocesso", plano7?.ehRetrocesso === false)
  check("  mas as obrigações continuam listadas — reabrir sem retroceder é legítimo",
    (plano7?.obrigacoes.length ?? 0) === 5)

  // ══════════════════════════════════════════════════════════════
  secao("(I) O CASO QUE QUEBROU — ponta a ponta")
  // ══════════════════════════════════════════════════════════════
  //
  // Processo que já concluiu a Emissão. O administrador retrocede manualmente para
  // ela, marca "Solicitar certidão" e manda reabrir a cadeia dependente. É o caminho
  // exato em que o sistema conduzia para "Cancelar operação".
  const p8 = await montar("caso")

  // Anexo, protocolo e lançamento financeiro da PRIMEIRA execução — tudo o que não
  // pode desaparecer.
  const arquivo = await prisma.documentoArquivo.create({
    data: { documentoId: p8.docId, url: "https://r2.local/requerimento-v1.pdf", nome: "requerimento-v1.pdf", vigente: true },
    select: { id: true },
  })
  const solicitacao = await prisma.solicitacaoDocumento.create({
    data: {
      documentoId: p8.docId, processoId: p8.processoId,
      pessoaId: (await prisma.documento.findUnique({ where: { id: p8.docId }, select: { pessoaId: true } }))!.pessoaId,
      faseMacroKey: p8.faseEmissao, canal: "CRC", dataEnvio: new Date("2026-08-10T09:00:00Z"),
      destinatarioNome: "1º Ofício",
      chaveIdempotencia: `${M}-caso-sol`,
      // O NÚMERO DO PROTOCOLO é uma OCORRÊNCIA, não um campo da solicitação — vive em
      // `Protocolo`, ligado à solicitação que o produziu. É esse vínculo que precisa
      // sobreviver ao retrocesso.
      protocolos: {
        create: [{ processoId: p8.processoId, numeroProtocolo: "CRC-2026-77", origem: "SOLICITACAO_DOCUMENTO" }],
      },
    },
    select: { id: true, protocolos: { select: { id: true, numeroProtocolo: true } } },
  })
  const receitasAntes = await prisma.receita.count({ where: { processoId: p8.processoId } })
  const eventosAntes = await prisma.workflowEvento.count({ where: { processoId: p8.processoId } })

  const plano8 = await planejarRetrocesso(p8.processoId, p8.faseEmissao)
  const escolhida = plano8!.obrigacoes.find((o) => o.stepKey === "solicitar")!
  check("o administrador vê a obrigação e o que ela alcança",
    escolhida.podeReabrir && escolhida.alcancaSeReaberta.length === 3)

  const r8 = await executarRetrocesso({
    processoId: p8.processoId, faseDestino: p8.faseEmissao, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Certidão emitida com divergência; refazer o pedido ao cartório.",
    reabrir: [{ stepInstanceId: escolhida.stepInstanceId, comDependentes: true }],
    actorId: p8.actorId, correlationId: `${M}-caso`,
  })
  check("o retrocesso com reabertura da cadeia acontece", r8.ok, JSON.stringify(r8).slice(0, 200))

  const idSolicitar8 = await passoVigente(p8.processoId, p8.faseEmissao, "solicitar")
  const t8 = await tentativasDoPasso(idSolicitar8)
  check("  nasceu uma execução NOVA de Solicitar certidão", t8.length === 2, String(t8.length))
  check("  a execução antiga continua CONCLUÍDA no histórico",
    t8[0].status === "CONCLUIDO" && t8[0].completedAt != null && t8[0].supersededAt != null)

  const passos8 = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: (await prisma.phaseWorkflowInstance.findFirst({
      where: { processoId: p8.processoId, faseMacroKey: p8.faseEmissao, status: "ATIVO" },
      orderBy: { ciclo: "desc" }, select: { id: true } }))!.id },
    select: { stepKey: true, status: true },
  })
  const st8 = Object.fromEntries(passos8.map((x) => [x.stepKey, x.status]))
  check("  a Central passa a mostrar: solicitar em execução, dependentes aguardando",
    st8.solicitar === "EM_ANDAMENTO" && st8.aguardar === "BLOQUEADO" && st8.receber === "BLOQUEADO" && st8.conferir === "BLOQUEADO",
    JSON.stringify(st8))
  check("  e ARQUIVAR, que não depende, segue concluída", st8.arquivar === "CONCLUIDO")

  const obrig8 = passos8.filter((x) => x.stepKey !== "arquivar").length
  const concl8 = passos8.filter((x) => x.stepKey !== "arquivar" && x.status === "CONCLUIDO").length
  check("  o progresso deixou de ser 100%", concl8 < obrig8, `${concl8}/${obrig8}`)

  check("  o ANEXO da execução anterior continua lá",
    (await prisma.documentoArquivo.findUnique({ where: { id: arquivo.id }, select: { url: true, vigente: true } }))?.url ===
    "https://r2.local/requerimento-v1.pdf")
  check("  o PROTOCOLO continua lá, ligado à solicitação que o produziu",
    (await prisma.protocolo.findFirst({ where: { solicitacaoId: solicitacao.id }, select: { numeroProtocolo: true } }))?.numeroProtocolo === "CRC-2026-77")
  check("  o FINANCEIRO não foi duplicado nem apagado",
    (await prisma.receita.count({ where: { processoId: p8.processoId } })) === receitasAntes)
  check("  o histórico do motor não encolheu",
    (await prisma.workflowEvento.count({ where: { processoId: p8.processoId } })) >= eventosAntes)

  // NADA FOI CANCELADO — é o coração do defeito.
  const cancelados8 = await prisma.phaseWorkflowStepInstance.count({
    where: { processoId: p8.processoId, status: { in: ["CANCELADO", "SUPERSEDIDO"] } },
  })
  check("  NENHUMA obrigação foi cancelada ou invalidada", cancelados8 === 0, String(cancelados8))
  const docStatus8 = await prisma.documento.findUnique({ where: { id: p8.docId }, select: { status: true } })
  check("  o documento não foi para um estado de cancelamento",
    docStatus8?.status !== "CANCELADO" && docStatus8?.status !== "INVALIDO", String(docStatus8?.status))
  const tarefas8 = await prisma.tarefa.count({
    where: { processoId: p8.processoId, statusTarefa: "CANCELADA" },
  })
  check("  nenhuma tarefa foi cancelada como efeito colateral", tarefas8 === 0, String(tarefas8))

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
