// lib/db/guarda-escrita-producao.mjs
// ============================================================================
// GUARDA ÚNICA PARA SCRIPTS ADMINISTRATIVOS QUE ESCREVEM EM PRODUÇÃO.
//
// Por que existe: quatro scripts de operação de dados (consolidação de
// categorias, ativação de certidões mestre, enquadramentos LMD e matriz órfã)
// nasceram dentro do pipeline de build sem nenhuma trava de ambiente. Liam
// `PRISMA_DATABASE_URL || DATABASE_URL` e escreviam contra o que encontrassem.
// A única barreira era a ausência acidental de credencial no processo — ou
// seja, nenhuma barreira. Um `npm run build` local com o ambiente errado
// carregado escreveria em produção.
//
// As quatro condições abaixo são CUMULATIVAS. Falhando qualquer uma, nem
// sequer se abre conexão com o banco:
//
//   1. VERCEL_ENV === 'production'          → ambiente
//   2. <FLAG ESPECÍFICA> === 'APLICAR'      → intenção, por operação
//   3. PRISMA_DATABASE_URL presente         → origem oficial, SEM fallback
//   4. classificar(retrato) === 'PRODUCAO'  → identidade provada do alvo
//
// DATABASE_URL não é aceita. Ela é a variável genérica que qualquer shell,
// task de editor ou `.env` de desenvolvimento define — foi exatamente esse
// fallback que transformava um build local numa escrita não intencional.
//
// CONTRATO DE SAÍDA:
//   • não autorizado          → exit 0, log explícito, zero escrita, zero conexão;
//   • autorizado e bem-sucedido → exit 0;
//   • autorizado e com falha   → exit != 0, para que build/deploy não fiquem verdes.
// ============================================================================
import { CLASSE, classificar, identificador, retratar } from './identidade-banco.mjs'

/**
 * Ambiente lido pela guarda. Tipado como mapa simples de propósito: os testes
 * injetam objetos literais, e amarrar isso a `process.env` (que exige NODE_ENV)
 * transformaria cada cenário de teste num remendo de tipo.
 *
 * @typedef {Record<string, string | undefined>} Ambiente
 */

/** Valor exato exigido na flag de autorização. Qualquer outro valor não autoriza. */
export const VALOR_FLAG_AUTORIZACAO = 'APLICAR'

/** Única variável aceita como origem da URL de produção. Sem fallback genérico. */
export const VARIAVEL_URL_PRODUCAO = 'PRISMA_DATABASE_URL'

/**
 * Variáveis que NUNCA podem servir de origem para escrita em produção.
 * Documentadas para que a proibição seja legível, não implícita.
 */
export const VARIAVEIS_RECUSADAS = ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'SHADOW_DATABASE_URL']

export const MOTIVO = {
  AUTORIZADO: 'AUTORIZADO',
  AMBIENTE_NAO_PRODUCAO: 'AMBIENTE_NAO_PRODUCAO',
  FLAG_AUSENTE: 'FLAG_AUSENTE',
  URL_PRODUCAO_AUSENTE: 'URL_PRODUCAO_AUSENTE',
  IDENTIDADE_NAO_PRODUCAO: 'IDENTIDADE_NAO_PRODUCAO',
  FALHA_NA_OPERACAO: 'FALHA_NA_OPERACAO',
}

/** Erro da guarda. Distingue "barrado pela trava" de "quebrou no meio". */
export class ErroGuardaProducao extends Error {
  constructor(motivo, mensagem) {
    super(mensagem)
    this.name = 'ErroGuardaProducao'
    this.motivo = motivo
  }
}

/**
 * Avalia SOMENTE o ambiente — função pura, sem tocar em banco.
 * É a etapa que roda antes de qualquer conexão existir.
 *
 * @param {{flag: string, env?: Ambiente}} opcoes
 * @returns {{autorizado: boolean, motivo: string, detalhe: string, fatal: boolean, url: string|null}}
 *   `fatal` distingue "não é para rodar aqui" (exit 0) de "é para rodar aqui,
 *   mas a configuração está quebrada" (exit != 0).
 */
