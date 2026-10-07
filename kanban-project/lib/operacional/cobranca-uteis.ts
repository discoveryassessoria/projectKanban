// lib/operacional/cobranca-uteis.ts
// ============================================================================
// «COBRAR A PARTIR DE» — 10 DIAS ÚTEIS (07/10/2026). É só um LEMBRETE: não trava nada, não muda status, não escala sozinho.
//   • dias ÚTEIS: sem sábado, domingo e feriado nacional (`src/lib/diasUteis.ts`), contados no calendário de São Paulo;
//   • o padrão (10) é configurável em ConfiguracaoSistema (`torre.cobranca.dias_uteis_padrao`) e cada cartório pode ter o seu (`torre.cobranca.orgao.<id>`);
//   • só vale para pedidos enviados a partir de `COBRANCA_UTEIS_VIGENTE_DESDE`: o lembrete de quem já estava na espera NÃO muda de data (continua nos 10 dias
//     corridos do cálculo antigo) — nada gravado ou já cobrado é reescrito.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { getFeriadosNacionais } from '@/src/lib/diasUteis'
import { diaOperacional, prazoOperacional } from './tempo-operacional'

type Db = typeof prisma | Prisma.TransactionClient

/** A partir daqui (meia-noite de São Paulo) o pedido enviado usa dias ÚTEIS. */
export const COBRANCA_UTEIS_VIGENTE_DESDE = new Date('2026-10-08T00:00:00-03:00')
export const DIAS_UTEIS_PADRAO_DA_COBRANCA = 10
export const CHAVE_PADRAO_COBRANCA = 'torre.cobranca.dias_uteis_padrao'
export const chaveCobrancaDoOrgao = (orgaoId: number) => `torre.cobranca.orgao.${orgaoId}`
const PREFIXO_ORGAO = 'torre.cobranca.orgao.'
const GRUPO = 'torre'
export const LIMITE_DIAS_COBRANCA = 90

export interface ConfigDeCobranca { padraoDias: number; porOrgao: Record<number, number> }
export const CONFIG_DE_COBRANCA_PADRAO: ConfigDeCobranca = { padraoDias: DIAS_UTEIS_PADRAO_DA_COBRANCA, porOrgao: {} }

const diasValidos = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= LIMITE_DIAS_COBRANCA ? n : null }

/** Lê o padrão e os ajustes por cartório (ausência de linha = 10). Nunca lança: sem coluna/linha, vale o padrão. */
export async function lerConfigDeCobranca(db: Db = prisma): Promise<ConfigDeCobranca> {
  try {
    const linhas = await db.configuracaoSistema.findMany({ where: { OR: [{ chave: CHAVE_PADRAO_COBRANCA }, { chave: { startsWith: PREFIXO_ORGAO } }] }, select: { chave: true, valor: true } })
    const cfg: ConfigDeCobranca = { padraoDias: DIAS_UTEIS_PADRAO_DA_COBRANCA, porOrgao: {} }
    for (const l of linhas) {
      const n = diasValidos(l.valor)
      if (n == null) continue
      if (l.chave === CHAVE_PADRAO_COBRANCA) cfg.padraoDias = n
      else { const id = Number(l.chave.slice(PREFIXO_ORGAO.length)); if (Number.isInteger(id)) cfg.porOrgao[id] = n }
    }
    return cfg
  } catch { return { padraoDias: DIAS_UTEIS_PADRAO_DA_COBRANCA, porOrgao: {} } }
}

/** Quantos dias úteis: o do cartório, senão o padrão. */
export const diasDeCobranca = (cfg: ConfigDeCobranca, orgaoId: number | null | undefined): number => (orgaoId != null ? cfg.porOrgao[orgaoId] : undefined) ?? cfg.padraoDias

// ─── dias úteis (puro) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const feriadosDoAno = new Map<number, Set<string>>()
function ehFeriadoCivil(ymd: string): boolean {
  const ano = Number(ymd.slice(0, 4))
  let s = feriadosDoAno.get(ano)
  if (!s) { s = new Set(getFeriadosNacionais(ano).map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)); feriadosDoAno.set(ano, s) }
  return s.has(ymd)
}
function ehDiaUtilCivil(ymd: string): boolean {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay() // dia da semana do dia CIVIL (meio-dia UTC não cruza a data)
  return dow !== 0 && dow !== 6 && !ehFeriadoCivil(ymd)
}
const somaUmDia = (ymd: string): string => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

