/**
 * MRG — IDENTIDADE, INTEGRIDADE e ELEGIBILIDADE.
 * Rodar: npx tsx scripts/mrg-identidade.test.ts
 *
 * O que este arquivo protege — os erros que não têm volta:
 *  · homônimo NUNCA é vinculado automaticamente;
 *  · filiação/data/local divergentes DERRUBAM a correspondência;
 *  · nome de casada é reconhecido (a mesma pessoa não é duplicada);
 *  · fusão de pessoas é SEMPRE bloqueio, com impedimentos enumerados;
 *  · ciclo, autoancestralidade, idade impossível, casamento após óbito,
 *    vínculo duplicado, geração quebrada e requerente duplicado são detectados;
 *  · linha estruturalmente possível ≠ linha documentalmente comprovada.
 */
import { resolverIdentidade, avaliarFusao, decidirAutomatico } from "../src/lib/genealogia/registral/identidade"
import { verificarIntegridade } from "../src/lib/genealogia/registral/integridade"
import { apurarElegibilidade, compararElegibilidade } from "../src/lib/genealogia/registral/elegibilidade"
import type {
  CampoRegistral,
  OcorrenciaExtraida,
  PessoaConhecida,
} from "../src/lib/genealogia/registral/tipos"
import type { PessoaEntrada, UniaoEntrada } from "../src/lib/genealogia/motor/tipos"

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

function oc(p: Partial<OcorrenciaExtraida> & { nome: string }): OcorrenciaExtraida {
  return {
    papel: p.papel ?? "REGISTRADO",
    nomeBruto: p.nomeBruto ?? p.nome,
    nomeNormalizado: p.nome,
    chaveFonetica: p.chaveFonetica ?? "",
    sexoInferido: p.sexoInferido ?? null,
    atributos: p.atributos ?? {},
    camposIds: [],
  }
}

function pc(p: Partial<PessoaConhecida> & { id: number; nome: string }): PessoaConhecida {
  return { sobrenome: null, ...p }
}

function pe(p: Partial<PessoaEntrada> & { id: number; nome: string }): PessoaEntrada {
  return { ...p }
}

// ============================================================
console.log("\n1) Correspondência confirmada — nome + data + filiação")
const r1 = resolverIdentidade(
  oc({
    nome: "JOAO BATISTA BIANCHI",
    atributos: { dataNascimento: "1901-03-12", localNascimento: "BENTO GONCALVES", nomePai: "GIUSEPPE BIANCHI", nomeMae: "MARIA SOUZA" },
  }),
  [
    pc({
      id: 10,
      nome: "Joao Batista",
      sobrenome: "Bianchi",
      data_nasc: "1901-03-12",
      local_nasc: "Bento Goncalves",
      nomePai: "Giuseppe Bianchi",
      nomeMae: "Maria Souza",
      paiId: 20,
      maeId: 21,
    }),
  ],
)
ok(r1.classeFinal === "CORRESPONDENCIA_CONFIRMADA", "correspondência confirmada", r1.classeFinal)
ok(r1.pessoaAutomatica === 10, "vinculada automaticamente (única e inequívoca)", r1.pessoaAutomatica)
ok(r1.explicacao.includes("automaticamente"), "explicação diz por quê")

console.log("\n2) HOMÔNIMO — dois candidatos fortes NUNCA são vinculados")
const homonimos = [
  pc({ id: 11, nome: "Joao", sobrenome: "Silva", data_nasc: "1901-01-01", nomePai: "Antonio Silva" }),
  pc({ id: 12, nome: "Joao", sobrenome: "Silva", data_nasc: "1901-06-01", nomePai: "Antonio Silva" }),
]
const rHom = resolverIdentidade(
  oc({ nome: "JOAO SILVA", atributos: { dataNascimento: "1901-03-01", nomePai: "ANTONIO SILVA" } }),
  homonimos,
)
const fortesHom = rHom.correspondencias.filter(
  (c) => c.classe === "CORRESPONDENCIA_CONFIRMADA" || c.classe === "ALTAMENTE_PROVAVEL",
)
ok(fortesHom.length >= 2, "os dois homônimos são candidatos fortes", fortesHom.length)
ok(rHom.pessoaAutomatica === null, "NENHUM é vinculado automaticamente", rHom.pessoaAutomatica)
ok(rHom.explicacao.toLowerCase().includes("homônimo") || rHom.explicacao.includes("candidatos fortes"), "a explicação nomeia o homônimo", rHom.explicacao)

