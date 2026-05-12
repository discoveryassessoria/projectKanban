// lib/db-retry.ts
// Helper genérico: retry pra cobrir cold start do Prisma Postgres (Accelerate + Neon).
// Detecta erros de conexão e tenta de novo com delay. Não faz retry de erros
// de validação ou negócio (P2002 duplicate, P2025 not found, etc).

/**
 * Tenta executar `fn` até `retries + 1` vezes em caso de erro de conexão.
 *
 * @param fn Função async a executar
 * @param retries Tentativas EXTRAS depois da primeira (padrão 2 = 3 totais)
 * @param delayMs Delay entre tentativas em ms (padrão 1500)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1500,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt === retries;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : '';

      const isConnectionError =
        errMsg.includes("Can't reach database") ||
        errMsg.includes('PrismaClientInitializationError') ||
        errMsg.includes('ECONNREFUSED') ||
        errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('ENOTFOUND') ||
        errName === 'PrismaClientInitializationError';

      if (isLastAttempt || !isConnectionError) throw err;

      console.warn(
        `[withRetry] tentativa ${attempt + 1}/${retries + 1} falhou (${errMsg.slice(0, 80)}). Nova tentativa em ${delayMs}ms...`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}