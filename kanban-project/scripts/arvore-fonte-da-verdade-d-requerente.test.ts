// scripts/arvore-fonte-da-verdade-d-requerente.test.ts
// ============================================================================
// CAMINHO (d) — REQUERENTE. "A árvore genealógica é a única fonte de verdade
// documental" (CLAUDE.md §37): a mudança propaga, NA MESMA TRANSAÇÃO, para
// necessidade → documento → passo → tarefa, com IDA e VOLTA:
//   IDA     vincular-requerente (SÍNCRONO, sem after()) → certidão do requerente, cadeia completa;
//   VOLTA   desvincular-requerente → necessidade DISPENSADA, documento NAO_EXIGIDO, passo/tarefa cancelados;
//   IDA 2   vincular de novo → REATIVA o mesmo (sem duplicar);
//   PUT     requerente 'nao'/'sim' pelo nó da árvore faz o mesmo.
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fonte-da-verdade-d-requerente
// Roda contra o banco de TESTE (rotas reais, token de administrador).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVD"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-fonte-da-verdade-d-requerente.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("ÁRVORE = FONTE DA VERDADE — (d) REQUERENTE\n")

  const c = await P.novoCenario("req", { titularRequerente: false })
  const requerente = await prisma.requerente.create({ data: { nome: `${MARCA} Requerente` }, select: { id: true } })
  await prisma.processoRequerente.create({ data: { processoId: c.processoId, requerenteId: requerente.id } })

  secao("IDA — vincular o requerente ao nó da árvore")
  const r1 = await P.postVincularRequerente(c.arvoreId, { requerenteId: requerente.id, pessoaId: c.titularId })
  ok("POST vincular-requerente responde 200", r1.status === 200, `${r1.status} ${JSON.stringify(await r1.clone().json())}`)
  ok("a pessoa virou requerente", ["sim", "maior", "menor"].includes((await prisma.pessoa.findUniqueOrThrow({ where: { id: c.titularId }, select: { requerente: true } })).requerente ?? ""))
  let f = await P.foto(c.processoId)
  const req = f.necDe("REQ", { pessoaId: c.titularId })
  ok("a certidão exigida do requerente já existe NA RESPOSTA (síncrono — sem after())", req.length === 1)
  const necId = req[0].id
  let d = await P.derivados(necId)
  ok("Documento + 1 passo vivo + 1 tarefa aberta", d.docs.length === 1 && d.passosVivos === 1 && d.tarefasAbertas === 1, JSON.stringify(d))
  const docId = d.docs[0].id, tarefaId = d.tarefas[0].id

  secao("VOLTA — desvincular o requerente (mantendo a pessoa)")
  const r2 = await P.postDesvincularRequerente(c.arvoreId, c.titularId)
  ok("POST desvincular-requerente responde 200", r2.status === 200, `${r2.status} ${JSON.stringify(await r2.clone().json())}`)
  d = await P.derivados(necId)
  ok("necessidade DISPENSADA; documento NAO_EXIGIDO (mesmo id)", d.status === "DISPENSADA" && d.docs.length === 1 && d.docs[0].id === docId && d.docs[0].status === "NAO_EXIGIDO", JSON.stringify(d))
  ok("passos cancelados e tarefa CANCELADA com 'deixou de ser requerente'", d.passosVivos === 0 && d.tarefasAbertas === 0 && /deixou de ser requerente/.test(d.tarefas[0].causaRemovidaMotivo ?? ""), d.tarefas[0].causaRemovidaMotivo ?? "")

  secao("IDA 2 — vincular de novo reativa o mesmo")
  const r3 = await P.postVincularRequerente(c.arvoreId, { requerenteId: requerente.id, pessoaId: c.titularId })
  ok("vincular de novo responde 200", r3.status === 200, String(r3.status))
  f = await P.foto(c.processoId)
  d = await P.derivados(necId)
  ok("uma única necessidade (mesmo id), PENDENTE; mesmo documento PENDENTE; 1 passo vivo; mesma tarefa aberta", f.necDe("REQ", { pessoaId: c.titularId }).length === 1 && d.status === "PENDENTE" && d.docs.length === 1 && d.docs[0].id === docId && d.docs[0].status === "PENDENTE" && d.passosVivos === 1 && d.tarefasAbertas === 1 && d.tarefas.length === 1 && d.tarefas[0].id === tarefaId, JSON.stringify(d))

  secao("PUT requerente pelo nó da árvore (mesma régua)")
  const r4 = await P.putPessoa(c.titularId, { requerente: "nao" })
  d = await P.derivados(necId)
  ok("PUT requerente='nao' → necessidade DISPENSADA, tarefa cancelada", r4.status === 200 && d.status === "DISPENSADA" && d.tarefasAbertas === 0, `${r4.status} ${d.status}`)
  const r5 = await P.putPessoa(c.titularId, { requerente: "sim" })
  d = await P.derivados(necId)
  ok("PUT requerente='sim' → reativada (mesmo id), documento PENDENTE, tarefa aberta", r5.status === 200 && d.status === "PENDENTE" && d.docs[0].status === "PENDENTE" && d.tarefasAbertas === 1, `${r5.status} ${d.status}`)

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} (d) REQUERENTE — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
