// src/services/registral/reconstrucao.ts
//
// MRG — RECONSTRUÇÃO GENEALÓGICA CRUZADA (requisito 1 e requisito 5 do protocolo).
//
// Esta é a etapa que diferencia "processar 30 certidões" de "reconstruir uma
// árvore". Documento por documento, o pipeline produz ocorrências e fatos. Aqui o
// lote é tratado como CONJUNTO:
//
//   · a mesma pessoa é reconhecida em documentos diferentes (mesmo que grafada
//     de formas diferentes) e as ocorrências são agrupadas em CLUSTERS;
//   · filiação declarada num documento é cruzada com a identidade estabelecida
//     noutro (o "pai" da certidão de nascimento do filho é o "registrado" da
//     certidão de nascimento dele);
//   · hipóteses são confrontadas: coincidem → reforço; contradizem → conflito;
//   · árvore inexistente é reconstruída; árvore existente é complementada;
//   · NADA é apagado ou substituído: só propostas e, quando inequívoco,
//     complementos aditivos.
//
// Idempotente: reprocessar o mesmo lote reconverge (mesmos clusters, mesmas
// chaves de proposta) e não duplica pessoa, vínculo, evidência ou proposta.

import { prisma } from "@/lib/prisma"
import { chaveProposta } from "@/src/lib/genealogia/registral/chaves"
import { criticidadeDaAlteracao } from "@/src/lib/genealogia/registral/campos"
import { propostaDeInconsistencia, propostaDeRelacao } from "@/src/lib/genealogia/registral/propostas"
import { verificarIntegridade } from "@/src/lib/genealogia/registral/integridade"
import { ehVariacaoDeCasamento } from "@/src/lib/genealogia/registral/normalizacao"
import { similaridadeLocal, similaridadeNome, anoDe } from "@/src/lib/genealogia/motor/texto"
import type { EvidenciaIdentidade, PropostaMontada } from "@/src/lib/genealogia/registral/tipos"
import { auditar, logRegistral } from "./auditoria"
import { ACOES_AUDITORIA } from "./constantes"
import { carregarContexto, carregarFatos, carregarPessoas, carregarUnioes } from "./estado"
import { abrirConflito } from "./pipeline"
import { persistirProposta } from "./propostas-db"

/** Similaridade mínima para duas ocorrências entrarem no mesmo cluster. */
export const LIMIAR_CLUSTER = 0.9

interface OcorrenciaLote {
  id: number
  documentoId: number
  papel: string
  nomeBruto: string
  nomeNormalizado: string
  chaveFonetica: string | null
  sexoInferido: string | null
  pessoaResolvidaId: number | null
  atributos: Record<string, unknown>
}

export interface ClusterIdentidade {
  /** Ocorrências que o motor considera a MESMA identidade humana. */
  ocorrenciaIds: number[]
  documentoIds: number[]
  nomes: string[]
  pessoaId: number | null
  /** Por que estas ocorrências foram agrupadas. */
  evidencias: string[]
}

export interface ResultadoReconstrucao {
  clusters: number
  pessoasCriadas: number
  vinculosCriados: number
  propostasCriadas: number
  conflitosAbertos: number
  duplicidadesEvitadas: number
  resumo: string
}

