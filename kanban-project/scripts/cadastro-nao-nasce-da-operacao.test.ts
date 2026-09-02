// scripts/cadastro-nao-nasce-da-operacao.test.ts
//
// REGRA 1 — nada existe na operação sem estar cadastrado no Gerenciamento.
//
// Três partes: ORDEM (o cadastro vem antes), PORTA (a operação escolhe de uma
// lista) e RECUSA (faltando cadastro, a operação FALHA em vez de criar).
//
// A terceira é a que se viola sem perceber, porque parece gentileza. Foi assim
// que 61 famílias fantasma entraram em produção: criar uma árvore criava uma
// Família, copiando o nome da árvore — e a tela gera "Árvore do Processo 458".
// O relatório passou a dizer "63 famílias" existindo duas.
//
// Este guard falha quando isso volta.
//
// E a contraparte: EXCLUSÃO NÃO DEIXA ÓRFÃO. O que só existia por causa do que
// foi apagado sai junto.

import { readFileSync, readdirSync, statSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
let ok = 0, falhou = 0
const falhas: string[] = []
const check = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}

function varrer(dir: string, out: string[] = []): string[] {
  let itens: string[] = []
  try { itens = readdirSync(join(RAIZ, dir)) } catch { return out }
  for (const f of itens) {
    const rel = `${dir}/${f}`
    if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, out)
    else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) out.push(rel)
  }
  return out
}

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "")

const ESTE = "scripts/cadastro-nao-nasce-da-operacao.test.ts"
const fontes = [...varrer("src"), ...varrer("lib")].filter((f) => f !== ESTE)
const conteudo = new Map(fontes.map((f) => [f, semComentarios(readFileSync(join(RAIZ, f), "utf8"))]))

console.log("REGRA 1 — CADASTRO PRECEDE OPERAÇÃO\n")

// ── RECUSA ────────────────────────────────────────────────────────────────
console.log("A operação não fabrica cadastro:")

/**
 * Entidades de CADASTRO. Criar uma delas é ato de gente, no Gerenciamento —
 * nunca efeito colateral de uma operação. `Familia` entra aqui porque é a
 * unidade de atendimento: ela existe por si, com N processos ao longo do tempo.
 */
const CADASTROS = ["familia", "catalogoPais", "modalidadePais", "itemCatalogo",
  "tipoDocumentoCadastro", "servicoProduto", "canalOperacional", "categoriaDocumental"]

/**
 * Onde criar cadastro É o trabalho: as telas do próprio Gerenciamento e seeds.
 *
 * `catalogo-sync.ts` entra aqui porque é a PROJEÇÃO do mestre — ele mantém o
 * ItemCatalogo em sincronia quando alguém cadastra um Serviço no Gerenciamento,
 * e só é alcançado por rotas `/api/gerenciamento/`. O guard abaixo confere isso:
 * se ele passar a ser chamado da operação, a exceção deixa de valer.
 */
const PORTAS_LEGITIMAS = [
  "/api/gerenciamento/", "/api/familias/", "prisma/seed", "prisma/backfill",
  "src/services/familia.ts", "src/services/catalogo-sync.ts",
]

for (const cadastro of CADASTROS) {
  const infratores = fontes.filter((f) => {
    if (PORTAS_LEGITIMAS.some((p) => f.includes(p))) return false
    const src = conteudo.get(f)!
    return new RegExp(`\\b(prisma|tx)\\.${cadastro}\\.(create|upsert)\\b`).test(src)
      || new RegExp(`\\b${cadastro}:\\s*\\{\\s*(create|connectOrCreate)\\b`).test(src)
  })
  check(infratores.length === 0, `nenhuma operação cria \`${cadastro}\``, infratores.join(", "))
}

// A exceção do catálogo só vale enquanto ela for alcançada SÓ pelo Gerenciamento.
const chamadoresDoSync = fontes.filter((f) =>
  f !== "src/services/catalogo-sync.ts" && /catalogo-sync/.test(conteudo.get(f)!))
const foraDoGerenciamento = chamadoresDoSync.filter((f) => !f.includes("/api/gerenciamento/"))
check(foraDoGerenciamento.length === 0,
  "a projeção do catálogo só é chamada pelo Gerenciamento", foraDoGerenciamento.join(", "))

// O serviço de família em particular: ele NÃO pode voltar a garantir.
const familia = conteudo.get("src/services/familia.ts") ?? ""
check(!/export\s+async\s+function\s+garantirFamilia/.test(familia),
  "não existe `garantirFamilia*` — garantir é o oposto de recusar")
check(!/familia\.create\(/.test(familia) || /herdar|removerFamiliaSeOrfa/.test(familia),
  "o serviço de família não cria família fora do cadastro")

// Nome de cadastro nunca é gerado por código.
const nomesFabricados = fontes.filter((f) => {
  const src = conteudo.get(f)!
  return /familia\.create\([\s\S]{0,200}nome:\s*`/.test(src)
})
check(nomesFabricados.length === 0,
  "nenhum nome de família é fabricado por template", nomesFabricados.join(", "))

// ── EXCLUSÃO NÃO DEIXA ÓRFÃO ──────────────────────────────────────────────
console.log("\nA exclusão não deixa órfão:")
check(/export\s+async\s+function\s+removerFamiliaSeOrfa/.test(familia),
  "existe a limpeza canônica de família órfã")
check(/processo\.count\(\{\s*where:\s*\{\s*familiaId/.test(familia)
  && /arvore\.count\(\{\s*where:\s*\{\s*familiaId/.test(familia),
  "a limpeza confere processo E árvore antes de apagar")

for (const rota of [
  "src/app/api/processos/[processoId]/route.ts",
  "src/app/api/arvore/[arvoreid]/route.ts",
]) {
  const src = conteudo.get(rota) ?? ""
  check(/removerFamiliaSeOrfa/.test(src), `${rota.split("/api/")[1]} limpa a família órfã ao excluir`)
}

console.log(`\n${ok} passaram, ${falhou} falharam`)
if (falhou > 0) { console.error("FALHAS: " + falhas.join("; ")); process.exit(1) }
