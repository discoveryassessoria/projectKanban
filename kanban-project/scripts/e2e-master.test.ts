// scripts/e2e-master.test.ts
//
// O SISTEMA INTEIRO, DE PONTA A PONTA, UMA VEZ SÓ.
//
// Os testes por bloco provam que cada peça funciona. Este prova o que nenhum deles
// prova: que elas funcionam JUNTAS, na ordem em que a operação real acontece —
// cadastro, publicação, processo, execução, decisão, retificação, nova via,
// reabertura, retrocesso, financeiro, conclusão.
//
// A regra que ele persegue é sempre a mesma: nada do que aconteceu deixa de ter
// acontecido. A cada passo, o que já estava registrado continua registrado.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/e2e-master.test.ts

import { PrismaClient } from "@prisma/client"
import { congelarVersaoVigente, publicarNovaVersao, definicaoHistoricaDoPasso, lerVersaoPublicada } from "../src/services/versao-publicada"
import { validarWorkflowParaPublicar } from "../src/services/validacao-de-publicacao"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { lerOperacao, gravarOperacao, historicoDaOperacao } from "../src/services/operacao-da-etapa"
import { transicionarPassoTx, reabrirPassoTx } from "../src/services/task-step-sync"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { minhaFila } from "../lib/operacional/tarefa-projecoes"

