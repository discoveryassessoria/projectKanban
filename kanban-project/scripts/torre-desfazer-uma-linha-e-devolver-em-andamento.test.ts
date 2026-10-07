// scripts/torre-desfazer-uma-linha-e-devolver-em-andamento.test.ts
// ============================================================================
// TORRE — 30/09/2026, três achados do processo 651 (produção):
//
//   ITEM 11 — o DESFAZER gravava DUAS linhas (`TAREFA_PRIORIDADE_ALTERADA` + `..._DESFEITA`;
//             idem prazo: `TAREFA_PRAZO_ALTERADO` + `..._DESFEITA`). Agora grava UMA: a DESFEITA,
//             com de/para no detalhe. Um segundo Desfazer é recusado. A auditoria e o Andamento
//             continuam legíveis.
//   ITEM 2c — tirar o responsável de uma tarefa EM_ANDAMENTO (devolverAFila / redistribuir para
//             ninguém) exige `confirmarTarefaEmAndamento: true`; sem ele, erro com código próprio
//             e NADA muda. (#3834/#3845/#3850 ficaram EM_ANDAMENTO sem dono após um "devolver à fila".)
//   ITEM 2b — a tela nunca rotula EM_ANDAMENTO sem dono como "A iniciar" e oferece "Continuar".
//
//   node scripts/ci/gate-build.mjs --so torre-desfazer-uma-linha-e-devolver-em-andamento   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-desfazer-uma-linha-e-devolver-em-andamento.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { prioridadeAltaEmLote, repactuarEmLote, desfazerLote } from "../src/services/torre-acoes-lote"
import { devolverAFila } from "../lib/operacional/tarefa-ciclo"
import { redistribuirTarefas } from "../lib/operacional/tarefa-comandos"
import { consultarAuditoria } from "../lib/operacional/torre-auditoria"
import { passoLabelDe, statusTarefaTxt, acaoDe, aIniciarEfetivo, emAndamentoSemDono } from "../src/components/operacao/operacao-v3-derivacoes"
import type { LinhaOperacaoV3 } from "../src/components/operacao/operacao-v3-tipos"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "TORREDEV"

