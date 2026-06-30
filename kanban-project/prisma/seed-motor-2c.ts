/**
 * FASE 2C — Seed dos Modelos de Automação (biblioteca).
 * 25 automações padrão: 10 tarefa + 10 financeiro + 5 avanço de fase.
 * Re-rodável: upsert por templateKey (existente -> backfill mínimo; novo -> cria).
 * categorias/fases do mockup mapeadas p/ phaseKeys PT ('protocol' -> 'protocolado').
 *
 * Rodar:  npx tsx prisma/seed-motor-2c.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type Cond = { field: string; operator: string; value: string };
type Def = {
  templateKey: string;
  name: string;
  description: string;
  type: string;
  category: string; // phaseKey
  recommendedPhases: string[]; // phaseKeys
  scope?: string;
  trigger: string;
  action: string;
  conditions?: Cond[];
  financialType?: 'revenue' | 'cost';
  idempotencyPattern?: string;
};

const DEFS: Def[] = [
  // ===== TAREFA (10) =====
  { templateKey: 'auto_tpl_doc_tasks_line_person', name: 'Criar tarefas documentais para pessoa da linha reta', description: 'Quando uma pessoa da linha reta for criada, o sistema cria as tarefas documentais necessárias.', type: 'task', category: 'genealogia', recommendedPhases: ['genealogia'], scope: 'person_document', trigger: 'person_added', action: 'create_document_tasks', idempotencyPattern: 'processId+phaseKey+personId+documentType' },
  { templateKey: 'auto_tpl_search_task_required', name: 'Criar tarefa de busca para documento necessário', description: 'Quando um documento for marcado como necessário, cria/reativa a tarefa de busca.', type: 'task', category: 'genealogia', recommendedPhases: ['genealogia'], trigger: 'document_validated', action: 'create_or_reactivate_document_search_task' },
  { templateKey: 'auto_tpl_suspend_unneeded', name: 'Suspender tarefa de documento desnecessário', description: 'Quando um documento for marcado como desnecessário, suspende a tarefa relacionada.', type: 'task', category: 'genealogia', recommendedPhases: ['genealogia'], trigger: 'document_validated', action: 'suspend_document_task' },
  { templateKey: 'auto_tpl_issuance_tasks', name: 'Criar tarefas de emissão documental ao entrar na fase', description: 'Ao entrar na Emissão Documental, cria as tarefas de emissão dos documentos necessários.', type: 'task', category: 'emissao_documental', recommendedPhases: ['emissao_documental'], trigger: 'phase_entered', action: 'create_issuance_tasks_for_required_documents' },
  { templateKey: 'auto_tpl_analysis_task', name: 'Criar tarefa de análise documental', description: 'Ao entrar na Análise Documental, cria a tarefa de análise.', type: 'task', category: 'analise_documental', recommendedPhases: ['analise_documental'], trigger: 'phase_entered', action: 'create_document_analysis_task' },
  { templateKey: 'auto_tpl_legal_rectification', name: 'Criar tarefa jurídica de retificação', description: 'Quando o modo Judicial for selecionado na Retificação, cria a tarefa jurídica.', type: 'task', category: 'retificacao', recommendedPhases: ['retificacao'], trigger: 'rectification_marked', conditions: [{ field: 'modeKey', operator: 'equals', value: 'judicial' }], action: 'create_legal_task' },
  { templateKey: 'auto_tpl_admin_rectification', name: 'Criar tarefa administrativa de retificação', description: 'Quando o modo Administrativa for selecionado, cria a tarefa de retificação no cartório.', type: 'task', category: 'retificacao', recommendedPhases: ['retificacao'], trigger: 'rectification_marked', conditions: [{ field: 'modeKey', operator: 'equals', value: 'administrative' }], action: 'create_registry_rectification_task' },
  { templateKey: 'auto_tpl_translation_task', name: 'Criar tarefa de tradução', description: 'Ao entrar na Tradução, cria a tarefa do pacote de tradução.', type: 'task', category: 'traducao', recommendedPhases: ['traducao'], trigger: 'phase_entered', action: 'create_translation_package_task' },
  { templateKey: 'auto_tpl_apostille_task', name: 'Criar tarefa de apostilamento', description: 'Ao entrar no Apostilamento, cria a tarefa do pacote de apostilamento.', type: 'task', category: 'apostilamento', recommendedPhases: ['apostilamento'], trigger: 'phase_entered', action: 'create_apostille_package_task' },
  { templateKey: 'auto_tpl_protocol_followup', name: 'Criar acompanhamento de protocolo', description: 'Quando o protocolo for criado, cria a tarefa de acompanhamento.', type: 'task', category: 'protocolado', recommendedPhases: ['protocolado'], trigger: 'protocol_created', action: 'create_protocol_follow_up' },
  // ===== FINANCEIRO (10) =====
  { templateKey: 'auto_tpl_rev_initial_fees', name: 'Criar receita de honorários iniciais', description: 'Ao entrar na Genealogia, lança a receita de honorários iniciais.', type: 'financial', category: 'genealogia', recommendedPhases: ['genealogia'], trigger: 'phase_entered', action: 'create_revenue', financialType: 'revenue' },
  { templateKey: 'auto_tpl_rev_doc_folder', name: 'Criar receita de pasta documental', description: 'Lança a receita da pasta documental.', type: 'financial', category: 'emissao_documental', recommendedPhases: ['genealogia', 'emissao_documental'], trigger: 'phase_entered', action: 'create_revenue', financialType: 'revenue' },
  { templateKey: 'auto_tpl_cost_certificate', name: 'Criar custo de certidão/cartório', description: 'Quando uma certidão for solicitada, lança o custo de cartório.', type: 'financial', category: 'emissao_documental', recommendedPhases: ['emissao_documental'], trigger: 'phase_entered', action: 'create_cost', financialType: 'cost' },
  { templateKey: 'auto_tpl_rev_rectification', name: 'Criar receita de retificação', description: 'Quando o modo de retificação for definido, lança a receita de retificação.', type: 'financial', category: 'retificacao', recommendedPhases: ['retificacao'], trigger: 'rectification_marked', action: 'create_revenue', financialType: 'revenue' },
  { templateKey: 'auto_tpl_cost_lawyer', name: 'Criar custo/honorário de advogado', description: 'Quando o modo Judicial for selecionado, lança o custo de advogado.', type: 'financial', category: 'retificacao', recommendedPhases: ['retificacao'], trigger: 'rectification_marked', conditions: [{ field: 'modeKey', operator: 'equals', value: 'judicial' }], action: 'create_cost', financialType: 'cost' },
  { templateKey: 'auto_tpl_cost_translator', name: 'Criar custo de tradutor', description: 'Ao entrar na Tradução, lança o custo do tradutor.', type: 'financial', category: 'traducao', recommendedPhases: ['traducao'], trigger: 'phase_entered', action: 'create_cost', financialType: 'cost' },
  { templateKey: 'auto_tpl_rev_translation', name: 'Criar receita de tradução', description: 'Ao entrar na Tradução, lança a receita de tradução.', type: 'financial', category: 'traducao', recommendedPhases: ['traducao'], trigger: 'phase_entered', action: 'create_revenue', financialType: 'revenue' },
  { templateKey: 'auto_tpl_cost_apostille', name: 'Criar custo de apostilamento', description: 'Ao entrar no Apostilamento, lança o custo.', type: 'financial', category: 'apostilamento', recommendedPhases: ['apostilamento'], trigger: 'phase_entered', action: 'create_cost', financialType: 'cost' },
  { templateKey: 'auto_tpl_rev_apostille', name: 'Criar receita de apostilamento', description: 'Ao entrar no Apostilamento, lança a receita.', type: 'financial', category: 'apostilamento', recommendedPhases: ['apostilamento'], trigger: 'phase_entered', action: 'create_revenue', financialType: 'revenue' },
  { templateKey: 'auto_tpl_cost_protocol', name: 'Criar taxa/custo de protocolo', description: 'Quando o protocolo for criado, lança a taxa/custo de protocolo.', type: 'financial', category: 'protocolado', recommendedPhases: ['protocolado'], trigger: 'protocol_created', action: 'create_cost', financialType: 'cost' },
  // ===== AVANÇO DE FASE (5) =====
  { templateKey: 'auto_tpl_unlock_issuance', name: 'Liberar Emissão Documental quando documentos da Genealogia estiverem localizados', description: 'Quando todos os documentos necessários forem localizados, libera a próxima fase.', type: 'phase_transition', category: 'genealogia', recommendedPhases: ['genealogia'], trigger: 'document_validated', action: 'unlock_next_phase' },
  { templateKey: 'auto_tpl_unlock_analysis', name: 'Liberar Análise Documental quando certidões forem validadas', description: 'Quando todas as certidões forem validadas, libera a Análise Documental.', type: 'phase_transition', category: 'emissao_documental', recommendedPhases: ['emissao_documental'], trigger: 'document_validated', action: 'unlock_next_phase' },
  { templateKey: 'auto_tpl_skip_rectification', name: 'Pular Retificação quando análise concluir que não precisa', description: 'Quando a análise concluir que não há retificação, pula a Retificação e a Emissão Retificada.', type: 'phase_transition', category: 'analise_documental', recommendedPhases: ['analise_documental'], trigger: 'divergence_detected', action: 'skip_rectification_and_rectified_issuance' },
  { templateKey: 'auto_tpl_unlock_rectified', name: 'Liberar Emissão Retificada após retificação concluída', description: 'Quando a retificação for concluída, libera a Emissão Documental Retificada.', type: 'phase_transition', category: 'retificacao', recommendedPhases: ['retificacao'], trigger: 'rectification_marked', action: 'unlock_next_phase' },
  { templateKey: 'auto_tpl_unlock_finished', name: 'Liberar Finalizado após decisão final', description: 'Quando a decisão final for registrada, libera o Finalizado.', type: 'phase_transition', category: 'protocolado', recommendedPhases: ['protocolado'], trigger: 'protocol_created', action: 'unlock_next_phase' },
];

function buildDefaultParams(d: Def): Prisma.InputJsonValue {
  const dp: Record<string, string | number | string[]> = {
    responsibleRole: '',
    priority: 'medium',
    slaDays: 3,
    checklist: [],
  };
  if (d.financialType) dp.financialType = d.financialType;
  return dp;
}

async function main() {
  let created = 0;
  let backfilled = 0;
  for (const d of DEFS) {
    const existing = await prisma.modeloAutomacao.findUnique({ where: { templateKey: d.templateKey } });
    if (existing) {
      await prisma.modeloAutomacao.update({
        where: { templateKey: d.templateKey },
        data: {
          isSystemTemplate: true,
          recommendedPhases: (existing.recommendedPhases ?? d.recommendedPhases) as Prisma.InputJsonValue,
        },
      });
      backfilled++;
    } else {
      await prisma.modeloAutomacao.create({
        data: {
          templateKey: d.templateKey,
          name: d.name,
          description: d.description,
          type: d.type,
          category: d.category,
          recommendedPhases: d.recommendedPhases,
          scope: d.scope || 'phase',
          trigger: d.trigger,
          action: d.action,
          conditions: d.conditions || [],
          defaultParams: buildDefaultParams(d),
          idempotencyPattern: d.idempotencyPattern || 'processId+phaseKey',
          isSystemTemplate: true,
        },
      });
      created++;
    }
  }
  console.log(
    `✓ Modelos de Automação: ${created} criados, ${backfilled} com backfill. Total esperado: ${DEFS.length}.`,
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