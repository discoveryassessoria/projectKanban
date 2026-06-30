/**
 * seed-motor-2a.ts  —  FASE 2A: Modelos Internos de Fase (19 modos padrão)
 *
 * Re-rodável: faz upsert pelo composto @@unique([category, modeKey]).
 *  - Modo que JÁ existe (os 19 que você já populou) -> UPDATE que apenas
 *    faz backfill de `recommendedPhases = [category]` e garante isSystemTemplate=true.
 *    NÃO mexe em name/descrição/impactos/arquivado/usedByCount.
 *  - Modo faltante -> CREATE completo.
 * Resultado: 0 duplicados; os 19 ganham as Fases recomendadas.
 *
 * Mapa categoria-mockup -> phaseKey real (CatalogoFase / FaseCode):
 *   rectification -> retificacao
 *   protocol      -> protocolado
 *   translation   -> traducao
 *   apostille     -> apostilamento
 *
 * Rodar:  npx tsx prisma/seed-motor-2a.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Def = {
  modeKey: string;
  category: string; // phaseKey
  name: string;
  description?: string;
  conditionOfUse?: string;
  operationalImpact?: string;
  documentalImpact?: string;
  financialImpact?: string;
  protocolImpact?: string;
};

const DEFS: Def[] = [
  // ---- Retificação de Registros (retificacao) ----
  { modeKey: 'pending_definition', category: 'retificacao', name: 'A definir',
    description: 'Modo ainda não definido.',
    conditionOfUse: 'Quando ainda não se sabe o tipo de retificação necessária.',
    operationalImpact: 'Mantém a fase aguardando definição.' },
  { modeKey: 'administrative', category: 'retificacao', name: 'Administrativa',
    description: 'Retificação por via administrativa (cartório).',
    conditionOfUse: 'Quando a divergência pode ser corrigida no próprio cartório.',
    operationalImpact: 'Ativa fluxo administrativo de retificação.',
    documentalImpact: 'Habilita requerimento e averbação no cartório.',
    financialImpact: 'Pode gerar custo de cartório e receita de retificação.',
    protocolImpact: 'Protocolo no cartório.' },
  { modeKey: 'judicial', category: 'retificacao', name: 'Judicial',
    description: 'Retificação por via judicial.',
    conditionOfUse: 'Quando a divergência exigir processo judicial.',
    operationalImpact: 'Ativa fluxo jurídico e tarefas de advogado.',
    documentalImpact: 'Habilita petição, protocolo, decisão, sentença e averbação.',
    financialImpact: 'Pode gerar custo/honorário de advogado e receita de retificação.',
    protocolImpact: 'Pode exigir protocolo judicial.' },
  { modeKey: 'mixed', category: 'retificacao', name: 'Mista',
    description: 'Retificação por via judicial e administrativa.',
    conditionOfUse: 'Quando parte da correção é judicial e parte administrativa.',
    operationalImpact: 'Ativa os dois fluxos.',
    documentalImpact: 'Combina petições e requerimentos.',
    financialImpact: 'Pode gerar custos dos dois tipos.',
    protocolImpact: 'Protocolos judicial e administrativo.' },
  { modeKey: 'not_required', category: 'retificacao', name: 'Não necessária',
    description: 'Sem necessidade de retificação.',
    conditionOfUse: 'Quando a análise concluir que não há divergências a corrigir.',
    operationalImpact: 'Permite pular a retificação.' },

  // ---- Protocolo (protocolado) ----
  { modeKey: 'per_applicant', category: 'protocolado', name: 'Por requerente',
    description: 'Protocolo individual por requerente.',
    conditionOfUse: 'Quando cada requerente protocola separadamente.',
    operationalImpact: 'Gera um protocolo por pessoa.',
    protocolImpact: 'Vários protocolos.' },
  { modeKey: 'per_family', category: 'protocolado', name: 'Por família/processo',
    description: 'Protocolo único por família/processo.',
    conditionOfUse: 'Quando a família protocola em conjunto.',
    operationalImpact: 'Gera um protocolo para todo o processo.',
    protocolImpact: 'Protocolo único.' },
  { modeKey: 'judicial_case', category: 'protocolado', name: 'Processo judicial',
    description: 'Protocolo via processo judicial.',
    conditionOfUse: 'Quando o reconhecimento é por via judicial.',
    operationalImpact: 'Ativa acompanhamento processual.',
    protocolImpact: 'Protocolo judicial.' },
  { modeKey: 'consular_case', category: 'protocolado', name: 'Consular',
    description: 'Protocolo no consulado.',
    conditionOfUse: 'Quando o protocolo é feito junto ao consulado.',
    protocolImpact: 'Protocolo consular.' },
  { modeKey: 'comune_case', category: 'protocolado', name: 'Comune',
    description: 'Protocolo na comune (Itália).',
    conditionOfUse: 'Quando o protocolo é feito na comune italiana.',
    protocolImpact: 'Protocolo na comune.' },
  { modeKey: 'conservatoria_case', category: 'protocolado', name: 'Conservatória',
    description: 'Protocolo na conservatória (Portugal).',
    conditionOfUse: 'Quando o protocolo é feito na conservatória portuguesa.',
    protocolImpact: 'Protocolo na conservatória.' },
  { modeKey: 'administrative_case', category: 'protocolado', name: 'Administrativo',
    description: 'Protocolo por via administrativa.',
    conditionOfUse: 'Quando o protocolo é administrativo.',
    protocolImpact: 'Protocolo administrativo.' },

  // ---- Tradução (traducao) ----
  { modeKey: 'full_package_translation', category: 'traducao', name: 'Pacote completo',
    description: 'Tradução de todos os documentos.',
    conditionOfUse: 'Quando todos os documentos precisam de tradução juramentada.',
    operationalImpact: 'Gera tarefa de tradução completa.',
    documentalImpact: 'Todos os documentos traduzidos.',
    financialImpact: 'Custo de tradutor e receita de tradução.' },
  { modeKey: 'partial_translation', category: 'traducao', name: 'Parcial',
    description: 'Tradução apenas de parte dos documentos.',
    conditionOfUse: 'Quando só alguns documentos precisam de tradução.',
    operationalImpact: 'Gera tarefa de tradução parcial.' },
  { modeKey: 'not_required', category: 'traducao', name: 'Não necessária',
    description: 'Sem necessidade de tradução.',
    conditionOfUse: 'Quando os documentos não precisam de tradução.',
    operationalImpact: 'Permite pular a tradução.' },

  // ---- Apostilamento (apostilamento) ----
  { modeKey: 'full_package_apostille', category: 'apostilamento', name: 'Pacote completo',
    description: 'Apostilamento de todos os documentos.',
    conditionOfUse: 'Quando todos os documentos precisam de apostila.',
    operationalImpact: 'Gera tarefa de apostilamento completo.',
    documentalImpact: 'Todos os documentos apostilados.',
    financialImpact: 'Custo e receita de apostilamento.' },
  { modeKey: 'partial_apostille', category: 'apostilamento', name: 'Parcial',
    description: 'Apostilamento parcial.',
    conditionOfUse: 'Quando só alguns documentos precisam de apostila.' },
  { modeKey: 'legalization_required', category: 'apostilamento', name: 'Legalização',
    description: 'Legalização consular (quando não cabe apostila).',
    conditionOfUse: 'Quando o país não aceita apostila e exige legalização.',
    operationalImpact: 'Ativa fluxo de legalização consular.',
    financialImpact: 'Custo de legalização.' },
  { modeKey: 'not_required', category: 'apostilamento', name: 'Não necessário',
    description: 'Sem necessidade de apostilamento.',
    conditionOfUse: 'Quando os documentos não precisam de apostila.',
    operationalImpact: 'Permite pular o apostilamento.' },
];

async function main() {
  let created = 0;
  let backfilled = 0;
  for (const d of DEFS) {
    const existing = await prisma.modeloInternoFase.findUnique({
      where: { category_modeKey: { category: d.category, modeKey: d.modeKey } },
    });
    await prisma.modeloInternoFase.upsert({
      where: { category_modeKey: { category: d.category, modeKey: d.modeKey } },
      // Backfill mínimo no que já existe: só recommendedPhases + isSystemTemplate.
      update: {
        recommendedPhases: [d.category],
        isSystemTemplate: true,
      },
      // Create completo para o que faltar.
      create: {
        name: d.name,
        modeKey: d.modeKey,
        category: d.category,
        recommendedPhases: [d.category],
        description: d.description ?? null,
        conditionOfUse: d.conditionOfUse ?? null,
        operationalImpact: d.operationalImpact ?? null,
        documentalImpact: d.documentalImpact ?? null,
        financialImpact: d.financialImpact ?? null,
        protocolImpact: d.protocolImpact ?? null,
        isSystemTemplate: true,
        arquivado: false,
      },
    });
    if (existing) backfilled++; else created++;
  }
  console.log(`✓ Modelos Internos de Fase: ${created} criados, ${backfilled} com backfill de recommendedPhases. Total esperado: ${DEFS.length}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });