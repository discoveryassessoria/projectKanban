// src/lib/r2-buckets.ts
// ============================================================================
// QUAL BUCKET GUARDA O QUÊ — regra PURA (sem S3, sem env global: tudo por parâmetro).
//
// Há dois buckets: o PÚBLICO (`R2_BUCKET_NAME`, com endereço `R2_PUBLIC_URL` que serve o bucket
// inteiro) e o PRIVADO (`R2_BUCKET_PRIVADO`, sem nenhum endereço público). Toda chave que começa
// com `privado/` pertence ao privado.
//
// MODO ÚNICO (variável ausente — o estado de produção até o OK explícito do usuário): nada muda,
// tudo continua no bucket de sempre, sem nenhuma chamada extra ao storage.
//
// MODO DUPLO (variável presente):
//   • GRAVA e APAGA no bucket privado (a chave nasce lá);
//   • LÊ do privado e, se o objeto ainda só existe no antigo (objetos de antes da troca, enquanto
//     a cópia não foi feita/verificada), cai no público — nunca fica sem acesso durante a troca;
//   • chave que NÃO é `privado/` (anexos de cliente) nunca vai ao bucket privado.
//
// Apagar do bucket público NÃO é feito por esta regra nem por nenhum fluxo do sistema: é um ato
// separado, por script, chave a chave, com autorização explícita (docs/coleta-de-dados-mandato.md §8b).
// ============================================================================

export const PREFIXO_RAIZ_PRIVADO = "privado/"

export interface ConfigBuckets {
  /** Bucket público (`R2_BUCKET_NAME`). */
  publico: string
  /** Bucket privado (`R2_BUCKET_PRIVADO`); `null` = modo único. */
  privado: string | null
}

export function configDosBuckets(env: Record<string, string | undefined> = process.env): ConfigBuckets {
  const privado = (env.R2_BUCKET_PRIVADO ?? "").trim()
  return { publico: env.R2_BUCKET_NAME ?? "", privado: privado && privado !== env.R2_BUCKET_NAME ? privado : null }
}

export const ehChavePrivada = (chave: string): boolean => typeof chave === "string" && chave.startsWith(PREFIXO_RAIZ_PRIVADO)

/** O sistema está no modo duplo para esta chave? */
export const modoDuploParaChave = (chave: string, cfg: ConfigBuckets): boolean => ehChavePrivada(chave) && cfg.privado != null

/** Onde GRAVAR (e apagar) a chave. */
export function bucketDeEscrita(chave: string, cfg: ConfigBuckets): string {
  return modoDuploParaChave(chave, cfg) ? (cfg.privado as string) : cfg.publico
}

/** Onde PROCURAR a chave, em ordem: o bucket novo primeiro, o antigo como plano B. */
export function bucketsDeLeitura(chave: string, cfg: ConfigBuckets): string[] {
  return modoDuploParaChave(chave, cfg) ? [cfg.privado as string, cfg.publico] : [cfg.publico]
}
