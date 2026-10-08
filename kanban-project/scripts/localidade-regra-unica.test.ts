// scripts/localidade-regra-unica.test.ts
// REGRA ÚNICA DA LOCALIDADE (08/10/2026): Brasil = País→Estado→Cidade→Cartório (lista só de cartórios); outro país = País→PROVÍNCIA→Cidade→Cartório em texto livre.
import { existsSync, readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { ehPaisBrasil, rotuloDaDivisao, modoDoCartorio, ehCartorioDaLista, ehOrgaoDeRegistroCivil, exigeCartorioVinculado, localidadeCompleta } from "../lib/localidade/regra-localidade"
import { provinciasDoPais, cidadesDaProvincia } from "../src/services/localidade/geografia-mundial"
import { buscarOrgaos } from "../src/services/orgao-vinculo-documento"
import { campoParaPais, CAMPOS_SINCRONIZAVEIS } from "../src/lib/genealogia/sincronizacao-registral"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const ler = (f: string) => readFileSync(f, "utf8")

async function main() {
  exigirBancoDeTeste("localidade-regra-unica.test.ts")

  console.log("\n1) A regra (pura)")
  ok("Brasil: «Estado», lista de cartórios, exige o cartório vinculado", rotuloDaDivisao("Brasil") === "Estado" && rotuloDaDivisao("Brazil") === "Estado" && rotuloDaDivisao("") === "Estado" && modoDoCartorio("Brasil") === "LISTA_DO_BRASIL" && exigeCartorioVinculado("Brasil"))
  ok("Espanha/Itália/qualquer outro: «Província», cartório em texto livre, sem obrigar cadastro", ["Espanha", "Itália", "Portugal", "Japão"].every((p) => rotuloDaDivisao(p) === "Província" && modoDoCartorio(p) === "TEXTO_LIVRE" && !exigeCartorioVinculado(p)))
  ok("só o tipo «cartorio» entra na lista; banco/arquivo/igreja/«outro» não", ehCartorioDaLista("cartorio") && !ehCartorioDaLista("outro") && !ehCartorioDaLista("tribunal") && !ehCartorioDaLista(null))
  ok("registro civil e equivalentes (vigia dos dados gravados): cartório, comune, conservatória — nunca «outro»", ehOrgaoDeRegistroCivil("comune") && ehOrgaoDeRegistroCivil("conservatoria") && ehOrgaoDeRegistroCivil("cartorio") && !ehOrgaoDeRegistroCivil("outro"))
  ok("o formulário NÃO trava: fora do Brasil basta a cidade (digitada, mesmo que a base não a conheça); no Brasil, estado + cidade", localidadeCompleta("Espanha", "", "Turón") && !localidadeCompleta("Espanha", "Galicia", "") && localidadeCompleta("Brasil", "São Paulo", "São Paulo") && !localidadeCompleta("Brasil", "", "São Paulo"))
  ok("«estado do nascimento» vira «província do nascimento» fora do Brasil (nos avisos e no histórico)", campoParaPais(CAMPOS_SINCRONIZAVEIS.find((c) => c.chave === "PESSOA.estado_nasc")!, "Espanha").rotulo === "província do nascimento" && campoParaPais(CAMPOS_SINCRONIZAVEIS.find((c) => c.chave === "PESSOA.estado_nasc")!, "Brasil").rotulo === "estado do nascimento")

  console.log("\n2) A base geográfica (as cidades reais da Discovery)")
  // Itália e Espanha têm fonte OFICIAL de província (ISTAT/INE — ver `provincias-oficiais.test.ts`); o resto do mundo usa a base geral. Aqui: cidade de OUTRO país + cidade desconhecida.
  const jp = await cidadesDaProvincia("JP", null, "Tokyo")
  ok("fora de Itália/Espanha a base geral encontra cidades (Tokyo, JP)", jp.some((c) => c.nome.toLowerCase().startsWith("tok")))
  for (const [cidade, pais] of [["Comacchio", "IT"], ["Castelbelforte", "IT"], ["Cirò", "IT"], ["San Javier", "ES"], ["Torre-Pacheco", "ES"], ["Lugo", "ES"], ["Murtas", "ES"], ["Almuñécar", "ES"], ["Turón", "ES"], ["A Guarda", "ES"], ["Barcelona", "ES"]] as const) {
    const r = await cidadesDaProvincia(pais, null, cidade)
    ok(`${cidade} (${pais}): a base oficial encontra`, r.some((c) => c.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === cidade.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()))
  }
  ok("cidade desconhecida vira texto livre, sem erro", (await cidadesDaProvincia("IT", null, "CidadeInventadaXYZ")).length === 0)
  ok("províncias carregam sozinhas por país (Espanha, Itália) e o Brasil não usa esta base", (await provinciasDoPais("ES")).length > 10 && (await provinciasDoPais("IT")).length > 50 && (await provinciasDoPais("ZZ")).length === 0)
  ok("cidade ausente / província inexistente = lista vazia (nunca exceção)", (await cidadesDaProvincia("ES", "Província Que Não Existe", "x")).length === 0 && (await cidadesDaProvincia("ZZ", null, "x")).length === 0)

  console.log("\n3) O servidor: a busca de cartórios (banco de teste)")
  const marca = "LOCREG"
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: marca } } })
  await prisma.cartorio.deleteMany({ where: { sourceId: { startsWith: marca } } })
  try {
    await prisma.orgaoProtocolo.create({ data: { name: `${marca} Banco Santander`, type: "outro", city: "São Paulo", state: "SP" } as never })
    await prisma.orgaoProtocolo.create({ data: { name: `${marca} Arquidiocese`, type: "outro", city: "São Paulo", state: "SP" } as never })
    await prisma.orgaoProtocolo.create({ data: { name: `${marca} 1º Registro Civil`, type: "cartorio", city: "São Paulo", state: "SP" } as never })
    await prisma.cartorio.create({ data: { sourceId: `${marca}-1`, nome: `${marca} Barcelona`, nomeNormalizado: "locreg barcelona", uf: "RN", municipio: "Barcelona" } as never })
    const br = await buscarOrgaos(prisma, marca, { pais: "Brasil", uf: "SP", cidade: "São Paulo" })
    ok("Brasil/SP/São Paulo: aparece o cartório; banco e arquivo/igreja («outro») NÃO", br.some((o) => o.name.includes("Registro Civil")) && !br.some((o) => o.name.includes("Santander") || o.name.includes("Arquidiocese")), br.map((o) => o.name).join(", "))
    ok("todo item da lista do Brasil é do tipo cartório", br.every((o) => ehCartorioDaLista(o.type)))
    const es = await buscarOrgaos(prisma, marca, { pais: "Espanha", cidade: "Barcelona" })
    ok("Espanha/Barcelona: NENHUM item — a base do Brasil («Barcelona/RN») não aparece para outro país", es.length === 0, es.map((o) => `${o.name}/${o.state}`).join(", "))
    const it = await buscarOrgaos(prisma, "Comacchio", { pais: "Itália" })
    ok("Itália: lista vazia (cartório é texto livre)", it.length === 0)
    const brRn = await buscarOrgaos(prisma, marca, { pais: "Brasil", uf: "RN", cidade: "Barcelona" })
    ok("Brasil/RN/Barcelona: a base nacional continua valendo no Brasil", brRn.some((o) => o.origem === "cartorio_nacional" && o.name.includes("Barcelona")))
  } finally {
    await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: marca } } })
    await prisma.cartorio.deleteMany({ where: { sourceId: { startsWith: marca } } })
  }

  console.log("\n4) As telas leem a mesma regra (nenhuma decide sozinha)")
  const modal = ler("src/components/kanban/workflow/EditorRegistralModal.tsx")
  ok("Dados registrados: «Província» fora do Brasil, rótulo pela regra, cidade da base com texto livre", /label="Província"/.test(modal) && /rotuloDivisao/.test(modal) && /\/api\/localidades\/provincias/.test(ler("lib/localidade/use-localidade.ts")) && /\/api\/localidades\/cidades/.test(ler("lib/localidade/use-localidade.ts")))
  ok("Dados registrados: fora do Brasil o cartório é só um campo de texto (sem CartorioOrgaoField na ramificação)", /FORA DO BRASIL: cartório em TEXTO LIVRE/.test(modal) && /ehBrasil \? \(\s*<>\s*<CartorioOrgaoField/.test(modal) && !/FORA DO BRASIL: cartório em TEXTO LIVRE[\s\S]{0,500}CartorioOrgaoField/.test(modal))
  ok("Dados registrados: só o Brasil exige o cartório vinculado", /!exigeCartorioVinculado\(form\.pais_registro\)/.test(modal))
  ok("o campo de cartório do Brasil sempre pede a busca com pais=Brasil", /params\.set\("pais", "Brasil"\)/.test(ler("src/components/orgaos/CartorioOrgaoField.tsx")))
  const edit = ler("src/components/kanban/documento/EditarDadosRegistrais.tsx")
  ok("«Editar dados registrais» (aba Dados Registrais) usa o MESMO carregamento (useLocalidade) e a mesma regra: país em lista, rótulo da divisão, cartório em lista só no Brasil", /useLocalidade\(/.test(edit) && /loc\.rotuloDivisao/.test(edit) && /loc\.ehBrasil \? \(\s*<CartorioOrgaoField/.test(edit) && /id="edr-pais_registro"/.test(edit))
  ok("os dois formulários usam o hook único e nenhum faz fetch próprio do IBGE ou de cidades", /useLocalidade\(/.test(modal) && !/servicodados\.ibge\.gov\.br/.test(modal) && !/servicodados\.ibge\.gov\.br/.test(edit) && /servicodados\.ibge\.gov\.br/.test(ler("lib/localidade/use-localidade.ts")))
  ok("a árvore (campos de nascimento) usa a base de províncias/cidades e o rótulo da regra", /\/api\/localidades\/provincias/.test(ler("src/components/arvore/campos-nascimento.tsx")) && /\/api\/localidades\/cidades/.test(ler("src/components/arvore/campos-nascimento.tsx")) && /rotuloDaDivisao\(paisNasc\)/.test(ler("src/components/arvore/arvore-genealogica-view.tsx")))
  ok("a aba Documentos/gaveta usa o rótulo da regra (nunca «Estado» fixo)", /rotuloDaDivisao\(doc\.pais_registro\)/.test(ler("src/components/kanban/DocumentoOperationalDrawer.tsx")) && !/"Estado\/Província"/.test(ler("src/components/kanban/DocumentoOperationalDrawer.tsx")))
  ok("o servidor só exige órgão vinculado no Brasil (concluir «Localizar registro»)", /faltaCartorioVinculado\(documentoId\)/.test(ler("src/services/documento-operacao.ts")) && /exigeCartorioVinculado\(doc\.pais_registro\)/.test(ler("src/services/localidade/cartorio-vinculado.ts")))
  ok("a busca de órgãos aceita o país e a rota repassa", /pais: sp\.get\("pais"\)/.test(ler("src/app/api/operacao/orgaos/busca/route.ts")))
  ok("o vigia 's' (cartório ligado fora da regra) existe", /detectarRegraS/.test(ler("lib/saude/verificacoes/regras-do-marco.ts")) && existsSync("src/app/api/localidades/provincias/route.ts"))

  console.log(`\n${n - falhou}/${n} verificações`)
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