console.log("\n3) Filiação divergente derruba a correspondência")
const rFil = resolverIdentidade(
  oc({ nome: "JOAO BIANCHI", atributos: { nomePai: "GIUSEPPE BIANCHI", nomeMae: "MARIA SOUZA" } }),
  [pc({ id: 13, nome: "Joao", sobrenome: "Bianchi", nomePai: "Antonio Ferrari", nomeMae: "Rosa Lima" })],
)
ok(
  rFil.correspondencias[0]?.classe === "REGISTROS_CONFLITANTES" || rFil.correspondencias[0]?.classe === "PESSOAS_DISTINTAS",
  "filiação divergente → conflitante/distintas",
  rFil.correspondencias[0]?.classe,
)
ok(rFil.pessoaAutomatica === null, "nada é vinculado")

console.log("\n4) Data de nascimento incompatível derruba")
const rData = resolverIdentidade(
  oc({ nome: "MARIA SOUZA", atributos: { dataNascimento: "1880-01-01" } }),
  [pc({ id: 14, nome: "Maria", sobrenome: "Souza", data_nasc: "1920-01-01" })],
)
ok(rData.pessoaAutomatica === null, "20+ anos de diferença não vincula")
ok(
  rData.correspondencias.every((c) => c.classe !== "CORRESPONDENCIA_CONFIRMADA"),
  "e não é classificada como confirmada",
)

console.log("\n5) Sexo incompatível com o papel elimina o candidato")
const rSexo = resolverIdentidade(
  oc({ nome: "MARIA SOUZA", papel: "PAI", sexoInferido: "M" }),
  [pc({ id: 15, nome: "Maria", sobrenome: "Souza", sexo: "F" })],
)
ok(rSexo.correspondencias[0]?.classe === "PESSOAS_DISTINTAS", "sexo incompatível → pessoas distintas", rSexo.correspondencias[0]?.classe)

console.log("\n6) NOME DE CASADA — a mesma pessoa não é duplicada")
const rCasada = resolverIdentidade(
  oc({
    nome: "MARIA SOUZA BIANCHI",
    papel: "CONJUGE",
    atributos: { nomeConjuge: "GIUSEPPE BIANCHI", dataNascimento: "1905-05-05" },
  }),
  [pc({ id: 16, nome: "Maria", sobrenome: "Souza", data_nasc: "1905-05-05", sexo: "F" })],
)
ok(rCasada.correspondencias.length > 0, "a pessoa de solteira é encontrada", rCasada.correspondencias.length)
ok(
  rCasada.correspondencias[0]?.evidencias.some((e) => e.campo === "nome_casado"),
  "a evidência declara que é variação de casamento",
  rCasada.correspondencias[0]?.evidencias.map((e) => e.campo),
)

console.log("\n7) ALIAS oficial (NomePessoa) faz a busca achar")
const rAlias = resolverIdentidade(
  oc({ nome: "MARIA BIANQUI", atributos: {} }),
  [
    pc({
      id: 17,
      nome: "Maria",
      sobrenome: "Souza",
      aliases: [{ nome: "Maria", sobrenome: "Bianchi", tipo: "CASADA" }],
    }),
  ],
)
ok(
  rAlias.correspondencias[0]?.evidencias.some((e) => e.descricao.includes("forma alternativa")),
  "o alias registrado sustenta a correspondência",
  rAlias.correspondencias[0]?.evidencias.map((e) => e.descricao),
)

console.log("\n8) Nenhum candidato → proposta de pessoa nova, nunca criação silenciosa")
const rNovo = resolverIdentidade(oc({ nome: "PESSOA INEXISTENTE XPTO" }), [pc({ id: 18, nome: "Outro", sobrenome: "Nome" })])
ok(rNovo.pessoaAutomatica === null, "nada é criado automaticamente")
ok(rNovo.explicacao.includes("nova pessoa") || rNovo.explicacao.includes("não corresponde"), "a explicação aponta pessoa nova", rNovo.explicacao)

console.log("\n9) decidirAutomatico é conservador em todos os cenários")
ok(decidirAutomatico(oc({ nome: "X" }), []).pessoaId === null, "sem candidato → null")
ok(
  decidirAutomatico(oc({ nome: "X" }), [
    { pessoaId: 1, classe: "ALTAMENTE_PROVAVEL", score: 0.9, evidencias: [], motivoBloqueio: null },
  ]).pessoaId === null,
  "altamente provável sozinho ainda NÃO vincula (falta filiação confirmada)",
)
ok(
  decidirAutomatico(oc({ nome: "X" }), [
    { pessoaId: 1, classe: "CORRESPONDENCIA_CONFIRMADA", score: 0.98, evidencias: [], motivoBloqueio: null },
    { pessoaId: 2, classe: "REGISTROS_CONFLITANTES", score: 0.7, evidencias: [], motivoBloqueio: "x" },
  ]).pessoaId === null,
  "confirmada + conflitante → bloqueia (não escolhe a confirmada)",
)

