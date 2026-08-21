// SMOKE DE PRODUÇÃO — as rotas que este trabalho tocou e as que ele NÃO tocou.
//
// Tocar só no que se mexeu prova pouco: o risco de uma mudança transversal está
// justamente no que ninguém olhou. Por isso a lista abaixo tem as duas metades, e a
// segunda é maior que a primeira.
const BASE = process.argv[2] ?? "https://app.discovery.com.br"
const ROTAS = [
  // ── tocadas ────────────────────────────────────────────────────────────
  ["TOCADA", "/administrator"],
  ["TOCADA", "/api/gerenciamento/workflows-fase"],
  ["TOCADA", "/api/gerenciamento/catalogo-execucao"],
  ["TOCADA", "/api/gerenciamento/canais"],
  // ── NÃO tocadas ────────────────────────────────────────────────────────
  ["INTACTA", "/login"],
  ["INTACTA", "/kanban"],
  ["INTACTA", "/tarefas"],
  ["INTACTA", "/operacao"],
  ["INTACTA", "/genealogy"],
  ["INTACTA", "/financeiro"],
  ["INTACTA", "/financeiro/v3"],
  ["INTACTA", "/financas/contas-receber"],
  ["INTACTA", "/dashboard"],
  ["INTACTA", "/cambio"],
  ["INTACTA", "/registral"],
  ["INTACTA", "/api/health"],
]
let ruins = 0
for (const [classe, rota] of ROTAS) {
  // TRÊS TENTATIVAS antes de chamar de defeito. Falha de DNS/rede na máquina que roda
  // o smoke não é defeito da aplicação, e tratá-la como defeito faz o smoke mentir nas
  // duas direções: acusa o que está bom e ensina a ignorar o vermelho.
  let status = 0, erro = ""
  for (let tent = 1; tent <= 3; tent++) {
    try {
      const r = await fetch(BASE + rota, { redirect: "manual", headers: { "user-agent": "smoke-discovery" } })
      status = r.status; erro = ""
      break
    } catch (e) {
      erro = `${String(e).slice(0, 50)} (${tent}/3)`
      await new Promise((ok) => setTimeout(ok, 1500 * tent))
    }
  }
  // 2xx = respondeu; 3xx = redirecionou para o login (esperado sem sessão);
  // 401 = exigiu autenticação (esperado nas APIs). 5xx e falha de rede são defeito.
  const bom = (status >= 200 && status < 400) || status === 401 || status === 403
  if (!bom) ruins++
  console.log(`${bom ? "✅" : "❌"} ${classe} ${String(status || "ERR").padEnd(4)} ${rota}${erro ? ` — ${erro}` : ""}`)
}
console.log(`\n${ruins === 0 ? "✅ SMOKE LIMPO" : `❌ ${ruins} rota(s) com defeito`} — ${ROTAS.length} rotas em ${BASE}`)
process.exit(ruins === 0 ? 0 : 1)
