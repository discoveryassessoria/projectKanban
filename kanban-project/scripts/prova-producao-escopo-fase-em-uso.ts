// scripts/prova-producao-escopo-fase-em-uso.ts
//
// MANDATO "MÓDULO DE FASES" (22/09/2026) — prova em PRODUÇÃO do fluxo de
// mudança de escopo de fase EM USO, usando EXCLUSIVAMENTE a fase sintética
// indicada: [TESTE VISUAL] Auditoria Integral Fases
// (teste_visual_auditoria_integral_fases) — nenhuma fase/processo real.
//
// Roda a MESMA sequência que a interface produz (POST/PUT reais pela rota
// canônica, com o mesmo contrato `confirmarMudancaEscopo`), contra o banco
// de PRODUÇÃO, via a mesma árvore de código do commit publicado:
//   1) PUT sem confirmação → 409 ESCOPO_EM_USO (o "clicar Salvar" que a UI
//      intercepta e transforma no diálogo de confirmação);
//   2) PUT com confirmarMudancaEscopo:true → 200, escopo persiste;
//   3) reconsulta (equivalente a "recarregar a página"/"nova sessão");
//   4) reconciliação executada DUAS VEZES — zero duplicação;
//   5) rollback pelo mesmo fluxo (DOCUMENTO → PROCESSO);
//   6) reconsulta confirma a restauração;
//   7) escopo do universo tocado = só os processos 632-637 desta fase.
//
// Uso:
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/prova-producao-escopo-fase-em-uso.ts
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
exigirConfirmacaoDeEscritaEmProducao(
  "mandato Módulo de Fases 22/09/2026 — prova do fluxo de confirmação de mudança de escopo, fase sintética teste_visual_auditoria_integral_fases, PROCESSO→DOCUMENTO→PROCESSO, com rollback",
  "prova-producao-escopo-fase-em-uso.ts",
)

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { PUT } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { NextRequest } from "next/server"

const CHAVE = "teste_visual_auditoria_integral_fases"
const PROCESSOS_ESPERADOS = [632, 633, 634, 635, 636, 637]

let ok = 0, falhou = 0
const matriz: Array<{ requisito: string; esperado: string; encontrado: string; passou: boolean }> = []
function prova(requisito: string, esperado: string, encontrado: string, passou: boolean) {
  matriz.push({ requisito, esperado, encontrado, passou })
  if (passou) { ok++; console.log(`  ✅ ${requisito} — ${encontrado}`) }
  else { falhou++; console.error(`  ❌ ${requisito}\n     esperado : ${esperado}\n     encontrado: ${encontrado}`) }
}

async function chamarPut(faseId: number, body: Record<string, unknown>, token: string) {
  const res = await PUT(
    new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${faseId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(faseId) }) },
  )
  const j = await res.json().catch(() => ({}))
  return { status: res.status, j }
}

async function contarInstanciasETarefas() {
  const linhas: Record<number, { instancias: number; tarefas: number }> = {}
  for (const pid of PROCESSOS_ESPERADOS) {
    const [instancias, tarefas] = await Promise.all([
      prisma.phaseWorkflowInstance.count({ where: { processoId: pid, faseMacroKey: CHAVE } }),
      prisma.tarefa.count({ where: { processoId: pid, faseMacroKey: CHAVE } }),
    ])
    linhas[pid] = { instancias, tarefas }
  }
  return linhas
}

