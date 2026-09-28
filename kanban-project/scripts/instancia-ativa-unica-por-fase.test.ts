// scripts/instancia-ativa-unica-por-fase.test.ts
//
// PROC-005 — SÓ UMA PhaseWorkflowInstance ATIVA POR (processo, fase).
//
// Achado real (processo 651, 26-28/09/2026): `movePhaseManual` mintava um ciclo novo
// (`proximoCiclo`) sem checar se a fase-destino já tinha uma instância ATIVO parada
// de uma visita anterior nunca fechada. A fase "genealogia" ficou com DUAS
// instâncias ATIVO ao mesmo tempo (#485 real, #494 órfã) — a fase nunca fechava
// limpa porque nenhuma reconciliação pensa em procurar uma SEGUNDA instância ativa
// da mesma fase.
//
// Duas camadas de correção, as duas provadas aqui:
//   (A) aplicação — `cicloAlvoParaFase` reaproveita o ciclo da instância ATIVA em
//       vez de mintar uma nova, quando a fase-destino é DIFERENTE da atual.
//   (B) banco — índice único parcial `PhaseWorkflowInstance_uma_ativa_por_fase`
//       (migration 20260928200000) impede FISICAMENTE uma segunda linha
//       ATIVO/BLOQUEADO/AGUARDANDO para a mesma (processoId, faseMacroKey), mesmo
//       que uma checagem de aplicação futura esqueça de chamar (A) — inclusive sob
//       concorrência real (duas escritas ao mesmo tempo).
//
// ESCREVE NO BANCO — só roda no banco de teste local.
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { cicloAlvoParaFase, proximoCiclo } from "@/src/lib/motor/phase-advance"

const MARCA = "PROC005-UNICA"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}
const secao = (s: string) => console.log(`\n${s}`)

