// scripts/sincronizacao-automatica-genealogia.test.ts
// Passo C (08/10/2026): a Genealogia prevalece e a árvore a acompanha sozinha, sem botão.
//   vazio → grava · igual → nada · diferente → aviso com escolha · Genealogia vazia → nada (nunca apaga) · parêntese ignorado · nome nunca ·
//   local do óbito fora dos casos antigos · texto único separado só quando seguro · ambíguos e revisão manual nunca gravam · histórico com antes/depois/quem/opção.
//   node scripts/ci/gate-build.mjs --suite todas --so sincronizacao-automatica-genealogia
import { existsSync, readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { criarPalco } from "./_fixture-arvore-fonte"
import {
  CAMPOS_SINCRONIZAVEIS, conflitoQuaseIgual, diferencasDoEvento, ehLocalDoObito, mesmoLugar, registroAnteriorAoEvento, separarLugarUnico, suspeitaNoValorDoRegistro,
} from "../src/lib/genealogia/sincronizacao-registral"

const MARCA = "SINCAUT"
let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const campo = (chave: string) => CAMPOS_SINCRONIZAVEIS.find((c) => c.chave === chave)!

async function main() {
  exigirBancoDeTeste("sincronizacao-automatica-genealogia.test.ts")

  console.log("\nA) As regras (puras)")
  const reg = { data_evento: "1937-10-03", cidade_registro: "Santo André", estado_registro: "São Paulo", pais_registro: "Brasil" }
  const vazia = diferencasDoEvento("NASCIMENTO", reg, { data_nasc: null, local_nasc: null, estado_nasc: null, pais_nasc: null })
  ok("árvore VAZIA: os 4 campos preenchem (data, cidade, estado, país)", vazia.length === 4 && vazia.every((d) => d.tipo === "PREENCHER"))
  ok("MESMO valor: nada", diferencasDoEvento("NASCIMENTO", reg, { data_nasc: new Date("1937-10-03T00:00:00Z"), local_nasc: "Santo André", estado_nasc: "São Paulo", pais_nasc: "Brasil" }).length === 0)
  const dif = diferencasDoEvento("NASCIMENTO", reg, { data_nasc: new Date("1937-10-12T00:00:00Z"), local_nasc: "Santo André", estado_nasc: "São Paulo", pais_nasc: "Brasil" })
  ok("valores DIFERENTES: conflito com os dois valores (para o aviso)", dif.length === 1 && dif[0].tipo === "CONFLITO" && dif[0].arvore === "1937-10-12" && dif[0].registro === "1937-10-03")
  ok("Genealogia VAZIA e árvore preenchida: nada (nunca apaga)", diferencasDoEvento("NASCIMENTO", { data_evento: null, cidade_registro: "", estado_registro: null, pais_registro: " " }, { data_nasc: new Date("1937-10-03T00:00:00Z"), local_nasc: "Santo André", estado_nasc: "SP", pais_nasc: "Brasil" }).length === 0)
  ok("parêntese no fim de cidade/estado é ignorado na comparação; «SP» = «São Paulo»", mesmoLugar({ origem: "cidade_registro" }, "São Paulo (Santo Amaro)", "São Paulo") && mesmoLugar({ origem: "estado_registro" }, "SP (2º Subd.)", "São Paulo"))
  ok("o NOME nunca é um campo sincronizável", !CAMPOS_SINCRONIZAVEIS.some((c) => /nome/i.test(c.coluna)))
  ok("local do óbito é identificado (para ficar fora dos casos antigos)", ehLocalDoObito("PESSOA.local_obito") && ehLocalDoObito("PESSOA.estado_obito") && ehLocalDoObito("PESSOA.pais_obito") && !ehLocalDoObito("PESSOA.local_nasc") && !ehLocalDoObito("PESSOA.data_obito"))
  ok("a nacionalidade NÃO é campo sincronizável (o registro não traz)", !CAMPOS_SINCRONIZAVEIS.some((c) => /nacional/i.test(c.coluna)))

  console.log("\nB) Cartório/lugar em texto único")
  const s1 = separarLugarUnico("Santo André - São Paulo", null)
  ok("«Santo André - São Paulo» → cidade Santo André, estado São Paulo", s1.cidade === "Santo André" && s1.estado === "São Paulo" && !s1.revisaoManual)
  ok("«Santo André, SP» → sigla vira o nome do estado", separarLugarUnico("Santo André, SP", null).estado === "São Paulo")
  ok("estado já preenchido igual: só tira o estado da cidade", separarLugarUnico("Cravinhos - SP", "São Paulo").cidade === "Cravinhos")
  ok("depois do separador NÃO é estado («Santo André - 1º Subdistrito»): não adivinha → revisão manual, nada gravado", (() => { const r = separarLugarUnico("Santo André - 1º Subdistrito", null); return r.revisaoManual && r.cidade === null && !!r.motivo })())
  ok("estado do texto difere do campo estado: revisão manual", separarLugarUnico("Santo André - São Paulo", "Rio de Janeiro").revisaoManual)
  ok("cidade normal (sem separador) segue como está; «Entre-Ijuís» não é separado", separarLugarUnico("Entre-Ijuís", null).cidade === "Entre-Ijuís" && separarLugarUnico("São Paulo", null).cidade === "São Paulo")

  console.log("\nC) Ambíguos (cara de erro) — não se grava")
  ok("data de 1200 e data no futuro são impossíveis", !!suspeitaNoValorDoRegistro(campo("PESSOA.data_nasc"), "1200-01-01") && !!suspeitaNoValorDoRegistro(campo("PESSOA.data_nasc"), "2999-01-01") && suspeitaNoValorDoRegistro(campo("PESSOA.data_nasc"), "1937-10-03") === null)
  ok("cidade com número, curta ou «N/A» tem cara de erro; «Santo André» não", !!suspeitaNoValorDoRegistro(campo("PESSOA.local_nasc"), "Rua 7") && !!suspeitaNoValorDoRegistro(campo("PESSOA.local_nasc"), "X") && !!suspeitaNoValorDoRegistro(campo("PESSOA.local_nasc"), "N/A") && suspeitaNoValorDoRegistro(campo("PESSOA.local_nasc"), "Santo André") === null)
  ok("«Águilas» × «Aguilar» são quase iguais (ambíguo); «SP» × «Rio de Janeiro» e datas diferentes não", conflitoQuaseIgual(campo("PESSOA.local_nasc"), "Águilas", "Aguilar") !== null && conflitoQuaseIgual(campo("PESSOA.local_nasc"), "Cravinhos", "Comacchio") === null && conflitoQuaseIgual(campo("PESSOA.estado_nasc"), "SP", "Rio de Janeiro") === null && conflitoQuaseIgual(campo("PESSOA.data_nasc"), "1937-10-12", "1937-10-03") === null)
  ok("data do registro anterior à do evento é contradição", registroAnteriorAoEvento("1961-07-20", "1960-01-01") && !registroAnteriorAoEvento("1961-07-20", "1961-07-20"))

  console.log("\nD) No banco de teste — relatório e lote dos casos antigos")
  const P = criarPalco(MARCA)
  await P.montar()
  try {
    const { relatorioDeCasosAntigos, aplicarLoteDeCasosAntigos } = await import("../src/services/genealogia/sincronizar-com-registro")
    for (const [code, chave] of [[P.COD.NAS, "CERTIDAO_NASCIMENTO"], [P.COD.CAS, "CERTIDAO_CASAMENTO"], [P.COD.OBI, "CERTIDAO_OBITO"]] as const) {
      if (!(await prisma.tipoDocumentoCadastro.findFirst({ where: { legacyEnumKey: chave }, select: { id: true } }))) await prisma.tipoDocumentoCadastro.updateMany({ where: { code }, data: { legacyEnumKey: chave } })
    }
    const c = await P.novoCenario("casos")
    await P.putPessoa(c.titularId, { vivo: false, documentacao: true })
    await prisma.pessoa.update({ where: { id: c.titularId }, data: { data_nasc: new Date("1937-10-12T00:00:00Z"), local_nasc: "Cravinhos", estado_nasc: null, pais_nasc: null, local_obito: "Lugar do Óbito Antigo", profissao: "x" } })
    const doDoTipo = (chave: string) => prisma.documento.findFirstOrThrow({ where: { pessoaId: c.titularId, documentType: { legacyEnumKey: chave }, status: { notIn: ["NAO_EXIGIDO", "CANCELADO"] }, necessidadeId: { not: null } }, select: { id: true } })
    const nas = await doDoTipo("CERTIDAO_NASCIMENTO"), obi = await doDoTipo("CERTIDAO_OBITO")
    await prisma.documento.update({ where: { id: nas.id }, data: { data_evento: new Date("1937-10-03T00:00:00Z"), cidade_registro: "Santo André - São Paulo", estado_registro: null, pais_registro: "Brasil" } })
    await prisma.documento.update({ where: { id: obi.id }, data: { data_evento: new Date("1200-01-01T00:00:00Z"), cidade_registro: "Comacchio", estado_registro: null, pais_registro: "Itália" } })
    for (const d of [nas.id, obi.id]) await prisma.phaseWorkflowStepInstance.updateMany({ where: { documentoId: d, stepKey: "localizar_registro" }, data: { status: "CONCLUIDO" } })

    const rel = await relatorioDeCasosAntigos()
    const meu = <T extends { processoId: number }>(l: T[]) => l.filter((x) => x.processoId === c.processoId)
    const aplicar = meu(rel.aplicar), amb = meu(rel.ambiguos), obito = meu(rel.ignoradosLocalDoObito)
    ok("relatório: a data do nascimento (12/10 na árvore × 03/10 na Genealogia) é caso a APLICAR, com os dois valores", aplicar.some((l) => l.chave === "PESSOA.data_nasc" && l.arvoreTexto === "12/10/1937" && l.genealogiaTexto === "03/10/1937" && l.pessoa && l.familia && l.certidao))
    ok("relatório: cidade/estado separados do texto único entram para aplicar (Santo André · São Paulo)", aplicar.some((l) => l.chave === "PESSOA.local_nasc" && l.genealogia === "Santo André") && aplicar.some((l) => l.chave === "PESSOA.estado_nasc" && l.genealogia === "São Paulo"))
    ok("relatório: a data de óbito do ano 1200 vai para AMBÍGUOS (não grava)", amb.some((l) => l.chave === "PESSOA.data_obito" && /impossível/.test(l.motivo ?? "")))
    ok("relatório: o local do óbito vai para a lista «não tocado»", obito.some((l) => l.chave === "PESSOA.local_obito") && !aplicar.some((l) => ehLocalDoObito(l.chave)))

    const gravados = await aplicarLoteDeCasosAntigos(c.arvoreId, aplicar)
    ok("o lote grava exatamente as linhas a aplicar", gravados === aplicar.length, `${gravados} × ${aplicar.length}`)
    const p = await prisma.pessoa.findUniqueOrThrow({ where: { id: c.titularId }, select: { data_nasc: true, local_nasc: true, estado_nasc: true, pais_nasc: true, data_obito: true, local_obito: true, profissao: true } })
    ok("árvore passou a ter o valor da Genealogia (03/10/1937 · Santo André · São Paulo · Brasil)", dia(p.data_nasc) === "1937-10-03" && p.local_nasc === "Santo André" && p.estado_nasc === "São Paulo" && p.pais_nasc === "Brasil")
    ok("NÃO tocou: data do óbito ambígua, local do óbito, outros campos", p.data_obito === null && p.local_obito === "Lugar do Óbito Antigo" && p.profissao === "x")
    const log = await prisma.logAuditoria.findFirst({ where: { acao: "SINCRONIZACAO_REGISTRAL", entidadeId: c.processoId, descricao: { contains: "data do nascimento" } } })
    const det = (log?.detalhes ?? {}) as Record<string, unknown>
    ok("histórico: campo, valor antigo, novo, quem, opção e origem (reversível)", !!log && det.antes === "1937-10-12" && det.depois === "1937-10-03" && det.origem === "CASOS_ANTIGOS" && /caso antigo/.test(String(det.opcao)) && det.quem === "sistema" && det.chave === "PESSOA.data_nasc")
    const rel2 = await relatorioDeCasosAntigos()
    ok("rodar de novo: nada mais a aplicar neste processo (idempotente); o ambíguo continua separado", meu(rel2.aplicar).length === 0 && meu(rel2.ambiguos).length >= 1)
  } finally {
    await P.limpar()
  }

  console.log("\nE) O botão acabou")
  const arv = readFileSync("src/components/arvore/arvore-genealogica-view.tsx", "utf8")
  ok("sem botão «Sincronizar com a Genealogia», sem diálogo, sem rota", !/Sincronizar com a Genealogia|SincronizarComGenealogiaModal|botao-sincronizar-genealogia/.test(arv) && !existsSync("src/components/arvore/sincronizar-com-genealogia.tsx") && !existsSync("src/app/api/arvore/[arvoreid]/sincronizacao/route.ts"))
  ok("o vigia 'q' compara a Genealogia com a árvore", /detectarRegraQ/.test(readFileSync("lib/saude/verificacoes/regras-do-marco.ts", "utf8")))
  console.log(`\n${n - falhou}/${n} verificações`)
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
