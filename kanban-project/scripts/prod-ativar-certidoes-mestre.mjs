// scripts/prod-ativar-certidoes-mestre.mjs
// ============================================================================
// Reativa os Documentos Mestres canônicos das certidões — idempotente.
//
// O smoke da Tabela de Valores mostrou 2 certidões ofertáveis em vez de 3: a de
// Óbito existe no cadastro mestre, mas está INATIVA, e item inativo não pode
// receber preço (nem deve aparecer no seletor). As duas regras — "as três
// certidões precisam aparecer" e "não listar inativo" — só coexistem de um jeito:
// a certidão precisa estar ativa.
//
// Escopo cirúrgico: apenas os três `code` canônicos, resolvidos por identidade
// imutável (nunca por nome). Não cria item, não mexe em preço, não mexe em
// configuração financeira, não toca em nenhum outro registro. Reversível pela
// própria tela (Ativo é estado, não exclusão). Auditado.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { identificador, retratar } from '../lib/db/identidade-banco.mjs'

const prisma = new PrismaClient()
const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''

/** Identidade imutável dos três documentos mestres. Nome não entra na busca. */
const CODES = ['CERT_NASCIMENTO_IT', 'CERT_CASAMENTO_IT', 'CERT_OBITO_IT']

async function main() {
  const retrato = await retratar(prisma)
  console.log(`[ativar-certidoes] alvo: ${identificador(url)} (tabelas=${retrato.tabelas})`)

  const itens = await prisma.itemCatalogo.findMany({
    where: { code: { in: CODES } },
    select: { id: true, code: true, name: true, ativo: true, natureza: true },
  })
  for (const c of CODES) {
    if (!itens.some((i) => i.code === c)) console.log(`[ativar-certidoes] ⚠ AUSENTE no cadastro mestre: ${c}`)
  }
  const inativos = itens.filter((i) => !i.ativo)
  console.log(`[ativar-certidoes] encontrados: ${itens.length}/3 · inativos: ${inativos.length}`)
  for (const i of itens) console.log(`[ativar-certidoes]   #${i.id} ${i.code} ativo=${i.ativo} — ${i.name}`)

  if (inativos.length === 0) { console.log('[ativar-certidoes] OK — nada a reativar.'); await prisma.$disconnect(); return }

  for (const i of inativos) {
    await prisma.$transaction(async (tx) => {
      await tx.itemCatalogo.update({ where: { id: i.id }, data: { ativo: true } })
      await tx.logAuditoria.create({
        data: {
          acao: 'REATIVAR', entidade: 'ItemCatalogo', entidadeId: i.id,
          descricao: `Documento Mestre reativado para ficar precificável: ${i.name}`,
          detalhes: { code: i.code, natureza: i.natureza, motivo: 'as três certidões precisam ser ofertáveis na Tabela de Valores' },
        },
      })
    })
    console.log(`[ativar-certidoes] ✓ reativado #${i.id} ${i.code} — ${i.name}`)
  }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.log(`[ativar-certidoes] AVISO: não concluído (${String(e?.message ?? e).slice(0, 200)})`)
  await prisma.$disconnect()
})
