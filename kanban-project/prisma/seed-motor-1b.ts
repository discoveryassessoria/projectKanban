// prisma/seed-motor-1b.ts
// Seed da Fase 1B: catálogo das 10 fases padrão (building blocks do Workflow Macro).
// Rodar uma vez:  npx tsx prisma/seed-motor-1b.ts
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// As 10 fases padrão (batem com o enum FaseCode do sistema vivo).
// required=false + conditional=true nas duas fases condicionais (retificação).
const FASES = [
  { phaseKey: 'genealogia',                    label: 'Genealogia',                     ordemPadrao: 1,  requiredPadrao: true,  conditionalPadrao: false, slaDiasPadrao: 30 },
  { phaseKey: 'emissao_documental',            label: 'Emissão Documental',             ordemPadrao: 2,  requiredPadrao: true,  conditionalPadrao: false, slaDiasPadrao: 30 },
  { phaseKey: 'analise_documental',            label: 'Análise Documental',             ordemPadrao: 3,  requiredPadrao: true,  conditionalPadrao: false, slaDiasPadrao: 30 },
  { phaseKey: 'retificacao',                   label: 'Retificação de Registros',       ordemPadrao: 4,  requiredPadrao: false, conditionalPadrao: true,  slaDiasPadrao: 30 },
  { phaseKey: 'emissao_documental_retificada', label: 'Emissão Documental Retificada',  ordemPadrao: 5,  requiredPadrao: false, conditionalPadrao: true,  slaDiasPadrao: 30 },
  { phaseKey: 'traducao',                      label: 'Tradução Juramentada',           ordemPadrao: 6,  requiredPadrao: true,  conditionalPadrao: false, slaDiasPadrao: 30 },
  { phaseKey: 'apostilamento',                 label: 'Apostilamento',                  ordemPadrao: 7,  requiredPadrao: true,  conditionalPadrao: false, slaDiasPadrao: 30 },
  { phaseKey: 'aguardando_protocolo',          label: 'Aguardando Protocolo',           ordemPadrao: 8,  requiredPadrao: true,  conditionalPadrao: false, slaDiasPadrao: 30 },
  { phaseKey: 'protocolado',                   label: 'Protocolado',                    ordemPadrao: 9,  requiredPadrao: true,  conditionalPadrao: false, slaDiasPadrao: 30 },
  { phaseKey: 'finalizado',                    label: 'Finalizado',                     ordemPadrao: 10, requiredPadrao: true,  conditionalPadrao: false, slaDiasPadrao: 30 },
]

async function main() {
  for (const f of FASES) {
    await prisma.catalogoFase.upsert({ where: { phaseKey: f.phaseKey }, update: f, create: f })
  }
  console.log(`Seed motor 1B OK — ${FASES.length} fases no catálogo.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())