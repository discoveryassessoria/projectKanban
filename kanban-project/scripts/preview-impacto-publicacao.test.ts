// scripts/preview-impacto-publicacao.test.ts
//
// PREVIEW DE IMPACTO DE ALTERAÇÃO ADMINISTRATIVA — a contagem é REAL, não estimativa.
//
// O modal de publicação (`PublicarWorkflowModal`) já mostrava o diff campo a campo,
// mas nunca dizia QUANTAS operações em andamento ficariam na versão que está prestes
// a ser superada. `preverPublicacao()` agora conta `PhaseWorkflowInstance` não-terminal
// com `workflowVersion` igual à versão vigente do workflow — este teste prova que a
// contagem bate com a realidade: cria N tarefas ativas na versão vigente, edita o
// rascunho, e confirma que o preview relata exatamente N.
//
// SÓ RODA NO BANCO DE TESTE LOCAL:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   npx tsx scripts/preview-impacto-publicacao.test.ts

import { PrismaClient } from "@prisma/client"
import { congelarVersaoVigente, publicarNovaVersao } from "../src/services/versao-publicada"
import { preverPublicacao } from "../src/services/publicacao-de-workflow"

const url = process.env.PRISMA_DATABASE_URL ?? ""
if (!/discovery_test/.test(url)) {
  console.log("PULADO — sem banco de teste local (PRISMA_DATABASE_URL não aponta para discovery_test)")
  process.exit(0)
}

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const prisma = new PrismaClient()
const UID = "all::teste_preview_impacto"

async function limpar() {
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: UID }, select: { id: true } })
  if (wf) {
    await prisma.phaseWorkflowInstance.deleteMany({ where: { workflowDefinitionId: wf.id } })
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.processo.deleteMany({ where: { nome: { startsWith: "TESTE-PREVIEW-IMPACTO" } } })
  await prisma.arvore.deleteMany({ where: { nome: "TESTE-PREVIEW-IMPACTO árvore" } })
}

