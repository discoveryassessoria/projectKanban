// scripts/arvore-fonte-da-verdade-contagens.test.ts
// ============================================================================
// CONTAGENS — "A árvore genealógica é a única fonte de verdade documental" (CLAUDE.md §37).
//   Cenário: necessidade removida pela árvore + Documento NAO_EXIGIDO. Geral (/estatisticas), Documentos
//   (/documentos), Torre (progressoRealDoProcesso), Foco da família, Central e a fonte única
//   (documentacaoRequeridaDoProcesso) mostram OS MESMOS números — antes, depois e ao marcar de novo.
//
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-fonte-da-verdade-contagens
// Roda contra o banco de TESTE (rotas reais, token de administrador).
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"

const MARCA = "ARVCT"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  exigirBancoDeTeste("arvore-fonte-da-verdade-contagens.test.ts")
  const P = criarPalco(MARCA)
  await P.montar()
  console.log("CONTAGENS — MESMOS NÚMEROS EM TODAS AS TELAS\n")

  const { documentacaoRequeridaDoProcesso } = await import("../src/lib/process-stage/documentacao-requerida")
  const { resolverCompletudeDocumental } = await import("../src/lib/process-stage/completude-documental")
  const { progressoRealDoProcesso } = await import("../lib/operacional/metricas-processo")
  const { focoDaFamilia } = await import("../lib/operacional/torre-foco")
  const { NextRequest } = await import("next/server")

  const c = await P.novoCenario("conta", { conjuge: true })
  await P.putPessoa(c.titularId, { casado: true })
  await P.postUniao(c.titularId, c.conjugeId!)
  const uniao = await prisma.uniao.findFirstOrThrow({ where: { pessoa1Id: c.titularId } })

  /** TODAS as telas, lidas pelas MESMAS portas de produção. */
  const lerTodas = async () => {
    const fonte = await documentacaoRequeridaDoProcesso(c.processoId)
    const central = await resolverCompletudeDocumental(c.processoId, { escopoPessoa: "TODAS" }) // Central, /phase, /app/processos
    const torre = await progressoRealDoProcesso(c.processoId) // Torre
    const certFoco = (await focoDaFamilia(c.processoId))!.certidoes // Foco da família (Torre)
    const foco = { required: certFoco.requeridas, completed: certFoco.recebidas, percentage: torre.percentage }
    const { GET: estat } = await import("../src/app/api/processos/[processoId]/estatisticas/route")
    const geral = await (await estat(new Request(`http://localhost/api/processos/${c.processoId}/estatisticas`), { params: Promise.resolve({ processoId: String(c.processoId) }) })).json()
    const { GET: docsRota } = await import("../src/app/api/processos/[processoId]/documentos/route")
    const docs = await (await docsRota(new NextRequest(`http://localhost/api/processos/${c.processoId}/documentos`, { headers: { Authorization: `Bearer ${P.token}` } }), { params: Promise.resolve({ processoId: String(c.processoId) }) })).json()
    return {
      fonte: [fonte.requeridos, fonte.recebidos, fonte.pendentes, fonte.percentual],
      central: [central.required, central.completed, Math.max(0, central.required - central.completed), central.percentage],
      torre: [torre.required, torre.completed, Math.max(0, torre.required - torre.completed), torre.percentage],
      foco: [foco.required, foco.completed, Math.max(0, foco.required - foco.completed), foco.percentage],
      geral: [geral.documentacao.total, geral.documentacao.recebidos, Math.max(0, geral.documentacao.total - geral.documentacao.recebidos), geral.documentacao.percentual],
      documentos: [docs.documentacao.requeridos, docs.documentacao.recebidos, docs.documentacao.pendentes, docs.documentacao.percentual],
    }
  }
  const iguais = (r: Awaited<ReturnType<typeof lerTodas>>) => new Set(Object.values(r).map((v) => JSON.stringify(v))).size === 1

  secao("ANTES — casal casado: nascimento + requerente + casamento exigidos")
  const antes = await lerTodas()
  ok("Geral, Documentos, Torre, Foco e Central mostram OS MESMOS números", iguais(antes), JSON.stringify(antes))
  ok("requeridos = 3 (nascimento + certidão do requerente + casamento da união)", antes.fonte[0] === 3, JSON.stringify(antes.fonte))

  secao("DEPOIS — necessidade removida pela árvore + Documento NAO_EXIGIDO")
  await P.putPessoa(c.titularId, { casado: false })
  const f = await P.foto(c.processoId)
  const cas = f.necDe("CAS", { uniaoId: uniao.id })[0]
  ok("pré: a necessidade de casamento está DISPENSADA e o Documento NAO_EXIGIDO", cas.status === "DISPENSADA" && f.docs.some((d) => d.necessidadeId === cas.id && d.status === "NAO_EXIGIDO"))
  const depois = await lerTodas()
  ok("as seis leituras continuam IDÊNTICAS", iguais(depois), JSON.stringify(depois))
  ok("requeridos caiu para 2 — a necessidade removida e o Documento NAO_EXIGIDO NÃO contam", depois.fonte[0] === 2, JSON.stringify(depois.fonte))
  ok("requeridos = recebidos + pendentes (fecha matematicamente)", depois.fonte[0] === depois.fonte[1] + depois.fonte[2])

  secao("Documento NAO_EXIGIDO solto (mesmo sem necessidade) também não conta")
  const tipo = await prisma.tipoDocumentoCadastro.findFirstOrThrow({ where: { code: P.COD.OBI }, select: { id: true } })
  await prisma.documento.create({ data: { pessoaId: c.titularId, status: "NAO_EXIGIDO", origem: "automatica", documentTypeId: tipo.id } })
  const solto = await lerTodas()
  ok("nada mudou nas seis leituras", iguais(solto) && JSON.stringify(solto.fonte) === JSON.stringify(depois.fonte), JSON.stringify(solto.fonte))

  secao("IDA 2 — marcar de novo: todos voltam a 3, ainda idênticos")
  await P.putPessoa(c.titularId, { casado: true })
  const volta = await lerTodas()
  ok("seis leituras idênticas e requeridos = 3", iguais(volta) && volta.fonte[0] === 3, JSON.stringify(volta))

  secao("FIAÇÃO — cada tela lê de UMA função (prova por fonte)")
  const { readFileSync } = await import("fs")
  const ler = (r: string) => readFileSync(r, "utf8")
  ok("Geral (/estatisticas) e Documentos (/documentos) → documentacaoRequeridaDoProcesso", /documentacaoRequeridaDoProcesso\(/.test(ler("src/app/api/processos/[processoId]/estatisticas/route.ts")) && /documentacaoRequeridaDoProcesso\(/.test(ler("src/app/api/processos/[processoId]/documentos/route.ts")))
  ok("Torre (progressoRealDoProcesso) e Foco (torre-foco) → mesma função", /documentacaoRequeridaDoProcesso/.test(ler("lib/operacional/metricas-processo.ts")) && /progressoRealDoProcesso/.test(ler("lib/operacional/torre-foco.ts")))
  ok("Central, /phase e /app/processos → resolverCompletudeDocumental (a função que a fonte única reembala)", /resolverCompletudeDocumental/.test(ler("src/app/api/processos/[processoId]/central-operacional/route.ts")) && /resolverCompletudeDocumental/.test(ler("src/app/api/processos/[processoId]/phase/route.ts")) && /resolverCompletudeDocumental/.test(ler("src/app/api/app/processos/[id]/route.ts")) && /resolverCompletudeDocumental/.test(ler("src/lib/process-stage/documentacao-requerida.ts")))
  ok("Home não tem conta própria de certidões (conta tarefas, grain TAREFA)", !/documentacaoRequerida|resolverCompletudeDocumental|certidoesObrigatorias/.test(ler("src/lib/home/coleta.ts")))

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} CONTAGENS — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
