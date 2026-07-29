// lib/financeiro/identidade/dedup-pessoa.ts
// ============================================================================
// Deduplicação VISUAL por identidade canônica (Pessoa via personId/pessoaId).
// NÃO funde, exclui, altera ou reconcilia registros — apenas evita exibir a
// MESMA Pessoa mais de uma vez em listas de SELEÇÃO (seletor de participantes,
// disponíveis, etc.). Requerentes SEM identidade canônica (personId nulo) são
// mantidos individualmente e NUNCA deduplicados por nome/CPF/similaridade.
//
// Dedup VISUAL ≠ consolidação FINANCEIRA: nas telas de participação, papéis,
// cobranças, parcelas, pagamentos e valores continuam agregados/exibidos por
// todos os vínculos reais. Aqui só se decide "quem aparece uma vez para escolher".
//
// Duplicidade real de registros de Pessoa (mesmo personId em >1 requerente) é
// registrada como PENDÊNCIA para o futuro motor transversal de Reconciliação de
// Identidade do Cadastro Mestre — jamais resolvida (merge) aqui. Puro, sem I/O.
// ============================================================================

export interface ComIdentidade {
  id: number // requerenteId (identidade do registro, sempre único)
  personId?: number | null // identidade canônica humana (Pessoa); null = não confirmada
}

export interface PendenciaReconciliacao {
  personId: number
  requerenteIds: number[] // >1 registro de Requerente para a MESMA Pessoa canônica
}

export interface DedupResultado<T> {
  itens: T[] // lista deduplicada: 1 por Pessoa canônica; registros sem personId preservados
  duplicatas: PendenciaReconciliacao[] // pendências p/ Reconciliação de Identidade (nunca merge aqui)
}

/**
 * Deduplica uma lista por identidade canônica (personId). Mantém a PRIMEIRA
 * ocorrência de cada Pessoa; registros com personId nulo passam intactos (um a
 * um). Não altera nenhum item. Retorna também as duplicatas reais encontradas.
 */
export function dedupPorPessoa<T extends ComIdentidade>(lista: T[]): DedupResultado<T> {
  const escolhido = new Set<number>() // personIds já exibidos
  const grupos = new Map<number, number[]>() // personId -> todos os requerenteIds vistos
  const itens: T[] = []
  for (const it of lista) {
    const pid = it.personId
    if (pid == null) { itens.push(it); continue } // sem identidade canônica: individual
    grupos.set(pid, [...(grupos.get(pid) ?? []), it.id])
    if (!escolhido.has(pid)) { escolhido.add(pid); itens.push(it) }
  }
  const duplicatas: PendenciaReconciliacao[] = [...grupos.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([personId, requerenteIds]) => ({ personId, requerenteIds }))
  return { itens, duplicatas }
}

/** Log técnico padronizado de pendência de reconciliação (não bloqueia fluxo). */
export function registrarPendenciaReconciliacao(contexto: string, duplicatas: PendenciaReconciliacao[]): void {
  if (!duplicatas.length) return
  console.warn(`[identidade][reconciliacao-pendente][${contexto}] mesma Pessoa em múltiplos requerentes (dedup VISUAL aplicado; sem merge):`, JSON.stringify(duplicatas))
}
