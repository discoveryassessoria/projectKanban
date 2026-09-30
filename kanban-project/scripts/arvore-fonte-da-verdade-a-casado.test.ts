// scripts/arvore-fonte-da-verdade-a-casado.test.ts
// ============================================================================
// CAMINHO (a) — CASADO. "A árvore genealógica é a única fonte de verdade
// documental" (CLAUDE.md §37): marcar/desmarcar `casado` propaga, na MESMA
// transação, para necessidade → documento → passo → tarefa.
//
//   IDA     casar (PUT casado + POST /api/unioes) → necessidade de casamento POR
//           UNIÃO + Documento + passo + tarefa;
//   VOLTA   desmarcar → necessidade DISPENSADA, Documento NAO_EXIGIDO (não apagado),
//           passo CANCELADO, tarefa CANCELADA com o motivo da árvore, auditoria legível;
//   IDA 2   marcar de novo → REATIVA a mesma necessidade/documento (sem duplicar);
//   FATO    necessidade já ATENDIDA NÃO é dispensada sozinha (alerta), e a união
//           com certidão andada NÃO se apaga (409);
//   DELETE  união sem fato: apaga sem violar o CHECK sujeito_xor;
//   ATOMIC  falha no meio → rollback de TUDO e resposta de erro (não 200).
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fonte-da-verdade-a-casado
// Roda contra o banco de TESTE.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVA"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-fonte-da-verdade-a-casado.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("ÁRVORE = FONTE DA VERDADE — (a) CASADO\n")

  const c = await P.novoCenario("casal", { conjuge: true })
  const abertas = async () => (await prisma.tarefa.findMany({ where: { processoId: c.processoId, necessidade: { itemCatalogo: { code: `${MARCA}_CAS` } }, statusTarefa: { notIn: P.TAREFA_FECHADA as never } }, select: { id: true } })).length

  // ══ IDA ═══════════════════════════════════════════════════════════════════
  secao("IDA — casar cria necessidade por UNIÃO + documento + passo + tarefa, na resposta")
  const r1 = await P.putPessoa(c.titularId, { casado: true })
  ok("PUT casado=true responde 200", r1.status === 200, String(r1.status))
  const ru = await P.postUniao(c.titularId, c.conjugeId!)
  ok("POST /api/unioes responde 201", ru.status === 201, String(ru.status))
  const uniao = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: c.titularId, pessoa2Id: c.conjugeId! } })
  let f = await P.foto(c.processoId)
  const cas = f.necDe("CAS", { uniaoId: uniao.id })
  ok("nasceu UMA necessidade de casamento, por UNIÃO (pessoaId nulo)", cas.length === 1 && cas[0].pessoaId === null, JSON.stringify(cas))
  const necId = cas[0].id
  const doc = f.docs.filter((d) => d.necessidadeId === necId)
  ok("nasceu o Documento do casamento, no titular da linha de transmissão", doc.length === 1 && doc[0].pessoaId === c.titularId && doc[0].status === "PENDENTE", JSON.stringify(doc))
  ok("nasceu o passo de 'Localizar registro' vivo", f.passos.filter((p) => p.necessidadeId === necId && !P.PASSO_FECHADO.includes(p.status)).length === 1)
  ok("nasceu UMA tarefa aberta (SÍNCRONO — já na resposta, sem after())", (await abertas()) === 1, String(await abertas()))
  const tarefaId = f.tarefas.find((t) => t.necessidadeId === necId)!.id
  const docId = doc[0].id

  // ══ VOLTA ═════════════════════════════════════════════════════════════════
  secao("VOLTA — desmarcar casado remove/cancela TUDO o que derivou")
  const r2 = await P.putPessoa(c.titularId, { casado: false })
  ok("PUT casado=false responde 200", r2.status === 200, String(r2.status))
  f = await P.foto(c.processoId)
  ok("necessidade DISPENSADA (não apagada)", f.necs.find((n) => n.id === necId)?.status === "DISPENSADA")
  const docV = f.docs.find((d) => d.id === docId)!
  ok("Documento NAO_EXIGIDO — NÃO apagado, NÃO 'cancelado'", docV.status === "NAO_EXIGIDO", docV.status)
  ok("passos da necessidade CANCELADOS (nenhum vivo)", f.passos.filter((p) => p.necessidadeId === necId && !P.PASSO_FECHADO.includes(p.status)).length === 0)
  const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { statusTarefa: true, causaRemovidaMotivo: true } })
  ok("tarefa CANCELADA", t.statusTarefa === "CANCELADA", t.statusTarefa)
  ok("tarefa guarda o motivo 'necessidade removida pela árvore: …deixou de ser casada'", /necessidade removida pela árvore: .*deixou de ser casada/.test(t.causaRemovidaMotivo ?? ""), t.causaRemovidaMotivo ?? "")
  const log = await prisma.logAuditoria.findFirst({ where: { acao: "NECESSIDADE_REMOVIDA_PELA_ARVORE", entidadeId: necId }, select: { descricao: true, usuarioId: true } })
  ok("UMA linha de auditoria legível por fato, com certidão, motivo e autor",
    !!log && /Necessidade 'Certidão de casamento · Edison/.test(log.descricao) && /pessoa deixou de ser casada/.test(log.descricao) && /alterado por .*Marco Rovatti/.test(log.descricao) && log.usuarioId === P.adminId,
    log?.descricao)
  ok("a união NÃO foi apagada pela desmarcação (desenho: a união é FATO; o CHECK sujeito_xor proíbe apagá-la com necessidade apontando)", (await prisma.uniao.count({ where: { id: uniao.id } })) === 1)

  // ══ IDA 2 ═════════════════════════════════════════════════════════════════
  secao("IDA 2 — marcar de novo REATIVA o mesmo (sem duplicar)")
  await P.putPessoa(c.titularId, { casado: true })
  f = await P.foto(c.processoId)
  ok("continua UMA necessidade de casamento (mesmo id), PENDENTE", f.necDe("CAS", { uniaoId: uniao.id }).length === 1 && f.necs.find((n) => n.id === necId)?.status === "PENDENTE")
  ok("continua UM Documento (mesmo id), de volta a PENDENTE", f.docs.filter((d) => d.necessidadeId === necId).length === 1 && f.docs.find((d) => d.id === docId)?.status === "PENDENTE")
  ok("UM passo vivo e UMA tarefa aberta (sem duplicar)", f.passos.filter((p) => p.necessidadeId === necId && !P.PASSO_FECHADO.includes(p.status)).length === 1 && (await abertas()) === 1, `abertas=${await abertas()}`)
  const tarefaTotal = (await P.foto(c.processoId)).tarefas.filter((x) => x.necessidadeId === necId).length
  ok("a MESMA tarefa voltou (taskId preservado, CLAUDE.md §11)", tarefaTotal === 1, String(tarefaTotal))
  ok("reativada SEM responsável herdado", (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { responsavelId: true } })).responsavelId === null)

  // ══ FATO: ATENDIDA não é dispensada sozinha ════════════════════════════════
  secao("FATO — necessidade já ATENDIDA não é dispensada pela árvore; vira alerta")
  await prisma.necessidadeDocumental.update({ where: { id: necId }, data: { status: "ATENDIDA" } })
  await P.putPessoa(c.titularId, { casado: false })
  f = await P.foto(c.processoId)
  ok("continua ATENDIDA (fato acontecido não se desfaz)", f.necs.find((n) => n.id === necId)?.status === "ATENDIDA")
  const alerta = await prisma.logAuditoria.count({ where: { acao: "NECESSIDADE_ATENDIDA_SEM_CAUSA", entidadeId: necId } })
  ok("fica registrado o alerta 'atendida, sem causa' para decisão humana", alerta >= 1, String(alerta))
  const rd = await P.deleteUniao(uniao.id)
  const corpoRd = await rd.json()
  ok("DELETE da união com certidão ATENDIDA é recusado (409 UNIAO_COM_FATO)", rd.status === 409 && corpoRd.code === "UNIAO_COM_FATO", `${rd.status} ${corpoRd.code}`)
  ok("nada mudou: união, necessidade e documento intactos", (await prisma.uniao.count({ where: { id: uniao.id } })) === 1 && (await prisma.necessidadeDocumental.count({ where: { id: necId } })) === 1)

  // ══ DELETE da união sem fato ═══════════════════════════════════════════════
  secao("DELETE da união SEM fato — sai em transação única, sem violar o CHECK sujeito_xor")
  const c2 = await P.novoCenario("delecao", { conjuge: true })
  await P.putPessoa(c2.titularId, { casado: true })
  await P.postUniao(c2.titularId, c2.conjugeId!)
  const u2 = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: c2.titularId } })
  const f2a = await P.foto(c2.processoId)
  const nec2 = f2a.necDe("CAS", { uniaoId: u2.id })[0]
  ok("pré: necessidade de casamento criada", !!nec2)
  const tarefa2 = f2a.tarefas.find((x) => x.necessidadeId === nec2.id)!
  const docCas2 = f2a.docs.find((d) => d.necessidadeId === nec2.id)!.id
  const rdel = await P.deleteUniao(u2.id)
  ok("DELETE /api/unioes/[id] responde 200", rdel.status === 200, String(rdel.status))
  const f2b = await P.foto(c2.processoId)
  ok("a união saiu", (await prisma.uniao.count({ where: { id: u2.id } })) === 0)
  ok("nenhuma necessidade aponta para a união apagada (nem órfã com sujeito nulo)", f2b.necs.filter((n) => n.cod === "CAS").length === 0)
  const docs2 = f2b.docs.find((d) => d.id === docCas2)
  ok("o Documento do casamento ficou como histórico NAO_EXIGIDO (fora de contagem, anexos preservados) — sem órfão ATIVO", docs2?.status === "NAO_EXIGIDO" && docs2.necessidadeId === null, JSON.stringify(docs2))
  ok("a tarefa aberta foi CANCELADA", (await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefa2.id } })).statusTarefa === "CANCELADA")

  // ══ ATOMICIDADE ═══════════════════════════════════════════════════════════
  secao("ATOMICIDADE — falha no meio da propagação: rollback de TUDO e erro HTTP (não 200)")
  const c3 = await P.novoCenario("atomico", { conjuge: true })
  await P.postUniao(c3.titularId, c3.conjugeId!) // sem casado=true: nada a criar ainda
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "fn_${MARCA}_bloqueia"() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'falha injetada no meio da propagação'; END; $$ LANGUAGE plpgsql`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "trg_${MARCA}_bloqueia" BEFORE INSERT ON "NecessidadeDocumental" FOR EACH ROW WHEN (NEW."processoId" = ${c3.processoId}) EXECUTE FUNCTION "fn_${MARCA}_bloqueia"()`)
  const necAntes = await prisma.necessidadeDocumental.count({ where: { processoId: c3.processoId } })
  const tarAntes = await prisma.tarefa.count({ where: { processoId: c3.processoId } })
  const docAntes = await prisma.documento.count({ where: { pessoa: { arvoreId: c3.arvoreId } } })
  const rf = await P.putPessoa(c3.titularId, { casado: true })
  ok("a resposta é ERRO (500), não 200 com falha engolida", rf.status === 500, String(rf.status))
  ok("ROLLBACK: a Pessoa continua casado=false (a mudança NÃO ficou gravada)", (await prisma.pessoa.findUniqueOrThrow({ where: { id: c3.titularId }, select: { casado: true } })).casado === false)
  ok("ROLLBACK: nenhuma necessidade/documento/tarefa pela metade", (await prisma.necessidadeDocumental.count({ where: { processoId: c3.processoId } })) === necAntes && (await prisma.tarefa.count({ where: { processoId: c3.processoId } })) === tarAntes && (await prisma.documento.count({ where: { pessoa: { arvoreId: c3.arvoreId } } })) === docAntes)
  await prisma.$executeRawUnsafe(`DROP TRIGGER "trg_${MARCA}_bloqueia" ON "NecessidadeDocumental"`)
  const rok = await P.putPessoa(c3.titularId, { casado: true })
  ok("sem a falha, o MESMO pedido passa (200) e converge", rok.status === 200 && (await P.foto(c3.processoId)).necDe("CAS").length === 1, String(rok.status))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} (a) CASADO — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