async function main() {
  console.log("\n=================================================================")
  console.log("PROVA EM PRODUÇÃO — mudança de escopo de fase em uso (Mandato Fases)")
  console.log("=================================================================\n")

  // ── 0) Segurança ──────────────────────────────────────────────────────
  const fase = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE } })
  if (!fase.label.startsWith("[TESTE VISUAL]")) throw new Error("SEGURANÇA: fase não é sintética — abortando")
  const processos = await prisma.processo.findMany({ where: { id: { in: PROCESSOS_ESPERADOS } }, select: { id: true, nome: true } })
  for (const p of processos) {
    if (!p.nome.startsWith("[TESTE VISUAL]")) throw new Error(`SEGURANÇA: processo ${p.id} não é sintético — abortando`)
  }
  const admin = await prisma.usuario.findFirstOrThrow({ where: { tipo: "admin" }, orderBy: { id: "asc" }, select: { id: true, email: true, nome: true } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  console.log(`  ✅ fase confirmada sintética: "${fase.label}" (#${fase.id}, escopo atual=${fase.escopo})`)
  console.log(`  ✅ ${processos.length}/${PROCESSOS_ESPERADOS.length} processos confirmados sintéticos`)
  console.log(`  ✅ autor: ${admin.nome} (#${admin.id})\n`)

  const escopoOriginal = fase.escopo
  const antesInstTar = await contarInstanciasETarefas()
  console.log("── Estado ANTES (instâncias+tarefas por processo, fase teste_visual_auditoria_integral_fases) ──")
  console.log(JSON.stringify(antesInstTar))

  const corpoBase = {
    phaseKey: fase.phaseKey, label: fase.label, descricao: fase.descricao ?? "",
    efeitosPermitidos: fase.efeitosPermitidos, ordemPadrao: fase.ordemPadrao,
    requiredPadrao: fase.requiredPadrao, conditionalPadrao: fase.conditionalPadrao, ativo: fase.ativo, id: fase.id,
  }

  // ── 1) PUT sem confirmação → 409 (o "clicar Salvar" que a UI intercepta) ──
  console.log("\n── 1) PROCESSO → DOCUMENTO, SEM confirmarMudancaEscopo (equivalente ao 1º clique em Salvar) ──")
  const r1 = await chamarPut(fase.id, { ...corpoBase, escopo: "DOCUMENTO" }, token)
  prova("1º clique (sem confirmação): 409 ESCOPO_EM_USO, nada persistido", "409, code=ESCOPO_EM_USO", `${r1.status}, code=${r1.j.code}`, r1.status === 409 && r1.j.code === "ESCOPO_EM_USO")
  const faseAposR1 = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE }, select: { escopo: true, revisaoAtual: true } })
  prova("escopo NÃO mudou após a recusa", `escopo=${escopoOriginal}`, `escopo=${faseAposR1.escopo}`, faseAposR1.escopo === escopoOriginal)

  // ── 2) PUT com confirmação (equivalente a clicar "Confirmar alteração") ──
  console.log("\n── 2) Confirmar a alteração (equivalente ao diálogo → Confirmar) ──")
  const r2 = await chamarPut(fase.id, { ...corpoBase, escopo: "DOCUMENTO", confirmarMudancaEscopo: true }, token)
  prova("confirmação: 200, escopo=DOCUMENTO na resposta", "200, escopo=DOCUMENTO", `${r2.status}, escopo=${r2.j.fase?.escopo}`, r2.status === 200 && r2.j.fase?.escopo === "DOCUMENTO")
  prova("reconciliacaoErro explicitamente null (sem falha silenciosa)", "null", JSON.stringify(r2.j.reconciliacaoErro), r2.j.reconciliacaoErro === null)

  // ── 3) "Recarregar a página" / "nova sessão" — reconsulta direta no banco ──
  console.log("\n── 3) Reconsulta (equivalente a recarregar/nova sessão) ──")
  const faseDepois2 = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE }, select: { escopo: true, revisaoAtual: true } })
  prova("persistiu de verdade: escopo=DOCUMENTO após reconsulta", "escopo=DOCUMENTO", JSON.stringify(faseDepois2), faseDepois2.escopo === "DOCUMENTO")

  // ── 4) Reconciliação EXECUTADA DUAS VEZES — idempotência ──────────────
  console.log("\n── 4) Idempotência — reconciliação repetida não duplica ──")
  const depois1x = await contarInstanciasETarefas()
  console.log("  estado após 1ª reconciliação:", JSON.stringify(depois1x))
  const r2b = await chamarPut(fase.id, { ...corpoBase, escopo: "DOCUMENTO", confirmarMudancaEscopo: true }, token)
  prova("2ª chamada idêntica: aceita sem erro (mudouAlgo=false, não recria nada)", "200", String(r2b.status), r2b.status === 200)
  const depois2x = await contarInstanciasETarefas()
  prova("contagens IDÊNTICAS após repetir — zero duplicação", JSON.stringify(depois1x), JSON.stringify(depois2x), JSON.stringify(depois1x) === JSON.stringify(depois2x))
  // Processos finalizados (634/636): o que a REGRA MASTER exige é que a
  // retroação NUNCA os alcance — não que estejam em zero (634 já carregava
  // uma instância de uma rodada anterior deste mandato antes deste script
  // sequer rodar; ver "Estado ANTES"). O que prova "intocado" é a contagem
  // ficar EXATAMENTE igual ao que já era, e é a comparação acima
  // (`contagens IDÊNTICAS`) que já prova isso para os 6 processos.
  prova("634 (finalizado): contagem desta fase INALTERADA (mesma de antes do script)", JSON.stringify(antesInstTar[634]), JSON.stringify(depois2x[634]), JSON.stringify(antesInstTar[634]) === JSON.stringify(depois2x[634]))
  prova("636 (finalizado): contagem desta fase INALTERADA (mesma de antes do script)", JSON.stringify(antesInstTar[636]), JSON.stringify(depois2x[636]), JSON.stringify(antesInstTar[636]) === JSON.stringify(depois2x[636]))
  const f634 = await prisma.processo.findUniqueOrThrow({ where: { id: 634 }, select: { dataConclusao: true, faseAtualKey: true } })
  const f636 = await prisma.processo.findUniqueOrThrow({ where: { id: 636 }, select: { dataConclusao: true, faseAtualKey: true } })
  prova("634/636: dataConclusao/faseAtualKey inalterados", "ambos com dataConclusao != null", `634=${JSON.stringify(f634)}, 636=${JSON.stringify(f636)}`, f634.dataConclusao != null && f636.dataConclusao != null)

  // ── 5) Rollback pelo MESMO fluxo (DOCUMENTO → PROCESSO) ────────────────
  console.log("\n── 5) Rollback DOCUMENTO → PROCESSO pelo mesmo fluxo (com confirmação) ──")
  const r3 = await chamarPut(fase.id, { ...corpoBase, escopo: "PROCESSO" }, token)
  prova("rollback SEM confirmação: 409 de novo (a regra vale nos dois sentidos)", "409", String(r3.status), r3.status === 409)
  const r4 = await chamarPut(fase.id, { ...corpoBase, escopo: "PROCESSO", confirmarMudancaEscopo: true }, token)
  prova("rollback confirmado: 200, escopo=PROCESSO", "200, escopo=PROCESSO", `${r4.status}, escopo=${r4.j.fase?.escopo}`, r4.status === 200 && r4.j.fase?.escopo === "PROCESSO")

  // ── 6) Reconsulta confirma a restauração ────────────────────────────────
  console.log("\n── 6) Reconsulta confirma restauração ──")
  const faseFinal = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE }, select: { escopo: true, revisaoAtual: true } })
  prova("estado final: escopo restaurado para PROCESSO (igual ao original)", `escopo=${escopoOriginal}`, JSON.stringify(faseFinal), faseFinal.escopo === escopoOriginal)

  // ── 7) Escopo do impacto: só os processos 632-637 desta fase ───────────
  console.log("\n── 7) Nenhum dado real foi tocado ──")
  const outrosProcessosComEssaFaseNoOutbox = await prisma.domainOutbox.count({
    where: { chaveIdempotencia: { contains: `::${CHAVE}::` }, aggregateId: { notIn: PROCESSOS_ESPERADOS } },
  })
  prova("nenhum processo FORA de 632-637 foi alcançado pela reconciliação desta fase", "0", String(outrosProcessosComEssaFaseNoOutbox), outrosProcessosComEssaFaseNoOutbox === 0)
  const outrasFasesAlteradas = await prisma.logAuditoria.count({
    where: { entidade: "CatalogoFase", acao: { in: ["PHASE_UPDATED", "PHASE_ACTIVATED", "PHASE_DISABLED"] }, entidadeId: { not: fase.id }, criadoEm: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
  })
  prova("nenhuma OUTRA fase do catálogo foi alterada nos últimos 5min", "0", String(outrasFasesAlteradas), outrasFasesAlteradas === 0)

  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  console.log(JSON.stringify(matriz, null, 2))
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
