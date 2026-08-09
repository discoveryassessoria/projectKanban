/**
 * TABELA DE PREÇOS — uma linha por cadastro mestre. Não precisa de banco.
 * Rodar: npm run test:tabela-precos-projecao
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ISTO TRAVA
 * ═══════════════════════════════════════════════════════════════════════════
 * A listagem renderizava REGISTRO DE PREÇO, e o banco guarda um registro por
 * natureza. Um item com custo e venda aparecia duas vezes:
 *
 *   Certidão de Nascimento - Inteiro Teor   Papel: Custo    R$ 146,24
 *   Certidão de Nascimento - Inteiro Teor   Papel: Venda    R$ 153,24
 *
 * Lido como dois itens. CUSTO e VENDA são DIMENSÕES do MESMO cadastro.
 * A correção é de projeção — o banco continua granular, porque é dessa
 * granularidade que o motor de preços precisa.
 */
import { agruparPorCadastroMestre, contarCadastros, type RegistroPreco } from "../lib/financeiro/leitura/tabela-precos-projecao"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

let seq = 100
const reg = (p: Partial<RegistroPreco> & { configuracaoFinanceiraItemId: number | null; natureza: string | null }): RegistroPreco => ({
  id: p.id ?? seq++, valor: p.valor ?? 100, moeda: p.moeda ?? "BRL",
  modoCalculo: p.modoCalculo ?? "fixed", fornecedor: p.fornecedor ?? null, arquivado: p.arquivado ?? false,
  ...p,
})

console.log("TABELA DE PREÇOS — projeção por cadastro mestre\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1–3) Um cadastro, uma linha — tenha ele custo, venda ou os dois")
// ═══════════════════════════════════════════════════════════════════════════
{
  const l = agruparPorCadastroMestre([
    reg({ id: 143, configuracaoFinanceiraItemId: 182, natureza: "CUSTO", valor: 146.24, fornecedor: { id: 15, nome: "CRC" } }),
    reg({ id: 144, configuracaoFinanceiraItemId: 182, natureza: "VENDA", valor: 153.24 }),
  ])
  ok("1: item com Custo + Venda → 1 linha", l.length === 1, `${l.length}`)
  ok("1: custo e venda na MESMA linha", l[0].custo?.registro.id === 143 && l[0].venda?.registro.id === 144)
  ok("1: a chave é o id canônico da Configuração Financeira", l[0].configId === 182)
}
{
  const l = agruparPorCadastroMestre([reg({ configuracaoFinanceiraItemId: 63, natureza: "CUSTO", valor: 10 })])
  ok("2: só Custo → 1 linha, venda vazia", l.length === 1 && l[0].custo != null && l[0].venda === null)
}
{
  const l = agruparPorCadastroMestre([reg({ configuracaoFinanceiraItemId: 57, natureza: "VENDA", valor: 6800 })])
  ok("3: só Venda → 1 linha, custo vazio", l.length === 1 && l[0].venda != null && l[0].custo === null)
}
{
  const l = agruparPorCadastroMestre([reg({ configuracaoFinanceiraItemId: 90, natureza: "RECEITA", valor: 5 })])
  ok("RECEITA é o nome legado de VENDA — mesma coluna", l[0].venda?.registro.id != null && l[0].custo === null)
}

// ═══════════════════════════════════════════════════════════════════════════
secao("4–5) Diferença entre as dimensões NÃO duplica a linha")
// ═══════════════════════════════════════════════════════════════════════════
{
  const l = agruparPorCadastroMestre([
    reg({ configuracaoFinanceiraItemId: 182, natureza: "CUSTO", fornecedor: { id: 15, nome: "CRC", publicCode: "FOR-15" } }),
    reg({ configuracaoFinanceiraItemId: 182, natureza: "VENDA", fornecedor: null }),
  ])
  ok("4: fornecedor diferente entre custo e venda → continua 1 linha", l.length === 1)
  ok("4: cada dimensão carrega o SEU fornecedor",
    l[0].custo?.fornecedor === "CRC" && l[0].venda?.fornecedor === null,
    `${l[0].custo?.fornecedor} / ${l[0].venda?.fornecedor}`)
  // 3/4: o código do fornecedor identifica o FORNECEDOR, não o item — e não
  // pode competir com o código canônico do cadastro mestre na primeira coluna.
  ok("3·4: FOR-n não aparece na célula de custo", !/FOR-/.test(l[0].custo?.fornecedor ?? ""))
}
{
  const l = agruparPorCadastroMestre([
    reg({ configuracaoFinanceiraItemId: 182, natureza: "CUSTO", modoCalculo: "fixed" }),
    reg({ configuracaoFinanceiraItemId: 182, natureza: "VENDA", modoCalculo: "first_additional", valorBase: 100, valorAdicional: 40 }),
  ])
  ok("5: estratégias diferentes → continua 1 linha", l.length === 1)
  ok("5: cada dimensão mantém a sua estratégia",
    l[0].custo?.registro.modoCalculo === "fixed" && l[0].venda?.registro.modoCalculo === "first_additional")
}

