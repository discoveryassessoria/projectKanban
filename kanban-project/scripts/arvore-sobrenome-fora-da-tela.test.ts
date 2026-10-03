// scripts/arvore-sobrenome-fora-da-tela.test.ts
// ============================================================================
// DIVERGÊNCIA DE NOME/SOBRENOME ENTRE GERAÇÕES NÃO APARECE NA ÁRVORE.
//
// Decisão de produto (02/10/2026): a detecção continua no motor
// (`motor/regras/linhagem.ts`), mas nenhuma tela da árvore a exibe nem a conta —
// aba Operação, resumo do requerente, Próxima ação e contadores. Quem vai
// consumir é a fase Análise Documental, ainda não construída.
//
//   npx tsx scripts/arvore-sobrenome-fora-da-tela.test.ts
// ============================================================================
import { analisarArvore } from "@/src/lib/genealogia/motor/analisar"
import { construirGrafo } from "@/src/lib/genealogia/motor/grafo"
import type { PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import { achadosDoMotor, achadosDoMotorPorPessoa } from "@/src/lib/genealogia/operacional/achados-do-motor"
import { indicadorDeDivergencias, indicadoresDoEscopo } from "@/src/lib/genealogia/operacional/indicadores"
import { projetarIndicadores } from "@/src/lib/genealogia/documental/indicadores"
import { readFileSync } from "node:fs"

let passou = 0, falhou = 0
const ok = (c: boolean, n: string, extra: unknown = "") => {
  const e = extra === "" ? "" : ` — ${JSON.stringify(extra)}`
  if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}${e}`) }
}

// Pai e filho com sobrenomes não equivalentes (divergência real) e outro par com
// grafia foneticamente equivalente (variação).
const PESSOAS: PessoaEntrada[] = [
  { id: 1, nome: "Giuseppe", sobrenome: "Rossi", sexo: "M", pais_nasc: "Itália", data_nasc: "1880-03-02" },
  { id: 2, nome: "Antonio", sobrenome: "Bianchi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1915-06-11", paiId: 1 },
  { id: 3, nome: "Carlos", sobrenome: "Bianqui", sexo: "M", pais_nasc: "Brasil", data_nasc: "1950-01-20", paiId: 2, requerente: "maior" },
]
const UNIOES: UniaoEntrada[] = []
const analise = analisarArvore(PESSOAS, UNIOES, { paisAlvo: "ITALIA", raizId: 3 })
const grafo = construirGrafo(PESSOAS, UNIOES)

console.log("\nO motor continua detectando")
const detectados = analise.insights.filter((i) => i.categoria === "sobrenome")
ok(detectados.length >= 1, "o motor ainda produz insight de sobrenome (detecção preservada)", detectados.map((i) => i.id))

console.log("\nNenhuma tela da árvore recebe")
ok(achadosDoMotor(analise).every((a) => !a.id.startsWith("sobrenome-")), "achadosDoMotor (aba Operação, Próxima ação) não traz sobrenome")
const porPessoa = achadosDoMotorPorPessoa(analise)
ok([...porPessoa.values()].flat().every((a) => !a.id.startsWith("sobrenome-")), "achados por pessoa não trazem sobrenome")
ok(indicadorDeDivergencias(analise).itens.every((a) => !a.id.startsWith("sobrenome-")), "contador de divergências não soma sobrenome")
const escopo = indicadoresDoEscopo({ ids: new Set([1, 2, 3]), grafo, analise, projecao: projetarIndicadores([]) })
ok(escopo.divergencias.itens.every((a) => !a.id.startsWith("sobrenome-")), "resumo do requerente não soma sobrenome")
const diag = readFileSync("src/lib/genealogia/operacional/diagnostico.ts", "utf8")
ok(/achadosDoMotor\(analise, noEscopo\)/.test(diag) && !/"sobrenome"/.test(diag.replace(/\/\/.*$/gm, "")), "Próxima ação lê só de achadosDoMotor (que já exclui sobrenome)")
const dossie = readFileSync("src/lib/genealogia/operacional/dossie.ts", "utf8")
ok(!/CATEGORIAS_DIVERGENCIA = new Set<CategoriaInsight>\([^)]*sobrenome/.test(dossie), "dossiê (selo do cartão, mapa de Saúde) não conta sobrenome")

console.log(`\n${passou + falhou} verificações · ${falhou === 0 ? "OK ✅" : "FALHOU ❌"}`)
process.exit(falhou === 0 ? 0 : 1)
