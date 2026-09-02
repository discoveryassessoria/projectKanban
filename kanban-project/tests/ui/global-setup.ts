// tests/ui/global-setup.ts
//
// IDENTIDADE DA SUÍTE DE INTERFACE.
//
// Não existe senha em teste: o token é assinado com o mesmo segredo do
// ambiente, para um administrador que JÁ EXISTE. Nada é criado, nada é
// alterado, e o estado fica em `tests/ui/.auth/`, ignorado pelo git.
//
// A assinatura acontece em `scripts/ui-token.ts`, processo à parte: a
// biblioteca de JWT é ESM puro e não sobrevive ao transpile CommonJS daqui.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()

export default async function globalSetup() {
  const base = process.env.UI_TEST_BASE_URL ?? `http://localhost:${process.env.UI_TEST_PORT ?? 3411}`
  const { hostname } = new URL(base)

  const saida = execFileSync('npx', ['tsx', 'scripts/ui-token.ts'], {
    cwd: RAIZ, encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'inherit'],
  })
  const { token, nome, tipo, user } = JSON.parse(saida.trim()) as {
    token: string; nome: string; tipo: string; user: Record<string, unknown>
  }

  // A aplicação lê o token dos DOIS lugares: cookie (middleware/SSR) e
  // localStorage (chamadas do cliente). O estado precisa ter ambos.
  const estado = {
    cookies: [{
      name: 'authToken', value: token, domain: hostname, path: '/',
      expires: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
      httpOnly: false, secure: false, sameSite: 'Lax' as const,
    }],
    // DOIS itens, não um: telas como o Kanban leem `autenticado = token && user`.
    // Com só o token elas redirecionavam para /login e o teste media a tela errada.
    origins: [{ origin: base, localStorage: [
      { name: 'authToken', value: token },
      { name: 'user', value: JSON.stringify(user) },
    ] }],
  }

  const destino = join(RAIZ, 'tests/ui/.auth')
  mkdirSync(destino, { recursive: true })
  writeFileSync(join(destino, 'state.json'), JSON.stringify(estado, null, 2))
  console.log(`[ui] identidade técnica pronta: ${nome} (${tipo})`)
}
