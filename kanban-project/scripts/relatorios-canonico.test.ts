// scripts/relatorios-canonico.test.ts
//
// GUARD ARQUITETURAL — Relatórios não pode ter fonte paralela de negócio.
//
// A regra do produto é a cadeia CADASTRO MESTRE → REGRA → OBRIGAÇÃO → OPERAÇÃO
// → FATO → COMPLETUDE → RELATÓRIO. O jeito mais fácil de quebrá-la é inofensivo
// à primeira vista: uma lista de países "só para o filtro", um array de tipos
// documentais "só para o select". No dia seguinte existem duas verdades.
//
// Este teste falha quando isso volta.
import { readFileSync, readdirSync, statSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
let passed = 0, failed = 0
const falhas: string[] = []
const ok = (cond: boolean, nome: string) => {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

function arquivos(dir: string, ext = [".ts", ".tsx"]): string[] {
  const alvo = join(ROOT, dir)
  const out: string[] = []
  const andar = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) andar(p)
      else if (ext.some((e) => p.endsWith(e))) out.push(p)
    }
  }
  try { andar(alvo) } catch { /* pasta pode não existir ainda */ }
  return out
}

/** Superfície do módulo Relatórios: tela, catálogo, componentes e APIs. */
const SUPERFICIE = [
  ...arquivos("src/app/relatorios"),
  ...arquivos("src/components/relatorios"),
  ...arquivos("src/lib/relatorios"),
  ...arquivos("src/app/api/relatorios"),
]

console.log("RELATÓRIOS — GUARD DE ARQUITETURA CANÔNICA\n")

console.log("Nenhuma lista de negócio dentro de Relatórios:")
const conteudo = SUPERFICIE.map((f) => ({ f, src: readFileSync(f, "utf8") }))
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "")

