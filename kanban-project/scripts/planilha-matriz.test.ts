// scripts/planilha-matriz.test.ts
// ============================================================================
// A MATRIZ — registro civil na LINHA, etapa na COLUNA, item canônico na célula.
// Rodar: npm run test:planilha-matriz
//
// A parte pura (resolução da interseção) roda sem banco. A parte de override
// precisa de banco e exige o de TESTE.
// ============================================================================
import { resolverIntersecao, chaveDaCelula, type ColunaMatriz, type ConfigCandidata } from "@/lib/financeiro/leitura/planilha-matriz"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

// ── O CADASTRO DO CENÁRIO, com os mesmos IDs que a produção tem ─────────────
const CAT_REGCIV = 2      // CategoriaServico REGCIV "Registro Civil"
const CAT_OUTRA = 9

// TipoDocumentoCadastro → ItemCatalogo, o vínculo que o Cadastro Mestre declara.
const NASCIMENTO = { tipoDocumentoId: 2, itemCatalogoId: 1 }
const CASAMENTO = { tipoDocumentoId: 3, itemCatalogoId: 2 }
const OBITO = { tipoDocumentoId: 4, itemCatalogoId: 3 }
const SEM_ITEM = { tipoDocumentoId: 8, itemCatalogoId: null }

// ProdutoFinanceiro por item — o índice que a projeção monta numa consulta.
const porItem = new Map<number, ConfigCandidata[]>([
  [1, [{ configId: 182, itemCatalogoId: 1, categoriaItemId: CAT_REGCIV }]],
  [2, [{ configId: 183, itemCatalogoId: 2, categoriaItemId: CAT_REGCIV }]],
  [3, [{ configId: 184, itemCatalogoId: 3, categoriaItemId: CAT_REGCIV }]],
  [38, [{ configId: 62, itemCatalogoId: 38, categoriaItemId: null }]],
])

const CERTIDAO: ColunaMatriz = { id: 1, estrategia: "ITEM_DO_REGISTRO", configId: null, categoriaItemId: CAT_REGCIV }
const TRADUCAO: ColunaMatriz = { id: 2, estrategia: "SERVICO_FIXO", configId: 62, categoriaItemId: null }
const APOST_CERT: ColunaMatriz = { id: 3, estrategia: "SERVICO_FIXO", configId: 63, categoriaItemId: null }
const APOST_TRAD: ColunaMatriz = { id: 4, estrategia: "SERVICO_FIXO", configId: 64, categoriaItemId: null }
const DESMAT: ColunaMatriz = { id: 5, estrategia: "SERVICO_FIXO", configId: 70, categoriaItemId: null }

console.log("MATRIZ DA PLANILHA DOCUMENTAL — registro × etapa\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) Certidão Inteiro Teor é UMA coluna que resolve três itens")
// ═══════════════════════════════════════════════════════════════════════════
// Este é o §50.2 e §50.7: uma coluna, e a linha escolhe o documento.
for (const [rotulo, registro, esperado] of [
  ["Nascimento", NASCIMENTO, 182],
  ["Casamento", CASAMENTO, 183],
  ["Óbito", OBITO, 184],
] as const) {
  const r = resolverIntersecao(CERTIDAO, registro, porItem)
  ok(`${rotulo} × Certidão Inteiro Teor → config ${esperado}`,
    r.tipo === "RESOLVIDO" && r.configId === esperado,
    r.tipo === "RESOLVIDO" ? `config ${r.configId}` : r.tipo)
}
const tresDistintos = new Set(
  [NASCIMENTO, CASAMENTO, OBITO]
    .map((reg) => resolverIntersecao(CERTIDAO, reg, porItem))
    .map((r) => (r.tipo === "RESOLVIDO" ? r.configId : -1)),
)
ok("as três linhas resolvem itens DIFERENTES na mesma coluna", tresDistintos.size === 3, `${tresDistintos.size} itens`)