/** O dia (calendário de São Paulo) que fica `dias` dias ÚTEIS depois de `inicio`; o dia do envio não conta. Devolve meio-dia de São Paulo desse dia. */
export function somarDiasUteis(inicio: Date, dias: number): Date {
  let ymd = diaOperacional(inicio)
  let falta = Math.max(0, Math.floor(dias))
  while (falta > 0) { ymd = somaUmDia(ymd); if (ehDiaUtilCivil(ymd)) falta-- }
  return new Date(`${ymd}T12:00:00-03:00`)
}

/**
 * O «cobrar a partir de» de um pedido enviado em `pedidoEnviadoEm`. Antes da vigência: o cálculo antigo (dias CORRIDOS do prazo do passo) — não muda.
 * Na vigência: dias ÚTEIS (cartório → padrão).
 */
export function lembreteDeCobranca(a: { pedidoEnviadoEm: Date; slaDiasDoPasso: number | null; orgaoId: number | null | undefined; cfg: ConfigDeCobranca }): Date | null {
  if (a.pedidoEnviadoEm.getTime() < COBRANCA_UTEIS_VIGENTE_DESDE.getTime()) return prazoOperacional(a.slaDiasDoPasso, a.pedidoEnviadoEm)
  return somarDiasUteis(a.pedidoEnviadoEm, diasDeCobranca(a.cfg, a.orgaoId))
}

// ─── escrita (auditada) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function definirDiasPadraoDaCobranca(dias: number, autorId: number | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  const n = diasValidos(dias)
  if (n == null) return { ok: false, erro: `Informe um número inteiro de dias úteis entre 1 e ${LIMITE_DIAS_COBRANCA}.` }
  await prisma.$transaction(async (tx) => {
    const antes = (await lerConfigDeCobranca(tx)).padraoDias
    await tx.configuracaoSistema.upsert({ where: { chave: CHAVE_PADRAO_COBRANCA }, create: { chave: CHAVE_PADRAO_COBRANCA, valor: String(n), grupo: GRUPO, atualizadoPor: autorId }, update: { valor: String(n), atualizadoPor: autorId } })
    await tx.logAuditoria.create({ data: { acao: 'COBRANCA_PRAZO_PADRAO_ALTERADO', entidade: 'RegraTorre', entidadeId: null, usuarioId: autorId, descricao: `Prazo de cobrança padrão: ${antes} → ${n} dias úteis (vale para pedidos enviados daqui em diante).`, detalhes: { de: antes, para: n } } })
  })
  return { ok: true }
}

/** `dias = null` remove o ajuste do cartório (volta ao padrão). */
export async function definirDiasDoOrgao(orgaoId: number, dias: number | null, autorId: number | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  const org = await prisma.orgaoProtocolo.findUnique({ where: { id: orgaoId }, select: { id: true, name: true } })
  if (!org) return { ok: false, erro: 'Cartório (órgão) não encontrado.' }
  const n = dias == null ? null : diasValidos(dias)
  if (dias != null && n == null) return { ok: false, erro: `Informe um número inteiro de dias úteis entre 1 e ${LIMITE_DIAS_COBRANCA}.` }
  await prisma.$transaction(async (tx) => {
    const antes = (await lerConfigDeCobranca(tx)).porOrgao[orgaoId] ?? null
    const chave = chaveCobrancaDoOrgao(orgaoId)
    if (n == null) await tx.configuracaoSistema.deleteMany({ where: { chave } }) // é a CONFIGURAÇÃO do ajuste (não é dado histórico): voltar ao padrão
    else await tx.configuracaoSistema.upsert({ where: { chave }, create: { chave, valor: String(n), grupo: GRUPO, atualizadoPor: autorId }, update: { valor: String(n), atualizadoPor: autorId } })
    await tx.logAuditoria.create({ data: { acao: 'COBRANCA_PRAZO_ORGAO_ALTERADO', entidade: 'OrgaoProtocolo', entidadeId: orgaoId, usuarioId: autorId, descricao: `Prazo de cobrança de «${org.name}»: ${antes ?? 'padrão'} → ${n ?? 'padrão'}${n != null ? ' dias úteis' : ''}.`, detalhes: { orgaoId, de: antes, para: n } } })
  })
  return { ok: true }
}
