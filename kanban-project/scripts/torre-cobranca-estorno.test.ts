// scripts/torre-cobranca-estorno.test.ts
// ============================================================================
// TORRE NOVA (01/10/2026) — DESFAZER "REGISTRAR COBRANÇA" = ESTORNO auditado (o fato NÃO é apagado, é MARCADO).
//
//   node scripts/ci/gate-build.mjs --so torre-cobranca-estorno      (banco de teste descartável)
//
// Prova, com banco real: (1) o "sem resposta" volta ao valor anterior e a escalada some; (2) a próxima cobrança agendada volta à anterior;
// (3) o contato fica na tabela (riscado no histórico) e nenhum leitor o conta; (4) autoria, janela de 24 h e "nada mudou depois";
// (5) o estorno é auditado; (6) as portas HTTP (Terceiros, Tarefas, órgão, lote) devolvem `desfazer` e a rota desfaz.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-cobranca-estorno.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { JANELA_DO_DESFAZER_MS } from "../lib/operacional/torre-desfazer"
import { registrarCobranca, cobrancasSemRespostaDesde } from "../src/services/subtarefas-da-etapa"
import { estornarCobranca } from "../src/services/cobranca-terceiros"
import { contatosDoPedido } from "../src/services/torre-terceiros"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { historicoDoProcesso } from "../src/services/historico-processo"
import { POST as postCobrar } from "../src/app/api/torre/terceiros/cobrar/route"
import { POST as postCobrarUma } from "../src/app/api/torre/tarefas/[tarefaId]/cobrar/route"
import { POST as postLote } from "../src/app/api/torre/tarefas/lote/route"
import { POST as postDesfazer } from "../src/app/api/torre/tarefas/desfazer/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "ESTCOB"
const DIA = 86_400_000
const req = (url: string, token: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
const vigente = (stepInstanceId: number) => prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null } })

