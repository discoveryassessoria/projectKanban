// src/services/cartorios/cartorio-sync-service.ts
//
// SERVIÇO ÚNICO de sincronização da base nacional de Cartórios — mesma porta pro
// cron diário e pro botão "Sincronizar agora" (nunca dois fluxos). Idempotente,
// com trava de concorrência (advisory lock), UPSERT nunca DELETE+REINSERT, e
// reconciliação de ausência SEGURA: nunca inativa por uma sincronização
// incompleta (ver `sincronizacaoPareceCompleta`).
//
// Modelo: `Cartorio` (schema.prisma) — tabela NOVA, isolada de `OrgaoProtocolo`
// (cadastro mestre admin-curado, ver comentário do model). Fonte:
// `registro-civil-cartorios-provider.ts`.
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { buscarTodosOsCartoriosDaFonte, type CartorioBruto } from "@/src/lib/integrations/registro-civil-cartorios-provider"

// Chave fixa do advisory lock da sincronização de cartórios. TRANSACTION-LEVEL
// (`pg_try_advisory_xact_lock`, não `pg_try_advisory_lock`) de propósito: contra
// um banco em pool (PRISMA_DATABASE_URL/pooled.db.prisma.io), duas chamadas
// `$queryRawUnsafe` separadas podem cair em conexões físicas DIFERENTES do
// pool — testado e comprovado: um `pg_advisory_unlock` depois do job chamou uma
// sessão que nunca tinha o lock, e a trava ficou presa pra sempre (achado real,
// 16/09/2026). `pg_try_advisory_xact_lock` some sozinho quando a transação
// termina (commit OU rollback) — nenhum unlock manual, nenhuma sessão errada.
const LOCK_KEY = 559182634
// Confirmação de ausência: só inativa depois de N sincronizações COMPLETAS
// consecutivas sem ver o cartório — uma falha isolada nunca inativa ninguém.
const SYNCS_CONSECUTIVAS_PARA_INATIVAR = 3
// Sinal de resposta anormalmente pequena (proteção contra paginação quebrada /
// endpoint mudou / erro parcial da fonte): comparado contra a última corrida
// bem-sucedida. Abaixo disso, a sincronização é tratada como INCOMPLETA e a
// reconciliação de ausência não roda.
const FRACAO_MINIMA_ACEITAVEL = 0.9

export interface ResumoSincronizacao {
  gatilho: string
  runId: number
  bloqueadoPorConcorrencia: boolean
  status: "SUCESSO" | "FALHA" | "BLOQUEADO_CONCORRENCIA" | "ABORTADO_INCOMPLETO"
  fetched: number
  inserted: number
  updated: number
  unchanged: number
  missing: number
  inactivated: number
  errors: number
  errorMessage: string | null
  duracaoMs: number
}

