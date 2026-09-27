// src/lib/cartorio-bridge.ts
// ============================================================================
// BUG 3 (rodada de ajustes Operação v3, 26/09/2026) — a ponte entre a Base de
// Cartórios (`Cartorio`, 7.121 sincronizados do Registro Civil, só Brasil) e
// o cadastro operacional (`OrgaoProtocolo`, "Cartórios e Órgãos", mundial)
// NÃO EXISTIA: duas telas buscavam em duas tabelas sem nenhuma ligação entre
// elas — `EditorRegistralModal.tsx` só preenchia `Documento.cartorio` (texto);
// `OrgaoEmissorField` (DocumentoOperationalDrawer.tsx) só resolvia
// `Documento.orgaoId` buscando em `OrgaoProtocolo` por país, nunca em
// `Cartorio`.
//
// NÃO usa `resolverOrganizacao` (organizacao-identidade.ts) direto: a chave
// dela é "mesmo nome no mesmo país" (SEM cidade) — cartórios brasileiros
// repetem nome genérico ("1º Ofício de Registro Civil") em centenas de
// municípios diferentes; casar só por nome colapsaria cartórios de cidades
// diferentes no MESMO OrgaoProtocolo. A identidade aqui é composta
// (nome + município/UF), e NUNCA cria — só resolve o que já foi cadastrado
// (decisão explícita: cartório brasileiro sem órgão mapeado é gap de dado
// real, resolvido no cadastro de Órgãos e Organizações por um admin, nunca
// por escrita automática silenciosa).
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type Leitor = typeof prisma | Prisma.TransactionClient

export interface CartorioParaBridge {
  nome: string
  municipio: string
  uf: string
}

/**
 * A IDENTIDADE COMPOSTA — nunca só o nome. "Cartório de Registro Civil de
 * Bagé" e um homônimo em outra cidade não são a mesma entidade só porque o
 * nome bate.
 */
export function identidadeCompostaDoCartorio(cartorio: CartorioParaBridge): string {
  return `${cartorio.nome.trim()} - ${cartorio.municipio.trim()}/${cartorio.uf.trim().toUpperCase()}`.slice(0, 200)
}

/**
 * RESOLVE (nunca cria) o `OrgaoProtocolo` de um cartório brasileiro pela
 * identidade composta. `null` = cartório brasileiro genuinamente sem órgão
 * mapeado ainda no cadastro de Órgãos e Organizações — gap de dado real,
 * logado pra quem cadastra resolver manualmente (nunca uma escrita
 * automática aqui).
 */
export async function resolverOrgaoDoCartorio(
  cartorio: CartorioParaBridge,
  db: Leitor = prisma,
): Promise<number | null> {
  const identidade = identidadeCompostaDoCartorio(cartorio)
  const orgao = await db.orgaoProtocolo.findFirst({ where: { name: identidade }, select: { id: true } })
  if (orgao) return orgao.id
  console.error(
    `[cartorio-bridge] cartório brasileiro sem órgão mapeado: "${identidade}" — cadastre em Gerenciamento → Órgãos e Organizações antes de vincular.`,
  )
  return null
}
