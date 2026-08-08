/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — ESTADO DERIVADO DA ÁRVORE.
 * Rodar: npm run test:guard-derivado   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS DUAS REGRAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. NÃO EXISTE ESTADO DERIVADO ÓRFÃO DEPOIS DE REMOVER ALGUÉM DA ÁRVORE.
 *      Todo efeito que nasce da presença de uma pessoa tem de ter um
 *      reconciliador que o retire quando a última causa válida desaparece.
 *
 *   2. A REMOÇÃO RECONCILIA — NUNCA CASCATEIA ÀS CEGAS ENTRE DOMÍNIOS.
 *      Quem decide QUEM perdeu a causa não é quem apaga: cada domínio retira
 *      os seus próprios efeitos, pelo seu próprio serviço.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * `processarRequerenteAdicionado` transformava a entrada de uma pessoa na
 * árvore em Receita + espelho V3 + Ledger + MotorArtefato. O inverso não
 * existia: nenhum evento `requerente.removido`, nenhum reconciliador, e
 * `reconciliarEconomicoDoProcesso` filtrava `ruleSource: 'matriz'` — o efeito
 * por requerente grava `'automation'` e nunca era visitado.
 *
 * A remoção só alcançava o que estivesse ligado por `Receita.personId`, a
 * coluna que o próprio apagamento zera (`onDelete: SetNull`). Apagar a causa
 * destruía a prova de que houve causa.
 *
 * MEDIDO EM PRODUÇÃO — processo 513 "Abellan", 08/08/2026:
 *   Receita 180 (R$ 2.800) ATIVA, causada pela pessoa 2646 que não existe mais;
 *   Obrigações 16 e 18 (R$ 4.800) ATIVAS, espelhos de Receitas já apagadas;
 *   três artefatos 'active' apontando para linhas mortas.
 * Total: R$ 6.800 somando no Financeiro como "Requerente não identificado".
 *
 * Nenhuma exceção foi lançada. Nenhum log. Só o extrato do cliente.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COMO ESTE TESTE FALHA
 * ═══════════════════════════════════════════════════════════════════════════
 * Se alguém criar um efeito derivado novo por requerente e não ligá-lo ao
 * reconciliador, ou reintroduzir remoção que decide por `personId`, ou apagar
 * tabela de outro domínio direto da reconciliação — reprova aqui, no CI, antes
 * de virar resíduo no Financeiro de um cliente real.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const ciclo = ler("src/services/pessoa-ciclo-vida.ts")
const reconc = ler("src/lib/motor/reconciliar-requerente-economico.ts")
const causa = ler("lib/financeiro/causa-requerente.ts")
const executor = ler("src/lib/motor/executor.ts")
const dualWrite = ler("lib/financeiro/dual-write.ts")
const vinculoAtivo = ler("src/lib/genealogia/vinculo-ativo.ts")