console.log("\n10) FUSÃO — sempre bloqueio, com impedimentos enumerados")
const fusaoHomonimo = avaliarFusao({
  a: pc({ id: 1, nome: "Joao", sobrenome: "Silva" }),
  b: pc({ id: 2, nome: "Joao", sobrenome: "Silva" }),
  score: 0.99,
  requerentesAfetados: 0,
  processosAfetados: 1,
  afetaLinhaCidadania: false,
})
ok(fusaoHomonimo.podeAutomatico === false, "fusão nunca é automática")
ok(
  fusaoHomonimo.impedimentos.some((i) => i.toLowerCase().includes("homônimo")),
  "homônimo sem data é impedimento",
  fusaoHomonimo.impedimentos,
)
const fusaoCpf = avaliarFusao({
  a: pc({ id: 1, nome: "Joao", cpf: "11111111111" }),
  b: pc({ id: 2, nome: "Joao", cpf: "22222222222" }),
  score: 0.99,
  requerentesAfetados: 0,
  processosAfetados: 1,
  afetaLinhaCidadania: false,
})
ok(fusaoCpf.impedimentos.some((i) => i.includes("CPF")), "CPFs diferentes impedem", fusaoCpf.impedimentos)
const fusaoLinha = avaliarFusao({
  a: pc({ id: 1, nome: "Joao", data_nasc: "1900-01-01" }),
  b: pc({ id: 2, nome: "Joao", data_nasc: "1900-01-01" }),
  score: 0.99,
  requerentesAfetados: 2,
  processosAfetados: 3,
  afetaLinhaCidadania: true,
})
ok(fusaoLinha.impedimentos.length >= 3, "requerentes + processos + linha somam impedimentos", fusaoLinha.impedimentos)

// ============================================================
console.log("\n11) INTEGRIDADE — ciclo e autoancestralidade")
const comCiclo = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "A", paiId: 2 }), pe({ id: 2, nome: "B", paiId: 1 })],
  unioes: [],
  requerenteIds: [1],
})
ok(comCiclo.some((i) => i.codigo === "CICLO_GENEALOGICO"), "ciclo detectado", comCiclo.map((i) => i.codigo))
ok(
  comCiclo.find((i) => i.codigo === "CICLO_GENEALOGICO")?.severidade === "CRITICO",
  "ciclo é crítico",
)

const autoAnc = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "A", paiId: 1 })],
  unioes: [],
  requerenteIds: [1],
})
ok(autoAnc.some((i) => i.codigo === "PESSOA_ANCESTRAL_DE_SI"), "pessoa ancestral de si mesma", autoAnc.map((i) => i.codigo))

console.log("\n12) INTEGRIDADE — filiação contraditória e sexo incompatível")
const mesmoPaiMae = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "Filho", paiId: 2, maeId: 2 }), pe({ id: 2, nome: "Ambos" })],
  unioes: [],
  requerenteIds: [1],
})
ok(mesmoPaiMae.some((i) => i.codigo === "FILIACAO_CONTRADITORIA"), "pai = mãe é contraditório")

const sexoErrado = verificarIntegridade({
  pessoas: [
    pe({ id: 1, nome: "Filho", paiId: 2 }),
    pe({ id: 2, nome: "Maria", sexo: "F" }),
  ],
  unioes: [],
  requerenteIds: [1],
})
ok(sexoErrado.some((i) => i.codigo === "FILIACAO_SEXO_INCOMPATIVEL"), "mulher no campo pai é denunciado")

console.log("\n13) INTEGRIDADE — idades biologicamente impossíveis")
const filhoAntes = verificarIntegridade({
  pessoas: [
    pe({ id: 1, nome: "Filho", data_nasc: "1900-01-01", paiId: 2 }),
    pe({ id: 2, nome: "Pai", data_nasc: "1920-01-01" }),
  ],
  unioes: [],
  requerenteIds: [1],
})
ok(filhoAntes.some((i) => i.codigo === "FILHO_NASCIDO_ANTES_DO_GENITOR"), "filho antes do pai", filhoAntes.map((i) => i.codigo))

