/**
 * BLINDAGEM DE AMBIENTE — a trava que impede produção subir sem o banco certo.
 *
 * Rodar: npm run test:env-producao
 *
 * O incidente de 04/08/2026: `PRISMA_DATABASE_URL` e `DIRECT_DATABASE_URL`
 * perderam o target Production no projeto Vercel. O build passou (nada no build
 * toca banco), o deployment subiu, o alias virou — e só então TODA rota de dados
 * passou a devolver 500. Login inclusive.
 *
 * Este teste prova as duas metades da trava:
 *   (A) ela reprova os quatro jeitos de produção subir errada;
 *   (B) ela não vaza segredo em nenhum deles — nem no host, nem no fingerprint.
 *
 * PURO: nenhuma conexão, nenhum acesso a rede, nenhum segredo real.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

import {
  conferirVariavel,
  conferirAmbiente,
  fingerprintDe,
  hostMascarado,
  MOTIVO,
  EXPLICACAO,
  VARIAVEIS_DE_BANCO,
  FINGERPRINT_PRODUCAO,
} from "../lib/db/fingerprint-producao.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const GUARD = join(ROOT, "scripts", "guard-env-producao.mjs")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

/** Roda o guard com um ambiente forjado e devolve saída + código de saída. */
function rodarGuard(env: Record<string, string | undefined>): { code: number; saida: string } {
  const limpo: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v !== undefined && !(k in env && env[k] === undefined)) limpo[k] = String(v)
  }
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete limpo[k]
  try {
    const saida = execFileSync("node", [GUARD], { env: limpo as NodeJS.ProcessEnv, encoding: "utf8", stdio: "pipe" })
    return { code: 0, saida }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, saida: (err.stdout ?? "") + (err.stderr ?? "") }
  }
}

const PROD_PRISMA = "postgres://a8c811cdd60151e1b64ebf0cc70ef776d5842094f83125f3b6344a0f490b5aa2:SEGREDO@pooled.db.prisma.io:5432/postgres?sslmode=require"
const PROD_DIRECT = "postgres://a8c811cdd60151e1b64ebf0cc70ef776d5842094f83125f3b6344a0f490b5aa2:SEGREDO@db.prisma.io:5432/postgres?sslmode=require"
const HOMOLOG = "postgres://user:SENHA_DE_TESTE@ep-abc-123.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
const OUTRO = "postgres://u:SENHA_DE_TESTE@outro-banco.exemplo.com:5432/postgres"

console.log("BLINDAGEM DE AMBIENTE — produção não sobe sem o banco certo\n")

// ════════════════════════════════════════════════════════════════
// (A) CLASSIFICAÇÃO — puro
// ════════════════════════════════════════════════════════════════
console.log("(A) Diagnóstico das variáveis:")

ok(VARIAVEIS_DE_BANCO.length === 2 &&
   VARIAVEIS_DE_BANCO.includes("PRISMA_DATABASE_URL") &&
   VARIAVEIS_DE_BANCO.includes("DIRECT_DATABASE_URL"),
  "1. as duas variáveis sem as quais produção não roda estão declaradas")

ok(conferirVariavel("PRISMA_DATABASE_URL", undefined).motivo === MOTIVO.AUSENTE &&
   conferirVariavel("PRISMA_DATABASE_URL", "   ").motivo === MOTIVO.AUSENTE,
  "2. variável ausente ou vazia = VARIAVEL_AUSENTE (o incidente de 04/08)")

ok(conferirVariavel("PRISMA_DATABASE_URL", "isto-não-é-url").motivo === MOTIVO.ILEGIVEL,
  "3. valor que não é URL de conexão = URL_ILEGIVEL")

ok(conferirVariavel("PRISMA_DATABASE_URL", HOMOLOG).motivo === MOTIVO.HOMOLOGACAO,
  "4. host de homologação (Neon) = APONTA_PARA_HOMOLOGACAO")

ok(conferirVariavel("PRISMA_DATABASE_URL", OUTRO).motivo === MOTIVO.OUTRO_BANCO,
  "5. banco desconhecido = BANCO_DIFERENTE_DO_ESPERADO")

ok(conferirVariavel("PRISMA_DATABASE_URL", PROD_PRISMA).ok === true &&
   conferirVariavel("DIRECT_DATABASE_URL", PROD_DIRECT).ok === true,
  "6. o par oficial de produção passa")

// o fingerprint IGNORA a senha — trocar a senha não é trocar de banco
const comOutraSenha = PROD_PRISMA.replace("SEGREDO", "OUTRA_SENHA_QUALQUER")
ok(fingerprintDe(comOutraSenha) === fingerprintDe(PROD_PRISMA),
  "7. o fingerprint ignora a senha — rotacionar credencial não reprova o build")

ok(fingerprintDe(PROD_PRISMA) !== fingerprintDe(PROD_DIRECT),
  "8. pooled e direct são fingerprints distintos — não se confundem")

ok(FINGERPRINT_PRODUCAO.PRISMA_DATABASE_URL === fingerprintDe(PROD_PRISMA) &&
   FINGERPRINT_PRODUCAO.DIRECT_DATABASE_URL === fingerprintDe(PROD_DIRECT),
  "9. os fingerprints registrados são os do banco de produção real")

ok(conferirAmbiente({ PRISMA_DATABASE_URL: PROD_PRISMA, DIRECT_DATABASE_URL: PROD_DIRECT } as unknown as NodeJS.ProcessEnv).every((r: { ok: boolean }) => r.ok),
  "10. conferirAmbiente aprova o par completo")

