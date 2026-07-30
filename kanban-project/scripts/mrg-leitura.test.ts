/**
 * MRG — normalização, classificação, EXTRAÇÃO DUPLA e conferência.
 * Rodar: npx tsx scripts/mrg-leitura.test.ts
 *
 * O que este arquivo protege:
 *  · data registral escrita em palavra ("aos vinte e cinco dias do mês de
 *    janeiro de mil novecentos e vinte e três") vira ISO;
 *  · grafia histórica e abreviação ("Ma. Jozé da Sylva") é reconhecida;
 *  · nome de casada é reconhecido como variação, não como outra pessoa;
 *  · as DUAS leituras são independentes (uma erra, a outra não);
 *  · divergência em campo CRÍTICO BLOQUEIA — o motor não escolhe a de maior
 *    confiança. Este é o teste que impede a regressão mais perigosa do módulo.
 */
import {
  normalizarData,
  normalizarNome,
  normalizarLocal,
  normalizarIdade,
  numeralEscritoParaInteiro,
  ehVariacaoDeCasamento,
  referenciaRegistral,
  sobrenomeDe,
  prenomeDe,
  sexoDoPapel,
} from "../src/lib/genealogia/registral/normalizacao"
import { classificarDocumento, naturezaDoTipoDeclarado } from "../src/lib/genealogia/registral/classificador"
import { extrairAncorado, EXTRATOR_A } from "../src/lib/genealogia/registral/extracao-ancorada"
import { extrairEstrutural, EXTRATOR_B } from "../src/lib/genealogia/registral/extracao-estrutural"
import { conferir, saoEquivalentes } from "../src/lib/genealogia/registral/conferencia"
import { ehCampoCritico } from "../src/lib/genealogia/registral/campos"
import type { LeituraDocumento } from "../src/lib/genealogia/registral/tipos"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string, detalhe?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`)
  }
}

function leitura(p: Partial<LeituraDocumento> & { texto?: string }): LeituraDocumento {
  return {
    documentoId: p.documentoId ?? 1,
    pessoaId: p.pessoaId ?? null,
    necessidadeId: p.necessidadeId ?? null,
    itemCatalogoId: p.itemCatalogoId ?? null,
    tipoDeclarado: p.tipoDeclarado ?? null,
    paginas: p.paginas ?? (p.texto ? [{ pagina: 1, texto: p.texto }] : []),
    literais: p.literais ?? {},
    registral: p.registral ?? null,
    estruturado: p.estruturado ?? null,
    fonte: p.fonte ?? "teste",
  }
}

// ============================================================
console.log("\n1) Numeral escrito e data registral")
ok(numeralEscritoParaInteiro("mil novecentos e vinte e tres") === 1923, "1923 por extenso")
ok(numeralEscritoParaInteiro("vinte e cinco") === 25, "25 por extenso")
ok(numeralEscritoParaInteiro("mil oitocentos e noventa") === 1890, "1890 por extenso")
ok(numeralEscritoParaInteiro("banana") === null, "texto sem numeral → null")

ok(normalizarData("1923-01-25")?.iso === "1923-01-25", "ISO direto")
ok(normalizarData("25/01/1923")?.iso === "1923-01-25", "dd/mm/aaaa")
ok(normalizarData("25 de janeiro de 1923")?.iso === "1923-01-25", "dia de mês de ano")
ok(
  normalizarData("aos vinte e cinco dias do mes de janeiro do ano de mil novecentos e vinte e tres")?.iso ===
    "1923-01-25",
  "fórmula registral por extenso",
)
ok(normalizarData("12 gennaio 1901")?.iso === "1901-01-12", "mês em italiano")
ok(normalizarData("31/02/1920") === null, "31 de fevereiro é rejeitado, não 'corrigido'")
ok(normalizarData("1890")?.precisao === "ano", "só o ano → precisão ano")
ok(normalizarData("")?.iso === undefined, "vazio → null")

// ============================================================
console.log("\n2) Nome: abreviação histórica, sobrenome e prenome")
const n1 = normalizarNome("Ma. Jozé da Sylva")
ok(n1?.completo.includes("MARIA") === true, "Ma. expande para MARIA", n1?.completo)
ok(n1?.completo.includes("JOSE") === true, "Jozé normaliza para JOSE", n1?.completo)
ok(n1?.expandido === true, "marca que houve expansão (reduz confiança)")
ok(sobrenomeDe("Giovanni di Bianchi") === "DI BIANCHI", "partícula entra no sobrenome", sobrenomeDe("Giovanni di Bianchi"))
ok(sobrenomeDe("Maria da Silva") === "DA SILVA", "DA SILVA", sobrenomeDe("Maria da Silva"))
ok(prenomeDe("Maria José da Silva") === "MARIA JOSE", "prenome composto", prenomeDe("Maria José da Silva"))
ok(normalizarNome("filho de Antonio Souza")?.completo === "ANTONIO SOUZA", "remove rótulo 'filho de'")

console.log("\n3) Nome de casada — variação estrutural, nunca heurística de gênero")
const casada = ehVariacaoDeCasamento("Maria Souza", "Maria Souza Bianchi", "Giuseppe Bianchi")
ok(casada.compativel === true, "prenome preservado + sobrenome do cônjuge", casada)
const casadaSubst = ehVariacaoDeCasamento("Maria Souza", "Maria Bianchi", "Giuseppe Bianchi")
ok(casadaSubst.compativel === true, "substituição do sobrenome pelo do cônjuge", casadaSubst)
const casadaErrada = ehVariacaoDeCasamento("Maria Souza", "Maria Ferrari", "Giuseppe Bianchi")
ok(casadaErrada.compativel === false, "sobrenome que não é do cônjuge NÃO é variação", casadaErrada)
const outroPrenome = ehVariacaoDeCasamento("Maria Souza", "Joana Souza Bianchi", "Giuseppe Bianchi")
ok(outroPrenome.compativel === false, "prenome diferente derruba a hipótese", outroPrenome)

console.log("\n4) Localidade, idade e referência registral")
ok(
  normalizarLocal("2º Ofício de Registro Civil de Bento Gonçalves") === "BENTO GONCALVES",
  "cartório é removido da localidade",
  normalizarLocal("2º Ofício de Registro Civil de Bento Gonçalves"),
)
ok(normalizarLocal("Comune di Verona") === "VERONA", "comune italiano", normalizarLocal("Comune di Verona"))
ok(normalizarIdade("setenta e dois anos") === 72, "idade por extenso")
ok(normalizarIdade("72") === 72, "idade em dígito")
ok(normalizarIdade("999") === null, "idade impossível → null")
const ref = referenciaRegistral({ cartorio: "1º Ofício", livro: "A-12", folha: "045", termo: "1234" })
ok(ref.includes("A12") && ref.includes("045"), "referência registral canônica", ref)
ok(sexoDoPapel("PAI") === "M" && sexoDoPapel("MAE") === "F", "sexo vem do PAPEL, não do nome")
ok(sexoDoPapel("REGISTRADO") === null, "papel neutro não infere sexo")

// ============================================================
console.log("\n5) Classificação — declarado manda, texto denuncia divergência")
ok(naturezaDoTipoDeclarado("CERTIDAO_NASCIMENTO") === "NASCIMENTO", "enum de nascimento")
ok(naturezaDoTipoDeclarado("CNN") === "NATURALIZACAO", "CNN = certidão negativa de naturalização")
ok(naturezaDoTipoDeclarado("QUALQUER_COISA") === null, "tipo desconhecido → null")

const clsTexto = classificarDocumento(
  leitura({ texto: "CERTIDÃO DE CASAMENTO. Os nubentes contraíram matrimônio nesta data. Regime de bens: comunhão." }),
)
ok(clsTexto.natureza === "CASAMENTO", "classifica casamento pelo texto", clsTexto.natureza)
ok(clsTexto.fonte === "texto", "fonte = texto quando não há tipo declarado")

const clsDiv = classificarDocumento(
  leitura({
    tipoDeclarado: "CERTIDAO_NASCIMENTO",
    texto: "CERTIDÃO DE ÓBITO. Faleceu nesta cidade aos 72 anos. Causa da morte: parada cardíaca. Sepultado no cemitério municipal.",
  }),
)
ok(clsDiv.natureza === "NASCIMENTO", "o tipo DECLARADO continua valendo (dono é o Sistema Documental)")
ok(clsDiv.naturezaTextual === "OBITO", "mas o texto de óbito é detectado")
ok(clsDiv.divergenciaComDeclarado === true, "divergência é DENUNCIADA, não corrigida em silêncio")

const clsVazio = classificarDocumento(leitura({ texto: "abc" }))
ok(clsVazio.insuficiente === true, "texto insuficiente é reconhecido como insuficiente")

const clsEstruturado = classificarDocumento(leitura({ registral: { birth: { name: "X" } } }))
ok(clsEstruturado.natureza === "NASCIMENTO" && clsEstruturado.fonte === "estruturado", "canal estruturado classifica")

// ============================================================
console.log("\n6) EXTRAÇÃO DUPLA — as duas leituras são independentes")

const textoCertidao = [
  "REGISTRO DE NASCIMENTO DE JOAO BATISTA BIANCHI, filho de GIUSEPPE BIANCHI e de MARIA SOUZA,",
  "nasceu em BENTO GONCALVES aos 12 de marco de 1901, de profissao lavrador,",
  "residente na LINHA IMPERIAL.",
].join(" ")

const lidoA = extrairAncorado(
  leitura({
    texto: "Nome: JOAO BATISTA BIANCHI ; Pai: GIUSEPPE BIANCHI ; Mãe: MARIA SOUZA ; Data de nascimento: 12/03/1901",
    tipoDeclarado: "CERTIDAO_NASCIMENTO",
  }),
  "NASCIMENTO",
)
ok(lidoA.extrator === EXTRATOR_A, "leitura A identifica-se como âncora de rótulo")
ok(
  lidoA.campos.some((c) => c.campo === "NOME_REGISTRAL" && c.valorNormalizado.includes("JOAO BATISTA BIANCHI")),
  "A lê o nome pelo rótulo",
  lidoA.campos.map((c) => `${c.campo}=${c.valorNormalizado}`),
)
ok(
  lidoA.campos.some((c) => c.campo === "FILIACAO_PAI" && c.valorNormalizado === "GIUSEPPE BIANCHI"),
  "A lê o pai pelo rótulo",
)
ok(
  lidoA.campos.some((c) => c.campo === "DATA_NASCIMENTO" && c.valorData === "1901-03-12"),
  "A lê a data pelo rótulo",
)

const lidoB = extrairEstrutural(leitura({ texto: textoCertidao, tipoDeclarado: "CERTIDAO_NASCIMENTO" }), "NASCIMENTO")
ok(lidoB.extrator === EXTRATOR_B, "leitura B identifica-se como gramática registral")
ok(
  lidoB.campos.some((c) => c.campo === "FILIACAO_PAI" && c.valorNormalizado === "GIUSEPPE BIANCHI"),
  "B lê o pai pela fórmula 'filho de X e de Y'",
  lidoB.campos.map((c) => `${c.campo}=${c.valorNormalizado}`),
)
ok(
  lidoB.campos.some((c) => c.campo === "FILIACAO_MAE" && c.valorNormalizado === "MARIA SOUZA"),
  "B lê a mãe pela mesma fórmula",
)
ok(
  lidoB.campos.some((c) => c.campo === "DATA_NASCIMENTO" && c.valorData === "1901-03-12"),
  "B lê a data pela fórmula 'aos 12 de marco de 1901'",
)
ok(
  lidoB.campos.some((c) => c.campo === "LOCAL_NASCIMENTO" && c.valorNormalizado.includes("BENTO GONCALVES")),
  "B lê o local pela fórmula 'nasceu em'",
)

// INDEPENDÊNCIA: texto SÓ com rótulos → B não lê filiação; texto SÓ com prosa → A não lê.
const soRotulos = leitura({ texto: "Pai: GIUSEPPE BIANCHI ; Mãe: MARIA SOUZA" })
const soProsa = leitura({ texto: "filho de GIUSEPPE BIANCHI e de MARIA SOUZA nasceu em VERONA" })
ok(
  extrairAncorado(soRotulos, "NASCIMENTO").campos.some((c) => c.campo === "FILIACAO_PAI"),
  "A lê filiação de texto com rótulo",
)
ok(
  !extrairEstrutural(soRotulos, "NASCIMENTO").campos.some((c) => c.campo === "FILIACAO_PAI"),
  "B NÃO lê filiação de texto sem fórmula → as leituras são independentes",
)
ok(
  extrairEstrutural(soProsa, "NASCIMENTO").campos.some((c) => c.campo === "FILIACAO_PAI"),
  "B lê filiação de prosa registral",
)
ok(
  !extrairAncorado(soProsa, "NASCIMENTO").campos.some((c) => c.campo === "FILIACAO_PAI"),
  "A NÃO lê filiação de prosa sem rótulo → independência confirmada nos dois sentidos",
)

console.log("\n7) Canal estruturado é lido só pela leitura B")
const comEstruturado = leitura({
  registral: { birth: { fatherName: "GIUSEPPE BIANCHI", birthDate: "1901-03-12" } },
})
ok(
  extrairEstrutural(comEstruturado, "NASCIMENTO").campos.some((c) => c.campo === "FILIACAO_PAI"),
  "B consome Documento.registral",
)
ok(
  extrairAncorado(comEstruturado, "NASCIMENTO").campos.length === 0,
  "A ignora o canal estruturado (independência de fonte)",
)

// ============================================================
console.log("\n8) CONFERÊNCIA — concordância, equivalência e BLOQUEIO")

const l = leitura({
  texto: "Nome: JOAO BATISTA BIANCHI ; Pai: GIUSEPPE BIANCHI ; Mãe: MARIA SOUZA ; Data de nascimento: 12/03/1901",
  tipoDeclarado: "CERTIDAO_NASCIMENTO",
})
const lProsa = leitura({ texto: textoCertidao, tipoDeclarado: "CERTIDAO_NASCIMENTO" })
const conf = conferir(extrairAncorado(l, "NASCIMENTO"), extrairEstrutural(lProsa, "NASCIMENTO"), "NASCIMENTO")

const pai = conf.campos.find((c) => c.campo === "FILIACAO_PAI")
ok(pai?.veredicto === "CONCORDANTE", "duas leituras iguais → CONCORDANTE", pai?.veredicto)
ok((pai?.confianca ?? 0) > 0.9, "concordância eleva a confiança", pai?.confianca)

const data = conf.campos.find((c) => c.campo === "DATA_NASCIMENTO")
ok(data?.veredicto === "CONCORDANTE" && data?.valorData === "1901-03-12", "data conferida nas duas leituras")

// grafia diferente, mesma pessoa → equivalente, não divergente
const equivGrafia = saoEquivalentes("FILIACAO_PAI", "GIUSEPPE BIANCHI", "GIUSEPE BIANQUI")
ok(equivGrafia.equivalente === true, "Bianchi/Bianqui são equivalentes (fonética)", equivGrafia)
const divReal = saoEquivalentes("FILIACAO_PAI", "GIUSEPPE BIANCHI", "ANTONIO FERRARI")
ok(divReal.equivalente === false, "nomes distintos NÃO são equivalentes")
ok(!saoEquivalentes("DATA_NASCIMENTO", "1901-03-12", "1901-03-13").equivalente, "datas diferentes nunca equivalem")

// DIVERGÊNCIA EM CAMPO CRÍTICO → bloqueio, sem escolha silenciosa
const aDiv = extrairAncorado(leitura({ texto: "Pai: ANTONIO FERRARI" }), "NASCIMENTO")
const bDiv = extrairEstrutural(
  leitura({ texto: "filho de GIUSEPPE BIANCHI e de MARIA SOUZA nasceu em VERONA" }),
  "NASCIMENTO",
)
const confDiv = conferir(aDiv, bDiv, "NASCIMENTO")
const paiDiv = confDiv.campos.find((c) => c.campo === "FILIACAO_PAI")
ok(paiDiv?.veredicto === "DIVERGENTE", "leituras discordantes → DIVERGENTE", paiDiv?.veredicto)
ok(paiDiv?.valorNormalizado === null, "campo divergente NÃO recebe valor consolidado")
ok(paiDiv?.bloqueadoParaRevisao === true, "campo crítico divergente é BLOQUEADO para revisão")
ok(paiDiv?.confianca === 0, "confiança de campo divergente é zero (não 'a maior das duas')")
ok(ehCampoCritico("FILIACAO_PAI"), "FILIACAO_PAI é campo crítico")
ok(confDiv.bloqueados.length > 0, "a conferência devolve a lista de bloqueados")

// campo lido por uma só leitura → COMPLEMENTAR com confiança reduzida
const soUma = conferir(
  extrairAncorado(leitura({ texto: "Profissão: LAVRADOR" }), "NASCIMENTO"),
  extrairEstrutural(leitura({ texto: "" }), "NASCIMENTO"),
  "NASCIMENTO",
)
const prof = soUma.campos.find((c) => c.campo === "PROFISSAO")
ok(prof?.veredicto === "COMPLEMENTAR", "uma leitura só → COMPLEMENTAR (não é divergência)")
ok((prof?.confianca ?? 1) < 0.9, "confiança reduzida por falta de conferência", prof?.confianca)

console.log("\n9) Ocorrências — pessoa ≠ ocorrência documental")
ok(conf.ocorrencias.length >= 3, "registrado + pai + mãe geram 3 ocorrências", conf.ocorrencias.length)
const ocPai = conf.ocorrencias.find((o) => o.papel === "PAI")
ok(ocPai?.nomeNormalizado === "GIUSEPPE BIANCHI", "ocorrência do pai carrega o nome dele")
ok(ocPai?.sexoInferido === "M", "sexo da ocorrência vem do papel")
const ocReg = conf.ocorrencias.find((o) => o.papel === "REGISTRADO")
ok(ocReg?.atributos.nomePai === "GIUSEPPE BIANCHI", "a ocorrência do registrado cita o pai (cruzamento)")
ok(ocReg?.atributos.dataNascimento === "1901-03-12", "e a data de nascimento")
ok(
  confDiv.ocorrencias.every((o) => o.papel !== "PAI"),
  "campo bloqueado NÃO gera ocorrência (leitura contestada não vira menção de pessoa)",
)

console.log("\n10) Documento insuficiente")
const vazio = conferir(
  extrairAncorado(leitura({ texto: "" }), "NASCIMENTO"),
  extrairEstrutural(leitura({ texto: "" }), "NASCIMENTO"),
  "NASCIMENTO",
)
ok(vazio.insuficiente === true, "sem nada lido → insuficiente")
ok(!!vazio.motivoInsuficiencia, "com motivo declarado")

const semNome = conferir(
  extrairAncorado(leitura({ texto: "Profissão: LAVRADOR" }), "NASCIMENTO"),
  extrairEstrutural(leitura({ texto: "" }), "NASCIMENTO"),
  "NASCIMENTO",
)
ok(semNome.insuficiente === true, "sem nome do registrado → insuficiente")

console.log("\n11) Determinismo — mesma entrada, mesma saída")
const r1 = conferir(extrairAncorado(l, "NASCIMENTO"), extrairEstrutural(lProsa, "NASCIMENTO"), "NASCIMENTO")
const r2 = conferir(extrairAncorado(l, "NASCIMENTO"), extrairEstrutural(lProsa, "NASCIMENTO"), "NASCIMENTO")
ok(JSON.stringify(r1.campos) === JSON.stringify(r2.campos), "conferência é determinística")
ok(
  JSON.stringify(r1.ocorrencias) === JSON.stringify(r2.ocorrencias),
  "ordem das ocorrências é estável (idempotência da chave depende disso)",
)

// ============================================================
console.log(`\n${"=".repeat(60)}`)
console.log(`MRG leitura: ${passed} passou, ${failed} falhou`)
if (failed) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