const maeNova = verificarIntegridade({
  pessoas: [
    pe({ id: 1, nome: "Filho", data_nasc: "1910-01-01", maeId: 2 }),
    pe({ id: 2, nome: "Mae", data_nasc: "1905-01-01", sexo: "F" }),
  ],
  unioes: [],
  requerenteIds: [1],
})
ok(maeNova.some((i) => i.codigo === "GENITOR_IDADE_IMPOSSIVEL"), "mãe com 5 anos é impossível")

const maeVelha = verificarIntegridade({
  pessoas: [
    pe({ id: 1, nome: "Filho", data_nasc: "1960-01-01", maeId: 2 }),
    pe({ id: 2, nome: "Mae", data_nasc: "1890-01-01", sexo: "F" }),
  ],
  unioes: [],
  requerenteIds: [1],
})
ok(maeVelha.some((i) => i.codigo === "GENITOR_IDADE_IMPROVAVEL"), "mãe com 70 anos é improvável (geração faltando)")

console.log("\n14) INTEGRIDADE — datas impossíveis e longevidade")
const obitoAntes = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "X", data_nasc: "1920-01-01", data_obito: "1910-01-01" })],
  unioes: [],
  requerenteIds: [1],
})
ok(obitoAntes.some((i) => i.codigo === "OBITO_ANTES_DO_NASCIMENTO"), "óbito antes do nascimento")

const velho = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "X", data_nasc: "1800-01-01", data_obito: "1960-01-01" })],
  unioes: [],
  requerenteIds: [1],
})
ok(velho.some((i) => i.codigo === "LONGEVIDADE_IMPLAUSIVEL"), "160 anos de vida é implausível")

console.log("\n15) INTEGRIDADE — casamento após óbito, vínculo duplicado, cônjuges incompatíveis")
const casouMorto = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "A", data_obito: "1930-01-01" }), pe({ id: 2, nome: "B" })],
  unioes: [{ id: 1, pessoa1Id: 1, pessoa2Id: 2, data_inicio: "1940-01-01" }],
  requerenteIds: [1],
})
ok(casouMorto.some((i) => i.codigo === "CASAMENTO_APOS_OBITO"), "casamento após óbito")

const duploVinculo = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "A" }), pe({ id: 2, nome: "B" })],
  unioes: [
    { id: 1, pessoa1Id: 1, pessoa2Id: 2 },
    { id: 2, pessoa1Id: 2, pessoa2Id: 1 },
  ],
  requerenteIds: [1],
})
ok(duploVinculo.some((i) => i.codigo === "VINCULO_DUPLICADO"), "duas uniões para o mesmo par")

const uniaoComAvo = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "Neto", paiId: 2 }), pe({ id: 2, nome: "Pai", paiId: 3 }), pe({ id: 3, nome: "Avo" })],
  unioes: [{ id: 1, pessoa1Id: 1, pessoa2Id: 3 }],
  requerenteIds: [1],
})
ok(uniaoComAvo.some((i) => i.codigo === "CONJUGES_INCOMPATIVEIS"), "união entre ascendente e descendente")

console.log("\n16) INTEGRIDADE — geração quebrada, ascendente repetido, requerente duplicado")
const geracao = verificarIntegridade({
  pessoas: [
    pe({ id: 1, nome: "Filho", data_nasc: "1960-01-01", paiId: 2, requerente: "sim" }),
    pe({ id: 2, nome: "Pai", data_nasc: "1890-01-01" }),
  ],
  unioes: [],
  requerenteIds: [1],
})
ok(geracao.some((i) => i.codigo === "GERACAO_QUEBRADA"), "salto de 70 anos entre gerações", geracao.map((i) => i.codigo))

const repetido = verificarIntegridade({
  pessoas: [
    pe({ id: 1, nome: "Req", paiId: 2, maeId: 3 }),
    pe({ id: 2, nome: "Pai", paiId: 4 }),
    pe({ id: 3, nome: "Mae", paiId: 4 }),
    pe({ id: 4, nome: "Comum" }),
  ],
  unioes: [],
  requerenteIds: [1],
})
ok(repetido.some((i) => i.codigo === "ASCENDENTE_REPETIDO"), "mesmo ascendente em dois ramos")

