// prisma/seed-regras-tarefa-transversal.ts
import { PrismaClient, Prisma } from "@prisma/client"
const prisma = new PrismaClient()

async function main() {
  const ruleKey = "cross_rule_missing_birth_place"
  const existe = await prisma.regraTarefaTransversal.findUnique({ where: { ruleKey } })
  if (existe) { console.log("Regra padrão já existe — nada a fazer."); return }

  // resolve o modelo pela chave (pra pegar o id numérico)
  const tpl = await prisma.modeloTarefaTransversal.findUnique({
    where: { templateKey: "cross_tpl_investigative_certificate" },
  })

  await prisma.regraTarefaTransversal.create({
    data: {
      ruleKey,
      name: "Falta local de nascimento",
      tipoProcessoId: null,
      originPhase: "genealogia",
      operationalPhase: "emissao_documental",
      templateId: tpl ? tpl.id : null,
      trigger: { type: "document_not_located_missing_information", watchedField: "birthPlace", condition: "missingField == birthPlace" } as Prisma.InputJsonValue,
      creation: { mode: "suggest", mandatory: true, defaultSlaDays: null, defaultPriority: "medium" } as Prisma.InputJsonValue,
      originLink: { type: "document", useDocument: true, usePerson: false, useDivergence: false, useProtocolRequirement: false } as Prisma.InputJsonValue,
      duplicatePolicy: { mode: "warn" } as Prisma.InputJsonValue,
      applyResult: { mode: "manual_review", updateTarget: "document", autoResolveIfComplete: false, keepReviewingIfPartial: true } as Prisma.InputJsonValue,
      autoCreate: false,
      suggested: true,
      mandatory: true,
      isSystemTemplate: true,
    },
  })
  console.log("Regra padrão criada: Falta local de nascimento")
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())