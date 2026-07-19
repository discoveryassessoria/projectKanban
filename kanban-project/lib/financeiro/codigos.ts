// lib/financeiro/codigos.ts
// Códigos públicos de Receita ("REC-n") e Custo ("CUS-n"). NÃO geram mais localmente:
// delegam ao CodeGeneratorService central (sequência atômica, sem reuso, transacional).
// Compatibilidade: registros antigos com código aleatório (REC-XXXXXX) seguem válidos —
// os novos são sequenciais e nunca colidem (numérico vs. alfanumérico).

import { prisma } from "@/lib/prisma";
import { gerarCodigoPublico } from "@/lib/codigos/code-generator";

export async function gerarCodigoReceita(): Promise<string> {
  return gerarCodigoPublico(prisma, "REVENUE");
}

export async function gerarCodigoCusto(): Promise<string> {
  return gerarCodigoPublico(prisma, "COST");
}
