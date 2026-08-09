/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — A PLANILHA DOCUMENTAL É PROJEÇÃO.
 * Rodar: npm run test:guard-planilha   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA
 * ═══════════════════════════════════════════════════════════════════════════
 * A Planilha não é fonte de nada. Ela organiza o que outros domínios já sabem:
 *
 *   colunas  → Cadastro Mestre (ProdutoFinanceiro / TipoDocumentoCadastro), por ID
 *   linhas   → Árvore (pessoas ATIVAS) + Documento
 *   aplica?  → resolverElegibilidadeDocumental (Matriz + Regra Econômica)
 *   quanto?  → resolverPrecoPorConfigDB (Tabela de Preços)
 *   fato     → ObrigacaoEconomica (valor congelado no lançamento)
 *
 * PROIBIDO: cadastro de serviço próprio, preço próprio, coluna escrita no
 * código, segunda tabela de valores.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * A versão de 28/07 criava seis `TipoServico` de nomes fixos DENTRO de um GET —
 * ler a planilha escrevia no banco. A seguinte trocou isso por derivar coluna
 * casando `PhaseEconomicRule.componentName` com `TipoServico.nome`, por igualdade
 * de TEXTO: renomear o serviço no cadastro apagava a coluna, sem erro.
 *
 * E enquanto a célula só sabia somar obrigação lançada, documento sem lançamento
 * mostrava R$ 0,00 — dizendo "custa zero" quando queria dizer "ainda não sei".
 */
import { readdirSync, statSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ESTE = "scripts/guard-planilha-documental.test.ts"
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const PROJECAO = "lib/financeiro/leitura/planilha-documental.ts"
const COLUNAS = "lib/financeiro/leitura/planilha-colunas.ts"
const ROTA = "src/app/api/processos/[processoId]/custos/route.ts"
const VIEW = "src/components/financeiro/v3/PlanilhaDocumentalView.tsx"
const EDITOR = "src/components/financeiro/v3/ConfiguracaoPlanilhaDocumental.tsx"

const projecao = ler(PROJECAO)
const colunas = ler(COLUNAS)
const rota = ler(ROTA)
const view = ler(VIEW)
const editor = ler(EDITOR)
const schema = ler("prisma/schema.prisma")

const IGNORAR = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", "tmp", "capturas", "public", "_tmp"])
const arquivos: string[] = []
;(function varrer(dir: string) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) varrer(caminho)
    else if (/\.(tsx?|mjs)$/.test(nome)) arquivos.push(relative(RAIZ, caminho).replace(/\\/g, "/"))
  }
})(RAIZ)
const conteudo = new Map(arquivos.map((f) => [f, readFileSync(join(RAIZ, f), "utf8")]))

console.log("GUARD — A PLANILHA DOCUMENTAL É PROJEÇÃO\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) Ler a planilha NUNCA escreve")
// ═══════════════════════════════════════════════════════════════════════════
const ESCRITA = /\b(prisma|tx)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/
ok("a projeção não escreve nada", !ESCRITA.test(projecao))
const corpoGet = rota.slice(rota.indexOf("export async function GET"), rota.indexOf("export async function POST"))
ok("o GET da planilha não escreve nada", !ESCRITA.test(corpoGet))
ok("o GET tem gate de permissão financeira", /verificarPermissao\(request, 'financeiro\.ver'\)/.test(corpoGet))

