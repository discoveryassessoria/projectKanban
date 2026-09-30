// scripts/torre-bloco-g-lote-e-desfazer.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO G1 (30/09/2026) — ações em lote e DESFAZER.
//
//   npx tsx scripts/torre-bloco-g-lote-e-desfazer.test.ts   (banco de teste)
//
// PROVA, com Tarefas canônicas materializadas pelo motor:
//   • atribuir a {pessoa} em lote: cada tarefa muda de dono, com a SUA linha de auditoria;
//   • prioridade alta: pula quem já é alta/urgente (nunca rebaixa);
//   • repactuar com UMA justificativa: a MESMA regra da individual (motivo obrigatório,
//     encerrada recusada), uma linha de auditoria POR tarefa;
//   • DESFAZER restaura o estado anterior REAL de cada uma e audita; recusa a ação antiga
//     e a de outro autor; recusa quando a tarefa foi mexida depois.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-g-lote-e-desfazer.test.ts")

import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import {
  atribuirEmLote, prioridadeAltaEmLote, repactuarEmLote, desfazerLote, validarIds, LIMITE_DO_LOTE, JANELA_DO_DESFAZER_MS,
} from "../src/services/torre-acoes-lote"
import { alterarPrazo } from "../lib/operacional/tarefa-ciclo"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "TORREG1"

