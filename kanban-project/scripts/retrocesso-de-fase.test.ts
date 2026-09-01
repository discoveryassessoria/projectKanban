// scripts/retrocesso-de-fase.test.ts
//
// MOVER A FASE NÃO REFAZ TRABALHO. REFAZER É OUTRO COMANDO, E É POR UNIDADE.
//
// A primeira versão desta implementação perguntava, no modal de movimentação, quais
// obrigações reabrir — e reabria as marcadas junto com o retrocesso. Os testes
// passavam, e mesmo assim estava errado: mover a fase é um fato sobre a POSIÇÃO do
// processo; refazer é um fato sobre UMA unidade de trabalho — esta certidão, desta
// pessoa, nesta etapa.
//
// A escala mostra por quê. Numa Emissão com cinquenta certidões, "quais tarefas
// reabrir?" num modal de fase é uma pergunta sem resposta possível: são cinquenta
// decisões independentes. E responder por omissão — "voltei de fase, refaço tudo" —
// destrói quarenta e nove trabalhos que estavam certos.
//
// Por isso este arquivo prova as duas coisas separadas, e sobretudo o ISOLAMENTO:
// reabrir uma certidão não pode tocar nenhuma outra.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/retrocesso-de-fase.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient } from "@prisma/client"
import { planejarRetrocesso, executarRetrocesso } from "../src/services/retrocesso-de-fase"
import { planejarReabertura, executarReabertura } from "../src/services/reabertura-de-execucao"
import { tentativasDoPasso, garantirTentativa, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { congelarVersaoVigente } from "../src/services/versao-publicada"
import { gravarOperacao, historicoDaOperacao, historicoDaOperacaoDaUnidade } from "../src/services/operacao-da-etapa"
import { garantirOferta } from "./_fixture-oferta"

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
console.log("\n(A) OS DOIS COMANDOS SÃO SEPARADOS — na assinatura, não só no nome")
// ════════════════════════════════════════════════════════════════

const retro = semComentarios(ler("src/services/retrocesso-de-fase.ts"))
const reab = semComentarios(ler("src/services/reabertura-de-execucao.ts"))

check("retroceder tem serviço próprio", retro.includes("export async function executarRetrocesso"))
check("reabrir tem serviço próprio", reab.includes("export async function executarReabertura"))
check("RETROCEDER NÃO RECEBE SELEÇÃO DE TAREFAS — a assinatura é o contrato",
  !/reabrir\s*:/.test(retro) && !retro.includes("comDependentes"))
check("  e não chama a porta de reabertura", !retro.includes("reabrirPassoTx") && !retro.includes("executarReabertura"))
check("  não cancela", !/cancelar|CANCELADO/.test(retro))
check("  não cria tentativa", !/abrirTentativa|garantirTentativa/.test(retro))
check("  o planejamento do retrocesso devolve RETRATO, não seleção",
  retro.includes("RetratoDaFaseDestino") && !retro.includes("podeReabrir"))
check("reabrir é POR INSTÂNCIA, não por fase nem por chave de passo",
  reab.includes("stepInstanceId: number") && reab.includes("planejarReabertura(stepInstanceId"))
check("  e escopa a cadeia pela UNIDADE", reab.includes("escopoDaUnidade("))
check("  dizendo quantas outras unidades ficam intactas", reab.includes("outrasUnidadesNaFase"))

const rotaRetro = semComentarios(ler("src/app/api/processos/[processoId]/phase/rollback/route.ts"))
check("a rota de retrocesso não aceita seleção de reabertura", !rotaRetro.includes("reabrir"))
const rotaReab = semComentarios(ler("src/app/api/workflow-step-instances/[id]/reabrir/route.ts"))
check("existe rota de reabertura por instância", rotaReab.includes("planejarReabertura") && rotaReab.includes("executarReabertura"))
check("  que respeita a permissão declarada no cadastro do passo", rotaReab.includes("plano.permissaoExigida"))

// ── ESCOPO DA UNIDADE: a regra que isola uma certidão das outras ──
const canonica = semComentarios(ler("lib/operacional/tarefa-canonica.ts"))
check("a unidade é a CONJUNÇÃO das âncoras, não a disjunção",
  canonica.includes("AND: conjuncao") && !/OR: porObrigacao/.test(canonica),
  "com OR, dois documentos da mesma necessidade caem na mesma unidade")

// ════════════════════════════════════════════════════════════════
console.log("\n(A2) A INTERFACE NÃO PERGUNTA REABERTURA NO RETROCESSO")
// ════════════════════════════════════════════════════════════════

const modal = semComentarios(ler("src/components/kanban/MovimentarFaseModal.tsx"))
check("o modal de retrocesso NÃO lista obrigações", !modal.includes("obrigacoes.map"))
check("  NÃO tem checkbox de tarefa", !modal.includes("setSelecionadas"))
check("  NÃO oferece cadeia dependente", !modal.includes("Reabrir a cadeia dependente"))
check("  não envia seleção", !/reabrir,/.test(modal))
check("  mostra só o retrato da fase de destino", modal.includes("O que existe em"))
check("  e diz que nada será reaberto", modal.includes("Nenhuma tarefa foi reaberta"))
check("  o botão fala de movimentação", modal.includes('"Confirmar retrocesso"'))

const reabModal = semComentarios(ler("src/components/kanban/workflow/ReabrirEtapaModal.tsx"))
check("o modal de reabertura mostra a IDENTIDADE da unidade",
  reabModal.includes("Pessoa") && reabModal.includes("Documento") && reabModal.includes("Passo"))
check("  a execução anterior, com data e autor", reabModal.includes("Execução anterior") && reabModal.includes("executadoPorNome"))
check("  as duas estratégias como escolha explícita",
  reabModal.includes("Reabrir somente esta tarefa") && reabModal.includes("Reabrir esta tarefa e as que dependem dela"))
check("  o preview exato do que será criado", reabModal.includes("Será criada nova execução para"))
check("  e a garantia de isolamento", reabModal.includes("Nenhuma outra unidade será alterada"))
check("  exige motivo e justificativa", reabModal.includes("Motivo da reabertura") && reabModal.includes("Justificativa"))

const drawer = semComentarios(ler("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx"))
check("a Central abre o modal de reabertura", drawer.includes("<ReabrirEtapaModal"))

const cfg = semComentarios(ler("src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx"))
// A INVARIANTE É A CAPACIDADE, não o nome da aba.
//
// Isto media `cfg.includes('"reabertura"')` — a chave da aba de primeiro nível. Quando
// as onze abas viraram cinco áreas e a política passou a ser uma seção de "Avançado",
// a asserção ficou vermelha sem que nada tivesse deixado de ser configurável. Uma
// verificação presa ao nome da aba impede reorganizar a tela; presa aos ATRIBUTOS, ela
// impede perder a capacidade — que é o que a baseline existe para proteger.
for (const atributo of [
  "reaberturaPermitida", "reaberturaEstrategia", "reaberturaExigeJustificativa", "reaberturaPermissao",
]) {
  check(`  a política de reabertura continua cadastrável: ${atributo}`, cfg.includes(`set("${atributo}"`))
}

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

  // ── A AUDITORIA ÓRFÃ ────────────────────────────────────────────────────
  //
  // As asserções deste arquivo contam eventos por `entidadeId` — e o id de uma
  // instância de passo é REUTILIZADO entre execuções: outras suítes apagam as
  // instâncias, o `logAuditoria` sobrevive, e a instância criada na próxima rodada
  // nasce com o histórico de outra colada nela. Foi assim que "nenhum evento de
  // reabertura foi emitido" ficou vermelho num banco reutilizado e verde num limpo:
  // o teste passou a medir quantas vezes a suíte já rodou, não o que o código faz.
  //
  // Apagar o que aponta para instância que não existe mais é seguro e devolve ao
  // teste a capacidade de medir o código.
  const idsVivos = new Set((await prisma.phaseWorkflowStepInstance.findMany({ select: { id: true } })).map((x) => x.id))
  const logsDePasso = await prisma.logAuditoria.findMany({
    where: { entidade: "PhaseWorkflowStepInstance" }, select: { id: true, entidadeId: true },
  })
  const orfaos = logsDePasso.filter((l) => l.entidadeId != null && !idsVivos.has(l.entidadeId)).map((l) => l.id)
  if (orfaos.length) await prisma.logAuditoria.deleteMany({ where: { id: { in: orfaos } } })
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
  const oferta = await garantirOferta(prisma, { countryKey: "retro", countryLabel: "Retro", nationalityKey: "retro", nationalityLabel: "Retro", modalityKey: "retro", modalityLabel: "Retro" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: `${M}_${marca}`.toUpperCase().slice(0, 40), name: `${M} ${marca}`, ativo: true,
      paisId: oferta.paisId, modalidadeId: oferta.modalidadeId,
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
      nome: `${M} ${marca}`, arvoreId: arv.id, workflowRuntime: "v2",
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
  secao("(B) O PLANO DO RETROCESSO É UM RETRATO, não um formulário")
  // ══════════════════════════════════════════════════════════════
  const p1 = await montar("plano")
  const plano = await planejarRetrocesso(p1.processoId, p1.faseEmissao)
  check("o plano existe", plano != null)
  check("  reconhece que é um RETROCESSO", plano?.ehRetrocesso === true)
  check("  conta as unidades e as obrigações", plano!.retrato.obrigacoes === 5 && plano!.retrato.unidades === 1,
    JSON.stringify(plano?.retrato))
  check("  e todas concluídas", plano!.retrato.concluidas === 5 && plano!.retrato.emAberto === 0)
  check("  a fase posterior visitada aparece como histórico que permanece",
    (plano?.fasesPosterioresVisitadas.length ?? 0) >= 1)
  check("  o aviso diz que NADA será reaberto", plano!.aviso.includes("Nenhuma tarefa é reaberta"))

  // ══════════════════════════════════════════════════════════════
  secao("(C) TESTE 1/7/8/9 — retroceder não reabre, não cancela, não cria execução")
  // ══════════════════════════════════════════════════════════════
  const p2 = await montar("semreabrir")
  const antes2 = await estados(p2.si)
  const tentAntes2 = await prisma.stepExecution.count({ where: { stepInstance: { processoId: p2.processoId } } })
  const r2 = await executarRetrocesso({
    processoId: p2.processoId, faseDestino: p2.faseEmissao, motivoCodigo: "CORRECAO_CADASTRO",
    justificativa: "Reposicionar a fase.", actorId: p2.actorId,
  })
  check("o retrocesso acontece", r2.ok, JSON.stringify(r2))
  check("  a fase do processo passou a ser a de destino",
    (await prisma.processo.findUnique({ where: { id: p2.processoId }, select: { faseAtualKey: true } }))?.faseAtualKey === p2.faseEmissao)
  check("TESTE 9: nenhuma obrigação mudou de estado", JSON.stringify(await estados(p2.si)) === JSON.stringify(antes2))
  // TESTE 8, com a distinção que o §11 pede: MATERIALIZAR obrigação nova não é
  // REABRIR execução concluída. Voltar para a fase abre uma visita nova, e as
  // obrigações dela nascem com a primeira tentativa — isso é o motor materializando,
  // não refazendo. O que o retrocesso não pode fazer é dar uma execução NOVA a uma
  // obrigação que já tinha, ou arquivar uma que estava vigente.
  const porPasso2 = await prisma.stepExecution.groupBy({
    by: ["stepInstanceId"], where: { stepInstance: { processoId: p2.processoId } }, _count: { _all: true },
  })
  check("TESTE 8: nenhuma obrigação ganhou uma segunda execução",
    porPasso2.every((x) => x._count._all === 1),
    JSON.stringify(porPasso2.filter((x) => x._count._all > 1)))
  const arquivadas2 = await prisma.stepExecution.count({
    where: { stepInstance: { id: { in: Object.values(p2.si) } }, supersededAt: { not: null } },
  })
  check("  e NENHUMA execução anterior foi arquivada pelo retrocesso", arquivadas2 === 0, String(arquivadas2))
  void tentAntes2
  check("TESTE 7: nada foi cancelado",
    (await prisma.phaseWorkflowStepInstance.count({ where: { processoId: p2.processoId, status: { in: ["CANCELADO"] } } })) === 0)
  const tarefa2 = await prisma.tarefa.findFirst({ where: { processoId: p2.processoId }, select: { statusTarefa: true } })
  check("TESTE 2: a tarefa concluída continua concluída", tarefa2?.statusTarefa === "CONCLUIDO_RECEBIDO")
  const audit2 = await prisma.logAuditoria.count({ where: { acao: "STEP_EXECUTION_REOPENED", entidadeId: { in: Object.values(p2.si) } } })
  check("  e nenhum evento de reabertura foi emitido", audit2 === 0)

  // ══════════════════════════════════════════════════════════════
  secao("(D) TESTE 3/5 — reabrir UMA tarefa, na Central, depois de estar na fase")
  // ══════════════════════════════════════════════════════════════
  const p3 = await montar("reabrir")
  await executarRetrocesso({
    processoId: p3.processoId, faseDestino: p3.faseEmissao, motivoCodigo: "CORRECAO_CADASTRO",
    justificativa: "Voltar para a Emissão.", actorId: p3.actorId,
  })
  const idSolicitar = await passoVigente(p3.processoId, p3.faseEmissao, "solicitar")
  const idArquivar = await passoVigente(p3.processoId, p3.faseEmissao, "arquivar")
  const arquivarAntes = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: idArquivar }, select: { status: true, completedAt: true },
  })

  const planoR = await planejarReabertura(idSolicitar)
  check("o plano da reabertura identifica a unidade",
    planoR?.identidade.pessoaNome != null && planoR?.identidade.documentoId != null && planoR?.identidade.stepTitulo === "Solicitar certidão",
    JSON.stringify(planoR?.identidade))
  check("  mostra a execução anterior com data e autor", (planoR?.execucoes.length ?? 0) === 1 && planoR!.execucoes[0].concluidaEm != null)
  check("  e a cadeia dependente DA MESMA unidade",
    JSON.stringify(planoR?.dependentesDaMesmaUnidade.map((d) => d.stepKey)) === '["aguardar","receber","conferir"]',
    JSON.stringify(planoR?.dependentesDaMesmaUnidade.map((d) => d.stepKey)))
  check("  ARQUIVAR não entra — não depende", !planoR!.dependentesDaMesmaUnidade.some((d) => d.stepKey === "arquivar"))

  const rr = await executarReabertura({
    stepInstanceId: idSolicitar, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Certidão veio com o nome da mãe errado.", comDependentes: true, actorId: p3.actorId,
  })
  check("a reabertura acontece", rr.ok, JSON.stringify(rr))
  const st3 = await estados({ s: idSolicitar, a: await passoVigente(p3.processoId, p3.faseEmissao, "aguardar"), q: idArquivar })
  check("  SOLICITAR está em execução de novo", st3.solicitar === "EM_ANDAMENTO", JSON.stringify(st3))
  check("  o dependente voltou a aguardar", st3.aguardar === "BLOQUEADO", JSON.stringify(st3))
  check("  ARQUIVAR, independente, continua concluída com a data dela",
    st3.arquivar === "CONCLUIDO" &&
    (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: idArquivar }, select: { completedAt: true } }))
      ?.completedAt?.toISOString() === arquivarAntes?.completedAt?.toISOString())

  const t3 = await tentativasDoPasso(idSolicitar)
  check("  nasceu execução NOVA e a anterior ficou arquivada com o fim dela",
    t3.length === 2 && t3[0].supersededAt != null && t3[0].completedAt != null && t3[1].supersededAt == null)
  // O QUE FOI PREENCHIDO ANTES continua legível ATRAVÉS DAS VISITAS — a Central mostra
  // a visita vigente, e sem isto o preenchimento da passagem anterior sumia da tela.
  const histUnidade = await historicoDaOperacaoDaUnidade(idSolicitar)
  const daVisitaAnterior = histUnidade.find((h) => !h.visitaAtual)
  check("  o que foi preenchido na visita anterior continua legível",
    (daVisitaAnterior?.payload as { protocolo?: string } | undefined)?.protocolo === "CRC-2026-77",
    JSON.stringify(histUnidade.map((h) => ({ ciclo: h.ciclo, atual: h.visitaAtual, campos: Object.keys(h.payload) }))))
  check("  e vem marcado como HERDADO, não como produzido agora", daVisitaAnterior?.visitaAtual === false)
  const hist3 = await historicoDaOperacao(idSolicitar)
  check("  a execução nova começa vazia", hist3.every((h) => Object.keys(h.payload).length === 0))

  const audReab = await prisma.logAuditoria.findFirst({
    where: { acao: "STEP_EXECUTION_REOPENED", entidadeId: idSolicitar }, select: { detalhes: true },
  })
  check("TESTE 14: a reabertura tem evento PRÓPRIO, separado do retrocesso", audReab != null)
  const dr = (audReab?.detalhes ?? {}) as Record<string, unknown>
  check("  com a identidade da unidade e as execuções", !!dr.identidade && dr.execucaoAnterior === 1 && dr.execucaoNova === 2)
  const audRetro = await prisma.logAuditoria.findFirst({
    where: { acao: "PROCESS_PHASE_ROLLED_BACK", entidadeId: p3.processoId }, select: { descricao: true },
  })
  check("  e o do retrocesso diz que nada foi reaberto",
    (audRetro?.descricao ?? "").includes("Nenhuma tarefa foi reaberta"))

  // ══════════════════════════════════════════════════════════════
  secao("(E) TESTE 10 — três gerações com lineage completo")
  // ══════════════════════════════════════════════════════════════
  const p5 = await montar("geracoes")
  const alvo5 = await passoVigente(p5.processoId, p5.faseEmissao, "solicitar")
  for (const n of [1, 2]) {
    await prisma.phaseWorkflowStepInstance.update({
      where: { id: alvo5 }, data: { status: "CONCLUIDO", completedAt: new Date(`2026-08-1${n + 2}T10:00:00Z`) },
    })
    const rg = await executarReabertura({
      stepInstanceId: alvo5, motivoCodigo: "ERRO_OPERACIONAL",
      justificativa: `Reabertura ${n} do teste de gerações.`, comDependentes: false, actorId: p5.actorId,
      correlationId: `${M}-ger-${n}`,
    })
    if (!rg.ok) check(`geração ${n} reabriu`, false, JSON.stringify(rg))
  }
  const t5 = await tentativasDoPasso(alvo5)
  check("três gerações coexistem", t5.length === 3, String(t5.length))
  check("  duas arquivadas, apontando para a sucessora",
    t5.filter((t) => t.supersededAt != null).length === 2 &&
    t5[0].supersededPorId === t5[1].id && t5[1].supersededPorId === t5[2].id)
  check("  sequência sem buraco", JSON.stringify(t5.map((t) => t.sequencia)) === "[1,2,3]")

  // ══════════════════════════════════════════════════════════════
  secao("(F) Política de reabertura e justificativa")
  // ══════════════════════════════════════════════════════════════
  const p6 = await montar("politica")
  const wf6 = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::politica::emissao` }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.updateMany({
    where: { workflowId: wf6!.id, key: "conferir" }, data: { reaberturaPermitida: false },
  })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf6!.id } })
  await congelarVersaoVigente(wf6!.id, "PUBLICACAO")

  const planoProibido = await planejarReabertura(p6.si.conferir)
  check("o cadastro pode proibir a reabertura de uma etapa", planoProibido?.podeReabrir === false)
  check("  e a tela recebe o motivo", (planoProibido?.motivoNaoPode ?? "").includes("não permite"))
  const antes6 = await estados(p6.si)
  const rProibido = await executarReabertura({
    stepInstanceId: p6.si.conferir, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Tentar reabrir o proibido.", comDependentes: false, actorId: p6.actorId,
  })
  check("reabrir o proibido é recusado", !rProibido.ok && rProibido.code === "REABERTURA_NAO_PERMITIDA")
  check("  e nada mudou", JSON.stringify(await estados(p6.si)) === JSON.stringify(antes6))
  const semJust = await executarReabertura({
    stepInstanceId: p6.si.solicitar, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "", comDependentes: false, actorId: p6.actorId,
  })
  check("sem justificativa, quando o cadastro exige, é recusado",
    !semJust.ok && semJust.code === "JUSTIFICATIVA_OBRIGATORIA")

  // ══════════════════════════════════════════════════════════════
  secao("(G) Duplo clique, duas sessões e retry")
  // ══════════════════════════════════════════════════════════════
  const p7 = await montar("idem")
  const alvo7 = await passoVigente(p7.processoId, p7.faseEmissao, "solicitar")
  const pedido7 = {
    stepInstanceId: alvo7, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Refazer o pedido.", comDependentes: true, actorId: p7.actorId,
    correlationId: `${M}-idem-fixo`,
  }
  await Promise.allSettled([executarReabertura(pedido7), executarReabertura(pedido7)])
  check("duplo clique/duas sessões: UMA execução nova", (await tentativasDoPasso(alvo7)).length === 2,
    String((await tentativasDoPasso(alvo7)).length))
  await executarReabertura(pedido7)
  check("retry do mesmo comando não cria uma terceira", (await tentativasDoPasso(alvo7)).length === 2)

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
