// scripts/hotfix-ordem-subtarefas-solicitar-certidao.ts
// ============================================================================
// CADASTRO TORTO (achado 26/09/2026, junto do bug de "atual" escolhido por
// empate de ordem): o Modelo da Biblioteca de Tarefas "Solicitar certidão"
// (BibliotecaModeloTarefa#2, workflow interno id=50, step id=576 — é AQUI que
// mora o conteúdo real: o step da fase Emissão Documental, id=570, é um
// "passo selecionado da Biblioteca" e não guarda subtarefa própria) tem
// `enviar_requerimento_cartorio` e `receber_confirmacao_pedido` as duas com
// `ordem: 1`. A dependência (`dependeDe`) já as distingue certo, mas a
// `ordem` empatada foi o que permitiu o bug de leitura em
// `progressoPorSubtarefa` (corrigido em outro commit).
//
// Renumera pra sequência limpa 1/2/3/4:
//   enviar_requerimento_cartorio   1 → 1 (sem mudança)
//   receber_confirmacao_pedido     1 → 2
//   receber_certidao               2 → 3
//   conferir_validar_certidao      3 → 4
//
// Isto edita só o RASCUNHO vivo (StepSubtaskDefinition) — não alcança
// nenhum processo já instanciado (produção lê só a versão PUBLICADA,
// congelada; ver o comentário em workflows-fase/[id]/route.ts). Só passa a
// valer pra novos processos depois que alguém publicar de novo a Biblioteca
// e o Workflow Interno da Emissão Documental — decisão do time, não deste
// script.
//
// --dry por padrão. --aplicar exige --prod + EU_CONFIRMO_ESCRITA_EM_PRODUCAO.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"

const APLICAR = process.argv.includes("--aplicar")
const PROD = process.argv.includes("--prod")

const MUDANCAS: { id: number; key: string; de: number; para: number }[] = [
  { id: 132, key: "conferir_validar_certidao", de: 3, para: 4 },
  { id: 131, key: "receber_certidao", de: 2, para: 3 },
  { id: 130, key: "receber_confirmacao_pedido", de: 1, para: 2 },
]

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  const id = identificador(url)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`Banco: ${id} — classificado como ${classe}`)

  if (APLICAR) {
    if (classe === CLASSE.PRODUCAO && !PROD) { console.error("Banco é PRODUÇÃO mas --prod não foi passado. Abortando."); process.exit(1) }
    if (PROD) {
      if (classe !== CLASSE.PRODUCAO) { console.error("--prod pedido mas o banco não é PRODUÇÃO. Abortando."); process.exit(1) }
      if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") { console.error("Falta EU_CONFIRMO_ESCRITA_EM_PRODUCAO. Abortando."); process.exit(1) }
    }
  }

  console.log("\n=== ANTES ===")
  const antes = await prisma.stepSubtaskDefinition.findMany({
    where: { stepId: 576 }, select: { id: true, key: true, ordem: true, dependeDe: true }, orderBy: { id: "asc" },
  })
  for (const s of antes) console.log(JSON.stringify(s))

  for (const m of MUDANCAS) {
    const atual = antes.find((a) => a.id === m.id)
    if (!atual || atual.key !== m.key || atual.ordem !== m.de) {
      console.error(`Estado inesperado pra id=${m.id} (${m.key}): esperava ordem=${m.de}, achei ${JSON.stringify(atual)}. Abortando sem mudar nada.`)
      process.exit(1)
    }
  }

  if (!APLICAR) {
    console.log("\n[dry-run] mudanças que seriam aplicadas:")
    for (const m of MUDANCAS) console.log(`  id=${m.id} (${m.key}): ordem ${m.de} → ${m.para}`)
    console.log("\nRode com --aplicar (e --prod) para escrever de verdade.")
    await prisma.$disconnect()
    return
  }

  for (const m of MUDANCAS) {
    await prisma.stepSubtaskDefinition.update({ where: { id: m.id }, data: { ordem: m.para } })
    console.log(`id=${m.id} (${m.key}): ordem ${m.de} → ${m.para} — aplicado`)
  }

  console.log("\n=== DEPOIS ===")
  const depois = await prisma.stepSubtaskDefinition.findMany({
    where: { stepId: 576 }, select: { id: true, key: true, ordem: true, dependeDe: true }, orderBy: { ordem: "asc" },
  })
  for (const s of depois) console.log(JSON.stringify(s))

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
