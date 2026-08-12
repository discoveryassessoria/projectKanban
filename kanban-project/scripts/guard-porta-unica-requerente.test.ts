/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — PORTA ÚNICA DE INSERÇÃO DE REQUERENTE.
 * Rodar: npm run test:guard-porta-requerente   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA
 * ═══════════════════════════════════════════════════════════════════════════
 * Colocar alguém como requerente na árvore é UM ato, com UM dono:
 *   lib/genealogia/vincular-requerente.ts
 *
 * A rota HTTP traduz HTTP. Ela não emite evento de domínio, não dispara
 * materialização e não decide efeito de negócio nenhum.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * Havia duas portas com efeitos diferentes para o mesmo ato:
 *   pela tela   → vínculo + `requerente.adicionado` + materialização (e cobrança)
 *   por serviço → só o vínculo
 * porque a emissão morava na ROTA, depois da chamada ao serviço.
 *
 * Medido em produção: os requerentes 134, 135 e 137 do processo 513 tiveram nó de
 * árvore e NUNCA geraram `MotorArtefato`. As únicas chaves `::req:` do processo
 * são de quem entrou pela tela. Ninguém errou — a porta é que era outra.
 *
 * É o mesmo defeito que a exclusão já tinha tido ("duas portas, dois estados
 * finais"), do outro lado do ciclo de vida. Uma vez é acidente; duas é padrão, e
 * padrão se trava no CI.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs"
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

const CANONICO = "lib/genealogia/vincular-requerente.ts"
const EMISSOR = "src/services/genealogia/emitir-evento-requerente.ts"

const canonico = ler(CANONICO)
const emissor = ler(EMISSOR)
const rotaVinculo = ler("src/app/api/arvore/[arvoreid]/vincular-requerente/route.ts")
const rotaPessoaPost = ler("src/app/api/pessoas/route.ts")
const rotaPessoaPut = ler("src/app/api/pessoas/[id]/route.ts")

// Varredura do repositório (mesmo recorte dos outros guards).
const IGNORAR = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", "tmp", "capturas", "public"])
const arquivos: string[] = []
;(function varrer(dir: string) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) varrer(caminho)
    else if (/\.tsx?$/.test(nome)) arquivos.push(relative(RAIZ, caminho))
  }
})(RAIZ)
const conteudo = new Map(arquivos.map((f) => [f, readFileSync(join(RAIZ, f), "utf8")]))
const quemUsa = (re: RegExp, exceto: string[] = []) =>
  arquivos.filter((f) => !exceto.includes(f) && re.test(conteudo.get(f)!))

console.log("GUARD — PORTA ÚNICA DE INSERÇÃO DE REQUERENTE\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) A segunda porta não existe mais — foi removida, não proibida")
// ═══════════════════════════════════════════════════════════════════════════
// O EMISSOR e este guard citam o nome de propósito — um registra a remoção, o
// outro a vigia. Qualquer outro arquivo que o mencione é resquício.
const ESCREVEM_SOBRE_A_PORTA = [EMISSOR, "scripts/guard-porta-unica-requerente.test.ts",
  // O guard do contrato de estados verifica que as rotas de CADASTRO não a chamam.
  "scripts/guard-cadastro-nao-e-arvore.test.ts"]
const resquicios = quemUsa(/emitirEDrenarEventoRequerente/, ESCREVEM_SOBRE_A_PORTA)
ok("`emitirEDrenarEventoRequerente` não existe em lugar nenhum",
  resquicios.length === 0, resquicios.join(", ") || "nenhum resquício")
ok("o emissor não abre transação própria (enfileirar é sempre do caller)",
  !/\$transaction/.test(emissor),
  "transação própria aqui é o que permitia à rota emitir por fora")

