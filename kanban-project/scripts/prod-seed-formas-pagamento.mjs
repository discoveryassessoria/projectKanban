// scripts/prod-seed-formas-pagamento.mjs
// ============================================================================
// Cadastro IDEMPOTENTE das formas de pagamento padrão do Discovery, executado
// DENTRO DO BUILD DA VERCEL (único lugar onde PRISMA_DATABASE_URL existe).
//
// Seguro por construção:
//   • roda só em VERCEL_ENV=production;
//   • trava de identidade — só escreve se o alvo for classificado PRODUCAO;
//   • CONSULTA primeiro (moedas ativas + formas existentes) e só então grava;
//   • só INSERT de forma ausente. NUNCA faz UPDATE nem DELETE em registro
//     existente — forma já cadastrada é reportada como "já existente" e
//     deixada exatamente como está;
//   • moeda inexistente ou inativa NÃO é criada: fica de fora do vínculo e é
//     reportada no relatório;
//   • falha FECHADA: qualquer erro aborta o build (o deployment atual segue no ar).
//
// O código público FPG-n vem da MESMA sequência atômica do CodeGeneratorService
// (lib/codigos/code-generator.ts) — tabela "CodeSequence", scope 'FPG'. Este
// script não pode importar TypeScript no build, então repete a única instrução
// SQL do serviço; o dono da regra continua sendo o CodeGeneratorService.
// ============================================================================
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const log = (m) => console.log(`[seed-formas] ${m}`)

