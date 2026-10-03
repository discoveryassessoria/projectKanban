// scripts/telefone-ddi.test.ts
// ============================================================================
// TELEFONE COM SELETOR DE PAÍS (DDI): formatador único, tabela de DDI cobrindo a
// base mundial, leitura do valor já gravado e limite da coluna (20).
//
//   npx tsx scripts/telefone-ddi.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import countriesI18n from "i18n-iso-countries"
import { DDI_DO_PAIS, PAIS_PADRAO_DO_DDI, PAISES_COM_MASCARA } from "@/src/lib/telefone/ddi"
import {
  LIMITE_TELEFONE, comporTelefone, descobrirPais, digitosNacionais, exibirParteNacional, formatTelefone,
} from "@/src/lib/telefone/formatar"

let passou = 0, falhou = 0
const ok = (c: boolean, n: string, extra: unknown = "") => {
  const e = extra === "" ? "" : ` — ${JSON.stringify(extra)}`
  if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${e}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

secao("Brasil: celular e fixo (mesmo valor gravado de hoje)")
ok(comporTelefone("55", "19984412070") === "+55 (19) 98441-2070", "celular", comporTelefone("55", "19984412070"))
ok(comporTelefone("55", "1933334444") === "+55 (19) 3333-4444", "fixo", comporTelefone("55", "1933334444"))
ok(exibirParteNacional("+55 (19) 98441-2070", "55") === "(19) 98441-2070", "o campo mostra só a parte nacional")
ok(comporTelefone("55", "(19) 98441-2070") === "+55 (19) 98441-2070", "digitar já formatado dá o mesmo valor (idempotente)")

secao("Portugal")
ok(comporTelefone("351", "912345678") === "+351 912 345 678", "celular PT", comporTelefone("351", "912345678"))
ok(exibirParteNacional("+351 912 345 678", "351") === "912 345 678", "parte nacional PT")

secao("País de formatação genérica (Japão +81)")
const jp = comporTelefone("81", "9012345678")
ok(jp === formatTelefone("+819012345678"), "usa o formatador único", jp)
ok(digitosNacionais(jp, "81") === "9012345678", "ida e volta: dígitos nacionais preservados", digitosNacionais(jp, "81"))
ok(comporTelefone("81", digitosNacionais(jp, "81")) === jp, "reformatar o valor lido não o altera")
ok(exibirParteNacional(jp, "81") === "9 012 345 678", "o agrupamento genérico cruza o DDI: descontam-se os dígitos, não texto", exibirParteNacional(jp, "81"))

secao("Valor gravado sem '+' (Brasil)")
ok(descobrirPais("19984412070")?.iso === "BR", "sem '+' abre como Brasil")
ok(digitosNacionais("19984412070", "55") === "19984412070", "dígitos nacionais não perdem o DDD")
ok(descobrirPais("(19) 98441-2070")?.iso === "BR", "sem '+' e com máscara também")

secao("DDI compartilhado")
ok(descobrirPais("+1 (555) 123-4567")?.iso === "US", "+1 abre como Estados Unidos")
ok(descobrirPais("+7 912 345 67 89")?.iso === "RU", "+7 abre como Rússia")
ok(comporTelefone(DDI_DO_PAIS.CA, "5551234567") === comporTelefone(DDI_DO_PAIS.US, "5551234567"), "trocar US→CA reformata igual (mesmo DDI)")
ok(descobrirPais("+351 912 345 678")?.iso === "PT" && descobrirPais("+3519123")?.ddi === "351", "maior prefixo vence (+351, não +35x)")
ok(descobrirPais("+44 7911 123456")?.iso === "GB", "+44 abre como Reino Unido")

secao("Limite de 20 caracteres (VarChar(20))")
let estourou = 0
const ddis = [...new Set(Object.values(DDI_DO_PAIS))]
for (const d of ddis) if (comporTelefone(d, "9".repeat(25)).length > LIMITE_TELEFONE) estourou++
ok(estourou === 0, `nenhum DDI passa de ${LIMITE_TELEFONE} caracteres com número longo`, estourou)
ok(comporTelefone("55", "1".repeat(30)).length <= LIMITE_TELEFONE, "Brasil com número enorme")
ok(comporTelefone("55", "") === "", "número vazio não grava '+55'")

secao("Valor que não casa com nenhum DDI")
ok(descobrirPais("+999 123 456") === null, "+999 não existe")
ok(descobrirPais("+0123456") === null, "+0 não existe")
ok(descobrirPais("") === null && descobrirPais(null) === null, "vazio")

secao("Tabela de DDI cobre a base mundial")
const iso = [...Object.keys(countriesI18n.getAlpha2Codes()), "XK"]
const semDdi = iso.filter((c) => !DDI_DO_PAIS[c])
ok(semDdi.length === 0, `todo país ISO tem DDI (${iso.length} códigos)`, semDdi)
ok(Object.entries(DDI_DO_PAIS).every(([c, d]) => /^[A-Z]{2}$/.test(c) && /^\d{1,3}$/.test(d)), "chaves ISO alpha-2 e DDI só dígitos")
ok(ddis.every((d) => DDI_DO_PAIS[PAIS_PADRAO_DO_DDI[d]] === d), "todo DDI tem país principal que de fato o usa")
ok(PAISES_COM_MASCARA.every((c) => DDI_DO_PAIS[c]) && PAISES_COM_MASCARA[0] === "BR", "topo da lista: países com máscara própria, Brasil primeiro", PAISES_COM_MASCARA)

secao("Formatador único: comportamento original preservado")
ok(formatTelefone("19984412070") === "+55 (19) 98441-2070", "sem '+' prefixa +55")
ok(formatTelefone("+15551234567") === "+1 (555) 123-4567", "+1")
ok(formatTelefone("+34612345678") === "+34 612 345 678", "+34")
ok(formatTelefone("+") === "+", "'+' sozinho")

secao("Rota da lista de países: quem edita dados lê")
const rota = readFileSync("src/app/api/geografia/paises/route.ts", "utf8").replace(/\/\/.*$/gm, "")
ok(/arvore\.editar_documento/.test(rota) && /clientes\.editar/.test(rota), "aceita árvore (editar documento) OU clientes (editar dados)")
ok(/401/.test(rota) && /403/.test(rota), "sem login 401; sem nenhuma das duas permissões 403")
ok(!/clientes\.ver/.test(rota), "só quem EDITA: ver clientes não basta")

console.log(`\n${passou + falhou} verificações · ${falhou === 0 ? "OK ✅" : "FALHOU ❌"}`)
process.exit(falhou === 0 ? 0 : 1)