// ═══════════════════════════════════════════════════════════════════════════
secao("2) A primitiva de enfileiramento tem UM chamador")
// ═══════════════════════════════════════════════════════════════════════════
const usamEnfileirar = quemUsa(/enfileirarEventoRequerente\s*\(/, [
  EMISSOR, CANONICO, "scripts/guard-porta-unica-requerente.test.ts",
])
ok("só o serviço canônico chama `enfileirarEventoRequerente`",
  usamEnfileirar.length === 0,
  usamEnfileirar.join(", ") || "nenhum desvio")

// ═══════════════════════════════════════════════════════════════════════════
secao("3) Nenhuma rota HTTP é dona do efeito de negócio")
// ═══════════════════════════════════════════════════════════════════════════
const rotas = arquivos.filter((f) => f.startsWith("src/app/api/") && /route\.tsx?$/.test(f))
const rotasQueEmitem = rotas.filter((f) =>
  /enfileirarEventoRequerente\s*\(|emitirEDrenarEventoRequerente\s*\(|TIPO_EVENTO_REQUERENTE|["']requerente\.adicionado["']/.test(conteudo.get(f)!),
)
ok("nenhuma rota emite `requerente.adicionado` diretamente",
  rotasQueEmitem.length === 0, rotasQueEmitem.join(", ") || `${rotas.length} rotas varridas`)

const rotasQueDisparamMotor = rotas.filter((f) => /processarRequerenteAdicionado\s*\(/.test(conteudo.get(f)!))
ok("nenhuma rota chama o motor financeiro por requerente diretamente",
  rotasQueDisparamMotor.length === 0, rotasQueDisparamMotor.join(", ") || "nenhuma")

ok("a rota de vínculo só valida, resolve o ator e chama a porta pública",
  /vincularRequerente\(/.test(rotaVinculo) &&
  !/dispararMaterializacaoPorArvore/.test(rotaVinculo) &&
  !/enfileirar|emitirEDrenar|processarOutbox/.test(rotaVinculo))
ok("a rota de vínculo repassa o ator para o domínio (auditoria do evento)",
  /actorId,?\s*\n?\s*\}\)/.test(rotaVinculo) || /actorId,/.test(rotaVinculo))
ok("POST /api/pessoas não emite (a Pessoa nunca nasce requerente por lá)",
  !/enfileirar|emitirEDrenar/.test(rotaPessoaPost) && /requerente:\s*ehRequerente\(requerente\)\s*\?\s*'nao'/.test(rotaPessoaPost))
ok("PUT /api/pessoas/[id] delega a transição ao serviço canônico",
  /registrarTransicaoParaRequerenteTx\(/.test(rotaPessoaPut) && !/enfileirarEventoRequerente\(/.test(rotaPessoaPut))
ok("PUT /api/pessoas/[id] usa o pós-commit canônico, não o seu próprio",
  /efeitosDoVinculoPosCommit\(/.test(rotaPessoaPut) && !/processarOutbox\(/.test(rotaPessoaPut))

// ═══════════════════════════════════════════════════════════════════════════
secao("4) Vínculo e evento são atômicos — e o vínculo sozinho é inalcançável")
// ═══════════════════════════════════════════════════════════════════════════
ok("`aplicarVinculoNaArvore` NÃO é exportada",
  /^async function aplicarVinculoNaArvore/m.test(canonico) && !/export\s+async\s+function\s+aplicarVinculoNaArvore/.test(canonico),
  "exportar o vínculo sem o evento recria a segunda porta")
const corpoTx = canonico.slice(canonico.indexOf("export async function vincularRequerenteTx"))
const corpoTxFim = corpoTx.slice(0, corpoTx.indexOf("\n}\n") + 3)
ok("`vincularRequerenteTx` enfileira o evento na MESMA transação recebida",
  /aplicarVinculoNaArvore\(tx,/.test(corpoTxFim) && /enfileirarEventoRequerente\(tx,/.test(corpoTxFim))
ok("o enfileiramento vem DEPOIS do vínculo, e só quando ele deu certo",
  corpoTxFim.indexOf("if (!resultado.ok) return resultado") < corpoTxFim.indexOf("enfileirarEventoRequerente"))
ok("`vincularRequerente` faz o ato inteiro: transação + pós-commit",
  /prisma\.\$transaction\(\(tx\) => vincularRequerenteTx\(tx, input\)\)/.test(canonico) &&
  /if \(resultado\.ok\) await efeitosDoVinculoPosCommit\(/.test(canonico))
ok("o pós-commit drena a fila E reavalia as Regras Documentais",
  /processarOutbox\(/.test(canonico) && /dispararMaterializacaoPorArvore\(/.test(canonico))

// ═══════════════════════════════════════════════════════════════════════════
secao("5) Quem compõe com transação própria não pode parar no meio")
// ═══════════════════════════════════════════════════════════════════════════
// `vincularRequerenteTx` deixa o evento PENDENTE: sem o pós-commit o estado
// converge só quando o dispatcher passar. Meia porta é porta.
const compoem = quemUsa(/vincularRequerenteTx\s*\(/, [CANONICO, "scripts/guard-porta-unica-requerente.test.ts"])
const incompletos = compoem.filter((f) => !/efeitosDoVinculoPosCommit\s*\(/.test(conteudo.get(f)!))
ok("todo chamador de `vincularRequerenteTx` também chama `efeitosDoVinculoPosCommit`",
  incompletos.length === 0,
  incompletos.join(", ") || `${compoem.length} chamador(es) conforme`)

// ═══════════════════════════════════════════════════════════════════════════
secao("6) O motor financeiro por requerente só é acionado pela fila")
// ═══════════════════════════════════════════════════════════════════════════
const DISPARO_AUTORIZADO = [
  "src/lib/motor/executor.ts",                 // define
  "src/services/outbox-dispatcher.ts",         // consumidor oficial do evento
  "src/lib/cambio/servico-cambio.ts",          // reprocessamento após cotação (idempotente)
  // Reprocessador administrativo do histórico: NÃO cria nó nem vínculo — só dispara
  // o efeito para quem JÁ é membro da árvore, pelo motor oficial e em dry-run por
  // padrão. É a ferramenta de reparo desta classe de defeito, não uma porta nova.
  "prisma/reconciliacao-honorarios-requerente.ts",
  "scripts/guard-porta-unica-requerente.test.ts",
]
const disparamMotor = quemUsa(/processarRequerenteAdicionado\s*\(/, DISPARO_AUTORIZADO)
ok("ninguém dispara o motor por requerente fora da fila e do reprocesso de câmbio",
  disparamMotor.length === 0,
  disparamMotor.join(", ") || "nenhum desvio")

// ═══════════════════════════════════════════════════════════════════════════
secao("7) O ponteiro Requerente→Pessoa só é escrito pelos dois donos do ciclo")
// ═══════════════════════════════════════════════════════════════════════════
const DONOS_PONTEIRO: Record<string, string> = {
  [CANONICO]: "cria o nó e grava o vínculo (invariante de dedup)",
  "src/services/pessoa-ciclo-vida.ts": "desfaz o ponteiro ao remover da árvore",
  "scripts/pessoa-tortura.test.ts": "limpeza do próprio cenário de teste",
  "scripts/pessoa-equivalencia-rotas.test.ts": "limpeza do próprio cenário de teste",
  "scripts/reconciliacao-derivada-requerente.test.ts": "limpeza do próprio cenário de teste",
  "scripts/porta-unica-requerente.test.ts": "limpeza do próprio cenário de teste",
  "scripts/matriz-estados-requerente.test.ts": "limpeza do próprio cenário de teste",
  "scripts/smoke-ui-setup.ts": "smoke em produção: monta e remove o cenário marcado",
  "scripts/planilha-documental-projecao.test.ts":
    "projeção da Planilha Documental: monta e limpa o próprio cenário (marca PLANILHA-PROJ)",
  // CP-1: liga o cadastro a uma Pessoa canônica STANDALONE (sem árvore). Não é
  // inserção na árvore — sem árvore não há processo, logo não há efeito a emitir.
  "prisma/backfill-cp1-identidade.ts": "backfill de identidade canônica: cria Pessoa SEM árvore",
  "scripts/guard-porta-unica-requerente.test.ts": "este guard",
}
const escrevemPonteiro = arquivos.filter((f) =>
  /requerente\.(update|updateMany)\([\s\S]{0,240}personId/.test(conteudo.get(f)!),
)
for (const f of escrevemPonteiro) {
  ok(`autorizado a escrever Requerente.personId: ${f}`, !!DONOS_PONTEIRO[f],
    DONOS_PONTEIRO[f] ?? "NÃO autorizado — use vincularRequerente() / removerPessoaDaArvore()")
}
const mortas = Object.keys(DONOS_PONTEIRO).filter(
  (f) => f !== "scripts/guard-porta-unica-requerente.test.ts" && !escrevemPonteiro.includes(f) && existsSync(join(RAIZ, f)),
)
ok("a allowlist do ponteiro não tem entrada morta", mortas.length === 0, mortas.join(", ") || "—")

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  console.log("\nA regra: o ato pertence ao serviço; a rota traduz HTTP e nada mais.")
  process.exit(1)
}
console.log("Uma porta, um efeito. A origem da ação não muda o estado final.\n")
