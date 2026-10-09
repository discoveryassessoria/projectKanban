// lib/operacional/fase-fechou-de-verdade.ts
// ============================================================================
// UMA FASE QUE O PROCESSO JÁ DEIXOU SÓ É «CONCLUÍDA» (100%) SE O TRABALHO CONTINUA INTEIRO (09/10/2026, Ageitos Brion).
// Reabrir uma tarefa de uma fase passada (uma certidão da Emissão enquanto o processo está na Análise) NÃO muda o status da instância da fase (ela segue
// CONCLUIDO), mas muda o que a projeção operacional mede (6/7 = 86%). A trilha do processo lia só o status e mostrava 100% — agora exige as duas coisas.
// PURA: a trilha (`/api/processos/[id]/phases`) só chama.
// ============================================================================
export function fechouDeVerdade(args: { statusDaInstancia: string | null | undefined; progressoMedido: number }): boolean {
  return args.statusDaInstancia === "CONCLUIDO" && args.progressoMedido >= 100
}
