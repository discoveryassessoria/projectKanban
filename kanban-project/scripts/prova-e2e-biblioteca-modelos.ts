// scripts/prova-e2e-biblioteca-modelos.ts
// ============================================================================
// PROVA DE PONTA A PONTA — SOMENTE o Modelo da Biblioteca de Tarefas (mandato
// 22/09/2026, escopo reduzido a pedido explícito de 22/09/2026: "somente a
// Biblioteca de Tarefas, sem vínculo, cutover ou publicação de Workflow").
//
// Cobre EXCLUSIVAMENTE o ciclo de vida do Modelo — nunca cria Vínculo, nunca
// toca um Processo real, nunca aciona `motorVigenteDaFase`/materialização:
//
//   1) criar Modelo → a "casca" nasce com o key do PASSO = `chave` do Modelo
//      (nunca um placeholder genérico — é o que resolve o editor/executor
//      certo quando um dia for vinculado);
//   2) editar conteúdo (subtarefas + ações), publicar → SUBTAREFA_SEM_ACAO
//      não dispara, EFEITO_FORA_DE_COMPETENCIA não dispara (checagem adiada
//      para a publicação do Vínculo, que este cenário nunca alcança);
//   3) versão congelada tem exatamente o conteúdo esperado;
//   4) duplicar → nova identidade própria, conteúdo copiado, sem Vínculo;
//   5) inativar/reativar → nunca apaga a definição nem a versão publicada;
//   6) confirma zero Vínculo/reconciliação/outbox foi criado em momento algum.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-e2e-biblioteca-modelos.ts")

import { prisma } from "../lib/prisma"
import {
  criarModelo, publicarModelo, duplicarModelo, inativarModelo, reativarModelo,
} from "../src/services/biblioteca-tarefas/modelo"

const MARCA = "BIBMOD"

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

async function limpar() {
  const modelos = await prisma.bibliotecaModeloTarefa.findMany({ where: { chave: { startsWith: `${MARCA.toLowerCase()}_` } }, select: { id: true, workflowId: true } })
  await prisma.bibliotecaModeloTarefa.deleteMany({ where: { id: { in: modelos.map((m) => m.id) } } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: modelos.map((m) => m.workflowId) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: modelos.map((m) => m.workflowId) } } })
}