// ═══════════════════════════════════════════════════════════════════════════
secao("2) Nenhuma coluna e nenhum preço escritos no código")
// ═══════════════════════════════════════════════════════════════════════════
const NOMES_DE_SERVICO = /["'](Certidão Inteiro Teor|Desmaterialização|Apostilamento[^"']*|Tradução Juramentada)["']/
for (const [rotulo, src] of [["a projeção", projecao], ["a grade", view], ["o editor", editor]] as const) {
  ok(`${rotulo} não tem nome de serviço escrito no código`, !NOMES_DE_SERVICO.test(src))
}
const DINHEIRO = /\b\d+[.,]\d{2}\b/
ok("a projeção não tem valor monetário escrito no código",
  !DINHEIRO.test(projecao.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")))
// A frase "o valor vem da Tabela de Preços" é PROSA na tela e é bem-vinda. O que
// não pode existir é CAMPO: input, estado ou payload de preço no editor.
ok("o editor de colunas não tem campo de preço",
  !/(useState[^\n]*\b(valor|preco|preço|moeda|fornecedor))|(<input[^>]*\b(valor|preco|preço|moeda))|(body:[^\n]*\b(valor|preco|preço|moeda))/i.test(editor))

// ═══════════════════════════════════════════════════════════════════════════
secao("3) A coluna é ÂNCORA POR ID no cadastro canônico")
// ═══════════════════════════════════════════════════════════════════════════
ok("existe a entidade de configuração de coluna", /model PlanilhaDocumentalColuna \{/.test(schema))
const modelo = schema.slice(schema.indexOf("model PlanilhaDocumentalColuna {"))
const corpoModelo = modelo.slice(0, modelo.indexOf("\n}"))
ok("a coluna referencia ProdutoFinanceiro por FK", /configId\s+Int\?\s+@unique/.test(corpoModelo) && /ProdutoFinanceiro\?/.test(corpoModelo))
ok("a coluna referencia TipoDocumentoCadastro por FK", /tipoDocumentoId\s+Int\?\s+@unique/.test(corpoModelo) && /TipoDocumentoCadastro\?/.test(corpoModelo))
ok("a coluna NÃO guarda preço, moeda, fornecedor nem vigência",
  !/valor|preco|preço|moeda|fornecedor|vigencia|vigência/i.test(corpoModelo.replace(/\/\/[^\n]*/g, "")))
ok("a ordenação é por POSIÇÃO, nunca por nome", /posicao\s+Int/.test(corpoModelo) && /orderBy: \[\{ posicao: 'asc' \}/.test(colunas))
ok("um item do cadastro vira UMA coluna (unicidade no banco)",
  /@unique/.test(corpoModelo.split("configId")[1]?.slice(0, 40) ?? ""))
ok("inativar não apaga: existe o campo `ativa`", /ativa\s+Boolean/.test(corpoModelo))

// A morte da régua por NOME.
ok("a projeção não casa coluna por nome de serviço",
  !/tipoServico\.findMany[\s\S]{0,200}nome: \{ in:/.test(projecao),
  "casar `componentName` com `TipoServico.nome` fazia renomear apagar a coluna")

// ═══════════════════════════════════════════════════════════════════════════
secao("4) Valor vem dos resolvedores OFICIAIS — nenhum cálculo próprio")
// ═══════════════════════════════════════════════════════════════════════════
ok("a aplicabilidade vem do resolvedor oficial", /resolverElegibilidadeDocumental\(/.test(projecao))
ok("o preço vem do resolvedor oficial", /resolverPrecoPorConfigDB\(/.test(projecao))
ok("a planilha de CUSTOS pede natureza CUSTO", /NaturezaPreco\.CUSTO/.test(projecao))
ok("a planilha de custos NÃO pede preço de VENDA", !/NaturezaPreco\.VENDA/.test(projecao))
ok("a projeção não lê TabelaValor por conta própria", !/tabelaValor\.(findMany|findFirst)/.test(projecao),
  "preço tem um resolvedor; consultar a tabela aqui seria a segunda régua")

// ═══════════════════════════════════════════════════════════════════════════
secao("5) A célula tem ESTADO — 0,00 não significa 'não sei'")
// ═══════════════════════════════════════════════════════════════════════════
for (const estado of ["NAO_APLICAVEL", "SEM_PRECO", "PREVISTO", "REALIZADO"]) {
  ok(`o estado ${estado} existe na projeção`, projecao.includes(estado))
}
ok("célula sem valor devolve null, não zero", /valor: null, valorBrl: null/.test(projecao))
ok("a grade distingue os estados em vez de imprimir número sempre", /estado === "SEM_PRECO"/.test(view) && /NAO_APLICAVEL/.test(view))
ok("realizado tem precedência sobre previsto (o fato manda)",
  projecao.indexOf("if (obrs.length > 0)") < projecao.indexOf("if (!aplica)"))
ok("o valor REALIZADO vem da obrigação, não da tabela",
  /estado: 'REALIZADO'[\s\S]{0,400}o\.valorContratado/.test(projecao))

// ═══════════════════════════════════════════════════════════════════════════
secao("6) Dinheiro em centavos — nunca soma em float")
// ═══════════════════════════════════════════════════════════════════════════
ok("a projeção acumula em centavos inteiros", /paraCentavos/.test(projecao) && /paraReais/.test(projecao))
ok("os totais saem de acumuladores em centavos", /totalGeralCent|previstoCent|realizadoCent/.test(projecao))

// ═══════════════════════════════════════════════════════════════════════════
secao("7) Linhas seguem a Árvore — sem resíduo, sem quem nunca entrou")
// ═══════════════════════════════════════════════════════════════════════════
ok("as pessoas vêm do recorte canônico de ativos", /pessoasAtivasDaArvore\(/.test(projecao),
  "pessoa removida não deixa bloco órfão; requerente fora da árvore não vira linha")

// ═══════════════════════════════════════════════════════════════════════════
secao("8) A célula é explicável")
// ═══════════════════════════════════════════════════════════════════════════
ok("toda célula carrega explicação", /explicacao:/.test(projecao))
ok("a explicação diz a origem do valor", /'Tabela de Preços'/.test(projecao) && /congelado/.test(projecao))
ok("a explicação diz POR QUE não há valor", /motivo:/.test(projecao))
ok("a grade expõe a explicação ao usuário", /title=\{titulo\}/.test(view))

// ═══════════════════════════════════════════════════════════════════════════
secao("9) A configuração é GLOBAL — não fragmenta por processo")
// ═══════════════════════════════════════════════════════════════════════════
ok("a entidade de coluna não tem processoId", !/processoId/.test(corpoModelo))
const rotasConfig = arquivos.filter((f) => f.includes("api/financeiro/planilha-colunas") && f.endsWith("route.ts"))
ok("existe a rota global de configuração", rotasConfig.length >= 1, rotasConfig.join(", "))
for (const r of rotasConfig) {
  const src = conteudo.get(r)!
  ok(`${r.replace("src/app/api/", "")} exige permissão`, /verificarPermissao\(/.test(src))
  ok(`${r.replace("src/app/api/", "")} não toca em preço`, !/tabelaValor|produtoFinanceiro\.(create|update)/.test(src))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("10) Nenhuma segunda fonte financeira")
// ═══════════════════════════════════════════════════════════════════════════
ok("o módulo de colunas não cria serviço nem documento",
  !/produtoFinanceiro\.create|tipoDocumentoCadastro\.create|tipoServico\.create/.test(colunas))
ok("o módulo de colunas exige que o item JÁ exista no cadastro",
  /não existe no cadastro/.test(colunas))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  console.log("\nA regra: a planilha projeta o domínio. Coluna vem do cadastro, valor vem da Tabela de Preços.")
  process.exit(1)
}
console.log("Colunas do cadastro, valores da Tabela de Preços, zero segunda fonte.\n")
