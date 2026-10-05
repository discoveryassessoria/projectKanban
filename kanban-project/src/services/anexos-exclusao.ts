// src/services/anexos-exclusao.ts
// ============================================================================
// EXCLUIR ANEXO (cliente / protocolo) — a ÚNICA porta que apaga linha de anexo avulso.
//   1. DENTRO da transação: apaga a(s) linha(s) e grava no LogAuditoria quem apagou, qual chave e quando;
//   2. DEPOIS do commit: apaga o objeto no storage (nova tentativa), exceto se outra linha ainda aponta para a mesma chave;
//   3. o resultado do apagar também vai para a auditoria — falha nunca fica em silêncio (o conferidor de órfãos pega o resto).
// Mesmo padrão da exclusão de processo (`processo-ciclo-vida.ts`): objeto nunca é apagado antes do commit, e nunca sobra chave órfã calada.
// ============================================================================
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { apagarChavesComNovaTentativa, chavesAindaReferenciadas, chaveDeUrlOuChave, type ApagadorDeObjeto } from "@/src/services/processo-arquivos"

export type TabelaDeAnexo = "AnexoContratante" | "AnexoRequerente" | "AnexoProtocolo"

export interface ExcluirAnexosInput {
  tabela: TabelaDeAnexo
  /** Escolhe as linhas: ids exatos, ou — só para protocolo — todas as do protocolo. */
  ids?: number[]
  protocoloId?: number
  /** Para o contratante/requerente/protocolo dono: a linha só é apagada se pertencer a ele. */
  donoId?: number
  usuarioId: number
  apagarObjeto?: ApagadorDeObjeto
  novaTentativa?: { tentativas?: number; esperaMs?: number }
}

export interface ResultadoExclusaoAnexos {
  excluidos: number
  chaves: string[]
  apagadas: string[]
  aindaReferenciadas: string[]
  falhas: Array<{ chave: string; erro: string; tentativas: number }>
}

type Linha = { id: number; nome: string; urlArquivo: string }

async function lerEApagarLinhas(tx: Prisma.TransactionClient, i: ExcluirAnexosInput): Promise<Linha[]> {
  const ids = i.ids ?? []
  if (i.tabela === "AnexoContratante") {
    const where = { id: { in: ids }, ...(i.donoId != null ? { contratanteId: i.donoId } : {}) }
    const l = await tx.anexoContratante.findMany({ where, select: { id: true, nome: true, urlArquivo: true } })
    await tx.anexoContratante.deleteMany({ where: { id: { in: l.map((x) => x.id) } } })
    return l
  }
  if (i.tabela === "AnexoRequerente") {
    const where = { id: { in: ids }, ...(i.donoId != null ? { requerenteId: i.donoId } : {}) }
    const l = await tx.anexoRequerente.findMany({ where, select: { id: true, nome: true, urlArquivo: true } })
    await tx.anexoRequerente.deleteMany({ where: { id: { in: l.map((x) => x.id) } } })
    return l
  }
  const where = i.protocoloId != null && !ids.length ? { protocoloId: i.protocoloId } : { id: { in: ids }, ...(i.protocoloId != null ? { protocoloId: i.protocoloId } : {}) }
  const l = await tx.anexoProtocolo.findMany({ where, select: { id: true, nome: true, urlArquivo: true } })
  await tx.anexoProtocolo.deleteMany({ where: { id: { in: l.map((x) => x.id) } } })
  return l
}

export async function excluirAnexos(input: ExcluirAnexosInput): Promise<ResultadoExclusaoAnexos> {
  const quando = new Date()
  const linhas = await prisma.$transaction(async (tx) => {
    const l = await lerEApagarLinhas(tx, input)
    if (l.length) {
      await tx.logAuditoria.create({
        data: {
          acao: "anexo_excluido",
          entidade: input.tabela,
          entidadeId: l.length === 1 ? l[0].id : (input.protocoloId ?? input.donoId ?? null),
          usuarioId: input.usuarioId,
          descricao: `Usuário ${input.usuarioId} excluiu ${l.length} anexo(s) (${input.tabela})`,
          detalhes: JSON.parse(JSON.stringify({
            usuarioId: input.usuarioId, em: quando.toISOString(),
            anexos: l.map((x) => ({ id: x.id, nome: x.nome, chave: chaveDeUrlOuChave(x.urlArquivo, process.env.R2_PUBLIC_URL) ?? "(endereço externo)" })),
          })) as Prisma.InputJsonValue,
        },
      })
    }
    return l
  })

  const chaves = [...new Set(linhas.map((x) => chaveDeUrlOuChave(x.urlArquivo, process.env.R2_PUBLIC_URL)).filter((c): c is string => !!c))]
  const vazio: ResultadoExclusaoAnexos = { excluidos: linhas.length, chaves, apagadas: [], aindaReferenciadas: [], falhas: [] }
  if (!chaves.length) return vazio

  try {
    const ainda = await chavesAindaReferenciadas(chaves, prisma)
    const aApagar = chaves.filter((k) => !ainda.has(k))
    const apagador = input.apagarObjeto ?? (await import("@/src/services/processo-ciclo-vida")).apagadorPadraoDoStorage
    const r = await apagarChavesComNovaTentativa(aApagar, apagador, input.novaTentativa)
    const final = { ...vazio, apagadas: r.apagadas, aindaReferenciadas: [...ainda], falhas: r.falhas }
    if (final.falhas.length) console.error(`[anexo excluido] ${final.falhas.length} objeto(s) NÃO apagado(s):`, final.falhas.map((f) => f.chave))
    await prisma.logAuditoria.create({
      data: {
        acao: final.falhas.length ? "anexo_arquivos_nao_apagados" : "anexo_arquivos_apagados",
        entidade: input.tabela, entidadeId: linhas.length === 1 ? linhas[0].id : null, usuarioId: input.usuarioId,
        descricao: `Exclusão de anexo(s): ${final.apagadas.length} objeto(s) apagado(s) do storage, ${final.falhas.length} NÃO apagado(s), ${final.aindaReferenciadas.length} preservado(s) por ainda terem outra referência`,
        detalhes: JSON.parse(JSON.stringify({ apagadas: final.apagadas, falhas: final.falhas, aindaReferenciadas: final.aindaReferenciadas })) as Prisma.InputJsonValue,
      },
    }).catch((e) => console.error("[anexo excluido] auditoria do apagar falhou:", e))
    return final
  } catch (e) {
    console.error("[anexo excluido] erro ao apagar objetos:", e)
    return { ...vazio, falhas: chaves.map((chave) => ({ chave, erro: String((e as Error)?.message ?? e).slice(0, 200), tentativas: 0 })) }
  }
}