// ═══════════════════════════════════════════════════════════════════════════
secao("1–2·5·10) O código é o do MESTRE, e a tela o lê da origem")
// ═══════════════════════════════════════════════════════════════════════════
{
  const tv = readFileSyncSafe("src/components/gerenciamentoComponents/TabelaValoresTab.tsx")
  ok("1: documento lê o código do Cadastro Mestre Documental",
    /cfg\.tipoDocumento\.publicCode/.test(tv) && /doc\.publicCode/.test(tv))
  ok("2: serviço lê o código do Catálogo de Serviços", /srv\.publicCode/.test(tv))
  ok("5·10: NÃO usa o código da Configuração Financeira como identidade",
    !/codigo:\s*cfg\.publicCode/.test(tv), "cfg.publicCode identifica a config, não o mestre")
  ok("a coluna Código é a PRIMEIRA da tabela", /\['Código', 'Cadastro mestre', 'Origem', 'Custo', 'Venda', 'Status', ''\]/.test(tv))
  ok("6·7: a busca aceita o código canônico", /\$\{om\.codigo \?\? ''\}/.test(tv))
  ok("9: nenhum código é gerado na Tabela de Preços",
    !/DOC\$\{|SRV-\$\{|`DOC|`SRV-/.test(tv), "código vem do cadastro, nunca é calculado aqui")
}

// ═══════════════════════════════════════════════════════════════════════════
secao("ORIGEM) O rótulo é o TIPO CANÔNICO da entidade mestre resolvida")
// ═══════════════════════════════════════════════════════════════════════════
// As configs 182/183 chegam ao mestre pelo PIVÔ (`itemCatalogo`), com
// `tipoDocumentoId` nulo. A origem olhava só o vínculo direto e caía em "Item":
// código certo (DOC1), semântica errada.
{
  const tv = readFileSyncSafe("src/components/gerenciamentoComponents/TabelaValoresTab.tsx")
  ok("1·2·10: documento alcançado pelo pivô é DOCUMENTO, não 'Item'",
    /const doc = cfg\.itemCatalogo\?\.tiposDocumento\?\.\[0\][\s\S]{0,140}tipo: 'DOCUMENTO'/.test(tv))
  ok("3·4: serviço alcançado pelo pivô é SERVICO",
    /const srv = cfg\.itemCatalogo\?\.servicos\?\.\[0\][\s\S]{0,140}tipo: 'SERVICO'/.test(tv))
  ok("10: 'Item' deixou de ser rótulo de origem", !/'Item'/.test(tv))
  ok("origem e código saem da MESMA resolução do mestre",
    /function resolverMestre/.test(tv) && /const m = resolverMestre\(cfg\)/.test(tv),
    "eram duas derivações da mesma cadeia; só uma estava completa")
  ok("o tipo NÃO é inferido por nome nem por prefixo do código",
    !/startsWith\(['"]DOC|startsWith\(['"]SRV|includes\(['"]DOC/.test(tv))
  ok("5: o fornecedor não participa da resolução da origem",
    !/resolverMestre[\s\S]{0,700}fornecedor/.test(tv))
  ok("sem tipo resolvido a tela diz '—', não uma categoria inventada",
    /origem: m\.tipo \? ROTULO_ORIGEM\[m\.tipo\] : '—'/.test(tv))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("6–7) Busca e contagem enxergam o CADASTRO, não o registro")
// ═══════════════════════════════════════════════════════════════════════════
{
  const base = [
    reg({ configuracaoFinanceiraItemId: 182, natureza: "CUSTO" }),
    reg({ configuracaoFinanceiraItemId: 182, natureza: "VENDA" }),
    reg({ configuracaoFinanceiraItemId: 183, natureza: "CUSTO" }),
    reg({ configuracaoFinanceiraItemId: 183, natureza: "VENDA" }),
  ]
  ok("6: 4 registros de 2 itens → 2 linhas", agruparPorCadastroMestre(base).length === 2)
  ok("7: a contagem conta cadastros, não registros", contarCadastros(base) === 2, `${contarCadastros(base)}`)
  const so182 = base.filter((r) => r.configuracaoFinanceiraItemId === 182)
  ok("6: busca que casa um item devolve UMA ocorrência", agruparPorCadastroMestre(so182).length === 1)
}

// ═══════════════════════════════════════════════════════════════════════════
secao("8–11) As dimensões são independentes")
// ═══════════════════════════════════════════════════════════════════════════
{
  const custo = reg({ id: 1, configuracaoFinanceiraItemId: 182, natureza: "CUSTO", valor: 146.24 })
  const venda = reg({ id: 2, configuracaoFinanceiraItemId: 182, natureza: "VENDA", valor: 153.24 })
  const l = agruparPorCadastroMestre([custo, venda])[0]
  ok("8/9: cada coluna aponta para o SEU registro — editar uma não alcança a outra",
    l.custo!.registro.id === 1 && l.venda!.registro.id === 2 && l.custo!.registro !== l.venda!.registro)
  const soVenda = agruparPorCadastroMestre([venda])[0]
  ok("10: removido o custo, a venda permanece e o item continua", soVenda.venda?.registro.id === 2 && soVenda.custo === null)
  const soCusto = agruparPorCadastroMestre([custo])[0]
  ok("11: removida a venda, o custo permanece e o item continua", soCusto.custo?.registro.id === 1 && soCusto.venda === null)
}

// ═══════════════════════════════════════════════════════════════════════════
secao("13–15) Sem vigência, sem agrupamento por nome, sem duplicação")
// ═══════════════════════════════════════════════════════════════════════════
{
  const fonte = readFileSyncSafe("lib/financeiro/leitura/tabela-precos-projecao.ts")
  ok("13: a projeção não reintroduz vigência", !/vigencia(Inicio|Fim)/.test(fonte))
  ok("14: agrupa por ID, nunca por nome/rótulo",
    /configuracaoFinanceiraItemId/.test(fonte) && !/\.nome\s*===|groupBy\(.*nome|by: *['"]nome/.test(fonte))
}
{
  // Homônimos com configs diferentes: NÃO podem colapsar.
  const l = agruparPorCadastroMestre([
    reg({ configuracaoFinanceiraItemId: 1, natureza: "CUSTO" }),
    reg({ configuracaoFinanceiraItemId: 2, natureza: "CUSTO" }),
  ])
  ok("14: mesmo rótulo com configs distintas continua sendo dois itens", l.length === 2)
}
{
  // Registro sem mestre não some da tela: vira a sua própria linha.
  const l = agruparPorCadastroMestre([reg({ id: 9, configuracaoFinanceiraItemId: null, natureza: "CUSTO" })])
  ok("15: registro sem cadastro mestre aparece sozinho, não é escondido", l.length === 1 && l[0].custo?.registro.id === 9)
}
{
  // Dois registros da MESMA natureza no mesmo item: um ocupa a coluna, o outro
  // é declarado — nenhuma linha do banco desaparece da tela.
  const l = agruparPorCadastroMestre([
    reg({ id: 1, configuracaoFinanceiraItemId: 182, natureza: "CUSTO" }),
    reg({ id: 2, configuracaoFinanceiraItemId: 182, natureza: "CUSTO" }),
  ])
  ok("15: natureza repetida não some — vai para `outros`", l.length === 1 && l[0].custo?.registro.id === 1 && l[0].outros.length === 1)
}

// ═══════════════════════════════════════════════════════════════════════════
secao("A ordem de quem chamou é preservada")
// ═══════════════════════════════════════════════════════════════════════════
{
  const l = agruparPorCadastroMestre([
    reg({ configuracaoFinanceiraItemId: 57, natureza: "VENDA" }),
    reg({ configuracaoFinanceiraItemId: 182, natureza: "CUSTO" }),
    reg({ configuracaoFinanceiraItemId: 57, natureza: "CUSTO" }),
  ])
  ok("agrupar não reordena a lista", l.map((x) => x.configId).join(",") === "57,182")
}

function readFileSyncSafe(rel: string): string {
  const { readFileSync } = require("node:fs") as typeof import("node:fs")
  const { fileURLToPath } = require("node:url") as typeof import("node:url")
  const { dirname, join } = require("node:path") as typeof import("node:path")
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8")
}

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log("Um cadastro mestre, uma linha. Custo e venda são colunas dele.\n")