async function main() {
  const c = await montarCenario(MARCA)
  const dia = 86_400_000
  try {
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-admin@t.com`, senha: "x", tipo: "admin" } })
    const outro = await prisma.usuario.create({ data: { nome: `${MARCA} Outro`, email: `${MARCA.toLowerCase()}-outro@t.com`, senha: "x", tipo: "admin" } })
    const pessoaA = await prisma.usuario.create({ data: { nome: `${MARCA} Ana`, email: `${MARCA.toLowerCase()}-ana@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
    const pessoaB = await prisma.usuario.create({ data: { nome: `${MARCA} Beto`, email: `${MARCA.toLowerCase()}-beto@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })

    const prazoInicial = new Date(Date.now() + 10 * dia)
    const t = []
    for (let i = 0; i < 4; i++) t.push(await c.novaObrigacao({ dataPrazo: prazoInicial }))
    const [t1, t2, t3, t4] = t.map((x) => x.tarefaId)
    const encerrada = await prisma.tarefa.create({ data: { titulo: `${MARCA} encerrada`, statusTarefa: "CONCLUIDO_RECEBIDO", dataPrazo: prazoInicial } })

    secao("VALIDAÇÃO DO LOTE")
    ok("lote vazio é recusado", validarIds([]).ok === false)
    ok("lote acima do limite é recusado", validarIds(Array.from({ length: LIMITE_DO_LOTE + 1 }, (_, i) => i + 1)).ok === false)
    const v = validarIds([1, 1, "2", -3, "x"])
    ok("ids repetidos/inválidos são limpos", v.ok && JSON.stringify(v.ids) === "[1,2]")

    secao("G1 — ATRIBUIR A {PESSOA} em lote")
    const a1 = await atribuirEmLote({ tarefaIds: [t1, t2, t3, encerrada.id], responsavelId: pessoaA.id, autorId: admin.id })
    ok("3 atribuídas, a encerrada é recusada (resposta item a item)", a1.sucesso === 3 && a1.falha === 1, `${a1.sucesso}/${a1.total}`)
    const donos = await prisma.tarefa.findMany({ where: { id: { in: [t1, t2, t3, encerrada.id] } }, select: { id: true, responsavelId: true } })
    ok("as 3 agora são da Ana; a encerrada continua sem dono", donos.filter((d) => d.responsavelId === pessoaA.id).length === 3 && donos.find((d) => d.id === encerrada.id)?.responsavelId == null)
    const logsAtrib = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: [t1, t2, t3] }, acao: "TAREFA_ATRIBUIDA", usuarioId: admin.id } })
    ok("CADA tarefa tem a própria linha de auditoria (quem, o quê)", logsAtrib === 3, `${logsAtrib} linhas`)
    ok("o toast recebe o que desfazer (só as que mudaram)", a1.desfazer?.tipo === "ATRIBUICAO" && a1.desfazer.tarefaIds.length === 3)
    const repetida = await atribuirEmLote({ tarefaIds: [t1], responsavelId: pessoaA.id, autorId: admin.id })
    ok("atribuir de novo à mesma pessoa: recusa e não oferece desfazer", repetida.sucesso === 0 && repetida.desfazer === null)
    const inexistente = await atribuirEmLote({ tarefaIds: [t4], responsavelId: 99999999, autorId: admin.id })
    ok("destinatário inexistente: nada muda", inexistente.sucesso === 0 && (await prisma.tarefa.findUnique({ where: { id: t4 } }))?.responsavelId == null)

    secao("G1 — DESFAZER a atribuição")
    const semJanela = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: [t1], autorId: outro.id })
    ok("outro autor NÃO desfaz a ação alheia", semJanela.desfeitas === 0, semJanela.itens[0]?.mensagem)
    const passado = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: [t1], autorId: admin.id, agora: new Date(Date.now() + JANELA_DO_DESFAZER_MS + 5_000) })
    ok("depois da janela o desfazer é recusado", passado.desfeitas === 0)
    const d1 = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: a1.desfazer!.tarefaIds, autorId: admin.id })
    ok("desfazer devolve as 3 ao estado ANTERIOR REAL (sem dono)", d1.desfeitas === 3)
    const depois = await prisma.tarefa.findMany({ where: { id: { in: [t1, t2, t3] } }, select: { responsavelId: true } })
    ok("responsavelId volta a nulo", depois.every((x) => x.responsavelId == null))
    const audDesfeito = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: [t1, t2, t3] }, acao: "TAREFA_ATRIBUICAO_DESFEITA" } })
    ok("o desfazer é auditado, tarefa a tarefa", audDesfeito === 3)

    // Tarefa que já tinha dono: o desfazer volta para o dono ANTERIOR, não para a fila.
    await atribuirEmLote({ tarefaIds: [t1], responsavelId: pessoaB.id, autorId: admin.id })
    const a2 = await atribuirEmLote({ tarefaIds: [t1], responsavelId: pessoaA.id, autorId: admin.id })
    await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: a2.desfazer!.tarefaIds, autorId: admin.id })
    ok("transferência desfeita volta para o dono anterior (Beto)", (await prisma.tarefa.findUnique({ where: { id: t1 } }))?.responsavelId === pessoaB.id)
    // Mexida depois: outro gestor transfere no meio → o desfazer da ação antiga recusa.
    const a3 = await atribuirEmLote({ tarefaIds: [t2], responsavelId: pessoaA.id, autorId: admin.id })
    await atribuirEmLote({ tarefaIds: [t2], responsavelId: pessoaB.id, autorId: outro.id })
    const recusa = await desfazerLote({ tipo: "ATRIBUICAO", tarefaIds: a3.desfazer!.tarefaIds, autorId: admin.id })
    ok("tarefa mexida por outra pessoa depois: desfazer recusado", recusa.desfeitas === 0 && (await prisma.tarefa.findUnique({ where: { id: t2 } }))?.responsavelId === pessoaB.id)

    secao("G1 — PRIORIDADE ALTA em lote")
    await prisma.tarefa.update({ where: { id: t3 }, data: { prioridade: "URGENTE" } })
    await prisma.tarefa.update({ where: { id: t4 }, data: { prioridade: "ALTA" } })
    const antes = await prisma.tarefa.findMany({ where: { id: { in: [t1, t2] } }, select: { id: true, prioridade: true } })
    const p1 = await prioridadeAltaEmLote({ tarefaIds: [t1, t2, t3, t4], autorId: admin.id })
    ok("muda só quem não era alta/urgente (2 de 4)", p1.sucesso === 2 && p1.falha === 2, p1.itens.map((i) => i.mensagem ?? "ok").join(" | "))
    ok("URGENTE nunca é rebaixada para ALTA", (await prisma.tarefa.findUnique({ where: { id: t3 } }))?.prioridade === "URGENTE")
    ok("as duas viraram ALTA", (await prisma.tarefa.findMany({ where: { id: { in: [t1, t2] } } })).every((x) => x.prioridade === "ALTA"))
    const dp = await desfazerLote({ tipo: "PRIORIDADE", tarefaIds: p1.desfazer!.tarefaIds, autorId: admin.id })
    const restauradas = await prisma.tarefa.findMany({ where: { id: { in: [t1, t2] } }, select: { id: true, prioridade: true } })
    ok("desfazer restaura a prioridade ANTERIOR de cada uma", dp.desfeitas === 2 && restauradas.every((r) => r.prioridade === antes.find((a) => a.id === r.id)!.prioridade))
    ok("e audita a restauração", (await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: { in: [t1, t2] }, acao: "TAREFA_PRIORIDADE_DESFEITA" } })) === 2)

    secao("G1 — REPACTUAR PRAZO com UMA justificativa (a regra da individual)")
    const novo = new Date(Date.now() + 20 * dia)
    const semMotivo = await repactuarEmLote({ tarefaIds: [t1, t2], novoPrazo: novo, justificativa: "   ", autorId: admin.id })
    ok("sem justificativa NENHUMA muda (mesma validação da individual)", semMotivo.sucesso === 0 && (await prisma.tarefa.findUnique({ where: { id: t1 } }))?.dataPrazo?.getTime() === prazoInicial.getTime())
    const r1 = await repactuarEmLote({ tarefaIds: [t1, t2, t3, encerrada.id], novoPrazo: novo, justificativa: "cartórios sem resposta; aguardando 2ª via", autorId: admin.id })
    ok("3 repactuadas; a encerrada é recusada", r1.sucesso === 3 && r1.falha === 1, `${r1.sucesso}/${r1.total}`)
    const prazos = await prisma.tarefa.findMany({ where: { id: { in: [t1, t2, t3] } }, select: { dataPrazo: true } })
    ok("todas com o novo prazo", prazos.every((p) => p.dataPrazo?.getTime() === novo.getTime()))
    const logsPrazo = await prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: { in: [t1, t2, t3] }, acao: "TAREFA_PRAZO_ALTERADO" } })
    ok("CADA tarefa tem a sua linha, com a justificativa única e de/para", logsPrazo.length === 3 && logsPrazo.every((l) => /cartórios sem resposta/.test(l.descricao) && (l.detalhes as { de?: string })?.de === prazoInicial.toISOString()))
    ok("há também um resumo do lote", (await prisma.logAuditoria.count({ where: { acao: "TAREFAS_PRAZO_REPACTUADO_LOTE" } })) === 1)
    const dr = await desfazerLote({ tipo: "PRAZO", tarefaIds: r1.desfazer!.tarefaIds, autorId: admin.id })
    const prazosVoltaram = await prisma.tarefa.findMany({ where: { id: { in: [t1, t2, t3] } }, select: { dataPrazo: true } })
    ok("desfazer restaura o prazo ANTERIOR REAL", dr.desfeitas === 3 && prazosVoltaram.every((p) => p.dataPrazo?.getTime() === prazoInicial.getTime()))
    // Prazo mexido depois → recusa.
    const r2 = await repactuarEmLote({ tarefaIds: [t4], novoPrazo: novo, justificativa: "primeira", autorId: admin.id })
    await alterarPrazo({ tarefaId: t4, autorId: outro.id, novoPrazo: new Date(Date.now() + 30 * dia), motivo: "outro gestor mexeu" })
    const dr2 = await desfazerLote({ tipo: "PRAZO", tarefaIds: r2.desfazer!.tarefaIds, autorId: admin.id })
    ok("prazo mexido depois: desfazer recusado", dr2.desfeitas === 0)
  } finally {
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await c.limpar()
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
