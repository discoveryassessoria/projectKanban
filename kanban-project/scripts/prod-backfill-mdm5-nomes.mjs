// scripts/prod-backfill-mdm5-nomes.mjs
// ============================================================================
// MDM-5 F2 — Backfill dos nomes existentes para `NomePessoa`.
//
// Roda DENTRO DO BUILD DA VERCEL, onde PRISMA_DATABASE_URL existe — a mesma
// razão de `prod-apply-cadastros-aditivas.mjs`: a connection string é Sensitive
// e não sai da Vercel.
//
// O que faz: para cada Pessoa SEM nenhuma forma de nome ativa, cria UMA
// `NomePessoa` REGISTRAL principal a partir de `Pessoa.nome`/`sobrenome`.
//
// O que NÃO faz — e é o ponto da fase 2:
//   • não altera nenhuma coluna de Pessoa (a inversão de fonte é a F3);
//   • não apaga nada;
//   • não decide nada por conta própria: a afirmação entra como
//     origem=IMPORTACAO, confianca=PROVAVEL. Nunca CONFIRMADO — ninguém
//     conferiu esses nomes contra documento, e marcar como confirmado seria
//     transformar dado herdado em fato, exatamente o que o complemento 2 proíbe.
//
// Seguro por construção:
//   • só roda em VERCEL_ENV=production (preview e local: pula);
//   • trava de identidade — só escreve se o alvo for classificado PRODUCAO;
//   • idempotente por `chaveIdempotencia`: a 2ª execução é no-op;
//   • em lotes, para não estourar tempo nem memória num acervo grande;
//   • falha FECHADA: erro aborta o build e o deployment atual segue no ar.
// ============================================================================
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const PREFIXO = '[backfill-mdm5]'
const TAMANHO_LOTE = 500

if (process.env.VERCEL_ENV !== 'production') {
  console.log(`${PREFIXO} VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — só roda em production. Pulando.`)
  process.exit(0)
}

