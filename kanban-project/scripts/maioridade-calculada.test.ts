// scripts/maioridade-calculada.test.ts
//
// MAIOR/MENOR DE IDADE É CALCULADO (ETAPA 1 — cadastro inteligente da pessoa).
// Teste PURO (sem banco): a função única `classificarMaioridade` e seus derivados.
//   data válida  → CALCULADA (>= 18 anos na referência = maior)
//   sem data     → marcador declarado, ou A_CLASSIFICAR (nunca "menor")
//   data futura  → não é nascimento: cai em "sem data"
// Limites: 17 anos e 364 dias, 18 anos exatos, ano bissexto.

import {
  classificarMaioridade, maioridadeEhManual, marcadorRequerenteParaGravar, dataLimiteMaioridade,
  dataDaMaioridade, avisoDeMaioridade, maioridadeEfetiva, ROTULO_MAIORIDADE,
} from "@/src/lib/documentos/maioridade"

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }

const REF = new Date("2026-08-06T12:00:00Z")

console.log("\n1) limites da idade")
chk(classificarMaioridade("2008-08-07", "nao", REF).estado === "MENOR", "17 anos e 364 dias = MENOR")
chk(classificarMaioridade("2008-08-07", "nao", REF).idade === 17, "17 anos e 364 dias: idade 17")
chk(classificarMaioridade("2008-08-06", "nao", REF).estado === "MAIOR", "18 anos exatos hoje = MAIOR")
chk(classificarMaioridade("2008-08-06", "nao", REF).idade === 18, "18 anos exatos: idade 18")
chk(classificarMaioridade("2008-08-05", "nao", REF).estado === "MAIOR", "18 anos e 1 dia = MAIOR")
chk(classificarMaioridade("1950-01-01", "nao", REF).estado === "MAIOR", "adulto antigo = MAIOR")
chk(classificarMaioridade("2008-02-29", "nao", new Date("2026-02-28T12:00:00Z")).estado === "MENOR", "nascido em 29/02: em 28/02 de ano não bissexto ainda é MENOR")
chk(classificarMaioridade("2008-02-29", "nao", new Date("2026-03-01T12:00:00Z")).estado === "MAIOR", "nascido em 29/02: em 01/03 de ano não bissexto já é MAIOR")
chk(classificarMaioridade(new Date("2008-08-06T00:00:00Z"), "nao", REF).origem === "CALCULADA", "aceita Date além de string")

console.log("\n2) origem do valor")
const calculada = classificarMaioridade("2015-01-01", "maior", REF)
chk(calculada.estado === "MENOR" && calculada.origem === "CALCULADA", "a DATA manda sobre o marcador gravado (marcador 'maior' + data de 11 anos = MENOR)")
chk(classificarMaioridade("1980-01-01", "menor", REF).estado === "MAIOR", "marcador 'menor' obsoleto não vence a data de adulto")
const declarada = classificarMaioridade(null, "maior", REF)
chk(declarada.estado === "MAIOR" && declarada.origem === "DECLARADA" && declarada.idade === null, "sem data, o marcador 'maior' vale (DECLARADA)")
chk(classificarMaioridade(null, "menor", REF).estado === "MENOR", "sem data, o marcador 'menor' vale")

console.log("\n3) sem data / data inválida / data futura = A CLASSIFICAR")
for (const [rotulo, nasc] of [["null", null], ["undefined", undefined], ["string vazia", ""], ["texto inválido", "não é data"]] as const) {
  const c = classificarMaioridade(nasc, "sim", REF)
  chk(c.estado === "A_CLASSIFICAR" && c.maior === null && c.origem === "NENHUMA", `${rotulo} + marcador 'sim' = A_CLASSIFICAR (desconhecido, nunca 'menor')`)
}
chk(classificarMaioridade(null, "nao", REF).estado === "A_CLASSIFICAR", "sem data e sem marcador = A_CLASSIFICAR")
chk(classificarMaioridade("2030-01-01", "sim", REF).estado === "A_CLASSIFICAR", "data FUTURA não é nascimento: A_CLASSIFICAR")
chk(classificarMaioridade("2026-12-31", "sim", REF).estado === "A_CLASSIFICAR", "nascimento no futuro do mesmo ano: A_CLASSIFICAR")
chk(classificarMaioridade("2030-01-01", "maior", REF).estado === "MAIOR" && classificarMaioridade("2030-01-01", "maior", REF).origem === "DECLARADA", "data futura + marcador declarado: cai no marcador")

