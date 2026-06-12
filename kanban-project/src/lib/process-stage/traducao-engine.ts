// ============================================================
// src/lib/process-stage/traducao-engine.ts
// ------------------------------------------------------------
// Cérebro PURO da fase "Tradução juramentada" (pasta única por processo).
// Sem Prisma, sem Next — só decide o que cada etapa faz.
// Espelha completeTranslationStep (~3049) e transitionTranslationStatus
// (~3030) do mockup Operacional.html. NÃO derivar: as listas e as
// transições abaixo são cópia literal do mockup.
// As rotas (Parte 2) chamam applyStep() e gravam o resultado no banco.
// ============================================================

// ---- Listas autoritativas (copiadas do mockup) ----
export const TR_STEPS = [
  ['montar_pasta_traducao', 'Montar pasta de tradução'],
  ['enviar_tradutor_juramentado', 'Enviar ao tradutor juramentado'],
  ['aguardar_retorno_tradutor', 'Aguardar retorno do tradutor'],
  ['receber_traducoes', 'Receber traduções'],
  ['conferir_traducoes', 'Conferir traduções'],
  ['validar_pasta_traduzida', 'Validar pasta traduzida'],
] as const;

export const TR_SHORT = [
  'Montar pasta', 'Enviar ao tradutor', 'Aguardar retorno',
  'Receber traduções', 'Conferir traduções', 'Validar pasta',
] as const;

// Rótulos de status do documento dentro da pasta (para a tela, Parte 3)
export const TR_DOC_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  incluido_na_pasta: 'Incluído na pasta',
  enviado: 'Enviado',
  traducao_recebida: 'Tradução recebida',
  conferido: 'Conferido',
  validado: 'Validado',
  correcao_solicitada: 'Correção solicitada',
  bloqueado: 'Bloqueado',
};

export const DEFAULT_DOC_STATUS = 'pendente';

// ---- Tipos ----
export type TrStepId = (typeof TR_STEPS)[number][0];
export type TrStepStatus = 'bloqueada' | 'pendente' | 'em_andamento' | 'concluida';
export type TrDocStatus =
  | 'pendente' | 'incluido_na_pasta' | 'enviado' | 'traducao_recebida'
  | 'conferido' | 'validado' | 'correcao_solicitada' | 'bloqueado';

export interface TrWorkflowStep {
  id: TrStepId;
  title: string;
  status: TrStepStatus;
  doneAt: string | null;
}

export interface TrDoc {
  documentoId: number;
  pessoaNome: string;
  documentoTitulo: string;
  origem: string;
  status: TrDocStatus;
  translatedFile: string | null;
  conferenceResult: string | null;
  validationDecision: string | null;
}

// Estado da pasta que o motor enxerga (subconjunto do model PastaTraducao).
// As datas (sentAt/expectedDate/receivedAt) trafegam aqui como a STRING
// crua "dd/mm/aaaa" que a tela mandou — a ROTA converte para Date antes
// de gravar no Prisma. validatedAt é setado pela rota (new Date()).
export interface TrFolder {
  status: string;            // em_andamento | concluida | bloqueada | cancelada
  currentStep: TrStepId;
  sourceLanguage: string;
  targetLanguage: string;
  translatorName: string | null;
  translatorEmail: string | null;
  cost: string | null;
  sentAt: string | null;
  expectedDate: string | null;
  receivedAt: string | null;
  workflow: TrWorkflowStep[];
}

export interface ApplyStepResult {
  ok: boolean;
  error?: string;
  /** estado novo da pasta (campos escalares + workflow já atualizados) */
  folder?: TrFolder;
  /** estado novo dos documentos da pasta */
  docs?: TrDoc[];
  /** aprovado na validação → fase conclui e card avança p/ Apostilamento */
  completePhase?: boolean;
  /** correção/bloqueio na validação → pasta volta ao envio, fase NÃO conclui */
  rejected?: boolean;
  /** decisão final escolhida na validação (aprovar | aprovar_ressalvas | ...) */
  decision?: string;
  /** linha de histórico a registrar */
  historyMessage?: string;
}

// ---- Helpers ----
function brDate(): string {
  return new Date().toLocaleDateString('pt-BR');
}

/** Workflow inicial: 1ª etapa pendente, as demais bloqueadas (mockup ~2776). */
export function buildInitialWorkflow(): TrWorkflowStep[] {
  return TR_STEPS.map(([id, title], i) => ({
    id,
    title,
    status: i === 0 ? 'pendente' : 'bloqueada',
    doneAt: null,
  }));
}

