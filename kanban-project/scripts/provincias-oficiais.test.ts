// scripts/provincias-oficiais.test.ts
// PROVÍNCIAS DE VERDADE (08/10/2026): Itália = províncias/cidades metropolitanas do ISTAT; Espanha = 50 províncias + Ceuta e Melilla do INE; nomes em português quando há nome usual.
import { readFileSync } from "node:fs"
import { provinciasDoPais, cidadesDaProvincia, provinciaDaCidade } from "../src/services/localidade/geografia-mundial"
import { MARCAS_DE_LISTA_ERRADA_IT, REGIOES_DA_ITALIA, COMUNIDADES_DA_ESPANHA, normalizarNomeDeLugar as nn } from "../lib/localidade/provincias-oficiais"
import { localidadeCompleta } from "../lib/localidade/regra-localidade"
import { detectarRegraT } from "../lib/saude/verificacoes/regras-do-marco"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const ler = (f: string) => readFileSync(f, "utf8")

async function main() {
  const it = await provinciasDoPais("IT"), es = await provinciasDoPais("ES")
  const nomesIt = it.map((p) => p.nome), nomesEs = es.map((p) => p.nome)

  console.log("\n1) Itália: província de verdade, em português ou italiano")
  ok("107 províncias/cidades metropolitanas (ISTAT)", it.length === 107, String(it.length))
  ok("nenhuma REGIÃO na lista (Lombardia, Piemonte, Calabria, Abruzzo… nem em inglês)", !nomesIt.some((p) => REGIOES_DA_ITALIA.map(nn).includes(nn(p))), nomesIt.filter((p) => REGIOES_DA_ITALIA.map(nn).includes(nn(p))).join(","))
  ok("nada em inglês: sem «Metropolitan City of», «Province of», «Libero consorzio», Lombardy, Piedmont…", !nomesIt.some((p) => MARCAS_DE_LISTA_ERRADA_IT.some((r) => r.test(p))))
  ok("nomes em português onde há nome usual: Roma, Milão, Nápoles, Turim, Florença, Veneza, Gênova, Mântua, Bolonha", ["Roma", "Milão", "Nápoles", "Turim", "Florença", "Veneza", "Gênova", "Mântua", "Bolonha"].every((p) => nomesIt.includes(p)))
  ok("nome oficial italiano quando não há nome usual: Ferrara, Crotone, Forlì-Cesena, Sud Sardegna", ["Ferrara", "Crotone", "Forlì-Cesena", "Sud Sardegna"].every((p) => nomesIt.includes(p)))

  console.log("\n2) Espanha: as 50 províncias + Ceuta e Melilla (não as comunidades)")
  ok("52 itens: 50 províncias + Ceuta + Melilla (INE)", es.length === 52 && nomesEs.includes("Ceuta") && nomesEs.includes("Melilla"), String(es.length))
  ok("León, Lugo, Pontevedra e Barcelona existem", ["León", "Lugo", "Pontevedra", "Barcelona"].every((p) => nomesEs.includes(p)))
  ok("nomes em português: Corunha, Saragoça, Sevilha, Biscaia, Ilhas Baleares, Orense, Lérida, Guipúscoa", ["Corunha", "Saragoça", "Sevilha", "Biscaia", "Ilhas Baleares", "Orense", "Lérida", "Guipúscoa"].every((p) => nomesEs.includes(p)))
  ok("nenhuma COMUNIDADE autônoma no lugar da província (Galicia, Cataluña, Andalucía, Castilla y León, País Vasco…)", !nomesEs.some((p) => COMUNIDADES_DA_ESPANHA.map(nn).includes(nn(p))), nomesEs.filter((p) => COMUNIDADES_DA_ESPANHA.map(nn).includes(nn(p))).join(","))

  console.log("\n3) As cidades reais da Discovery carregam sob a província certa")
  const casos: Array<[string, string, string]> = [["IT", "Ferrara", "Comacchio"], ["IT", "Mântua", "Castelbelforte"], ["IT", "Crotone", "Cirò"], ["ES", "Múrcia", "San Javier"], ["ES", "Múrcia", "Torre-Pacheco"], ["ES", "Lugo", "Lugo"], ["ES", "León", "León"], ["ES", "Granada", "Murtas"], ["ES", "Granada", "Almuñécar"], ["ES", "Granada", "Turón"], ["ES", "Pontevedra", "A Guarda"], ["ES", "Barcelona", "Barcelona"]]
  for (const [pais, prov, cidade] of casos) {
    const r = await cidadesDaProvincia(pais, prov, cidade)
    ok(`${cidade} carrega ao escolher ${prov} (${pais})`, r.some((c) => nn(c.nome) === nn(cidade)))
  }
  ok("a província pode ser escolhida pelo nome oficial também (Mantova, Ourense)", (await cidadesDaProvincia("IT", "Mantova", "Castelbelforte")).length === 1 && (await cidadesDaProvincia("ES", "Ourense", "Ourense")).length >= 1)
  ok("a cidade fixa a província: Comacchio→Ferrara, Castelbelforte→Mântua, Cirò→Crotone, Turón→Granada, A Guarda→Pontevedra", (await provinciaDaCidade("IT", "Comacchio")) === "Ferrara" && (await provinciaDaCidade("IT", "Castelbelforte")) === "Mântua" && (await provinciaDaCidade("IT", "Cirò")) === "Crotone" && (await provinciaDaCidade("ES", "Turón")) === "Granada" && (await provinciaDaCidade("ES", "A Guarda")) === "Pontevedra")

  console.log("\n4) O formulário nunca trava")
  ok("cidade fora da base: lista vazia, sem exceção, e o formulário aceita o texto", (await cidadesDaProvincia("IT", "Ferrara", "CidadeQueNaoExiste")).length === 0 && localidadeCompleta("Itália", "Ferrara", "CidadeQueNaoExiste") && localidadeCompleta("Espanha", "", "Pueblo Novo"))
  ok("província que não existe: lista vazia (nunca erro)", (await cidadesDaProvincia("ES", "Província Inventada", "x")).length === 0)

  console.log("\n5) Todos os pontos de entrada leem a MESMA fonte")
  ok("a rota de províncias e a de cidades chamam o serviço único", /provinciasDoPais/.test(ler("src/app/api/localidades/provincias/route.ts")) && /cidadesDaProvincia/.test(ler("src/app/api/localidades/cidades/route.ts")))
  ok("o hook único (Dados registrados e Editar dados registrais) e a ferramenta única de localidade (a mesma na árvore) usam essas rotas — e nenhum embute lista de província", /\/api\/localidades\/provincias/.test(ler("lib/localidade/use-localidade.ts")) && /useLocalidade\(/.test(ler("src/components/localidade/campos-de-localidade.tsx")) && ["src/components/kanban/workflow/EditorRegistralModal.tsx", "src/components/kanban/documento/EditarDadosRegistrais.tsx", "src/components/localidade/campos-de-localidade.tsx", "src/components/arvore/campos-nascimento.tsx"].every((f) => !/Lombardia|Emilia-Romagna|Galicia/.test(ler(f))))

  console.log("\n6) O vigia vivo das listas")
  const v = await detectarRegraT()
  ok("o vigia 't' (listas da Itália/Espanha + cidades reais) não acusa nada", v.length === 0, v.map((x) => x.detalhe).join("; "))

  console.log(`\n${n - falhou}/${n} verificações`)
  if (falhou > 0) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