console.log("GUARD — ESTADO DERIVADO DA ÁRVORE\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) A remoção RECONCILIA os três domínios donos")
// Documental, econômico por documento (Matriz) e econômico por requerente. Um
// domínio de fora da lista é um domínio que ninguém reconcilia.
// ═══════════════════════════════════════════════════════════════════════════
const RECONCILIADORES: [string, RegExp][] = [
  ["documental (materialização da árvore)", /dispararMaterializacaoPorArvore\(/],
  ["econômico por documento (Matriz)", /reconciliarEconomicoDoProcesso\(/],
  ["econômico por requerente", /reconciliarAutomacaoPorRequerente\(/],
]
const corpoReconciliar = ciclo.slice(ciclo.indexOf("export async function reconciliarAposRemocao"))
for (const [nome, re] of RECONCILIADORES) {
  ok(`reconciliarAposRemocao chama o reconciliador ${nome}`, re.test(corpoReconciliar))
}
ok("a reconciliação é do SERVIÇO, chamada dentro de removerPessoaDaArvore",
  /if \(resultado\.ok\)[\s\S]{0,120}reconciliarAposRemocao\(/.test(ciclo),
  "duas portas de entrada não podem produzir dois estados finais")

// ═══════════════════════════════════════════════════════════════════════════
secao("2) TODO ruleSource criado a partir de requerente tem reconciliador")
// A regra estrutural: o conjunto que o CRIADOR grava tem de estar contido no
// conjunto que o RECONCILIADOR visita. Foi exatamente essa diferença
// ('automation' criado, só 'matriz' reconciliado) que produziu o resíduo.
// ═══════════════════════════════════════════════════════════════════════════
const corpoCriador = executor.slice(executor.indexOf("export async function processarRequerenteAdicionado"))
const criados = [...corpoCriador.matchAll(/ruleSource:\s*'([^']+)'/g)].map((m) => m[1])
const reconciliados = [...causa.matchAll(/RULE_SOURCE_POR_REQUERENTE\s*=\s*\[([^\]]*)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]))
ok("o criador grava pelo menos um ruleSource", criados.length > 0, criados.join(", "))
ok("todo ruleSource criado está declarado em RULE_SOURCE_POR_REQUERENTE",
  criados.every((r) => reconciliados.includes(r)),
  `criados=[${criados.join(", ")}] reconciliados=[${reconciliados.join(", ")}]`)
ok("nenhum ruleSource é reconciliado sem que alguém o crie (lista não vira depósito)",
  reconciliados.every((r) => criados.includes(r) || r === "automation"),
  reconciliados.join(", "))

// ═══════════════════════════════════════════════════════════════════════════
secao("3) A causa é lida da PROVENIÊNCIA, nunca só da coluna que o delete zera")
// ═══════════════════════════════════════════════════════════════════════════
ok("existe um módulo único que responde 'quem me causou?'",
  /export function pessoaCausadoraDaReceita/.test(causa) && /export function pessoaCausadoraDoArtefato/.test(causa))
ok("a leitura tenta a chave de idempotência ANTES de personId",
  causa.indexOf("pessoaDaChaveIdempotencia(r.chaveIdempotencia)") <
  causa.indexOf("return r.personId ?? null"),
  "personId é SetNull: se vier primeiro, a causa some junto com a pessoa")
// FILTRAR por personId é o defeito original — a coluna já está nula quando se
// procura. LER personId (no `select`) é legítimo: é o último recurso da cadeia
// de proveniência. O guard mira no `where`, não no `select`.
ok("o reconciliador NÃO FILTRA receita por personId",
  !/receita\.findMany\(\{\s*where:\s*\{[^}]*personId/.test(reconc),
  "quem procura o órfão por personId nunca o encontra — a FK já foi zerada")
ok("o reconciliador varre o processo inteiro e decide pela causa",
  /receita\.findMany\(\{\s*\n?\s*where:\s*\{\s*processoId\s*\}/.test(reconc))
ok("o reconciliador usa o módulo de proveniência",
  /pessoaCausadoraDaReceita\(/.test(reconc) && /pessoaCausadoraDoArtefato\(/.test(reconc))

// ═══════════════════════════════════════════════════════════════════════════
secao("4) A reconciliação DELEGA — não apaga tabela de outro domínio")
// ═══════════════════════════════════════════════════════════════════════════
const APAGAR_PROIBIDO = [
  "receita.delete", "receita.deleteMany",
  "obrigacaoEconomica.delete", "obrigacaoEconomica.deleteMany",
  "ledgerEntry.delete", "ledgerEntry.deleteMany",
  "ledgerFinanceiro.delete", "ledgerFinanceiro.deleteMany",
  "receitaRequerente.delete", "receitaRequerente.deleteMany",
  "$executeRaw",
]
for (const alvo of APAGAR_PROIBIDO) {
  ok(`o reconciliador não executa ${alvo}`, !reconc.includes(alvo),
    "quem retira o lançamento é lib/financeiro/acoes/excluir-receita")
}
ok("o reconciliador chama o dono do domínio financeiro",
  /excluirReceita\(/.test(reconc) && /podeExcluir\(/.test(reconc))
ok("a retirada é LÓGICA — o Ledger nunca é apagado pela reconciliação",
  /exclusão lógica|Ledger preservado/i.test(reconc))

// ═══════════════════════════════════════════════════════════════════════════
secao("5) Fato protegido é OUTRA CAUSA VÁLIDA — preserva e relata")
// ═══════════════════════════════════════════════════════════════════════════
ok("existe a decisão PRESERVAR_FATO_PROTEGIDO", /PRESERVAR_FATO_PROTEGIDO/.test(reconc))
ok("sem proveniência não se remove nada", /PRESERVAR_SEM_PROVENIENCIA/.test(reconc))
ok("o relatório diz quantas causas restam", /causasRestantes/.test(reconc))
ok("existe dry-run que não escreve", /dryRun/.test(reconc) && /opts\.dryRun \?\? true/.test(reconc))

// ═══════════════════════════════════════════════════════════════════════════
secao("6) 'Causa válida' tem fonte ÚNICA — criador e reconciliador concordam")
// ═══════════════════════════════════════════════════════════════════════════
ok("o recorte está declarado em vinculo-ativo", /export function requerentesAtivosDaArvore/.test(vinculoAtivo))
ok("o reconciliador usa o recorte oficial", /requerentesAtivosDaArvore\(/.test(reconc))
ok("o reconciliador não redefine 'ativo' por literal próprio",
  !/removidaEm:\s*null/.test(reconc),
  "definir 'ativo' localmente foi o que já trouxe pessoa removida de volta para a operação")

// ═══════════════════════════════════════════════════════════════════════════
secao("7) Reinserção — o artefato encerrado não pode bloquear a recriação")
// ═══════════════════════════════════════════════════════════════════════════
ok("o criador considera o STATUS do artefato, não só a existência",
  /artefatoExistente\?\.status === 'active'/.test(corpoCriador),
  "ignorar o status fazia a reinserção nunca recriar o efeito (automaticKey é @unique)")
ok("o criador REAPROVEITA o artefato encerrado em vez de criar um segundo",
  /motorArtefato\.update\([\s\S]{0,200}status: 'active'/.test(corpoCriador))

// ═══════════════════════════════════════════════════════════════════════════
secao("8) O espelho V3 nasce sabendo de quem é")
// ═══════════════════════════════════════════════════════════════════════════
ok("o dual-write copia a proveniência da Receita para a obrigação",
  /vinculo:[\s\S]{0,300}personId: origem\.personId/.test(dualWrite))
ok("e leva a chave de idempotência junto",
  /chaveIdempotencia: origem\.chaveIdempotencia/.test(dualWrite))

// ═══════════════════════════════════════════════════════════════════════════
secao("9) Nenhuma rota reconcilia por conta própria")
// A reconciliação pertence ao serviço. Rota que chame o reconciliador direto
// recria o defeito de "duas portas, dois estados finais".
// ═══════════════════════════════════════════════════════════════════════════
const AUTORIZADOS = new Set([
  "src/services/pessoa-ciclo-vida.ts",
  "src/lib/motor/reconciliar-requerente-economico.ts",
  "scripts/reconciliar-derivados-requerente.ts",
  "scripts/reconciliacao-derivada-requerente.test.ts",
  "scripts/guard-estado-derivado.test.ts",
])
const IGNORAR = new Set(["node_modules", ".next", ".git", "capturas", "public", "prisma"])
const arquivos: string[] = []
;(function varrer(dir: string) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) varrer(caminho)
    else if (/\.tsx?$/.test(nome)) arquivos.push(caminho)
  }
})(RAIZ)

const infratores = arquivos
  .map((a) => relative(RAIZ, a))
  .filter((rel) => !AUTORIZADOS.has(rel))
  .filter((rel) => /reconciliarAutomacaoPorRequerente\s*\(/.test(readFileSync(join(RAIZ, rel), "utf8")))
ok("só o serviço de ciclo de vida e o comando oficial chamam o reconciliador",
  infratores.length === 0, infratores.join(", ") || "nenhum desvio")

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  console.log("\nA regra: efeito derivado sem reconciliador é resíduo esperando data.")
  process.exit(1)
}
console.log("Nenhum efeito derivado nasce sem quem o retire.\n")
