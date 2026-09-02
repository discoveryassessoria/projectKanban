/**
 * RELATÓRIOS — GUARD DE COLUNA RESTRITA. Roda no build, não precisa de banco.
 *
 * Um domínio declara UMA permissão, mas nem toda coluna dele pertence ao mesmo
 * assunto. "Certidões" abre com `processos.ver` e trazia a coluna "Custo pago";
 * "Fornecedores" abre com `usuarios.gerenciar` e trazia a mesma coisa. Dinheiro
 * ficava legível para quem só podia ver processo ou gente — e o relatório é a
 * porta mais fácil, porque devolve tudo de uma vez e ainda exporta.
 *
 * A regra: coluna de dinheiro em domínio que NÃO é financeiro precisa declarar
 * `permissao`. Sem isso, o build falha — em vez de alguém descobrir depois.
 *
 * Isto é análise de TEXTO de propósito: importar os domínios puxaria o Prisma e
 * o banco, e guard que precisa de banco não roda no build.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const PASTA = join(RAIZ, "src/lib/relatorios/motor/dominios")

let passou = 0
let falhou = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

/** Rótulo que nomeia dinheiro. Não é heurística frouxa: é lista fechada. */
const ROTULOS_DE_DINHEIRO = /rotulo:\s*"(Custo|Valor|Receita|Preço|Margem|Lucro|Total pago|Total recebido|Saldo|Honorário)[^"]*"/

console.log("RELATÓRIOS — coluna de dinheiro exige permissão financeira\n")

const arquivos = readdirSync(PASTA).filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
ok(arquivos.length >= 17, `${arquivos.length} domínios lidos (piso 17)`)

for (const arquivo of arquivos) {
  const fonte = readFileSync(join(PASTA, arquivo), "utf8")
  const permissaoDoDominio = fonte.match(/permissao:\s*"([a-z_.]+)"/)?.[1] ?? "?"
  // O domínio que JÁ abre com permissão financeira não precisa repetir na coluna.
  if (permissaoDoDominio === "financeiro.ver") continue

  // Cada coluna começa em `{ key: "..."` e vai até a próxima. Recorte grosseiro
  // de propósito: erra para o lado de exigir a mais, nunca de deixar passar.
  const blocos = fonte.split(/\n\s*\{\s*key:\s*"/).slice(1)
  for (const bloco of blocos) {
    const chave = bloco.slice(0, bloco.indexOf('"'))
    const trecho = bloco.slice(0, 400)
    if (!ROTULOS_DE_DINHEIRO.test(trecho)) continue
    const rotulo = trecho.match(ROTULOS_DE_DINHEIRO)?.[1] ?? chave
    ok(
      /permissao:\s*"financeiro\.ver"/.test(trecho),
      `${arquivo} · coluna "${chave}" (${rotulo}) sob "${permissaoDoDominio}" declara permissao: "financeiro.ver"`,
    )
  }
}

// O motor precisa CONTINUAR honrando a declaração — não basta declarar.
const motor = readFileSync(join(RAIZ, "src/lib/relatorios/motor/executar.ts"), "utf8")
ok(/chavesProibidas/.test(motor), "o motor calcula as colunas proibidas")
ok(/chavesProibidas\.has\(k\)/.test(motor), "coluna proibida é removida do resultado")
ok(/chavesProibidas\.has\(def\.key\)/.test(motor), "filtro sobre coluna proibida é ignorado")
ok(/chavesProibidas\.has\(spec\.ordenarPor/.test(motor), "ordenação por coluna proibida é ignorada")
ok(/chavesProibidas\.has\(spec\.agruparPor\)/.test(motor), "agrupamento por coluna proibida é ignorado")

const exportador = readFileSync(join(RAIZ, "src/lib/relatorios/motor/exportar.ts"), "utf8")
ok(/pode\?:/.test(exportador) && /executar\([^)]*pode\)/.test(exportador.replace(/\n/g, " ")),
  "a exportação repassa a permissão — não é porta larga")

for (const rota of ["consultar", "exportar"]) {
  const fonte = readFileSync(join(RAIZ, `src/app/api/relatorios/${rota}/route.ts`), "utf8")
  ok(/extrairUsuarioComPermissoes/.test(fonte), `a rota /${rota} extrai as permissões do usuário`)
}

console.log(`\n${passou} passaram, ${falhou} falharam`)
if (falhou > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("\nCOLUNA RESTRITA ✅")
