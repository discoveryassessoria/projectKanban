// scripts/gentilico-pais.test.ts
//
// NACIONALIDADE (GENTÍLICO) A PARTIR DO PAÍS (ETAPA 1 — cadastro inteligente).
// Teste PURO: tabela estática + regra "não sobrescrever o que o usuário tocou".
// Convenção do sistema: forma feminina, inicial maiúscula ("Brasileira").

import countries from "i18n-iso-countries"
import ptLocale from "i18n-iso-countries/langs/pt.json" with { type: "json" }
import {
  gentilicoDoPais, gentilicoPorCodigo, proximaNacionalidade, nacionalidadeJaTocada, nacionalidadeDigitadaToca,
  codigosComGentilicoProprio, ISO_SEM_GENTILICO, normalizarNomePais,
} from "@/src/lib/genealogia/gentilico"
import { AMBIENTE_PAISES } from "@/src/lib/ambiente/paises"

countries.registerLocale(ptLocale)

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }

console.log("\n1) mapa país → gentílico (feminino, inicial maiúscula)")
const ESPERADO: Array<[string, string]> = [
  ["Brasil", "Brasileira"], ["Espanha", "Espanhola"], ["Itália", "Italiana"], ["Portugal", "Portuguesa"],
  ["Alemanha", "Alemã"], ["França", "Francesa"], ["Polônia", "Polonesa"], ["Áustria", "Austríaca"],
  ["Argentina", "Argentina"], ["Estados Unidos", "Estadunidense"], ["Japão", "Japonesa"], ["Líbano", "Libanesa"],
  ["Reino Unido", "Britânica"], ["Suíça", "Suíça"], ["Uruguai", "Uruguaia"], ["Paraguai", "Paraguaia"],
  ["Rússia", "Russa"], ["Ucrânia", "Ucraniana"], ["Croácia", "Croata"], ["Suécia", "Sueca"],
]
for (const [pais, gent] of ESPERADO) chk(gentilicoDoPais(pais) === gent, `${pais} → ${gent}`)

console.log("\n2) caixa, acento e variantes de grafia")
chk(gentilicoDoPais("brasil") === "Brasileira" && gentilicoDoPais("BRASIL") === "Brasileira", "caixa não importa")
chk(gentilicoDoPais("  Brasil ") === "Brasileira", "espaços nas pontas")
chk(gentilicoDoPais("italia") === "Italiana" && gentilicoDoPais("ITALIA") === "Italiana", "sem acento (Itália)")
chk(gentilicoDoPais("Polónia") === "Polonesa" && gentilicoDoPais("Polônia") === "Polonesa", "pt-PT e pt-BR (Polónia/Polônia)")
chk(gentilicoDoPais("Irã") === "Iraniana" && gentilicoDoPais("Irão") === "Iraniana", "Irã / Irão")
chk(gentilicoDoPais("Vietnã") === "Vietnamita" && gentilicoDoPais("Vietname") === "Vietnamita", "Vietnã / Vietname")
chk(gentilicoDoPais("EUA") === "Estadunidense", "sigla EUA")
chk(gentilicoDoPais("Holanda") === "Holandesa" && gentilicoDoPais("Países Baixos") === "Holandesa", "Holanda / Países Baixos")
chk(gentilicoDoPais("Timor-Leste") === "Timorense" && gentilicoDoPais("Timor Leste") === "Timorense", "hífen opcional")
chk(normalizarNomePais("  São  Tomé-e Príncipe ") === "sao tome e principe", "normalização de nome")

console.log("\n3) desconhecido / vazio → null (o campo segue livre)")
chk(gentilicoDoPais("") === null && gentilicoDoPais(null) === null && gentilicoDoPais(undefined) === null, "vazio")
chk(gentilicoDoPais("Atlântida") === null, "país inexistente")
chk(gentilicoDoPais("Antártida") === null, "território sem população")

console.log("\n4) fonte única: os 7 países do Ambiente vêm de paises.ts")
for (const p of Object.values(AMBIENTE_PAISES)) {
  chk(gentilicoDoPais(p.label) === p.nacionalidade, `${p.label} usa AMBIENTE_PAISES (${p.nacionalidade})`)
  chk(gentilicoPorCodigo(p.iso) === p.nacionalidade, `${p.iso} por código usa AMBIENTE_PAISES`)
  chk(!codigosComGentilicoProprio().includes(p.iso), `${p.iso} NÃO está duplicado na tabela própria`)
}

