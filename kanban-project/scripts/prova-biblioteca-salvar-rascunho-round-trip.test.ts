// scripts/prova-biblioteca-salvar-rascunho-round-trip.test.ts
// ============================================================================
// PROVA — "Salvar rascunho" na Biblioteca de Tarefas sobrevive ao round-trip
// GET → editar → PUT que a tela de fato faz (achado real, 23/09/2026).
//
// ─── O BUG REAL ─────────────────────────────────────────────────────────
// Editar QUALQUER Modelo já publicado da Biblioteca (ex.: "Solicitar
// certidão") e clicar "Salvar rascunho" falhava (500) — e como nada
// persistia, a publicação sempre dizia "não há alteração para publicar",
// mesmo depois de editar e salvar.
//
// Causa: `buildSteps` (PUT /api/gerenciamento/workflows-fase/[id]) decidia
// `bibliotecaModeloId`/`bibliotecaModeloVersao` com
// `Number.isFinite(Number(s?.bibliotecaModeloId)) ? Number(s.bibliotecaModeloId) : null`.
// O passo da PRÓPRIA Biblioteca nunca seleciona outro Modelo, então o GET
// sempre devolve `bibliotecaModeloId: null` — e é EXATAMENTE esse `null` que
// a tela reenvia ao salvar (`salvarPasso` manda o objeto inteiro carregado,
// só com o campo editado trocado). `Number(null)` é `0`, e `Number.isFinite(0)`
// é `true` — então o campo virava `0` em vez de `null`, e `0` não é nenhum
// `BibliotecaModeloTarefa.id` real: a escrita quebrava com violação de FK.
// Qualquer edição de QUALQUER Modelo já publicado batia nisto, sempre —
// não é um caso raro, é o caminho comum ("abrir → editar → salvar").
//
// Os scripts e2e existentes nunca pegaram isto porque sempre montam o corpo
// do PUT do zero (nunca fazem o GET → reenviar). Este teste replica o
// round-trip real: GET (como a tela carrega), edita UM campo, PUT (como
// "Salvar rascunho" envia o objeto inteiro de volta).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("prova-biblioteca-salvar-rascunho-round-trip.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { criarModelo, publicarModelo } from "../src/services/biblioteca-tarefas/modelo"
import { GET, PUT } from "../src/app/api/gerenciamento/workflows-fase/[id]/route"

const MARCA = "BIBROUNDTRIP"

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

