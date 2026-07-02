// prisma/seed-tarefa-transversal.ts
import { PrismaClient, Prisma } from "@prisma/client"
const prisma = new PrismaClient()

const MODELOS = [
  { templateKey: "cross_tpl_investigative_certificate", name: "Solicitar certidão investigativa", type: "investigative_certificate", description: "Usar Emissão Documental para solicitar certidão de apoio e devolver o resultado à fase de origem.", defaultOperationalPhase: "emissao_documental", recommendedForOriginPhases: ["genealogia", "analise_documental", "retificacao"] },
  { templateKey: "cross_tpl_support_certificate", name: "Solicitar certidão de apoio", type: "support_certificate", description: "Certidão de apoio para resolver divergência.", defaultOperationalPhase: "emissao_documental", recommendedForOriginPhases: ["analise_documental"] },
  { templateKey: "cross_tpl_complementary_data", name: "Buscar dado complementar", type: "custom", description: "Buscar dado genealógico complementar.", defaultOperationalPhase: "genealogia", recommendedForOriginPhases: ["emissao_documental"] },
  { templateKey: "cross_tpl_document_complement", name: "Solicitar complemento documental", type: "document_complement", description: "Solicitar documento complementar.", defaultOperationalPhase: "emissao_documental", recommendedForOriginPhases: ["retificacao", "protocolado"] },
  { templateKey: "cross_tpl_fix_rectified", name: "Corrigir registro retificado", type: "document_correction", description: "Corrigir registro após retificação.", defaultOperationalPhase: "retificacao", recommendedForOriginPhases: ["emissao_documental_retificada"] },
  { templateKey: "cross_tpl_fix_reemit", name: "Corrigir ou reemitir documento", type: "document_correction", description: "Corrigir ou reemitir documento com problema.", defaultOperationalPhase: "emissao_documental", recommendedForOriginPhases: ["traducao", "apostilamento"] },
  { templateKey: "cross_tpl_fix_translation", name: "Corrigir tradução", type: "translation_correction", description: "Corrigir tradução com erro.", defaultOperationalPhase: "traducao", recommendedForOriginPhases: ["apostilamento", "protocolado"] },
  { templateKey: "cross_tpl_reapostille", name: "Reapostilar documento", type: "reapostille", description: "Reapostilar documento recusado.", defaultOperationalPhase: "apostilamento", recommendedForOriginPhases: ["protocolado"] },
  { templateKey: "cross_tpl_complement_dossier", name: "Complementar dossiê", type: "protocol_complement", description: "Complementar dossiê de protocolo com documento de fase anterior.", defaultOperationalPhase: "emissao_documental", recommendedForOriginPhases: ["protocolado"] },
]

async function main() {
  let criados = 0, existentes = 0
  for (const m of MODELOS) {
    const existe = await prisma.modeloTarefaTransversal.findUnique({ where: { templateKey: m.templateKey } })
    if (existe) { existentes++; continue }
    await prisma.modeloTarefaTransversal.create({
      data: {
        templateKey: m.templateKey,
        name: m.name,
        type: m.type,
        description: m.description,
        defaultOperationalPhase: m.defaultOperationalPhase,
        defaultMandatory: true,
        defaultResultAction: "apply_back_to_origin_phase",
        recommendedForOriginPhases: m.recommendedForOriginPhases as Prisma.InputJsonValue,
        defaultEffects: { createsDocument: false, createsCost: false, createsRevenue: false } as Prisma.InputJsonValue,
        defaultOriginLinkType: "document",
        isSystemTemplate: true,
      },
    })
    criados++
  }
  console.log(`Modelos de Tarefa Transversal — criados: ${criados}, já existiam: ${existentes}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())