console.log("\n4) seletor manual só existe sem data válida")
chk(maioridadeEhManual(null, REF) === true, "sem data: seletor manual aparece")
chk(maioridadeEhManual("2030-01-01", REF) === true, "data futura: seletor manual aparece")
chk(maioridadeEhManual("2010-05-05", REF) === false, "com data válida: o seletor some")
chk(maioridadeEhManual("1950-05-05", REF) === false, "com data de adulto: o seletor some")

console.log("\n5) marcador gravado acompanha o cálculo")
chk(marcadorRequerenteParaGravar("2015-01-01", "maior", REF) === "menor", "requerente com data de menor grava 'menor'")
chk(marcadorRequerenteParaGravar("1980-01-01", "menor", REF) === "maior", "requerente com data de adulto grava 'maior'")
chk(marcadorRequerenteParaGravar("1980-01-01", "sim", REF) === "maior", "'sim' (a classificar) com data vira 'maior'")
chk(marcadorRequerenteParaGravar(null, "menor", REF) === "menor", "sem data preserva o que foi declarado")
chk(marcadorRequerenteParaGravar(null, "sim", REF) === "sim", "sem data e 'sim' continua 'sim'")
chk(marcadorRequerenteParaGravar("1980-01-01", "nao", REF) === "nao", "quem NÃO é requerente não ganha marcador")
chk(marcadorRequerenteParaGravar("1980-01-01", undefined, REF) === "nao", "marcador ausente = 'nao'")

console.log("\n6) consistência com a política antiga (maioridadeEfetiva)")
for (const [nasc, marc] of [["2015-01-01", "maior"], [null, "menor"], [null, "sim"], ["1980-01-01", "nao"], [null, null]] as const) {
  chk(classificarMaioridade(nasc, marc, REF).maior === maioridadeEfetiva(nasc, marc, REF), `classificarMaioridade e maioridadeEfetiva concordam (${nasc ?? "sem data"}, ${marc ?? "—"})`)
}
chk(ROTULO_MAIORIDADE.A_CLASSIFICAR === "A classificar" && ROTULO_MAIORIDADE.MAIOR === "Maior de idade" && ROTULO_MAIORIDADE.MENOR === "Menor de idade", "rótulos de exibição")

console.log("\n7) filtro de banco usa o mesmo corte")
const corte = dataLimiteMaioridade(REF)
chk(new Date("2008-08-06T00:00:00Z") <= corte, "nascido há 18 anos exatos fica do lado dos maiores")
chk(new Date("2008-08-07T00:00:00Z") > corte, "nascido há 17a364d fica do lado dos menores")

console.log("\n8) aviso: completou / completará durante o processo")
const ABERTURA = new Date("2026-03-01T00:00:00Z")
chk(dataDaMaioridade("2008-08-01")?.toISOString().startsWith("2026-08-01") === true, "dia da maioridade = nascimento + 18 anos")
chk(dataDaMaioridade(null) === null && dataDaMaioridade("lixo") === null, "sem data válida não há dia de maioridade")
const completou = avisoDeMaioridade("2008-06-10", ABERTURA, REF)
chk(completou?.tipo === "COMPLETOU", "menor na abertura que fez 18 depois = COMPLETOU")
chk(completou?.quando.toISOString().startsWith("2026-06-10") === true, "o aviso traz o dia exato do aniversário")
chk(avisoDeMaioridade("2008-02-10", ABERTURA, REF) === null, "já era adulto quando o processo abriu: sem aviso")
chk(avisoDeMaioridade("2005-01-01", ABERTURA, REF) === null, "adulto de longa data: sem aviso")
chk(avisoDeMaioridade("2010-01-01", ABERTURA, REF) === null, "menor que só completa daqui a anos: sem aviso")
chk(avisoDeMaioridade("2008-09-15", ABERTURA, REF)?.tipo === "COMPLETARA", "completa 18 anos dentro de 60 dias = COMPLETARA")
chk(avisoDeMaioridade("2008-11-15", ABERTURA, REF) === null, "completa só depois da janela de 60 dias: sem aviso")
chk(avisoDeMaioridade("2008-11-15", ABERTURA, REF, 120)?.tipo === "COMPLETARA", "janela configurável")
chk(avisoDeMaioridade("2030-06-10", ABERTURA, REF) === null, "data de nascimento futura: sem aviso")
chk(avisoDeMaioridade(null, ABERTURA, REF) === null, "sem data de nascimento: sem aviso")

console.log(`\n${ok} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
