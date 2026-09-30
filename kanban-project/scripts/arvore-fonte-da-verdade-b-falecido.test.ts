// scripts/arvore-fonte-da-verdade-b-falecido.test.ts
// ============================================================================
// CAMINHO (b) — FALECIDO / VIVO. "A árvore genealógica é a única fonte de verdade
// documental" (CLAUDE.md §37): a mudança propaga, NA MESMA TRANSAÇÃO, para
// necessidade → documento → passo → tarefa, com IDA e VOLTA:
//   IDA     marcar falecido → certidão de óbito (necessidade + documento + passo + tarefa);
//   VOLTA   voltar a vivo → necessidade DISPENSADA, documento NAO_EXIGIDO, passo e tarefa cancelados;
//   IDA 2   falecido de novo → REATIVA o mesmo (sem duplicar);
//   FATO    óbito já ATENDIDO não é desfeito sozinho (alerta para decisão humana).
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fonte-da-verdade-b-falecido
// Roda contra o banco de TESTE (rotas reais, token de administrador).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVB"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-fonte-da-verdade-b-falecido.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("ÁRVORE = FONTE DA VERDADE — (b) FALECIDO / VIVO\n")

  const c = await P.novoCenario("obito")
  const f0 = await P.foto(c.processoId)
  ok("pré: pessoa viva NÃO tem certidão de óbito", f0.necDe("OBI").length === 0)

  secao("IDA — marcar falecido cria a cadeia inteira, já na resposta")
  const r1 = await P.putPessoa(c.titularId, { vivo: false })
  ok("PUT vivo=false responde 200", r1.status === 200, String(r1.status))
  let f = await P.foto(c.processoId)
  const obi = f.necDe("OBI", { pessoaId: c.titularId })
  ok("nasceu UMA necessidade de óbito da pessoa", obi.length === 1)
  const necId = obi[0].id
  let d = await P.derivados(necId)
  ok("Documento PENDENTE + 1 passo vivo + 1 tarefa aberta", d.status === "PENDENTE" && d.docs.length === 1 && d.docs[0].status === "PENDENTE" && d.passosVivos === 1 && d.tarefasAbertas === 1, JSON.stringify(d))
  const docId = d.docs[0].id, tarefaId = d.tarefas[0].id

  secao("VOLTA — voltar a constar como viva remove/cancela tudo")
  const r2 = await P.putPessoa(c.titularId, { vivo: true })
  ok("PUT vivo=true responde 200", r2.status === 200, String(r2.status))
  d = await P.derivados(necId)
  ok("necessidade DISPENSADA", d.status === "DISPENSADA", String(d.status))
  ok("Documento NAO_EXIGIDO (não apagado)", d.docs.length === 1 && d.docs[0].id === docId && d.docs[0].status === "NAO_EXIGIDO", JSON.stringify(d.docs))
  ok("nenhum passo vivo, nenhuma tarefa aberta", d.passosVivos === 0 && d.tarefasAbertas === 0)
  ok("tarefa CANCELADA com o motivo da árvore ('pessoa voltou a constar como viva')", d.tarefas[0].statusTarefa === "CANCELADA" && /necessidade removida pela árvore: .*voltou a constar como viva/.test(d.tarefas[0].causaRemovidaMotivo ?? ""), d.tarefas[0].causaRemovidaMotivo ?? "")
  const log = await prisma.logAuditoria.findFirst({ where: { acao: "NECESSIDADE_REMOVIDA_PELA_ARVORE", entidadeId: necId }, select: { descricao: true } })
  ok("auditoria legível: 'Necessidade 'Certidão de óbito · Edison …' removida: pessoa voltou a constar como viva (alterado por …)'", !!log && /Necessidade 'Certidão de óbito · Edison/.test(log.descricao) && /alterado por/.test(log.descricao), log?.descricao)

  secao("IDA 2 — falecido de novo REATIVA o mesmo, sem duplicar")
  await P.putPessoa(c.titularId, { vivo: false })
  f = await P.foto(c.processoId)
  d = await P.derivados(necId)
  ok("continua UMA necessidade de óbito (mesmo id), PENDENTE", f.necDe("OBI", { pessoaId: c.titularId }).length === 1 && d.status === "PENDENTE")
  ok("mesmo Documento, de volta a PENDENTE; 1 passo vivo; 1 tarefa aberta; mesma tarefa", d.docs.length === 1 && d.docs[0].id === docId && d.docs[0].status === "PENDENTE" && d.passosVivos === 1 && d.tarefasAbertas === 1 && d.tarefas.length === 1 && d.tarefas[0].id === tarefaId, JSON.stringify(d))

  secao("FATO — óbito já ATENDIDO não é desfeito sozinho")
  await prisma.necessidadeDocumental.update({ where: { id: necId }, data: { status: "ATENDIDA" } })
  await P.putPessoa(c.titularId, { vivo: true })
  d = await P.derivados(necId)
  ok("continua ATENDIDA", d.status === "ATENDIDA", String(d.status))
  ok("alerta 'atendida, sem causa' registrado", (await prisma.logAuditoria.count({ where: { acao: "NECESSIDADE_ATENDIDA_SEM_CAUSA", entidadeId: necId } })) >= 1)

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} (b) FALECIDO / VIVO — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
