// scripts/arvore-fonte-da-verdade-f-linha-reta.test.ts
// ============================================================================
// CAMINHO (f) — LINHA RETA. "A árvore genealógica é a única fonte de verdade
// documental" (CLAUDE.md §37): a mudança propaga, NA MESMA TRANSAÇÃO, para
// necessidade → documento → passo → tarefa, com IDA e VOLTA:
//   IDA     ascendente na linha reta → certidão de nascimento (cadeia completa);
//   VOLTA   sair da linha reta → necessidade DISPENSADA, documento NAO_EXIGIDO, passo/tarefa cancelados;
//   IDA 2   voltar à linha reta → REATIVA o mesmo (sem duplicar).
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fonte-da-verdade-f-linha-reta
// Roda contra o banco de TESTE (rotas reais, token de administrador).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVF"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-fonte-da-verdade-f-linha-reta.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("ÁRVORE = FONTE DA VERDADE — (f) LINHA RETA\n")

  const c = await P.novoCenario("linha", { avo: true })
  // criar o cenário não passa pelas rotas: a primeira propagação nasce da edição do titular.
  await P.putPessoa(c.titularId, { documentacao: true })
  let f = await P.foto(c.processoId)
  const nasc = f.necDe("NAS", { pessoaId: c.avoId! })
  ok("IDA: o ascendente na linha reta tem certidão de nascimento", nasc.length === 1)
  const necId = nasc[0].id
  let d = await P.derivados(necId)
  ok("IDA: Documento PENDENTE + 1 passo vivo + 1 tarefa aberta", d.docs.length === 1 && d.docs[0].status === "PENDENTE" && d.passosVivos === 1 && d.tarefasAbertas === 1, JSON.stringify(d))
  const docId = d.docs[0].id, tarefaId = d.tarefas[0].id

  secao("VOLTA — sair da linha reta")
  const r = await P.putPessoa(c.avoId!, { linhaReta: false })
  ok("PUT linhaReta=false responde 200", r.status === 200, String(r.status))
  d = await P.derivados(necId)
  ok("necessidade DISPENSADA", d.status === "DISPENSADA", String(d.status))
  ok("Documento NAO_EXIGIDO (mesmo id, não apagado)", d.docs.length === 1 && d.docs[0].id === docId && d.docs[0].status === "NAO_EXIGIDO")
  ok("passos cancelados e tarefa CANCELADA com 'pessoa saiu da linha reta'", d.passosVivos === 0 && d.tarefasAbertas === 0 && /saiu da linha reta/.test(d.tarefas[0].causaRemovidaMotivo ?? ""), d.tarefas[0].causaRemovidaMotivo ?? "")
  ok("auditoria legível do fato", (await prisma.logAuditoria.count({ where: { acao: "NECESSIDADE_REMOVIDA_PELA_ARVORE", entidadeId: necId, descricao: { contains: "saiu da linha reta" } } })) === 1)

  secao("IDA 2 — voltar à linha reta reativa o mesmo")
  await P.putPessoa(c.avoId!, { linhaReta: true })
  f = await P.foto(c.processoId)
  d = await P.derivados(necId)
  ok("uma única necessidade de nascimento do ascendente (mesmo id), PENDENTE", f.necDe("NAS", { pessoaId: c.avoId! }).length === 1 && d.status === "PENDENTE")
  ok("mesmo Documento PENDENTE, 1 passo vivo, mesma tarefa aberta (sem duplicar)", d.docs.length === 1 && d.docs[0].id === docId && d.docs[0].status === "PENDENTE" && d.passosVivos === 1 && d.tarefasAbertas === 1 && d.tarefas.length === 1 && d.tarefas[0].id === tarefaId, JSON.stringify(d))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} (f) LINHA RETA — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