export async function reconstruirDoLote(p: {
  loteId: number
  usuarioId?: number | null
}): Promise<ResultadoReconstrucao> {
  const lote = await prisma.loteRegistral.findUnique({
    where: { id: p.loteId },
    select: { id: true, processoId: true, arvoreId: true, correlationId: true },
  })
  if (!lote) throw new Error(`Lote registral ${p.loteId} não encontrado`)

  const linhas = await prisma.ocorrenciaDocumental.findMany({
    where: { execucao: { loteId: p.loteId } },
    select: {
      id: true,
      documentoId: true,
      papel: true,
      nomeBruto: true,
      nomeNormalizado: true,
      chaveFonetica: true,
      sexoInferido: true,
      pessoaResolvidaId: true,
      atributos: true,
    },
    orderBy: { id: "asc" },
  })

  const ocorrencias: OcorrenciaLote[] = linhas.map((o) => ({
    ...o,
    atributos: (o.atributos && typeof o.atributos === "object" && !Array.isArray(o.atributos)
      ? (o.atributos as Record<string, unknown>)
      : {}) as Record<string, unknown>,
  }))

  // ---------------------------------------------------------------- 1. clusters
  const clusters = agruparPorIdentidade(ocorrencias)

  // ------------------------------------------ 2. propostas de vínculo cruzado
  const ctx = await carregarContexto(prisma, lote.processoId)
  const requerenteIds = new Set(ctx?.requerenteIds ?? [])
  const montadas: PropostaMontada[] = []
  let conflitos = 0
  let duplicidadesEvitadas = 0

  const porOcorrencia = new Map(ocorrencias.map((o) => [o.id, o]))
  const clusterDeOcorrencia = new Map<number, ClusterIdentidade>()
  for (const c of clusters) for (const id of c.ocorrenciaIds) clusterDeOcorrencia.set(id, c)

  const nomes = await nomesDePessoas(clusters)

  for (const doc of documentosDe(ocorrencias)) {
    const registrado = doc.ocorrencias.find((o) => o.papel === "REGISTRADO")
    if (!registrado) continue
    const clusterFilho = clusterDeOcorrencia.get(registrado.id)
    const filhoId = clusterFilho?.pessoaId ?? registrado.pessoaResolvidaId
    if (filhoId == null) continue

    for (const papel of ["PAI", "MAE"] as const) {
      const genitorOc = doc.ocorrencias.find((o) => o.papel === papel)
      if (!genitorOc) continue
      const clusterGenitor = clusterDeOcorrencia.get(genitorOc.id)
      const genitorId = clusterGenitor?.pessoaId ?? genitorOc.pessoaResolvidaId
      if (genitorId == null) continue
      if (genitorId === filhoId) {
        conflitos += await abrirConflito({
          processoId: lote.processoId,
          arvoreId: lote.arvoreId,
          loteId: lote.id,
          execucaoId: null,
          codigo: "FILIACAO_APONTA_PARA_SI",
          severidade: "CRITICO",
          pessoaId: filhoId,
          descricao: `O documento #${doc.documentoId} produziria filiação da pessoa para si mesma`,
          explicacao:
            "A identidade resolvida para o registrado e para o genitor é a mesma. Isso indica erro de identificação entre homônimos.",
          acaoSugerida: "Conferir qual das duas menções pertence a qual pessoa antes de aceitar o vínculo.",
          evidencias: [`ocorrencias ${registrado.id} e ${genitorOc.id}`],
          documentoIds: [doc.documentoId],
          assinatura: `self:${filhoId}`,
        })
        continue
      }

      const atual = await prisma.pessoa.findUnique({
        where: { id: filhoId },
        select: { id: true, nome: true, sobrenome: true, paiId: true, maeId: true },
      })
      if (!atual) continue
      const genitorAtualId = papel === "PAI" ? atual.paiId : atual.maeId
      if (genitorAtualId === genitorId) continue // já vinculado: nada a propor

      const evidencias: EvidenciaIdentidade[] = [
        {
          campo: "documento",
          descricao: `O documento #${doc.documentoId} declara “${genitorOc.nomeBruto}” como ${papel.toLowerCase()} de “${registrado.nomeBruto}”.`,
          favoravel: true,
          peso: 3,
        },
        ...(clusterGenitor?.evidencias ?? []).map((e) => ({
          campo: "identidade",
          descricao: e,
          favoravel: true,
          peso: 1,
        })),
      ]

      const afetaLinha = requerenteIds.has(filhoId) || requerenteIds.has(genitorId)

      montadas.push(
        propostaDeRelacao({
          processoId: lote.processoId,
          documentoId: doc.documentoId,
          tipo: genitorAtualId == null ? "CRIAR_RELACIONAMENTO" : "CORRIGIR_RELACIONAMENTO",
          filhoId,
          genitorId,
          genitorAtualId,
          papel,
          nomeFilho: [atual.nome, atual.sobrenome].filter(Boolean).join(" "),
          nomeGenitor: nomes.get(genitorId) ?? genitorOc.nomeNormalizado,
          nomeGenitorAtual: genitorAtualId != null ? (nomes.get(genitorAtualId) ?? `pessoa #${genitorAtualId}`) : null,
          confianca: genitorAtualId == null ? 0.85 : 0.7,
          evidencias,
          afetaLinhaCidadania: afetaLinha,
          afetaRequerente: requerenteIds.has(filhoId),
          processosAfetados: 1,
        }),
      )
    }
  }

  // ------------------------------- 3. hipóteses de identidade entre documentos
  for (const c of clusters) {
    if (c.pessoaId != null) continue
    if (c.ocorrenciaIds.length < 2) continue
    // Cluster com 2+ ocorrências e nenhuma pessoa: a MESMA pessoa aparece em
    // vários documentos e ainda não existe no cadastro. É uma única proposta de
    // criação (não uma por documento) — é assim que se evita duplicidade.
    duplicidadesEvitadas += c.ocorrenciaIds.length - 1
    const primeira = porOcorrencia.get(c.ocorrenciaIds[0])
    if (!primeira) continue

    const veredicto = criticidadeDaAlteracao({
      tipo: "CRIAR_PESSOA",
      campo: null,
      substituiValorExistente: false,
      valorAtualConfirmado: false,
      afetaLinhaCidadania: false,
      afetaRequerente: false,
      processosAfetados: 1,
      existeConflitoAberto: false,
      alteracaoEmMassa: false,
      irreversivel: false,
    })

    montadas.push({
      operacao: {
        tipo: "CRIAR_PESSOA",
        entidadeAlvo: "PESSOA",
        alvoId: null,
        campo: null,
        valorAtual: null,
        valorProposto: primeira.nomeNormalizado,
        dados: {
          documentoId: primeira.documentoId,
          papel: primeira.papel,
          nomeBruto: primeira.nomeBruto,
          sexoInferido: primeira.sexoInferido,
          atributos: mesclarAtributos(c.ocorrenciaIds.map((id) => porOcorrencia.get(id)!).filter(Boolean)),
          documentosQueCitam: c.documentoIds,
          ocorrenciaIds: c.ocorrenciaIds,
        },
      },
      criticidade: veredicto.criticidade,
      aplicavelAutomaticamente: false,
      confianca: 0.75,
      justificativa: `“${primeira.nomeBruto}” aparece em ${c.documentoIds.length} documento(s) do lote (${c.documentoIds.map((d) => `#${d}`).join(", ")}) e não corresponde a nenhuma pessoa cadastrada. As menções foram agrupadas como a mesma identidade: ${c.evidencias.join("; ")}.`,
      regraAplicada: "MRG-RECONSTRUCAO-CRIAR-PESSOA",
      recomendacao: "Conferir se a pessoa realmente não existe e criar uma única vez para todas as menções.",
      risco: "MEDIO",
      evidenciasFavoraveis: c.evidencias.map((e) => ({ campo: "identidade", descricao: e, favoravel: true, peso: 2 })),
      evidenciasContrarias: [],
      origemValorAtual: null,
      origemValorProposto: `Documentos ${c.documentoIds.map((d) => `#${d}`).join(", ")}`,
      pessoasAfetadas: [],
      // A chave NÃO pode conter id de ocorrência: reprocessar o documento cria
      // ocorrências novas e a mesma proposta nasceria duas vezes. A identidade da
      // proposta é (papel, nome) — que é justamente o que o revisor decide. Assim
      // ela também COINCIDE com a proposta por ocorrência, e as duas convergem
      // numa só, acumulando evidência em vez de duplicar.
      chaveIdempotencia: chaveProposta({
        processoId: lote.processoId,
        tipo: "CRIAR_PESSOA",
        entidadeAlvo: "PESSOA",
        alvoId: null,
        campo: null,
        valorProposto: `${primeira.papel}:${primeira.nomeNormalizado}`,
      }),
    })
  }

  // ---------------------------------- 4. integridade da árvore após o lote
  if (lote.arvoreId != null) {
    const pessoas = await carregarPessoas(prisma, lote.arvoreId)
    const pessoaIds = pessoas.map((x) => x.id)
    const unioes = await carregarUnioes(prisma, pessoaIds)
    const fatos = await carregarFatos(prisma, pessoaIds, unioes.map((u) => u.id))
    const inconsistencias = verificarIntegridade({
      pessoas,
      unioes,
      requerenteIds: [...requerenteIds],
      fatos,
    })

    for (const i of inconsistencias) {
      conflitos += await abrirConflito({
        processoId: lote.processoId,
        arvoreId: lote.arvoreId,
        loteId: lote.id,
        execucaoId: null,
        codigo: i.codigo,
        severidade: i.severidade,
        campo: i.campo ?? null,
        pessoaId: i.pessoaIds[0] ?? null,
        uniaoId: i.uniaoIds?.[0] ?? null,
        descricao: i.descricao,
        explicacao: i.explicacao,
        acaoSugerida: i.acaoSugerida,
        evidencias: i.evidencias,
        documentoIds: [],
        assinatura: i.evidencias.join("|"),
      })
      const proposta = propostaDeInconsistencia({ processoId: lote.processoId, inconsistencia: i })
      if (proposta) montadas.push(proposta)
    }
  }

  // ---------------------------------------------------------- 5. persistência
  let propostasCriadas = 0
  for (const m of montadas) {
    const r = await persistirProposta({
      processoId: lote.processoId,
      arvoreId: lote.arvoreId,
      loteId: lote.id,
      execucaoId: null,
      correlationId: lote.correlationId,
      montada: m,
    })
    if (r.criada) propostasCriadas++
  }

  const resumo = `${clusters.length} cluster(s) de identidade · ${propostasCriadas} proposta(s) nova(s) · ${conflitos} conflito(s) · ${duplicidadesEvitadas} duplicidade(s) evitada(s)`

  await auditar(prisma, {
    acao: ACOES_AUDITORIA.LOTE_CRIADO,
    entidade: "LoteRegistral",
    entidadeId: lote.id,
    descricao: `Reconstrução cruzada do lote ${lote.id}: ${resumo}`,
    detalhes: {
      clusters: clusters.length,
      propostas: propostasCriadas,
      conflitos,
      duplicidadesEvitadas,
    },
    usuarioId: p.usuarioId ?? null,
    correlationId: lote.correlationId,
  })
  logRegistral("info", "reconstrucao_concluida", { loteId: lote.id, clusters: clusters.length, propostasCriadas, conflitos })

  return {
    clusters: clusters.length,
    // Pessoa e vínculo NUNCA são criados por este serviço: são propostas.
    // Quem cria é `aplicar.ts`, depois de decisão (humana ou da matriz).
    pessoasCriadas: 0,
    vinculosCriados: 0,
    propostasCriadas,
    conflitosAbertos: conflitos,
    duplicidadesEvitadas,
    resumo,
  }
}

