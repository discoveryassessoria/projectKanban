// prisma/seed-orgaos-organizacoes.ts
//
// SEED OFICIAL do módulo Órgãos e Organizações. IDEMPOTENTE: a chave natural é
// `code` (categorias) e `nome oficial + país` (organizações). Rodar de novo não
// duplica, não reescreve o que o operador editou à mão e não apaga nada.
//
//   npx tsx prisma/seed-orgaos-organizacoes.ts [--dry-run]
//
// O que faz:
//   1. cria as categorias que faltam (as existentes ficam como estão);
//   2. cria as organizações que faltam — cada uma nasce ATIVA e com código
//      público ORG1, ORG2… gerado pelo CodeGeneratorService (extensão do Prisma);
//   3. completa CAMPOS VAZIOS de organizações já cadastradas (nunca sobrescreve
//      valor preenchido) e garante os vínculos de categoria;
//   4. gera código para registros antigos que ainda não tenham publicCode.
//
// NÃO cria preço, contrato nem vínculo com processo. É só cadastro mestre.

import { prisma } from '@/lib/prisma'
import { gerarCodigoPublico } from '@/lib/codigos/code-generator'
import { resolverOrganizacao, unirFuncoes } from '@/src/services/organizacao-identidade'
import { CATEGORIAS, BASE_COMPLETA, funcoesDe, validarBase, type OrganizacaoSeed } from './dados-orgaos-organizacoes'

const DRY = process.argv.includes('--dry-run')
const log = (m: string) => console.log(`[seed-orgaos]${DRY ? ' (dry)' : ''} ${m}`)

/** Campos da ficha que o seed sabe preencher. */
function fichaDe(o: OrganizacaoSeed) {
  return {
    nomeFantasia: o.nomeFantasia ?? null,
    type: o.type ?? null,
    country: o.country,
    state: o.state ?? null,
    provincia: o.provincia ?? null,
    city: o.city ?? null,
    site: o.site ?? null,
    idioma: o.idioma ?? null,
    moeda: o.moeda ?? null,
    observacoes: o.observacoes ?? null,
    tags: o.tags ?? [],
  }
}