/** Progresso = etapas concluídas / total (mockup recalcTranslationProgress ~3014). */
export function calcProgress(workflow: TrWorkflowStep[]): number {
  if (!workflow.length) return 0;
  return Math.round(
    (workflow.filter((s) => s.status === 'concluida').length / workflow.length) * 100,
  );
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Marca a etapa como concluída e destrava a próxima (mockup unlockNextTranslationStep). */
function concludeAndUnlock(folder: TrFolder, stepId: TrStepId) {
  const i = folder.workflow.findIndex((s) => s.id === stepId);
  folder.workflow[i].status = 'concluida';
  folder.workflow[i].doneAt = brDate();
  if (folder.workflow[i + 1]) {
    folder.workflow[i + 1].status = 'pendente';
    folder.currentStep = folder.workflow[i + 1].id;
  }
}

// ============================================================
// applyStep — núcleo da fase (espelha completeTranslationStep ~3049)
// Recebe o estado atual + o payload da etapa; devolve o estado novo
// SEM tocar no banco. Não muta os argumentos (trabalha em cópias).
// ============================================================
export function applyStep(
  folderIn: TrFolder,
  docsIn: TrDoc[],
  stepId: TrStepId,
  payload: any = {},
): ApplyStepResult {
  const folder = clone(folderIn);
  const docs = clone(docsIn);
  const step = folder.workflow.find((s) => s.id === stepId);

  if (!step) return { ok: false, error: 'Etapa inexistente.' };
  if (step.status === 'bloqueada') return { ok: false, error: 'Esta etapa ainda está bloqueada.' };

  const setAllDocs = (s: TrDocStatus) => docs.forEach((d) => { d.status = s; });
  const done = (msg: string): ApplyStepResult => ({ ok: true, folder, docs, historyMessage: msg });
  const histStep = `Etapa "${step.title}" concluída na Tradução juramentada.`;

  switch (stepId) {
    // 1) Montar pasta — exige idiomas + checklist; docs entram na pasta
    case 'montar_pasta_traducao': {
      if (!docs.length || !payload.sourceLanguage || !payload.targetLanguage || !payload.checklistOk) {
        return { ok: false, error: 'Revise documentos, idiomas e checklist.' };
      }
      folder.sourceLanguage = payload.sourceLanguage;
      folder.targetLanguage = payload.targetLanguage;
      setAllDocs('incluido_na_pasta');
      concludeAndUnlock(folder, stepId);
      return done(histStep);
    }

    // 2) Enviar ao tradutor — exige tradutor, envio, prazo e forma de envio
    case 'enviar_tradutor_juramentado': {
      if (!payload.translatorName || !payload.sentAt || !payload.expectedDate || !payload.sendMethod) {
        return { ok: false, error: 'Preencha tradutor, data de envio, prazo e forma de envio.' };
      }
      folder.translatorName = String(payload.translatorName).trim();
      folder.translatorEmail = payload.email || null;
      folder.sentAt = payload.sentAt;            // "dd/mm/aaaa" → rota converte
      folder.expectedDate = payload.expectedDate; // idem
      folder.cost = payload.cost || null;
      setAllDocs('enviado');
      concludeAndUnlock(folder, stepId);
      return done(histStep);
    }

    // 3) Aguardar retorno — sem campo obrigatório (contatos são opcionais)
    case 'aguardar_retorno_tradutor': {
      concludeAndUnlock(folder, stepId);
      return done(histStep);
    }

    // 4) Receber traduções — exige data e anexo de TODOS os documentos
    case 'receber_traducoes': {
      if (!payload.receivedAt) return { ok: false, error: 'Informe a data de recebimento.' };
      const files: Record<string, string> = payload.files || {};
      const allFiles = docs.every((d) => d.translatedFile || files[d.documentoId]);
      if (!allFiles) return { ok: false, error: 'Anexe a tradução de todos os documentos.' };
      folder.receivedAt = payload.receivedAt;     // "dd/mm/aaaa" → rota converte
      folder.cost = payload.custoFinal || folder.cost;
      docs.forEach((d) => {
        d.translatedFile = d.translatedFile || files[d.documentoId] || null;
        d.status = 'traducao_recebida';
      });
      concludeAndUnlock(folder, stepId);
      return done(histStep);
    }

    // 5) Conferir — todos com resultado, nenhum com correção/divergência crítica
    case 'conferir_traducoes': {
      const results: Record<string, string> = payload.results || {};
      docs.forEach((d) => {
        if (results[d.documentoId]) d.conferenceResult = results[d.documentoId];
        if (!d.conferenceResult) d.conferenceResult = 'aprovar';
      });
      const allConf = docs.every(
        (d) => d.conferenceResult &&
          d.conferenceResult !== 'divergencia_critica' &&
          d.conferenceResult !== 'correcao_solicitada',
      );
      if (!allConf) {
        return { ok: false, error: 'Todos os documentos precisam estar conferidos sem correção pendente.' };
      }
      setAllDocs('conferido');
      concludeAndUnlock(folder, stepId);
      return done(histStep);
    }

    // 6) Validar pasta — decisão final ramifica
    case 'validar_pasta_traduzida': {
      if (!payload.decision) return { ok: false, error: 'Selecione a decisão final.' };

      // Correção / bloqueio → REJEITADA: volta ao "enviar", bloqueia posteriores
      if (payload.decision === 'solicitar_correcao' || payload.decision === 'bloquear') {
        const iEnviar = folder.workflow.findIndex((s) => s.id === 'enviar_tradutor_juramentado');
        folder.workflow.forEach((s, j) => { if (j > iEnviar) s.status = 'bloqueada'; });
        folder.workflow[iEnviar].status = 'pendente';
        folder.currentStep = 'enviar_tradutor_juramentado';
        folder.status = 'bloqueada';
        docs.forEach((d) => { if (d.status === 'validado') d.status = 'enviado'; });
        return {
          ok: true, folder, docs, rejected: true, decision: payload.decision,
          historyMessage: payload.decision === 'bloquear'
            ? 'Pasta bloqueada na validação.'
            : 'Correção solicitada ao tradutor.',
        };
      }

      // Aprovar / aprovar com ressalvas → valida pasta e conclui a fase
      step.status = 'concluida';
      step.doneAt = brDate();
      folder.status = 'concluida';
      docs.forEach((d) => { d.status = 'validado'; d.validationDecision = payload.decision; });
      return {
        ok: true, folder, docs, completePhase: true, decision: payload.decision,
        historyMessage: 'Tradução juramentada concluída: pasta traduzida validada.',
      };
    }
  }

  return { ok: false, error: 'Etapa desconhecida.' };
}