// ============================================================================
// clusterização de identidade dentro do lote
// ============================================================================

/**
 * Agrupa ocorrências que são a MESMA pessoa. Conservador por construção:
 *   · ocorrências já resolvidas para a mesma Pessoa entram no mesmo cluster;
 *   · duas ocorrências não resolvidas só se juntam com nome equivalente E
 *     nenhum atributo contraditório (data, local, filiação);
 *   · ocorrências resolvidas para pessoas DIFERENTES nunca se juntam.
 */
export function agruparPorIdentidade(ocorrencias: OcorrenciaLote[]): ClusterIdentidade[] {
  const clusters: ClusterIdentidade[] = []

  const novo = (o: OcorrenciaLote, motivo: string): ClusterIdentidade => ({
    ocorrenciaIds: [o.id],
    documentoIds: [o.documentoId],
    nomes: [o.nomeNormalizado],
    pessoaId: o.pessoaResolvidaId,
    evidencias: [motivo],
  })

  for (const o of ocorrencias) {
    let alvo: ClusterIdentidade | null = null
    let motivo = ""

    for (const c of clusters) {
      // Resolvidas para pessoas diferentes: proibido juntar.
      if (o.pessoaResolvidaId != null && c.pessoaId != null && o.pessoaResolvidaId !== c.pessoaId) continue

      // Mesma Pessoa resolvida: é a mesma identidade, sem discussão.
      if (o.pessoaResolvidaId != null && c.pessoaId === o.pessoaResolvidaId) {
        alvo = c
        motivo = `mesma pessoa já identificada no Cadastro Mestre (#${o.pessoaResolvidaId})`
        break
      }

      const compat = compativel(o, c, ocorrencias)
      if (compat.ok) {
        alvo = c
        motivo = compat.motivo
        break
      }
    }

    if (alvo) {
      alvo.ocorrenciaIds.push(o.id)
      if (!alvo.documentoIds.includes(o.documentoId)) alvo.documentoIds.push(o.documentoId)
      if (!alvo.nomes.includes(o.nomeNormalizado)) alvo.nomes.push(o.nomeNormalizado)
      if (alvo.pessoaId == null) alvo.pessoaId = o.pessoaResolvidaId
      if (!alvo.evidencias.includes(motivo)) alvo.evidencias.push(motivo)
    } else {
      clusters.push(novo(o, o.pessoaResolvidaId != null ? `identidade já resolvida (#${o.pessoaResolvidaId})` : "primeira menção deste nome no lote"))
    }
  }

  return clusters
}