const reqDup = verificarIntegridade({
  pessoas: [
    pe({ id: 1, nome: "Joao", sobrenome: "Silva", data_nasc: "1990-01-01", requerente: "sim" }),
    pe({ id: 2, nome: "Joao", sobrenome: "Silva", data_nasc: "1990-01-01", requerente: "sim" }),
  ],
  unioes: [],
  requerenteIds: [1, 2],
})
ok(reqDup.some((i) => i.codigo === "REQUERENTE_DUPLICADO"), "dois requerentes iguais")

console.log("\n17) INTEGRIDADE — divergência árvore × certidão")
const divergencia = verificarIntegridade({
  pessoas: [pe({ id: 1, nome: "Joao", sobrenome: "Silva", data_nasc: "1901-03-12" })],
  unioes: [],
  requerenteIds: [1],
  fatos: [
    {
      pessoaId: 1,
      uniaoId: null,
      campo: "DATA_NASCIMENTO",
      valorNormalizado: "1902-05-20",
      valorData: "1902-05-20",
      estado: "CONFIRMADO",
      documentoIds: [77],
    },
  ],
})
const div = divergencia.find((i) => i.codigo === "DIVERGENCIA_ARVORE_CERTIDAO")
ok(!!div, "documento contradiz o cadastro", divergencia.map((i) => i.codigo))
ok(div?.evidencias.some((e) => e.includes("documentoId=77")) === true, "a evidência cita o documento")

console.log("\n18) INTEGRIDADE — determinismo e sem falso positivo em árvore sadia")
const sadia = {
  pessoas: [
    pe({ id: 1, nome: "Filho", data_nasc: "1960-01-01", paiId: 2, maeId: 3, requerente: "sim" }),
    pe({ id: 2, nome: "Pai", sexo: "M", data_nasc: "1930-01-01" }),
    pe({ id: 3, nome: "Mae", sexo: "F", data_nasc: "1932-01-01" }),
  ],
  unioes: [{ id: 1, pessoa1Id: 2, pessoa2Id: 3, data_inicio: "1955-01-01" }] as UniaoEntrada[],
  requerenteIds: [1],
}
const s1 = verificarIntegridade(sadia)
const s2 = verificarIntegridade(sadia)
ok(JSON.stringify(s1) === JSON.stringify(s2), "integridade é determinística")
ok(
  !s1.some((i) => i.severidade === "CRITICO"),
  "árvore consistente não produz achado crítico",
  s1.filter((i) => i.severidade === "CRITICO").map((i) => i.codigo),
)

// ============================================================
console.log("\n19) ELEGIBILIDADE — linha comprovada × linha com pendência")
const comprovados = new Map<number, Set<CampoRegistral>>([
  [1, new Set<CampoRegistral>(["DATA_NASCIMENTO", "FILIACAO_PAI", "FILIACAO_MAE"])],
  [2, new Set<CampoRegistral>(["DATA_NASCIMENTO", "FILIACAO_PAI", "FILIACAO_MAE"])],
  [3, new Set<CampoRegistral>(["DATA_NASCIMENTO"])],
])
const arvore = {
  pessoas: [
    pe({ id: 1, nome: "Requerente", data_nasc: "1990-01-01", paiId: 2, requerente: "sim" }),
    pe({ id: 2, nome: "Pai", data_nasc: "1960-01-01", paiId: 3, sexo: "M" }),
    pe({ id: 3, nome: "Nonno", data_nasc: "1930-01-01", pais_nasc: "Italia", sexo: "M" }),
  ],
  unioes: [] as UniaoEntrada[],
  paisAlvo: "ITALIA" as const,
  requerenteId: 1,
  raizId: 1,
}

const elegOk = apurarElegibilidade({ ...arvore, comprovacaoPorPessoa: comprovados })
ok(elegOk.ascendenteTransmissorId === 3, "dante causa italiano identificado", elegOk.ascendenteTransmissorId)
ok(elegOk.resultado === "LINHA_COMPLETA_COMPROVADA", "linha comprovada", elegOk.resultado)
ok(elegOk.comprovadoDocumentalmente === true, "e o motor declara comprovado")
ok(elegOk.caminhoPrincipal?.ids.join(">") === "1>2>3", "caminho requerente → dante causa", elegOk.caminhoPrincipal?.ids)