async function main() {
  await limpar()

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(1) Workflow nasce em V1, congelado, sem operações em andamento")
  // ══════════════════════════════════════════════════════════════════════
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: UID, phaseKey: "emissao_documental", name: "WF de teste — preview de impacto", tipoProcessoId: null,
      versao: 1, execucao: "SEQUENCIAL", pausarSlaEmEsperaExterna: false,
      passos: { create: [
        { key: "a", label: "A", ordem: 1, createsTask: true, required: true, slaDays: 3, cardinalidade: "PROCESSO" },
      ] },
    },
    select: { id: true },
  })
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const semMudanca = await preverPublicacao(wf.id)
  check("sem rascunho, o preview existe", semMudanca != null)
  check("sem nenhuma instância ainda, a contagem é zero", semMudanca?.operacoesEmAndamentoNaVersaoAtual === 0,
    String(semMudanca?.operacoesEmAndamentoNaVersaoAtual))
  check("o aviso reflete a ausência de operações", (semMudanca?.aviso ?? "").includes("Nenhuma operação em andamento"))

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(2) Três processos materializam a fase na V1 — três operações ATIVAS")
  // ══════════════════════════════════════════════════════════════════════
  const tipo = await prisma.tipoProcessoNacionalidade.findFirst({ where: { ativo: true }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: "TESTE-PREVIEW-IMPACTO árvore" }, select: { id: true } })

  const processos = []
  for (let i = 1; i <= 3; i++) {
    const p = await prisma.processo.create({
      data: {
        nome: `TESTE-PREVIEW-IMPACTO P${i}`, arvoreId: arv.id, workflowRuntime: "v2",
        faseAtualKey: "emissao_documental", tipoProcessoMotorId: tipo?.id ?? null,
      },
      select: { id: true },
    })
    processos.push(p)
  }
  // status variados dentro do que conta como "ativa" — PENDENTE/ATIVO/AGUARDANDO — e
  // uma quarta, TERMINAL (CONCLUIDO), que NÃO deve entrar na contagem.
  await prisma.phaseWorkflowInstance.create({
    data: { processoId: processos[0].id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: "TESTE-PREVIEW-IMPACTO-1" },
  })
  await prisma.phaseWorkflowInstance.create({
    data: { processoId: processos[1].id, faseMacroKey: "emissao_documental", ciclo: 1, status: "AGUARDANDO",
      workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: "TESTE-PREVIEW-IMPACTO-2" },
  })
  await prisma.phaseWorkflowInstance.create({
    data: { processoId: processos[2].id, faseMacroKey: "emissao_documental", ciclo: 1, status: "PENDENTE",
      workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: "TESTE-PREVIEW-IMPACTO-3" },
  })
  await prisma.phaseWorkflowInstance.create({
    data: { processoId: processos[0].id, faseMacroKey: "emissao_documental", ciclo: 2, status: "CONCLUIDO",
      workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: "TESTE-PREVIEW-IMPACTO-4-terminal" },
  })

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(3) Editar o rascunho — a contagem deve dizer exatamente 3")
  // ══════════════════════════════════════════════════════════════════════
  // Editar SEM publicar: o rascunho (definição viva) passa a diferir da V1
  // congelada — é exatamente o estado em que o administrador abre o modal
  // de publicação para ver o preview ANTES de decidir.
  await prisma.phaseInternalWorkflowStep.updateMany({ where: { workflowId: wf.id, key: "a" }, data: { slaDays: 99 } })

  const comMudanca = await preverPublicacao(wf.id)
  check("o preview reflete a alteração pendente", comMudanca?.temRascunho === true)
  check("a contagem bate com a realidade: 3 operações ativas na versão vigente",
    comMudanca?.operacoesEmAndamentoNaVersaoAtual === 3, String(comMudanca?.operacoesEmAndamentoNaVersaoAtual))
  check("a instância terminal (CONCLUIDO) NÃO entra na contagem",
    comMudanca!.operacoesEmAndamentoNaVersaoAtual < 4)
  check("o aviso cita o número real", (comMudanca?.aviso ?? "").includes("3 operação"))
  check("o aviso nomeia a versão que ficaria para trás", (comMudanca?.aviso ?? "").includes(`versão ${comMudanca?.versaoAtual}`))

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n(4) Publicar não muda o que as 3 operações já registraram")
  // ══════════════════════════════════════════════════════════════════════
  await prisma.$transaction(async (tx) => {
    await publicarNovaVersao(wf.id, tx)
    await congelarVersaoVigente(wf.id, "PUBLICACAO", tx)
  })
  const versaoDepois = (await prisma.phaseInternalWorkflow.findUnique({ where: { id: wf.id }, select: { versao: true } }))?.versao
  check("a versão vigente avançou", versaoDepois === 2, String(versaoDepois))
  const instanciasDepois = await prisma.phaseWorkflowInstance.findMany({
    where: { workflowDefinitionId: wf.id, chaveIdempotencia: { in: ["TESTE-PREVIEW-IMPACTO-1", "TESTE-PREVIEW-IMPACTO-2", "TESTE-PREVIEW-IMPACTO-3"] } },
    select: { workflowVersion: true },
  })
  check("as 3 instâncias continuam com o ponteiro na versão antiga (1) — publicar não as tocou",
    instanciasDepois.every((i) => i.workflowVersion === 1), JSON.stringify(instanciasDepois))

  const previewFinal = await preverPublicacao(wf.id)
  check("agora a contagem 'na versão vigente' (3) é zero — as 3 ficaram para trás na V1, não na V3",
    previewFinal?.operacoesEmAndamentoNaVersaoAtual === 0, String(previewFinal?.operacoesEmAndamentoNaVersaoAtual))

  await limpar()

  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`) }
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

void main()
