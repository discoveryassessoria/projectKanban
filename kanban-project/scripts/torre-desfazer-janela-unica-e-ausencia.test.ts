// scripts/torre-desfazer-janela-unica-e-ausencia.test.ts
// ============================================================================
// TORRE NOVA (01/10/2026) — "DESFAZER" ALINHADO: UMA janela para a Torre inteira + Desfazer de "Marcar ausência".
//
//   node scripts/ci/gate-build.mjs --so torre-desfazer-janela-unica      (banco de teste descartável)
//
//   1) A janela do Desfazer mora em UM lugar (lib/operacional/torre-desfazer.ts, 24 h — o tempo do protótipo) e nenhum outro
//      arquivo declara janela própria; servidor, cliente e as portas "Precisa de você" e "Reativar (desfazer da pausa)" leem a mesma.
//   2) "Marcar ausência" tem Desfazer: cancela a ausência recém-marcada pela porta existente (o registro fica, com o fim = agora),
//      só o AUTOR, só dentro da janela e só se nada mudou depois; grava a própria auditoria. Pela rota HTTP também.
//   3) O Desfazer da cobrança (estorno) usa a mesma janela — o teste dele é torre-cobranca-estorno.test.ts.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-desfazer-janela-unica-e-ausencia.test.ts")

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { JANELA_DO_DESFAZER_MS, JANELA_DO_DESFAZER_TEXTO, dentroDaJanelaDoDesfazer } from "../lib/operacional/torre-desfazer"
import { JANELA_DO_DESFAZER_MS as JANELA_DO_SERVICO, desfazerAusenciaMarcada } from "../src/services/torre-acoes-lote"
import { abrirIndisponibilidade } from "../lib/operacional/organizacao"
import { atribuirTarefa } from "../lib/operacional/tarefa-comandos"
import { pausarProcesso } from "../src/services/processo-pausa"
import { POST as postDesfazer } from "../src/app/api/torre/tarefas/desfazer/route"
import { POST as postDesfazerPrecisa } from "../src/app/api/torre/precisa-de-voce/desfazer/route"
import { POST as postReativar } from "../src/app/api/torre/processos/[processoId]/reativar/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "DESFJAN"
const HORA = 60 * 60 * 1000
const req = (url: string, token: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const f = join(dir, n); if (statSync(f).isDirectory()) arquivos(f, acc); else if (/\.(ts|tsx)$/.test(n)) acc.push(f) }
  return acc
}

