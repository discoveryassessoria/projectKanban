/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — VALIDADE É ESTADO, NÃO DATA.
 * Rodar: npm run test:guard-validade   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA
 * ═══════════════════════════════════════════════════════════════════════════
 * Todo CADASTRO/CONFIGURAÇÃO do Discovery vale por tempo INDETERMINADO. Nasce
 * válido e continua válido até alguém inativar, arquivar ou excluir.
 *
 *   ATIVO    → vale
 *   INATIVO  → não entra em operação nova
 *   EXCLUÍDO → sai, conforme o ciclo de vida do domínio
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE GUARD **NÃO** PROÍBE
 * ═══════════════════════════════════════════════════════════════════════════
 * DATA DE FATO. Vencimento, pagamento, recebimento, protocolo, emissão,
 * nascimento, casamento, óbito, competência contábil — tudo isso é fato, tem
 * data real e continua tendo. A proibição é de VIGÊNCIA ARTIFICIAL: janela
 * temporal usada como critério de validade de PARAMETRIZAÇÃO.
 *
 * A diferença em uma frase: fato responde "quando aconteceu"; vigência artificial
 * respondia "se este cadastro conta agora" — e essa pergunta passa a ser do status.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * A vigência era parametrização genérica que ninguém preenchia com intenção — e
 * que escondia cadastro correto de quem o procurava, sem erro e sem aviso.
 *
 * Ela também virava desempate escondido: duas linhas de preço no mesmo contexto
 * comercial não conflitavam se as janelas não se cruzassem, o que permitia "duas
 * verdades em revezamento". E entrava na CHAVE DE IDENTIDADE da taxa, fazendo
 * duas taxas idênticas conviverem como duplicata legítima por começarem em dias
 * diferentes.
 */
