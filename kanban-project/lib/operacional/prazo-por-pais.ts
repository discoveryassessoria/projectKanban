// lib/operacional/prazo-por-pais.ts
// ============================================================================
// PRAZO DO PASSO POR PAÍS DO REGISTRO (08/10/2026) — «nasceu na Itália: 30 dias; casou e morreu no Brasil: 1 dia».
//
// O ÚNICO lugar que decide. O cadastro (Gerenciamento) tem o prazo padrão do passo (`slaDays`, o do exterior) e a tabela
// `RegraTemporalPais` (passo × país) com os países que têm prazo próprio. Quem consome (criação do passo, reconciliação de
// SLA) chama `slaDoPassoDaNecessidade`; nenhuma tela e nenhum outro serviço recalcula.
//
// O país que vale é o do EVENTO da certidão, lido na árvore:
//   nascimento → Pessoa.pais_nasc   ·   casamento → Uniao.pais   ·   óbito → Pessoa.pais_obito
// SEM país cadastrado a regra NÃO se aplica (vale o prazo do passo) — nunca um palpite. Em particular, «vazio» NÃO vira Brasil
// aqui (diferente do país do registro legado): um evento sem país no cadastro cai no prazo largo, e o vigia (regra u) o lista.
// ============================================================================
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { ehPaisBrasil } from "@/lib/localidade/regra-localidade"
import { normalizarNomePais } from "@/src/lib/genealogia/gentilico"

type Leitor = Prisma.TransactionClient | typeof prisma

export type CategoriaDoEvento = "NASCIMENTO" | "CASAMENTO" | "OBITO"

/** Chave de comparação do país: Brasil (e variantes) = «brasil»; vazio = `null` (sem país, regra não se aplica). */
export function chaveDoPais(pais: string | null | undefined): string | null {
  const texto = (pais ?? "").trim()
  if (texto === "") return null
  if (ehPaisBrasil(texto)) return "brasil"
  const chave = normalizarNomePais(texto)
  return chave === "" ? null : chave
}

/** Qual evento a certidão comprova — pelo código do item do catálogo, com o nome como reserva. */
export function categoriaDoItem(item: { code?: string | null; name?: string | null }): CategoriaDoEvento | null {
  const texto = `${item.code ?? ""} ${item.name ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  if (/nasc/.test(texto)) return "NASCIMENTO"
  if (/casam/.test(texto)) return "CASAMENTO"
  if (/obito/.test(texto)) return "OBITO"
  return null
}

/** O país do evento, a partir do que a árvore tem. `null` = o cadastro não diz (ou a certidão não é de um evento). */
export function paisDoEvento(
  categoria: CategoriaDoEvento | null,
  fonte: { pessoa?: { pais_nasc?: string | null; pais_obito?: string | null } | null; uniao?: { pais?: string | null } | null },
): string | null {
  if (categoria === "NASCIMENTO") return fonte.pessoa?.pais_nasc?.trim() || null
  if (categoria === "OBITO") return fonte.pessoa?.pais_obito?.trim() || null
  if (categoria === "CASAMENTO") return fonte.uniao?.pais?.trim() || null
  return null
}

export type OrigemDoSla = "PAIS" | "PASSO"
export interface SlaDecidido { slaDays: number | null; origem: OrigemDoSla; paisChave: string | null; regraId: number | null }

/** Pura: a regra do país, quando existe e está ativa, ganha do prazo do passo. */
export function decidirSla(
  slaDoPasso: number | null,
  paisChave: string | null,
  regras: ReadonlyArray<{ id: number; paisChave: string; slaDays: number; ativo: boolean }>,
): SlaDecidido {
  const regra = paisChave == null ? undefined : regras.find((r) => r.ativo && r.paisChave === paisChave)
  if (regra) return { slaDays: regra.slaDays, origem: "PAIS", paisChave, regraId: regra.id }
  return { slaDays: slaDoPasso, origem: "PASSO", paisChave, regraId: null }
}

/**
 * O prazo (dias corridos) do passo `stepKey` para a certidão `necessidadeId`. Sem necessidade, ou sem país, ou sem regra
 * cadastrada para o país: o prazo do passo, intacto.
 */
export async function slaDoPassoDaNecessidade(
  db: Leitor,
  args: { stepKey: string; necessidadeId: number | null | undefined; slaDoPasso: number | null },
): Promise<SlaDecidido> {
  if (args.necessidadeId == null) return { slaDays: args.slaDoPasso, origem: "PASSO", paisChave: null, regraId: null }
  const regras = await db.regraTemporalPais.findMany({
    where: { stepKey: args.stepKey, ativo: true },
    select: { id: true, paisChave: true, slaDays: true, ativo: true },
  })
  if (regras.length === 0) return { slaDays: args.slaDoPasso, origem: "PASSO", paisChave: null, regraId: null }
  const n = await db.necessidadeDocumental.findUnique({
    where: { id: args.necessidadeId },
    select: {
      itemCatalogo: { select: { code: true, name: true } },
      pessoa: { select: { pais_nasc: true, pais_obito: true } },
      uniao: { select: { pais: true } },
    },
  })
  if (!n) return { slaDays: args.slaDoPasso, origem: "PASSO", paisChave: null, regraId: null }
  const pais = paisDoEvento(categoriaDoItem(n.itemCatalogo), n)
  return decidirSla(args.slaDoPasso, chaveDoPais(pais), regras)
}
