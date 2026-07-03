// prisma/seed-perfis-permissao-motor.ts
import { PrismaClient, Prisma } from "@prisma/client"
const prisma = new PrismaClient()

const PERM_KEYS = [
  "manageProcessTypes", "manageWorkflowMacro", "manageTemplates", "applyTemplates",
  "manageAutomations", "manageFinancialRules", "manageDocumentMatrix", "publishConfiguration",
  "deleteUnusedItems", "archiveItems", "viewAudit", "viewFinancial",
]
function todas(val: boolean) {
  const o: Record<string, boolean> = {}
  PERM_KEYS.forEach(k => (o[k] = val))
  return o
}

const PERFIS = [
  { chave: "admin", nome: "Administrador", permissoes: todas(true) },
  { chave: "ops_manager", nome: "Gestor Operacional", permissoes: { ...todas(true), deleteUnusedItems: false } },
  { chave: "analyst", nome: "Analista", permissoes: { ...todas(false), applyTemplates: true, manageAutomations: true, archiveItems: true } },
  { chave: "financial", nome: "Financeiro", permissoes: { ...todas(false), manageFinancialRules: true, viewFinancial: true, archiveItems: true } },
  { chave: "read_only", nome: "Leitura", permissoes: { ...todas(false), viewAudit: true, viewFinancial: true } },
]

async function main() {
  let criados = 0, existentes = 0
  for (const p of PERFIS) {
    const existe = await prisma.perfilPermissaoMotor.findUnique({ where: { chave: p.chave } })
    if (existe) { existentes++; continue }
    await prisma.perfilPermissaoMotor.create({
      data: { chave: p.chave, nome: p.nome, permissoes: p.permissoes as Prisma.InputJsonValue, isSystemTemplate: true },
    })
    criados++
  }
  console.log(`Perfis de permissão — criados: ${criados}, já existiam: ${existentes}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())