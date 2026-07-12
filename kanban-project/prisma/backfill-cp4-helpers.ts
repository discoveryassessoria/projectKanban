// prisma/backfill-cp4-helpers.ts
// CP-4G — helpers PUROS (sem prisma / sem alias @/) do backfill do runtime v2.
// Toda a lógica de RESOLUÇÃO SEGURA e classificação de ambiguidades vive aqui,
// para ser 100% testável sem banco. Regra de ouro: NUNCA inventar relação —
// tudo que for ambíguo é preservado em unresolvedCount/breakdown, nunca criado.

// Breakdown explícito exigido pelo spec (§2).
export interface BackfillBreakdown {
  workflowSemDefinicaoInterna: number
  stepSemDefinicaoSegura: number
  tarefaSemPassoInequivoco: number
  multiplasTarefasParaPasso: number
  multiplosPassosParaTarefa: number
  faseNaoResolvida: number
  cicloNaoDeterminavel: number
  necessidadeAmbigua: number
  documentoAmbiguo: number
  versaoNaoDeterminavel: number
  configV2Invalida: number
}

export function novaBreakdown(): BackfillBreakdown {
  return {
    workflowSemDefinicaoInterna: 0,
    stepSemDefinicaoSegura: 0,
    tarefaSemPassoInequivoco: 0,
    multiplasTarefasParaPasso: 0,
    multiplosPassosParaTarefa: 0,
    faseNaoResolvida: 0,
    cicloNaoDeterminavel: 0,
    necessidadeAmbigua: 0,
    documentoAmbiguo: 0,
    versaoNaoDeterminavel: 0,
    configV2Invalida: 0,
  }
}

export type MotivoBreakdown = keyof BackfillBreakdown

export interface BackfillConflict {
  tipo: MotivoBreakdown
  entityType: string
  entityId: number
  detalhe: string
}

export interface BackfillReport {
  scannedCount: number
  createdWorkflowInstances: number
  createdStepInstances: number
  linkedTasks: number
  linkedNeeds: number
  linkedDocuments: number
  skippedCount: number
  unresolvedCount: number
  breakdown: BackfillBreakdown
  conflicts: BackfillConflict[]
  dryRun: boolean
}

/** unresolvedCount é SEMPRE a soma exata do breakdown (invariante verificável). */
export function somaUnresolved(b: BackfillBreakdown): number {
  return (Object.keys(b) as MotivoBreakdown[]).reduce((acc, k) => acc + b[k], 0)
}

// --------------------------------------------------------------------------
// Resolução segura: exatamente-um-candidato. 0 ⇒ vazio, >1 ⇒ ambíguo.
// Nunca escolhe "o primeiro"; ambiguidade vira motivo de breakdown.
// --------------------------------------------------------------------------

export type Resolucao<T> =
  | { ok: true; valor: T }
  | { ok: false; motivo: MotivoBreakdown; ambiguo: boolean }

export function resolverUnico<T>(
  candidatos: T[],
  motivoVazio: MotivoBreakdown,
  motivoAmbiguo: MotivoBreakdown,
): Resolucao<T> {
  if (candidatos.length === 1) return { ok: true, valor: candidatos[0] }
  if (candidatos.length === 0) return { ok: false, motivo: motivoVazio, ambiguo: false }
  return { ok: false, motivo: motivoAmbiguo, ambiguo: true }
}

/** Processo do Workflow legado (Workflow→Documento→Pessoa→Árvore→Processo é 1:N). */
export function resolverProcessoDoWorkflow(processoIdsCandidatos: number[]): Resolucao<number> {
  return resolverUnico(processoIdsCandidatos, "faseNaoResolvida", "faseNaoResolvida")
}

/** Definição de Workflow Interno correspondente (por fase estável + tipo). */
export function resolverDefinicaoInterna(defsIds: number[]): Resolucao<number> {
  return resolverUnico(defsIds, "workflowSemDefinicaoInterna", "versaoNaoDeterminavel")
}

/** stepDefinition segura por stepKey estável (nunca por título/label). */
export function resolverStepDefinition(stepKey: string, defStepKeys: string[]): Resolucao<string> {
  const iguais = defStepKeys.filter((k) => k === stepKey)
  return resolverUnico(iguais, "stepSemDefinicaoSegura", "stepSemDefinicaoSegura")
}

/** Passo inequívoco para uma Tarefa (vínculo Tarefa→Passo). */
export function resolverPassoDaTarefa(stepInstanceIdsCandidatos: number[]): Resolucao<number> {
  return resolverUnico(stepInstanceIdsCandidatos, "tarefaSemPassoInequivoco", "multiplosPassosParaTarefa")
}

/** Necessidade/Documento com origem documental clara (senão ambíguo). */
export function resolverVinculoOrigem(
  ids: number[],
  motivoAmbiguo: MotivoBreakdown,
): Resolucao<number> {
  // 0 candidatos aqui não é erro (a maioria dos passos não tem origem documental):
  // devolve "sem vínculo" sinalizado por motivo, o chamador decide se conta.
  return resolverUnico(ids, motivoAmbiguo, motivoAmbiguo)
}

// --------------------------------------------------------------------------
// Acumulador determinístico do relatório
// --------------------------------------------------------------------------

export class RelatorioBackfill {
  private r: BackfillReport
  constructor(dryRun: boolean) {
    this.r = {
      scannedCount: 0, createdWorkflowInstances: 0, createdStepInstances: 0,
      linkedTasks: 0, linkedNeeds: 0, linkedDocuments: 0,
      skippedCount: 0, unresolvedCount: 0, breakdown: novaBreakdown(),
      conflicts: [], dryRun,
    }
  }
  scan(n = 1) { this.r.scannedCount += n }
  criouInstancia() { this.r.createdWorkflowInstances++ }
  criouStep() { this.r.createdStepInstances++ }
  vinculouTarefa() { this.r.linkedTasks++ }
  vinculouNecessidade() { this.r.linkedNeeds++ }
  vinculouDocumento() { this.r.linkedDocuments++ }
  pulou() { this.r.skippedCount++ }
  naoResolvido(motivo: MotivoBreakdown, conflito?: Omit<BackfillConflict, "tipo">) {
    this.r.breakdown[motivo]++
    if (conflito) this.r.conflicts.push({ tipo: motivo, ...conflito })
  }
  finalizar(): BackfillReport {
    this.r.unresolvedCount = somaUnresolved(this.r.breakdown)
    return { ...this.r, breakdown: { ...this.r.breakdown }, conflicts: [...this.r.conflicts] }
  }
}