async function main() {
  const c = await montarCenario(MARCA)
  const dia = 86_400_000
  try {
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-admin@t.com`, senha: "x", tipo: "admin" } })
    const ana = await prisma.usuario.create({ data: { nome: `${MARCA} Ana`, email: `${MARCA.toLowerCase()}-ana@t.com`, senha: "x", tipo: "assistente" } })
    const prazoInicial = new Date(Date.now() + 10 * dia)
    const [o1, o2, o3, o4] = [await c.novaObrigacao({ dataPrazo: prazoInicial }), await c.novaObrigacao({ dataPrazo: prazoInicial }), await c.novaObrigacao({ dataPrazo: prazoInicial }), await c.novaObrigacao({ dataPrazo: prazoInicial })]
    const [t1, t2, t3, t4] = [o1.tarefaId, o2.tarefaId, o3.tarefaId, o4.tarefaId]
    const linhasDe = (ids: number[], acao: string) => prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: { in: ids }, acao }, orderBy: { id: "asc" } })

    secao("ITEM 11 — Desfazer PRIORIDADE grava UMA linha (a DESFEITA)")
    const antes = (await prisma.tarefa.findUniqueOrThrow({ where: { id: t1 } })).prioridade
    const p = await prioridadeAltaEmLote({ tarefaIds: [t1, t2], autorId: admin.id })
    ok("prioridade alta aplicada", p.sucesso === 2)
    const altAntes = (await linhasDe([t1, t2], "TAREFA_PRIORIDADE_ALTERADA")).length
    ok("a ação gravou 1 linha ALTERADA por tarefa", altAntes === 2)
    const d = await desfazerLote({ tipo: "PRIORIDADE", tarefaIds: [t1, t2], autorId: admin.id })
    ok("desfez as duas", d.desfeitas === 2)
    ok("prioridade restaurada", (await prisma.tarefa.findMany({ where: { id: { in: [t1, t2] } } })).every((t) => t.prioridade === antes))
    ok("o Desfazer NÃO gravou nova ALTERADA (continuam só as 2 da ação)", (await linhasDe([t1, t2], "TAREFA_PRIORIDADE_ALTERADA")).length === 2)
    const desf = await linhasDe([t1, t2], "TAREFA_PRIORIDADE_DESFEITA")
    ok("gravou exatamente 1 DESFEITA por tarefa", desf.length === 2)
    const dd = desf[0].detalhes as { de?: string; para?: string; revertidoDe?: string; revertidoPara?: string }
    ok("a DESFEITA carrega antes/depois no detalhe", dd.de === "ALTA" && dd.para === antes && dd.revertidoDe === "ALTA" && dd.revertidoPara === antes, JSON.stringify(dd))
    ok("descrição legível", /restaurada: ALTA → /.test(desf[0].descricao))
    const de2 = await desfazerLote({ tipo: "PRIORIDADE", tarefaIds: [t1, t2], autorId: admin.id })
    ok("segundo Desfazer é recusado (já desfeita) e não grava nada", de2.desfeitas === 0 && (await linhasDe([t1, t2], "TAREFA_PRIORIDADE_DESFEITA")).length === 2)
    // nova ação depois do desfazer volta a poder ser desfeita
    const p2 = await prioridadeAltaEmLote({ tarefaIds: [t1], autorId: admin.id })
    const d3 = await desfazerLote({ tipo: "PRIORIDADE", tarefaIds: p2.desfazer!.tarefaIds, autorId: admin.id })
    ok("nova ação depois do desfazer se desfaz de novo", d3.desfeitas === 1 && (await linhasDe([t1], "TAREFA_PRIORIDADE_DESFEITA")).length === 2)

    secao("ITEM 11 — Desfazer PRAZO grava UMA linha (a DESFEITA)")
    const novo = new Date(Date.now() + 20 * dia)
    const r = await repactuarEmLote({ tarefaIds: [t3, t4], novoPrazo: novo, justificativa: "teste do desfazer", autorId: admin.id })
    ok("repactuado", r.sucesso === 2)
    const dp = await desfazerLote({ tipo: "PRAZO", tarefaIds: [t3, t4], autorId: admin.id })
    ok("desfez os dois", dp.desfeitas === 2)
    ok("prazo restaurado", (await prisma.tarefa.findMany({ where: { id: { in: [t3, t4] } } })).every((t) => t.dataPrazo?.getTime() === prazoInicial.getTime()))
    ok("o Desfazer NÃO gravou nova TAREFA_PRAZO_ALTERADO (só as 2 da ação)", (await linhasDe([t3, t4], "TAREFA_PRAZO_ALTERADO")).length === 2)
    const dpl = await linhasDe([t3, t4], "TAREFA_PRAZO_REPACTUACAO_DESFEITA")
    ok("exatamente 1 DESFEITA por tarefa", dpl.length === 2)
    const dpd = dpl[0].detalhes as { de?: string; para?: string; revertidoDe?: string }
    ok("a DESFEITA carrega antes/depois (ISO)", dpd.de === novo.toISOString() && dpd.para === prazoInicial.toISOString() && dpd.revertidoDe === novo.toISOString(), JSON.stringify(dpd))
    const dp2 = await desfazerLote({ tipo: "PRAZO", tarefaIds: [t3, t4], autorId: admin.id })
    ok("segundo Desfazer do prazo é recusado", dp2.desfeitas === 0 && (await linhasDe([t3, t4], "TAREFA_PRAZO_REPACTUACAO_DESFEITA")).length === 2)

    secao("ITEM 11 — leitores da auditoria não quebram")
    const aud = await consultarAuditoria({ processoId: o1.processoId, natureza: "PROCESSO_TAREFA" }, 1, 100)
    ok("consultarAuditoria lista a DESFEITA com autor e descrição", aud.itens.some((l) => l.acao === "TAREFA_PRIORIDADE_DESFEITA" && l.autor === `${MARCA} Admin` && /restaurada/.test(l.descricao)))
    const doc = await prisma.tarefa.findUnique({ where: { id: t3 }, select: { documentoId: true } })
    if (doc?.documentoId) {
      const { montarAndamentoDaOperacao } = await import("../src/services/andamento-operacional")
      const and = await montarAndamentoDaOperacao(doc.documentoId)
      const ev = and.find((e) => e.tipo === "TAREFA_PRAZO_REPACTUACAO_DESFEITA")
      ok("Andamento mostra a desfeita com título e de/para em data", !!ev && ev.titulo === "Repactuação de prazo desfeita" && !!ev.de && !/T\d\d:/.test(ev.de), JSON.stringify(ev && { t: ev.titulo, de: ev.de, para: ev.para }))
    } else console.log("  (tarefa sem documento: Andamento não se aplica à fixture)")

    secao("ITEM 2c — devolverAFila de tarefa EM_ANDAMENTO exige confirmação explícita")
    const [e1, e2, e3] = [await c.novaObrigacao(), await c.novaObrigacao(), await c.novaObrigacao()]
    for (const e of [e1, e2, e3]) await prisma.tarefa.update({ where: { id: e.tarefaId }, data: { statusTarefa: "EM_ANDAMENTO", responsavelId: ana.id } })
    const semFlag = await devolverAFila({ tarefaId: e1.tarefaId, autorId: admin.id })
    ok("sem a flag: recusa com código CONFIRMACAO_NECESSARIA", !semFlag.ok && semFlag.codigo === "CONFIRMACAO_NECESSARIA", !semFlag.ok ? semFlag.mensagem : "")
    ok("nada mudou (segue com a Ana, em andamento)", (await prisma.tarefa.findUnique({ where: { id: e1.tarefaId } }))?.responsavelId === ana.id)
    ok("e nada foi auditado", (await linhasDe([e1.tarefaId], "TAREFA_DEVOLVIDA_A_FILA")).length === 0)
    const flagFalsa = await devolverAFila({ tarefaId: e1.tarefaId, autorId: admin.id, confirmarTarefaEmAndamento: false })
    ok("flag false também recusa", !flagFalsa.ok && flagFalsa.codigo === "CONFIRMACAO_NECESSARIA")
    const comFlag = await devolverAFila({ tarefaId: e1.tarefaId, autorId: admin.id, confirmarTarefaEmAndamento: true })
    const t1apos = await prisma.tarefa.findUniqueOrThrow({ where: { id: e1.tarefaId } })
    ok("com a flag: devolve (sem dono) e o status segue EM_ANDAMENTO", comFlag.ok && t1apos.responsavelId == null && t1apos.statusTarefa === "EM_ANDAMENTO")
    const logDev = (await linhasDe([e1.tarefaId], "TAREFA_DEVOLVIDA_A_FILA"))[0]
    ok("a auditoria registra que foi confirmada sobre tarefa em andamento", (logDev?.detalhes as { confirmouTarefaEmAndamento?: boolean })?.confirmouTarefaEmAndamento === true)

    const lote = await redistribuirTarefas({ tarefaIds: [e2.tarefaId], novoResponsavelId: null, autorId: admin.id })
    ok("redistribuir para ninguém, sem flag: item recusado com o código", lote.falha === 1 && lote.itens[0].codigo === "CONFIRMACAO_NECESSARIA", JSON.stringify(lote.itens[0]))
    ok("...e a tarefa segue com a Ana", (await prisma.tarefa.findUnique({ where: { id: e2.tarefaId } }))?.responsavelId === ana.id)
    const lote2 = await redistribuirTarefas({ tarefaIds: [e2.tarefaId], novoResponsavelId: null, autorId: admin.id, confirmarTarefaEmAndamento: true })
    ok("redistribuir para ninguém, com a flag: devolve", lote2.sucesso === 1 && (await prisma.tarefa.findUnique({ where: { id: e2.tarefaId } }))?.responsavelId == null)

    // Tarefa que NÃO está em andamento não precisa de confirmação.
    await prisma.tarefa.update({ where: { id: e3.tarefaId }, data: { statusTarefa: "NAO_INICIADA" } })
    const naoIni = await devolverAFila({ tarefaId: e3.tarefaId, autorId: admin.id })
    ok("tarefa não iniciada: devolve sem confirmação", naoIni.ok)

    secao("ITEM 2c — as portas repassam a flag e o mapa HTTP tem o código")
    const rota = readFileSync("src/app/api/tarefas/[tarefaId]/comando/route.ts", "utf8")
    ok("comando: CONFIRMACAO_NECESSARIA → 428", /CONFIRMACAO_NECESSARIA:\s*428/.test(rota))
    ok("comando: repassa confirmarTarefaEmAndamento a devolverAFila", /devolverAFila\(\{[^}]*confirmarTarefaEmAndamento: body\?\.confirmarTarefaEmAndamento === true/.test(rota))
    ok("redistribuir: repassa a flag", /confirmarTarefaEmAndamento: b\?\.confirmarTarefaEmAndamento === true/.test(readFileSync("src/app/api/tarefas/redistribuir/route.ts", "utf8")))
    // Lei da Torre (L4): visao-global/distribuicao-tarefas foram removidas e a Central do processo não devolve mais à fila — a confirmação de "em andamento" vive na Torre e no que resta de comandar().
    for (const f of ["src/components/operacao/tabela-familia.tsx"]) {
      const s = readFileSync(f, "utf8")
      ok(`UI pede confirmação: ${f.split("/").pop()}`, s.includes("CONFIRMACAO_NECESSARIA") && s.includes("confirmarTarefaEmAndamento: true"))
    }

    secao("ITEM 2b — o rótulo reflete o estado real (nunca 'A iniciar' para EM_ANDAMENTO sem dono)")
    const base = {
      statusTarefa: "EM_ANDAMENTO", responsavelId: null, aIniciar: true, origem: "MANUAL", faseMacroKey: "emissao_documental", estadoOperacao: "FILA",
      etapaAtual: "Solicitar certidão", passoCorrente: { chave: "enviar", label: "Enviar requerimento" }, passoAtual: { ordem: 0, total: 3 },
    } as unknown as LinhaOperacaoV3
    ok("emAndamentoSemDono detecta", emAndamentoSemDono(base))
    ok("aIniciarEfetivo = false para ela", aIniciarEfetivo(base) === false)
    // Mandato C2/C4 (30/09/2026): "Passo atual" é SÓ o nome do passo; o ESTADO vai na coluna Status (do statusTarefa real).
    const rot = passoLabelDe(base)
    ok("passo atual: só o nome do passo — sem 'A iniciar' nem 'Em andamento — sem responsável'", rot.label === "Enviar requerimento" && rot.sub === "" && !/A iniciar/i.test(rot.label + rot.sub), `${rot.label} | ${rot.sub}`)
    ok("Status real: EM_ANDAMENTO mostra 'Em andamento', nunca 'A iniciar'", statusTarefaTxt(base) === "Em andamento")
    ok("ação oferecida: Continuar", acaoDe(base).label === "Continuar")
    const naoIniciada = { ...base, statusTarefa: "NAO_INICIADA" } as LinhaOperacaoV3
    ok("NAO_INICIADA sem dono segue 'A iniciar' no Status (regra antiga preservada)", statusTarefaTxt(naoIniciada) === "A iniciar" && acaoDe(naoIniciada).label === "Iniciar" && aIniciarEfetivo(naoIniciada))
    const comDono = { ...base, responsavelId: 12 } as LinhaOperacaoV3
    ok("EM_ANDAMENTO COM dono não é tocada por esta regra (Status segue 'Em andamento')", !emAndamentoSemDono(comDono) && statusTarefaTxt(comDono) === "Em andamento")
  } finally {
    await c.limpar()
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
