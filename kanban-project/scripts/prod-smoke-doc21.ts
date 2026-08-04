/**
 * SMOKE DE PRODUÇÃO — o requerimento (DOC21) nas três visões.
 *
 * Rodar: npx tsx scripts/prod-smoke-doc21.ts
 *
 * Exercita o CAMINHO REAL (HTTP + middleware + JWT + permissões) contra produção.
 * SÓ LEITURA: não anexa, não conclui etapa, não altera registro nenhum. O que ele
 * prova é o que a correção prometeu — que a etapa, o documento e o protocolo
 * mostram O MESMO arquivo, pelo mesmo id, com uma única cópia física.
 *
 * O token é assinado com a MESMA chave do login para um usuário que JÁ existe.
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
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log("  ✅", m) } else { fail++; console.log("  ❌", m) } }

interface ArquivoResp {
  id: number
  url: string
  nome: string
  tipo: string
  documentoMestre: { id: number; publicCode: string | null; name: string } | null
  protocoloId: number | null
  solicitacaoId: number | null
  stepInstanceId: number | null
  vigente: boolean
}

async function main() {
  const { prisma } = await import("@/lib/prisma")
  const { signAuthToken } = await import("@/lib/auth-jwt")

  console.log(`SMOKE DE PRODUÇÃO — requerimento DOC21 · ${BASE}\n`)

  const usuario = await prisma.usuario.findFirst({
    where: { tipo: "admin" }, orderBy: { id: "asc" },
    select: { id: true, nome: true, email: true, tipo: true },
  })
  if (!usuario) { console.log("  ❌ nenhum usuário admin em produção"); process.exit(1) }
  console.log(`  Usuário: ${usuario.nome} <${usuario.email}>`)

  const token = await signAuthToken({ userId: usuario.id, email: usuario.email, tipo: usuario.tipo })
  const cabecalhos = { Authorization: `Bearer ${token}` }

  // Alvo: um passo "solicitar_certidao" que JÁ tem requerimento registrado.
  const arquivoAlvo = await prisma.documentoArquivo.findFirst({
    where: { tipo: "REQUERIMENTO_ENVIADO", vigente: true, stepInstanceId: { not: null } },
    orderBy: { id: "desc" },
    select: { id: true, documentoId: true, stepInstanceId: true, url: true },
  })
  if (!arquivoAlvo) { console.log("\n  (nenhum requerimento registrado em produção — nada a conferir)"); return }
  const { documentoId, stepInstanceId } = arquivoAlvo
  console.log(`  Documento ${documentoId} · etapa ${stepInstanceId} · arquivo ${arquivoAlvo.id}\n`)

  // ── 1) o gate continua fechado ────────────────────────────────────────────
  console.log("(1) Autenticação:")
  const anonimo = await fetch(`${BASE}/api/documentos/${documentoId}/arquivos`)
  chk(anonimo.status === 401, `1. sem token a rota de arquivos devolve 401 (recebido ${anonimo.status})`)

  // ── 2) ANEXOS DA ETAPA ────────────────────────────────────────────────────
  console.log("\n(2) Anexos da ETAPA:")
  const rEtapa = await fetch(`${BASE}/api/documentos/${documentoId}/arquivos?stepInstanceId=${stepInstanceId}`, { headers: cabecalhos })
  chk(rEtapa.ok, `2. GET arquivos da etapa responde 200 (recebido ${rEtapa.status})`)
  const daEtapa = ((await rEtapa.json()) as { arquivos?: ArquivoResp[] }).arquivos ?? []
  chk(daEtapa.length > 0, `3. a aba Anexos da etapa NÃO está vazia (${daEtapa.length} arquivo(s))`)
  const reqEtapa = daEtapa.find((a) => a.tipo === "REQUERIMENTO_ENVIADO")
  chk(!!reqEtapa, "4. o requerimento aparece na etapa")
  chk(!!reqEtapa?.documentoMestre, `5. classificado no cadastro mestre (${reqEtapa?.documentoMestre?.publicCode ?? "—"} · ${reqEtapa?.documentoMestre?.name ?? "—"})`)
  chk(reqEtapa?.stepInstanceId === stepInstanceId, "6. vinculado à etapa correta")
  chk(reqEtapa?.solicitacaoId != null, `7. vinculado à solicitação (#${reqEtapa?.solicitacaoId})`)
  chk(reqEtapa?.protocoloId != null, `8. vinculado ao protocolo (#${reqEtapa?.protocoloId})`)
  chk(reqEtapa?.vigente === true, "9. é a versão vigente")

  // ── 3) ANEXOS DO DOCUMENTO ────────────────────────────────────────────────
  console.log("\n(3) Anexos do DOCUMENTO:")
  const rDoc = await fetch(`${BASE}/api/documentos/${documentoId}/arquivos`, { headers: cabecalhos })
  chk(rDoc.ok, `10. GET arquivos do documento responde 200 (recebido ${rDoc.status})`)
  const doDoc = ((await rDoc.json()) as { arquivos?: ArquivoResp[] }).arquivos ?? []
  const reqDoc = doDoc.find((a) => a.id === reqEtapa?.id)
  chk(!!reqDoc, "11. o MESMO arquivo aparece na aba do documento")
  chk(doDoc.filter((a) => a.id === reqEtapa?.id).length === 1, "12. aparece UMA vez — sem linha duplicada por ter vários vínculos")

  // ── 4) PROTOCOLO / SOLICITAÇÃO ────────────────────────────────────────────
  console.log("\n(4) Solicitação e protocolo:")
  const rSol = await fetch(`${BASE}/api/documentos/${documentoId}/solicitacoes`, { headers: cabecalhos })
  chk(rSol.ok, `13. GET solicitações responde 200 (recebido ${rSol.status})`)
  const resumo = ((await rSol.json()) as { resumo?: { solicitacoes: Array<{ id: number; status: string; protocolos: Array<{ id: number; numero: string | null }>; arquivos: ArquivoResp[] }> } }).resumo
  const sol = resumo?.solicitacoes?.[0]
  chk(!!sol, "14. a solicitação vigente é lida pelo registro canônico")
  const reqSol = sol?.arquivos.find((a) => a.id === reqEtapa?.id)
  chk(!!reqSol, "15. o MESMO arquivo aparece na solicitação/protocolo")
  chk(!!sol?.protocolos?.length, `16. o protocolo está registrado (${sol?.protocolos?.[0]?.numero ?? "—"})`)

  // ── 5) O MESMO fileId NAS TRÊS VISÕES ─────────────────────────────────────
  console.log("\n(5) Identidade do arquivo:")
  const ids = [reqEtapa?.id, reqDoc?.id, reqSol?.id]
  chk(new Set(ids).size === 1 && ids[0] != null, `17. MESMO fileId nas três visões: ${JSON.stringify(ids)}`)
  const urls = new Set([reqEtapa?.url, reqDoc?.url, reqSol?.url])
  chk(urls.size === 1, `18. UMA única cópia física (mesma URL de storage nas três)`)

  const totalNoBanco = await prisma.documentoArquivo.count({ where: { documentoId, url: arquivoAlvo.url } })
  chk(totalNoBanco === 1, `19. o banco tem UMA linha para este arquivo (${totalNoBanco})`)

  // ── 6) EXIGÊNCIA DA ETAPA ─────────────────────────────────────────────────
  console.log("\n(6) Exigência de evidência configurada:")
  const rExig = await fetch(`${BASE}/api/documentos/${documentoId}/solicitacoes/exigencias?stepInstanceId=${stepInstanceId}`, { headers: cabecalhos })
  chk(rExig.ok, `20. GET exigências responde 200 (recebido ${rExig.status})`)
  const exig = ((await rExig.json()) as { exigencias?: { principal: { documentoMestre: { id: number; publicCode: string | null; name: string } } | null; anexoAtual: { id: number } | null } }).exigencias
  chk(exig?.principal != null, `21. a etapa exige um documento mestre (${exig?.principal?.documentoMestre.publicCode ?? "—"})`)
  chk(exig?.principal?.documentoMestre.id === reqEtapa?.documentoMestre?.id,
    "22. o arquivo anexado é EXATAMENTE o tipo mestre exigido")
  chk(exig?.anexoAtual?.id === reqEtapa?.id,
    "23. a etapa reconhece o arquivo já registrado — não pede reenvio")

  console.log(`\n${ok} ok, ${fail} falha(s)`)
  if (fail > 0) process.exit(1)
  console.log("DOC21 em produção: um upload, um registro, três visões ✅")
}

main().catch((e) => { console.error(e); process.exit(1) })
