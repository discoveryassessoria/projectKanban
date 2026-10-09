// scripts/local-obito-colunas.test.ts
// ============================================================================
// LOCAL DO ÓBITO EM COLUNAS PRÓPRIAS (07/10/2026): Pessoa.local_obito / estado_obito / pais_obito (migration aditiva; `local_emigracao` intacto).
//   • leitura segura do texto antigo (só se a pessoa faleceu e não tem emigração); • comparativo e modal com a árvore (cidade×cidade, estado×estado, país×país);
//   • Planilha e árvore leem as colunas novas; • vigia regra m (INT-003).
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { criarPalco } from "./_fixture-arvore-fonte"
import { lerLocalDeObito, podeLerComoObito, colunasDoLocalDeObito, textoDoLocalDeObito } from "../src/lib/genealogia/local-obito"
import { diferencasDoEvento } from "../src/lib/genealogia/sincronizacao-registral"
import { problemaDoLocalDoObito, detectarRegraM } from "../lib/saude/verificacoes/regras-do-marco"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "LOBITO"

async function main() {
  exigirBancoDeTeste("local-obito-colunas.test.ts")

  secao("A) Leitura segura do texto antigo (puro)")
  ok("«Santos-SP (1º Subd.)» → cidade «Santos (1º Subd.)», estado SP", JSON.stringify(lerLocalDeObito("Santos-SP (1º Subd.)")) === JSON.stringify({ cidade: "Santos (1º Subd.)", estado: "SP" }))
  ok("«São Paulo - SP» e «Ribeirão Preto/SP» e «Itapira, sp»", lerLocalDeObito("São Paulo - SP")?.estado === "SP" && lerLocalDeObito("Ribeirão Preto/SP")?.cidade === "Ribeirão Preto" && lerLocalDeObito("Itapira, sp")?.estado === "SP")
  ok("só a cidade («Santos») vale como cidade, sem estado", JSON.stringify(lerLocalDeObito("Santos")) === JSON.stringify({ cidade: "Santos", estado: null }))
  ok("o que NÃO dá para ler com segurança fica de fora (número, sigla inexistente, vazio)", lerLocalDeObito("Porto de Gênova 3") === null && lerLocalDeObito("Rio-XX 12") === null && lerLocalDeObito("   ") === null)
  ok("só vale como óbito se a pessoa faleceu E não tem dado de emigração", podeLerComoObito({ vivo: false }) && !podeLerComoObito({ vivo: true }) && !podeLerComoObito({ vivo: false, porto_embarque: "Gênova" }) && !podeLerComoObito({ data_obito: new Date(), data_emigracao: new Date() }))
  ok("formulário «Cidade-UF» ↔ colunas", JSON.stringify(colunasDoLocalDeObito("Santos-SP")) === JSON.stringify({ local_obito: "Santos", estado_obito: "SP" }) && textoDoLocalDeObito({ local_obito: "Santos", estado_obito: "SP" }) === "Santos-SP" && textoDoLocalDeObito({ local_emigracao: "Santos-SP" }) === "Santos-SP")

  secao("B) Comparativo com a árvore (puro)")
  const arv = { data_obito: null, local_obito: "Ribeirão Preto (2º Subd.)", estado_obito: "SP", pais_obito: null }
  const d = diferencasDoEvento("OBITO", { cidade_registro: "Birigui", estado_registro: "São Paulo", pais_registro: "Brasil" }, arv)
  ok("cidade do óbito: «Birigui» × «Ribeirão Preto (2º Subd.)» = CONFLITO (modal)", d.some((x) => x.campo.chave === "PESSOA.local_obito" && x.tipo === "CONFLITO"))
  ok("estado «São Paulo» × «SP» é o mesmo lugar (sem modal); país vazio na árvore PREENCHE", !d.some((x) => x.campo.chave === "PESSOA.estado_obito") && d.some((x) => x.campo.chave === "PESSOA.pais_obito" && x.tipo === "PREENCHER"))
  ok("o parêntese no fim da cidade é ignorado (mesma cidade)", diferencasDoEvento("OBITO", { cidade_registro: "Ribeirão Preto" }, arv).length === 0)
  ok("o óbito nunca mexe em campo de nascimento", diferencasDoEvento("OBITO", { cidade_registro: "X" }, { local_nasc: "Y" }).every((x) => x.campo.evento === "OBITO"))
  ok("vigia (puro): certidão sem cidade na árvore / cidade diferente é acusada; igual não", problemaDoLocalDoObito({ cidadeCertidao: "Birigui", estadoCertidao: null, cidadeArvore: null, estadoArvore: null }) !== null && problemaDoLocalDoObito({ cidadeCertidao: "Birigui", estadoCertidao: null, cidadeArvore: "Santos", estadoArvore: null }) !== null && problemaDoLocalDoObito({ cidadeCertidao: "Santos", estadoCertidao: "São Paulo", cidadeArvore: "Santos (1º Subd.)", estadoArvore: "SP" }) === null)

  secao("C) No banco de teste — as colunas existem e o fluxo grava nelas")
  const P = criarPalco(MARCA)
  await P.montar()
  const { PUT } = await import("../src/app/api/documentos/[id]/route")
  for (const [code, chave] of [[P.COD.NAS, "CERTIDAO_NASCIMENTO"], [P.COD.CAS, "CERTIDAO_CASAMENTO"], [P.COD.OBI, "CERTIDAO_OBITO"]] as const) {
    if (!(await prisma.tipoDocumentoCadastro.findFirst({ where: { legacyEnumKey: chave }, select: { id: true } }))) await prisma.tipoDocumentoCadastro.updateMany({ where: { code }, data: { legacyEnumKey: chave } })
  }
  const c = await P.novoCenario("lobito")
  await P.putPessoa(c.titularId, { vivo: false, documentacao: true })
  await prisma.pessoa.update({ where: { id: c.titularId }, data: { data_obito: new Date("2001-02-03T00:00:00Z"), local_emigracao: "Texto antigo de emigração", local_obito: "Ribeirão Preto (2º Subd.)", estado_obito: "SP" } })
  const doc = await prisma.documento.findFirstOrThrow({ where: { pessoaId: c.titularId, documentType: { legacyEnumKey: "CERTIDAO_OBITO" }, status: { notIn: ["NAO_EXIGIDO", "CANCELADO"] }, necessidadeId: { not: null } }, select: { id: true } })
  const put = async (body: Record<string, unknown>) => { const r = await PUT(P.req(`/api/documentos/${doc.id}`, "PUT", body), P.ctx(doc.id)); return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> } }
  const pes = () => prisma.pessoa.findUniqueOrThrow({ where: { id: c.titularId }, select: { local_obito: true, estado_obito: true, pais_obito: true, local_emigracao: true } })

  const r1 = await put({ cidade_registro: "Birigui" })
  ok("cidade do óbito diferente da árvore → 409 CONFIRMACAO_ARVORE (modal), nada salvo", r1.status === 409 && (r1.json as { divergencias?: Array<{ chave: string }> }).divergencias?.[0]?.chave === "PESSOA.local_obito" && (await pes()).local_obito === "Ribeirão Preto (2º Subd.)")
  const r2 = await put({ cidade_registro: "Birigui", decisoes: { "PESSOA.local_obito": "CADASTRO" } })
  ok("«cadastro»: corrige a coluna local_obito da árvore e NÃO toca em local_emigracao", r2.status === 200 && (await pes()).local_obito === "Birigui" && (await pes()).local_emigracao === "Texto antigo de emigração")
  const r3 = await put({ pais_registro: "Brasil" })
  ok("país vazio na árvore: preenche pais_obito sem modal", r3.status === 200 && (await pes()).pais_obito === "Brasil")
  const r4 = await put({ estado_registro: "São Paulo", cidade_registro: "Birigui" })
  ok("estado «São Paulo» × «SP» e mesma cidade: salva sem modal", r4.status === 200)

  secao("D) Vigia, planilha e árvore leem as colunas")
  await prisma.phaseWorkflowStepInstance.updateMany({ where: { documentoId: doc.id, stepKey: "localizar_registro" }, data: { status: "CONCLUIDO" } })
  ok("vigia m quieto quando certidão e árvore dizem o mesmo lugar", (await detectarRegraM()).filter((v) => v.registroId === doc.id).length === 0)
  await prisma.pessoa.update({ where: { id: c.titularId }, data: { local_obito: "Santos" } })
  const vm = (await detectarRegraM()).filter((v) => v.registroId === doc.id)
  ok("vigia m ACUSA quando a árvore diz outro lugar (controle positivo)", vm.length === 1 && /Birigui/.test(vm[0].detalhe), vm[0]?.detalhe)
  const ler = (f: string) => readFileSync(f, "utf8")
  ok("Planilha documental lê local_obito/estado_obito para o óbito", /categoria === 'OBITO' \? lugar\(p\.local_obito, p\.estado_obito\)/.test(ler("lib/financeiro/leitura/planilha-documental.ts")))
  ok("árvore (sidebar) e motor leem as colunas novas", /textoDoLocalDeObito\(pessoa\)/.test(ler("src/components/arvore/pessoa-sidebar.tsx")) && /cidadeObito/.test(ler("src/lib/genealogia/motor/eventos.ts")))
  ok("o formulário e a importação gravam local_obito e não tocam mais em local_emigracao", /local_obito: isFalecido \? cidadeObito\.trim\(\) \|\| null : null/.test(ler("src/components/arvore/arvore-genealogica-view.tsx")) && /pais_obito: isFalecido/.test(ler("src/components/arvore/arvore-genealogica-view.tsx")) && !/local_emigracao: isFalecido/.test(ler("src/components/arvore/arvore-genealogica-view.tsx")) && /local_obito: texto\(p\.local_obito\)/.test(ler("src/app/api/genealogy/arvore/importar/route.ts")))
  ok("a migration é só ADITIVA (ADD COLUMN IF NOT EXISTS; nada de DROP/UPDATE/DELETE)", (() => { const m = ler("prisma/migrations/20261007200000_pessoa_local_obito/migration.sql").replace(/--.*$/gm, ""); return (m.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length === 3 && !/DROP|UPDATE|DELETE|ALTER COLUMN/i.test(m) })())

  await P.limpar()
  console.log(`\n${falhou === 0 ? "✅" : "❌"} LOCAL DO ÓBITO — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
}
main().catch((e) => { console.log(`  ❌ ERRO: ${String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(-700)}`); process.exit(1) }).finally(() => prisma.$disconnect())
