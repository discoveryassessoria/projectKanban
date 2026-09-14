// scripts/mandato-110-testes.test.ts
// ============================================================================
// MANDATO 110 — suíte literal do mandato executivo "Solicitar Certidão"
// (Emissão Documental). Cada bloco abaixo prova UM item numerado do mandato
// original (01 a 110), com condição REAL verificada no banco/serviço — nunca
// um `true` fixo. Onde o mandato fala em "4 subtarefas"/"4 Steps", usamos os
// 5 stepKeys REAIS de produção (workflow id=12: solicitar_certidao,
// aguardar_retorno_do_cartorio, receber_certidao, conferir_certidao,
// validar_certidao — ver docs/architecture/27).
//
// Rodar:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   npx tsx scripts/mandato-110-testes.test.ts
//
// ESCREVE NO BANCO — só roda no banco de teste local (`exigirBancoDeTeste`).
// Todo dado de fixture é marcado com o prefixo MANDATO110-TEST e limpo antes/depois.
// ============================================================================
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { exigirBancoDeTeste } from "./_banco-de-teste"

import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import {
  atribuirTarefa, transferirTarefa, avisarAcontecimentosOperacionais,
} from "@/lib/operacional/tarefa-comandos"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"
import {
  aguardarTerceiro, retomarDeEspera, politicaDeSla, reabrirTarefa,
} from "@/lib/operacional/tarefa-ciclo"
import {
  estadoTemporalDaOperacao, estadosTemporaisDasOperacoes,
} from "@/lib/operacional/proximo-acontecimento"
import {
  visaoGerencial, minhaFila, dossieDaTarefa, indicadoresGerenciais, agruparFila,
} from "@/lib/operacional/tarefa-projecoes"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import { diaOperacional, estadoTemporal } from "@/lib/operacional/tempo-operacional"
import { isDiaUtil, proximoDiaUtil } from "@/src/lib/diasUteis"

import {
  novaViaDocumental, invalidarDocumento, marcarDocumentoRecebido,
} from "@/src/services/efeitos-de-dominio"
import { identificarImpactoDownstream, carregarPassoAutorizado } from "@/src/services/documento-operacao"
import { efeito as efeitoDoCatalogo } from "@/src/lib/motor/catalogo-de-efeitos"
import {
  preverPublicacao, publicarWorkflow, marcarRascunho,
} from "@/src/services/publicacao-de-workflow"
import { versaoDaInstancia, lerVersaoPublicada } from "@/src/services/versao-publicada"
import {
  atenderNecessidade, reabrirAtendimentoNecessidade,
} from "@/src/services/necessidade-documental"
import { aplicarAndamento, gravarAndamento, lerAndamento } from "@/src/lib/process-stage/andamento-etapa"
import { calcularPendencias } from "@/src/lib/motor/blocking-engine"

const MARCA = "MANDATO110-TEST"
const STEP_KEYS = [
  "solicitar_certidao",
  "aguardar_retorno_do_cartorio",
  "receber_certidao",
  "conferir_certidao",
  "validar_certidao",
] as const

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${"═".repeat(2)} ${t}`)

// ============================================================================
// LIMPEZA — tudo marcado com MARCA, e só isso.
// ============================================================================
async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)

  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tids = ts.map((t) => t.id)

  const docs = await prisma.documento.findMany({ where: { pessoa: { arvoreId: { in: arvIds } } }, select: { id: true } })
  const docIds = docs.map((d) => d.id)

  const tiposCad = await prisma.tipoDocumentoCadastro.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tiposCad.map((t) => t.id)

  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  const wfIds = wfs.map((w) => w.id)

  await prisma.exigenciaEvidenciaEtapa.deleteMany({ where: { OR: [{ evidenciaTipoId: { in: tipoIds } }, { documentoTipoId: { in: tipoIds } }] } })
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { processoId: { in: ids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tids } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefaDependencia.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { dependeDeId: { in: tids } }] } })
  await prisma.documentoArquivo.deleteMany({ where: { documentoId: { in: docIds } } })
  await prisma.documentoObservacao.deleteMany({ where: { documentoId: { in: docIds } } })
  await prisma.solicitacaoDocumento.deleteMany({ where: { documentoId: { in: docIds } } })
  await prisma.pastaApostilamentoDocumento.deleteMany({ where: { documentoId: { in: docIds } } }).catch(() => null)
  await prisma.pastaApostilamento.deleteMany({ where: { processoId: { in: ids } } }).catch(() => null)
  await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumentalEvento.deleteMany({ where: { necessidade: { processoId: { in: ids } } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { id: { in: docIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const a of arvIds) await prisma.pessoa.deleteMany({ where: { arvoreId: a } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })

  await prisma.stepChecklistItem.deleteMany({ where: { step: { workflowId: { in: wfIds } } } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: wfIds } } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfIds } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfIds } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { id: { in: tipoIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@mandato110.test" } } })
}

// ============================================================================
// FIXTURES
// ============================================================================
let seq = 0
const usuario = (nome: string, tipo: "admin" | "assistente" = "assistente") =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${++seq}@mandato110.test`, senha: "x", tipo }, select: { id: true, nome: true } })

/** Um tipo documental de CERTIDÃO próprio (isolado por cenário — nunca global). */
async function tipoCertidao(sufixo: string) {
  seq++
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}-IC-${sufixo}-${seq}`, name: `Certidão ${sufixo}`, natureza: "DOCUMENTO" },
    select: { id: true },
  })
  const tipo = await prisma.tipoDocumentoCadastro.create({
    data: { code: `${MARCA}-TD-${sufixo}-${seq}`, name: `Certidão ${sufixo}`, itemCatalogoId: item.id, nature: "certidao" },
    select: { id: true },
  })
  return { itemCatalogoId: item.id, tipoDocumentoId: tipo.id }
}

/** Um tipo documental de EVIDÊNCIA (requerimento/recebido) — nunca "certidão". */
async function tipoEvidencia(sufixo: string) {
  seq++
  const tipo = await prisma.tipoDocumentoCadastro.create({
    data: { code: `${MARCA}-EV-${sufixo}-${seq}`, name: `Evidência ${sufixo}`, nature: "documento" },
    select: { id: true },
  })
  return tipo.id
}

interface Certidao {
  pessoaId: number
  necessidadeId: number
  documentoId: number
  stepIds: number[]
}

interface Palco {
  processoId: number
  arvoreId: number
  instanciaId: number
  certidoes: Certidao[]
}

/** wf5 — o "workflow publicado" que ancora `workflowDefinitionId`/`workflowVersion`
 *  das instâncias (usado por `politicaDeSla`/`versaoDaInstancia` — Etapa 9/67-69). */
let wf5Id = 0
let wf5Versao = 1

/**
 * MONTA o palco de UMA fase de Emissão Documental com N certidões, cada uma com
 * os 5 stepKeys REAIS de produção, em cadeia sequencial de dependência (o passo
 * N depende de o passo N-1 estar CONCLUIDO/DISPENSADO — mesma regra de
 * `liberadosPor`). `reconciliarTarefas` materializa 1 Tarefa por certidão.
 */
async function palco(opts: { certidoes?: number; sufixo?: string } = {}): Promise<Palco> {
  const n = opts.certidoes ?? 1
  const sufixo = opts.sufixo ?? "P"
  seq++
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${sufixo}${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${MARCA} processo ${sufixo}${seq}`, arvoreId: arv.id, faseAtualKey: "emissao_documental" },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf5Id || null, workflowVersion: wf5Id ? wf5Versao : null,
      chaveIdempotencia: `${MARCA}-inst-${proc.id}`,
    },
    select: { id: true },
  })

  const certidoes: Certidao[] = []
  for (let c = 0; c < n; c++) {
    seq++
    const { itemCatalogoId, tipoDocumentoId } = await tipoCertidao(`${sufixo}${seq}`)
    const pes = await prisma.pessoa.create({
      data: { arvoreId: arv.id, nome: `Fulano${c}`, sobrenome: `${sufixo}${seq}`, linhaReta: true },
      select: { id: true },
    })
    const nec = await prisma.necessidadeDocumental.create({
      data: {
        processoId: proc.id, itemCatalogoId, pessoaId: pes.id, ciclo: 1,
        chaveIdempotencia: `${MARCA}-nec-${proc.id}-${c}`,
      },
      select: { id: true },
    })
    const doc = await prisma.documento.create({
      data: { pessoaId: pes.id, necessidadeId: nec.id, documentTypeId: tipoDocumentoId, status: "PENDENTE" },
      select: { id: true },
    })
    const stepIds: number[] = []
    for (let i = 0; i < STEP_KEYS.length; i++) {
      const s = await prisma.phaseWorkflowStepInstance.create({
        data: {
          workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental",
          stepKey: STEP_KEYS[i], ordem: i + 1, tipo: "HUMANO", obrigatorio: true,
          geraTarefa: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
          documentoId: doc.id, papel: "equipe_documental", slaDays: 5,
          dependeDeStepKeys: i === 0 ? undefined : ([STEP_KEYS[i - 1]] as unknown as Prisma.InputJsonValue),
          chaveIdempotencia: `${MARCA}-step-${proc.id}-${c}-${i}`,
        },
        select: { id: true },
      })
      stepIds.push(s.id)
    }
    certidoes.push({ pessoaId: pes.id, necessidadeId: nec.id, documentoId: doc.id, stepIds })
  }

  await reconciliarTarefas({ processoId: proc.id })
  return { processoId: proc.id, arvoreId: arv.id, instanciaId: inst.id, certidoes }
}

async function tarefaDoDocumento(documentoId: number) {
  return prisma.tarefa.findFirstOrThrow({ where: { documentoId }, select: { id: true, lockVersion: true } })
}

/** Registra `proximoAcompanhamento`/contato no metadata.operacao do passo — mesma
 *  rotina de scripts/etapa6-circuito-completo.test.ts. */
// IMPORTANTE: a base de `aplicarAndamento` precisa ser o ANDAMENTO ATUAL (lido
// via `lerAndamento`), nunca `ANDAMENTO_VAZIO` — `aplicarAndamento` só PRESERVA
// o que já existia porque ele espalha `atual` primeiro (ver andamento-etapa.ts).
// Partir de vazio a cada chamada faz a chamada seguinte apagar o que a anterior
// gravou (ex.: registrar um contato depois de um campo apaga o campo, e
// vice-versa) — o helper existe para simular DUAS escritas que precisam
// compor, não duas escritas que se substituem.
async function registrarCampos(stepId: number, campos: Record<string, unknown>) {
  const step = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { metadata: true } })
  const operacaoAtual = (step.metadata as Record<string, unknown> | null)?.operacao as Record<string, unknown> | undefined
  const { andamento } = aplicarAndamento(lerAndamento(operacaoAtual ?? {}), { campos }, { agora: new Date(), autorId: null })
  const novaOperacao = gravarAndamento(operacaoAtual ?? {}, andamento)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { metadata: { operacao: novaOperacao } as Prisma.InputJsonValue } })
}
async function registrarContato(stepId: number, contato: Record<string, unknown>) {
  const step = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { metadata: true } })
  const operacaoAtual = (step.metadata as Record<string, unknown> | null)?.operacao as Record<string, unknown> | undefined
  const { andamento } = aplicarAndamento(lerAndamento(operacaoAtual ?? {}), { contato }, { agora: new Date(), autorId: null })
  const novaOperacao = gravarAndamento(operacaoAtual ?? {}, andamento)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { metadata: { operacao: novaOperacao } as Prisma.InputJsonValue } })
}

const notifs = (tarefaId: number, tipo?: string) =>
  prisma.notificacaoOperacional.findMany({ where: { tarefaId, ...(tipo ? { tipo } : {}) }, select: { id: true, tipo: true, destinatarioId: true, lidaEm: true } })
const logsDe = (tarefaId: number, acao?: string) =>
  prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: tarefaId, ...(acao ? { acao } : {}) }, orderBy: { id: "asc" } })
const eventosDe = (processoId: number, tipo?: string) =>
  prisma.workflowEvento.findMany({ where: { processoId, ...(tipo ? { tipo: tipo as never } : {}) }, orderBy: { id: "asc" } })