console.log("\n5) completude contra a base mundial (ISO 3166, mesma fonte do cadastro Pais)")
const todos = Object.keys(countries.getNames("pt", { select: "official" }))
const semGent = todos.filter((iso) => !gentilicoPorCodigo(iso) && !ISO_SEM_GENTILICO.includes(iso))
chk(semGent.length === 0, `todo país habitado da base tem gentílico (faltam: ${semGent.join(", ") || "nenhum"})`)
const proprios = codigosComGentilicoProprio()
chk(new Set(proprios).size === proprios.length, "nenhum ISO repetido na tabela")
chk(proprios.every((iso) => todos.includes(iso)), "todo ISO da tabela existe na base mundial")
chk(ISO_SEM_GENTILICO.every((iso) => todos.includes(iso)), "todo ISO 'sem gentílico' existe na base mundial")
chk(ISO_SEM_GENTILICO.every((iso) => !gentilicoPorCodigo(iso)), "território sem gentílico realmente não tem")
// O nome que a base grava (pt) tem de resolver para o MESMO gentílico que o código.
const nomes = countries.getNames("pt", { select: "official" })
const naoResolvem = todos.filter((iso) => gentilicoPorCodigo(iso) && gentilicoDoPais(nomes[iso]) !== gentilicoPorCodigo(iso))
chk(naoResolvem.length === 0, `o nome gravado na base resolve igual ao código (divergem: ${naoResolvem.map((i) => `${i}=${nomes[i]}`).join("; ") || "nenhum"})`)
chk(Object.values(AMBIENTE_PAISES).every((p) => /^[A-ZÀ-Ý]/.test(p.nacionalidade)), "convenção: inicial maiúscula")
chk(proprios.every((iso) => /^[A-ZÀ-Ý]/.test(gentilicoPorCodigo(iso) ?? "")), "convenção da tabela: inicial maiúscula")

console.log("\n6) NÃO sobrescreve o que o usuário tocou")
chk(proximaNacionalidade({ atual: "", tocado: false, pais: "Brasil" }) === "Brasileira", "campo vazio + país → preenche")
chk(proximaNacionalidade({ atual: "Brasileira", tocado: false, pais: "Espanha" }) === "Espanhola", "não tocado acompanha a troca de país")
chk(proximaNacionalidade({ atual: "Ítalo-brasileira", tocado: true, pais: "Espanha" }) === "Ítalo-brasileira", "TOCADO: troca de país não sobrescreve")
chk(proximaNacionalidade({ atual: "Brasileira", tocado: true, pais: "Brasil" }) === "Brasileira", "tocado e igual ao gentílico: mantém")
chk(proximaNacionalidade({ atual: "Brasileira", tocado: false, pais: "Atlântida" }) === "Brasileira", "país desconhecido nunca apaga o campo")
chk(proximaNacionalidade({ atual: "Brasileira", tocado: false, pais: "" }) === "Brasileira", "país apagado nunca apaga a nacionalidade")
chk(nacionalidadeDigitadaToca("Italiana") === true, "digitar toca o campo")
chk(nacionalidadeDigitadaToca("   ") === false && nacionalidadeDigitadaToca("") === false, "apagar tudo devolve o controle ao país")

console.log("\n7) abrir a EDIÇÃO de pessoa já gravada")
chk(nacionalidadeJaTocada("Brasileira", "Brasil") === false, "gravada = gentílico do país → ainda acompanha o país")
chk(nacionalidadeJaTocada("brasileira", "Brasil") === false, "caixa diferente do gentílico não conta como escolha manual")
chk(nacionalidadeJaTocada("Italiana", "Brasil") === true, "gravada diferente do gentílico → escolha manual, preservada")
chk(nacionalidadeJaTocada("Brasileiro", "Brasil") === true, "variante masculina gravada → preservada")
chk(nacionalidadeJaTocada("", "Brasil") === false && nacionalidadeJaTocada(null, "Brasil") === false, "sem nacionalidade gravada → segue o país")
chk(nacionalidadeJaTocada("Apátrida", "") === true, "país vazio e nacionalidade gravada → preservada")
chk(nacionalidadeJaTocada("Italiana", "Atlântida") === true, "país desconhecido com nacionalidade gravada → preservada")

console.log(`\n${ok} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
