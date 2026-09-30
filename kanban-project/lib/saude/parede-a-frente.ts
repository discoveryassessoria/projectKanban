// lib/saude/parede-a-frente.ts
// ============================================================================
// A "PAREDE À FRENTE" — os achados CAD-012/WF-004 que a Torre lista (Precisa de você e aba Processos).
//
// ─── POR QUE ESTE ARQUIVO EXISTE (achado real, 30/09/2026) ───────────────────
// A CAD-012 foi corrigida no código (lê a versão congelada da Biblioteca), mas o "Precisa de você"
// continuou mostrando "Apostilar documento" e "Registrar necessidade de retificação". Causa: o achado
// ANTIGO continua ABERTO no banco. A Saúde só o resolve quando roda de novo a verificação que o gerou, e
// CAD-012/WF-004 são dos modos COMPLETO/PROFUNDO — o cron horário é RÁPIDO (não as inclui); só o
// PROFUNDO das 04h UTC (ou uma rodada manual) as reexecuta. Até lá, a Torre listava um problema que a
// verificação, hoje, já não acusa. E nenhum filtro por data resolve isso: o achado velho foi gerado pela
// ÚLTIMA execução que rodou a verificação — não há execução mais nova para compará-lo.
//
// ─── O QUE ESTE ARQUIVO FAZ ─────────────────────────────────────────────────
// Só LÊ. Para cada verificação que tem achado aberto, a Torre CONFIRMA agora: reexecuta a verificação (que
// só lê) e mantém apenas o achado cuja chave ela ainda produz. Não escreve em SaudeAchado nem em
// SaudeExecucao — o motor de gravação da Saúde não é tocado; o achado velho continua aberto no painel de
// Saúde até a próxima rodada o resolver.
//
// ABSTENÇÃO HONESTA: ausência de resultado não é ausência de problema. Se a verificação falha, estoura o
// tempo, some do catálogo ou o achado não tem a forma de chave do motor (`CODIGO::local`), o achado
// PERMANECE — só some o que a verificação, executada com sucesso, deixou de acusar.
// ============================================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { verificacaoPorCodigo } from './catalogo'
import { chaveGlobal } from './persistencia'

export const CODIGOS_DA_PAREDE = ['CAD-012', 'WF-004'] as const

type Db = typeof prisma | Prisma.TransactionClient

/** As chaves (globais, como gravadas em `SaudeAchado.chave`) que a verificação acusa AGORA; `null` = não deu para confirmar. */
export type Reconfirmador = (codigo: string, agora: Date) => Promise<Set<string> | null>

/** O reconfirmador real: reexecuta a verificação do catálogo (somente leitura), com o mesmo tempo limite do motor. */
export const reconfirmarNoCatalogo: Reconfirmador = async (codigo, agora) => {
  // O catálogo se preenche por efeito de importar `lib/saude` (cada verificação se registra). Import dinâmico:
  // evita ciclo de módulos com quem lê a parede (Torre) e garante que a verificação exista aqui.
  await import('./index')
  const v = verificacaoPorCodigo(codigo)
  if (!v) return null
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const r = await Promise.race([
      v.executar({ agora, modo: 'COMPLETO' }),
      new Promise<never>((_, rejeitar) => { timer = setTimeout(() => rejeitar(new Error('timeout')), v.timeoutMs) }),
    ])
    return new Set((r.achados ?? []).map((a) => chaveGlobal(codigo, a.chave)))
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Achados abertos e não ignorados agora, ainda ACUSADOS pela verificação de hoje. */
export async function achadosVigentesDaParede(
  db: Db, agora: Date, opts: { reconfirmar?: Reconfirmador; limite?: number } = {},
) {
  const abertos = await db.saudeAchado.findMany({
    where: {
      codigo: { in: [...CODIGOS_DA_PAREDE] },
      status: { notIn: ['RESOLVIDO'] },
      OR: [{ status: { not: 'IGNORADO' } }, { ignoradoAte: { lt: agora } }],
    },
    orderBy: { ultimaDeteccao: 'desc' },
    take: opts.limite ?? 20,
  })
  if (abertos.length === 0) return abertos
  const reconfirmar = opts.reconfirmar ?? reconfirmarNoCatalogo
  const codigos = [...new Set(abertos.map((a) => a.codigo))]
  const acusadas = new Map<string, Set<string> | null>(
    await Promise.all(codigos.map(async (c) => [c, await reconfirmar(c, agora)] as const)),
  )
  return abertos.filter((a) => {
    const vigentes = acusadas.get(a.codigo)
    if (vigentes == null) return true                       // não deu para confirmar: permanece
    if (!a.chave.startsWith(`${a.codigo}::`)) return true   // não é chave do motor: não há como confirmar, permanece
    return vigentes.has(a.chave)
  })
}
