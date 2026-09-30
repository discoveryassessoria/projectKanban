// scripts/arvore-fonte-da-verdade-e-incluir-remover.test.ts
// ============================================================================
// CAMINHO (e) — PESSOA INCLUÍDA / REMOVIDA. "A árvore genealógica é a única fonte de verdade
// documental" (CLAUDE.md §37): a mudança propaga, NA MESMA TRANSAÇÃO, para
// necessidade → documento → passo → tarefa, com IDA e VOLTA:
//   IDA     incluir pessoa na linha reta → cadeia completa, já na resposta;
//   VOLTA   remover (HARD) → some tudo que só existia por ela (necessidade, documento, passo, tarefa);
//   IDA 2   incluir de novo → cadeia NOVA, sem duplicar;
//   LÓGICA  remoção com preservação de histórico (DESATIVAR) → necessidade dispensada, documento NAO_EXIGIDO.
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fonte-da-verdade-e-incluir-remover
// Roda contra o banco de TESTE (rotas reais, token de administrador).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVE"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-fonte-da-verdade-e-incluir-remover.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("ÁRVORE = FONTE DA VERDADE — (e) PESSOA INCLUÍDA / REMOVIDA\n")

  const c = await P.novoCenario("incl")
  const mk = async (nome: string) => {
    const r = await P.postPessoa({ nome, sobrenome: `${MARCA}-x`, arvoreId: c.arvoreId, linhaReta: true, documentacao: true, paiId: c.titularId })
    return { status: r.status, id: (await r.json()).id as number }
  }

  secao("IDA — incluir pessoa na linha reta")
  const a = await mk("Incluida")
  ok("POST /api/pessoas responde 201", a.status === 201, String(a.status))
  let f = await P.foto(c.processoId)
  const nasc = f.necDe("NAS", { pessoaId: a.id })
  ok("nasceu a necessidade de nascimento da pessoa incluída, JÁ NA RESPOSTA", nasc.length === 1)
  let d = await P.derivados(nasc[0].id)
  ok("Documento + 1 passo vivo + 1 tarefa aberta", d.docs.length === 1 && d.passosVivos === 1 && d.tarefasAbertas === 1, JSON.stringify(d))

  secao("VOLTA — remover (HARD): nada sobra")
  const rd = await P.deletePessoa(a.id, "HARD")
  ok("DELETE responde 200", rd.status === 200, String(rd.status))
  f = await P.foto(c.processoId)
  ok("nenhuma necessidade da pessoa", f.necs.filter((n) => n.pessoaId === a.id).length === 0)
  ok("nenhum documento, passo ou tarefa dela (nem órfão ativo)", f.docs.filter((x) => x.pessoaId === a.id).length === 0 && f.passos.filter((p) => p.necessidadeId === nasc[0].id).length === 0 && f.tarefas.filter((t) => t.necessidadeId === nasc[0].id || t.documentoId === d.docs[0].id).length === 0)

  secao("IDA 2 — incluir de novo: cadeia nova, sem duplicar")
  const b = await mk("Reincluida")
  f = await P.foto(c.processoId)
  ok("UMA necessidade de nascimento para a nova pessoa", f.necDe("NAS", { pessoaId: b.id }).length === 1)
  const total = f.necDe("NAS").length
  ok("total de nascimentos = titular + a reincluída (nada duplicado)", total === 2, String(total))

  secao("LÓGICA — remoção com preservação de histórico (DESATIVAR)")
  const bNec = f.necDe("NAS", { pessoaId: b.id })[0].id
  const rs = await P.deletePessoa(b.id, "DESATIVAR")
  ok("DELETE modo=DESATIVAR responde 200", rs.status === 200, String(rs.status))
  d = await P.derivados(bNec)
  ok("pessoa marcada como removida (linha preservada)", (await prisma.pessoa.findUniqueOrThrow({ where: { id: b.id }, select: { removidaEm: true } })).removidaEm !== null)
  ok("necessidade DISPENSADA, documento fora de jogo, nenhum passo vivo, nenhuma tarefa aberta", d.status === "DISPENSADA" && d.docs.every((x) => P.DOC_INATIVO.includes(x.status)) && d.passosVivos === 0 && d.tarefasAbertas === 0, JSON.stringify(d))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} (e) PESSOA INCLUÍDA / REMOVIDA — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
