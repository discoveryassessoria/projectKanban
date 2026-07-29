// lib/db/identidade-banco.mjs
// ============================================================================
// IDENTIDADE E CLASSIFICAÇÃO DE BANCO — fonte única.
//
// Existe por causa do incidente de 21/07/2026: um `prisma migrate diff
// --shadow-database-url <produção>` resetou o banco de produção. Shadow database
// é DESCARTÁVEL por definição — o Prisma derruba o schema e reaplica migrations
// nele. Apontar produção para lá destrói produção.
//
// Toda checagem de segurança de banco do projeto passa por aqui.
// ============================================================================

/** Tabelas que só existem no Discovery. Ausência = não é banco deste sistema. */
export const TABELAS_SENTINELA = ['Requerente', 'Contratante', 'Processo', 'Usuario', '_prisma_migrations']

/** Assinatura mínima de PRODUÇÃO. Abaixo disso, não se escreve. */
export const ASSINATURA_PRODUCAO = {
  minTabelas: 100,
  minMigrations: 60,
  minRequerentes: 700,
}

export const CLASSE = {
  PRODUCAO: 'PRODUCAO',
  STAGING: 'STAGING',
  DESENVOLVIMENTO: 'DESENVOLVIMENTO',
  DANIFICADO: 'DANIFICADO',
  DESCONHECIDO: 'DESCONHECIDO',
}

/** Host + database, sem credencial. Serve para log e comparação. */
export function identificador(url) {
  try {
    const u = new URL(url)
    const usuario = (u.username || '').slice(0, 8)
    return `${u.host}${u.pathname}#${usuario}`
  } catch {
    return '(url ilegível)'
  }
}

/** Duas URLs apontam para o mesmo banco? Compara host+path+usuário, ignora a senha. */
export function mesmoBanco(a, b) {
  if (!a || !b) return false
  const norm = (u) => {
    try {
      const x = new URL(u)
      // pooled.db.prisma.io e db.prisma.io são endpoints do MESMO banco.
      const host = x.host.replace(/^pooled\./, '')
      return `${host}${x.pathname}#${x.username}`
    } catch {
      return String(u)
    }
  }
  return norm(a) === norm(b)
}

/**
 * Classifica um banco a partir de um "retrato" já coletado por SELECTs.
 * Função PURA — quem consulta é o chamador.
 */
export function classificar(retrato) {
  const { tabelas = 0, migrations = 0, requerentes = 0, sentinelasAusentes = [] } = retrato

  if (sentinelasAusentes.length === TABELAS_SENTINELA.length) return CLASSE.DESCONHECIDO
  if (sentinelasAusentes.length > 0) return CLASSE.DANIFICADO

  // INCOERÊNCIA: as tabelas sentinela responderam, mas a contagem de tabelas
  // veio zero. Isso não descreve banco nenhum — é leitura falha. Classificar
  // como DESENVOLVIMENTO seria ler um soluço de rede como "banco vazio"; o
  // certo é assumir que não sabemos.
  if (tabelas === 0) return CLASSE.DESCONHECIDO

  const a = ASSINATURA_PRODUCAO
  if (tabelas >= a.minTabelas && migrations >= a.minMigrations && requerentes >= a.minRequerentes) {
    return CLASSE.PRODUCAO
  }
  if (tabelas >= a.minTabelas && migrations >= 20) return CLASSE.STAGING
  return CLASSE.DESENVOLVIMENTO
}

/** Coleta o retrato do banco com SELECTs — nenhuma escrita. */
export async function retratar(prisma) {
  const q = (s) => prisma.$queryRawUnsafe(s)
  // UMA nova tentativa antes de desistir. Sem isso, uma falha transitória de
  // consulta virava "0" e o banco de PRODUÇÃO era classificado como
  // DESENVOLVIMENTO — foi o que derrubou um deploy com 153 tabelas lidas
  // segundos antes, no mesmo build.
  const n = async (s) => {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try { return Number((await q(s))[0].n) } catch { /* tenta de novo */ }
    }
    return 0
  }
  const tabelas = await n(
    `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
  )
  const sentinelasAusentes = []
  for (const t of TABELAS_SENTINELA) {
    const existe = await n(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`)
    if (!existe) sentinelasAusentes.push(t)
  }
  const migrations = sentinelasAusentes.includes('_prisma_migrations')
    ? 0
    : await n(`SELECT count(*)::int n FROM _prisma_migrations WHERE finished_at IS NOT NULL`)
  const requerentes = sentinelasAusentes.includes('Requerente') ? 0 : await n(`SELECT count(*)::int n FROM "Requerente"`)
  return { tabelas, migrations, requerentes, sentinelasAusentes }
}

/**
 * TRAVA CENTRAL DO SHADOW DATABASE.
 * O banco principal NUNCA pode servir de shadow — é isso que destruiu produção.
 */
export function validarShadow({ shadowUrl, mainUrl }) {
  if (!shadowUrl) {
    return { ok: false, motivo: 'SHADOW_DATABASE_URL não definida. Shadow database é obrigatório e deve ser descartável.' }
  }
  if (mesmoBanco(shadowUrl, mainUrl)) {
    return { ok: false, motivo: 'SHADOW_DATABASE_URL aponta para o MESMO banco de DATABASE_URL. Shadow é destruído pelo Prisma — proibido.' }
  }
  const id = identificador(shadowUrl)
  if (/prod/i.test(id)) {
    return { ok: false, motivo: `SHADOW_DATABASE_URL parece produção (${id}). Proibido.` }
  }
  return { ok: true, motivo: null }
}

/** Padrões de comando destrutivo que nunca podem rodar contra produção. */
export const COMANDOS_PROIBIDOS_EM_PRODUCAO = [
  /migrate\s+reset/i,
  /migrate\s+dev/i,
  /db\s+push/i,
  /db\s+execute/i,
  /migrate\s+diff/i,
  /--shadow-database-url/i,
  /drop\s+(schema|database|table)/i,
  /truncate/i,
  /delete\s+from\s+"?\w+"?\s*;?\s*$/i, // DELETE sem WHERE
  /prisma\s+db\s+seed/i,
]

/** Um comando é destrutivo para produção? */
export function comandoProibido(comando) {
  const achado = COMANDOS_PROIBIDOS_EM_PRODUCAO.find((re) => re.test(comando))
  return achado ? { proibido: true, padrao: String(achado) } : { proibido: false, padrao: null }
}

/** Confirmação explícita fora do código comum (não basta uma flag no script). */
export function confirmacaoExplicitaOk() {
  return process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO === 'SIM, ESCREVER EM PRODUCAO'
}