/** minúsculo, sem acento, espaços colapsados — só para busca, nunca exibido. */
export function normalizarNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // º/ª (indicador ordinal) não são marca combinante — NFD não os remove.
    // Sem isto, quem busca "5 subdistrito" nunca acha "5º Subdistrito".
    .replace(/[ºª]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function textoOuNulo(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}


function normalizarBruto(b: CartorioBruto) {
  return {
    sourceId: String(b.cartorio_id),
    cns: textoOuNulo(b.num_cnj),
    nome: (b.cartorio ?? "").trim().slice(0, 300),
    nomeNormalizado: normalizarNome(b.cartorio ?? "").slice(0, 300),
    uf: (b.uf ?? "").trim().toUpperCase().slice(0, 2),
    municipio: (b.cidade ?? "").trim().slice(0, 150),
    endereco: textoOuNulo(b.endereco),
    telefone: textoOuNulo(b.telefone),
    email: textoOuNulo(b.email),
    responsavel: textoOuNulo(b.oficial),
    regiao: textoOuNulo(b.regiao),
    entidade: textoOuNulo(b.entidade),
    // A FONTE JÁ FILTRA: nos 7120 registros verificados, `flag_ativo` sempre "S"
    // (inativos simplesmente não aparecem na resposta). Mesmo assim lemos o
    // campo real em vez de assumir — se um dia vier "N", respeitamos.
    ativo: b.flag_ativo !== "N",
  }
}

/**
 * A resposta parece COMPLETA o bastante para confiar na ausência como sinal?
 * Sem histórico prévio (1ª sincronização), qualquer resposta com dados conta.
 */
// PURA, sem I/O — testável sem tocar o banco (nenhum teste automatizado deste
// serviço precisa escrever em produção pra provar a lógica de queda brusca).
export function avaliarCompletude(fetchedAgora: number, ultimoFetchOk: number | null): { completa: boolean; motivo: string | null } {
  if (fetchedAgora <= 0) return { completa: false, motivo: "resposta vazia" }
  if (ultimoFetchOk == null || ultimoFetchOk <= 0) return { completa: true, motivo: null }
  const fracao = fetchedAgora / ultimoFetchOk
  if (fracao < FRACAO_MINIMA_ACEITAVEL) {
    return { completa: false, motivo: `fetched=${fetchedAgora} é só ${(fracao * 100).toFixed(1)}% da última sincronização bem-sucedida (${ultimoFetchOk})` }
  }
  return { completa: true, motivo: null }
}

export async function sincronizacaoPareceCompleta(fetchedAgora: number): Promise<{ completa: boolean; motivo: string | null }> {
  const ultimaOk = await prisma.cartorioSyncRun.findFirst({
    where: { status: "SUCESSO" },
    orderBy: { startedAt: "desc" },
    select: { fetched: true },
  })
  return avaliarCompletude(fetchedAgora, ultimaOk?.fetched ?? null)
}

/**
 * ENTRADA ÚNICA (cron + "Sincronizar agora"). fetch → validate → normalize →
 * upsert → reconciliação segura de ausência. NUNCA delete+reinsert.
 */
export async function sincronizarCartorios(opts?: { gatilho?: string }): Promise<ResumoSincronizacao> {
  const gatilho = opts?.gatilho ?? "cron"
  const inicio = Date.now()

  const run = await prisma.cartorioSyncRun.create({
    data: { status: "EXECUTANDO", gatilho },
    select: { id: true },
  })

  const base: ResumoSincronizacao = {
    gatilho, runId: run.id, bloqueadoPorConcorrencia: false, status: "FALHA",
    fetched: 0, inserted: 0, updated: 0, unchanged: 0, missing: 0, inactivated: 0, errors: 0,
    errorMessage: null, duracaoMs: 0,
  }

  try {
    const resposta = await buscarTodosOsCartoriosDaFonte()
    if (!resposta.ok) {
      const errorMessage = `falha ao buscar da fonte: ${resposta.erro}`
      await prisma.cartorioSyncRun.update({
        where: { id: run.id },
        data: { status: "FALHA", finishedAt: new Date(), errorMessage, errors: 1 },
      })
      return { ...base, status: "FALHA", errors: 1, errorMessage, duracaoMs: Date.now() - inicio }
    }

    const fetched = resposta.notaries.length
    const sourceIdsVistos = new Set<string>()
    // BULK, não linha-a-linha: 7120 registros em round-trips individuais levava
    // dezenas de minutos contra o banco remoto (achado real ao rodar a 1ª carga)
    // — inviável pro cron (maxDuration 60s) e ruim pro botão "Sincronizar agora".
    // Um INSERT ... ON CONFLICT DO UPDATE em lote resolve em segundos.
    let errosDeNormalizacao = 0
    const normalizados = resposta.notaries
      .map(normalizarBruto)
      .filter((n) => {
        if (!n.sourceId || !n.nome || !n.uf) { errosDeNormalizacao++; return false }
        return true
      })
    for (const n of normalizados) sourceIdsVistos.add(n.sourceId)

    // TUDO dentro de UMA transação: é o que dá ao advisory lock TRANSACTION-LEVEL
    // (pg_try_advisory_xact_lock) uma conexão física fixa do início ao fim — e é
    // por isso que ele existe (ver comentário de LOCK_KEY acima).
    const resultado = await prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) as ok`
      if (!lock?.[0]?.ok) {
        return { bloqueado: true as const }
      }

      let inserted = 0, updated = 0, unchanged = 0, errors = errosDeNormalizacao
      const TAMANHO_DO_LOTE = 500
      for (let i = 0; i < normalizados.length; i += TAMANHO_DO_LOTE) {
        const lote = normalizados.slice(i, i + TAMANHO_DO_LOTE)
        try {
          const agora = new Date()
          const valores = Prisma.join(
            lote.map((n) => Prisma.sql`(${n.sourceId}, ${n.cns}, ${n.nome}, ${n.nomeNormalizado}, ${n.uf}, ${n.municipio}, ${n.endereco}, ${n.telefone}, ${n.email}, ${n.responsavel}, ${n.regiao}, ${n.entidade}, ${n.ativo}, ${agora}, ${agora}, ${agora}, ${agora})`),
          )
          // Passo 1: upsert GATEADO por mudança real — só aparece no RETURNING
          // quem foi de fato inserido ou alterado (WHERE falso = Postgres não
          // conta como ação, não entra no RETURNING). `xmax = 0` distingue
          // INSERT de UPDATE dentro do que retornou.
          const alterados = await tx.$queryRaw<{ sourceId: string; inserted: boolean }[]>`
            INSERT INTO "Cartorio"
              ("sourceId","cns","nome","nomeNormalizado","uf","municipio","endereco","telefone","email","responsavel","regiao","entidade","ativo","firstSeenAt","lastSeenAt","lastSyncedAt","updatedAt")
            VALUES ${valores}
            ON CONFLICT ("sourceId") DO UPDATE SET
              "cns" = EXCLUDED."cns", "nome" = EXCLUDED."nome", "nomeNormalizado" = EXCLUDED."nomeNormalizado",
              "uf" = EXCLUDED."uf", "municipio" = EXCLUDED."municipio", "endereco" = EXCLUDED."endereco",
              "telefone" = EXCLUDED."telefone", "email" = EXCLUDED."email", "responsavel" = EXCLUDED."responsavel",
              "regiao" = EXCLUDED."regiao", "entidade" = EXCLUDED."entidade", "ativo" = EXCLUDED."ativo",
              "updatedAt" = EXCLUDED."updatedAt"
            WHERE
              "Cartorio"."cns" IS DISTINCT FROM EXCLUDED."cns" OR
              "Cartorio"."nome" IS DISTINCT FROM EXCLUDED."nome" OR
              "Cartorio"."nomeNormalizado" IS DISTINCT FROM EXCLUDED."nomeNormalizado" OR
              "Cartorio"."uf" IS DISTINCT FROM EXCLUDED."uf" OR
              "Cartorio"."municipio" IS DISTINCT FROM EXCLUDED."municipio" OR
              "Cartorio"."endereco" IS DISTINCT FROM EXCLUDED."endereco" OR
              "Cartorio"."telefone" IS DISTINCT FROM EXCLUDED."telefone" OR
              "Cartorio"."email" IS DISTINCT FROM EXCLUDED."email" OR
              "Cartorio"."responsavel" IS DISTINCT FROM EXCLUDED."responsavel" OR
              "Cartorio"."regiao" IS DISTINCT FROM EXCLUDED."regiao" OR
              "Cartorio"."entidade" IS DISTINCT FROM EXCLUDED."entidade" OR
              "Cartorio"."ativo" IS DISTINCT FROM EXCLUDED."ativo"
            RETURNING "sourceId", (xmax = 0) AS inserted
          `
          inserted += alterados.filter((a) => a.inserted).length
          updated += alterados.filter((a) => !a.inserted).length
          unchanged += lote.length - alterados.length

          // Passo 2: SEMPRE toca lastSeenAt/lastSyncedAt/limpa ausência pro lote
          // inteiro (inclusive quem não mudou nada) — é o sinal que a
          // reconciliação de ausência usa.
          const ids = Prisma.join(lote.map((n) => n.sourceId))
          await tx.$executeRaw`
            UPDATE "Cartorio" SET "lastSeenAt" = ${agora}, "lastSyncedAt" = ${agora}, "missingSince" = NULL, "consecutiveMissingSyncs" = 0
            WHERE "sourceId" IN (${ids})
          `
        } catch (e) {
          console.error("[CARTORIO_SYNC] falha no lote", i, "-", i + lote.length, ":", e)
          errors += lote.length
        }
      }

      // RECONCILIAÇÃO DE AUSÊNCIA — só roda se a resposta parecer completa. Uma
      // sincronização parcial NUNCA inativa ninguém (achado do próprio comando:
      // "delete all + reinsert é proibido", e o equivalente pra ausência é não
      // reconciliar sem confiança na completude).
      let missing = 0, inactivated = 0
      const completude = await sincronizacaoPareceCompleta(fetched)
      if (completude.completa) {
        const ausentes = await tx.cartorio.findMany({
          where: { ativo: true, sourceId: { notIn: [...sourceIdsVistos] } },
          select: { id: true, consecutiveMissingSyncs: true, missingSince: true },
        })
        missing = ausentes.length
        for (const a of ausentes) {
          const novaContagem = a.consecutiveMissingSyncs + 1
          if (novaContagem >= SYNCS_CONSECUTIVAS_PARA_INATIVAR) {
            await tx.cartorio.update({
              where: { id: a.id },
              data: { ativo: false, consecutiveMissingSyncs: novaContagem },
            })
            inactivated++
          } else {
            await tx.cartorio.update({
              where: { id: a.id },
              data: { missingSince: a.missingSince ?? new Date(), consecutiveMissingSyncs: novaContagem },
            })
          }
        }
      }

      return { bloqueado: false as const, inserted, updated, unchanged, missing, inactivated, errors, completude }
    }, { maxWait: 20_000, timeout: 180_000 })

    if (resultado.bloqueado) {
      await prisma.cartorioSyncRun.update({
        where: { id: run.id },
        data: { status: "BLOQUEADO_CONCORRENCIA", finishedAt: new Date() },
      })
      return { ...base, bloqueadoPorConcorrencia: true, status: "BLOQUEADO_CONCORRENCIA", duracaoMs: Date.now() - inicio }
    }

    const { inserted, updated, unchanged, missing, inactivated, errors, completude } = resultado
    const status: ResumoSincronizacao["status"] = completude.completa ? "SUCESSO" : "ABORTADO_INCOMPLETO"
    const errorMessage = completude.completa ? null : completude.motivo
    await prisma.cartorioSyncRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), fetched, inserted, updated, unchanged, missing, inactivated, errors, errorMessage },
    })

    console.log(`[CARTORIO_SYNC] gatilho=${gatilho} status=${status} fetched=${fetched} inserted=${inserted} updated=${updated} unchanged=${unchanged} missing=${missing} inactivated=${inactivated} errors=${errors} duration=${Date.now() - inicio}ms`)

    return { ...base, status, fetched, inserted, updated, unchanged, missing, inactivated, errors, errorMessage, duracaoMs: Date.now() - inicio }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    await prisma.cartorioSyncRun.update({
      where: { id: run.id },
      data: { status: "FALHA", finishedAt: new Date(), errorMessage, errors: 1 },
    }).catch(() => null)
    console.error("[CARTORIO_SYNC] falha:", e)
    return { ...base, status: "FALHA", errors: 1, errorMessage, duracaoMs: Date.now() - inicio }
  }
}

/** Status atual, pra tela administrativa — só lê o banco, nunca chama a fonte. */
export async function statusDaSincronizacao() {
  const [total, ativos, ultimaSucesso, ultimaTentativa] = await Promise.all([
    prisma.cartorio.count(),
    prisma.cartorio.count({ where: { ativo: true } }),
    prisma.cartorioSyncRun.findFirst({ where: { status: "SUCESSO" }, orderBy: { startedAt: "desc" } }),
    prisma.cartorioSyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ])
  return {
    fonte: "Registro Civil / Portal da Transparência",
    total, ativos, inativos: total - ativos,
    ultimaSincronizacaoBemSucedida: ultimaSucesso,
    ultimaTentativa,
  }
}