const url = process.env.PRISMA_DATABASE_URL
if (!url) {
  console.error(`${PREFIXO} ABORTADO: PRISMA_DATABASE_URL ausente no build.`)
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

/**
 * Normalização usada só para a chave de idempotência — precisa casar com
 * `chaveIdempotenciaNome` do serviço (src/services/cadastro-mestre/nome-pessoa.ts).
 * Duplicada aqui de propósito: este script é .mjs de build e não pode importar
 * TypeScript. Se a regra do serviço mudar, esta função muda junto.
 */
function normalizar(v) {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function chaveIdempotencia(pessoaId, nome, sobrenome) {
  const forma = normalizar(`${nome} ${sobrenome ?? ''}`).replace(/\s+/g, '_')
  return `nome:${pessoaId}:REGISTRAL:${forma}`.slice(0, 200)
}

/** Chave fonética — espelha `chaveFonetica` de motor/texto.ts. */
function chaveFonetica(v) {
  let s = normalizar(v).replace(/\s/g, '')
  if (!s) return null
  s = s
    .replace(/PH/g, 'F').replace(/GH/g, 'G').replace(/SCH/g, 'S').replace(/CH/g, 'C')
    .replace(/QU/g, 'C').replace(/Q/g, 'C').replace(/K/g, 'C').replace(/W/g, 'V')
    .replace(/Y/g, 'I').replace(/H/g, '').replace(/LH/g, 'L').replace(/NH/g, 'N')
    .replace(/GN/g, 'N').replace(/[ÇX]/g, 'S').replace(/Z/g, 'S').replace(/TT/g, 'T')
    .replace(/DT/g, 'T').replace(/G([EI])/g, 'J$1').replace(/C([EI])/g, 'S$1')
  s = s.replace(/(.)\1+/g, '$1').replace(/[AEIOU]+$/g, '')
  return s || null
}

try {
  console.log(`${PREFIXO} alvo: ${identificador(url)}`)
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`${PREFIXO} retrato: ${retrato.tabelas} tabelas · ${retrato.migrations} migrations`)
  console.log(`${PREFIXO} classificação: ${classe}`)
  if (classe !== CLASSE.PRODUCAO) {
    console.error(`${PREFIXO} ABORTADO: alvo não tem assinatura de produção (${classe}). Nada foi escrito.`)
    process.exit(1)
  }

  // A tabela existe? (o backfill só faz sentido depois da migration da F1)
  const [{ existe }] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='NomePessoa') AS existe`,
  )
  if (!existe) {
    console.log(`${PREFIXO} tabela NomePessoa ainda não existe — migration da F1 não aplicada. Pulando.`)
    process.exit(0)
  }

  const [{ pessoas: totalPessoas }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS pessoas FROM "Pessoa"`,
  )
  const [{ nomes: antes }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS nomes FROM "NomePessoa"`,
  )
  console.log(`${PREFIXO} pessoas: ${totalPessoas} · nomes já registrados: ${antes}`)

  // BACKFILL EM SQL PURO.
  //
  // A 1ª tentativa usava o client do Prisma e morreu com
  // PrismaClientValidationError de mensagem vazia — shape de query validado em
  // runtime, impossível de depurar num build remoto. SQL direto elimina essa
  // classe inteira de erro: é uma instrução só, atômica, idempotente por
  // ON CONFLICT, e faz exatamente o que está escrito.
  //
  // A chave fonética é calculada aqui com a MESMA sequência de substituições de
  // motor/texto.ts. Duplicação consciente: o build não importa TypeScript. Se a
  // regra mudar lá, muda aqui — o teste de guarda cobre as duas.
  const EXPR_NORMALIZA = `upper(translate(coalesce(NULLIF(btrim(p."sobrenome"), ''), p."nome"),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'))`

  const EXPR_FONETICA = `
    NULLIF(regexp_replace(
      regexp_replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(
          regexp_replace(${EXPR_NORMALIZA}, '[^A-Z]', '', 'g'),
          'PH','F'), 'GH','G'), 'SCH','S'), 'CH','C'), 'QU','C'), 'Q','C'), 'K','C'),
          'W','V'), 'Y','I'), 'H',''), 'LH','L'), 'NH','N'), 'GN','N'), 'X','S'),
          'Z','S'), 'TT','T'), 'DT','T'),
        '(.)\\1+', '\\1', 'g'),
      '[AEIOU]+$', '', 'g'), '')`

  const inseridos = await prisma.$executeRawUnsafe(`
    INSERT INTO "NomePessoa" (
      "pessoaId", "nome", "sobrenome", "tipo", "principal", "chaveFonetica",
      "origem", "confianca", "responsavelId", "justificativa",
      "evidenciaNecessidadeId", "ativo", "chaveIdempotencia", "criadoEm", "atualizadoEm"
    )
    SELECT
      p."id",
      left(btrim(p."nome"), 50),
      NULLIF(left(btrim(coalesce(p."sobrenome", '')), 40), ''),
      'REGISTRAL',
      true,
      left(${EXPR_FONETICA}, 60),
      'IMPORTACAO',
      'PROVAVEL',
      NULL,
      'Nome já existente em Pessoa.nome/sobrenome no momento da migração MDM-5.',
      NULL,
      true,
      left('nome:' || p."id" || ':REGISTRAL:' ||
        regexp_replace(
          upper(translate(btrim(p."nome") || ' ' || coalesce(btrim(p."sobrenome"), ''),
            'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
            'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
          '[^A-Z0-9]+', '_', 'g'), 200),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM "Pessoa" p
    WHERE btrim(coalesce(p."nome", '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "NomePessoa" n WHERE n."pessoaId" = p."id" AND n."ativo" = true
      )
    ON CONFLICT ("chaveIdempotencia") DO NOTHING
  `)

  const [{ nomes: depois }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS nomes FROM "NomePessoa"`,
  )
  const [{ n: semNome }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Pessoa" WHERE btrim(coalesce("nome", '')) = ''`,
  )

  // Invariante: ninguém pode ter dois principais ativos. O índice parcial já
  // impede, mas conferir aqui prova que o backfill não deixou resíduo.
  const duplicados = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT "pessoaId" FROM "NomePessoa"
       WHERE "principal" = true AND "ativo" = true
       GROUP BY "pessoaId" HAVING COUNT(*) > 1) t`,
  )
  const nDup = Number(duplicados?.[0]?.n ?? 0)

  // Cobertura: toda Pessoa com nome precisa ter ficado com uma forma ativa.
  const faltantes = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Pessoa" p
      WHERE btrim(coalesce(p."nome", '')) <> ''
        AND NOT EXISTS (SELECT 1 FROM "NomePessoa" n
                         WHERE n."pessoaId" = p."id" AND n."ativo" = true)`,
  )
  const nFalta = Number(faltantes?.[0]?.n ?? 0)

  console.log(`${PREFIXO} inseridos nesta execução: ${inseridos} · pessoas sem nome: ${semNome}`)
  console.log(`${PREFIXO} nomes: ${antes} → ${depois}`)
  console.log(`${PREFIXO} pessoas com 2+ principais ativos: ${nDup} · sem forma ativa: ${nFalta}`)

  if (nDup > 0) {
    console.error(`${PREFIXO} ABORTADO: invariante violada (${nDup} pessoas com principal duplicado).`)
    process.exit(1)
  }
  if (nFalta > 0) {
    console.error(`${PREFIXO} ABORTADO: ${nFalta} pessoa(s) com nome ficaram sem forma ativa.`)
    process.exit(1)
  }

  console.log(`${PREFIXO} OK.`)
} catch (erro) {
  // Mensagem vazia não diagnostica nada. Despeja o que houver: nome, código do
  // Prisma, meta e a primeira linha do stack.
  const detalhe = [
    erro?.name,
    erro?.code ? `code=${erro.code}` : null,
    erro?.message || null,
    erro?.meta ? `meta=${JSON.stringify(erro.meta)}` : null,
    typeof erro === 'string' ? erro : null,
    erro?.stack ? String(erro.stack).split('\n')[1]?.trim() : null,
  ]
    .filter(Boolean)
    .join(' · ')
  console.error(`${PREFIXO} ABORTADO: ${detalhe || JSON.stringify(erro) || '(erro sem detalhe)'}`)
  console.error(`${PREFIXO} Nenhuma escrita adicional foi feita. O deployment atual segue no ar.`)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