const semProva = new Map<number, Set<CampoRegistral>>([[1, new Set<CampoRegistral>(["DATA_NASCIMENTO"])]])
const elegPend = apurarElegibilidade({ ...arvore, comprovacaoPorPessoa: semProva })
ok(elegPend.resultado === "LINHA_COMPLETA_COM_PENDENCIAS", "sem evidência → pendências", elegPend.resultado)
ok(elegPend.comprovadoDocumentalmente === false, "NÃO declara comprovado sem evidência")
ok(elegPend.pendencias.length > 0, "e lista as pendências", elegPend.pendencias.length)
ok(
  elegPend.explicacao.includes("Estruturalmente possível") || elegPend.explicacao.includes("documentalmente não comprovada"),
  "a explicação separa estrutura de comprovação",
  elegPend.explicacao,
)

console.log("\n20) ELEGIBILIDADE — ascendente estrangeiro não identificado")
const semItaliano = apurarElegibilidade({
  pessoas: [pe({ id: 1, nome: "Req", requerente: "sim", paiId: 2 }), pe({ id: 2, nome: "Pai", pais_nasc: "Brasil" })],
  unioes: [],
  paisAlvo: "ITALIA",
  requerenteId: 1,
  raizId: 1,
  comprovacaoPorPessoa: new Map(),
})
ok(
  semItaliano.resultado === "ASCENDENTE_ELEGIVEL_NAO_IDENTIFICADO" || semItaliano.resultado === "LINHA_COMPLETA_COM_PENDENCIAS",
  "sem ascendente do país-alvo o motor não afirma direito",
  semItaliano.resultado,
)
ok(semItaliano.comprovadoDocumentalmente === false, "e nunca declara comprovado")

console.log("\n21) ELEGIBILIDADE — linha conflitante e sem requerente")
const conflitante = apurarElegibilidade({
  ...arvore,
  comprovacaoPorPessoa: comprovados,
  inconsistencias: [
    {
      codigo: "CICLO_GENEALOGICO",
      severidade: "CRITICO",
      pessoaIds: [2],
      descricao: "ciclo",
      explicacao: "x",
      acaoSugerida: "y",
      evidencias: [],
    },
  ],
})
ok(conflitante.resultado === "LINHA_CONFLITANTE", "conflito crítico na linha → LINHA_CONFLITANTE", conflitante.resultado)
ok(conflitante.comprovadoDocumentalmente === false, "linha conflitante nunca é comprovada")

const semReq = apurarElegibilidade({
  pessoas: [],
  unioes: [],
  paisAlvo: "ITALIA",
  requerenteId: null,
  raizId: null,
  comprovacaoPorPessoa: new Map(),
})
ok(semReq.resultado === "REVISAO_OBRIGATORIA", "sem requerente → revisão obrigatória", semReq.resultado)

console.log("\n22) ELEGIBILIDADE — comparação antes × depois (base da análise de impacto)")
const delta = compararElegibilidade(elegOk, elegPend)
ok(delta.perdeuComprovacao === true, "detecta perda de comprovação")
ok(delta.mudouResultado === true, "detecta mudança de resultado")
ok(delta.descricao.includes("DEIXOU de estar comprovada"), "descreve a perda em linguagem clara", delta.descricao)

const semMudanca = compararElegibilidade(elegOk, elegOk)
ok(semMudanca.mudouResultado === false && semMudanca.perdeuComprovacao === false, "estados iguais → nenhuma mudança")
ok(semMudanca.descricao.includes("nenhuma mudança"), "e a descrição diz isso")

const trocouTransmissor = compararElegibilidade(elegOk, { ...elegOk, ascendenteTransmissorId: 99 })
ok(trocouTransmissor.mudouTransmissor === true, "detecta troca de ascendente transmissor")

console.log("\n23) ELEGIBILIDADE — caminhos alternativos são apurados")
const doisCaminhos = apurarElegibilidade({
  pessoas: [
    pe({ id: 1, nome: "Req", requerente: "sim", paiId: 2, maeId: 3 }),
    pe({ id: 2, nome: "Pai", pais_nasc: "Italia", sexo: "M" }),
    pe({ id: 3, nome: "Mae", pais_nasc: "Italia", sexo: "F" }),
  ],
  unioes: [],
  paisAlvo: "ITALIA",
  requerenteId: 1,
  raizId: 1,
  comprovacaoPorPessoa: new Map(),
})
ok(
  doisCaminhos.caminhosAlternativos.length >= 1,
  "duas linhas possíveis → uma principal + alternativa",
  { principal: doisCaminhos.caminhoPrincipal?.ids, alt: doisCaminhos.caminhosAlternativos.map((c) => c.ids) },
)

// ============================================================
console.log(`\n${"=".repeat(60)}`)
console.log(`MRG identidade/integridade/elegibilidade: ${passed} passou, ${failed} falhou`)
if (failed) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