if (process.env.VERCEL_ENV !== 'production') {
  log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — só roda em production. Pulando.`)
  process.exit(0)
}

const url = process.env.PRISMA_DATABASE_URL
if (!url) {
  console.error('[seed-formas] ABORTADO: PRISMA_DATABASE_URL ausente no build de produção.')
  process.exit(1)
}

// Configuração desejada. `type` usa o enum controlado TIPOS_FORMA.
const DESEJADAS = [
  {
    type: 'PIX', name: 'PIX', categoria: 'INSTANTANEO', ordem: 10,
    moedas: ['BRL'], permiteParcelas: false, minParcelas: 1, maxParcelas: null,
    exigeAdquirente: false, permiteAntecipacao: false,
    usoRecebimento: true, usoPagamento: true, permiteInternacional: false,
    descricao: 'Pix instantâneo — recebimentos e pagamentos em BRL.',
  },
  {
    type: 'TRANSFERENCIA', name: 'Transferência Bancária', categoria: 'BANCARIO', ordem: 20,
    moedas: ['BRL', 'EUR', 'USD'], permiteParcelas: false, minParcelas: 1, maxParcelas: null,
    exigeAdquirente: false, permiteAntecipacao: false,
    usoRecebimento: true, usoPagamento: true, permiteInternacional: true,
    descricao: 'Transferência bancária nacional e internacional.',
  },
  {
    type: 'CARTAO_CREDITO', name: 'Cartão de Crédito', categoria: 'CARTAO', ordem: 30,
    moedas: ['BRL'], permiteParcelas: true, minParcelas: 1, maxParcelas: 12,
    exigeAdquirente: true, permiteAntecipacao: true,
    usoRecebimento: true, usoPagamento: false, permiteInternacional: false,
    descricao: 'Cartão de crédito via adquirente — 1 a 12 parcelas (limite técnico).',
  },
  {
    type: 'CARTAO_DEBITO', name: 'Cartão de Débito', categoria: 'CARTAO', ordem: 40,
    moedas: ['BRL'], permiteParcelas: false, minParcelas: 1, maxParcelas: null,
    exigeAdquirente: true, permiteAntecipacao: false,
    usoRecebimento: true, usoPagamento: false, permiteInternacional: false,
    descricao: 'Cartão de débito via adquirente.',
  },
  {
    type: 'BOLETO', name: 'Boleto Bancário', categoria: 'BANCARIO', ordem: 50,
    moedas: ['BRL'], permiteParcelas: false, minParcelas: 1, maxParcelas: null,
    exigeAdquirente: false, permiteAntecipacao: false,
    usoRecebimento: true, usoPagamento: true, permiteInternacional: false,
    descricao: 'Boleto bancário — o banco emissor não é tratado como adquirente.',
  },
  {
    type: 'DINHEIRO', name: 'Dinheiro', categoria: 'DINHEIRO', ordem: 60,
    moedas: ['BRL', 'EUR', 'USD', 'PYG'], permiteParcelas: false, minParcelas: 1, maxParcelas: null,
    exigeAdquirente: false, permiteAntecipacao: false,
    usoRecebimento: true, usoPagamento: true, permiteInternacional: true,
    descricao: 'Espécie — nacional e internacional.',
  },
  {
    type: 'WISE', name: 'Wise', categoria: 'INTERNACIONAL', ordem: 70,
    moedas: ['BRL', 'EUR', 'USD', 'PYG'], permiteParcelas: false, minParcelas: 1, maxParcelas: null,
    exigeAdquirente: false, permiteAntecipacao: false,
    usoRecebimento: true, usoPagamento: true, permiteInternacional: true,
    descricao: 'Wise — transferências internacionais multimoeda.',
  },
]

// O cadastro de Moedas do Discovery NÃO usa códigos ISO em todos os casos
// (ex.: 'REA' para o Real, 'DOL' para o Dólar). Este mapa resolve a moeda pedida
// para o código REALMENTE cadastrado — não cria moeda nenhuma. Se nenhum
// equivalente existir e estiver ativo, a moeda simplesmente fica de fora e é
// reportada.
const EQUIVALENTES = {
  BRL: ['BRL', 'REA', 'R$', 'REAL'],
  EUR: ['EUR', 'EURO'],
  USD: ['USD', 'DOL', 'DOLAR', 'US$'],
  PYG: ['PYG', 'GUA', 'GUARANI'],
}

/** Código cadastrado e ATIVO equivalente à moeda pedida, ou null. */
const resolverMoeda = (pedida, ativas) =>
  (EQUIVALENTES[pedida] ?? [pedida]).find((c) => ativas.has(c)) ?? null

// Identidade normalizada p/ deduplicação: sem acento, sem pontuação, minúsculo.
const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '')

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

try {
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  log(`alvo: ${identificador(url)} — ${classe} (${retrato.tabelas} tabelas, ${retrato.requerentes} requerentes)`)
  if (classe !== CLASSE.PRODUCAO) {
    console.error(`[seed-formas] ABORTADO: alvo não é PRODUCAO (classificado ${classe}). Nada escrito.`)
    process.exit(1)
  }

  // ── 1. CONSULTA — moedas e formas já cadastradas ──────────────────────────
  const moedas = await prisma.moedaCadastro.findMany({ select: { code: true, name: true, ativo: true } })
  const ativas = new Set(moedas.filter((m) => m.ativo).map((m) => m.code.toUpperCase()))
  log(`moedas cadastradas (${moedas.length}): ${moedas.map((m) => `${m.code}${m.ativo ? '' : ' (INATIVA)'}`).join(', ') || '(nenhuma)'}`)

  const existentes = await prisma.formaPagamentoCadastro.findMany()
  log(`formas já cadastradas (${existentes.length}): ${existentes.map((f) => `${f.code ?? 's/código'}·${f.name}`).join(' | ') || '(nenhuma)'}`)

  const porNome = new Map(existentes.map((f) => [norm(f.name), f]))
  const porTipo = new Map(existentes.filter((f) => f.type).map((f) => [norm(f.type), f]))
  const porCode = new Map(existentes.filter((f) => f.code).map((f) => [norm(f.code), f]))

  const relatorio = []
  const moedasAusentes = new Set()

  // ── 2. CADASTRO idempotente ───────────────────────────────────────────────
  for (const d of DESEJADAS) {
    const jaExiste = porNome.get(norm(d.name)) ?? porTipo.get(norm(d.type)) ?? porCode.get(norm(d.type))
    if (jaExiste) {
      relatorio.push({ ...jaExiste, _situacao: 'JÁ EXISTENTE', _moedasIgnoradas: [] })
      continue
    }

    const resolvidas = d.moedas.map((m) => [m, resolverMoeda(m, ativas)])
    const aceitas = resolvidas.filter(([, c]) => c).map(([, c]) => c)
    const ignoradas = resolvidas.filter(([, c]) => !c).map(([m]) => m)
    ignoradas.forEach((m) => moedasAusentes.add(m))
    if (aceitas.length === 0) {
      // Nenhuma moeda pedida existe/está ativa: NÃO inventa moeda e NÃO cria a
      // forma sem lastro. Segue para as demais e reporta ao final.
      log(`⚠ "${d.name}" pulada — nenhuma das moedas pedidas existe ativa (${d.moedas.join(', ')}).`)
      relatorio.push({ id: -1, name: d.name, code: null, _situacao: `PULADO (sem moeda: ${d.moedas.join('/')})`, _moedasIgnoradas: ignoradas })
      continue
    }

    const criada = await prisma.$transaction(async (tx) => {
      // Mesma instrução atômica do CodeGeneratorService (scope 'FPG').
      const rows = await tx.$queryRawUnsafe(`
        INSERT INTO "CodeSequence" ("scope", "ultimo", "atualizadoEm")
        VALUES ('FPG', 1, now())
        ON CONFLICT ("scope")
        DO UPDATE SET "ultimo" = "CodeSequence"."ultimo" + 1, "atualizadoEm" = now()
        RETURNING "ultimo"
      `)
      const code = `FPG-${Number(rows[0].ultimo)}`

      return tx.formaPagamentoCadastro.create({
        data: {
          code, name: d.name, type: d.type, categoria: d.categoria, descricao: d.descricao,
          ordem: d.ordem, ativo: true,
          moedasAceitas: aceitas,
          permiteParcelas: d.permiteParcelas,
          minParcelas: d.minParcelas,
          maxParcelas: d.permiteParcelas ? d.maxParcelas : null,
          exigeAdquirente: d.exigeAdquirente,
          usoRecebimento: d.usoRecebimento,
          usoPagamento: d.usoPagamento,
          permiteAntecipacao: d.permiteAntecipacao,
          permiteInternacional: d.permiteInternacional,
          aceitaMoedaEstrangeira: resolvidas.some(([m, c]) => c && m !== 'BRL'),
          permiteComprovante: true,
          permiteCobrancaManual: true,
          tipoIntegracao: d.exigeAdquirente ? 'ADQUIRENTE' : 'MANUAL',
        },
      })
    })
    relatorio.push({ ...criada, _situacao: 'CRIADO', _moedasIgnoradas: ignoradas })
  }

  // ── 3. RELATÓRIO — validado relendo do banco ──────────────────────────────
  const finais = await prisma.formaPagamentoCadastro.findMany({ orderBy: [{ ordem: 'asc' }, { name: 'asc' }] })
  const situacao = new Map(relatorio.map((r) => [r.id, r._situacao]))
  const ignoradasPorId = new Map(relatorio.map((r) => [r.id, r._moedasIgnoradas]))

  console.log('\n[seed-formas] ===== RELATÓRIO FINAL (lido do banco) =====')
  console.log('nome | code | ativo | parcela | min | max | moedas | adquirente | antecip. | receb. | pgto | situação')
  for (const f of finais) {
    console.log([
      f.name, f.code ?? '—', f.ativo ? 'sim' : 'não',
      f.permiteParcelas ? 'sim' : 'não', f.minParcelas ?? '—', f.maxParcelas ?? '1',
      (f.moedasAceitas ?? []).join('/') || (f.moeda ?? '—'),
      f.exigeAdquirente ? 'sim' : 'não', f.permiteAntecipacao ? 'sim' : 'não',
      f.usoRecebimento ? 'sim' : 'não', f.usoPagamento ? 'sim' : 'não',
      situacao.get(f.id) ?? 'PRÉ-EXISTENTE (fora do escopo)',
      (ignoradasPorId.get(f.id) ?? []).length ? `moedas ignoradas: ${ignoradasPorId.get(f.id).join(',')}` : '',
    ].join(' | '))
  }
  if (moedasAusentes.size) {
    console.log(`[seed-formas] ATENÇÃO — moedas pedidas que NÃO existem ou estão inativas (não foram criadas): ${[...moedasAusentes].join(', ')}`)
  }
  for (const r of relatorio.filter((x) => x.id === -1)) {
    console.log(`${r.name} | — | — | — | — | — | — | — | — | — | — | ${r._situacao}`)
  }
  console.log('[seed-formas] ===== FIM DO RELATÓRIO =====\n')

  const depois = await retratar(prisma)
  if (depois.requerentes < retrato.requerentes) {
    console.error(`[seed-formas] ABORTADO: requerentes caiu de ${retrato.requerentes} para ${depois.requerentes}.`)
    process.exit(1)
  }
  log('OK — cadastro idempotente concluído.')
} catch (err) {
  console.error('[seed-formas] ERRO:', String(err?.message ?? err).slice(0, 400))
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