// ═══════════════════════════════════════════════════════════════════════════
secao("2) Colunas de serviço usam o MESMO item em toda linha")
// ═══════════════════════════════════════════════════════════════════════════
// §11 e §12: tradução é uma coluna, não três. A linha diz sobre o quê incide;
// o serviço é o mesmo.
for (const [rotulo, col, esperado] of [
  ["Tradução juramentada", TRADUCAO, 62],
  ["Apostilamento certidão", APOST_CERT, 63],
  ["Apostilamento Tradução", APOST_TRAD, 64],
  ["Desmaterialização", DESMAT, 70],
] as const) {
  const rs = [NASCIMENTO, CASAMENTO, OBITO].map((reg) => resolverIntersecao(col, reg, porItem))
  ok(`${rotulo}: as três linhas resolvem a mesma config ${esperado}`,
    rs.every((r) => r.tipo === "RESOLVIDO" && r.configId === esperado))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("3) A categoria é o filtro — sem ela a coluna resolveria qualquer coisa")
// ═══════════════════════════════════════════════════════════════════════════
const colOutraCategoria: ColunaMatriz = { id: 6, estrategia: "ITEM_DO_REGISTRO", configId: null, categoriaItemId: CAT_OUTRA }
const fora = resolverIntersecao(colOutraCategoria, NASCIMENTO, porItem)
ok("item existe mas está fora da categoria da coluna → SEM_ITEM",
  fora.tipo === "SEM_ITEM", fora.tipo === "SEM_ITEM" ? fora.motivo : fora.tipo)

const semVinculo = resolverIntersecao(CERTIDAO, SEM_ITEM, porItem)
ok("registro sem item no Cadastro Mestre → SEM_ITEM, com motivo nomeado",
  semVinculo.tipo === "SEM_ITEM" && /Cadastro Mestre/.test(semVinculo.motivo))

// ═══════════════════════════════════════════════════════════════════════════
secao("4) Duas configurações para a mesma célula é AMBIGUIDADE, não soma")
// ═══════════════════════════════════════════════════════════════════════════
// §35: somar silenciosamente daria um número plausível e errado; escolher uma
// esconderia o erro de cadastro. O único resultado honesto é recusar.
const porItemAmbiguo = new Map(porItem)
porItemAmbiguo.set(1, [
  { configId: 182, itemCatalogoId: 1, categoriaItemId: CAT_REGCIV },
  { configId: 999, itemCatalogoId: 1, categoriaItemId: CAT_REGCIV },
])
const amb = resolverIntersecao(CERTIDAO, NASCIMENTO, porItemAmbiguo)
ok("duas candidatas → AMBIGUO", amb.tipo === "AMBIGUO")
ok("a ambiguidade nomeia as candidatas",
  amb.tipo === "AMBIGUO" && amb.candidatos.length === 2 && amb.candidatos.includes(999))
ok("ambiguidade NÃO devolve valor nenhum", amb.tipo === "AMBIGUO" && !("configId" in amb))

// ═══════════════════════════════════════════════════════════════════════════
secao("5) Coluna de serviço sem configuração não inventa item")
// ═══════════════════════════════════════════════════════════════════════════
const quebrada: ColunaMatriz = { id: 7, estrategia: "SERVICO_FIXO", configId: null, categoriaItemId: null }
const r7 = resolverIntersecao(quebrada, NASCIMENTO, porItem)
ok("SERVICO_FIXO sem configId → SEM_ITEM", r7.tipo === "SEM_ITEM")

// ═══════════════════════════════════════════════════════════════════════════
secao("6) A identidade da célula é a interseção inteira, por IDs")
// ═══════════════════════════════════════════════════════════════════════════
const base = { processoId: 513, pessoaId: 2690, tipoDocumentoId: 2, colunaId: 1 }
ok("a chave é estável", chaveDaCelula(base) === chaveDaCelula({ ...base }))
for (const campo of ["processoId", "pessoaId", "tipoDocumentoId", "colunaId"] as const) {
  ok(`mudar ${campo} é outra célula`, chaveDaCelula({ ...base, [campo]: 77 }) !== chaveDaCelula(base))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("7) O eixo não se inverte: a matriz é registro × etapa")
// ═══════════════════════════════════════════════════════════════════════════
// Se a coluna voltasse a ser um documento específico, esta contagem denunciaria:
// 3 registros × 1 coluna de certidão = 3 células COM valor. Com o modelo errado
// (3 colunas de documento) seriam 9 células, 6 delas estruturalmente vazias.
const celulasComItem = [NASCIMENTO, CASAMENTO, OBITO]
  .flatMap((reg) => [CERTIDAO].map((col) => resolverIntersecao(col, reg, porItem)))
  .filter((r) => r.tipo === "RESOLVIDO").length
ok("3 registros × 1 coluna de certidão = 3 células resolvidas", celulasComItem === 3, `${celulasComItem}`)

const colunasErradas: ColunaMatriz[] = [
  { id: 10, estrategia: "SERVICO_FIXO", configId: 182, categoriaItemId: null },
  { id: 11, estrategia: "SERVICO_FIXO", configId: 183, categoriaItemId: null },
  { id: 12, estrategia: "SERVICO_FIXO", configId: 184, categoriaItemId: null },
]
// Com documento-como-coluna toda célula "resolve" — inclusive Casamento ×
// Certidão-de-Nascimento, que é justamente o absurdo que a diagonal escondia.
const comModeloErrado = [NASCIMENTO, CASAMENTO, OBITO]
  .flatMap((reg) => colunasErradas.map((col) => resolverIntersecao(col, reg, porItem)))
  .filter((r) => r.tipo === "RESOLVIDO").length
ok("o modelo antigo produziria 9 células onde a matriz produz 3", comModeloErrado === 9, `${comModeloErrado}`)

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log("Registro é linha, etapa é coluna, a interseção resolve por ID.\n")