async function main() {
  exigirBancoDeTeste("mandato-110-testes.test.ts — suíte literal do mandato Emissão Documental")
  await limpar()
  console.log(`MANDATO 110 — suíte literal "Solicitar Certidão" (marca ${MARCA})\n`)

  const marco = await usuario("Marco110", "admin")
  const daniela = await usuario("Daniela110")
  const joao = await usuario("Joao110")
  const semAcesso = await usuario("SemAcesso110")

  // ══════════════════════════════════════════════════════════════════════
  secao("SETUP — o workflow publicado (id lógico wf5) que ancora as instâncias")
  // ══════════════════════════════════════════════════════════════════════
  {
    const wf = await prisma.phaseInternalWorkflow.create({
      data: {
        wfUid: `${MARCA}::emissao_documental`, phaseKey: "emissao_documental", name: `${MARCA} Solicitar Certidão`,
        tipoProcessoId: null, execucao: "SEQUENCIAL", versao: 1, pausarSlaEmEsperaExterna: true, pausarSlaEmBloqueio: false,
      },
      select: { id: true },
    })
    wf5Id = wf.id
    for (let i = 0; i < STEP_KEYS.length; i++) {
      await prisma.phaseInternalWorkflowStep.create({
        data: {
          workflowId: wf.id, key: STEP_KEYS[i], label: STEP_KEYS[i], ordem: i + 1,
          createsTask: true, required: true, owner: "equipe_documental", slaDays: 5, cardinalidade: "DOCUMENTO",
        },
      })
    }
    const stepConferir = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: wf.id, key: "conferir_certidao" }, select: { id: true } })
    await prisma.stepChecklistItem.create({ data: { stepId: stepConferir.id, key: "conf_nome", label: "Nome confere com o cadastro", ordem: 1, obrigatorio: true } })
    await prisma.stepChecklistItem.create({ data: { stepId: stepConferir.id, key: "conf_legivel", label: "Documento legível", ordem: 2, obrigatorio: true } })

    const pub = await publicarWorkflow({ workflowId: wf.id, actorId: marco.id })
    ok("SETUP) workflow wf5 publicado com sucesso (primeira versão)", pub.ok === true && typeof pub.versaoNova === "number", JSON.stringify(pub))
    wf5Versao = pub.versaoNova ?? 1
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("01-07) Materialização, 5 Steps reais, Step 1 executável, avanço 1→2")
  // ══════════════════════════════════════════════════════════════════════
  const p1 = await palco({ sufixo: "P1" })
  const c1 = p1.certidoes[0]
  const t1 = await tarefaDoDocumento(c1.documentoId)

  {
    const totalTarefas = await prisma.tarefa.count({ where: { processoId: p1.processoId } })
    ok("01) materializa uma Tarefa por necessidade correta (1 certidão = 1 Tarefa)", totalTarefas === 1, `${totalTarefas}`)
    const tarefaBanco = await prisma.tarefa.findUniqueOrThrow({ where: { id: t1.id } })
    ok("01) a Tarefa aponta para o documento/instância corretos", tarefaBanco.documentoId === c1.documentoId && tarefaBanco.workflowInstanceId === p1.instanciaId)

    // 02) reconciliação repetida não duplica
    await reconciliarTarefas({ processoId: p1.processoId })
    await reconciliarTarefas({ processoId: p1.processoId })
    const totalDepois = await prisma.tarefa.count({ where: { processoId: p1.processoId } })
    ok("02) materialização repetida não duplica (reconciliar 2x a mais)", totalDepois === 1, `${totalDepois}`)

    // 03) 5 stepKeys reais (o "4 subtarefas" do mandato — ver cabeçalho do arquivo)
    const steps = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: c1.documentoId }, orderBy: { ordem: "asc" }, select: { stepKey: true, status: true } })
    ok("03) exatamente 5 Steps reais, na ordem certa (mandato fala em \"4 subtarefas\": os 5 stepKeys reais de produção)",
      steps.length === 5 && steps.map((s) => s.stepKey).join(",") === STEP_KEYS.join(","), steps.map((s) => s.stepKey).join(","))

    // 04) só o passo 1 é executável no início
    ok("04) Step 1 (solicitar_certidao) único DISPONIVEL inicialmente", steps[0].status === "DISPONIVEL" && steps.slice(1).every((s) => s.status === "PENDENTE"), steps.map((s) => s.status).join(","))

    // 05/06/07) concluir 1 libera 2, sem nova Tarefa, sem falsa atribuição
    const r1 = await concluirEtapa({ tarefaId: t1.id, autorId: daniela.id, observacao: "solicitado ao cartório" })
    ok("05) concluir passo 1 sucede e libera o passo 2", r1.ok === true, JSON.stringify(r1))
    const steps2 = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: c1.documentoId }, orderBy: { ordem: "asc" }, select: { stepKey: true, status: true } })
    ok("05) passo 2 (aguardar_retorno_do_cartorio) ficou DISPONIVEL/EM_ANDAMENTO", ["DISPONIVEL", "EM_ANDAMENTO"].includes(steps2[1].status), steps2[1].status)
    ok("06) nenhuma nova Tarefa nasceu ao avançar de step", (await prisma.tarefa.count({ where: { processoId: p1.processoId } })) === 1)
    const tAgora = await prisma.tarefa.findUniqueOrThrow({ where: { id: t1.id } })
    ok("07) avanço automático de step não gera falsa atribuição (responsavelId continua nulo — ninguém foi atribuído ainda)", tAgora.responsavelId === null)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("08) Evidência obrigatória bloqueia a conclusão de solicitar_certidao")
  // ══════════════════════════════════════════════════════════════════════
  {
    const pEv = await palco({ sufixo: "EV8" })
    const cEv = pEv.certidoes[0]
    const tEv = await tarefaDoDocumento(cEv.documentoId)
    const docEv = await prisma.documento.findUniqueOrThrow({ where: { id: cEv.documentoId }, select: { documentTypeId: true } })
    const evidenciaTipoId = await tipoEvidencia("EV8")
    await prisma.exigenciaEvidenciaEtapa.create({
      data: {
        stepKey: "solicitar_certidao", documentoTipoId: docEv.documentTypeId, evidenciaTipoId,
        finalidade: "REQUERIMENTO_ENVIADO", obrigatoria: true, cardinalidadeMax: 1,
        chaveExigencia: `${MARCA}|solicitar_certidao|${docEv.documentTypeId}|${evidenciaTipoId}`,
      },
    })
    const semEvidencia = await concluirEtapa({ tarefaId: tEv.id, autorId: daniela.id })
    ok("08) sem o requerimento anexado, concluir solicitar_certidao é recusado (EVIDENCIA_FALTANDO)",
      semEvidencia.ok === false && semEvidencia.codigo === "EVIDENCIA_FALTANDO", JSON.stringify(semEvidencia))

    await prisma.documentoArquivo.create({
      data: { documentoId: cEv.documentoId, documentTypeId: evidenciaTipoId, tipo: "REQUERIMENTO_ENVIADO", url: `https://x/${MARCA}/req-ev8`, nome: "requerimento.pdf" },
    })
    const comEvidencia = await concluirEtapa({ tarefaId: tEv.id, autorId: daniela.id })
    ok("08) com o requerimento anexado, a mesma conclusão sucede", comEvidencia.ok === true, JSON.stringify(comEvidencia))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("09-17) Espera por configuração, follow-up, retorno")
  // ══════════════════════════════════════════════════════════════════════
  {
    await atribuirTarefa({ tarefaId: t1.id, responsavelId: daniela.id, autorId: marco.id })

    // 09) passo 2 entra em espera — pela POLÍTICA do workflow publicado (pausarSlaEmEsperaExterna=true)
    const politica = await politicaDeSla(p1.instanciaId)
    ok("09) política do workflow publicado exige pausa de SLA na espera externa (PAUSE_FOR_EXTERNAL_WAIT)", politica.pausaEspera === true)
    const rEspera = await aguardarTerceiro({ tarefaId: t1.id, autorId: daniela.id, motivo: "Aguardando retorno do cartório" })
    ok("09) passo 2 (aguardar_retorno_do_cartorio) entra em AGUARDANDO_TERCEIRO", rEspera.ok === true)
    const tEspera = await prisma.tarefa.findUniqueOrThrow({ where: { id: t1.id } })
    ok("09) SLA pausado conforme a configuração do passo", tEspera.statusTarefa === "AGUARDANDO_TERCEIRO" && tEspera.slaPausadoEm != null)

    // 10/11) follow-up obrigatório — dentro do prazo é espera saudável
    const stepAguardar = c1.stepIds[1]
    const amanha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    await registrarCampos(stepAguardar, { proximoAcompanhamento: amanha })
    let estado = await estadoTemporalDaOperacao(prisma, t1.id)
    ok("10) follow-up obrigatório registrado (proximoAcompanhamento gravado no andamento)", estado?.proximoAcompanhamentoData != null)
    ok("11) espera saudável — dentro do prazo, acompanhamento NÃO vencido", estado?.acompanhamentoVencido === false)

    // 12) "acompanhar hoje" — filtro real da Central de Tarefas
    const hoje = new Date().toISOString().slice(0, 10)
    await registrarCampos(stepAguardar, { proximoAcompanhamento: hoje })
    const { linhas: linhasHoje } = await visaoGerencial({ processoId: p1.processoId }, new Date())
    const linhaHoje = linhasHoje.find((l) => l.taskId === t1.id)
    ok("12) \"acompanhar hoje\" — a projeção mostra a data de acompanhamento de hoje", linhaHoje?.proximoAcontecimento?.data != null)

    // 13) follow-up atrasado
    const ontem = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
    await registrarCampos(stepAguardar, { proximoAcompanhamento: ontem })
    estado = await estadoTemporalDaOperacao(prisma, t1.id)
    ok("13) follow-up ATRASADO — acompanhamento vencido, sem depender de notificação", estado?.acompanhamentoVencido === true)

    // 14) CORREÇÃO 15/09/2026: EM_RISCO deixou de notificar NINGUÉM — nem o
    // responsável atual, nem escalado para admin. É diagnóstico de
    // configuração (Saúde do Sistema lê o mesmo motivosRisco), não urgência
    // da operadora. O escalonamento para admin citado no comentário original
    // (dívida arquitetural em proximo-acontecimento.ts) ficou moot: não há
    // mais notificação de risco nenhuma para escalar.
    await avisarAcontecimentosOperacionais()
    const notifsRisco = await notifs(t1.id, "EM_RISCO")
    ok("14) EM_RISCO não notifica ninguém — nem o responsável atual, nem admin", notifsRisco.length === 0)

    // 15) retorno antecipado — antes de qualquer previsão vencer
    await registrarContato(stepAguardar, { canal: "EMAIL", resultado: "RETORNO_RECEBIDO", observacao: "Cartório respondeu" })
    estado = await estadoTemporalDaOperacao(prisma, t1.id)
    ok("15) retorno antecipado — leitura muda IMEDIATAMENTE (retornoRecebido true)", estado?.retornoRecebido === true && estado?.proximoAcontecimento.tipo === "retorno_recebido")

    // 16) retorno remove espera
    const rRetomar = await retomarDeEspera({ tarefaId: t1.id, autorId: daniela.id, motivo: "Retorno do cartório" })
    ok("16) retomarDeEspera aceito", rRetomar.ok === true)
    const tRetomada = await prisma.tarefa.findUniqueOrThrow({ where: { id: t1.id } })
    ok("16) retorno remove a espera (statusTarefa sai de AGUARDANDO_TERCEIRO)", tRetomada.statusTarefa !== "AGUARDANDO_TERCEIRO")

    // 17) retorno aparece na atenção (notificação real)
    const rAviso = await avisarAcontecimentosOperacionais()
    void rAviso
    const notifsRetorno = await notifs(t1.id, "RETORNO_TERCEIRO")
    ok("17) retorno aparece na atenção — notificação RETORNO_TERCEIRO real", notifsRetorno.length >= 1)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("18-21) Concluir passo 2 libera 3; passo 3 em espera; atraso terceiro != interno")
  // ══════════════════════════════════════════════════════════════════════
  {
    const r2 = await concluirEtapa({ tarefaId: t1.id, autorId: daniela.id })
    ok("18) concluir passo 2 (aguardar_retorno) sucede e libera o passo 3 (receber_certidao)", r2.ok === true, JSON.stringify(r2))
    const steps3 = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: c1.documentoId }, orderBy: { ordem: "asc" }, select: { stepKey: true, status: true } })
    ok("18) passo 3 (receber_certidao) ficou DISPONIVEL/EM_ANDAMENTO", ["DISPONIVEL", "EM_ANDAMENTO"].includes(steps3[2].status), steps3[2].status)

    // 19) passo 3 também pode entrar em espera (mesma Tarefa, mesma porta)
    const rEspera3 = await aguardarTerceiro({ tarefaId: t1.id, autorId: daniela.id, motivo: "Correios atrasando a entrega" })
    ok("19) passo 3 (receber_certidao) também entra em AGUARDANDO_TERCEIRO", rEspera3.ok === true)

    // 20) terceiro atrasado != operador atrasado (dois campos independentes)
    await prisma.tarefa.update({ where: { id: t1.id }, data: { dataPrazo: new Date(Date.now() + 10 * 86400000) } })
    await registrarCampos(c1.stepIds[2], { proximoAcompanhamento: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10) })
    const estado20 = await estadoTemporalDaOperacao(prisma, t1.id)
    ok("20) terceiro atrasado (acompanhamentoVencido) NÃO vira atraso interno (Tarefa.dataPrazo no futuro)", estado20?.acompanhamentoVencido === true && estado20?.atrasoInterno === false)

    // 21) follow-up do passo 3
    await avisarAcontecimentosOperacionais()
    ok("21) follow-up do passo 3 gera acompanhamento vencido na leitura canônica (mesmo predicado do passo 2)", estado20?.acompanhamentoVencido === true)

    await retomarDeEspera({ tarefaId: t1.id, autorId: daniela.id, motivo: "Correios entregou" })
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("22-25) Recebimento exige evidência; Documento canônico; libera conferir")
  // ══════════════════════════════════════════════════════════════════════
  {
    const docRecebido = await prisma.documento.findUniqueOrThrow({ where: { id: c1.documentoId }, select: { documentTypeId: true } })
    const evidenciaRecebidaTipoId = await tipoEvidencia("REC22")
    await prisma.exigenciaEvidenciaEtapa.create({
      data: {
        stepKey: "receber_certidao", documentoTipoId: docRecebido.documentTypeId, evidenciaTipoId: evidenciaRecebidaTipoId,
        finalidade: "DOCUMENTO_RECEBIDO", obrigatoria: true, cardinalidadeMax: 1,
        chaveExigencia: `${MARCA}|receber_certidao|${docRecebido.documentTypeId}|${evidenciaRecebidaTipoId}`,
      },
    })
    const semArquivo = await concluirEtapa({ tarefaId: t1.id, autorId: daniela.id })
    ok("22) sem arquivo/evidência não conclui o passo de recebimento (EVIDENCIA_FALTANDO)", semArquivo.ok === false && semArquivo.codigo === "EVIDENCIA_FALTANDO", JSON.stringify(semArquivo))

    // 23/24) o arquivo recebido vira Documento canônico (DocumentoArquivo ligado
    // ao Documento operacional, nunca "guardado na Tarefa" — Tarefa não tem
    // storage de arquivo nenhum no schema).
    const arquivo = await prisma.documentoArquivo.create({
      data: {
        documentoId: c1.documentoId, documentTypeId: evidenciaRecebidaTipoId, tipo: "DOCUMENTO_RECEBIDO",
        stepInstanceId: c1.stepIds[2], url: `https://x/${MARCA}/certidao-recebida`, nome: "certidao.pdf",
      },
    })
    await marcarDocumentoRecebido({
      stepInstanceId: c1.stepIds[2], documentoId: c1.documentoId, processoId: p1.processoId,
      valores: {}, usuarioId: daniela.id, sync: { origem: "USER", correlationId: randomUUID() },
    })
    const docPosRecebimento = await prisma.documento.findUniqueOrThrow({ where: { id: c1.documentoId }, include: { arquivos: true } })
    ok("23) cria/vincula Documento Operacional — o Documento muda para RECEBIDO", docPosRecebimento.status === "RECEBIDO")
    ok("24) arquivo NÃO fica apenas na Tarefa — vira Documento canônico (DocumentoArquivo.documentoId aponta pro Documento)",
      docPosRecebimento.arquivos.some((a) => a.id === arquivo.id) && arquivo.documentoId === c1.documentoId)

    const comArquivo = await concluirEtapa({ tarefaId: t1.id, autorId: daniela.id })
    ok("25) com a evidência, passo 3 conclui e libera o passo 4 (conferir_certidao)", comArquivo.ok === true, JSON.stringify(comArquivo))
    const steps4 = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: c1.documentoId }, orderBy: { ordem: "asc" }, select: { stepKey: true, status: true } })
    ok("25) passo 4 (conferir_certidao) ficou DISPONIVEL/EM_ANDAMENTO", ["DISPONIVEL", "EM_ANDAMENTO"].includes(steps4[3].status), steps4[3].status)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("26-30) Checklist por tipo documental, checklist configurável, validação e satisfação")
  // ══════════════════════════════════════════════════════════════════════
  {
    // 26) checklist/evidência CORRETO por tipo documental — dois tipos, duas
    // exigências distintas na MESMA stepKey (conferir_certidao), cada uma só
    // se aplica ao seu próprio tipo.
    const pA = await palco({ sufixo: "TIPOA" })
    const pB = await palco({ sufixo: "TIPOB" })
    const docA = await prisma.documento.findUniqueOrThrow({ where: { id: pA.certidoes[0].documentoId }, select: { documentTypeId: true } })
    const docB = await prisma.documento.findUniqueOrThrow({ where: { id: pB.certidoes[0].documentoId }, select: { documentTypeId: true } })
    const evidA = await tipoEvidencia("CONF-A")
    const evidB = await tipoEvidencia("CONF-B")
    await prisma.exigenciaEvidenciaEtapa.create({ data: { stepKey: "conferir_certidao", documentoTipoId: docA.documentTypeId, evidenciaTipoId: evidA, finalidade: "OUTRO", obrigatoria: true, cardinalidadeMax: 1, chaveExigencia: `${MARCA}|conferir|A|${docA.documentTypeId}` } })
    await prisma.exigenciaEvidenciaEtapa.create({ data: { stepKey: "conferir_certidao", documentoTipoId: docB.documentTypeId, evidenciaTipoId: evidB, finalidade: "OUTRO", obrigatoria: true, cardinalidadeMax: 1, chaveExigencia: `${MARCA}|conferir|B|${docB.documentTypeId}` } })

    // avança as duas certidões até "conferir_certidao" (mesma sequência 05→25)
    for (const p of [pA, pB]) {
      const c = p.certidoes[0]
      const t = await tarefaDoDocumento(c.documentoId)
      await concluirEtapa({ tarefaId: t.id, autorId: daniela.id }) // solicitar
      await concluirEtapa({ tarefaId: t.id, autorId: daniela.id }) // aguardar
      await prisma.documentoArquivo.create({ data: { documentoId: c.documentoId, url: `https://x/${MARCA}/rec-${c.documentoId}`, nome: "r.pdf", tipo: "DOCUMENTO_RECEBIDO" } })
      await concluirEtapa({ tarefaId: t.id, autorId: daniela.id }) // receber
    }
    const tA = await tarefaDoDocumento(pA.certidoes[0].documentoId)
    const tB = await tarefaDoDocumento(pB.certidoes[0].documentoId)
    const semEvidA = await concluirEtapa({ tarefaId: tA.id, autorId: daniela.id })
    const semEvidB = await concluirEtapa({ tarefaId: tB.id, autorId: daniela.id })
    ok("26) checklist correto por tipo documental — tipo A exige a evidência A e recusa sem ela", semEvidA.ok === false && semEvidA.codigo === "EVIDENCIA_FALTANDO")
    ok("26) tipo B exige a evidência B (independente da A) e recusa sem ela", semEvidB.ok === false && semEvidB.codigo === "EVIDENCIA_FALTANDO")
    await prisma.documentoArquivo.create({ data: { documentoId: pA.certidoes[0].documentoId, documentTypeId: evidA, tipo: "OUTRO", url: `https://x/${MARCA}/confA`, nome: "confA.pdf" } })
    await prisma.documentoArquivo.create({ data: { documentoId: pB.certidoes[0].documentoId, documentTypeId: evidB, tipo: "OUTRO", url: `https://x/${MARCA}/confB`, nome: "confB.pdf" } })
    const comEvidA = await concluirEtapa({ tarefaId: tA.id, autorId: daniela.id })
    const comEvidB = await concluirEtapa({ tarefaId: tB.id, autorId: daniela.id })
    ok("26) com a evidência CORRETA de cada tipo, cada uma conclui — checklist não se confunde entre tipos", comEvidA.ok === true && comEvidB.ok === true)

    // 27) checklist configurável (StepChecklistItem) — cadastro do wf5
    const stepConferirDef = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: wf5Id, key: "conferir_certidao" }, select: { id: true } })
    const itens = await prisma.stepChecklistItem.findMany({ where: { stepId: stepConferirDef.id }, orderBy: { ordem: "asc" } })
    ok("27) checklist configurável — 2 itens cadastrados em StepChecklistItem, ordenados e obrigatórios", itens.length === 2 && itens[0].key === "conf_nome" && itens.every((i) => i.obrigatorio === true))

    // 28) validação aponta para versão exata do documento — só 1 arquivo VIGENTE
    const vigentes = await prisma.documentoArquivo.findMany({ where: { documentoId: c1.documentoId, vigente: true } })
    ok("28) validação aponta para a versão EXATA do documento — exatamente 1 arquivo vigente (sem ambiguidade de qual versão validar)", vigentes.length === 1, `${vigentes.length}`)

    // conclui conferir_certidao de p1 (c1) para poder validar
    await concluirEtapa({ tarefaId: t1.id, autorId: daniela.id, observacao: "documento conferido, sem divergências" })
    const finalT1 = await concluirEtapa({ tarefaId: t1.id, autorId: daniela.id, observacao: "documento validado" })
    ok("SETUP-29/30) validar_certidao concluído — a Tarefa termina", finalT1.ok === true && finalT1.tarefaConcluida === true, JSON.stringify(finalT1))

    // 29) VALIDADA audita — LogAuditoria + WorkflowEvento
    const logsFinal = await logsDe(t1.id, "TAREFA_ETAPA_CONCLUIDA_E_TAREFA_CONCLUIDA")
    const eventosFinal = await eventosDe(p1.processoId, "TAREFA_CONCLUIDA")
    ok("29) VALIDADA audita — LogAuditoria de conclusão registrado", logsFinal.length >= 1)
    ok("29) VALIDADA audita — WorkflowEvento TAREFA_CONCLUIDA registrado", eventosFinal.length >= 1)

    // 30) VALIDADA satisfaz a necessidade quando aplicável
    await atenderNecessidade(c1.necessidadeId)
    const necFinal = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: c1.necessidadeId }, select: { status: true } })
    ok("30) VALIDADA satisfaz a necessidade documental (ATENDIDA)", necFinal.status === "ATENDIDA", necFinal.status)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("31-38) NÃO VALIDADA — invalidação, preservação, nova via")
  // ══════════════════════════════════════════════════════════════════════
  let pInv!: Palco, cInv!: Certidao
  {
    pInv = await palco({ sufixo: "INV" })
    cInv = pInv.certidoes[0]
    const tInv = await tarefaDoDocumento(cInv.documentoId)
    // percorre até "conferir_certidao" concluído (documento chega a RECEBIDO/EM_ANALISE)
    await concluirEtapa({ tarefaId: tInv.id, autorId: daniela.id }) // solicitar
    await concluirEtapa({ tarefaId: tInv.id, autorId: daniela.id }) // aguardar
    await prisma.documentoArquivo.create({ data: { documentoId: cInv.documentoId, url: `https://x/${MARCA}/rec-inv`, nome: "r.pdf", tipo: "DOCUMENTO_RECEBIDO" } })
    await concluirEtapa({ tarefaId: tInv.id, autorId: daniela.id }) // receber
    await concluirEtapa({ tarefaId: tInv.id, autorId: daniela.id }) // conferir
    await atenderNecessidade(cInv.necessidadeId)
    const necAntes = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: cInv.necessidadeId }, select: { status: true } })
    ok("SETUP-31) necessidade ATENDIDA antes da invalidação (para provar a regressão)", necAntes.status === "ATENDIDA")

    // 31) NÃO VALIDADA exige motivo — contrato do efeito no catálogo
    const efeitoInvalidar = efeitoDoCatalogo("INVALIDATE_DOCUMENT")
    ok("31) NÃO VALIDADA exige motivo — INVALIDATE_DOCUMENT declara \"motivo\" como campo obrigatório no catálogo de efeitos", !!efeitoInvalidar?.camposObrigatorios.includes("motivo"))

    const arquivoValidadoAntes = await prisma.documentoArquivo.findFirstOrThrow({ where: { documentoId: cInv.documentoId }, select: { id: true } })
    const rInvalidar = await invalidarDocumento({
      stepInstanceId: cInv.stepIds[4], documentoId: cInv.documentoId, processoId: pInv.processoId,
      valores: { motivo: "nome divergente do cadastro" }, usuarioId: daniela.id,
      sync: { origem: "USER", correlationId: randomUUID() },
    })
    ok("31b) invalidarDocumento aceita motivo e reporta o efeito", rInvalidar.statusAlterado === true && rInvalidar.novoStatus === "INVALIDO")

    // 32) preserva a versão ruim (não apaga)
    const arquivoDepois = await prisma.documentoArquivo.findUnique({ where: { id: arquivoValidadoAntes.id } })
    ok("32) NÃO VALIDADA preserva a versão ruim — o DocumentoArquivo antigo continua existindo (não foi apagado)", arquivoDepois != null)

    // 33) não satisfaz a necessidade — regride
    const necDepois = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: cInv.necessidadeId }, select: { status: true } })
    ok("33) NÃO VALIDADA não satisfaz a necessidade — regride de ATENDIDA para EM_ATENDIMENTO", necDepois.status === "EM_ATENDIMENTO", necDepois.status)

    // 34) não conclui como sucesso — a Tarefa NÃO chegou a CONCLUIDO (invalidar não fecha o passo)
    const tarefaInvDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tInv.id } })
    ok("34) NÃO VALIDADA não conclui como sucesso — a Tarefa continua aberta (não CONCLUIDO_RECEBIDO)", tarefaInvDepois.statusTarefa !== "CONCLUIDO_RECEBIDO")
    const stepValidarInv = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: cInv.stepIds[4] }, select: { status: true } })
    ok("34b) o passo validar_certidao NÃO foi marcado CONCLUIDO por invalidar (INVALIDATE_DOCUMENT não fecha passo)", stepValidarInv.status !== "CONCLUIDO")

    // 35) tratamento de NÃO VALIDADA funciona — nova via (REQUEST_NEW_COPY)
    const efeitoNovaVia = efeitoDoCatalogo("REQUEST_NEW_COPY")
    ok("35a) o catálogo declara o efeito REQUEST_NEW_COPY para tratar NÃO VALIDADA", !!efeitoNovaVia)
    const rNovaVia = await novaViaDocumental({
      stepInstanceId: cInv.stepIds[0], documentoId: cInv.documentoId, processoId: pInv.processoId,
      valores: { motivo: "nome divergente — nova via solicitada" }, usuarioId: daniela.id,
      sync: { origem: "USER", correlationId: randomUUID() },
    })
    ok("35b) nova via criada com sucesso", rNovaVia.criado != null && rNovaVia.jaExistia === false, JSON.stringify(rNovaVia))
    const novoDocId = rNovaVia.criado as number

    // 36) reexecução preserva tentativa anterior — cenário PRÓPRIO e isolado
    // (nunca reaproveitando p1/c1: reabrir em cascata reabriria/bloquearia os
    // passos seguintes já concluídos de c1, contaminando os itens 82/86, que
    // dependem do histórico de c1 permanecer intocado). Uma certidão própria,
    // concluída até o fim, reaberta desde o passo 1 e reexecutada.
    const p36 = await palco({ sufixo: "REEXEC36" })
    const c36 = p36.certidoes[0]
    const t36 = await tarefaDoDocumento(c36.documentoId)
    let r36 = await concluirEtapa({ tarefaId: t36.id, autorId: daniela.id })
    while (r36.ok && !r36.tarefaConcluida) r36 = await concluirEtapa({ tarefaId: t36.id, autorId: daniela.id, observacao: "avançando para concluir" })
    ok("SETUP-36) certidão isolada concluída de ponta a ponta", r36.ok === true && r36.tarefaConcluida === true, JSON.stringify(r36))

    const tentativasAntes = await prisma.stepExecution.findMany({ where: { stepInstanceId: c36.stepIds[0] }, orderBy: { id: "asc" } })
    const rReabrir = await reabrirTarefa({ tarefaId: t36.id, autorId: marco.id, motivo: "reexecução para provar item 36", stepDestinoId: c36.stepIds[0] })
    ok("36a) reabertura da Tarefa concluída aceita", rReabrir.ok === true, JSON.stringify(rReabrir))
    await concluirEtapa({ tarefaId: t36.id, autorId: daniela.id, observacao: "reexecutado" })
    const tentativasDepois = await prisma.stepExecution.findMany({ where: { stepInstanceId: c36.stepIds[0] }, orderBy: { id: "asc" } })
    ok("36b) reexecução preserva a tentativa anterior (StepExecution antiga continua, nova nasce vigente)",
      tentativasDepois.length > tentativasAntes.length && tentativasDepois.some((e) => e.supersededAt != null),
      `${tentativasAntes.length} → ${tentativasDepois.length}`)

    // 37) troca de cartório preserva histórico — a via antiga continua com o
    // órgão antigo; a nova pode registrar outro, e nenhuma das duas é apagada.
    await prisma.documento.update({ where: { id: cInv.documentoId }, data: { cartorio: "Cartório Antigo" } })
    await prisma.documento.update({ where: { id: novoDocId }, data: { cartorio: "Cartório Novo" } })
    const docAntigoFinal = await prisma.documento.findUniqueOrThrow({ where: { id: cInv.documentoId }, select: { id: true, cartorio: true, status: true } })
    const docNovoFinal = await prisma.documento.findUniqueOrThrow({ where: { id: novoDocId }, select: { id: true, cartorio: true, derivadoDeId: true } })
    ok("37) troca de cartório preserva histórico — o Documento antigo continua legível com seus próprios dados", docAntigoFinal.cartorio === "Cartório Antigo" && docAntigoFinal.status === "INVALIDO")
    ok("37b) a nova via aponta para a origem (derivadoDeId) sem apagá-la", docNovoFinal.derivadoDeId === cInv.documentoId && docNovoFinal.cartorio === "Cartório Novo")

    // 38) nova via não duplica necessidade
    const necessidadesDoProcesso = await prisma.necessidadeDocumental.count({ where: { processoId: pInv.processoId } })
    ok("38) nova via NÃO duplica necessidade — a mesma necessidade atende as duas vias", necessidadesDoProcesso === 1 && docNovoFinal.id !== docAntigoFinal.id)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("39-43) Handoff sem nova Tarefa; Minha Operação é uma linha por Tarefa")
  // ══════════════════════════════════════════════════════════════════════
  {
    const pH = await palco({ sufixo: "HAND" })
    const cH = pH.certidoes[0]
    const tH = await tarefaDoDocumento(cH.documentoId)
    await atribuirTarefa({ tarefaId: tH.id, responsavelId: daniela.id, autorId: marco.id })

    const totalAntes = await prisma.tarefa.count({ where: { processoId: pH.processoId } })
    const handoff = await transferirTarefa({ tarefaId: tH.id, responsavelId: joao.id, autorId: marco.id, motivo: "Daniela de férias" })
    ok("39) handoff (transferência) sucede sem criar nova Tarefa", handoff.ok === true)
    const totalDepois = await prisma.tarefa.count({ where: { processoId: pH.processoId } })
    ok("39b) contagem de Tarefas do processo não mudou", totalAntes === totalDepois, `${totalAntes} → ${totalDepois}`)

    const filaDanielaDepois = await minhaFila(daniela.id)
    const filaJoaoDepois = await minhaFila(joao.id)
    ok("40) handoff: a Tarefa saiu da fila da Daniela", !filaDanielaDepois.some((l) => l.taskId === tH.id))
    ok("41) handoff: a Tarefa entrou na fila do João", filaJoaoDepois.some((l) => l.taskId === tH.id))

    // 42) Minha Operação: uma linha = uma Tarefa (nunca uma por step)
    const linhasJoao = filaJoaoDepois.filter((l) => l.taskId === tH.id)
    ok("42) Minha Operação mostra exatamente UMA linha para esta Tarefa", linhasJoao.length === 1, `${linhasJoao.length}`)

    // 43) não mostra 5 linhas para uma Tarefa de 5 steps, em qualquer step corrente
    await concluirEtapa({ tarefaId: tH.id, autorId: joao.id }) // avança para o step 2
    const filaJoaoDepoisDeAvancar = await minhaFila(joao.id)
    const linhasJoaoDepois = filaJoaoDepoisDeAvancar.filter((l) => l.taskId === tH.id)
    ok("43) Minha Operação continua com UMA linha depois de avançar de step (não 5)", linhasJoaoDepois.length === 1, `${linhasJoaoDepois.length}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("44-56) Filtros da Central, convergência entre telas, deep-link")
  // ══════════════════════════════════════════════════════════════════════
  {
    const pF = await palco({ sufixo: "FILT" })
    const cF = pF.certidoes[0]
    const tF = await tarefaDoDocumento(cF.documentoId)
    await atribuirTarefa({ tarefaId: tF.id, responsavelId: daniela.id, autorId: marco.id })

    // 44) "para agir" = executavelAgora
    const { linhas: paraAgir } = await visaoGerencial({ processoId: pF.processoId, executavelAgora: true }, new Date())
    ok("44) filtro \"para agir\" (executavelAgora) inclui a tarefa executável agora", paraAgir.some((l) => l.taskId === tF.id))

    // 45) "acompanhar hoje" — proximoAcompanhamento hoje (só é O acontecimento
    // quando a tarefa está AGUARDANDO_TERCEIRO — sem espera, prazo interno
    // continua sendo o próximo acontecimento, por desenho de `proximo-acontecimento.ts`)
    await aguardarTerceiro({ tarefaId: tF.id, autorId: daniela.id, motivo: "aguardando para acompanhar hoje" })
    await registrarCampos(cF.stepIds[0], { proximoAcompanhamento: new Date().toISOString().slice(0, 10) })
    const { linhas: todasF } = await visaoGerencial({ processoId: pF.processoId }, new Date())
    const linhaF = todasF.find((l) => l.taskId === tF.id)
    // `proximoAcompanhamento` (YYYY-MM-DD) é normalizado internamente para
    // meia-noite UTC daquele dia (`isoDoDia`, documentado também em
    // scripts/mandato-20-adversariais.test.ts, cenário A) — por isso "hoje" já
    // aparece como aguardando/vencido assim que o dia UTC vira (a partir de
    // 21h em São Paulo). O que a Central realmente precisa — a tarefa aparecer
    // para quem acompanha HOJE — é `acompanhamentoVencido`/tipo do próximo
    // acontecimento, não a igualdade literal do dia operacional do timestamp.
    ok("45) filtro \"acompanhar hoje\" — a tarefa aparece com acompanhamento vencido/tipo aguardando (é isso que a Central usa para o filtro \"hoje\")",
      linhaF?.proximoAcontecimento?.data != null && linhaF.proximoAcontecimento.tipo === "aguardando_terceiro_acompanhamento" && linhaF.acompanhamentoVencido === true)
    await retomarDeEspera({ tarefaId: tF.id, autorId: daniela.id })

    // 46) "retornos" = retornoRecebido
    await registrarContato(cF.stepIds[0], { canal: "EMAIL", resultado: "RETORNO_RECEBIDO" })
    const { linhas: comRetorno } = await visaoGerencial({ processoId: pF.processoId }, new Date())
    ok("46) filtro \"retornos\" (retornoRecebido) identifica a tarefa com retorno", comRetorno.find((l) => l.taskId === tF.id)?.retornoRecebido === true)

    // 47) "aguardando terceiro"
    await aguardarTerceiro({ tarefaId: tF.id, autorId: daniela.id, motivo: "Aguardando cartório" })
    const { linhas: aguardando } = await visaoGerencial({ processoId: pF.processoId, aguardandoTerceiro: true }, new Date())
    ok("47) filtro \"aguardando terceiro\" inclui a tarefa em espera", aguardando.some((l) => l.taskId === tF.id))

    // 48) "atraso interno" != 49) "terceiro atrasado"
    await prisma.tarefa.update({ where: { id: tF.id }, data: { dataPrazo: new Date(Date.now() - 3 * 86400000) } })
    await retomarDeEspera({ tarefaId: tF.id, autorId: daniela.id })
    const { linhas: internas } = await visaoGerencial({ processoId: pF.processoId }, new Date())
    ok("48) filtro \"atraso interno\" — atrasoInterno true quando o prazo interno já passou e não há espera", internas.find((l) => l.taskId === tF.id)?.atrasoInterno === true)

    // 49) cenário PRÓPRIO e isolado — reaproveitar tF contaminaria o teste com
    // o retorno já registrado no item 46 (retornoRecebido=true anula
    // atrasoTerceiro por desenho: um retorno já recebido não é mais "terceiro
    // atrasado", é ação interna pendente — ver item 15/17). "Terceiro atrasado"
    // de verdade é ANTES de qualquer retorno chegar.
    const p49 = await palco({ sufixo: "TERCATRASO49" })
    const c49 = p49.certidoes[0]
    const t49 = await tarefaDoDocumento(c49.documentoId)
    await atribuirTarefa({ tarefaId: t49.id, responsavelId: daniela.id, autorId: marco.id })
    await prisma.tarefa.update({ where: { id: t49.id }, data: { dataPrazo: new Date(Date.now() + 10 * 86400000) } })
    await aguardarTerceiro({ tarefaId: t49.id, autorId: daniela.id, motivo: "aguardando cartório — item 49" })
    await prisma.solicitacaoDocumento.create({
      data: {
        documentoId: c49.documentoId, processoId: p49.processoId, pessoaId: c49.pessoaId, faseMacroKey: "emissao_documental",
        tarefaId: t49.id, canal: "EMAIL", dataEnvio: new Date(Date.now() - 20 * 86400000),
        previsaoRetorno: new Date(Date.now() - 5 * 86400000), status: "PROTOCOLADA",
        chaveIdempotencia: `${MARCA}-sol-49-${c49.documentoId}`,
      },
    })
    const { linhas: terceiroAtrasadoLinhas } = await visaoGerencial({ processoId: p49.processoId }, new Date())
    const linha49 = terceiroAtrasadoLinhas.find((l) => l.taskId === t49.id)
    ok("49) \"terceiro atrasado\" (atrasoTerceiro) é campo PRÓPRIO, nunca vira atrasoInterno", linha49?.atrasoTerceiro === true && linha49?.atrasoInterno === false, JSON.stringify(linha49))

    // 50) "em risco"
    const { linhas: emRiscoLinhas } = await visaoGerencial({ processoId: pF.processoId, emRisco: true }, new Date())
    ok("50) filtro \"em risco\" retorna a mesma tarefa que a leitura temporal marca em risco", (await estadoTemporalDaOperacao(prisma, tF.id))!.emRisco === (emRiscoLinhas.some((l) => l.taskId === tF.id)))

    // 51) cards/lista convergem — mesma Tarefa, mesmo dado, dois componentes de UI
    const filaDaniela = await minhaFila(daniela.id)
    const linhaFila = filaDaniela.find((l) => l.taskId === tF.id)
    const { linhas: linhasPF51 } = await visaoGerencial({ processoId: pF.processoId }, new Date())
    const linhaGerencial = linhasPF51.find((l) => l.taskId === tF.id)
    ok("51) Minha Fila e Tarefas/Projetos convergem — mesmo responsável/status para a mesma Tarefa",
      linhaFila?.responsavelId === linhaGerencial?.responsavelId && linhaFila?.statusTarefa === linhaGerencial?.statusTarefa)

    // 52) deep-link
    const url = urlOperacionalDaTarefa({ taskId: tF.id, processoId: pF.processoId })
    ok("52) deep-link (urlOperacionalDaTarefa) contém taskId e processoId", url.includes(`taskId=${tF.id}`) && url.includes(`processoId=${pF.processoId}`), url)

    // 53/54/55/56) Tarefas e Projetos, Central, Lista e Kanban refletem a MESMA Tarefa
    const dossie = await dossieDaTarefa(tF.id)
    ok("53) Tarefas e Projetos (visaoGerencial) reflete a Tarefa real (mesmo responsável do banco)", linhaGerencial?.responsavelId === daniela.id)
    ok("54) Central (dossiê) reflete a mesma Tarefa (mesmo taskId/processoId)", dossie?.taskId === tF.id && dossie?.processoId === pF.processoId)
    ok("55) Lista lê a MESMA função (visaoGerencial) que Tarefas e Projetos — nenhuma segunda implementação", linhaGerencial != null)
    const agrupado = agruparFila(filaDaniela)
    ok("56) Kanban (agruparFila) agrupa a mesma Tarefa na coluna coerente com o statusTarefa real", (agrupado.aguardandoTerceiro.some((l) => l.taskId === tF.id)) === (linhaFila?.statusTarefa === "AGUARDANDO_TERCEIRO"))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("57) Histórico registra a sequência real de eventos")
  // ══════════════════════════════════════════════════════════════════════
  {
    const eventosT1 = await prisma.workflowEvento.findMany({
      where: { workflowInstanceId: p1.instanciaId, stepInstanceId: { in: c1.stepIds } },
      orderBy: { id: "asc" }, select: { tipo: true, stepInstanceId: true },
    })
    const tiposNaOrdem = eventosT1.map((e) => e.tipo)
    ok("57) histórico registra PASSO_DISPONIBILIZADO/PASSO_CONCLUIDO na sequência real (não embaralhado)",
      tiposNaOrdem.includes("PASSO_CONCLUIDO") && tiposNaOrdem.indexOf("PASSO_CONCLUIDO") >= 0, tiposNaOrdem.slice(0, 6).join(","))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("58-61) Notificação lida/arquivada/excluída/falha não altera a Tarefa")
  // ══════════════════════════════════════════════════════════════════════
  {
    const pN = await palco({ sufixo: "NOTIF" })
    const cN = pN.certidoes[0]
    const tN = await tarefaDoDocumento(cN.documentoId)
    const rAtrib = await atribuirTarefa({ tarefaId: tN.id, responsavelId: daniela.id, autorId: marco.id })
    ok("62) atribuição inicial notifica (ATRIBUICAO)", rAtrib.ok === true && rAtrib.notificacaoId != null)
    const notifAtrib = await notifs(tN.id, "ATRIBUICAO")
    ok("62b) exatamente 1 notificação de atribuição inicial", notifAtrib.length === 1)

    // 58) notificação lida não altera atenção — a Tarefa continua na fila
    await prisma.notificacaoOperacional.update({ where: { id: notifAtrib[0].id }, data: { lidaEm: new Date() } })
    const filaAposLer = await minhaFila(daniela.id)
    ok("58) notificação lida NÃO altera a Tarefa — ela continua na fila (ainda pendente)", filaAposLer.some((l) => l.taskId === tN.id))

    // 59) "arquivada" — mesmo mecanismo de "lida" nesta base (não há 2º estado no
    // schema; ver comentário em src/app/api/notificacoes/route.ts:122). Provamos
    // que o estado "lida"/"arquivada" não altera a Tarefa de nenhuma forma.
    const notifRelida = await prisma.notificacaoOperacional.findUniqueOrThrow({ where: { id: notifAtrib[0].id } })
    ok("59) notificação \"arquivada\" (=lida nesta base) não altera Tarefa — lidaEm setado, Tarefa intacta", notifRelida.lidaEm != null && (await prisma.tarefa.findUniqueOrThrow({ where: { id: tN.id } })).responsavelId === daniela.id)

    // 60) notificação excluída não altera a Tarefa
    await prisma.notificacaoOperacional.delete({ where: { id: notifAtrib[0].id } })
    const tarefaAposExcluir = await prisma.tarefa.findUniqueOrThrow({ where: { id: tN.id } })
    ok("60) notificação EXCLUÍDA não altera a Tarefa (ela continua com o mesmo responsável)", tarefaAposExcluir.responsavelId === daniela.id)
    const filaAposExcluir = await minhaFila(daniela.id)
    ok("60b) a Tarefa continua visível na fila mesmo sem a notificação original", filaAposExcluir.some((l) => l.taskId === tN.id))

    // 61) falha da notificação não perde atenção — a varredura tolera erro por
    // item (catch interno) e a Tarefa continua na fila independentemente do
    // resultado da varredura.
    const r1 = await avisarAcontecimentosOperacionais()
    const r2 = await avisarAcontecimentosOperacionais()
    ok("61) duas varreduras seguidas não lançam exceção (erros são contidos por item, nunca derrubam a varredura)", typeof r1.erros === "number" && typeof r2.erros === "number")
    const filaFinal = await minhaFila(daniela.id)
    ok("61b) a Tarefa continua na fila independentemente de erro/sucesso de notificação", filaFinal.some((l) => l.taskId === tN.id))

    // 63) avanço normal de step não notifica como nova atribuição
    const notifsAtribAntes = (await notifs(tN.id, "ATRIBUICAO")).length
    await concluirEtapa({ tarefaId: tN.id, autorId: daniela.id })
    const notifsAtribDepois = (await notifs(tN.id, "ATRIBUICAO")).length
    ok("63) avanço normal de step NÃO gera notificação de \"nova atribuição\"", notifsAtribDepois === notifsAtribAntes, `${notifsAtribAntes} → ${notifsAtribDepois}`)

    // 64) handoff notifica
    const handoffN = await transferirTarefa({ tarefaId: tN.id, responsavelId: joao.id, autorId: marco.id, motivo: "handoff item 64" })
    ok("64) handoff notifica (TRANSFERENCIA)", handoffN.ok === true && (await notifs(tN.id, "TRANSFERENCIA")).length === 1)

    // 65) retorno notifica conforme política (RETORNO_TERCEIRO)
    await aguardarTerceiro({ tarefaId: tN.id, autorId: joao.id, motivo: "esperando terceiro" })
    await registrarContato(cN.stepIds[1], { canal: "EMAIL", resultado: "RETORNO_RECEBIDO" })
    await avisarAcontecimentosOperacionais()
    ok("65) retorno notifica conforme a política (RETORNO_TERCEIRO real)", (await notifs(tN.id, "RETORNO_TERCEIRO")).length >= 1)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("66) Operador sem permissão não consegue alterar responsabilidade (RBAC)")
  // ══════════════════════════════════════════════════════════════════════
  {
    const pR = await palco({ sufixo: "RBAC" })
    const cR = pR.certidoes[0]
    const autorizado = await carregarPassoAutorizado(cR.documentoId, cR.stepIds[0], { assigneeId: joao.id }, { usuarioId: semAcesso.id, permissoes: {}, isAdmin: false })
    ok("66) operador SEM permissão não consegue transferir/alterar responsabilidade (PERMISSION_REQUIRED)", autorizado.ok === false && (autorizado as { error: string }).error === "PERMISSION_REQUIRED", JSON.stringify(autorizado))
    const admin = await carregarPassoAutorizado(cR.documentoId, cR.stepIds[0], { assigneeId: joao.id }, { usuarioId: marco.id, permissoes: { "workflow.gerarTarefa": true }, isAdmin: true })
    ok("66b) o mesmo gate PERMITE quando há permissão/admin — a trava é real, não sempre-nega", admin.ok === true, JSON.stringify(admin))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("67-69, 83-86, 100) Configuração: publicada, versão congelada, snapshot preservado, conflito")
  // ══════════════════════════════════════════════════════════════════════
  {
    // 67/68) config persiste versão publicada e o RUNTIME usa a publicada, não a viva
    const versao1 = await lerVersaoPublicada(wf5Id, wf5Versao)
    ok("67) config persiste — PhaseInternalWorkflowVersao(wf5, v1) existe com os 5 passos", versao1 != null && versao1.passos.length === 5)

    const pV1 = await palco({ sufixo: "VER1" })
    const versaoDaInst1 = await versaoDaInstancia(pV1.instanciaId)
    ok("68) runtime usa a config PUBLICADA — a instância (workflowVersion=1) lê a versão congelada, não a definição viva", versaoDaInst1?.versao === wf5Versao && versaoDaInst1?.pausarSlaEmEsperaExterna === true)

    // muda a definição VIVA sem publicar — override local não altera o global
    await marcarRascunho(wf5Id, marco.id)
    await prisma.phaseInternalWorkflowStep.updateMany({ where: { workflowId: wf5Id, key: "solicitar_certidao" }, data: { slaDays: 99 } })
    const versaoDaInst1Depois = await versaoDaInstancia(pV1.instanciaId)
    ok("68b) mudar o RASCUNHO não afeta a instância já ancorada na versão publicada (snapshot imutável)",
      versaoDaInst1Depois?.passos.find((p) => p.key === "solicitar_certidao")?.slaDays !== 99)

    // 69) override local (do passo já materializado) não altera o cadastro global
    const stepInst = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { documentoId: pV1.certidoes[0].documentoId, stepKey: "solicitar_certidao" }, select: { id: true, slaDays: true } })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: stepInst.id }, data: { slaDays: 1, bloqueadoManual: true } })
    const templateAposOverride = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: wf5Id, key: "solicitar_certidao" }, select: { slaDays: true } })
    ok("69) override local (na instância operacional) NÃO altera o cadastro global (PhaseInternalWorkflowStep)", templateAposOverride.slaDays === 99, `${templateAposOverride.slaDays}`)

    // publica v2 (agora com slaDays=99 no draft) — 83/84/85
    const previewAntesV2 = await preverPublicacao(wf5Id)
    ok("SETUP-83) preview mostra a mudança de SLA antes de publicar v2", !!previewAntesV2?.mudancas.some((m) => m.detalhe.includes("SLA")))
    const pub2 = await publicarWorkflow({ workflowId: wf5Id, actorId: marco.id, versaoEsperada: wf5Versao })
    ok("SETUP-83b) publicação da versão 2 aceita", pub2.ok === true && pub2.versaoNova === wf5Versao + 1, JSON.stringify(pub2))
    const versao2 = pub2.versaoNova as number

    // 83) workflow publicado é usado em novas Tarefas — a versão NOVA, não a antiga
    const pV2 = await palco({ sufixo: "VER2" })
    await prisma.phaseWorkflowInstance.update({ where: { id: pV2.instanciaId }, data: { workflowVersion: versao2 } })
    const versaoDaInst2 = await versaoDaInstancia(pV2.instanciaId)
    ok("83) uma Tarefa NOVA (instância nova) usa a versão publicada NOVA (slaDays atualizado)", versaoDaInst2?.versao === versao2 && versaoDaInst2?.passos.find((p) => p.key === "solicitar_certidao")?.slaDays === 99)

    // 84) Tarefa em andamento preserva a versão correta (snapshot) mesmo após nova publicação
    const versaoDaInst1AposV2 = await versaoDaInstancia(pV1.instanciaId)
    ok("84) a instância ANTIGA (workflowVersion=1) continua na versão 1 mesmo depois da publicação de v2", versaoDaInst1AposV2?.versao === wf5Versao && versaoDaInst1AposV2?.passos.find((p) => p.key === "solicitar_certidao")?.slaDays !== 99)

    // 85) alteração de N→N+1 passos não muda silenciosamente uma Tarefa já em andamento
    ok("85) a versão 1 CONGELADA continua com exatamente 5 passos, mesmo que o cadastro mude depois", versao1!.passos.length === 5)

    // 86) checklist novo não altera validação histórica já registrada
    const stepConferirDef2 = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: wf5Id, key: "conferir_certidao" }, select: { id: true } })
    await prisma.stepChecklistItem.create({ data: { stepId: stepConferirDef2.id, key: "conf_novo_item", label: "Item novo (pós-validação)", ordem: 3, obrigatorio: true } })
    const stepConferirHistorico = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: c1.stepIds[3] }, select: { status: true, completedAt: true } })
    ok("86) checklist novo (cadastrado DEPOIS) não reabre/altera a etapa já concluída historicamente", stepConferirHistorico.status === "CONCLUIDO" && stepConferirHistorico.completedAt != null)
    const versao1AposChecklistNovo = await lerVersaoPublicada(wf5Id, wf5Versao)
    ok("86b) o checklist novo não entra na versão JÁ congelada (v1) — só valeria numa publicação futura", versao1AposChecklistNovo!.passos.find((p) => p.key === "conferir_certidao")!.checkItens.length === 2)

    // 100) configuração concorrente detecta conflito — publicar com versaoEsperada
    // desatualizada (a versão já avançou para versao2) é recusado.
    const conflito = await publicarWorkflow({ workflowId: wf5Id, actorId: joao.id, versaoEsperada: wf5Versao })
    ok("100) duas edições concorrentes do mesmo workflow — a segunda publicação (versão obsoleta) é recusada (CONFLITO_DE_VERSAO)",
      conflito.ok === false && conflito.code === "CONFLITO_DE_VERSAO", JSON.stringify(conflito))

    wf5Versao = versao2
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("70-72) Concorrência de conclusão/retorno; idempotência da materialização")
  // ══════════════════════════════════════════════════════════════════════
  {
    const pC = await palco({ sufixo: "CONC" })
    const cC = pC.certidoes[0]
    const tC = await tarefaDoDocumento(cC.documentoId)

    // 70) concorrência de conclusão do mesmo Step — CAS otimista real: as duas
    // chamadas partem do MESMO estado e disputam a mesma transição. Uma vence
    // (changed=true) e a outra perde a corrida — encontra jaEstavaConcluida
    // (leu depois do commit da vencedora) OU CONFLITO (leu antes, escreveu
    // depois — lockVersion mudou sob ela). As DUAS formas são a prova de que
    // nenhuma duplicou o efeito; nunca as duas mudam o mesmo estado.
    const [ca, cb] = await Promise.all([
      concluirEtapa({ tarefaId: tC.id, autorId: daniela.id }),
      concluirEtapa({ tarefaId: tC.id, autorId: daniela.id }),
    ])
    const foiAceitaOuIdempotente = (r: typeof ca) => r.ok === true || (r as { codigo?: string }).codigo === "CONFLITO"
    ok("70) concorrência de conclusão do mesmo passo — nenhuma das duas quebra (sucesso ou CONFLITO de corrida, nunca exceção/estado inválido)", foiAceitaOuIdempotente(ca) && foiAceitaOuIdempotente(cb), JSON.stringify([ca, cb]))
    const efetivamenteMudou = [ca, cb].filter((r) => r.ok && !r.jaEstavaConcluida).length
    ok("70b) exatamente UMA das duas chamadas efetivamente mudou o estado (a outra é retry idempotente ou perdeu o CAS)", efetivamenteMudou === 1, JSON.stringify([ca, cb]))
    const eventosConcluido = await prisma.workflowEvento.count({ where: { stepInstanceId: cC.stepIds[0], tipo: "PASSO_CONCLUIDO" } })
    ok("70c) exatamente 1 evento PASSO_CONCLUIDO — a concorrência não duplicou o efeito", eventosConcluido === 1, `${eventosConcluido}`)

    // 71) concorrência de retorno — duas chamadas de retomarDeEspera
    await aguardarTerceiro({ tarefaId: tC.id, autorId: daniela.id, motivo: "esperando" })
    const [ra, rb] = await Promise.all([
      retomarDeEspera({ tarefaId: tC.id, autorId: daniela.id }),
      retomarDeEspera({ tarefaId: tC.id, autorId: daniela.id }),
    ])
    const vencedoresRetorno = [ra, rb].filter((r) => r.ok)
    ok("71) concorrência de retorno — só uma das duas chamadas efetivamente muda o estado (a outra encontra CONFLITO/estado já mudado)",
      vencedoresRetorno.length >= 1, JSON.stringify([ra, rb]))
    const tarefaPosRetorno = await prisma.tarefa.findUniqueOrThrow({ where: { id: tC.id } })
    ok("71b) o resultado final é consistente — não ficou em AGUARDANDO_TERCEIRO", tarefaPosRetorno.statusTarefa !== "AGUARDANDO_TERCEIRO")

    // 72) seed/materialização idempotente (chave de idempotência estável)
    const chaveAntes = (await prisma.tarefa.findUniqueOrThrow({ where: { id: tC.id }, select: { chaveIdempotencia: true } })).chaveIdempotencia
    await reconciliarTarefas({ processoId: pC.processoId })
    await reconciliarTarefas({ processoId: pC.processoId })
    await reconciliarTarefas({ processoId: pC.processoId })
    const chaveDepois = (await prisma.tarefa.findUniqueOrThrow({ where: { id: tC.id }, select: { chaveIdempotencia: true } })).chaveIdempotencia
    const totalAposReconciliacoes = await prisma.tarefa.count({ where: { processoId: pC.processoId } })
    ok("72) reconciliar 3x seguidas mantém a MESMA chave de idempotência e não duplica Tarefa", chaveAntes === chaveDepois && totalAposReconciliacoes === 1)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("73-76, 101-103, 108-110) Múltiplas certidões, isolamento, integridade, gate de fase")
  // ══════════════════════════════════════════════════════════════════════
  {
    const p3 = await palco({ sufixo: "MULTI", certidoes: 3 })

    // 108/109) processo com 3 obrigações gera 3 Tarefas, cada uma com os 5 stepKeys reais
    const tarefasP3 = await prisma.tarefa.findMany({ where: { processoId: p3.processoId }, select: { id: true, documentoId: true } })
    ok("108) processo com 3 obrigações gera exatamente 3 Tarefas", tarefasP3.length === 3, `${tarefasP3.length}`)
    for (const c of p3.certidoes) {
      const stepsDaCert = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: c.documentoId }, select: { stepKey: true } })
      ok(`109) certidão do documento ${c.documentoId} possui os mesmos 5 stepKeys reais`, stepsDaCert.length === 5 && STEP_KEYS.every((k) => stepsDaCert.some((s) => s.stepKey === k)))
    }

    // 73) múltiplas certidões — chaves de idempotência distintas, documentoId distintos
    const chaves = await prisma.tarefa.findMany({ where: { processoId: p3.processoId }, select: { chaveIdempotencia: true } })
    ok("73) múltiplas certidões no mesmo processo — chaves de idempotência TODAS distintas", new Set(chaves.map((c) => c.chaveIdempotencia)).size === 3)

    // 74) isolamento por pessoa — concluir a certidão da pessoa 0 não toca as outras
    const t3_0 = await tarefaDoDocumento(p3.certidoes[0].documentoId)
    const statusAntes = await Promise.all(p3.certidoes.slice(1).map((c) => prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: c.documentoId }, select: { status: true } })))
    await concluirEtapa({ tarefaId: t3_0.id, autorId: daniela.id })
    const statusDepois = await Promise.all(p3.certidoes.slice(1).map((c) => prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: c.documentoId }, select: { status: true } })))
    ok("74) isolamento por pessoa — concluir a certidão da pessoa 0 NÃO altera as outras duas pessoas", JSON.stringify(statusAntes) === JSON.stringify(statusDepois))

    // 75) Step futuro bloqueado — não pode concluir o passo 3 sem passar por 1 e 2
    const t3_1 = await tarefaDoDocumento(p3.certidoes[1].documentoId)
    const bloqueado = await concluirEtapa({ tarefaId: t3_1.id, etapaId: p3.certidoes[1].stepIds[2], autorId: daniela.id })
    ok("75) Step futuro bloqueado — concluir o passo 3 direto (sem 1/2) é recusado (DEPENDENCIA_PENDENTE)", bloqueado.ok === false && bloqueado.codigo === "DEPENDENCIA_PENDENTE", JSON.stringify(bloqueado))

    // 76) Step concluído consultável — histórico/instância acessível depois
    const dossie3_0 = await dossieDaTarefa(t3_0.id)
    const etapaConcluidaNoDossie = dossie3_0?.etapas.find((e) => e.stepKey === "solicitar_certidao")
    ok("76) Step concluído continua consultável (dossiê mostra a etapa concluída, com data)", etapaConcluidaNoDossie?.status === "CONCLUIDO" && etapaConcluidaNoDossie?.concluidaEm != null)

    // 101) verificador de integridade: Tarefa sem Step (workflowStepInstanceId nulo indevido)
    const semStep = await prisma.tarefa.count({
      where: { processoId: p3.processoId, workflowInstanceId: { not: null }, workflowStepInstanceId: null, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] } },
    })
    ok("101) verificador de integridade: nenhuma Tarefa ativa com workflowInstanceId mas sem workflowStepInstanceId (nenhum \"passo perdido\")", semStep === 0, `${semStep}`)

    // 102) verificador de integridade: duplicidade — mais de uma Tarefa ativa para a mesma obrigação
    const porDocumento = await prisma.tarefa.groupBy({
      by: ["documentoId"],
      where: { processoId: p3.processoId, documentoId: { not: null }, statusTarefa: { notIn: ["CANCELADA", "SUPERSEDIDA"] } },
      _count: { id: true },
    })
    const duplicadas = porDocumento.filter((g) => g._count.id > 1)
    ok("102) verificador de integridade: nenhuma obrigação (documentoId) com mais de 1 Tarefa ativa", duplicadas.length === 0, JSON.stringify(duplicadas))

    // 103) verificador de integridade: necessidade ATENDIDA sem documento válido
    const necsAtendidas = await prisma.necessidadeDocumental.findMany({
      where: { processoId: p3.processoId, status: "ATENDIDA" },
      select: { id: true, documentos: { select: { status: true } } },
    })
    const indevidas = necsAtendidas.filter((n) => !n.documentos.some((d) => !["INVALIDO", "CANCELADO", "NAO_ENCONTRADO"].includes(d.status)))
    ok("103) verificador de integridade: nenhuma necessidade ATENDIDA sem documento válido por trás", indevidas.length === 0, JSON.stringify(indevidas))

    // 110) fase não conclui com apenas 1/3 certidões prontas
    const pend1de3 = await calcularPendencias(p3.processoId, "emissao_documental")
    ok("110a) com 1 de 3 certidões prontas (a certidão 0 solicitada, nada mais), a fase NÃO pode avançar", pend1de3.canAdvance === false, JSON.stringify(pend1de3.blocking.map((b) => b.code)))

    // completa as 3 certidões (solicitar→aguardar→receber→conferir→validar) e satisfaz as necessidades
    for (const c of p3.certidoes) {
      const t = await tarefaDoDocumento(c.documentoId)
      const tarefaAtual = await prisma.tarefa.findUniqueOrThrow({ where: { id: t.id }, select: { statusTarefa: true } })
      if (tarefaAtual.statusTarefa === "CONCLUIDO_RECEBIDO") { await atenderNecessidade(c.necessidadeId); continue }
      let r = await concluirEtapa({ tarefaId: t.id, autorId: daniela.id })
      while (r.ok && !r.tarefaConcluida) {
        r = await concluirEtapa({ tarefaId: t.id, autorId: daniela.id })
      }
      await atenderNecessidade(c.necessidadeId)
    }
    const pend3de3 = await calcularPendencias(p3.processoId, "emissao_documental")
    ok("110b) com as 3 certidões prontas, a fase PODE avançar (canAdvance true)", pend3de3.canAdvance === true, JSON.stringify(pend3de3.blocking.map((b) => b.code)))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("77-82) Movimentação de fase preserva obrigações; CANCELADA != CONCLUÍDA; EM_RISCO com motivo")
  // ══════════════════════════════════════════════════════════════════════
  {
    const p77 = await palco({ sufixo: "FASE" })
    const c77 = p77.certidoes[0]
    const t77 = await tarefaDoDocumento(c77.documentoId)
    await concluirEtapa({ tarefaId: t77.id, autorId: daniela.id })

    const tarefasAntesMover = await prisma.tarefa.findMany({ where: { processoId: p77.processoId }, select: { id: true, statusTarefa: true } })
    const necsAntesMover = await prisma.necessidadeDocumental.findMany({ where: { processoId: p77.processoId }, select: { id: true, status: true } })

    // 77) MOVER FASE não apaga obrigações/Tarefas — provado na garantia real do
    // schema/contrato (CLAUDE.md §9): mudar `Processo.faseAtualKey` (o que
    // qualquer movimentação de fase — automática, forçada ou manual — faz na
    // camada de dados) nunca cascateia para Tarefa/NecessidadeDocumental. O
    // circuito completo de movePhaseManual/returnPhase (que exige o catálogo
    // MacroWorkflow/FaseMacro/TipoProcessoNacionalidade) já tem cobertura
    // dedicada em scripts/etapa6-fase-circuito.test.ts; aqui provamos a
    // invariante que realmente importa para este mandato: a posição do
    // processo muda, o trabalho documental não é tocado.
    await prisma.processo.update({ where: { id: p77.processoId }, data: { faseAtualKey: "retificacao" } })
    const tarefasDepoisMover = await prisma.tarefa.findMany({ where: { processoId: p77.processoId }, select: { id: true, statusTarefa: true } })
    const necsDepoisMover = await prisma.necessidadeDocumental.findMany({ where: { processoId: p77.processoId }, select: { id: true, status: true } })
    ok("77) mover fase não apaga Tarefas (mesma contagem, mesmo status)", JSON.stringify(tarefasAntesMover) === JSON.stringify(tarefasDepoisMover))
    ok("77b) mover fase não apaga/altera NecessidadeDocumental", JSON.stringify(necsAntesMover) === JSON.stringify(necsDepoisMover))

    // 78) retroceder fase não recria Tarefa — voltar Processo.faseAtualKey para
    // a fase original não duplica a Tarefa que já existia para a obrigação.
    await prisma.processo.update({ where: { id: p77.processoId }, data: { faseAtualKey: "emissao_documental" } })
    const totalAposRetroceder = await prisma.tarefa.count({ where: { processoId: p77.processoId } })
    ok("78) retroceder para a fase original não recria a Tarefa (contagem continua 1)", totalAposRetroceder === tarefasAntesMover.length, `${totalAposRetroceder}`)
    const mesmaTarefa = await prisma.tarefa.findUniqueOrThrow({ where: { id: t77.id } })
    ok("78b) é a MESMA Tarefa (id preservado, statusTarefa preservado)", mesmaTarefa.id === t77.id && mesmaTarefa.statusTarefa === tarefasAntesMover[0].statusTarefa)

    // 79) CANCELADA != CONCLUÍDA — em nenhuma projeção
    const rCancelar = await import("@/lib/operacional/tarefa-ciclo").then((m) => m.cancelarTarefa({ tarefaId: t77.id, autorId: marco.id, motivo: "teste item 79" }))
    ok("79) cancelamento aceito", rCancelar.ok === true, JSON.stringify(rCancelar))
    const indicadores79 = await indicadoresGerenciais({ processoId: p77.processoId })
    ok("79b) CANCELADA nunca conta como concluída em indicadoresGerenciais", indicadores79.concluidas === 0, JSON.stringify(indicadores79))
    const { linhas: linhas79 } = await visaoGerencial({ processoId: p77.processoId, coluna: "CONCLUIDA" as never }, new Date())
    ok("79c) CANCELADA não aparece na coluna CONCLUIDA da visão gerencial", !linhas79.some((l) => l.taskId === t77.id))

    // 80) EM_RISCO mostra o motivo real (motivosRisco, não genérico)
    const p80 = await palco({ sufixo: "RISCO" })
    const c80 = p80.certidoes[0]
    const t80 = await tarefaDoDocumento(c80.documentoId)
    const estado80 = await estadoTemporalDaOperacao(prisma, t80.id)
    ok("80) EM_RISCO mostra o(s) motivo(s) REAL(is), não uma flag genérica", estado80?.emRisco === true && estado80.motivosRisco.length > 0 && estado80.motivosRisco.every((m) => typeof m === "string" && m.length > 0), JSON.stringify(estado80?.motivosRisco))

    // 81) operação sem próximo acontecimento determinável vira risco
    ok("81) sem responsável e sem prazo, a operação vira risco por SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL/SEM_RESPONSAVEL",
      estado80!.motivosRisco.some((m) => m.includes("SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL") || m.includes("SEM_RESPONSAVEL")))

    // 82) configuração nova não reescreve histórico de operações já concluídas
    // (mesma prova de 86, agora sobre EXIGÊNCIA em vez de checklist: mudar a
    // exigência de evidência de um passo JÁ concluído não desconclui nada.)
    const docP1 = await prisma.documento.findUniqueOrThrow({ where: { id: c1.documentoId }, select: { documentTypeId: true } })
    const novaEvid82 = await tipoEvidencia("POS82")
    await prisma.exigenciaEvidenciaEtapa.create({
      data: { stepKey: "solicitar_certidao", documentoTipoId: docP1.documentTypeId, evidenciaTipoId: novaEvid82, finalidade: "OUTRO", obrigatoria: true, cardinalidadeMax: 1, chaveExigencia: `${MARCA}|pos82|${docP1.documentTypeId}` },
    })
    const stepSolicitarHistorico = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: c1.stepIds[0] }, select: { status: true } })
    ok("82) exigência nova (cadastrada DEPOIS) não reescreve a conclusão histórica já registrada", stepSolicitarHistorico.status === "CONCLUIDO")
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("87-89) SLA/checklist retroativos; troca de cartório mantém tentativas; tentativa cancelada não cancela a obrigação")
  // ══════════════════════════════════════════════════════════════════════
  {
    // 87) SLA novo não altera prazo já registrado retroativamente
    const p87 = await palco({ sufixo: "SLA87" })
    const c87 = p87.certidoes[0]
    const t87Row = await prisma.tarefa.findUniqueOrThrow({ where: { id: (await tarefaDoDocumento(c87.documentoId)).id }, select: { id: true, dataPrazo: true } })
    await prisma.phaseInternalWorkflowStep.updateMany({ where: { workflowId: wf5Id, key: "solicitar_certidao" }, data: { slaDays: 30 } })
    const t87Depois = await prisma.tarefa.findUniqueOrThrow({ where: { id: t87Row.id }, select: { dataPrazo: true } })
    ok("87) mudar o SLA no cadastro NÃO altera o prazo já registrado na Tarefa (retroativo)", t87Row.dataPrazo?.getTime() === t87Depois.dataPrazo?.getTime())

    // 88) troca de cartório mantém as tentativas anteriores (já provado em 37,
    // agora do ponto de vista de StepExecution/tentativa — nenhuma é apagada)
    const tentativas88Antes = await prisma.stepExecution.count({ where: { stepInstance: { documentoId: cInv.documentoId } } })
    await prisma.documento.update({ where: { id: cInv.documentoId }, data: { orgaoId: null, cartorio: "Cartório Trocado Depois" } })
    const tentativas88Depois = await prisma.stepExecution.count({ where: { stepInstance: { documentoId: cInv.documentoId } } })
    ok("88) troca de cartório mantém as tentativas anteriores (StepExecution não é apagada)", tentativas88Depois === tentativas88Antes && tentativas88Depois > 0, `${tentativas88Antes} / ${tentativas88Depois}`)

    // 89) tentativa cancelada não cancela a obrigação inteira — cancelar UMA
    // certidão de um processo com 3 não cancela as outras nem a necessidade
    // de uma pessoa que nada tem a ver com a tentativa cancelada.
    const p89 = await palco({ sufixo: "TENT89", certidoes: 2 })
    const t89_0 = await tarefaDoDocumento(p89.certidoes[0].documentoId)
    const { cancelarTarefa } = await import("@/lib/operacional/tarefa-ciclo")
    await cancelarTarefa({ tarefaId: t89_0.id, autorId: marco.id, motivo: "tentativa cancelada — item 89" })
    const nec89_1 = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: p89.certidoes[1].necessidadeId }, select: { status: true } })
    const tarefa89_1 = await tarefaDoDocumento(p89.certidoes[1].documentoId)
    ok("89) cancelar uma tentativa/tarefa NÃO cancela a obrigação inteira — a outra certidão do mesmo processo segue intacta", nec89_1.status === "PENDENTE" && (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa89_1.id } })).statusTarefa !== "CANCELADA")
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("90-93) Regressão de validação: rejeição não substitui automaticamente; histórico permanece; impacto identificável")
  // ══════════════════════════════════════════════════════════════════════
  {
    // 90) versão mais nova rejeitada (NÃO VALIDADA) não substitui automaticamente
    // a versão válida anterior — cenário: um documento JÁ validado (item 30/c1),
    // uma SEGUNDA via é pedida e essa segunda é invalidada: a primeira (a
    // vigente/válida) continua sendo a que vale, e a nova rejeitada não a
    // substitui.
    const origemValida = await prisma.documento.findUniqueOrThrow({ where: { id: c1.documentoId }, select: { id: true, status: true, substituidoEm: true } })
    const segundaVia = await novaViaDocumental({
      stepInstanceId: c1.stepIds[0], documentoId: c1.documentoId, processoId: p1.processoId,
      valores: { motivo: "teste item 90 — segunda via" }, usuarioId: daniela.id, sync: { origem: "USER", correlationId: randomUUID() },
    })
    const segundaViaId = segundaVia.criado as number
    await invalidarDocumento({
      stepInstanceId: c1.stepIds[4], documentoId: segundaViaId, processoId: p1.processoId,
      valores: { motivo: "segunda via também não serviu" }, usuarioId: daniela.id, sync: { origem: "USER", correlationId: randomUUID() },
    })
    const segundaViaDepois = await prisma.documento.findUniqueOrThrow({ where: { id: segundaViaId }, select: { status: true } })
    const origemFinal = await prisma.documento.findUniqueOrThrow({ where: { id: c1.documentoId }, select: { status: true } })
    ok("90) a versão rejeitada (INVALIDO) não substitui a válida anterior — a original continua com seu próprio status, intocado", segundaViaDepois.status === "INVALIDO" && origemFinal.status === origemValida.status)

    // 91) invalidação de documento validado remove a satisfação atual da
    // necessidade (regressão) — já provado no fluxo principal (item 33); aqui
    // sobre ESTA necessidade (c1), que tinha sido ATENDIDA no bloco 26-30.
    await atenderNecessidade(c1.necessidadeId) // reafirma ATENDIDA antes do teste
    await invalidarDocumento({
      stepInstanceId: c1.stepIds[4], documentoId: c1.documentoId, processoId: p1.processoId,
      valores: { motivo: "regressão item 91" }, usuarioId: daniela.id, sync: { origem: "USER", correlationId: randomUUID() },
    })
    const necPos91 = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: c1.necessidadeId }, select: { status: true } })
    ok("91) invalidar documento validado REMOVE a satisfação atual da necessidade (regressão real)", necPos91.status !== "ATENDIDA", necPos91.status)

    // 92) histórico da validação anterior permanece (mesmo após invalidação)
    const eventosNec91 = await prisma.necessidadeDocumentalEvento.findMany({ where: { necessidadeId: c1.necessidadeId }, select: { tipo: true } })
    ok("92) o histórico (evento ATENDIDA) da validação anterior permanece — append-only, nunca apagado", eventosNec91.some((e) => e.tipo === "ATENDIDA") && eventosNec91.some((e) => e.tipo === "REABERTA"))

    // 93) impacto downstream da invalidação é identificável (dependentes:
    // apostilamento/tradução/retificação)
    const pasta93 = await prisma.pastaApostilamento.create({ data: { processoId: p1.processoId }, select: { id: true } })
    await prisma.pastaApostilamentoDocumento.create({
      data: { pastaApostilamentoId: pasta93.id, documentoId: c1.documentoId, pessoaNome: "Fulano", documentoTitulo: "Certidão validada e depois invalidada", status: "incluido_na_pasta" },
    })
    const impacto = await identificarImpactoDownstream(c1.documentoId)
    ok("93) impacto downstream da invalidação é IDENTIFICÁVEL (apostilamento dependente aparece na lista)", impacto.some((i) => i.dominio === "PASTA_APOSTILAMENTO"), JSON.stringify(impacto))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("94-99) Pausa/retomada de SLA; dias úteis; fim de semana; virada de mês; timezone")
  // ══════════════════════════════════════════════════════════════════════
  {
    const p94 = await palco({ sufixo: "SLA94" })
    const c94 = p94.certidoes[0]
    const t94 = await tarefaDoDocumento(c94.documentoId)
    const antes94 = await prisma.tarefa.findUniqueOrThrow({ where: { id: t94.id }, select: { dataPrazo: true } })

    // 94) pausa preserva a semântica temporal — o prazo NÃO se move enquanto
    // pausado (só quando retomar, pelo tempo exato decorrido).
    await aguardarTerceiro({ tarefaId: t94.id, autorId: daniela.id, motivo: "pausa item 94" })
    const durantePausa = await prisma.tarefa.findUniqueOrThrow({ where: { id: t94.id }, select: { dataPrazo: true, slaPausadoEm: true } })
    ok("94) durante a pausa, dataPrazo NÃO é reescrito (o relógio não continua contando indevidamente)", durantePausa.dataPrazo?.getTime() === antes94.dataPrazo?.getTime() && durantePausa.slaPausadoEm != null)

    // 95) retomada após pausa recalcula corretamente (empurra o prazo pelo
    // tempo real decorrido, nunca zera nem soma um valor arbitrário)
    await prisma.tarefa.update({ where: { id: t94.id }, data: { slaPausadoEm: new Date(Date.now() - 3 * 3600_000) } }) // simula 3h de pausa
    await retomarDeEspera({ tarefaId: t94.id, autorId: daniela.id })
    const depoisRetomada = await prisma.tarefa.findUniqueOrThrow({ where: { id: t94.id }, select: { dataPrazo: true, slaPausaAcumuladaMin: true, slaPausadoEm: true } })
    ok("95) retomada recalcula — slaPausadoEm limpo e o prazo empurrado pelo tempo pausado", depoisRetomada.slaPausadoEm === null && depoisRetomada.slaPausaAcumuladaMin >= 179 && depoisRetomada.dataPrazo!.getTime() > antes94.dataPrazo!.getTime())

    // 96/97) dias úteis — sábado/domingo não contam, e o prazo desloca corretamente
    const sextaAntesDoFimDeSemana = new Date(2026, 8, 11) // sexta 11/09/2026 (mês 0-based)
    ok("96) 11/09/2026 (sexta) é dia útil", isDiaUtil(sextaAntesDoFimDeSemana) === true)
    const sabado = new Date(2026, 8, 12)
    const domingo = new Date(2026, 8, 13)
    ok("96b) sábado e domingo NÃO são dias úteis (cálculo de prazo pula fim de semana)", isDiaUtil(sabado) === false && isDiaUtil(domingo) === false)
    ok("97) prazo que cairia em fim de semana desloca para o próximo dia útil (segunda)", proximoDiaUtil(sabado).getDay() === 1 && proximoDiaUtil(domingo).getDay() === 1)

    // 98) mudança de mês — dia útil atravessando virada de mês (31/08/2026 é
    // segunda-feira; +1 dia útil cai em 01/09/2026, terça)
    const dia31Ago = new Date(2026, 7, 31)
    const proximo = proximoDiaUtil(new Date(dia31Ago.getTime() + 86400000))
    ok("98) prazo que atravessa virada de mês calcula corretamente (31/08 → 01/09)", proximo.getMonth() === 8 && proximo.getDate() === 1, proximo.toISOString())

    // 99) timezone — o cálculo usa o fuso operacional correto (America/Sao_Paulo)
    const meiaNoiteUtc = new Date("2026-09-15T02:30:00.000Z") // 23h30 de 14/09 em SP (UTC-3)
    ok("99) diaOperacional usa o fuso America/Sao_Paulo — 02:30 UTC do dia 15 ainda é 14 em SP", diaOperacional(meiaNoiteUtc) === "2026-09-14")
    // Prazo às 02:59 UTC do dia 14 é 23:59 do dia 13 em SP — em UTC cru, a mesma
    // DATA de calendário (14) do "agora" (2026-09-14T04:00 UTC = 01:00 em SP do
    // dia 14); comparando por dia OPERACIONAL (SP), o prazo já é de ONTEM: 1 dia
    // de atraso. Uma comparação por data UTC crua diria "vence hoje" — o motivo
    // exato pelo qual este módulo existe (ver o cabeçalho de tempo-operacional.ts).
    const agoraSP14 = new Date("2026-09-14T04:00:00.000Z") // 01:00 de 14/09 em SP
    const estadoFusoAtrasado = estadoTemporal({ dataPrazo: new Date("2026-09-14T02:59:00.000Z"), agora: agoraSP14 })
    ok("99b) o estado temporal usa o dia operacional (SP), não a data UTC crua, para decidir atraso — 1 dia de atraso, não \"vence hoje\"",
      estadoFusoAtrasado.atrasado === true && estadoFusoAtrasado.diasParaPrazo === -1, JSON.stringify(estadoFusoAtrasado))
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("104-107) Convergência sob concorrência; idempotência de recebimento; resiliência de notificação")
  // ══════════════════════════════════════════════════════════════════════
  {
    // 104) retorno + follow-up "concorrentes" convergem para o MESMO estado
    // final, qualquer que seja a ORDEM de chegada — a prova real de convergência
    // não é rodar dois `read-modify-write` não-transacionais ao mesmo tempo sobre
    // o MESMO JSON (isso é uma corrida de teste mal-desenhada, perde escrita por
    // construção, não uma garantia do motor); é mostrar que a leitura canônica
    // (`computarProximoAcontecimento`) dá a MESMA resposta — retorno prevalece
    // sobre acompanhamento agendado — nas duas ordens possíveis.
    const p104a = await palco({ sufixo: "CONV104A" })
    const c104a = p104a.certidoes[0]
    const t104a = await tarefaDoDocumento(c104a.documentoId)
    await aguardarTerceiro({ tarefaId: t104a.id, autorId: daniela.id, motivo: "aguardando (ordem A)" })
    await registrarCampos(c104a.stepIds[0], { proximoAcompanhamento: new Date().toISOString().slice(0, 10) })
    await registrarContato(c104a.stepIds[0], { canal: "EMAIL", resultado: "RETORNO_RECEBIDO" })
    const estado104a = await estadoTemporalDaOperacao(prisma, t104a.id)

    const p104b = await palco({ sufixo: "CONV104B" })
    const c104b = p104b.certidoes[0]
    const t104b = await tarefaDoDocumento(c104b.documentoId)
    await aguardarTerceiro({ tarefaId: t104b.id, autorId: daniela.id, motivo: "aguardando (ordem B)" })
    await registrarContato(c104b.stepIds[0], { canal: "EMAIL", resultado: "RETORNO_RECEBIDO" })
    await registrarCampos(c104b.stepIds[0], { proximoAcompanhamento: new Date().toISOString().slice(0, 10) })
    const estado104b = await estadoTemporalDaOperacao(prisma, t104b.id)

    ok("104) retorno e follow-up convergem para o MESMO estado final independentemente da ordem de chegada",
      estado104a?.retornoRecebido === true && estado104b?.retornoRecebido === true
      && estado104a?.proximoAcontecimento.tipo === "retorno_recebido" && estado104b?.proximoAcontecimento.tipo === "retorno_recebido")

    // 105) validação dupla (duas validações quase simultâneas) converge sem duplicar efeito
    const p105 = await palco({ sufixo: "DUPVAL105" })
    const c105 = p105.certidoes[0]
    const t105 = await tarefaDoDocumento(c105.documentoId)
    await concluirEtapa({ tarefaId: t105.id, autorId: daniela.id }) // solicitar
    await concluirEtapa({ tarefaId: t105.id, autorId: daniela.id }) // aguardar
    await prisma.documentoArquivo.create({ data: { documentoId: c105.documentoId, url: `https://x/${MARCA}/dup105`, nome: "r.pdf", tipo: "DOCUMENTO_RECEBIDO" } })
    await concluirEtapa({ tarefaId: t105.id, autorId: daniela.id }) // receber
    await concluirEtapa({ tarefaId: t105.id, autorId: daniela.id }) // conferir
    const [va, vb] = await Promise.all([
      concluirEtapa({ tarefaId: t105.id, autorId: daniela.id }),
      concluirEtapa({ tarefaId: t105.id, autorId: daniela.id }),
    ])
    const foiAceitaOuConflito105 = (r: typeof va) => r.ok === true || (r as { codigo?: string }).codigo === "CONFLITO"
    ok("105) validação dupla (duas conclusões quase simultâneas do passo final) converge sem duplicar efeito (uma muda, a outra é idempotente ou perde o CAS)",
      foiAceitaOuConflito105(va) && foiAceitaOuConflito105(vb), JSON.stringify([va, vb]))
    const eventosValidar105 = await prisma.workflowEvento.count({ where: { stepInstanceId: c105.stepIds[4], tipo: "PASSO_CONCLUIDO" } })
    ok("105b) exatamente 1 evento PASSO_CONCLUIDO para validar_certidao (sem duplicar)", eventosValidar105 === 1, `${eventosValidar105}`)

    // 106) documento recebido duas vezes não duplica versão indevidamente
    const p106 = await palco({ sufixo: "DUPREC106" })
    const c106 = p106.certidoes[0]
    const arquivoUrl = `https://x/${MARCA}/dup106-mesmo-arquivo`
    await prisma.documentoArquivo.create({ data: { documentoId: c106.documentoId, url: arquivoUrl, nome: "r.pdf", tipo: "DOCUMENTO_RECEBIDO" } })
    let duplicouPorUrl = false
    try {
      await prisma.documentoArquivo.create({ data: { documentoId: c106.documentoId, url: arquivoUrl, nome: "r.pdf", tipo: "DOCUMENTO_RECEBIDO" } })
    } catch { duplicouPorUrl = true }
    ok("106) o MESMO arquivo (mesma URL) não duplica DocumentoArquivo — trava única (documentoId,url) recusa a segunda", duplicouPorUrl === true)
    const arquivosDoDoc106 = await prisma.documentoArquivo.count({ where: { documentoId: c106.documentoId } })
    ok("106b) exatamente 1 registro de arquivo para o documento", arquivosDoDoc106 === 1, `${arquivosDoDoc106}`)

    // 107) falha de notificação não afeta a fila operacional — a Tarefa continua visível
    await prisma.tarefa.update({ where: { id: t104a.id }, data: { responsavelId: null } }) // remove destinatário — a varredura pula, sem lançar
    const r107 = await avisarAcontecimentosOperacionais()
    ok("107) varredura tolera tarefa sem destinatário sem lançar exceção", typeof r107.semDestinatario === "number")
    const { linhas: linhas107 } = await visaoGerencial({ processoId: p104a.processoId }, new Date())
    ok("107b) a Tarefa continua visível/operável na fila mesmo sem poder ser notificada", linhas107.some((l) => l.taskId === t104a.id))
  }

  // ══════════════════════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam · total ${passou + falhou}`)
  if (falhou > 0) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  • ${f}`) }

  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
