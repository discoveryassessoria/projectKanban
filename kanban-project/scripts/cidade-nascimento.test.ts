// scripts/cidade-nascimento.test.ts
//
// CIDADE DE NASCIMENTO (ETAPA 1 — cadastro inteligente da pessoa).
// Teste PURO: o campo continua string livre; o autocomplete só sugere municípios
// do IBGE (JSON estático versionado, sem API em tempo de execução) e NUNCA
// reescreve o que já está gravado — "São Paulo (Santo Amaro)" atravessa intacto.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import municipios from "@/src/lib/geografia/municipios-br.json"
import {
  achatarMunicipios, baseDaCidade, complementoDaCidade, trocarBase, sugerirMunicipios, paisEhBrasil,
  normalizarBusca, type MunicipiosPorUf,
} from "@/src/lib/geografia/cidade-nascimento"

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }
const RAIZ = join(__dirname, "..")
const src = (p: string) => readFileSync(join(RAIZ, p), "utf8")

console.log("\n1) complemento entre parênteses é preservado")
chk(baseDaCidade("São Paulo (Santo Amaro)") === "São Paulo", "base de 'São Paulo (Santo Amaro)' = 'São Paulo'")
chk(complementoDaCidade("São Paulo (Santo Amaro)") === "Santo Amaro", "complemento = 'Santo Amaro'")
chk(baseDaCidade("Vicenza") === "Vicenza" && complementoDaCidade("Vicenza") === "", "sem parênteses: tudo é cidade")
chk(baseDaCidade(null) === "" && baseDaCidade(undefined) === "" && complementoDaCidade(null) === "", "nulo é vazio")
chk(trocarBase("São Paulo (Santo Amaro)", "Santos") === "Santos (Santo Amaro)", "escolher outro município mantém o complemento")
chk(trocarBase("Sao Pau", "São Paulo") === "São Paulo", "sem complemento: troca simples")
chk(trocarBase("", "Campinas") === "Campinas", "campo vazio + escolha")
chk(trocarBase("São Paulo (Santo Amaro)", "São Paulo") === "São Paulo (Santo Amaro)", "escolher a MESMA cidade devolve o valor idêntico")
chk(baseDaCidade("Cidade (Distrito (A))") === "Cidade", "parênteses aninhados: base continua a cidade")
const gravado = "São Paulo (Santo Amaro)"
chk(trocarBase(gravado, baseDaCidade(gravado)) === gravado, "ida e volta (abrir e sugerir a base) não altera o valor gravado")

console.log("\n2) texto livre")
chk(sugerirMunicipios(achatarMunicipios(municipios as MunicipiosPorUf), "Vicenza").length === 0, "cidade estrangeira não tem sugestão — vale como digitada")
chk(sugerirMunicipios(achatarMunicipios(municipios as MunicipiosPorUf), "a").length === 0, "1 letra não sugere nada")
chk(sugerirMunicipios(achatarMunicipios(municipios as MunicipiosPorUf), "").length === 0, "vazio não sugere nada")

console.log("\n3) lista estática do IBGE")
const porUf = municipios as MunicipiosPorUf
const ufs = Object.keys(porUf)
const total = ufs.reduce((n, uf) => n + porUf[uf].length, 0)
chk(ufs.length === 27, `27 UFs (${ufs.length})`)
chk(total >= 5560 && total <= 5580, `≈5.570 municípios (${total})`)
chk(porUf.SP.includes("São Paulo") && porUf.RJ.includes("Rio de Janeiro") && porUf.DF.includes("Brasília"), "capitais conhecidas presentes")
chk(porUf.SP.includes("Santo André") && porUf.RS.includes("Santa Maria"), "outros municípios conhecidos")
chk(porUf.SP.length === 645 && porUf.MG.length === 853 && porUf.RS.length === 497 && porUf.DF.length === 1, "contagens oficiais SP=645, MG=853, RS=497, DF=1")
chk(ufs.every((uf) => porUf[uf].every((n) => n.trim() === n && n.length > 0)), "nomes sem espaços sobrando nem vazios")
chk(ufs.every((uf) => new Set(porUf[uf]).size === porUf[uf].length), "sem município repetido dentro da mesma UF")

console.log("\n4) sugestões")
const lista = achatarMunicipios(porUf)
const sp = sugerirMunicipios(lista, "sao paulo")
chk(sp[0]?.nome === "São Paulo" && sp[0]?.uf === "SP", "'sao paulo' (sem acento) acha São Paulo/SP primeiro")
const santos = sugerirMunicipios(lista, "Santos")
chk(santos[0]?.nome === "Santos", "quem COMEÇA com o termo vem antes de quem só o contém")
chk(sugerirMunicipios(lista, "bom jesus", 100).filter((m) => m.nome === "Bom Jesus").length > 1, "homônimos aparecem separados por UF")
chk(sugerirMunicipios(lista, "paulo", 5).length === 5, "respeita o limite")
chk(sugerirMunicipios(lista, "xyzxyz").length === 0, "sem correspondência = sem sugestão")
chk(normalizarBusca("  São   PAULO ") === "sao paulo", "normalização de busca")

console.log("\n5) o país decide se há autocomplete")
chk(paisEhBrasil("Brasil") && paisEhBrasil("brasil") && paisEhBrasil(" BRASIL ") && paisEhBrasil("Brazil"), "Brasil, em qualquer caixa")
chk(!paisEhBrasil("Itália") && !paisEhBrasil("") && !paisEhBrasil(null), "outros países/vazio: texto livre")

console.log("\n6) runtime NÃO depende de API externa nem infla o bundle inicial")
const campos = src("src/components/arvore/campos-nascimento.tsx")
const modulo = src("src/lib/geografia/cidade-nascimento.ts")
chk(!/ibge\.gov\.br|servicodados/i.test(campos) && !/ibge\.gov\.br|servicodados/i.test(modulo), "nenhuma chamada ao IBGE em tempo de execução")
chk(/import\(\s*["']@\/src\/lib\/geografia\/municipios-br\.json["']\s*\)/.test(campos), "o JSON entra por import() dinâmico")
chk(!/^import .*municipios-br\.json/m.test(campos), "e não por import estático no topo")
chk(/pedir/.test(campos) && /onFocoPrimeiraVez/.test(campos), "a lista só carrega quando o campo ganha foco")

console.log(`\n${ok} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
