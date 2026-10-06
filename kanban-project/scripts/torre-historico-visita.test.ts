// scripts/torre-historico-visita.test.ts
// ============================================================================
// "NOVO DESDE A ÚLTIMA VISITA" — a última visita é guardada POR USUÁRIO E PROCESSO (um registro por par, atualizado a cada visita), não entra na
// lista de fatos nem na auditoria de processo, e a rota da janela (`?visao=linha`) a devolve. Banco de TESTE:
//   node scripts/ci/gate-build.mjs --so torre-historico-visita
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-historico-visita.test.ts")

import { prisma } from "../lib/prisma"
import { getHistorico, postHistorico, ultimaVisitaDoUsuario, type UsuarioDoHistorico } from "../src/lib/historico-rota"
import { NATUREZA_DA_ACAO } from "../lib/operacional/torre-auditoria"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const MARCA = "VISITA-TEST"
const req = (q = "", metodo = "GET", corpo?: unknown) => new Request(`http://t/h${q}`, { method: metodo, ...(corpo !== undefined ? { body: JSON.stringify(corpo), headers: { "content-type": "application/json" } } : {}) })

async function main() {
  const u1 = await prisma.usuario.create({ data: { nome: `${MARCA} Um`, email: `${MARCA.toLowerCase()}-1@t.t`, senha: "x", tipo: "admin" }, select: { id: true } })
  const u2 = await prisma.usuario.create({ data: { nome: `${MARCA} Dois`, email: `${MARCA.toLowerCase()}-2@t.t`, senha: "x", tipo: "admin" }, select: { id: true } })
  const p1 = await prisma.processo.create({ data: { nome: `${MARCA} A` }, select: { id: true } })
  const p2 = await prisma.processo.create({ data: { nome: `${MARCA} B` }, select: { id: true } })
  const dono = (id: number): UsuarioDoHistorico => ({ userId: id, nome: "t", permissoes: {} })
  try {
    ok("sem visita registrada: nenhuma última visita", (await ultimaVisitaDoUsuario(p1.id, u1.id)) === null)
    const r0 = await getHistorico(req("?visao=linha"), p1.id, dono(u1.id))
    const j0 = await r0.json()
    ok("a rota da janela devolve 'ultimaVisita' (null na primeira vez)", r0.status === 200 && "ultimaVisita" in j0 && j0.ultimaVisita === null)
    ok("GET não registra visita (só o POST depois que a janela montou o que é novo)", (await ultimaVisitaDoUsuario(p1.id, u1.id)) === null)

    const antes = Date.now()
    ok("POST { visita: true } registra", (await postHistorico(req("", "POST", { visita: true }), p1.id, dono(u1.id))).status === 200)
    const v1 = await ultimaVisitaDoUsuario(p1.id, u1.id)
    ok("a visita fica guardada", v1 != null && Date.parse(v1) >= antes - 1000)
    ok("é POR USUÁRIO (outro usuário, mesmo processo: nada)", (await ultimaVisitaDoUsuario(p1.id, u2.id)) === null)
    ok("é POR PROCESSO (mesmo usuário, outro processo: nada)", (await ultimaVisitaDoUsuario(p2.id, u1.id)) === null)

    await new Promise((r) => setTimeout(r, 15))
    await postHistorico(req("", "POST", { visita: true }), p1.id, dono(u1.id))
    const v2 = await ultimaVisitaDoUsuario(p1.id, u1.id)
    ok("nova visita atualiza (a mais recente vale)", v2 != null && v1 != null && Date.parse(v2) > Date.parse(v1))
    ok("um registro só por par usuário × processo (não vira uma linha por visita)", (await prisma.logAuditoria.count({ where: { acao: "HISTORICO_VISITADO", entidade: "Processo", entidadeId: p1.id, usuarioId: u1.id } })) === 1)

    const r1 = await getHistorico(req("?visao=linha"), p1.id, dono(u1.id))
    const j1 = await r1.json()
    ok("a rota devolve a visita do usuário que pediu", j1.ultimaVisita === v2)
    ok("a visita NÃO aparece como fato do histórico", !j1.fatos.some((f: { frase: string }) => /visita/i.test(f.frase)) && (j1.descartados?.["Processo:HISTORICO_VISITADO"] ?? 0) >= 1)
    ok("a visita é fato de SISTEMA na auditoria (não polui o histórico de processo)", NATUREZA_DA_ACAO("HISTORICO_VISITADO", "Processo") === "SISTEMA")
    ok("a aba Histórico (sem visao=linha) não traz 'ultimaVisita'", !("ultimaVisita" in (await (await getHistorico(req(""), p1.id, dono(u1.id))).json())))
    ok("exportar PDF 'para o cliente' é registrado na auditoria", (await postHistorico(req("", "POST", { formato: "pdf-cliente", filtros: "para o cliente", linhas: 4 }), p1.id, dono(u1.id))).status === 200 && (await prisma.logAuditoria.count({ where: { acao: "HISTORICO_EXPORTADO", entidadeId: p1.id } })) === 1)
    ok("processo que não existe: 404", (await postHistorico(req("", "POST", { visita: true }), 99999999, dono(u1.id))).status === 404)
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: [p1.id, p2.id] }, entidade: "Processo", acao: { in: ["HISTORICO_VISITADO", "HISTORICO_EXPORTADO"] } } }).catch(() => {})
    await prisma.processo.deleteMany({ where: { id: { in: [p1.id, p2.id] } } }).catch(() => {})
    await prisma.usuario.deleteMany({ where: { id: { in: [u1.id, u2.id] } } }).catch(() => {})
  }
}
main().then(async () => {
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  await prisma.$disconnect(); process.exit(falhou ? 1 : 0)
}).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
