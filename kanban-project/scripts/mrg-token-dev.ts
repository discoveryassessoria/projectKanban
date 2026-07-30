/**
 * TOKEN DE DESENVOLVIMENTO para testar as rotas do motor registral por HTTP.
 *
 * Rodar:
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   npx tsx scripts/mrg-token-dev.ts <email>
 *
 * Emite um JWT com a MESMA assinatura do login real (lib/auth-jwt), para o
 * usuário informado, e imprime o header pronto para curl.
 *
 * TRAVAS: só roda contra banco LOCAL e fora de produção. Não cria usuário, não
 * concede permissão, não altera nada — só assina um token para um usuário que já
 * existe. As permissões continuam vindo do Perfil/permissoesCustom daquele
 * usuário, exatamente como em produção.
 */

export {}

// O `next dev` carrega .env.local sozinho; o tsx não. Carregamos aqui as chaves
// AINDA NÃO definidas no ambiente (JWT_SECRET é a que este script precisa), sem
// sobrescrever nada que já venha exportado — assim a URL do banco de teste
// passada na linha de comando continua valendo.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
for (const arquivo of [".env.local", ".env"]) {
  const caminho = join(__dirname, "..", arquivo)
  if (!existsSync(caminho)) continue
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    const valor = m[2].trim().replace(/^["']|["']$/g, "")
    if (!valor || process.env[m[1]]) continue
    process.env[m[1]] = valor
  }
}

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
const LOCAIS = new Set(["localhost", "127.0.0.1", "::1"])
function hostDe(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase()
  } catch {
    return ""
  }
}

if (process.env.NODE_ENV === "production") {
  console.error("❌ ABORTADO: NODE_ENV=production. Este utilitário é só de desenvolvimento.")
  process.exit(1)
}
if (!LOCAIS.has(hostDe(URL_DB))) {
  console.error(`❌ ABORTADO: banco "${hostDe(URL_DB) || "(não definido)"}" não é local.`)
  console.error("   Emitir token contra banco que não é de teste está fora do propósito deste script.")
  process.exit(1)
}

const email = process.argv[2]
if (!email) {
  console.error("Uso: npx tsx scripts/mrg-token-dev.ts <email-do-usuario>")
  process.exit(1)
}

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const { signAuthToken } = await import("@/lib/auth-jwt")
  const { calcularPermissoes } = await import("@/src/lib/permissoes")

  const usuario = await prisma.usuario.findUnique({
    where: { email },
    select: { id: true, email: true, tipo: true, nome: true, permissoesCustom: true, perfil: { select: { permissoes: true } } },
  })
  if (!usuario) {
    console.error(`❌ usuário ${email} não existe neste banco.`)
    const alguns = await prisma.usuario.findMany({ select: { email: true }, take: 10, orderBy: { id: "desc" } })
    if (alguns.length) console.error(`   e-mails disponíveis: ${alguns.map((u) => u.email).join(", ")}`)
    process.exit(1)
  }

  const token = await signAuthToken({
    userId: usuario.id,
    email: usuario.email,
    tipo: usuario.tipo,
    sessaoInicio: Date.now(),
  })

  const permissoes = calcularPermissoes(
    usuario.tipo,
    usuario.perfil?.permissoes as Record<string, boolean> | null,
    usuario.permissoesCustom as Record<string, boolean> | null,
  )
  const registrais = Object.entries(permissoes)
    .filter(([k, v]) => k.startsWith("registral.") && v)
    .map(([k]) => k)

  console.log(`\nusuário : ${usuario.nome || usuario.email} (#${usuario.id}, tipo=${usuario.tipo})`)
  console.log(`permissões registrais: ${registrais.length ? registrais.join(", ") : "(nenhuma)"}`)
  console.log(`\nexport TOKEN='${token}'\n`)
  console.log(`curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/registral/conflitos | jq\n`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
