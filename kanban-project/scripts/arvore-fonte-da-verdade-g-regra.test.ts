// scripts/arvore-fonte-da-verdade-g-regra.test.ts
// ============================================================================
// CAMINHO (g) — REGRA DOCUMENTAL. "A árvore genealógica é a única fonte de verdade
// documental" (CLAUDE.md §37): a regra diz O QUE se exige de quem a árvore diz que é.
// Mudar a regra reconcilia os processos abertos que a têm — e só esses:
//   IDA     publicar → nascem as exigências dos processos abertos a que a regra se aplica;
//   VOLTA   inativar/arquivar → dispensa SÓ o que dela derivou (documento NAO_EXIGIDO, passo/tarefa cancelados);
//   IDA 2   reabrir e publicar → REATIVA o mesmo (sem duplicar);
//   SEM REGRA  a última regra inativada dispensa as órfãs (antes: retorno cedo, sobra eterna).
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fonte-da-verdade-g-regra
// Roda contra o banco de TESTE (rotas reais, token de administrador).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVG"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-fonte-da-verdade-g-regra.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("ÁRVORE = FONTE DA VERDADE — (g) REGRA DOCUMENTAL\n")

  const c = await P.novoCenario("regra", { conjuge: true })
  await P.putPessoa(c.titularId, { casado: true })
  await P.postUniao(c.titularId, c.conjugeId!)
  const uniao = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: c.titularId } })
  let f = await P.foto(c.processoId)
  const casId = f.necDe("CAS", { uniaoId: uniao.id })[0].id
  const nasId = f.necDe("NAS", { pessoaId: c.titularId })[0].id
  let dCas = await P.derivados(casId)
  ok("pré: casamento e nascimento com cadeia completa", dCas.docs.length === 1 && dCas.tarefasAbertas === 1 && (await P.derivados(nasId)).tarefasAbertas === 1)
  const docCas = dCas.docs[0].id, tarCas = dCas.tarefas[0].id

  secao("INATIVAR uma regra dispensa SÓ o que dela derivou")
  const r1 = await P.postRegra(P.regraIds.CAS, "inativar")
  ok("POST inativar responde 200", r1.status === 200, `${r1.status} ${JSON.stringify(await r1.clone().json()).slice(0, 200)}`)
  dCas = await P.derivados(casId)
  ok("necessidade de casamento DISPENSADA; documento NAO_EXIGIDO (mesmo id); passos e tarefa cancelados", dCas.status === "DISPENSADA" && dCas.docs[0].id === docCas && dCas.docs[0].status === "NAO_EXIGIDO" && dCas.passosVivos === 0 && dCas.tarefasAbertas === 0, JSON.stringify(dCas))
  ok("motivo da tarefa aponta a regra ('regra documental … inativada')", /inativada/.test(dCas.tarefas[0].causaRemovidaMotivo ?? ""), dCas.tarefas[0].causaRemovidaMotivo ?? "")
  const dNas = await P.derivados(nasId)
  ok("o nascimento (outra regra) NÃO foi tocado", dNas.status === "PENDENTE" && dNas.tarefasAbertas === 1)

  secao("REATIVAR + PUBLICAR de novo reativa o MESMO (sem duplicar)")
  const r2 = await P.postRegra(P.regraIds.CAS, "reativar")
  ok("reativar (volta a rascunho) responde 200", r2.status === 200, String(r2.status))
  const r3 = await P.postRegra(P.regraIds.CAS, "publicar")
  ok("publicar responde 200", r3.status === 200, `${r3.status} ${JSON.stringify(await r3.clone().json()).slice(0, 200)}`)
  f = await P.foto(c.processoId)
  dCas = await P.derivados(casId)
  ok("continua UMA necessidade de casamento (mesmo id), PENDENTE", f.necDe("CAS", { uniaoId: uniao.id }).length === 1 && dCas.status === "PENDENTE")
  ok("mesmo Documento PENDENTE, 1 passo vivo, mesma tarefa aberta", dCas.docs.length === 1 && dCas.docs[0].id === docCas && dCas.docs[0].status === "PENDENTE" && dCas.passosVivos === 1 && dCas.tarefasAbertas === 1 && dCas.tarefas.length === 1 && dCas.tarefas[0].id === tarCas, JSON.stringify(dCas))

  secao("ARQUIVAR a regra")
  const r4 = await P.postRegra(P.regraIds.CAS, "arquivar")
  dCas = await P.derivados(casId)
  ok("arquivar → necessidade dispensada e tarefa cancelada", r4.status === 200 && dCas.status === "DISPENSADA" && dCas.tarefasAbertas === 0, `${r4.status} ${dCas.status}`)
  await P.postRegra(P.regraIds.CAS, "reativar")
  await P.postRegra(P.regraIds.CAS, "publicar")
  dCas = await P.derivados(casId)
  ok("reabrir e publicar de novo reativa o mesmo", dCas.status === "PENDENTE" && dCas.tarefasAbertas === 1 && dCas.tarefas.length === 1)

  secao("PUT legado /matriz-documental/[id] (arquivado) também propaga")
  const r5 = await P.putMatrizLegada(P.regraIds.NAS, { arquivado: true })
  ok("PUT arquivado=true responde 200", r5.status === 200, String(r5.status))
  const dNas2 = await P.derivados(nasId)
  ok("nascimento dispensado, documento NAO_EXIGIDO, tarefa cancelada", dNas2.status === "DISPENSADA" && dNas2.docs.every((x) => x.status === "NAO_EXIGIDO") && dNas2.tarefasAbertas === 0, JSON.stringify(dNas2))
  await P.putMatrizLegada(P.regraIds.NAS, { arquivado: false })
  const dNas3 = await P.derivados(nasId)
  ok("PUT arquivado=false → reativa o mesmo", dNas3.status === "PENDENTE" && dNas3.tarefasAbertas === 1 && dNas3.tarefas.length === 1)

  secao("SEM REGRA RESTANTE: dispensa as órfãs em vez de retornar cedo")
  for (const k of ["NAS", "CAS", "OBI", "REQ"] as const) await P.postRegra(P.regraIds[k], "inativar")
  f = await P.foto(c.processoId)
  ok("nenhuma necessidade ativa sobrou no processo", f.necs.every((n) => n.status === "DISPENSADA"), JSON.stringify(f.necs.map((n) => [n.cod, n.status])))
  ok("nenhum documento ativo, nenhum passo vivo, nenhuma tarefa aberta", f.docs.every((d) => P.DOC_INATIVO.includes(d.status)) && f.passos.every((p) => P.PASSO_FECHADO.includes(p.status)) && f.tarefas.every((t) => P.TAREFA_FECHADA.includes(t.statusTarefa)), JSON.stringify({ d: f.docs.map((d) => d.status), t: f.tarefas.map((t) => t.statusTarefa) }))

  secao("IDEMPOTÊNCIA — repetir a ação não muda nada")
  const antes = JSON.stringify((await P.foto(c.processoId)).necs)
  await P.postRegra(P.regraIds.NAS, "inativar")
  ok("inativar de novo = mesmo estado", JSON.stringify((await P.foto(c.processoId)).necs) === antes)

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} (g) REGRA DOCUMENTAL — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