async function limpar(processoId: number) {
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId } })
  await prisma.processo.deleteMany({ where: { id: processoId } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
}

async function montarProcesso(sufixo: string) {
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${sufixo}`, arvoreId: arv.id }, select: { id: true } })
  return proc.id
}

const novaInstancia = (processoId: number, faseMacroKey: string, ciclo: number, status: "ATIVO" | "BLOQUEADO" | "AGUARDANDO" | "CONCLUIDO" | "SUPERSEDIDO") =>
  prisma.phaseWorkflowInstance.create({
    data: {
      processoId, faseMacroKey, ciclo, status,
      chaveIdempotencia: `${MARCA}|proc${processoId}|${faseMacroKey}|c${ciclo}`,
    },
    select: { id: true },
  })

async function main() {
  exigirBancoDeTeste("prova que só existe UMA PhaseWorkflowInstance ativa por (processo, fase)")

  console.log("SÓ UMA INSTÂNCIA ATIVA POR (PROCESSO, FASE) — PROC-005\n")

  // ═══════════════════════════════════════════════════════════════════════
  secao("A) cicloAlvoParaFase REAPROVEITA a instância ATIVA — não minta um ciclo irmão")
  // ═══════════════════════════════════════════════════════════════════════
  const procA = await montarProcesso("A")
  await limpar(procA)
  const p1 = await montarProcesso("A")
  const inst1 = await novaInstancia(p1, "genealogia", 1, "ATIVO")
  const alvo1 = await cicloAlvoParaFase(p1, "genealogia")
  t(alvo1 === 1, "com a fase já ATIVO em ciclo 1, o alvo é o MESMO ciclo 1 (reaproveita)", `alvo=${alvo1}`)

  // Simula exatamente o bug: proximoCiclo (a função antiga, ainda existe p/ reopenPhase)
  // continuaria mintando 2 mesmo com #485-equivalente ainda ATIVO.
  const alvoAntigo = await proximoCiclo(p1, "genealogia")
  t(alvoAntigo === 2, "proximoCiclo (a função crua) ainda mintaria ciclo 2 — é exatamente o bug que cicloAlvoParaFase evita", `${alvoAntigo}`)

  // Uma vez CONCLUÍDA, uma revisita nova precisa mintar ciclo novo — não reusar a morta.
  await prisma.phaseWorkflowInstance.update({ where: { id: inst1.id }, data: { status: "CONCLUIDO" } })
  const alvo2 = await cicloAlvoParaFase(p1, "genealogia")
  t(alvo2 === 2, "com a única instância CONCLUÍDA (não mais ativa), o alvo passa a ser ciclo 2 (novo, não reusa a morta)", `alvo=${alvo2}`)
  await limpar(p1)

  // ═══════════════════════════════════════════════════════════════════════
  secao("B) O índice único parcial IMPEDE fisicamente uma segunda instância ativa")
  // ═══════════════════════════════════════════════════════════════════════
  const p2 = await montarProcesso("B")
  await novaInstancia(p2, "genealogia", 1, "ATIVO")
  let bloqueado = false
  let codigoErro: string | undefined
  try {
    await novaInstancia(p2, "genealogia", 2, "ATIVO")
  } catch (e) {
    bloqueado = true
    codigoErro = (e as { code?: string })?.code
  }
  t(bloqueado, "criar uma SEGUNDA instância ATIVO pra mesma (processo, fase) é REJEITADO pelo banco", `code=${codigoErro}`)
  t(codigoErro === "P2002", "o erro é de violação de constraint única (P2002), não outra coisa", `code=${codigoErro}`)
  t((await prisma.phaseWorkflowInstance.count({ where: { processoId: p2, faseMacroKey: "genealogia", status: "ATIVO" } })) === 1,
    "depois da tentativa rejeitada, continua existindo EXATAMENTE UMA instância ATIVO")

  // BLOQUEADO/AGUARDANDO também contam como "ativa" pro índice — não só ATIVO.
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: p2, faseMacroKey: "genealogia" }, data: { status: "BLOQUEADO" } })
  let bloqueado2 = false
  try { await novaInstancia(p2, "genealogia", 2, "AGUARDANDO") } catch { bloqueado2 = true }
  t(bloqueado2, "BLOQUEADO já conta como ativa — uma segunda em AGUARDANDO também é rejeitada")
  await limpar(p2)

  // ═══════════════════════════════════════════════════════════════════════
  secao("C) CONCORRÊNCIA REAL — duas escritas simultâneas: uma vence, a outra é rejeitada pelo banco (não pela aplicação)")
  // ═══════════════════════════════════════════════════════════════════════
  const p3 = await montarProcesso("C")
  const resultados = await Promise.allSettled([
    novaInstancia(p3, "genealogia", 1, "ATIVO"),
    novaInstancia(p3, "genealogia", 2, "ATIVO"),
  ])
  const sucesso = resultados.filter((r) => r.status === "fulfilled").length
  const rejeitado = resultados.filter((r) => r.status === "rejected").length
  t(sucesso === 1 && rejeitado === 1, "sob concorrência real (Promise.allSettled), exatamente UMA das duas escritas vence", `sucesso=${sucesso} rejeitado=${rejeitado}`)
  t((await prisma.phaseWorkflowInstance.count({ where: { processoId: p3, faseMacroKey: "genealogia", status: "ATIVO" } })) === 1,
    "e o banco fecha com EXATAMENTE UMA instância ATIVO — não duas, não zero")
  await limpar(p3)

  // ═══════════════════════════════════════════════════════════════════════
  secao("D) Fases DIFERENTES do MESMO processo continuam livres — o índice é POR FASE")
  // ═══════════════════════════════════════════════════════════════════════
  const p4 = await montarProcesso("D")
  await novaInstancia(p4, "genealogia", 1, "ATIVO")
  let genealogiaEEmissao = false
  try {
    await novaInstancia(p4, "emissao_documental", 1, "ATIVO")
    genealogiaEEmissao = true
  } catch { /* não deveria cair aqui */ }
  t(genealogiaEEmissao, "genealogia ATIVO + emissao_documental ATIVO no MESMO processo — permitido (fases diferentes)")
  t((await prisma.phaseWorkflowInstance.count({ where: { processoId: p4, status: "ATIVO" } })) === 2,
    "as duas coexistem — o índice nunca restringiu o processo inteiro, só (processo, fase)")
  await limpar(p4)

  // ═══════════════════════════════════════════════════════════════════════
  secao("E) Sequência normal continua livre — encerrar e abrir de novo nunca esbarra no índice")
  // ═══════════════════════════════════════════════════════════════════════
  const p5 = await montarProcesso("E")
  const e1 = await novaInstancia(p5, "genealogia", 1, "ATIVO")
  await prisma.phaseWorkflowInstance.update({ where: { id: e1.id }, data: { status: "CONCLUIDO" } })
  let segundaAposConcluir = false
  try {
    await novaInstancia(p5, "genealogia", 2, "ATIVO")
    segundaAposConcluir = true
  } catch { /* não deveria cair aqui */ }
  t(segundaAposConcluir, "depois de CONCLUIR a instância anterior, abrir uma nova ATIVO funciona normalmente")
  await limpar(p5)

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
