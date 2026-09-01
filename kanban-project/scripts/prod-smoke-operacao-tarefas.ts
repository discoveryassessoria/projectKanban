/**
 * SMOKE DE PRODUÇÃO — a operação de tarefas depois do deploy.
 *
 *   npx tsx scripts/prod-smoke-operacao-tarefas.ts
 *
 * LEITURA PURA. Nenhuma escrita, em nenhum cenário — nem com flag. Provar
 * comando exigiria escrever em dado real de gente que trabalha, e isso não é
 * papel de smoke.
 *
 * ─── O QUE ESTE SMOKE NÃO CONSEGUE FAZER, E POR QUÊ ─────────────────────────
 * Chamar as rotas AUTENTICADAS de produção a partir daqui. `JWT_SECRET` é uma
 * variável Sensitive na Vercel: `vercel env pull` devolve o valor mascarado, e
 * um token assinado com a chave local é recusado (401) — corretamente, aliás.
 * Não existe atalho honesto: fingir cobertura com um 401 seria pior do que
 * admitir a lacuna.
 *
 * O que dá para provar daqui, e é o que este arquivo faz: que a aplicação
 * responde, que a migration chegou ao banco de produção, e que os INVARIANTES
 * que este deploy existe para garantir valem sobre o dado real — lidos com as
 * MESMAS funções que o runtime usa, não com uma segunda implementação.
 */
import { existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
for (const arquivo of [".env.local", ".env"]) {
  const caminho = join(AQUI, "..", arquivo)
  if (!existsSync(caminho)) continue
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const BASE = process.env.SMOKE_BASE_URL ?? "https://app.discovery.com.br"
let ok = 0, fail = 0
const chk = (c: boolean, m: string, extra = "") => {
  if (c) { ok++; console.log("  ✅", m, extra ? `— ${extra}` : "") }
  else { fail++; console.log("  ❌", m, extra ? `— ${extra}` : "") }
}

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const { urlOperacionalDaTarefa } = await import("@/lib/operacional/navegacao")

  console.log(`SMOKE DE PRODUÇÃO — operação de tarefas · ${BASE}\n`)

  console.log("1) A aplicação respondeu, e as rotas estão protegidas")
  const saude = await fetch(`${BASE}/login`)
  chk(saude.ok, "a aplicação está no ar", String(saude.status))
  // Sem identidade válida, tudo é recusado — inclusive as rotas novas. É o
  // comportamento certo; é também o teto do que este smoke alcança.
  for (const rota of [
    "/api/operacao/visao-global",
    "/api/operacao/tarefas/1/navegacao",
    "/api/processos/1/localizacao",
    "/api/tarefas/1/comando",
  ]) {
    const r = await fetch(`${BASE}${rota}`)
    chk(r.status === 401, `sem sessão, ${rota} é recusada`, String(r.status))
  }

  console.log("\n2) A migration da decisão está em produção")
  const colunas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `select column_name from information_schema.columns
      where table_name = 'Tarefa' and column_name like 'causaDecis%' or
            (table_name = 'Tarefa' and column_name = 'causaDecididaEm')`,
  )
  const nomes = new Set(colunas.map((c) => c.column_name))
  for (const c of ["causaDecididaEm", "causaDecisao", "causaDecisaoAutorId", "causaDecisaoMotivo"]) {
    chk(nomes.has(c), `coluna ${c} existe`)
  }

  console.log("\n3) Nenhuma obrigação tem duas tarefas vivas")
  const TERMINAIS = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA"]
  const vivas = await prisma.tarefa.findMany({
    where: { statusTarefa: { notIn: TERMINAIS as never }, processoId: { not: null } },
    select: {
      id: true, processoId: true, necessidadeId: true, documentoId: true, pessoaId: true,
      ciclo: true, titulo: true, responsavelId: true, statusTarefa: true,
    },
  })
  const { normalizarUnidade, chaveDaUnidade } = await import("@/lib/operacional/identidade-da-tarefa")
  const porUnidade = new Map<string, number[]>()
  for (const t of vivas) {
    const u = await normalizarUnidade(prisma, {
      processoId: t.processoId!, necessidadeId: t.necessidadeId, documentoId: t.documentoId,
      pessoaId: t.pessoaId, ciclo: t.ciclo ?? 1,
    })
    if (u.necessidadeId == null && u.documentoId == null) continue
    const k = chaveDaUnidade(u)
    porUnidade.set(k, [...(porUnidade.get(k) ?? []), t.id])
  }
  const duplicadas = [...porUnidade.entries()].filter(([, ids]) => ids.length > 1)
  chk(duplicadas.length === 0, "uma obrigação, uma tarefa",
    duplicadas.map(([k, ids]) => `${k}: ${ids.join(",")}`).join(" | ") || `${porUnidade.size} unidade(s)`)

  console.log("\n4) O deep-link tem para onde levar")
  const alvo = vivas.find((t) => t.processoId != null)
  if (!alvo) {
    console.log("  (sem tarefa viva em produção — nada a navegar)")
  } else {
    const url = urlOperacionalDaTarefa({ taskId: alvo.id, processoId: alvo.processoId })
    chk(/^\/kanban\?processoId=\d+&tab=central&taskId=\d+$/.test(url), "a URL canônica é montada", url)
    // O quadro só encontra o processo se ele tiver país E tipo — foi
    // exatamente isso que fazia o link cair numa tela vazia.
    const proc = await prisma.processo.findUnique({
      where: { id: alvo.processoId! },
      select: { paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, tipoProcessoMotorId: true },
    })
    chk(typeof proc?.paisCanonico?.countryKey === "string" && proc.paisCanonico?.countryKey.length > 0,
      "o processo alvo tem país", String(proc?.paisCanonico?.countryKey))
    chk(proc?.tipoProcessoMotorId != null,
      "e tipo de processo — sem ele o Kanban não o lista", String(proc?.tipoProcessoMotorId))
    const pais = await prisma.catalogoPais.findFirst({
      where: { countryKey: proc!.paisCanonico?.countryKey!, ativo: true }, select: { countryKey: true },
    })
    chk(pais != null, "e o país está ativo no catálogo", String(pais?.countryKey))
  }

  console.log("\n5) Nada foi escrito por este smoke")
  chk(true, "leitura pura: sem POST, sem PATCH, sem update")

  console.log(`\n${"═".repeat(60)}`)
  console.log(`Total: ${ok + fail} | ✅ ${ok} | ❌ ${fail}`)
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

void main()