function compativel(
  o: OcorrenciaLote,
  c: ClusterIdentidade,
  todas: OcorrenciaLote[],
): { ok: boolean; motivo: string } {
  const doCluster = todas.filter((x) => c.ocorrenciaIds.includes(x.id))

  for (const outro of doCluster) {
    const sim = similaridadeNome(o.nomeNormalizado, outro.nomeNormalizado)
    const mesmaFonetica = !!o.chaveFonetica && o.chaveFonetica === outro.chaveFonetica

    let base = sim >= LIMIAR_CLUSTER
    let motivo = `nome equivalente a “${outro.nomeNormalizado}” (${(sim * 100).toFixed(0)}%)`

    // Nome de casada: prenome preservado + sobrenome do cônjuge.
    if (!base) {
      const conjugeOutro = texto(outro.atributos.nomeConjuge)
      const conjugeO = texto(o.atributos.nomeConjuge)
      const r1 = conjugeOutro ? ehVariacaoDeCasamento(outro.nomeNormalizado, o.nomeNormalizado, conjugeOutro) : null
      const r2 = conjugeO ? ehVariacaoDeCasamento(o.nomeNormalizado, outro.nomeNormalizado, conjugeO) : null
      if (r1?.compativel || r2?.compativel) {
        base = true
        motivo = `variação de nome de casamento entre “${outro.nomeNormalizado}” e “${o.nomeNormalizado}”`
      }
    }

    if (!base && mesmaFonetica && sim >= 0.8) {
      base = true
      motivo = `mesma chave fonética (variação de grafia) com “${outro.nomeNormalizado}”`
    }

    if (!base) continue

    // Sexo divergente derruba.
    const sexoA = (o.sexoInferido || "").charAt(0).toUpperCase()
    const sexoB = (outro.sexoInferido || "").charAt(0).toUpperCase()
    if (sexoA && sexoB && sexoA !== sexoB) continue

    // Atributos contraditórios derrubam — é o que impede fundir homônimos.
    const contradicao = contradiz(o, outro)
    if (contradicao) continue

    return { ok: true, motivo }
  }

  return { ok: false, motivo: "" }
}

