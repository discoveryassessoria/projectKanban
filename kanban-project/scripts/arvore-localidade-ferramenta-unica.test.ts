// scripts/arvore-localidade-ferramenta-unica.test.ts
//
// A ÁRVORE USA A MESMA FERRAMENTA DE LOCALIDADE DA GENEALOGIA (09/10/2026): nascimento, casamento e óbito pedem País → Estado/Província → Cidade
// (Brasil: estados e cidades em lista; outro país: província da base e cidade sugerida). Nada de texto solto «Cidade - Estado» e nenhuma cópia da regra.
// Estático + puro: sem banco.
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { nomeDaUf } from "../lib/localidade/ufs"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8")
let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }

console.log("\n1) A sigla antiga continua reconhecida (sem reescrever o dado)")
ok("«SP» e «sp» e «São Paulo» → «São Paulo»", nomeDaUf("SP") === "São Paulo" && nomeDaUf("sp") === "São Paulo" && nomeDaUf("sao paulo") === "São Paulo")
ok("estrangeiro, vazio e sigla com complemento não viram estado brasileiro", nomeDaUf("Lombardia") === null && nomeDaUf("") === null && nomeDaUf("SP (2º Subd.)") === null)

console.log("\n2) A ferramenta única")
const f = ler("src/components/localidade/campos-de-localidade.tsx")
ok("usa o hook único e o rótulo da regra (Estado × Província)", /useLocalidade\(/.test(f) && /loc\.rotuloDivisao/.test(f))
ok("país e estado em lista; cidade em lista no Brasil e sugerida fora (texto livre sempre vale)", /loc\.paises/.test(f) && /loc\.provincias/.test(f) && /loc\.municipios/.test(f) && /cidadesSugeridas/.test(f))
ok("trocar o país limpa estado e cidade; trocar o estado limpa a cidade", /estado: "", cidade: ""/.test(f) && /estado: e\.target\.value, cidade: ""/.test(f))

console.log("\n3) A árvore usa só ela — nascimento, casamento e óbito, no adicionar e no editar")
const v = ler("src/components/arvore/arvore-genealogica-view.tsx")
ok("6 usos (3 eventos × adicionar e editar) e nenhum campo antigo", (v.match(/<CamposDeLocalidade/g) ?? []).length === 6 && !/CampoPaisNascimento|CampoEstadoNascimento|CampoCidadeNascimento/.test(v))
ok("óbito: país, estado e cidade vão para as colunas próprias", /pais_obito: isFalecido/.test(v) && /estado_obito: isFalecido/.test(v) && /local_obito: isFalecido/.test(v))
ok("casamento: país, estado e cidade vão para a união (4 gravações)", (v.match(/local: cidadeCasamento\.trim\(\) \|\| null, estado: estadoCasamento\.trim\(\) \|\| null, pais: paisCasamento\.trim\(\) \|\| null/g) ?? []).length === 4)
ok("os campos que vieram do registro continuam travados (nascimento, óbito e casamento)", /PESSOA\.pais_obito/.test(v) && /PESSOA\.local_nasc/.test(v) && /UNIAO\.pais/.test(v) && /UNIAO\.estado/.test(v))
ok("sem texto solto de local do óbito/casamento", !/setLocalObito|setLocalCasamento|placeholder="Cidade - Estado"/.test(v))
ok("o onboarding usa a mesma ferramenta (só o país)", /CamposDeLocalidade/.test(ler("src/components/arvore/tree-onboarding.tsx")) && !/CampoPaisNascimento/.test(ler("src/components/arvore/tree-onboarding.tsx")))
ok("campos-nascimento não tem mais lista de localidade própria", !/\/api\/localidades|UFS_BR|municipios-br/.test(ler("src/components/arvore/campos-nascimento.tsx")))
ok("a aba «Editar dados registrais» da Genealogia usa a mesma ferramenta", /<CamposDeLocalidade/.test(ler("src/components/kanban/documento/EditarDadosRegistrais.tsx")))

console.log("\n4) O painel de leitura mostra o local COMPLETO (cidade, estado, país)")
import { localCompletoDoObito } from "../src/lib/genealogia/local-obito"
ok("óbito: «Itapira, SP, Brasil»", localCompletoDoObito({ local_obito: "Itapira", estado_obito: "SP", pais_obito: "Brasil" }) === "Itapira, SP, Brasil")
ok("óbito sem país ainda mostra cidade e estado; vazio fica vazio", localCompletoDoObito({ local_obito: "Itapira", estado_obito: "SP" }) === "Itapira, SP" && localCompletoDoObito({}) === "")
const sb = ler("src/components/arvore/pessoa-sidebar.tsx")
ok("o painel usa o local completo do casamento e do óbito", /localDaUniao\(casamento\)/.test(sb) && /localCompletoDoObito\(pessoa\)/.test(sb))
console.log(`\n${n - falhou}/${n} verificações`)
if (falhou) process.exit(1)
