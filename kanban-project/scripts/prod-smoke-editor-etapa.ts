/**
 * SMOKE DE PRODUÇÃO — Editor da etapa "Aguardar retorno do cartório".
 *
 * Rodar:
 *   npx tsx scripts/prod-smoke-editor-etapa.ts                 # leitura autenticada
 *   npx tsx scripts/prod-smoke-editor-etapa.ts --escrita       # + andamento, restaurado ao final
 *
 * Exercita o CAMINHO REAL (HTTP + middleware + JWT + permissões), não o serviço
 * direto: é o único jeito de provar que a etapa abre editor para um usuário de
 * verdade, com as permissões dele.
 *
 * O token é assinado com a MESMA chave do login (lib/auth-jwt) para um usuário
 * que JÁ existe. Não cria usuário, não concede permissão, não altera cadastro.
 *
 * A passada de escrita registra UM contato marcado e restaura o payload original
 * do passo no final — produção não fica com resíduo de teste.
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
const COM_ESCRITA = process.argv.includes("--escrita")

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }

interface PassoResposta {
  id: number
  stepKey: string
  title: string
  weight: number
  slaDays: number | null
  status: string
  lockVersion?: number
  editor?: { kind: string; especifico: boolean; stepKeyCanonico: string }
  acoesPermitidas?: string[]
  andamento?: { contatos: unknown[]; observacoes: unknown[]; anexos: unknown[] }
  externalProtocol?: string | null
  requestChannel?: string | null
}

async function main() {
  // Import DEPOIS de carregar o .env: prisma e auth-jwt leem variáveis na
  // inicialização do módulo.
  const { prisma } = await import("@/lib/prisma")
  const { signAuthToken } = await import("@/lib/auth-jwt")
  const { lerAndamento } = await import("@/src/lib/process-stage/andamento-etapa")
  const { Prisma } = await import("@prisma/client")

  const lerDoBanco = async (stepInstanceId: number) => {
    const p = await prisma.phaseWorkflowStepInstance.findUnique({
      where: { id: stepInstanceId }, select: { metadata: true },
    })
    return lerAndamento(((p?.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {})
  }

  console.log(`SMOKE DE PRODUÇÃO — editor de etapa · ${BASE}\n`)

  // ── usuário real + token com a assinatura do login ────────────────────────
  const usuario = await prisma.usuario.findFirst({
    where: { tipo: "admin" },
    orderBy: { id: "asc" },
    select: { id: true, nome: true, email: true, tipo: true },
  })
  if (!usuario) { console.log("  ❌ nenhum usuário admin ativo em produção"); process.exit(1) }
  console.log(`  Usuário: ${usuario.nome} <${usuario.email}>`)

  const token = await signAuthToken({ userId: usuario.id, email: usuario.email, tipo: usuario.tipo })
  const cabecalhos = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  // ── documento com a etapa ativa ───────────────────────────────────────────
  const alvo = await prisma.phaseWorkflowStepInstance.findFirst({
    where: { stepKey: "aguardar_retorno_do_cartorio", documentoId: { not: null } },
    orderBy: { id: "desc" },
    select: { id: true, documentoId: true, status: true, metadata: true },
  })
  if (!alvo?.documentoId) { console.log("  (sem etapa 'aguardar_retorno_do_cartorio' por documento)"); return }
  const documentoId = alvo.documentoId
  console.log(`  Documento ${documentoId} · etapa ${alvo.id} · ${alvo.status}\n`)

  // ── 1) o gate de autenticação continua fechado ────────────────────────────
  console.log("(1) Autenticação:")
  const anonimo = await fetch(`${BASE}/api/documentos/${documentoId}/workflow`)
  chk(anonimo.status === 401, `1. sem token a rota devolve 401 (recebido ${anonimo.status})`)

  // ── 2) leitura autenticada ────────────────────────────────────────────────
  console.log("\n(2) Leitura autenticada:")
  const res = await fetch(`${BASE}/api/documentos/${documentoId}/workflow`, { headers: cabecalhos })
  chk(res.ok, `2. GET workflow responde 200 (recebido ${res.status})`)
  const corpo = (await res.json()) as { workflow?: { steps?: PassoResposta[] } }
  const passos = corpo.workflow?.steps ?? []
  chk(passos.length > 0, `3. o workflow do documento volta com ${passos.length} etapas`)

  const etapa = passos.find((p) => p.id === alvo.id)
  chk(!!etapa, "4. a etapa 'Aguardar retorno do cartório' está no workflow")
  if (!etapa) throw new Error("etapa ausente na resposta")

  chk(etapa.editor?.kind === "acompanhamento_retorno" && etapa.editor?.especifico === true,
    `5. PRODUÇÃO resolve o editor específico da etapa (kind=${etapa.editor?.kind})`)
  chk(passos.every((p) => !!p.editor?.kind), "6. nenhuma etapa volta sem editor resolvido")
  chk(etapa.title === "Aguardar retorno do cartório", `7. título do catálogo (recebido "${etapa.title}")`)
  chk(etapa.weight === 10, `8. peso do catálogo (recebido ${etapa.weight})`)
  chk(etapa.slaDays === 15, `9. SLA do catálogo (recebido ${String(etapa.slaDays)})`)

  const solicitacao = passos.find((p) => p.stepKey === "solicitar_certidao")
  chk(!!solicitacao, "10. a etapa de solicitação (origem do protocolo) está no mesmo workflow")
  console.log(`     protocolo=${String(solicitacao?.externalProtocol ?? "—")} canal=${String(solicitacao?.requestChannel ?? "—")}`)

  const acoes = etapa.acoesPermitidas ?? []
  chk(Array.isArray(etapa.acoesPermitidas) && acoes.length > 0,
    `11. ações permitidas calculadas no servidor: [${acoes.join(", ")}]`)
  chk(!!etapa.andamento && Array.isArray(etapa.andamento.contatos),
    "12. o andamento estruturado (contatos/observações/anexos) chega na resposta")

  // ── 3) escrita reversível pelo HTTP ───────────────────────────────────────
  if (!COM_ESCRITA) {
    console.log("\n(3) Escrita — PULADO (use --escrita)")
  } else if (alvo.status !== "EM_ANDAMENTO") {
    console.log(`\n(3) Escrita — PULADO (etapa em ${alvo.status})`)
  } else {
    console.log("\n(3) Escrita reversível pelo HTTP:")
    const metadataOriginal = alvo.metadata as typeof Prisma.JsonNull | object | null
    const antes = lerAndamento(((alvo.metadata ?? {}) as { operacao?: Record<string, unknown> }).operacao ?? {})
    const marca = `[SMOKE-PROD ${new Date().toISOString()}]`
    const url = `${BASE}/api/documentos/${documentoId}/workflow/steps/${alvo.id}/andamento`
    const contato = {
      canal: "LIGACAO", resultado: "PRAZO_INFORMADO",
      observacao: `${marca} smoke de produção`, chaveIdempotencia: marca,
    }

    try {
      const semToken = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contato }) })
      chk(semToken.status === 401, `13. andamento sem token devolve 401 (recebido ${semToken.status})`)

      const p1 = await fetch(url, { method: "POST", headers: cabecalhos, body: JSON.stringify({ contato }) })
      const j1 = (await p1.json()) as { workflow?: { steps?: PassoResposta[] } }
      chk(p1.ok, `14. registrar contato responde 200 (recebido ${p1.status})`)
      const et1 = j1.workflow?.steps?.find((p) => p.id === alvo.id)
      chk((et1?.andamento?.contatos.length ?? 0) === antes.contatos.length + 1,
        "15. a resposta já traz o contato persistido")

      const noBanco = await lerDoBanco(alvo.id)
      chk(noBanco.contatos.length === antes.contatos.length + 1, "16. PERSISTÊNCIA confirmada no banco de produção")
      chk(antes.contatos.every((c) => noBanco.contatos.some((d) => d.chave === c.chave)),
        "17. contatos anteriores intactos")

      const p2 = await fetch(url, { method: "POST", headers: cabecalhos, body: JSON.stringify({ contato }) })
      const noBanco2 = await lerDoBanco(alvo.id)
      chk(p2.ok && noBanco2.contatos.length === noBanco.contatos.length,
        "18. reenvio idêntico NÃO duplica (idempotência ponta a ponta)")

      const passoDepois = await prisma.phaseWorkflowStepInstance.findUnique({
        where: { id: alvo.id }, select: { status: true },
      })
      chk(passoDepois?.status === alvo.status, "19. registrar andamento não alterou o estado do passo")

      const auditoria = await prisma.logAuditoria.count({
        where: { acao: "PASSO_ANDAMENTO", entidade: "PhaseWorkflowStepInstance", entidadeId: alvo.id, usuarioId: usuario.id },
      })
      chk(auditoria > 0, "20. auditoria registrada com o usuário do token")
    } finally {
      await prisma.phaseWorkflowStepInstance.update({
        where: { id: alvo.id },
        data: { metadata: (metadataOriginal ?? Prisma.JsonNull) as never },
      })
      const restaurado = await lerDoBanco(alvo.id)
      chk(restaurado.contatos.length === antes.contatos.length && restaurado.observacoes.length === antes.observacoes.length,
        "21. payload original restaurado — produção sem resíduo")
    }
  }

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
}

main()
  .then(() => {
    if (fail > 0) process.exit(1)
    console.log("Smoke de produção: editor de etapa validado ✅")
  })
  .catch((e) => { console.error(e); process.exit(1) })