// 1) PAÍSES — a lista vem de CatalogoPais, em tempo de execução.
const paisesHard = conteudo.filter(({ src }) => {
  const s = semComentarios(src)
  return /["'`](Espanha|Itália|Italia|Portugal|Alemanha)["'`]/.test(s)
})
ok(paisesHard.length === 0, `nenhum país escrito em código${paisesHard.length ? ` (${paisesHard.map(x => x.f.split("/").pop()).join(", ")})` : ""}`)

// 2) TIPOS DOCUMENTAIS / CERTIDÕES — vêm do Cadastro Mestre documental.
const docsHard = conteudo.filter(({ src }) => {
  const s = semComentarios(src)
  return /["'`](Certid[ãa]o de Nascimento|CERTIDAO_NASCIMENTO|Certid[ãa]o de Casamento|CERTIDAO_CASAMENTO)["'`]/.test(s)
})
ok(docsHard.length === 0, "nenhum tipo documental escrito em código")

// 3) REQUISITOS — a obrigatoriedade é cadastro, nunca lista no relatório.
const reqHard = conteudo.filter(({ src }) => {
  const s = semComentarios(src)
  return /(documentosObrigatorios|camposObrigatorios)\s*[:=]\s*\[/.test(s)
})
ok(reqHard.length === 0, "nenhuma lista de requisitos obrigatórios no relatório")

// 4) ÓRGÃOS — consulado/tribunal vêm de Organizações.
const orgHard = conteudo.filter(({ src }) => {
  const s = semComentarios(src)
  return /["'`](Consulado (General|Geral|de)|Tribunale Ordinario)/.test(s)
})
ok(orgHard.length === 0, "nenhum órgão escrito em código")

console.log("\nNão existe catálogo de relatórios prontos:")
// O catálogo antigo listava relatórios (Protocolos, Pendências por pessoa,
// Pendências por requisito). Cada pergunta nova pedia uma entrada nova — foi o
// que produziu a tela rejeitada. Domínio não é relatório: a pergunta vira filtro.
import { existsSync } from "fs"
ok(!existsSync(join(ROOT, "src/lib/relatorios/registry.ts")),
  "o catálogo de relatórios prontos foi eliminado — perguntas viram filtros")
const dominios = readFileSync(join(ROOT, "src/lib/relatorios/motor/dominios/protocolos.ts"), "utf8")
ok(/grain:/.test(dominios), "o domínio declara o GRAIN (protege contra JOIN inflado)")
ok(/permissao:/.test(dominios), "o domínio declara PERMISSÃO")
ok(/visoesDoSistema/.test(dominios), "visões prontas são QuerySpecs, não relatórios separados")

console.log("\nNACIONALIDADE OFERTADA ≠ PAÍS GEOGRÁFICO:")
// ESTA VERIFICAÇÃO CIMENTAVA O DEFEITO. Ela exigia que a tela buscasse
// `/api/gerenciamento/paises` — o registro GEOGRÁFICO — e por isso Argentina,
// Brasil, Estados Unidos, França, Paraguai e Reino Unido apareciam listados
// como nacionalidades que a empresa vende. Guard que trava a arquitetura errada
// é pior que guard nenhum.
const superficie = [
  ...arquivos("src/app/relatorios"),
  ...arquivos("src/components/relatorios"),
  ...arquivos("src/lib/relatorios"),
].map((f) => ({ f, src: readFileSync(f, "utf8") }))
const geograficoComoNacionalidade = superficie.filter(({ src }) =>
  /\/api\/gerenciamento\/paises/.test(semComentarios(src)))
ok(geograficoComoNacionalidade.length === 0,
  `o módulo NÃO usa o cadastro geográfico como lista de nacionalidades${geograficoComoNacionalidade.length ? ` (${geograficoComoNacionalidade.map((x) => x.f.split("/").pop()).join(", ")})` : ""}`)

const opcoes = readFileSync(join(ROOT, "src/lib/relatorios/motor/opcoes.ts"), "utf8")
ok(/tiposDeProcesso:\s*\{\s*some:\s*\{\s*ativo:\s*true/.test(opcoes),
  "nacionalidade ofertada = país COM tipo de processo ativo (a mesma regra do Kanban)")
ok(/export async function paisesGeograficos/.test(opcoes),
  "país geográfico tem função própria — serve ao país do órgão, não à nacionalidade")

console.log("\nO motor não é uma porta de SQL:")
const executar = readFileSync(join(ROOT, "src/lib/relatorios/motor/executar.ts"), "utf8")
ok(/dominio\.filtros\.find/.test(executar), "filtro só é aplicado se o domínio o declarou")
ok(/dominio\.contar\(where\)/.test(executar), "o total vem de um COUNT sobre o mesmo where — não de linhas.length")
ok(/exportarCsv/.test(executar) && /executar\(dominio, \{ \.\.\.spec/.test(executar),
  "o export reusa a MESMA consulta da tela")

const registro = readFileSync(join(ROOT, "src/lib/relatorios/motor/registro.ts"), "utf8")
ok(/DOMINIOS/.test(registro), "existe um registro de DOMÍNIOS (assuntos), não de relatórios")

const tipos = readFileSync(join(ROOT, "src/lib/relatorios/motor/tipos.ts"), "utf8")
ok(/grain:\s*Grain/.test(tipos), "todo domínio declara o GRAIN (o que é uma linha)")
ok(/PermissaoChave/.test(tipos), "a permissão do domínio é tipada pelo catálogo de permissões")

console.log("\nO motor de completude não decide obrigatoriedade:")
const motor = readFileSync(join(ROOT, "src/lib/requisitos/completude.ts"), "utf8")
const motorSemComentario = semComentarios(motor)
ok(!/["'`]RG["'`]|["'`]E-?mail["'`]|["'`]Endere[çc]o["'`]/.test(motorSemComentario), "o motor não conhece requisito nenhum pelo nome")
ok(/requisitoCadastral\.findMany/.test(motor), "o motor PERGUNTA ao cadastro quais requisitos incidem")
ok(/necessidadeDocumental\.findMany/.test(motor), "o motor lê as obrigações documentais materializadas")
ok(/DISPENSAD/.test(motor) && /NAO_LOCALIZADA/.test(motor), "dispensado e não localizada são estados distintos")

console.log("\nO catálogo de campos espelha o schema, não inventa:")
const campos = readFileSync(join(ROOT, "src/lib/requisitos/campos-canonicos.ts"), "utf8")
ok(/entidade:\s*"Requerente"/.test(campos), "todo campo declara a ENTIDADE PROPRIETÁRIA do valor")
ok(/colunas:\s*\[/.test(campos), "todo campo declara as COLUNAS reais que o compõem")
ok(!/valor\s*:\s*["']/.test(campos), "o catálogo de campos não guarda valor (sem duplicação)")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.error("FALHAS: " + falhas.join("; ")); process.exit(1) }
