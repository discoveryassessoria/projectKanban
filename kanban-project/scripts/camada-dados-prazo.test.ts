/**
 * GUARDA — a camada oficial de dados nunca espera para sempre.
 * Rodar: npm run test:dados-prazo
 *
 * DEFEITO QUE ISTO TRAVA: uma requisição que NÃO responde deixava a tela no spinner
 * indefinidamente. `fetch` sem prazo nunca resolve, o SWR nunca sai de `isLoading`, e
 * a aba fica carregando sem erro e sem saída — foi a cara do incidente da Central
 * Operacional (31/07), quando a única conexão da instância ficava retida e a resposta
 * simplesmente não vinha.
 *
 * A correção NÃO é apagar o spinner depois de N segundos: é reconhecer que resposta
 * que não vem é FALHA. Vencido o prazo, a requisição é abortada e vira um ErroApi
 * normal — mensagem visível, "Tentar novamente", mesma trilha de um HTTP 500.
 *
 * Exercita `buscar` de verdade, com `fetch` trocado por dublê. Sem banco, sem rede.
 */
export {}

import { buscar, ErroApi, PRAZO_REQUISICAO_MS, STATUS_SEM_RESPOSTA } from "@/src/lib/dados"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, detalhe?: unknown) => {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

// `buscar` usa localStorage por authHeaders(); no Node não existe window → devolve {}.
const fetchOriginal = globalThis.fetch
const comFetch = async (dublê: typeof globalThis.fetch, fn: () => Promise<unknown>) => {
  globalThis.fetch = dublê
  try { return await fn() } finally { globalThis.fetch = fetchOriginal }
}
const capturar = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try { await fn(); return null } catch (e) { return e }
}

async function main() {
  console.log("\nCamada de dados — resposta que não vem é erro, não espera\n")

  // ── 1) Requisição pendurada ────────────────────────────────────────────────
  secao("1) O servidor nunca responde")
  {
    // Dublê fiel ao fetch real: só resolve/rejeita quando o signal aborta.
    const pendurado: typeof globalThis.fetch = (_url, init) =>
      new Promise((_res, rej) => {
        const sinal = init?.signal
        sinal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.")
          err.name = "AbortError"
          rej(err)
        })
      })

    const t0 = Date.now()
    const e = await comFetch(pendurado, () => capturar(() => buscar("/api/qualquer", 120)))
    const ms = Date.now() - t0

    ok("a promessa TERMINA (não fica pendurada)", e !== null)
    ok("e termina como ErroApi", e instanceof ErroApi, String(e))
    ok(`no prazo pedido (${ms} ms < 2000)`, ms < 2000, ms)
    ok("com status de 'sem resposta'", (e as ErroApi)?.status === STATUS_SEM_RESPOSTA, (e as ErroApi)?.status)
    ok("e mensagem que diz o que houve", /não respondeu/i.test((e as ErroApi)?.message ?? ""), (e as ErroApi)?.message)
  }

  // ── 2) Rede caída ──────────────────────────────────────────────────────────
  secao("2) A rede cai no meio")
  {
    const caiu: typeof globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))
    const e = await comFetch(caiu, () => capturar(() => buscar("/api/qualquer")))
    ok("vira ErroApi (não escapa cru para o SWR)", e instanceof ErroApi, String(e))
    ok("com mensagem de rede", /rede/i.test((e as ErroApi)?.message ?? ""), (e as ErroApi)?.message)
  }

  // ── 3) Caminho feliz continua intacto ──────────────────────────────────────
  secao("3) O caminho normal não mudou")
  {
    const bom: typeof globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } }))
    const r = await comFetch(bom, () => buscar<{ ok: number }>("/api/qualquer"))
    ok("resposta 200 devolve o corpo", (r as { ok: number })?.ok === 1, r)

    const quinhentos: typeof globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ error: "Falha do servidor" }), { status: 500, headers: { "content-type": "application/json" } }))
    const e = await comFetch(quinhentos, () => capturar(() => buscar("/api/qualquer")))
    ok("500 preserva status", (e as ErroApi)?.status === 500, (e as ErroApi)?.status)
    ok("500 preserva a mensagem do servidor", (e as ErroApi)?.message === "Falha do servidor", (e as ErroApi)?.message)
  }

  // ── 4) O prazo é padrão, não opcional ──────────────────────────────────────
  secao("4) O prazo vale para TODAS as telas")
  {
    ok("existe um prazo padrão", typeof PRAZO_REQUISICAO_MS === "number" && PRAZO_REQUISICAO_MS > 0)
    ok("generoso o bastante para consulta legítima (≥ 30 s)", PRAZO_REQUISICAO_MS >= 30_000, PRAZO_REQUISICAO_MS)
    ok("e curto o bastante para não virar espera eterna (≤ 90 s)", PRAZO_REQUISICAO_MS <= 90_000, PRAZO_REQUISICAO_MS)
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`Camada de dados: ${passou} passou, ${falhou} falhou`)
  if (falhou > 0) { console.log("\nFalhas:"); for (const f of falhas) console.log(`  · ${f}`); process.exitCode = 1 }
  else console.log("✅ Nenhuma requisição pode ficar pendurada para sempre.\n")
}

main().catch((e) => { console.error("\n❌ erro inesperado:", e); process.exitCode = 1 })