async function main() {
  const c = await montarCenario(MARCA, { diasAposCobranca: 2, escalarApos: 2 })
  const usuarios: number[] = []
  try {
    const mk = async (nome: string, tipo: string, perms?: Record<string, boolean>) => { const u = await prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } }); usuarios.push(u.id); return u }
    const admin = await mk("Admin", "admin")
    const outro = await mk("Outro", "assistente", { "operacao.distribuirTarefas": true, "tarefas.ver": true, "tarefas.editar": true })
    const tAdmin = await tokenDe(admin), tOutro = await tokenDe(outro)
    const org = await c.novoOrgao("Cartório")

    secao("1) 'sem resposta' e próxima cobrança VOLTAM ao valor anterior")
    const a = await c.novaObrigacao({ aguardando: true, orgaoId: org.id })
    const e0 = await vigente(a.stepInstanceId)
    const proximaAntes = e0.proximoAcompanhamentoEm
    const r1 = await registrarCobranca({ stepInstanceId: a.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", registradoPorId: admin.id, orgaoId: org.id })
    const r2 = await registrarCobranca({ stepInstanceId: a.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", registradoPorId: admin.id, orgaoId: org.id, proximaEmDias: 9 })
    ok("duas cobranças sem resposta: contagem 2 e escalada ligada", r1.ok && r2.ok && (await cobrancasSemRespostaDesde(e0.id)) === 2 && (await vigente(a.stepInstanceId)).escalada === true)
    const proximaDepoisDe2 = (await vigente(a.stepInstanceId)).proximoAcompanhamentoEm
    ok("a próxima cobrança agendada é a da 2ª (9 dias)", Math.abs((proximaDepoisDe2?.getTime() ?? 0) - (Date.now() + 9 * DIA)) < 60_000)
    if (!r1.ok || !r2.ok) throw new Error("cobrança falhou")
    const ordem = await estornarCobranca({ contatoId: r1.contatoId, autorId: admin.id })
    ok("estornar a 1ª com a 2ª depois dela: RECUSADO ('nada mudou depois')", !ordem.ok && /depois desta cobrança/.test(ordem.mensagem), ordem.mensagem)
    const est2 = await estornarCobranca({ contatoId: r2.contatoId, autorId: admin.id })
    ok("estornar a 2ª (a última): ok", est2.ok, est2.mensagem)
    const apos2 = await vigente(a.stepInstanceId)
    ok("'sem resposta' volta a 1 e a escalada desliga (como estava depois da 1ª)", (await cobrancasSemRespostaDesde(e0.id)) === 1 && apos2.escalada === false)
    const c1 = await prisma.contatoTerceiro.findUniqueOrThrow({ where: { id: r1.contatoId } })
    ok("a próxima cobrança volta EXATAMENTE à que a 1ª tinha marcado", apos2.proximoAcompanhamentoEm?.getTime() === c1.depoisProximoAcompanhamentoEm?.getTime())
    const est1 = await estornarCobranca({ contatoId: r1.contatoId, autorId: admin.id })
    const apos1 = await vigente(a.stepInstanceId)
    ok("estornar a 1ª também: 'sem resposta' = 0 e a próxima cobrança = a de ANTES de qualquer cobrança", est1.ok && (await cobrancasSemRespostaDesde(e0.id)) === 0 && apos1.proximoAcompanhamentoEm?.getTime() === proximaAntes?.getTime() && apos1.escalada === false, `${apos1.proximoAcompanhamentoEm?.toISOString()} vs ${proximaAntes?.toISOString()}`)

    secao("2) o FATO fica (append-only) e nenhum leitor o conta")
    const linhas = await prisma.contatoTerceiro.findMany({ where: { tarefaId: a.tarefaId }, orderBy: { id: "asc" } })
    ok("as 2 linhas continuam na tabela, marcadas (estornadoEm + estornadoPorId)", linhas.length === 2 && linhas.every((l) => l.estornadoEm != null && l.estornadoPorId === admin.id))
    const hist = await contatosDoPedido(a.tarefaId)
    ok("o histórico do pedido mostra as cobranças RISCADAS (estornado: true)", hist!.contatos.filter((x) => x.tipo === "CONTATO").length === 2 && hist!.contatos.filter((x) => x.tipo === "CONTATO").every((x) => x.estornado === true))
    const e = await c.novaObrigacao({ aguardando: true, orgaoId: org.id })
    const re = await registrarCobranca({ stepInstanceId: e.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", registradoPorId: admin.id, orgaoId: org.id })
    const nLinha = async () => (await listarTarefasDaTorre()).linhas.find((l) => l.taskId === e.tarefaId)!.cobrancasSemResposta
    const antesDaLinha = await nLinha()
    if (re.ok) await estornarCobranca({ contatoId: re.contatoId, autorId: admin.id })
    ok("a LINHA da Torre (a que alimenta Tarefas, Terceiros, Visão geral): 'sem resposta' 1 → 0 depois do estorno", antesDaLinha === 1 && (await nLinha()) === 0, `${antesDaLinha} → ${await nLinha()}`)
    const fatos = (await historicoDoProcesso(a.processoId))!.fatos
    ok("o Histórico do processo não conta a cobrança estornada como fato", !fatos.some((f) => /cobrou/.test(f.frase)))
    const logE = await prisma.logAuditoria.count({ where: { acao: "COBRANCA_ESTORNADA", entidade: "Tarefa", entidadeId: a.tarefaId, usuarioId: admin.id } })
    ok("o estorno é AUDITADO (uma linha por cobrança estornada, com o estado devolvido)", logE === 2)
    const dup = await estornarCobranca({ contatoId: r1.contatoId, autorId: admin.id })
    ok("estornar de novo: recusado (já desfeita), sem duplicar auditoria", !dup.ok && /já foi desfeita/.test(dup.mensagem) && (await prisma.logAuditoria.count({ where: { acao: "COBRANCA_ESTORNADA", entidadeId: a.tarefaId } })) === 2)

    secao("3) autoria, janela de 24 h e 'nada mudou depois'")
    const b = await c.novaObrigacao({ aguardando: true, orgaoId: org.id })
    const rb = await registrarCobranca({ stepInstanceId: b.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA", registradoPorId: admin.id, orgaoId: org.id })
    if (!rb.ok) throw new Error("cobrança b")
    const alheio = await estornarCobranca({ contatoId: rb.contatoId, autorId: outro.id })
    ok("OUTRA pessoa não estorna a cobrança alheia", !alheio.ok && /feita por você/.test(alheio.mensagem), alheio.mensagem)
    const tarde = await estornarCobranca({ contatoId: rb.contatoId, autorId: admin.id, agora: new Date(Date.now() + JANELA_DO_DESFAZER_MS + 5_000) })
    ok("depois da janela única de 24 h: recusado", !tarde.ok && /passou o tempo/.test(tarde.mensagem), tarde.mensagem)
    await prisma.subtaskExecution.update({ where: { id: (await vigente(b.stepInstanceId)).id }, data: { proximoAcompanhamentoEm: new Date(Date.now() + 40 * DIA) } })
    const mudou = await estornarCobranca({ contatoId: rb.contatoId, autorId: admin.id })
    ok("a próxima cobrança foi reagendada por outra decisão: recusado", !mudou.ok && /reagendada/.test(mudou.mensagem), mudou.mensagem)
    ok("e nada foi marcado nem restaurado", (await prisma.contatoTerceiro.findUniqueOrThrow({ where: { id: rb.contatoId } })).estornadoEm == null)

    secao("4) as portas devolvem `desfazer` e a rota desfaz")
    const d1 = await c.novaObrigacao({ aguardando: true, orgaoId: org.id }), d2 = await c.novaObrigacao({ aguardando: true, orgaoId: org.id }), d3 = await c.novaObrigacao({ aguardando: true, orgaoId: org.id })
    const antes = (await vigente(d1.stepInstanceId)).proximoAcompanhamentoEm
    const jT = await (await postCobrar(req("/api/torre/terceiros/cobrar", tAdmin, { tarefaIds: [d1.tarefaId, d2.tarefaId], proximaEmDias: 7 }))).json()
    ok("Terceiros › Cobrar devolve desfazer { COBRANCA, contatoIds (2) }", jT.cobradas === 2 && jT.desfazer?.tipo === "COBRANCA" && jT.desfazer.contatoIds.length === 2)
    const rD = await postDesfazer(req("/api/torre/tarefas/desfazer", tAdmin, jT.desfazer)); const jD = await rD.json()
    ok("a rota estorna as 2 e a próxima cobrança volta", rD.status === 200 && jD.desfeitas === 2 && (await vigente(d1.stepInstanceId)).proximoAcompanhamentoEm?.getTime() === antes?.getTime())
    const jU = await (await postCobrarUma(req(`/api/torre/tarefas/${d3.tarefaId}/cobrar`, tAdmin, { observacao: "cobrança de teste" }), { params: Promise.resolve({ tarefaId: String(d3.tarefaId) }) })).json()
    ok("Tarefas › Registrar cobrança (uma) devolve desfazer", jU.ok === true && jU.desfazer?.tipo === "COBRANCA" && jU.desfazer.contatoIds.length === 1)
    const jOutro = await (await postDesfazer(req("/api/torre/tarefas/desfazer", tOutro, jU.desfazer))).json()
    ok("pela rota, OUTRA pessoa não desfaz", jOutro.desfeitas === 0)
    const jL = await (await postLote(req("/api/torre/tarefas/lote", tAdmin, { acao: "COBRAR", tarefaIds: [d3.tarefaId] }))).json()
    ok("Tarefas › lote 'Cobrar cartório' devolve desfazer", jL.sucesso === 1 && jL.desfazer?.tipo === "COBRANCA" && jL.desfazer.contatoIds.length === 1, JSON.stringify(jL).slice(0, 200))
    const jD2 = await (await postDesfazer(req("/api/torre/tarefas/desfazer", tAdmin, jL.desfazer))).json()
    ok("e o lote se desfaz", jD2.desfeitas === 1)
    ok("sem contatoIds: 400", (await postDesfazer(req("/api/torre/tarefas/desfazer", tAdmin, { tipo: "COBRANCA" }))).status === 400)
  } finally {
    await c.limpar()
    await prisma.logAuditoria.deleteMany({ where: { usuarioId: { in: usuarios } } }).catch(() => {})
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } }).catch(() => {})
  }
}

main().then(async () => {
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) console.log(falhas.join("\n"))
  await prisma.$disconnect()
  process.exit(falhou ? 1 : 0)
}).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