import { readdirSync, statSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ESTE = "scripts/guard-validade-por-estado.test.ts"
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const IGNORAR = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", "tmp", "capturas", "public", "_tmp", "migrations", "baseline"])
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
const runtime = arquivos.filter((f) => f.startsWith("src/") || f.startsWith("lib/"))

console.log("GUARD — VALIDADE É ESTADO, NÃO DATA\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) Nenhum resolvedor decide validade por data")
// ═══════════════════════════════════════════════════════════════════════════
// O padrão que morreu: comparar "agora" com uma janela do CADASTRO.
// Só COMPARAÇÃO conta. Declarar o campo, selecioná-lo ou mapeá-lo é legítimo —
// as colunas seguem no schema para o histórico já gravado. O que não pode voltar
// é "agora" sendo confrontado com a janela do cadastro, na MESMA linha.
// `=>` de arrow function NÃO é comparação — exigir que o `>` não venha depois de
// `=` evita acusar um `.catch(() => [])` que passa perto de um `select`.
const OP = "(?<![=!<>])(?:<=?|>=?)(?!=)"
const CAMPO = "\\bvig(?:encia(?:Inicio|Fim)|enteDe|enteAte)\\b"
const COMPARA_VIGENCIA = new RegExp(
  `^(?!\\s*(?://|\\*)).*(?:${CAMPO}[^\\n]{0,60}${OP}|${OP}[^\\n]{0,60}${CAMPO})[^\\n]*$`,
  "m",
)
const decidemPorData = runtime.filter((f) => COMPARA_VIGENCIA.test(conteudo.get(f)!))
ok("nenhum arquivo de runtime compara data contra vigência de cadastro",
  decidemPorData.length === 0, decidemPorData.join(", ") || `${runtime.length} arquivos varridos`)

const SEM_FILTRO: Array<[string, string]> = [
  ["preço", "src/lib/motor/resolver-preco-financeiro.ts"],
  ["taxa", "lib/financeiro/taxas-pagamento.ts"],
  ["condição de pagamento", "lib/financeiro/condicao-pagamento.ts"],
  ["regra documental", "src/lib/documentos/regras-documentais/avaliador.ts"],
]
// O resolvedor pode CARREGAR o campo (o tipo ainda existe); o que ele não pode
// é usá-lo para decidir. A prova é a ausência de comparação e de motivo de
// descarte temporal.
for (const [rotulo, arq] of SEM_FILTRO) {
  const src = ler(arq)
  ok(`o resolvedor de ${rotulo} não decide por vigência`,
    !COMPARA_VIGENCIA.test(src) && !/fora_de_vigencia|ainda não vigente|fora de vigência/.test(src))
}
ok("o resolvedor de preço já não conhece `dentroDaVigencia`",
  !/dentroDaVigencia/.test(ler("src/lib/motor/resolver-preco-financeiro.ts")))
ok("a validade da regra documental é o STATUS",
  /status !== "PUBLICADA"/.test(ler("src/lib/documentos/regras-documentais/avaliador.ts")))

// ═══════════════════════════════════════════════════════════════════════════
secao("2) Vigência não é desempate escondido nem identidade")
// ═══════════════════════════════════════════════════════════════════════════
ok("conflito de preço não usa sobreposição de janelas",
  !/vigenciaSobrepoe/.test(ler("lib/financeiro/conflito-preco.ts")),
  "janela que não se cruza separava duas verdades no mesmo contexto comercial")
const corpoChave = (() => {
  const src = ler("lib/financeiro/taxa-identidade.ts")
  const i = src.indexOf("export function chaveUnicidade")
  return i < 0 ? "" : src.slice(i, src.indexOf("\n}", i))
})()
ok("a identidade da taxa não inclui vigência", !/vigencia/i.test(corpoChave), corpoChave.split("\n").pop() ?? "")

// ═══════════════════════════════════════════════════════════════════════════
secao("3) A interface não pede nem mostra vigência de cadastro")
// ═══════════════════════════════════════════════════════════════════════════
const TELAS = [
  "src/components/gerenciamentoComponents/TabelaValoresTab.tsx",
  "src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx",
]
const ROTULOS = /Válido a partir|Válido até|Válida a partir|Válida até|vigência indeterminada/
for (const t of TELAS) {
  const src = ler(t).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "")
  ok(`${t.split("/").pop()} não tem campo de vigência`, !ROTULOS.test(src))
  ok(`${t.split("/").pop()} não envia vigência no formulário`, !/set\('vigencia/.test(src))
}
ok("a listagem da Tabela de Preços não tem coluna Vigência",
  !/'Vigência'/.test(ler("src/components/gerenciamentoComponents/TabelaValoresTab.tsx")))

// ═══════════════════════════════════════════════════════════════════════════
secao("4) As rotas não exigem nem gravam vigência")
// ═══════════════════════════════════════════════════════════════════════════
const ROTAS = [
  "src/app/api/gerenciamento/tabela-valores/route.ts",
  "src/app/api/gerenciamento/tabela-valores/[id]/route.ts",
]
for (const r of ROTAS) {
  const src = ler(r)
  const nome = r.split("/").slice(-2).join("/")
  ok(`${nome} não exige vigência`, !/Informe "Válido a partir de"|Vigência deve estar no formato/.test(src))
  ok(`${nome} não lê vigência do corpo da requisição`, !/b\.vigencia(Inicio|Fim)/.test(src))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("5) DATA DE FATO permanece intocada")
// ═══════════════════════════════════════════════════════════════════════════
// A regra removeu vigência de CADASTRO. Fato tem data e continua tendo — se
// algum destes sumir, a remoção passou do ponto.
const schema = ler("prisma/schema.prisma")
const FATOS: Array<[string, RegExp]> = [
  ["vencimento de obrigação", /vencimento\s+DateTime/],
  ["data de pagamento/ocorrência", /\bdata\s+DateTime/],
  ["competência contábil", /dataCompetencia\s+DateTime/],
  ["data de registro documental", /data_registro\s+DateTime/],
  ["data de nascimento", /data_nasc\s+DateTime/],
  ["data de óbito", /data_obito\s+DateTime/],
  ["parcela: vencimento", /model ParcelaFinanceira[\s\S]{0,1200}vencimento/],
]
for (const [rotulo, re] of FATOS) ok(`fato preservado: ${rotulo}`, re.test(schema))
ok("a versão do Modelo Documental mantém o carimbo de quando vigorou",
  /vigenteDe\s+DateTime\?/.test(schema),
  "é fato histórico (escrito junto com PUBLICADA/REVOGADA), nunca lido para decidir validade")

// ═══════════════════════════════════════════════════════════════════════════
secao("6) Não nasce vigência nova em cadastro")
// ═══════════════════════════════════════════════════════════════════════════
// Modelos que hoje ainda carregam as colunas, só para o histórico já gravado.
const HERDADOS = new Set(["TabelaValor", "CondicaoPagamento", "TaxaPagamento", "Adquirente", "MatrizDocumental"])
const comVigencia = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
  .filter((m) => /^\s+(vigenciaInicio|validFrom|validUntil|effectiveFrom|effectiveTo)\b/m.test(m[2]))
  .map((m) => m[1])
const novos = comVigencia.filter((m) => !HERDADOS.has(m))
ok("nenhum modelo NOVO introduziu vigência de cadastro",
  novos.length === 0,
  novos.join(", ") || `${comVigencia.length} modelo(s) herdado(s), nenhum novo`)
ok("as colunas herdadas são nullable (nada novo as preenche)",
  !/vigenciaInicio\s+(String|DateTime)\s+@/.test(schema) || /vigenciaInicio\s+(String|DateTime)\?/.test(schema))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  console.log("\nA regra: cadastro vale até inativação ou exclusão. Data é para fato.")
  process.exit(1)
}
console.log("Cadastro vale por tempo indeterminado; data continua sendo coisa de fato.\n")
