/**
 * FASE 2B — Seed dos Modelos de Workflow Interno (biblioteca).
 * 10 templates padrão (1 por fase), cada um com sua lista de passos.
 * Re-rodável: upsert por templateKey.
 *   - templateKey já existe -> só backfill (isSystemTemplate + recommendedPhases);
 *     NÃO recria/mexe nos passos (preserva edições).
 *   - templateKey novo      -> cria template + passos.
 * Os passos seguem os defaults do mockup (_iwtStep): gera tarefa, obrigatório,
 * prioridade média, SLA 3 dias.
 *
 * Rodar:  npx tsx prisma/seed-motor-2b.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// phaseKey -> label (igual ao CatalogoFase / labels do app)
const PHASE_LABEL: Record<string, string> = {
  genealogia: 'Genealogia',
  emissao_documental: 'Emissão Documental',
  analise_documental: 'Análise Documental',
  retificacao: 'Retificação de Registros',
  emissao_documental_retificada: 'Emissão Documental Retificada',
  traducao: 'Tradução Juramentada',
  apostilamento: 'Apostilamento',
  aguardando_protocolo: 'Aguardando Protocolo',
  protocolado: 'Protocolado',
  finalizado: 'Finalizado',
};

type Def = { templateKey: string; category: string; name: string; steps: string[] };

// Mapa categoria-mockup -> phaseKey PT:
//   genealogy->genealogia, document_issuance->emissao_documental,
//   document_analysis->analise_documental, rectification->retificacao,
//   rectified_issuance->emissao_documental_retificada, translation->traducao,
//   apostille->apostilamento, awaiting_protocol->aguardando_protocolo,
//   protocolled->protocolado, finished->finalizado
const DEFS: Def[] = [
  {
    templateKey: 'iw_tpl_genealogy_default',
    category: 'genealogia',
    name: 'Genealogia padrão',
    steps: [
      'Buscar certidão',
      'Registrar tentativa',
      'Marcar documento localizado',
      'Marcar documento desnecessário',
      'Validar localização de todos os documentos necessários',
    ],
  },
  {
    templateKey: 'iw_tpl_issuance_default',
    category: 'emissao_documental',
    name: 'Emissão Documental padrão',
    steps: [
      'Solicitar certidão',
      'Aguardar retorno do cartório',
      'Receber certidão',
      'Conferir certidão',
      'Validar certidão',
    ],
  },
  {
    templateKey: 'iw_tpl_analysis_default',
    category: 'analise_documental',
    name: 'Análise Documental padrão',
    steps: [
      'Preparar pacote de análise',
      'Comparar nomes, datas, locais e filiação',
      'Registrar divergências',
      'Classificar criticidade',
      'Concluir se precisa retificar ou não',
    ],
  },
  {
    templateKey: 'iw_tpl_rectification_default',
    category: 'retificacao',
    name: 'Retificação de Registros padrão',
    steps: [
      'Definir modo de retificação',
      'Preparar requerimento ou petição',
      'Protocolar retificação',
      'Acompanhar decisão',
      'Registrar averbação',
      'Validar retificação',
    ],
  },
  {
    templateKey: 'iw_tpl_rectified_issuance_default',
    category: 'emissao_documental_retificada',
    name: 'Emissão Documental Retificada padrão',
    steps: [
      'Solicitar averbação',
      'Solicitar certidão retificada',
      'Aguardar retorno',
      'Receber certidão retificada',
      'Conferir certidão retificada',
      'Validar certidão retificada',
    ],
  },
  {
    templateKey: 'iw_tpl_translation_default',
    category: 'traducao',
    name: 'Tradução Juramentada padrão',
    steps: [
      'Preparar pacote completo',
      'Enviar ao tradutor',
      'Aguardar tradução',
      'Receber tradução',
      'Conferir tradução',
      'Validar tradução',
    ],
  },
  {
    templateKey: 'iw_tpl_apostille_default',
    category: 'apostilamento',
    name: 'Apostilamento padrão',
    steps: [
      'Preparar pacote',
      'Enviar para apostilamento',
      'Aguardar retorno',
      'Receber apostilas',
      'Conferir apostilas',
      'Validar apostilamento',
    ],
  },
  {
    templateKey: 'iw_tpl_awaiting_protocol_default',
    category: 'aguardando_protocolo',
    name: 'Aguardando Protocolo padrão',
    steps: [
      'Preparar dossiê',
      'Revisar requisitos',
      'Aguardar janela ou agendamento',
      'Confirmar disponibilidade de protocolo',
    ],
  },
  {
    templateKey: 'iw_tpl_protocolled_default',
    category: 'protocolado',
    name: 'Protocolado padrão',
    steps: [
      'Registrar protocolo',
      'Acompanhar andamento',
      'Registrar exigência, se houver',
      'Responder exigência',
      'Aguardar decisão',
    ],
  },
  {
    templateKey: 'iw_tpl_finished_default',
    category: 'finalizado',
    name: 'Finalizado padrão',
    steps: [
      'Conferir conclusão',
      'Registrar resultado',
      'Arquivar processo',
      'Encerrar financeiro, se aplicável',
    ],
  },
];

async function main() {
  let created = 0;
  let backfilled = 0;
  for (const def of DEFS) {
    const existing = await prisma.modeloWorkflowInterno.findUnique({
      where: { templateKey: def.templateKey },
    });
    if (existing) {
      // Backfill mínimo — NÃO mexe nos passos (preserva edições).
      await prisma.modeloWorkflowInterno.update({
        where: { templateKey: def.templateKey },
        data: {
          isSystemTemplate: true,
          recommendedPhases: existing.recommendedPhases ?? [def.category],
        },
      });
      backfilled++;
    } else {
      await prisma.modeloWorkflowInterno.create({
        data: {
          templateKey: def.templateKey,
          name: def.name,
          description: `Modelo padrão de workflow interno para a fase de ${PHASE_LABEL[def.category] || def.category}.`,
          category: def.category,
          recommendedPhases: [def.category],
          isSystemTemplate: true,
          passos: {
            create: def.steps.map((label, i) => ({
              ordem: i + 1,
              name: label,
              generatesTask: true,
              required: true,
              defaultPriority: 'medium',
              defaultSlaDays: 3,
              checklist: [],
            })),
          },
        },
      });
      created++;
    }
  }
  console.log(
    `✓ Modelos de Workflow Interno: ${created} criados, ${backfilled} com backfill. Total esperado: ${DEFS.length}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });