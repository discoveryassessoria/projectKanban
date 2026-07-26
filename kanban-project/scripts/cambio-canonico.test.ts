/**
 * SERVIÇO CANÔNICO DE CÂMBIO — guarda da política oficial.
 * Rodar: npm run test:cambio-canonico
 *
 * Garante:
 *  1. precedência oficial (BRL → histórico → corrente → ausente);
 *  2. distinção entre cotação corrente (projeção) e snapshot histórico (fato);
 *  3. ausência real nunca vira 1:1, taxa fixa ou zero-como-conversão;
 *  4. arredondamento único;
 *  5. as duas implementações delegam — sem política própria.
 */
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import {
  carregarCotacoesCorrentes, resolverTaxa, converter, somarCanonico, cent,
  type CotacoesCorrentes,
} from "../lib/financeiro/cambio/canonico"
import { converterBrl, somarBrl, type FxFinancas } from "../lib/financeiro/cambio-financas"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (p: string) => readFileSync(join(ROOT, p), "utf8")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const COM_EUR: CotacoesCorrentes = { taxas: { BRL: 1, EUR: 6 }, indisponiveis: [], dataReferencia: "2026-07-26", fonte: "teste" }
const SEM_EUR: CotacoesCorrentes = { taxas: { BRL: 1 }, indisponiveis: ["EUR"], dataReferencia: null, fonte: "teste" }

// ═══════════ 1) PRECEDÊNCIA ═══════════
console.log("\n1) Precedência oficial")
ok(resolverTaxa({ moeda: "BRL", correntes: SEM_EUR }).estado === "BRL", "BRL não converte — estado BRL")
ok(resolverTaxa({ moeda: "BRL", correntes: SEM_EUR }).taxa === 1, "BRL tem taxa 1")
ok(resolverTaxa({ moeda: "EUR", correntes: COM_EUR }).estado === "CORRENTE", "com cotação oficial → CORRENTE")
ok(resolverTaxa({ moeda: "EUR", correntes: SEM_EUR }).estado === "AUSENTE", "sem nada → AUSENTE")
ok(resolverTaxa({ moeda: "EUR", correntes: SEM_EUR }).taxa === null, "AUSENTE não tem taxa")

// ═══════════ 2) FATO CONSOLIDADO × PROJEÇÃO ═══════════
console.log("\n2) Snapshot histórico × cotação corrente")
const hist = { taxa: 5, data: "2026-01-10" }
const fato = resolverTaxa({ moeda: "EUR", correntes: COM_EUR, snapshotHistorico: hist, preferirHistorico: true })
ok(fato.estado === "HISTORICO" && fato.taxa === 5, "fato consolidado usa a taxa congelada, não a de hoje")
ok(fato.dataCotacao != null && fato.dataCotacao.startsWith("2026-01-10"), "data do snapshot histórico é preservada")

const proj = resolverTaxa({ moeda: "EUR", correntes: COM_EUR, snapshotHistorico: hist, preferirHistorico: false })
ok(proj.estado === "CORRENTE" && proj.taxa === 6, "projeção usa a cotação corrente")

const semCorrente = resolverTaxa({ moeda: "EUR", correntes: SEM_EUR, snapshotHistorico: hist, preferirHistorico: false })
ok(semCorrente.estado === "HISTORICO" && semCorrente.taxa === 5, "sem corrente, projeção cai no histórico válido")

const histInvalido = resolverTaxa({ moeda: "EUR", correntes: SEM_EUR, snapshotHistorico: { taxa: 0 }, preferirHistorico: true })
ok(histInvalido.estado === "AUSENTE", "snapshot histórico inválido (0) não é aceito como taxa")

// ═══════════ 3) AUSÊNCIA ═══════════
console.log("\n3) Ausência real")
ok(converter(100, resolverTaxa({ moeda: "EUR", correntes: SEM_EUR })) === null, "ausência devolve null, não 1:1")
ok(converter(100, resolverTaxa({ moeda: "EUR", correntes: COM_EUR })) === 600, "cotação real é aplicada")

const soma = somarCanonico(SEM_EUR, [
  { valor: 100, moeda: "BRL" },
  { valor: 50, moeda: "EUR" },
  { valor: 30, moeda: "EUR", valorBrlCongelado: 180 },
])
ok(soma.total === 280, "total soma só o conversível + BRL congelado")
ok(soma.naoConvertido.length === 1 && soma.naoConvertido[0].valor === 50, "o não convertido é declarado, não silenciado")
ok(!soma.naoConvertido.some((n) => n.valor === 0), "ausência não vira zero dentro do total")

// ═══════════ 4) ARREDONDAMENTO ═══════════
console.log("\n4) Arredondamento único")
ok(cent(10.005) === 10.01 && cent(1 / 3) === 0.33, "cent arredonda em 2 casas")
ok(converter(33.333, { taxa: 3, estado: "CORRENTE", dataCotacao: null }) === 100, "converter aplica cent (33,333 × 3 = 100,00)")
ok(converter(10.001, { taxa: 1, estado: "BRL", dataCotacao: null }) === 10, "conversão é arredondada")

// ═══════════ 5) DELEGAÇÃO ═══════════
console.log("\n5) Delegação — nenhuma política duplicada")
const canonico = ler("lib/financeiro/cambio/canonico.ts")
const financas = ler("lib/financeiro/cambio-financas.ts")
const aging = ler("lib/financeiro/leitura/cambio-aging.ts")