async function limpar() {
  const modelos = await prisma.bibliotecaModeloTarefa.findMany({ where: { chave: { startsWith: `${MARCA.toLowerCase()}_` } }, select: { id: true, workflowId: true } })
  await prisma.bibliotecaModeloTarefa.deleteMany({ where: { id: { in: modelos.map((m) => m.id) } } })
  await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: { in: modelos.map((m) => m.workflowId) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: modelos.map((m) => m.workflowId) } } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function main() {
  console.log(`\n=== PROVA — round-trip GET→editar→PUT do Salvar rascunho da Biblioteca (${MARCA}) ===\n`)
  await limpar()
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  console.log("1) criar e publicar um Modelo com conteúdo (mesmo desenho de 'Solicitar certidão')")
  const chave = `${MARCA.toLowerCase()}_solicitar_certidao`
  const criado = await criarModelo({ chave, nome: "[BIBROUNDTRIP] Solicitar certidão", descricao: null, criadoPorId: admin.id })
  check("1.1) modelo criado", criado.ok, criado)
  if (!criado.ok) throw new Error("aborta")

  const subKeys = ["enviar_requerimento", "receber_confirmacao_pedido", "receber_certidao", "conferir_validar_certidao"]
  const r1 = await PUT(new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${criado.workflowId}`, {
    method: "PUT", headers: auth,
    body: JSON.stringify({
      steps: [{
        key: chave, label: "Solicitar certidão", ordem: 1, createsTask: true, required: true, slaDays: 15,
        owner: "equipe_documental", regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
        subtarefas: subKeys.map((k, i) => ({
          key: k, label: k, ordem: i, obrigatoria: true, dependeDe: i > 0 ? [subKeys[i - 1]] : [],
          esperaExternaAoLiberar: i === 1,
          acoes: [{ key: "concluir", label: "Concluir", effectKey: "COMPLETE_STEP", ordem: 0 }],
        })),
      }],
    }),
  }), { params: Promise.resolve({ id: String(criado.workflowId) }) })
  check("1.2) conteúdo inicial salvo", r1.status === 200, { status: r1.status, body: await r1.clone().json().catch(() => null) })

  const pub1 = await publicarModelo(criado.modeloId, admin.id)
  check("1.3) publicado (v2 — v1 é a casca vazia)", pub1.ok && pub1.versaoNova === 2, pub1)

  console.log("\n2) ABRIR (GET, como a tela carrega o editor)")
  const rGet = await GET(new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${criado.workflowId}`, { headers: auth }),
    { params: Promise.resolve({ id: String(criado.workflowId) }) })
  const jGet = await rGet.json()
  const passoCarregado = jGet.workflow.passos[0]
  check("2.1) passo carregado com bibliotecaModeloId explicitamente null (nunca ausente)",
    "bibliotecaModeloId" in passoCarregado && passoCarregado.bibliotecaModeloId === null, passoCarregado.bibliotecaModeloId)

  console.log("\n3) EDITAR só o prazo (15 → 10) e SALVAR — reenvia o objeto INTEIRO carregado, como a tela faz")
  const passoEditado = { ...passoCarregado, slaDays: 10 }
  const r2 = await PUT(new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${criado.workflowId}`, {
    method: "PUT", headers: auth, body: JSON.stringify({ steps: [passoEditado] }),
  }), { params: Promise.resolve({ id: String(criado.workflowId) }) })
  const j2 = await r2.json().catch(() => null)
  check("3.1) SALVAR aceito (200) — antes quebrava com 500 (violação de FK bibliotecaModeloId)", r2.status === 200, { status: r2.status, body: j2 })

  const wfDepois = await prisma.phaseInternalWorkflow.findUniqueOrThrow({ where: { id: criado.workflowId } })
  check("3.2) rascunhoAlteradoEm foi marcado — a alteração REALMENTE persistiu", wfDepois.rascunhoAlteradoEm != null, wfDepois.rascunhoAlteradoEm)

  const passoNoBanco = await prisma.phaseInternalWorkflowStep.findFirst({ where: { workflowId: criado.workflowId } })
  check("3.3) slaDays gravado é 10 (o valor editado, não 15)", passoNoBanco?.slaDays === 10, passoNoBanco?.slaDays)
  check("3.4) bibliotecaModeloId continua null no banco (nunca virou 0)", passoNoBanco?.bibliotecaModeloId === null, passoNoBanco?.bibliotecaModeloId)
  const subsNoBanco = await prisma.stepSubtaskDefinition.count({ where: { stepId: passoNoBanco!.id } })
  check("3.5) as 4 subtarefas sobreviveram ao round-trip (nada foi perdido ao reenviar)", subsNoBanco === 4, subsNoBanco)

  console.log("\n4) A PUBLICAÇÃO agora VÊ a alteração (antes dizia 'não há alteração para publicar')")
  const rPrev = await GET(new NextRequest(`http://localhost/api/gerenciamento/workflows-fase/${criado.workflowId}?preview=1`, { headers: auth }),
    { params: Promise.resolve({ id: String(criado.workflowId) }) })
  const preview = (await rPrev.json()).preview
  check("4.1) temRascunho=true", preview?.temRascunho === true, preview)
  check("4.2) podePublicar=true", preview?.podePublicar === true, preview)
  check("4.3) a mudança de SLA aparece no diff (15 → 10)",
    (preview?.mudancas ?? []).some((m: { detalhe?: string }) => m.detalhe === "SLA (dias): 15 → 10"), preview?.mudancas)

  const pub2 = await publicarModelo(criado.modeloId, admin.id)
  check("4.4) publica a alteração com sucesso (v3)", pub2.ok && pub2.versaoNova === 3, pub2)

  console.log(`\n=== ${ok} passaram, ${falhou} falharam ===`)
  if (falhou > 0) console.error("Falhas:", falhas)

  await limpar()
  console.log("Limpeza concluída — cenário sintético removido.")
  await prisma.$disconnect()
  if (falhou > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  try { await limpar() } catch { /* melhor esforço */ }
  await prisma.$disconnect()
  process.exit(1)
})