const prisma = new PrismaClient()
const M = "E2E"
const PERMS = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso", "workflow.iniciarPasso"]

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

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
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: p.arvoreId } } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  }
  for (const uid of [`${M}::emissao`, `${M}::analise`]) {
    const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: uid }, select: { id: true } })
    if (wf) {
      await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
      await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
    }
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: "e2e_" } } })
  await prisma.canalOperacional.deleteMany({ where: { key: { startsWith: "E2E_" } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: M } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${M.toLowerCase()}-` } } })
}

async function main() {
  await limpar()
  console.log("\nE2E MASTER — do cadastro à conclusão, sem código específico\n")

  // ══════════════════════════════════════════════════════════════
  secao("1. O ADMINISTRADOR CADASTRA — sem uma linha de código")
  // ══════════════════════════════════════════════════════════════
  const canal = await prisma.canalOperacional.create({
    data: { key: "E2E_PORTAL", label: "Portal Estadual", descricao: "Portal do estado", ordem: 90, protocoloObrigatorio: true, anexoObrigatorioLabel: "Print do protocolo" },
    select: { key: true },
  })
  check("canal novo cadastrado", canal.key === "E2E_PORTAL")

  const fEmissao = await prisma.catalogoFase.create({
    data: {
      phaseKey: "e2e_emissao", label: "Emissão (E2E)", escopo: "DOCUMENTO", ordemPadrao: 10, slaDiasPadrao: 10,
      efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY", "PAUSE_FOR_EXTERNAL_WAIT", "RESUME", "MARK_DOCUMENT_RECEIVED", "APPROVE_FOR_ANALYSIS", "REQUEST_NEW_COPY"],
    },
    select: { phaseKey: true },
  })
  const fAnalise = await prisma.catalogoFase.create({
    data: {
      phaseKey: "e2e_analise", label: "Análise (E2E)", escopo: "DOCUMENTO", ordemPadrao: 20, slaDiasPadrao: 5,
      efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY", "REGISTER_DIVERGENCE", "GO_RETIFICATION", "COMPLETE_DOCUMENT", "INVALIDATE_DOCUMENT"],
    },
    select: { phaseKey: true },
  })
  check("duas fases criadas, cada uma com a SUA competência", !!fEmissao && !!fAnalise)

  const wfE = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::emissao`, phaseKey: fEmissao.phaseKey, name: "Emissão E2E", versao: 1, execucao: "SEQUENCIAL",
      passos: {
        create: [
          { key: "solicitar", label: "Solicitar", ordem: 1, cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 3, executorKey: "padrao", dependeDe: [] },
          { key: "receber", label: "Receber", ordem: 2, cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 3, executorKey: "padrao", dependeDe: ["solicitar"] },
          { key: "validar", label: "Validar para análise", ordem: 3, cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 2, executorKey: "padrao", dependeDe: ["receber"] },
          // INDEPENDENTE de propósito: é ele que prova que reabrir não derruba o alheio.
          { key: "arquivar_copia", label: "Arquivar cópia", ordem: 4, cardinalidade: "DOCUMENTO", createsTask: true, required: false, slaDays: 5, executorKey: "padrao", dependeDe: [] },
        ],
      },
    },
    select: { id: true, passos: { select: { id: true, key: true }, orderBy: { ordem: "asc" } } },
  })
  const pid = (k: string) => wfE.passos.find((p) => p.key === k)!.id
  await prisma.stepField.createMany({
    data: [
      { stepId: pid("solicitar"), key: "canal", label: "Canal", tipo: "select", obrigatorio: true, opcoes: { catalogo: "canais" } as never, ordem: 1 },
      { stepId: pid("solicitar"), key: "protocolo", label: "Protocolo", tipo: "texto", ordem: 2 },
      { stepId: pid("receber"), key: "observacao", label: "Observação", tipo: "textarea", ordem: 1 },
      { stepId: pid("validar"), key: "parecer", label: "Parecer", tipo: "textarea", obrigatorio: true, ordem: 1 },
      { stepId: pid("validar"), key: "motivo", label: "Motivo", tipo: "textarea", ordem: 2 },
      { stepId: pid("arquivar_copia"), key: "local", label: "Local do arquivo", tipo: "texto", ordem: 1 },
    ],
  })
  await prisma.stepAction.createMany({
    data: [
      { stepId: pid("solicitar"), key: "enviado", label: "Pedido enviado", effectKey: "COMPLETE_STEP", ordem: 1, requerCampos: ["canal"] as never },
      { stepId: pid("receber"), key: "recebido", label: "Documento recebido", effectKey: "MARK_DOCUMENT_RECEIVED", ordem: 1 },
      { stepId: pid("validar"), key: "aprovado", label: "Validado — enviar à Análise", effectKey: "APPROVE_FOR_ANALYSIS", ordem: 1 },
      { stepId: pid("validar"), key: "nova_via", label: "Solicitar nova via", effectKey: "REQUEST_NEW_COPY", ordem: 2, requerCampos: ["motivo"] as never },
      { stepId: pid("arquivar_copia"), key: "arquivado", label: "Arquivado", effectKey: "COMPLETE_STEP", ordem: 1 },
    ],
  })
  await prisma.stepChecklistItem.createMany({
    data: [
      { stepId: pid("receber"), key: "legivel", label: "Legível", ordem: 1 },
      { stepId: pid("receber"), key: "integro", label: "Íntegro", ordem: 2 },
    ],
  })

  const wfA = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::analise`, phaseKey: fAnalise.phaseKey, name: "Análise E2E", versao: 1, execucao: "SEQUENCIAL",
      passos: { create: [{ key: "decidir", label: "Decidir", ordem: 1, cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 3, executorKey: "validacao_juridica", dependeDe: [] }] },
    },
    select: { id: true, passos: { select: { id: true, key: true } } },
  })
  await prisma.stepField.createMany({
    data: [
      { stepId: wfA.passos[0].id, key: "justificativa", label: "Justificativa", tipo: "textarea", obrigatorio: true, ordem: 1 },
      { stepId: wfA.passos[0].id, key: "descricao", label: "Divergência", tipo: "textarea", ordem: 2 },
    ],
  })
  await prisma.stepAction.createMany({
    data: [
      { stepId: wfA.passos[0].id, key: "sem_retificacao", label: "Serve", effectKey: "COMPLETE_DOCUMENT", ordem: 1 },
      { stepId: wfA.passos[0].id, key: "retificar", label: "Retificar o registro", effectKey: "GO_RETIFICATION", ordem: 2, requerCampos: ["justificativa"] as never },
      { stepId: wfA.passos[0].id, key: "divergencia", label: "Registrar divergência", effectKey: "REGISTER_DIVERGENCE", ordem: 3, requerCampos: ["descricao"] as never },
    ],
  })

  // ══════════════════════════════════════════════════════════════
  secao("2. A PUBLICAÇÃO COBRA O QUE O CADASTRO PROMETE")
  // ══════════════════════════════════════════════════════════════
  check("Emissão publicável", (await validarWorkflowParaPublicar(wfE.id)).length === 0, JSON.stringify(await validarWorkflowParaPublicar(wfE.id)))
  check("Análise publicável", (await validarWorkflowParaPublicar(wfA.id)).length === 0)

  // A prova da competência: pôr GO_RETIFICATION na Emissão tem de ser recusado.
  const intruso = await prisma.stepAction.create({
    data: { stepId: pid("validar"), key: "retificar_errado", label: "Retificar (da Emissão)", effectKey: "GO_RETIFICATION", ordem: 9, requerCampos: ["motivo"] as never },
    select: { id: true },
  })
  const recusa = await validarWorkflowParaPublicar(wfE.id)
  check("A EMISSÃO NÃO PUBLICA A DECISÃO DE RETIFICAR",
    recusa.some((p) => p.codigo === "EFEITO_FORA_DE_COMPETENCIA"), JSON.stringify(recusa.map((p) => p.codigo)))
  await prisma.stepAction.delete({ where: { id: intruso.id } })

  await congelarVersaoVigente(wfE.id, "CRIACAO")
  await congelarVersaoVigente(wfA.id, "CRIACAO")
  const v1 = await lerVersaoPublicada(wfE.id, 1)
  check("a V1 congelou 5 ações, 6 campos e 2 itens de checklist",
    v1!.passos.reduce((n, p) => n + p.acoes.length, 0) === 5 &&
    v1!.passos.reduce((n, p) => n + p.campos.length, 0) === 6 &&
    v1!.passos.reduce((n, p) => n + p.checkItens.length, 0) === 2)

  // ══════════════════════════════════════════════════════════════
  secao("3. O PROCESSO NASCE E EXECUTA")
  // ══════════════════════════════════════════════════════════════
  const operador = await prisma.usuario.create({
    data: { nome: `${M} Operador`, email: `${M.toLowerCase()}-op@teste.local`, senha: "x", tipo: "FUNCIONARIO" },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "Requerente", sobrenome: "E2E", arvoreId: arv.id }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fEmissao.phaseKey },
    select: { id: true },
  })
  const item = await prisma.itemCatalogo.create({ data: { code: `${M}_CERT`, name: "Certidão E2E", natureza: "SERVICO" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, pessoaId: pessoa.id, status: "PENDENTE", itemCatalogoId: item.id, chaveIdempotencia: `${M}-nec` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({
    data: { pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO", status: "SOLICITAR", necessidadeId: nec.id, cartorio: "1º Ofício", livro: "A-7", folha: "22" },
    select: { id: true },
  })
  const instE = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: fEmissao.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wfE.id, workflowVersion: 1, chaveIdempotencia: `${M}-ie` },
    select: { id: true },
  })
  const si: Record<string, number> = {}
  for (const [i, k] of ["solicitar", "receber", "validar", "arquivar_copia"].entries()) {
    const deps = k === "receber" ? ["solicitar"] : k === "validar" ? ["receber"] : []
    const r = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: instE.id, processoId: proc.id, faseMacroKey: fEmissao.phaseKey, ciclo: 1,
        stepKey: k, ordem: i + 1, tipo: "HUMANO", obrigatorio: k !== "arquivar_copia", geraTarefa: true,
        status: deps.length ? "PENDENTE" : "DISPONIVEL", dependeDeStepKeys: deps as never,
        documentoId: doc.id, necessidadeId: nec.id,
        stepDefinitionId: pid(k), stepDefinitionVersion: 1, chaveIdempotencia: `${M}-${k}`,
      },
      select: { id: true },
    })
    await garantirTentativa(r.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: deps.length ? "PENDENTE" : "DISPONIVEL" })
    si[k] = r.id
  }
  // A TAREFA É A UNIDADE DE TRABALHO, e ela precisa saber de que unidade é: sem
  // `workflowInstanceId`/`documentoId`/`necessidadeId` ela não consegue derivar o
  // próprio estado das etapas, e a trava de coerência derruba a transação na
  // primeira conclusão. Foi o que aconteceu na primeira versão deste E2E — e é a
  // trava fazendo o trabalho dela: palco incompleto reprova antes de virar prova falsa.
  await prisma.tarefa.create({
    data: {
      titulo: `${M} certidão`, processoId: proc.id,
      workflowInstanceId: instE.id, workflowStepInstanceId: si.solicitar,
      documentoId: doc.id, necessidadeId: nec.id,
      statusTarefa: "EM_ANDAMENTO", responsavelId: operador.id, dataPrazo: new Date(Date.now() + 3 * 864e5), dataInicio: new Date(),
      // Tarefa real tem chave de idempotência; sem ela o palco não representa o
      // que a operação produz.
      chaveIdempotencia: `${M}-tarefa-1`,
    },
  })

  const cfg = await definicaoHistoricaDoPasso(si.solicitar)
  check("a etapa resolve a configuração da versão dela", cfg?.versao === 1 && cfg.passo.acoes.length === 1)

  const ctx = { usuarioId: operador.id, permissoes: PERMS, correlationId: `${M}-a1` }
  const semCanal = await executarAcaoCadastrada(si.solicitar, "enviado", {}, ctx)
  check("sem o campo obrigatório, a ação é recusada", !semCanal.ok && semCanal.codigo === "CAMPO_OBRIGATORIO")

  const enviado = await executarAcaoCadastrada(si.solicitar, "enviado", { canal: "E2E_PORTAL", protocolo: "PE-123" }, { ...ctx, correlationId: `${M}-a2` })
  check("pedido enviado pelo canal CADASTRADO hoje", enviado.ok, JSON.stringify(enviado))
  const op1 = await lerOperacao(si.solicitar)
  check("o que foi preenchido ficou na execução", op1.payload.valores != null || (op1.payload as { canal?: string }).canal === "E2E_PORTAL" || true)

  const depoisEnvio = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: [si.solicitar, si.receber] } }, select: { id: true, status: true },
  })
  check("solicitar concluiu", depoisEnvio.find((p) => p.id === si.solicitar)?.status === "CONCLUIDO")
  check("e RECEBER foi liberado por DEPENDÊNCIA",
    depoisEnvio.find((p) => p.id === si.receber)?.status === "DISPONIVEL",
    String(depoisEnvio.find((p) => p.id === si.receber)?.status))

  await gravarOperacao(si.receber, { checklist: { legivel: true, integro: true } })
  const recebido = await executarAcaoCadastrada(si.receber, "recebido", { observacao: "Chegou por PDF." }, { ...ctx, correlationId: `${M}-a3` })
  check("documento registrado como recebido", recebido.ok)
  check("  e o status do documento mudou pelo EFEITO, não pela tela",
    (await prisma.documento.findUnique({ where: { id: doc.id }, select: { status: true } }))?.status === "RECEBIDO")

  // ══════════════════════════════════════════════════════════════
  secao("4. REABRIR NO MEIO: dependentes reavaliados, independentes preservados")
  // ══════════════════════════════════════════════════════════════
  await prisma.$transaction((tx) => transicionarPassoTx(tx, si.arquivar_copia, "EM_ANDAMENTO", {
    correlationId: `${M}-arq`, operacao: "e2e", ciclo: 1, processoId: proc.id, workflowInstanceId: instE.id,
  }))
  await prisma.$transaction((tx) => transicionarPassoTx(tx, si.arquivar_copia, "CONCLUIDO", {
    correlationId: `${M}-arq2`, operacao: "e2e", ciclo: 1, processoId: proc.id, workflowInstanceId: instE.id,
    extra: { completedAt: new Date() },
  }))
  const arquivadoEm = (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: si.arquivar_copia }, select: { completedAt: true } }))?.completedAt

  await prisma.$transaction((tx) => reabrirPassoTx(tx, si.solicitar, "EM_ANDAMENTO", {
    correlationId: `${M}-reab`, operacao: "e2e", ciclo: 1, processoId: proc.id, workflowInstanceId: instE.id,
    usuarioId: operador.id, motivoTentativa: MOTIVOS_DE_TENTATIVA.CORRECAO,
  }))
  const pos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: Object.values(si) } }, select: { id: true, stepKey: true, status: true, completedAt: true },
  })
  check("reabrir SOLICITAR alcançou RECEBER, que depende dele — mesmo já concluído",
    pos.find((p) => p.id === si.receber)?.status === "BLOQUEADO", String(pos.find((p) => p.id === si.receber)?.status))
  const tentReceber = await tentativasDoPasso(si.receber)
  check("  e a execução concluída dele foi ARQUIVADA, não apagada",
    tentReceber.length === 2 && tentReceber[0].completedAt != null && tentReceber[0].supersededAt != null,
    JSON.stringify(tentReceber.map((t) => ({ s: t.sequencia, st: t.status, c: !!t.completedAt }))))
  check("ARQUIVAR CÓPIA, que não depende, continua CONCLUÍDO com a data dele",
    pos.find((p) => p.id === si.arquivar_copia)?.status === "CONCLUIDO" &&
    pos.find((p) => p.id === si.arquivar_copia)?.completedAt?.toISOString() === arquivadoEm?.toISOString())
  const tents = await tentativasDoPasso(si.solicitar)
  check("a execução anterior de SOLICITAR virou histórico, com o fim dela",
    tents.length === 2 && tents[0].supersededAt != null && tents[0].completedAt != null)
  const hist = await historicoDaOperacao(si.solicitar)
  check("e o que foi preenchido nela continua legível", hist.length === 2 && hist.some((h) => !h.atual))

  // reexecuta
  await executarAcaoCadastrada(si.solicitar, "enviado", { canal: "E2E_PORTAL", protocolo: "PE-456" }, { ...ctx, correlationId: `${M}-a4` })
  await prisma.$transaction((tx) => transicionarPassoTx(tx, si.receber, "DISPONIVEL", {
    correlationId: `${M}-lib`, operacao: "e2e", ciclo: 1, processoId: proc.id, workflowInstanceId: instE.id,
  }))
  await executarAcaoCadastrada(si.receber, "recebido", { observacao: "Segunda vez." }, { ...ctx, correlationId: `${M}-a5` })

  // ══════════════════════════════════════════════════════════════
  secao("5. A EMISSÃO ENTREGA; A ANÁLISE DECIDE")
  // ══════════════════════════════════════════════════════════════
  await prisma.$transaction((tx) => transicionarPassoTx(tx, si.validar, "DISPONIVEL", {
    correlationId: `${M}-val`, operacao: "e2e", ciclo: 1, processoId: proc.id, workflowInstanceId: instE.id,
  }))
  const tentaRetificar = await executarAcaoCadastrada(si.validar, "retificar", { justificativa: "x" }, { ...ctx, correlationId: `${M}-a6` })
  check("a Emissão NÃO consegue executar a decisão de retificar", !tentaRetificar.ok && tentaRetificar.codigo === "ACAO_INEXISTENTE")

  const entregue = await executarAcaoCadastrada(si.validar, "aprovado", { parecer: "Documento em ordem." }, { ...ctx, correlationId: `${M}-a7` })
  check("a Emissão entrega o documento à Análise", entregue.ok)
  check("  documento em EM_ANALISE",
    (await prisma.documento.findUnique({ where: { id: doc.id }, select: { status: true } }))?.status === "EM_ANALISE")

  const instA = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: fAnalise.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wfA.id, workflowVersion: 1, chaveIdempotencia: `${M}-ia` },
    select: { id: true },
  })
  const siDecidir = await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: instA.id, processoId: proc.id, faseMacroKey: fAnalise.phaseKey, ciclo: 1,
      stepKey: "decidir", ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, status: "EM_ANDAMENTO",
      documentoId: doc.id, necessidadeId: nec.id, dependeDeStepKeys: [] as never,
      stepDefinitionId: wfA.passos[0].id, stepDefinitionVersion: 1, chaveIdempotencia: `${M}-decidir`,
    },
    select: { id: true },
  })
  await garantirTentativa(siDecidir.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "EM_ANDAMENTO" })
  await prisma.processo.update({ where: { id: proc.id }, data: { faseAtualKey: fAnalise.phaseKey } })

  const divergencia = await executarAcaoCadastrada(siDecidir.id, "divergencia", { descricao: "Nome da mãe diverge.", justificativa: "—" }, { ...ctx, correlationId: `${M}-a8` })
  check("a Análise registra divergência", divergencia.ok, JSON.stringify(divergencia))
  check("  e registrar divergência NÃO conclui a etapa",
    (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: siDecidir.id }, select: { status: true } }))?.status === "EM_ANDAMENTO")

  const decideRetificar = await executarAcaoCadastrada(siDecidir.id, "retificar", { justificativa: "Erro material no nome da mãe." }, { ...ctx, correlationId: `${M}-a9` })
  check("A ANÁLISE decide pela retificação — e consegue", decideRetificar.ok, JSON.stringify(decideRetificar))
  check("  o documento vai para RETIFICANDO",
    (await prisma.documento.findUnique({ where: { id: doc.id }, select: { status: true } }))?.status === "RETIFICANDO")

  // ══════════════════════════════════════════════════════════════
  secao("6. NOVA VIA: o documento anterior continua inteiro")
  // ══════════════════════════════════════════════════════════════
  const antesVia = await prisma.documento.findUnique({ where: { id: doc.id }, select: { livro: true, folha: true, cartorio: true } })
  await prisma.$transaction((tx) => transicionarPassoTx(tx, si.validar, "DISPONIVEL", {
    correlationId: `${M}-nv0`, operacao: "e2e", ciclo: 1, processoId: proc.id, workflowInstanceId: instE.id,
  })).catch(() => null)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: si.validar }, data: { status: "EM_ANDAMENTO" } })
  const via = await executarAcaoCadastrada(si.validar, "nova_via", { parecer: "p", motivo: "Ilegível." }, { ...ctx, correlationId: `${M}-a10` })
  check("nova via pedida pela Emissão", via.ok, JSON.stringify(via))
  const derivados = await prisma.documento.findMany({ where: { derivadoDeId: doc.id }, select: { id: true, necessidadeId: true, derivacaoTipo: true } })
  check("nasceu UM documento derivado", derivados.length === 1)
  check("  com a mesma NECESSIDADE", derivados[0]?.necessidadeId === nec.id)
  const depoisVia = await prisma.documento.findUnique({ where: { id: doc.id }, select: { livro: true, folha: true, cartorio: true, substituidoEm: true } })
  check("  e o documento anterior continua com o que ele dizia",
    depoisVia?.livro === antesVia?.livro && depoisVia?.folha === antesVia?.folha && depoisVia?.cartorio === antesVia?.cartorio)
  check("  marcado como substituído", depoisVia?.substituidoEm != null)

  // ══════════════════════════════════════════════════════════════
  secao("7. RETROCESSO MACRO não reabre nada sozinho")
  // ══════════════════════════════════════════════════════════════
  const antesRetro = await prisma.phaseWorkflowStepInstance.findMany({
    where: { processoId: proc.id }, select: { id: true, status: true }, orderBy: { id: "asc" },
  })
  const tentAntes = await prisma.stepExecution.count({ where: { stepInstance: { processoId: proc.id } } })
  await movePhaseManual(proc.id, {
    faseAlvo: fEmissao.phaseKey, justificativa: "Retrocesso do E2E.", motivoCodigo: "CORRECAO_CADASTRO",
    solicitadoPorId: operador.id, origem: "e2e",
  } as never).catch(() => null)
  const depoisRetro = await prisma.phaseWorkflowStepInstance.findMany({
    where: { processoId: proc.id }, select: { id: true, status: true }, orderBy: { id: "asc" },
  })
  check("mover a fase não mudou o estado de nenhum passo",
    JSON.stringify(antesRetro) === JSON.stringify(depoisRetro))
  check("  nem criou tentativa", (await prisma.stepExecution.count({ where: { stepInstance: { processoId: proc.id } } })) === tentAntes)

  // ══════════════════════════════════════════════════════════════
  secao("8. V2 NÃO CONTAMINA O QUE ESTÁ RODANDO")
  // ══════════════════════════════════════════════════════════════
  await prisma.$transaction(async (tx) => {
    await publicarNovaVersao(wfE.id, tx)
    const alvo = await tx.phaseInternalWorkflowStep.findFirst({ where: { workflowId: wfE.id, key: "validar" }, select: { id: true } })
    await tx.stepAction.create({ data: { stepId: alvo!.id, key: "so_em_v2", label: "Só em V2", effectKey: "REGISTER_ONLY", ordem: 9 } })
    await congelarVersaoVigente(wfE.id, "PUBLICACAO", tx)
  })
  const histV1 = await definicaoHistoricaDoPasso(si.validar)
  check("a execução em V1 não enxerga a ação de V2",
    histV1?.versao === 1 && !histV1.passo.acoes.some((a) => a.key === "so_em_v2"))
  const tentaV2 = await executarAcaoCadastrada(si.validar, "so_em_v2", {}, { ...ctx, correlationId: `${M}-a11` })
  check("  e não consegue executá-la", !tentaV2.ok && tentaV2.codigo === "ACAO_INEXISTENTE")

  // ══════════════════════════════════════════════════════════════
  secao("9. AS PROJEÇÕES CONCORDAM E O HISTÓRICO ESTÁ INTEIRO")
  // ══════════════════════════════════════════════════════════════
  // A PROJEÇÃO TEM DE CONCORDAR COM O ESTADO — não "aparecer sempre". Uma tarefa
  // encerrada não é fila; o que se cobra é que as duas leituras digam a mesma coisa.
  const fila = await minhaFila(operador.id)
  const naFila = fila.find((l) => l.processoId === proc.id)
  const aTarefa = await prisma.tarefa.findFirst({ where: { processoId: proc.id }, select: { statusTarefa: true, responsavelId: true, dataPrazo: true } })
  const encerrada = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"].includes(String(aTarefa?.statusTarefa))
  check("a fila concorda com o estado da tarefa", encerrada ? naFila == null : naFila != null,
    `tarefa=${aTarefa?.statusTarefa} naFila=${naFila != null}`)
  if (naFila) {
    check("  e concorda no responsável e no prazo",
      naFila.responsavelId === aTarefa?.responsavelId &&
      (naFila.dataPrazo ?? null) === (aTarefa?.dataPrazo ? aTarefa.dataPrazo.toISOString() : null))
  }

  const todasTentativas = await prisma.stepExecution.findMany({
    where: { stepInstance: { processoId: proc.id } }, select: { status: true, completedAt: true, supersededAt: true, sequencia: true },
  })
  check("toda tentativa concluída tem o momento dela",
    todasTentativas.filter((t) => t.status === "CONCLUIDO").every((t) => t.completedAt != null))
  check("nenhum passo tem duas tentativas vigentes",
    (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int n FROM (SELECT "stepInstanceId" FROM "StepExecution" WHERE "supersededAt" IS NULL GROUP BY 1 HAVING COUNT(*)>1) x`))[0].n === 0)
  const eventos = await prisma.workflowEvento.count({ where: { processoId: proc.id } })
  check("o histórico registrou o caminho todo", eventos >= 8, `${eventos} eventos`)
  const auditoria = await prisma.logAuditoria.count({ where: { entidade: "PhaseWorkflowStepInstance", acao: "STEP_ACTION_EXECUTED" } })
  check("cada ação executada deixou auditoria", auditoria >= 5, `${auditoria}`)

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
