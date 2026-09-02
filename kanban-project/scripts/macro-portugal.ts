// scripts/macro-portugal.ts
//
// WORKFLOW MACRO DE PORTUGAL.
//
// Portugal estava OFERTADO no Kanban e sem fluxo nenhum — o motor não sabia
// quais fases existem, então nenhum processo português conseguia andar. Era o
// último CRÍTICO do painel de saúde.
//
// ─── DE ONDE VEM ESTA ESTRUTURA ─────────────────────────────────────────────
// Não é inventada: é COPIADA da Espanha, que tem a mesma modalidade
// (administrativa). A única diferença possível seria a tradução juramentada — e
// ela não se aplica: documento brasileiro já está em português. A Espanha
// também não a tem, então a cópia é literal.
//
// As fases saem do CatalogoFase, o cadastro canônico. Nenhum `phaseKey` é
// escrito aqui.
//
// ⚠ CONFIRA. Se o fluxo português for diferente do espanhol, edite em
// Gerenciamento → Workflow Macro. O macro é versionado; esta é a versão 1.
//
//   Ver:      npx tsx scripts/macro-portugal.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/macro-portugal.ts --aplicar

import { prisma } from "@/lib/prisma"

const APLICAR = process.argv.includes("--aplicar")
/** O tipo que serve de MOLDE. Mesma modalidade, mesmo desenho de fluxo. */
const MOLDE = "ESP-ADM"
const ALVO = "POR-ADM"

async function r<T>(f: () => Promise<T>, n = 20): Promise<T> {
  for (let i = 0; i < n; i++) {
    try { return await f() } catch (e) {
      if (i === n - 1) throw e
      await new Promise((x) => setTimeout(x, Math.min(15000, 1500 * (i + 1))))
    }
  }
  throw new Error("sem conexão")
}

async function main() {
  const molde = await r(() => prisma.tipoProcessoNacionalidade.findUnique({
    where: { code: MOLDE },
    select: {
      code: true, name: true, modalidade: { select: { modalityKey: true } },
      macroWorkflow: { select: { name: true, fases: { orderBy: { ordem: "asc" } } } },
    },
  }))
  const alvo = await r(() => prisma.tipoProcessoNacionalidade.findUnique({
    where: { code: ALVO },
    select: { id: true, name: true, modalidade: { select: { modalityKey: true } }, macroWorkflow: { select: { id: true } } },
  }))

  if (!molde?.macroWorkflow) { console.error(`❌ o molde ${MOLDE} não tem macro.`); process.exit(1) }
  if (!alvo) { console.error(`❌ tipo ${ALVO} não existe.`); process.exit(1) }
  if (alvo.macroWorkflow) { console.log(`✅ ${alvo.name} já tem workflow macro. Nada a fazer.`); return }

  // A cópia só é defensável entre a MESMA modalidade: administrativa e judicial
  // têm fluxos diferentes por natureza.
  if (molde.modalidade.modalityKey !== alvo.modalidade.modalityKey) {
    console.error(`❌ modalidades diferentes (${molde.modalidade.modalityKey} × ${alvo.modalidade.modalityKey}) — não copio.`)
    process.exit(1)
  }

  // Toda fase copiada tem de existir no catálogo canônico.
  const catalogo = new Set((await r(() => prisma.catalogoFase.findMany({ where: { ativo: true }, select: { phaseKey: true } })))
    .map((f) => f.phaseKey))
  const fora = molde.macroWorkflow.fases.filter((f) => !catalogo.has(f.phaseKey))
  if (fora.length) { console.error(`❌ fases fora do catálogo: ${fora.map((f) => f.phaseKey).join(", ")}`); process.exit(1) }

  console.log(`WORKFLOW MACRO PARA ${alvo.name}\n`)
  console.log(`  molde: ${molde.name} (${molde.modalidade.modalityKey})`)
  console.log(`  ${molde.macroWorkflow.fases.length} fases:\n`)
  for (const f of molde.macroWorkflow.fases) {
    console.log(`     ${String(f.ordem).padStart(2)}. ${f.phaseKey.padEnd(32)} ${f.required ? "obrigatória" : "opcional   "} · SLA ${f.slaDays}d · kanban=${f.showInKanban}`)
  }

  if (!APLICAR) { console.log("\nDRY-RUN: nada foi escrito."); return }
  if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "1") {
    console.error("\n❌ Escrita não confirmada. Defina EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1.")
    process.exit(1)
  }

  const criado = await r(() => prisma.macroWorkflow.create({
    data: {
      tipoProcessoId: alvo.id,
      name: `Workflow Macro · ${alvo.name}`,
      ativo: true,
      versao: 1,
      fases: {
        create: molde.macroWorkflow!.fases.map((f) => ({
          phaseKey: f.phaseKey, label: f.label, ordem: f.ordem,
          required: f.required, conditional: f.conditional,
          entryRule: f.entryRule, exitRule: f.exitRule,
          slaDays: f.slaDays, showInKanban: f.showInKanban, versao: 1,
        })),
      },
    },
    select: { id: true, name: true, fases: { select: { id: true } } },
  }))
  console.log(`\n✅ macro #${criado.id} "${criado.name}" criado com ${criado.fases.length} fases.`)
  console.log(`\n⚠ COPIADO DA ESPANHA. Se o fluxo português for diferente, edite em`)
  console.log(`   Gerenciamento → Workflow Macro. O macro é versionado; esta é a versão 1.`)
}

main().finally(() => prisma.$disconnect())
