// scripts/catalogo-fases-aguardando-fechamento.test.ts
// ============================================================================
// CATÁLOGO DE FASES × "AGUARDANDO FECHAMENTO" (a_iniciar) — a ÚNICA exceção que o pedido abriu no módulo fechado:
//   • publicar a_iniciar SEM efeito marcado é permitido (fase sem tarefas por desenho) — e SÓ ela: qualquer outra fase continua
//     exigindo pelo menos um efeito (EFEITOS_OBRIGATORIOS_PARA_PUBLICAR);
//   • a reconciliação que a edição do catálogo enfileira NÃO cria instância de a_iniciar para processo que já passou dela;
//   • ordemPadrao 0 é aceita pela API (a_iniciar fica ANTES de Genealogia = 1).
//   npx tsx scripts/catalogo-fases-aguardando-fechamento.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("catalogo-fases-aguardando-fechamento.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { garantirOferta } from "./_fixture-oferta"
import { PUT as putFase } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { processarOutbox } from "../src/services/outbox-dispatcher"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const MARCA = "CATAGF"

async function main() {
  const admin = await prisma.usuario.create({ data: { nome: "Admin CatAgf", email: "admin@catagf.test", senha: "x", tipo: "admin" }, select: { id: true, email: true, tipo: true } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
  const put = (id: number, body: unknown) => putFase(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) })
  try {
    await prisma.catalogoFase.deleteMany({ where: { phaseKey: { in: ["a_iniciar", `${MARCA.toLowerCase()}_outra`] } } })
    const ai = await prisma.catalogoFase.create({ data: { phaseKey: "a_iniciar", label: "A iniciar", ordemPadrao: 161, ativo: false, status: "INATIVA", escopo: "PROCESSO", requiredPadrao: true, efeitosPermitidos: [] } })
    const outra = await prisma.catalogoFase.create({ data: { phaseKey: `${MARCA.toLowerCase()}_outra`, label: "Outra", ordemPadrao: 50, ativo: false, status: "RASCUNHO", escopo: "PROCESSO", efeitosPermitidos: [] } })

    console.log("\nA exceção é só de a_iniciar")
    const rOutra = await put(outra.id, { ativo: true })
    ok("OUTRA fase sem efeito marcado continua RECUSADA (400 EFEITOS_OBRIGATORIOS_PARA_PUBLICAR)", rOutra.status === 400 && ((await rOutra.json()) as { code?: string }).code === "EFEITOS_OBRIGATORIOS_PARA_PUBLICAR")
    const rAi = await put(ai.id, { ativo: true, label: "Aguardando fechamento", ordemPadrao: 0, requiredPadrao: false })
    const j = await rAi.json() as { fase?: { ordemPadrao: number; status: string; label: string; revisaoAtual: number } }
    ok("a_iniciar SEM efeito é PUBLICADA (200), com ordem 0 aceita e o novo rótulo", rAi.status === 200 && j.fase?.status === "PUBLICADA" && j.fase.ordemPadrao === 0 && j.fase.label === "Aguardando fechamento" && j.fase.revisaoAtual === 2, JSON.stringify(j).slice(0, 160))
    ok("a edição congelou revisão (CatalogoFaseRevisao) e auditou", (await prisma.catalogoFaseRevisao.count({ where: { catalogoFaseId: ai.id, revisao: 2 } })) === 1 && (await prisma.logAuditoria.count({ where: { entidade: "CatalogoFase", entidadeId: ai.id, acao: "PHASE_ACTIVATED" } })) === 1)

    console.log("\nA reconciliação do catálogo não cria instância de a_iniciar para quem já passou dela")
    const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_PAIS`, modalityKey: "administrativa" })
    const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_T`, name: `${MARCA} T`, paisId: oferta.paisId }, select: { id: true } })
    const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro` }, select: { id: true } })
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "a_iniciar", label: "Aguardando fechamento", ordem: 0, required: false } })
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "genealogia", label: "Genealogia", ordem: 1 } })
    const proc = await prisma.processo.create({ data: { nome: `${MARCA} p`, workflowRuntime: "v2", faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId }, select: { id: true } })
    const rEd = await put(ai.id, { descricao: "Pré-trabalho: espera o fechamento do contrato." })
    ok("editar a_iniciar de novo (enfileira a reconciliação do catálogo): 200", rEd.status === 200)
    const enfileirados = await prisma.domainOutbox.count({ where: { tipo: "catalogo.fase.reconciliar", aggregateId: proc.id } })
    await processarOutbox({ tipos: ["catalogo.fase.reconciliar"], limite: 100 })
    ok("o processo em genealogia foi ALCANÇADO pela fila…", enfileirados >= 1, String(enfileirados))
    ok("…e mesmo assim NENHUMA instância de a_iniciar nasceu para ele (nem tarefa)", (await prisma.phaseWorkflowInstance.count({ where: { processoId: proc.id, faseMacroKey: "a_iniciar" } })) === 0 && (await prisma.tarefa.count({ where: { processoId: proc.id } })) === 0)
    ok("e o processo não saiu de genealogia", (await prisma.processo.findUniqueOrThrow({ where: { id: proc.id }, select: { faseAtualKey: true } })).faseAtualKey === "genealogia")
    await prisma.domainOutbox.deleteMany({ where: { aggregateId: proc.id, aggregateType: "Processo" } })
    await prisma.workflowEvento.deleteMany({ where: { processoId: proc.id } })
    await prisma.processo.delete({ where: { id: proc.id } })
    await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: macro.id } })
    await prisma.macroWorkflow.delete({ where: { id: macro.id } })
    await prisma.tipoProcessoNacionalidade.delete({ where: { id: tipo.id } })
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { entidade: "CatalogoFase" } })
    await prisma.catalogoFaseRevisao.deleteMany({ where: { phaseKey: { in: ["a_iniciar", `${MARCA.toLowerCase()}_outra`] } } })
    await prisma.catalogoFase.deleteMany({ where: { phaseKey: { in: ["a_iniciar", `${MARCA.toLowerCase()}_outra`] } } })
    await prisma.usuario.deleteMany({ where: { email: "admin@catagf.test" } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
