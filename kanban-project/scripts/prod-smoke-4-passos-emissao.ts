/**
 * SMOKE DE PRODUÇÃO — validação pós-deploy da correção "4 passos operacionais"
 * (unificação conferir_certidao + validar_certidao em conferir_e_validar_certidao).
 *
 * Exercita o CAMINHO REAL (HTTP + middleware + JWT + permissões) com o usuário
 * real dono das Tarefas reconciliadas (Daniela Brait, id=12) e com o Admin.
 * Só LEITURA — nenhuma mutação.
 *
 * Rodar: npx tsx scripts/prod-smoke-4-passos-emissao.ts
 */
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
for (const arquivo of [".env.local", ".env"]) {
  const caminho = join(AQUI, "..", arquivo)
  if (!existsSync(caminho)) continue
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const BASE = process.env.SMOKE_BASE_URL ?? "https://app.discovery.com.br"
let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const { signAuthToken } = await import("@/lib/auth-jwt")

  console.log(`SMOKE DE PRODUÇÃO — 4 passos operacionais (Emissão Documental) · ${BASE}\n`)

  const daniela = await prisma.usuario.findUniqueOrThrow({ where: { id: 12 }, select: { id: true, nome: true, email: true, tipo: true } })
  const tokenDaniela = await signAuthToken({ userId: daniela.id, email: daniela.email, tipo: daniela.tipo })
  const headersDaniela = { "Content-Type": "application/json", Authorization: `Bearer ${tokenDaniela}` }

  // Tarefa 3566 · documento 2134 · reconciliada, passo unificado DISPONIVEL
  const doc = 2134
  console.log(`(1) GET workflow do documento ${doc} (Daniela):`)
  const res = await fetch(`${BASE}/api/documentos/${doc}/workflow`, { headers: headersDaniela })
  chk(res.ok, `1. responde 200 (recebido ${res.status})`)
  const corpo = (await res.json()) as { workflow?: { steps?: Array<{ id: number; stepKey: string; status: string; editor?: { kind: string; especifico: boolean } }> } }
  const passos = corpo.workflow?.steps ?? []
  chk(passos.length === 4, `2. workflow tem EXATAMENTE 4 passos (recebido ${passos.length}) — nunca 5`)
  chk(!passos.some((p) => p.stepKey === "conferir_certidao" || p.stepKey === "validar_certidao"),
    "3. nenhum passo antigo (conferir_certidao/validar_certidao) sobrevive")
  const passo4 = passos.find((p) => p.stepKey === "conferir_e_validar_certidao")
  chk(!!passo4, "4. passo 4 é 'conferir_e_validar_certidao'")
  chk(passo4?.editor?.kind === "conferencia_e_validacao" && passo4?.editor?.especifico === true,
    `5. editor específico resolvido em produção (kind=${passo4?.editor?.kind})`)
  chk(passo4?.status === "em_andamento", `6. passo 4 disponível para ação (status projetado 'em_andamento', recebido ${passo4?.status})`)

  console.log(`\n(2) GET execução do passo unificado ${passo4?.id} (Daniela, dona da Tarefa):`)
  const res2 = await fetch(`${BASE}/api/workflow-step-instances/${passo4?.id}/execucao`, { headers: headersDaniela })
  chk(res2.ok, `7. responde 200 (recebido ${res2.status})`)
  const corpo2 = (await res2.json()) as {
    configuracao?: { regraDeConclusao?: string }
    subtarefas?: Array<{ key: string; disponivel: boolean; concluida: boolean; definicao: { acoes: unknown[]; checkItens: unknown[]; campos: unknown[] } }>
  }
  chk(corpo2.configuracao?.regraDeConclusao === "TODAS_SUBTAREFAS_OBRIGATORIAS",
    `8. regra de conclusão é TODAS_SUBTAREFAS_OBRIGATORIAS (recebido ${corpo2.configuracao?.regraDeConclusao})`)
  const subs = corpo2.subtarefas ?? []
  chk(subs.length === 2, `9. exatamente 2 subtarefas internas (conferência + validação) — recebido ${subs.length}`)
  const conf = subs.find((s) => s.key === "conferencia")
  const val = subs.find((s) => s.key === "validacao_juridica")
  chk(!!conf && conf.disponivel === true && conf.concluida === false, "10. subtarefa 'conferencia' disponível, não concluída")
  chk(!!val && val.disponivel === false && val.concluida === false, "11. subtarefa 'validacao_juridica' bloqueada (depende de conferência) — sem 5º passo materializado")
  chk((conf?.definicao.checkItens.length ?? 0) === 5, `12. checklist da conferência migrado (5 itens, recebido ${conf?.definicao.checkItens.length})`)
  chk((val?.definicao.campos.length ?? 0) >= 1, `13. campos da validação (parecer/motivo) presentes, recebido ${val?.definicao.campos.length}`)

  // ── ADMIN também enxerga (autoridade de Marco preservada, sem 5º passo) ──
  console.log("\n(3) Admin (Marco) também acessa o mesmo passo 4:")
  const admin = await prisma.usuario.findFirstOrThrow({ where: { tipo: "admin" }, orderBy: { id: "asc" }, select: { id: true, nome: true, email: true, tipo: true } })
  const tokenAdmin = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo })
  const res3 = await fetch(`${BASE}/api/documentos/${doc}/workflow`, { headers: { Authorization: `Bearer ${tokenAdmin}` } })
  chk(res3.ok, `14. Admin GET workflow responde 200 (recebido ${res3.status})`)
  const corpo3 = (await res3.json()) as { workflow?: { steps?: Array<{ stepKey: string }> } }
  chk((corpo3.workflow?.steps?.length ?? 0) === 4, `15. Admin também vê exatamente 4 passos`)

  // ── Tarefas concluídas/canceladas (histórico) continuam com 5 — intocadas ──
  console.log("\n(4) Histórico legítimo (Tarefa concluída 5/5) permanece intocado:")
  const docHistorico = 2129 // Tarefa 3561, CONCLUIDO_RECEBIDO, 5/5 real
  const res4 = await fetch(`${BASE}/api/documentos/${docHistorico}/workflow`, { headers: { Authorization: `Bearer ${tokenAdmin}` } })
  const corpo4 = (await res4.json()) as { workflow?: { steps?: Array<{ stepKey: string; status: string }> } }
  const passosHist = corpo4.workflow?.steps ?? []
  chk(passosHist.length === 5, `16. Tarefa histórica concluída preserva 5 passos (recebido ${passosHist.length}) — histórico não reescrito`)
  chk(passosHist.every((p) => p.status === "concluida"), "17. todos os 5 passos históricos continuam concluídos")

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
}

main()
  .then(() => {
    if (fail > 0) process.exit(1)
    console.log("\nSmoke de produção: 4 passos operacionais validados ✅")
  })
  .catch((e) => { console.error(e); process.exit(1) })
