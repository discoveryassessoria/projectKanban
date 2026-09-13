// Gera tests/ui/.auth/prod-readonly2.json — sessão técnica READ-ONLY (admin
// real, id=3) para os smokes de leitura contra produção (playwright.config.ts
// padrão, sem mutação). Não cria nenhum dado; só assina token localmente
// (mesmo JWT_SECRET do `next start` local usado nesses smokes).
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"

async function main() {
  const base = process.env.UI_TEST_BASE_URL ?? `http://localhost:${process.env.UI_TEST_PORT ?? 3411}`
  const { hostname } = new URL(base)
  const destino = join(process.cwd(), "tests/ui/.auth")
  mkdirSync(destino, { recursive: true })

  const u = { id: 3, nome: "Marco Rovatti", email: "marcoantonio@discoveryassessoria.com.br", tipo: "admin" }
  const token = await signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
  const estado = {
    cookies: [{
      name: "authToken", value: token, domain: hostname, path: "/",
      expires: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
      httpOnly: false, secure: false, sameSite: "Lax" as const,
    }],
    origins: [{ origin: base, localStorage: [
      { name: "authToken", value: token },
      { name: "user", value: JSON.stringify(u) },
    ] }],
  }
  writeFileSync(join(destino, "prod-readonly2.json"), JSON.stringify(estado, null, 2))
  console.log("[ui] prod-readonly2.json pronto")
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