async function main() {
  console.log(`\n=== Biblioteca de Tarefas — prova e2e SOMENTE Modelo (${MARCA}) ===\n`)
  await limpar()

  console.log("1) CRIAR — casca nasce RASCUNHO, key do passo = chave do modelo")
  const chave = `${MARCA.toLowerCase()}_solicitar_certidao`
  const criado = await criarModelo({ chave, nome: "[BIBMOD] Solicitar certidão", descricao: "prova", criadoPorId: null })
  check("1.1) modelo criado", criado.ok, criado)
  if (!criado.ok) throw new Error("aborta — modelo não criado")

  const passoVivo = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: criado.workflowId } })
  check("1.2) key do passo é a chave do modelo (nunca 'principal')", passoVivo.key === chave, passoVivo.key)

  const modeloRecemCriado = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: criado.modeloId } })
  check("1.3) status RASCUNHO, sem versão publicada", modeloRecemCriado.status === "RASCUNHO" && modeloRecemCriado.versaoPublicada === null)

  console.log("\n2) EDITAR — conteúdo (subtarefas + ações), publicar")
  await prisma.phaseInternalWorkflowStep.update({
    where: { id: passoVivo.id },
    data: { label: "Solicitar certidão", owner: "equipe_documental", slaDays: 15, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS" },
  })
  const subKeys = ["enviar_requerimento_cartorio", "receber_confirmacao_pedido", "receber_certidao", "conferir_validar_certidao"]
  await prisma.stepSubtaskDefinition.createMany({
    data: [
      { stepId: passoVivo.id, key: subKeys[0], label: "Enviar requerimento ao cartório", ordem: 0, obrigatoria: true },
      { stepId: passoVivo.id, key: subKeys[1], label: "Receber confirmação do pedido", ordem: 1, obrigatoria: true, dependeDe: [subKeys[0]], esperaExternaAoLiberar: true },
      { stepId: passoVivo.id, key: subKeys[2], label: "Receber certidão", ordem: 2, obrigatoria: true, dependeDe: [subKeys[1]] },
      { stepId: passoVivo.id, key: subKeys[3], label: "Conferir e validar certidão", ordem: 3, obrigatoria: true, dependeDe: [subKeys[2]] },
    ],
  })
  const subtarefasCriadas = await prisma.stepSubtaskDefinition.findMany({ where: { stepId: passoVivo.id } })
  for (const st of subtarefasCriadas) {
    await prisma.stepAction.create({ data: { stepId: passoVivo.id, subtaskId: st.id, key: "concluir", label: "Concluir", effectKey: "COMPLETE_STEP", ordem: 0 } })
  }

  const pub1 = await publicarModelo(criado.modeloId, null)
  check("2.1) publica sem EFEITO_FORA_DE_COMPETENCIA nem SUBTAREFA_SEM_ACAO (checagem de competência é adiada ao Vínculo, que este cenário não cria)", pub1.ok, pub1)
  if (!pub1.ok) throw new Error(`aborta — publicação falhou: ${JSON.stringify(pub1)}`)
  // `criarModelo` já congela a v1 VAZIA na criação (mesmo padrão de "criar
  // workflow vazio"); esta é a publicação do CONTEÚDO real, então nasce v2.
  check("2.2) versaoNova = 2 (v1 é a casca vazia congelada na criação)", pub1.versaoNova === 2, pub1)

  console.log("\n3) VERSÃO CONGELADA — conteúdo exato")
  const modeloPublicado = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: criado.modeloId } })
  check("3.1) status PUBLICADO, versaoPublicada=2", modeloPublicado.status === "PUBLICADO" && modeloPublicado.versaoPublicada === 2, modeloPublicado)

  const versaoCongelada = await prisma.phaseInternalWorkflowVersao.findUnique({ where: { workflowId_versao: { workflowId: criado.workflowId, versao: 2 } } })
  const passosCongelados = (versaoCongelada?.passos as any[]) ?? []
  check("3.2) 1 passo, key = chave do modelo", passosCongelados.length === 1 && passosCongelados[0].key === chave, passosCongelados[0]?.key)
  check("3.3) 4 subtarefas na ordem certa", passosCongelados[0]?.subtarefas?.map((s: any) => s.key).join(",") === subKeys.join(","), passosCongelados[0]?.subtarefas?.map((s: any) => s.key))
  check("3.4) cada subtarefa tem exatamente 1 ação (COMPLETE_STEP)",
    passosCongelados[0]?.subtarefas?.length === 4 && passosCongelados[0]?.subtarefas?.every((s: any) => s.acoes?.length === 1 && s.acoes[0].effectKey === "COMPLETE_STEP"),
    passosCongelados[0]?.subtarefas?.map((s: any) => ({ key: s.key, acoes: s.acoes })))
  check("3.5) subtarefa 2 (receber_confirmacao_pedido) tem esperaExternaAoLiberar=true", passosCongelados[0]?.subtarefas?.[1]?.esperaExternaAoLiberar === true)

  console.log("\n4) DUPLICAR — nova identidade, conteúdo copiado, zero Vínculo herdado")
  const dup = await duplicarModelo(criado.modeloId, `${MARCA.toLowerCase()}_solicitar_certidao_copia`, "[BIBMOD] Solicitar certidão (cópia)", null)
  check("4.1) duplicado com sucesso", dup.ok, dup)
  if (dup.ok) {
    const passoDup = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: dup.workflowId } })
    check("4.2) key do passo duplicado = nova chave (própria, não colide com o original)", passoDup.key === `${MARCA.toLowerCase()}_solicitar_certidao_copia`)
    const subsDup = await prisma.stepSubtaskDefinition.findMany({ where: { stepId: passoDup.id } })
    check("4.3) 4 subtarefas copiadas", subsDup.length === 4, subsDup.length)
    const acoesDup = await prisma.stepAction.findMany({ where: { stepId: passoDup.id, subtaskId: { not: null } } })
    check("4.4) 4 ações copiadas (uma por subtarefa)", acoesDup.length === 4, acoesDup.length)
    const modeloDup = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: dup.modeloId } })
    check("4.5) cópia nasce RASCUNHO (não herda status PUBLICADO)", modeloDup.status === "RASCUNHO")
  }

  console.log("\n5) INATIVAR / REATIVAR — nunca apaga definição nem versão publicada")
  const inat = await inativarModelo(criado.modeloId)
  check("5.1) inativado", inat.ok, inat)
  const modeloInativo = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: criado.modeloId } })
  check("5.2) status INATIVO, ativo=false", modeloInativo.status === "INATIVO" && modeloInativo.ativo === false)
  const versaoAindaExiste = await prisma.phaseInternalWorkflowVersao.findUnique({ where: { workflowId_versao: { workflowId: criado.workflowId, versao: 1 } } })
  check("5.3) versão congelada v1 continua existindo — inativar não apaga histórico", !!versaoAindaExiste)

  const reat = await reativarModelo(criado.modeloId)
  check("5.4) reativado", reat.ok, reat)
  const modeloReativado = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: criado.modeloId } })
  check("5.5) volta para PUBLICADO (tinha versaoPublicada) — não RASCUNHO", modeloReativado.status === "PUBLICADO" && modeloReativado.ativo === true)

  console.log("\n6) FORA DE ESCOPO — nenhum Vínculo, reconciliação ou outbox foi tocado")
  const vinculosCriados = await prisma.bibliotecaVinculo.count()
  const outboxBiblioteca = await prisma.domainOutbox.count({ where: { tipo: "biblioteca.vinculo.reconciliar" } })
  check("6.1) zero BibliotecaVinculo em qualquer lugar do banco de teste (este cenário nunca cria um)", vinculosCriados === 0, vinculosCriados)
  check("6.2) zero evento de reconciliação de Vínculo enfileirado", outboxBiblioteca === 0, outboxBiblioteca)

  console.log(`\n=== ${ok} passaram, ${falhou} falharam ===`)
  if (falhou > 0) console.error("Falhas:", falhas)

  await limpar()
  console.log("Limpeza concluída — cenário sintético removido.")
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço */ }
  await prisma.$disconnect()
  process.exit(1)
})