ok(/snapshotCotacoes/.test(canonico), "só o canônico consulta snapshotCotacoes")
ok(!/snapshotCotacoes/.test(financas), "cambio-financas não consulta direto")
ok(!/snapshotCotacoes/.test(aging), "cambio-aging não consulta direto")
ok(/cambio\/canonico/.test(financas) && /cambio\/canonico/.test(aging), "as duas implementações importam o canônico")
ok(!/Math\.round\(\(Number\(v\) \|\| 0\) \* 100\)/.test(financas), "cambio-financas não tem arredondamento próprio")
ok(/cent = centCanonico/.test(aging), "cambio-aging reusa o arredondamento canônico")
ok(/resolverTaxa\(/.test(aging), "computeCambioAging resolve pelo canônico")
ok(/preferirHistorico: true/.test(aging), "fato do processo prefere o snapshot histórico")
ok(!/contratadoBrl = cent\(valorBase\)/.test(aging), "1:1 silencioso eliminado do contratado")
ok(/return cot \? Number\(pc\.valor\) \* cot : 0/.test(aging), "1:1 silencioso eliminado da parcela")
ok(/valorNaoConvertido/.test(aging), "ausência é rastreável no retorno")
ok(typeof carregarCotacoesCorrentes === "function", "carregarCotacoesCorrentes exportada")

// API pública da Etapa 1A preservada
const fx: FxFinancas = { taxas: { BRL: 1 }, indisponiveis: ["EUR"], fonte: "teste", dataReferencia: null }
ok(converterBrl(fx, 100, "EUR") === null, "converterBrl mantém contrato da Etapa 1A")
ok(somarBrl(fx, [{ valor: 10, moeda: "BRL" }]).total === 10, "somarBrl mantém contrato da Etapa 1A")

// ═══════════ 6) PROPAGAÇÃO AOS CONSUMIDORES (Etapa 3) ═══════════
console.log("\n6) Consumidores propagam a ausência")
const consultas = ler("lib/financeiro/leitura/consultas.ts")
const detalhe = ler("lib/financeiro/leitura/receita-detalhe.ts")

ok(/naoConvertido: ca\.valorNaoConvertido/.test(consultas), "listarObrigacoes propaga naoConvertido")
ok(/naoConvertido: number/.test(consultas), "tipo de listarObrigacoes declara naoConvertido")
ok(/naoConvertido: cent\(ca\.valorNaoConvertido/.test(detalhe), "receita-detalhe propaga naoConvertido")
ok(!/cotacaoAplicada \?\? 1/.test(detalhe), "receita-detalhe não tem fallback 1:1")
ok(/const paraBrl = /.test(detalhe), "derivados (desconto/ajuste/juros/multa) usam conversor único")

// ═══════════ 7) APRESENTAÇÃO (Etapa 3) ═══════════
console.log("\n7) UI não exibe R$ 0,00 quando não há cotação")
const shell = ler("src/components/financeiro/v3/ProcessoFinanceiroShell.tsx")
const detalheUI = ler("src/components/financeiro/v3/ReceitaDetalheView.tsx")

const valorBrl = ler("src/components/financeiro/v3/ValorBrl.tsx")
const receitasTab = ler("src/components/financeiro/v3/ReceitasTab.tsx")

ok(/export function ValorBrl/.test(valorBrl), "existe componente único de apresentação")
ok(/não convertido/.test(valorBrl), "o componente rotula o estado ao usuário")
ok(/AvisoNaoConvertido/.test(valorBrl), "existe aviso único para totais incompletos")

ok(/<ValorBrl /.test(shell), "Shell usa o componente compartilhado")
ok(/AvisoNaoConvertido/.test(shell), "Shell usa o aviso compartilhado")
ok(!/\{fmt\(o\.contratadoBrl \?\? 0\)\}/.test(shell), "Shell não renderiza mais BRL cru na linha")
ok(/textoBrlOuOrigem/.test(detalheUI), "Detalhe usa o helper compartilhado")
ok(/<ValorBrl /.test(receitasTab), "ReceitasTab usa o componente compartilhado")
ok(/AvisoNaoConvertido/.test(receitasTab), "ReceitasTab avisa sobre total incompleto")
ok(!/\{brl\(g\.valorContratadoBrlTotal\)\}/.test(receitasTab), "ReceitasTab não renderiza mais BRL cru no grupo")
ok(!/\{brl\(p\.valorContratadoBrl\)\}/.test(receitasTab), "ReceitasTab não renderiza mais BRL cru na linha")

// nenhuma cópia local do padrão
for (const [nome, src] of [["Shell", shell], ["Detalhe", detalheUI], ["ReceitasTab", receitasTab]] as const) {
  ok(!/const BrlOuOrigem = |const brlOuOrigem = /.test(src), `${nome} não tem cópia local do padrão`)
}

// ═══════════ 8) LISTA ≡ DETALHE (último read-model paralelo) ═══════════
console.log("\n8) receitas-lista consolidado")
const lista = ler("lib/financeiro/leitura/receitas-lista.ts")

ok(/computeCambioAging\(/.test(lista), "lista usa computeCambioAging (mesma função do detalhe)")
ok(/cotacoesVivas\(\)/.test(lista), "lista usa as cotações canônicas")
ok(!/snapshotCotacoes/.test(lista), "lista não consulta snapshotCotacoes direto")
ok(!/resolverCambio/.test(lista), "helper de câmbio duplicado foi removido")
ok(!/fxRule === 'FIXO'/.test(lista), "precedência própria eliminada")
ok(!/liveRate/.test(lista), "resolução de taxa própria eliminada")
ok(/naoConvertido: ca\.valorNaoConvertido/.test(lista), "lista propaga a política de ausência")
ok(/naoConvertidoTotal/.test(lista), "totais do grupo declaram o não convertido")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Câmbio canônico: política única validada ✅")