async function main() {
  const problemas = validarBase()
  if (problemas.length) {
    console.error('[seed-orgaos] BASE INVÁLIDA — nada foi escrito:')
    for (const p of problemas) console.error(`  · ${p}`)
    process.exit(1)
  }
  log(`base válida: ${CATEGORIAS.length} categorias · ${BASE_COMPLETA.length} organizações`)

  // ── 1) categorias ──────────────────────────────────────────────────────────
  const existentesCat = new Map(
    (await prisma.categoriaOrganizacao.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id]),
  )
  let catNovas = 0
  for (const c of CATEGORIAS) {
    if (existentesCat.has(c.code)) continue
    if (!DRY) {
      const criada = await prisma.categoriaOrganizacao.create({
        data: { code: c.code, nome: c.nome, descricao: c.descricao ?? null, ordem: c.ordem, ativo: true },
        select: { id: true, code: true },
      })
      existentesCat.set(criada.code, criada.id)
    }
    catNovas++
  }
  log(`categorias: +${catNovas} novas · ${existentesCat.size} no total`)

  // ── 2/3) organizações ──────────────────────────────────────────────────────
  let orgNovas = 0
  let orgCompletadas = 0
  let vinculosNovos = 0

  let funcoesAcrescentadas = 0
  for (const o of BASE_COMPLETA) {
    const ficha = fichaDe(o)
    const funcoes = funcoesDe(o)

    // ORGANIZAÇÃO ÚNICA: a entidade é procurada na ordem obrigatória
    // (id → identificação fiscal → nome oficial + país → nome fantasia + país).
    // Só é criada quando NADA casou.
    const resolucao = await resolverOrganizacao(prisma, {
      name: o.name, nomeFantasia: o.nomeFantasia, country: o.country,
    })
    const atual = resolucao.id
      ? await prisma.orgaoProtocolo.findUnique({
          where: { id: resolucao.id },
          include: { categorias: { select: { categoriaId: true } } },
        })
      : null

    let orgaoId: number
    if (!atual) {
      if (DRY) { orgNovas++; continue }
      const criado = await prisma.orgaoProtocolo.create({
        data: { name: o.name, ...ficha, funcoes, ativo: true },
        select: { id: true },
      })
      orgaoId = criado.id
      orgNovas++
    } else {
      // Já existe: NUNCA duplica — acrescenta função e completa o que falta.
      const funcoesFinais = unirFuncoes(atual.funcoes, funcoes)
      if (funcoesFinais.length !== atual.funcoes.length) {
        if (!DRY) await prisma.orgaoProtocolo.update({ where: { id: atual.id }, data: { funcoes: funcoesFinais } })
        funcoesAcrescentadas++
      }
      orgaoId = atual.id
      // Só COMPLETA o que está vazio — edição manual do operador é preservada.
      const patch: Record<string, unknown> = {}
      for (const [chave, valor] of Object.entries(ficha)) {
        if (chave === 'tags') {
          if ((atual.tags?.length ?? 0) === 0 && (valor as string[]).length) patch.tags = valor
          continue
        }
        if (chave === 'country') continue
        const atualValor = (atual as unknown as Record<string, unknown>)[chave]
        if ((atualValor === null || atualValor === undefined || atualValor === '') && valor != null) patch[chave] = valor
      }
      if (Object.keys(patch).length) {
        if (!DRY) await prisma.orgaoProtocolo.update({ where: { id: orgaoId }, data: patch })
        orgCompletadas++
      }
    }

    // vínculos de categoria (N:N) — aditivo, nunca remove o que já existe
    const jaVinculadas = new Set(atual?.categorias.map((c) => c.categoriaId) ?? [])
    const alvo = o.categorias.map((code) => existentesCat.get(code)).filter((v): v is number => v != null)
    const faltando = alvo.filter((id) => !jaVinculadas.has(id))
    if (faltando.length) {
      if (!DRY) {
        await prisma.organizacaoCategoria.createMany({
          data: faltando.map((categoriaId) => ({ orgaoId, categoriaId })),
          skipDuplicates: true,
        })
      }
      vinculosNovos += faltando.length
    }
  }
  log(`organizações: +${orgNovas} novas · ${orgCompletadas} completadas · +${vinculosNovos} vínculos de categoria · ${funcoesAcrescentadas} ganharam função`)

  // ── 4) código público para registros antigos ───────────────────────────────
  const semCodigo = await prisma.orgaoProtocolo.findMany({ where: { publicCode: null }, select: { id: true }, orderBy: { id: 'asc' } })
  if (semCodigo.length && !DRY) {
    for (const r of semCodigo) {
      const codigo = await gerarCodigoPublico(prisma, 'ORGANIZATION')
      await prisma.orgaoProtocolo.update({ where: { id: r.id }, data: { publicCode: codigo } })
    }
  }
  log(`código público: ${semCodigo.length} registro(s) ${DRY ? 'receberiam' : 'receberam'} ORG-n`)

  // ── conferência final ──────────────────────────────────────────────────────
  const [totalOrg, ativos, semPublicCode, duplicados] = await Promise.all([
    prisma.orgaoProtocolo.count(),
    prisma.orgaoProtocolo.count({ where: { ativo: true } }),
    prisma.orgaoProtocolo.count({ where: { publicCode: null } }),
    prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM (SELECT "name", "country" FROM "OrgaoProtocolo" GROUP BY "name", "country" HAVING COUNT(*) > 1) x`,
    ),
  ])
  const nDup = duplicados?.[0]?.n ?? 0
  const semFuncao = await prisma.orgaoProtocolo.count({ where: { funcoes: { isEmpty: true } } })
  const fornecedores = await prisma.orgaoProtocolo.count({ where: { funcoes: { has: 'FORNECEDOR' } } })
  const orgaos = await prisma.orgaoProtocolo.count({ where: { funcoes: { has: 'ORGAO' } } })
  log(`TOTAL: ${totalOrg} organizações · ${ativos} ativas · ${semPublicCode} sem código · ${nDup} duplicadas`)
  log(`FUNÇÕES: ${orgaos} órgãos · ${fornecedores} fornecedores · ${semFuncao} sem função`)
  if (!DRY && (nDup > 0 || semPublicCode > 0 || semFuncao > 0)) {
    console.error('[seed-orgaos] INCONSISTÊNCIA: há duplicidade, registro sem código público ou sem função.')
    process.exit(1)
  }
  log('OK.')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error('[seed-orgaos] erro:', e); await prisma.$disconnect(); process.exit(1) })