export function avaliarAutorizacao({ flag, env = process.env } = /** @type {any} */ ({})) {
  if (!flag) throw new Error('guarda: a flag específica de autorização é obrigatória')

  const ambiente = env.VERCEL_ENV ?? ''
  if (ambiente !== 'production') {
    return {
      autorizado: false,
      fatal: false,
      motivo: MOTIVO.AMBIENTE_NAO_PRODUCAO,
      detalhe: `VERCEL_ENV=${ambiente || '(vazio)'} — operação de dados só roda em production`,
      url: null,
    }
  }

  if (env[flag] !== VALOR_FLAG_AUTORIZACAO) {
    const atual = env[flag]
    return {
      autorizado: false,
      fatal: false,
      motivo: MOTIVO.FLAG_AUSENTE,
      detalhe: `${flag}=${atual === undefined ? '(ausente)' : `"${atual}"`} — exigido "${VALOR_FLAG_AUTORIZACAO}"`,
      url: null,
    }
  }

  const url = env[VARIAVEL_URL_PRODUCAO] ?? ''
  if (!url) {
    // Ambiente e intenção dizem "é para rodar", mas falta a origem oficial.
    // Isso é configuração quebrada num deploy de produção, não "não é aqui".
    return {
      autorizado: false,
      fatal: true,
      motivo: MOTIVO.URL_PRODUCAO_AUSENTE,
      detalhe: `${VARIAVEL_URL_PRODUCAO} ausente. ${VARIAVEIS_RECUSADAS.join(', ')} NÃO são aceitas como origem.`,
      url: null,
    }
  }

  return { autorizado: true, fatal: false, motivo: MOTIVO.AUTORIZADO, detalhe: 'autorizado', url }
}

/**
 * Prova a identidade do alvo por SELECTs (nenhuma escrita) antes de liberar.
 * Lança ErroGuardaProducao se o banco não for classificado como PRODUCAO.
 */
export async function exigirIdentidadeProducao({ prisma, url, nome }) {
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(
    `[${nome}] alvo: ${identificador(url)} · classe=${classe} ` +
    `(tabelas=${retrato.tabelas}, migrations=${retrato.migrations}, requerentes=${retrato.requerentes})`,
  )
  if (classe !== CLASSE.PRODUCAO) {
    throw new ErroGuardaProducao(
      MOTIVO.IDENTIDADE_NAO_PRODUCAO,
      `identidade do alvo é ${classe}, não ${CLASSE.PRODUCAO} — escrita abortada antes de qualquer alteração`,
    )
  }
  return { retrato, classe }
}

/**
 * Executa a operação sob as quatro travas. Conexão só é aberta DEPOIS de o
 * ambiente autorizar — `criarPrisma` é chamado tarde de propósito.
 *
 * Lança em caso de falha autorizada; quem chama decide o código de saída.
 *
 * @param {{nome: string, flag: string, criarPrisma: () => any, operacao: (ctx: any) => Promise<void>, env?: Ambiente}} opcoes
 */
export async function executarOperacaoProducao({ nome, flag, criarPrisma, operacao, env = process.env }) {
  const veredito = avaliarAutorizacao({ flag, env })

  if (veredito.fatal) {
    throw new ErroGuardaProducao(veredito.motivo, veredito.detalhe)
  }

  if (!veredito.autorizado) {
    console.log(`[${nome}] ESCRITA IGNORADA — ${veredito.detalhe}`)
    console.log(`[${nome}] nenhuma conexão de banco foi aberta e nenhum dado foi alterado.`)
    return { executado: false, motivo: veredito.motivo }
  }

  const prisma = criarPrisma()
  try {
    const { retrato, classe } = await exigirIdentidadeProducao({ prisma, url: veredito.url, nome })
    await operacao({ prisma, url: veredito.url, retrato, classe })
    return { executado: true, motivo: MOTIVO.AUTORIZADO }
  } finally {
    await prisma.$disconnect?.().catch(() => {})
  }
}

/**
 * Ponto de entrada dos scripts. Traduz o resultado em código de saída:
 * pulou → 0 · executou → 0 · falhou depois de autorizado → 1.
 *
 * Nunca relança: quem chama é o topo do processo.
 *
 * @param {{nome: string, flag: string, criarPrisma: () => any, operacao: (ctx: any) => Promise<void>, env?: Ambiente}} opcoes
 */
export async function rodarScriptProducao(opcoes) {
  try {
    return await executarOperacaoProducao(opcoes)
  } catch (erro) {
    const detalhe = String(erro?.message ?? erro)
    console.error(`[${opcoes.nome}] FALHA: ${detalhe}`)
    console.error(`[${opcoes.nome}] nada foi confirmado — a transação não foi commitada.`)
    process.exitCode = 1
    return { executado: false, motivo: erro?.motivo ?? MOTIVO.FALHA_NA_OPERACAO, erro }
  }
}