async function main() {
  secao("1) UMA constante")
  ok("24 h (o 'Desfazer disponível por 24 h' do protótipo)", JANELA_DO_DESFAZER_MS === 24 * HORA && JANELA_DO_DESFAZER_TEXTO === "24 horas")
  ok("servidor e cliente exportam a MESMA constante", JANELA_DO_SERVICO === JANELA_DO_DESFAZER_MS)
  ok("dentro / fora da janela (fronteira inclusiva)", dentroDaJanelaDoDesfazer(1000, 1000 + JANELA_DO_DESFAZER_MS) && !dentroDaJanelaDoDesfazer(1000, 1001 + JANELA_DO_DESFAZER_MS))
  const donos: string[] = []
  for (const raiz of ["src", "lib"]) for (const f of arquivos(raiz)) {
    if (f.replace(/\\/g, "/").endsWith("lib/operacional/torre-desfazer.ts")) continue
    const cod = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")
    if (/(const|let)\s+JANELA_DO_DESFAZER_MS\s*=/.test(cod) || /(const|let)\s+JANELA_DO_DESFAZER\w*\s*=\s*\d/.test(cod)) donos.push(f)
  }
  ok("nenhum outro arquivo declara janela de Desfazer própria", donos.length === 0, donos.join(", "))
  const cliente = readFileSync("src/components/torre/torre-base.tsx", "utf8")
  ok("o cliente importa a constante (não tem número próprio) e avisa com o texto único", /from "@\/lib\/operacional\/torre-desfazer"/.test(cliente) && /JANELA_DO_DESFAZER_TEXTO/.test(cliente) && !/30_000|30 segundos/.test(cliente))

  const c = await montarCenario(MARCA)
  const usuarios: number[] = []
  try {
    const mk = async (nome: string, tipo: string, perms?: Record<string, boolean>) => {
      const u = await prisma.usuario.create({ data: { nome, email: `${MARCA.toLowerCase()}-${nome.split(" ")[0].toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
      usuarios.push(u.id); return u
    }
    const admin = await mk("Marco Rovatti", "admin")
    const outro = await mk("Gestora Outra", "assistente", { "operacao.distribuirTarefas": true, "usuarios.gerenciar": true, "tarefas.editar": true, "tarefas.ver": true, "tarefas.bloquear": true })
    const daniela = await mk("Daniela Brait", "assistente")
    const tAdmin = await tokenDe(admin), tOutro = await tokenDe(outro)

    secao("2) Desfazer de MARCAR AUSÊNCIA (porta existente: encerrar a ausência)")
    const aus = await abrirIndisponibilidade({ usuarioId: daniela.id, tipo: "FERIAS", inicio: new Date(), fim: new Date(Date.now() + 9 * 24 * HORA), motivo: "teste", autorId: admin.id })
    ok("marcar ausência pela porta oficial", aus.ok === true)
    const ausenciaId = (aus as { id: number }).id
    const vigente = async () => (await prisma.indisponibilidadeOperacional.findUnique({ where: { id: ausenciaId } }))!
    const outroAutor = await desfazerAusenciaMarcada({ ausenciaId, autorId: outro.id })
    ok("OUTRA pessoa não desfaz a ausência alheia", outroAutor.ok === false && (await vigente()).fim!.getTime() > Date.now() + 8 * 24 * HORA, outroAutor.mensagem)
    const tarde = await desfazerAusenciaMarcada({ ausenciaId, autorId: admin.id, agora: new Date(Date.now() + JANELA_DO_DESFAZER_MS + 5_000) })
    ok("depois da janela única o Desfazer é recusado e a ausência segue", tarde.ok === false && (await vigente()).fim!.getTime() > Date.now() + 8 * 24 * HORA, tarde.mensagem)

    const r1 = await postDesfazer(req("/api/torre/tarefas/desfazer", tAdmin, { tipo: "AUSENCIA", tarefaIds: [], ausenciaId }))
    const j1 = await r1.json()
    const depois = await vigente()
    ok("pela rota: 200, 'Ausência de Daniela Brait desfeita.'", r1.status === 200 && j1.desfeitas === 1 && /Ausência de Daniela Brait desfeita/.test(j1.mensagem), JSON.stringify(j1).slice(0, 160))
    ok("a ausência é ENCERRADA agora (o registro fica; nada é apagado)", depois.fim != null && depois.fim.getTime() <= Date.now() + 1000 && depois.fim.getTime() >= depois.inicio.getTime())
    const logAus = await prisma.logAuditoria.findFirst({ where: { entidade: "CapacidadeOperacional", entidadeId: daniela.id, descricao: { contains: "desfeita" } }, orderBy: { id: "desc" } })
    ok("a reversão é auditada (quem desfez, qual ausência)", !!logAus && logAus.usuarioId === admin.id && (logAus.detalhes as { indisponibilidadeId?: number })?.indisponibilidadeId === ausenciaId)
    const r2 = await postDesfazer(req("/api/torre/tarefas/desfazer", tAdmin, { tipo: "AUSENCIA", tarefaIds: [], ausenciaId }))
    const j2 = await r2.json()
    ok("segundo Desfazer: recusado (nada mudou depois = a ausência já foi encerrada)", j2.desfeitas === 0 && /já foi encerrada/.test(j2.mensagem), j2.mensagem)
    const r3 = await postDesfazer(req("/api/torre/tarefas/desfazer", tAdmin, { tipo: "AUSENCIA", tarefaIds: [] }))
    ok("sem ausenciaId: 400", r3.status === 400)

    secao("Ausência encerrada por OUTRA decisão antes do Desfazer: recusa")
    const aus2 = await abrirIndisponibilidade({ usuarioId: daniela.id, tipo: "AFASTAMENTO", inicio: new Date(), fim: null, autorId: admin.id })
    const id2 = (aus2 as { id: number }).id
    await prisma.indisponibilidadeOperacional.update({ where: { id: id2 }, data: { fim: new Date(Date.now() - 1000) } })
    const r4 = await desfazerAusenciaMarcada({ ausenciaId: id2, autorId: admin.id })
    ok("já encerrada por outra decisão → 'desfazer recusado'", r4.ok === false && /já foi encerrada/.test(r4.mensagem), r4.mensagem)

    secao("Ausência sem data de retorno (aberta) e FUTURA também se desfazem")
    const aus3 = await abrirIndisponibilidade({ usuarioId: daniela.id, tipo: "AUSENCIA", inicio: new Date(Date.now() + 12 * 24 * HORA), fim: null, autorId: admin.id })
    const id3 = (aus3 as { id: number }).id
    const r5 = await desfazerAusenciaMarcada({ ausenciaId: id3, autorId: admin.id })
    const a3 = await prisma.indisponibilidadeOperacional.findUnique({ where: { id: id3 } })
    ok("ausência futura sem fim: desfeita (o intervalo fica vazio, nunca inverte)", r5.ok === true && a3!.fim != null && a3!.fim.getTime() >= a3!.inicio.getTime(), r5.mensagem)

    secao("3) A janela única vale também no 'Precisa de você' e na pausa")
    const o = await c.novaObrigacao({})
    const atrib = await atribuirTarefa({ tarefaId: o.tarefaId, responsavelId: daniela.id, autorId: admin.id })
    ok("atribuir pela porta oficial", atrib.ok === true)
    // Envelhece o fato para além da janela única: o Desfazer do Precisa de você deve recusar (e nada muda).
    await prisma.logAuditoria.updateMany({ where: { entidade: "Tarefa", entidadeId: o.tarefaId, acao: "TAREFA_ATRIBUIDA" }, data: { criadoEm: new Date(Date.now() - JANELA_DO_DESFAZER_MS - 60_000) } })
    const rp = await postDesfazerPrecisa(req("/api/torre/precisa-de-voce/desfazer", tAdmin, { tipo: "ATRIBUICAO", tarefaIds: [o.tarefaId] }))
    const jp = await rp.json()
    ok("Precisa de você: atribuição mais velha que a janela NÃO se desfaz", jp.desfeitas === 0 && /passou o tempo/.test(jp.itens[0].mensagem) && (await prisma.tarefa.findUnique({ where: { id: o.tarefaId } }))?.responsavelId === daniela.id, jp.itens[0]?.mensagem)
    await prisma.logAuditoria.updateMany({ where: { entidade: "Tarefa", entidadeId: o.tarefaId, acao: "TAREFA_ATRIBUIDA" }, data: { criadoEm: new Date() } })
    const rp2 = await postDesfazerPrecisa(req("/api/torre/precisa-de-voce/desfazer", tOutro, { tipo: "ATRIBUICAO", tarefaIds: [o.tarefaId] }))
    const jp2 = await rp2.json()
    ok("Precisa de você: OUTRA pessoa não desfaz a atribuição alheia", jp2.desfeitas === 0, jp2.itens[0]?.mensagem)
    const rp3 = await postDesfazerPrecisa(req("/api/torre/precisa-de-voce/desfazer", tAdmin, { tipo: "ATRIBUICAO", tarefaIds: [o.tarefaId] }))
    const jp3 = await rp3.json()
    ok("Precisa de você: o autor, dentro da janela, desfaz (volta à fila)", jp3.desfeitas === 1 && (await prisma.tarefa.findUnique({ where: { id: o.tarefaId } }))?.responsavelId == null)

    const o2 = await c.novaObrigacao({})
    const pz = await pausarProcesso({ processoId: o2.processoId, usuarioId: admin.id, justificativa: "teste do desfazer da pausa" })
    ok("pausar pela porta oficial", pz.ok === true)
    await prisma.processoPausa.updateMany({ where: { processoId: o2.processoId, retomadoEm: null }, data: { pausadoEm: new Date(Date.now() - JANELA_DO_DESFAZER_MS - 60_000) } })
    const ctxP = { params: Promise.resolve({ processoId: String(o2.processoId) }) }
    const rv1 = await postReativar(req(`/api/torre/processos/${o2.processoId}/reativar`, tAdmin, { desfazer: true }), ctxP)
    const jv1 = await rv1.json()
    ok("Desfazer da pausa depois da janela: 409 FORA_DA_JANELA e a pausa segue", rv1.status === 409 && jv1.codigo === "FORA_DA_JANELA" && (await prisma.processoPausa.count({ where: { processoId: o2.processoId, retomadoEm: null } })) === 1, jv1.erro)
    const rv2 = await postReativar(req(`/api/torre/processos/${o2.processoId}/reativar`, tAdmin, { justificativa: "voltou a andar" }), ctxP)
    ok("o botão 'Reativar' (sem desfazer) segue livre, mesmo depois da janela", rv2.status === 200 && (await prisma.processoPausa.count({ where: { processoId: o2.processoId, retomadoEm: null } })) === 0)
    await pausarProcesso({ processoId: o2.processoId, usuarioId: admin.id, justificativa: "pausa recente" })
    const rv3 = await postReativar(req(`/api/torre/processos/${o2.processoId}/reativar`, tOutro, { desfazer: true }), ctxP)
    ok("Desfazer da pausa por OUTRA pessoa: recusado", rv3.status === 409)
    const rv4 = await postReativar(req(`/api/torre/processos/${o2.processoId}/reativar`, tAdmin, { desfazer: true }), ctxP)
    ok("Desfazer da pausa pelo autor, dentro da janela: 200", rv4.status === 200)

    secao("4) Cobrança: o Desfazer (estorno) usa a MESMA janela única")
    const svc = readFileSync("src/services/cobranca-terceiros.ts", "utf8")
    ok("o estorno da cobrança lê a janela única (dentroDaJanelaDoDesfazer) — não tem janela própria", /dentroDaJanelaDoDesfazer\(contato\.registradoEm, agora\)/.test(svc) && !/JANELA_DO_DESFAZER_MS\s*=/.test(svc))
  } finally {
    await c.limpar()
    await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuarioId: { in: usuarios } } }).catch(() => {})
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ usuarioId: { in: usuarios } }, { entidade: "CapacidadeOperacional", entidadeId: { in: usuarios } }] } }).catch(() => {})
    await prisma.processoPausa.deleteMany({ where: { pausadoPorId: { in: usuarios } } }).catch(() => {})
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } }).catch(() => {})
  }
}

main().then(async () => {
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) console.log(falhas.join("\n"))
  await prisma.$disconnect()
  process.exit(falhou ? 1 : 0)
}).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
