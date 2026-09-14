import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
for (const arquivo of [".env.local", ".env"]) {
  const caminho = join(process.cwd(), arquivo)
  if (!existsSync(caminho)) continue
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}
import("@/lib/auth-jwt").then(async (mod) => {
  const t = await mod.signAuthToken({ userId: 12, email: "daniela@discoveryassessoria.com.br", tipo: "assistente" })
  console.log(t)
})