function contradiz(a: OcorrenciaLote, b: OcorrenciaLote): string | null {
  const anoA = anoDe(texto(a.atributos.dataNascimento))
  const anoB = anoDe(texto(b.atributos.dataNascimento))
  if (anoA != null && anoB != null && Math.abs(anoA - anoB) > 2) {
    return `datas de nascimento incompatíveis (${anoA} × ${anoB})`
  }

  const obA = anoDe(texto(a.atributos.dataObito))
  const obB = anoDe(texto(b.atributos.dataObito))
  if (obA != null && obB != null && Math.abs(obA - obB) > 1) {
    return `datas de óbito incompatíveis (${obA} × ${obB})`
  }

  const localA = texto(a.atributos.localNascimento)
  const localB = texto(b.atributos.localNascimento)
  if (localA && localB && similaridadeLocal(localA, localB) < 0.5) {
    return `locais de nascimento distintos (“${localA}” × “${localB}”)`
  }

  for (const campo of ["nomePai", "nomeMae"] as const) {
    const na = texto(a.atributos[campo])
    const nb = texto(b.atributos[campo])
    if (na && nb && similaridadeNome(na, nb) < 0.6) {
      return `filiação declarada divergente em ${campo} (“${na}” × “${nb}”)`
    }
  }

  return null
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

/** Une os atributos de todas as menções de uma identidade (o mais completo vence). */
function mesclarAtributos(ocorrencias: OcorrenciaLote[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const o of ocorrencias) {
    for (const [k, v] of Object.entries(o.atributos)) {
      if (v == null || v === "") continue
      if (out[k] == null) out[k] = v
    }
  }
  return out
}

function documentosDe(ocorrencias: OcorrenciaLote[]): Array<{ documentoId: number; ocorrencias: OcorrenciaLote[] }> {
  const mapa = new Map<number, OcorrenciaLote[]>()
  for (const o of ocorrencias) {
    const arr = mapa.get(o.documentoId)
    if (arr) arr.push(o)
    else mapa.set(o.documentoId, [o])
  }
  return [...mapa.entries()]
    .map(([documentoId, lista]) => ({ documentoId, ocorrencias: lista }))
    .sort((a, b) => a.documentoId - b.documentoId)
}

async function nomesDePessoas(clusters: ClusterIdentidade[]): Promise<Map<number, string>> {
  const ids = [...new Set(clusters.map((c) => c.pessoaId).filter((x): x is number => x != null))]
  if (!ids.length) return new Map()
  const linhas = await prisma.pessoa.findMany({
    where: { id: { in: ids } },
    select: { id: true, nome: true, sobrenome: true },
  })
  return new Map(linhas.map((p) => [p.id, [p.nome, p.sobrenome].filter(Boolean).join(" ")]))
}