ok(Object.values(MOTIVO).every((m) => typeof EXPLICACAO[m] === "string" && EXPLICACAO[m].length > 30),
  "11. todo motivo tem explicação operacional — ninguém lê só o código")

// ════════════════════════════════════════════════════════════════
// (B) SEGREDO NUNCA SAI
// ════════════════════════════════════════════════════════════════
console.log("\n(B) Segredo não vaza:")

const mascarado = hostMascarado(PROD_DIRECT)
ok(!mascarado.includes("SEGREDO") && !mascarado.includes("a8c811cd") && mascarado.includes("*"),
  `12. o host sai mascarado (${mascarado}) — sem credencial`)

const conf = conferirVariavel("PRISMA_DATABASE_URL", PROD_PRISMA)
ok(JSON.stringify(conf).indexOf("SEGREDO") === -1,
  "13. o resultado da conferência não carrega a senha")
ok((conf.fingerprint ?? "").length === 12,
  "14. o fingerprint exposto é parcial (12 chars), não o hash inteiro")

// ════════════════════════════════════════════════════════════════
// (C) O GUARD DE BUILD — comportamento de ponta a ponta
// ════════════════════════════════════════════════════════════════
console.log("\n(C) Guard de build:")

const foraDeProd = rodarGuard({ VERCEL_ENV: "preview", PRISMA_DATABASE_URL: undefined, DIRECT_DATABASE_URL: undefined })
ok(foraDeProd.code === 0, "15. fora de produção o guard não opina (preview tem outro banco de propósito)")

const semVars = rodarGuard({ VERCEL_ENV: "production", PRISMA_DATABASE_URL: undefined, DIRECT_DATABASE_URL: undefined })
ok(semVars.code === 1, "16. produção SEM as variáveis: build REPROVADO (exit 1)")
ok(semVars.saida.includes("VARIAVEL_AUSENTE") && semVars.saida.includes("target Production"),
  "17. a mensagem diz o que fazer, e onde")
ok(semVars.saida.includes("NÃO promova a entrada de Preview"),
  "18. avisa contra o conserto errado — promover Preview colocaria produção sobre a homologação")
ok(semVars.saida.includes("continua no ar"),
  "19. explica que reprovar o build preserva a produção atual")

const comHomolog = rodarGuard({ VERCEL_ENV: "production", PRISMA_DATABASE_URL: HOMOLOG, DIRECT_DATABASE_URL: HOMOLOG })
ok(comHomolog.code === 1, "20. produção apontando para homologação: build REPROVADO")
ok(!comHomolog.saida.includes("SENHA_DE_TESTE"), "21. nem no caminho de erro a senha aparece na saída")

const comOutro = rodarGuard({ VERCEL_ENV: "production", PRISMA_DATABASE_URL: OUTRO, DIRECT_DATABASE_URL: OUTRO })
ok(comOutro.code === 1, "22. produção apontando para banco desconhecido: build REPROVADO")

const correto = rodarGuard({ VERCEL_ENV: "production", PRISMA_DATABASE_URL: PROD_PRISMA, DIRECT_DATABASE_URL: PROD_DIRECT })
ok(correto.code === 0, "23. produção com o par correto: build LIBERADO")
ok(!correto.saida.includes("SEGREDO"), "24. o caminho feliz também não imprime credencial")

// ════════════════════════════════════════════════════════════════
// (D) O GUARD ESTÁ LIGADO
// ════════════════════════════════════════════════════════════════
console.log("\n(D) A trava está no caminho do build:")

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
for (const alvo of ["build", "build:prod-migrate", "build:safe"]) {
  ok(pkg.scripts[alvo]?.includes("guard-env-producao"),
    `25. \`${alvo}\` roda o guard ANTES de compilar`)
}
ok(pkg.scripts.build.indexOf("guard-env-producao") < pkg.scripts.build.indexOf("next build"),
  "26. o guard vem antes do next build — reprova sem gastar o build inteiro")

// ════════════════════════════════════════════════════════════════
// (E) HEALTH CHECK — três diagnósticos distintos
// ════════════════════════════════════════════════════════════════
console.log("\n(E) Health check da conexão:")

const rota = readFileSync(join(ROOT, "src/app/api/saude/banco/route.ts"), "utf8")
ok(rota.includes("VARIAVEL_AUSENTE") && rota.includes("FALHA_DE_CONEXAO") && rota.includes("BANCO_INCORRETO"),
  "27. o health check DISTINGUE variável ausente, conexão falhou e banco incorreto")
ok(rota.includes("podeVerDetalhe") && rota.includes("CRON_SECRET"),
  "28. host e fingerprint só para operador autenticado ou CRON_SECRET")
ok(!/\$\{?url\}?|erro:\s*e\b|String\(e\)|e\.message/.test(rota),
  "29. a mensagem crua do driver (que pode conter a URL) nunca é devolvida nem logada")
ok(rota.includes("new PrismaClient"),
  "30. usa client próprio — reaproveitar conexão viva mentiria sobre o estado atual")

const middleware = readFileSync(join(ROOT, "middleware.ts"), "utf8")
ok(!middleware.includes('"/api/saude'),
  "31. o health check NÃO é rota pública — quem não tem token não descobre topologia")

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Blindagem de ambiente: produção protegida ✅")
