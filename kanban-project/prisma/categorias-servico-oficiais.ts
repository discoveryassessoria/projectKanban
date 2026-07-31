// prisma/categorias-servico-oficiais.ts
// ============================================================================
// CADASTRO CURADO das Categorias de Serviço (CategoriaServico).
//
// Separação deliberada de responsabilidade:
//   • CAMINHO DE REQUISIÇÃO (src/services/categoria-servico-ref.ts) NUNCA cria
//     categoria — só resolve o id que o cliente mandou. Cadastro não nasce como
//     efeito colateral de um POST;
//   • CAMINHO DE SEED (este módulo) É o cadastro: a lista abaixo é curadoria
//     versionada no repositório, com `code` imutável.
//
// Quem precisa vincular um item a uma categoria em seed/carga declara o CODE e
// resolve para o ID por aqui. O que é gravado no vínculo é sempre o id.
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client'

type DB = Prisma.TransactionClient | PrismaClient

/**
 * Categorias oficiais do catálogo. `code` é IMUTÁVEL — é a identidade do
 * registro. Nome, descrição e posição são conteúdo próprio e podem mudar.
 *
 * Lista deliberadamente CURTA: categoria nova só nasce quando existir serviço
 * comercial real que não caiba nestas. Nada de categoria especulativa.
 */
export const CATEGORIAS_SERVICO_OFICIAIS = [
  {
    code: 'CIDNAC', nome: 'Cidadania e Nacionalidade', ordem: 1,
    descricao: 'Serviços relacionados ao reconhecimento, aquisição ou regularização de cidadania e nacionalidade.',
  },
  {
    code: 'REGCIV', nome: 'Registro Civil', ordem: 2,
    descricao: 'Serviços relacionados a transcrições, inscrições, averbações e demais atos de registro civil.',
  },
  {
    code: 'RETREG', nome: 'Retificação de Registro Civil', ordem: 3,
    descricao: 'Serviços administrativos ou judiciais destinados à correção de registros civis.',
  },
] as const

export type CodeCategoriaServico = (typeof CATEGORIAS_SERVICO_OFICIAIS)[number]['code']

/**
 * Garante as categorias oficiais (idempotente por `code`) e devolve o mapa
 * code → id. Atualiza nome/ordem/descrição — que são conteúdo próprio — sem
 * jamais tocar no `code`, que é a identidade.
 */
export async function garantirCategoriasServico(db: DB): Promise<Map<string, number>> {
  const mapa = new Map<string, number>()
  for (const c of CATEGORIAS_SERVICO_OFICIAIS) {
    const reg = await db.categoriaServico.upsert({
      where: { code: c.code },
      create: { code: c.code, nome: c.nome, ordem: c.ordem, descricao: c.descricao, ativo: true },
      update: { nome: c.nome, ordem: c.ordem, descricao: c.descricao },
      select: { id: true },
    })
    mapa.set(c.code, reg.id)
  }
  return mapa
}

/**
 * Id de uma categoria oficial pelo seu code imutável. Lança quando o code não
 * existe: seed com categoria inexistente é erro de curadoria, não algo para
 * resolver por aproximação em tempo de execução.
 */
export async function idDaCategoriaServico(db: DB, code: CodeCategoriaServico): Promise<number> {
  const reg = await db.categoriaServico.findUnique({ where: { code }, select: { id: true } })
  if (!reg) throw new Error(`Categoria de serviço "${code}" não está cadastrada. Rode garantirCategoriasServico() antes.`)
  return reg.id
}
