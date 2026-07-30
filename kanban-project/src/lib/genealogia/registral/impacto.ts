// src/lib/genealogia/registral/impacto.ts
//
// MRG — ANÁLISE DE IMPACTO e REVALIDAÇÃO PÓS-APLICAÇÃO (requisitos 13 e 14).
// Puro: recebe o estado ANTES e o estado DEPOIS e devolve o que mudou.
//
// A regra que este módulo torna executável: uma aplicação é ABORTADA quando
// produz inconsistência crítica que não existia antes. Não é "avisar depois": é
// abortar a transação.

import { apurarElegibilidade, compararElegibilidade, type EntradaElegibilidade } from "./elegibilidade"
import { verificarIntegridade, type EntradaIntegridade } from "./integridade"
import type {
  Inconsistencia,
  ResultadoElegibilidade,
  ResultadoLinhagemRegistral,
  SeveridadeRegistral,
} from "./tipos"

export interface EstadoGenealogico {
  integridade: EntradaIntegridade
  elegibilidade: EntradaElegibilidade
}

export interface FotoEstado {
  inconsistencias: Inconsistencia[]
  elegibilidade: ResultadoElegibilidade
}

/** Calcula a foto de um estado (usado antes e depois). */
export function fotografar(e: EstadoGenealogico): FotoEstado {
  const inconsistencias = verificarIntegridade(e.integridade)
  const elegibilidade = apurarElegibilidade({ ...e.elegibilidade, inconsistencias })
  return { inconsistencias, elegibilidade }
}

export interface ContagensImpacto {
  pessoasAfetadas: number
  arvoresAfetadas: number
  requerentesAfetados: number
  processosAfetados: number
  vinculosAlterados: number
  documentosRelacionados: number
  necessidadesRecalculadas: number
}

export interface ResultadoImpacto {
  contagens: ContagensImpacto
  inconsistenciasCriadas: Inconsistencia[]
  inconsistenciasResolvidas: Inconsistencia[]
  linhaAntes: number[]
  linhaDepois: number[]
  elegibilidadeAntes: ResultadoLinhagemRegistral
  elegibilidadeDepois: ResultadoLinhagemRegistral
  riscoDuplicidade: SeveridadeRegistral
  riscoDocumental: SeveridadeRegistral
  riscoOperacional: SeveridadeRegistral
  /** true quando a aplicação DEVE ser abortada. */
  bloqueado: boolean
  motivoBloqueio: string | null
  /** Texto pronto para auditoria e para a proposta. */
  resumo: string
}

export function analisarImpacto(p: {
  antes: FotoEstado
  depois: FotoEstado
  contagens: ContagensImpacto
  /** Alteração explicitamente aprovada por humano para mexer na linha. */
  linhaAprovadaPorHumano: boolean
}): ResultadoImpacto {
  const chaveInc = (i: Inconsistencia) =>
    `${i.codigo}|${[...i.pessoaIds].sort((a, b) => a - b).join(",")}|${i.campo ?? ""}`

  const antesSet = new Set(p.antes.inconsistencias.map(chaveInc))
  const depoisSet = new Set(p.depois.inconsistencias.map(chaveInc))

  const criadas = p.depois.inconsistencias.filter((i) => !antesSet.has(chaveInc(i)))
  const resolvidas = p.antes.inconsistencias.filter((i) => !depoisSet.has(chaveInc(i)))

  const delta = compararElegibilidade(p.antes.elegibilidade, p.depois.elegibilidade)

  const criticasCriadas = criadas.filter((i) => i.severidade === "CRITICO")
  const altasCriadas = criadas.filter((i) => i.severidade === "ALTO")

  const motivos: string[] = []
  if (criticasCriadas.length) {
    motivos.push(
      `a aplicação criaria ${criticasCriadas.length} inconsistência(s) CRÍTICA(s): ${criticasCriadas.map((i) => i.descricao).join("; ")}`,
    )
  }
  if (delta.perdeuComprovacao) {
    motivos.push("a linha de cidadania DEIXARIA de estar documentalmente comprovada")
  }
  if ((delta.mudouTransmissor || delta.mudouResultado) && !p.linhaAprovadaPorHumano) {
    motivos.push(
      `a alteração muda a linha de cidadania (${delta.descricao}) e não há aprovação humana registrada para isso`,
    )
  }

  const riscoDuplicidade: SeveridadeRegistral = criadas.some(
    (i) => i.codigo.includes("DUPLICAD") || i.codigo.includes("DUPLICIDADE"),
  )
    ? "ALTO"
    : p.depois.inconsistencias.some((i) => i.codigo.includes("DUPLICAD"))
      ? "MEDIO"
      : "INFO"

  const riscoDocumental: SeveridadeRegistral =
    p.contagens.necessidadesRecalculadas > 0 || p.contagens.documentosRelacionados > 0
      ? p.contagens.necessidadesRecalculadas > 3
        ? "ALTO"
        : "MEDIO"
      : "INFO"

  const riscoOperacional: SeveridadeRegistral =
    p.contagens.processosAfetados > 1
      ? "ALTO"
      : p.contagens.requerentesAfetados > 0
        ? "MEDIO"
        : altasCriadas.length
          ? "MEDIO"
          : "INFO"

  return {
    contagens: p.contagens,
    inconsistenciasCriadas: criadas,
    inconsistenciasResolvidas: resolvidas,
    linhaAntes: p.antes.elegibilidade.caminhoPrincipal?.ids ?? [],
    linhaDepois: p.depois.elegibilidade.caminhoPrincipal?.ids ?? [],
    elegibilidadeAntes: p.antes.elegibilidade.resultado,
    elegibilidadeDepois: p.depois.elegibilidade.resultado,
    riscoDuplicidade,
    riscoDocumental,
    riscoOperacional,
    bloqueado: motivos.length > 0,
    motivoBloqueio: motivos.length ? motivos.join(" · ") : null,
    resumo: resumir(p.contagens, criadas.length, resolvidas.length, delta.descricao),
  }
}

function resumir(c: ContagensImpacto, criadas: number, resolvidas: number, deltaLinha: string): string {
  return [
    `${c.pessoasAfetadas} pessoa(s)`,
    `${c.vinculosAlterados} vínculo(s)`,
    `${c.requerentesAfetados} requerente(s)`,
    `${c.processosAfetados} processo(s)`,
    `${c.documentosRelacionados} documento(s)`,
    `${c.necessidadesRecalculadas} necessidade(s)`,
    `+${criadas} / -${resolvidas} inconsistência(s)`,
    `linha: ${deltaLinha}`,
  ].join(" · ")
}

/**
 * REVALIDAÇÃO PÓS-APLICAÇÃO (requisito 14). Rodada DENTRO da transação, depois
 * da escrita: se qualquer verificação crítica falhar, o chamador reverte.
 *
 * As dez verificações do requisito, na ordem:
 *   1. não criou ciclo
 *   2. não criou duplicidade
 *   3. não removeu linhagem válida
 *   4. não associou documento à pessoa errada
 *   5. não satisfez necessidade incorreta
 *   6. não alterou outro processo indevidamente
 *   7. não contradisse evidência mais forte
 *   8. não produziu inconsistência temporal
 *   9. não criou relação biologicamente impossível
 *  10. não alterou elegibilidade sem revisão
 */
export interface EntradaRevalidacao {
  antes: FotoEstado
  depois: FotoEstado
  /** Documentos que a operação associou e a pessoa de destino de cada um. */
  associacoesDocumentais: Array<{ documentoId: number; pessoaId: number; pessoaEsperadaId: number | null }>
  /** Necessidades que a operação marcou como atendidas. */
  necessidadesAtendidas: Array<{ necessidadeId: number; temDocumentoVinculado: boolean }>
  /** Processos tocados pela operação × processos autorizados pela proposta. */
  processosTocados: number[]
  processosAutorizados: number[]
  /** Evidências contrárias mais fortes que a favorável (peso > peso). */
  evidenciaContrariaMaisForte: boolean
  /** A proposta tinha aprovação humana explícita para mudar a linha. */
  linhaAprovadaPorHumano: boolean
}

export interface FalhaRevalidacao {
  verificacao: string
  critica: boolean
  detalhe: string
}

export function revalidar(e: EntradaRevalidacao): {
  ok: boolean
  falhas: FalhaRevalidacao[]
  criticas: FalhaRevalidacao[]
} {
  const falhas: FalhaRevalidacao[] = []
  const chaveInc = (i: Inconsistencia) =>
    `${i.codigo}|${[...i.pessoaIds].sort((a, b) => a - b).join(",")}|${i.campo ?? ""}`
  const antesSet = new Set(e.antes.inconsistencias.map(chaveInc))
  const novas = e.depois.inconsistencias.filter((i) => !antesSet.has(chaveInc(i)))

  // 1. ciclo
  const ciclos = novas.filter((i) => i.codigo === "CICLO_GENEALOGICO" || i.codigo === "PESSOA_ANCESTRAL_DE_SI")
  if (ciclos.length) {
    falhas.push({
      verificacao: "nao_criou_ciclo",
      critica: true,
      detalhe: `${ciclos.length} ciclo(s) genealógico(s) criado(s): ${ciclos.map((c) => c.descricao).join("; ")}`,
    })
  }

  // 2. duplicidade
  const dup = novas.filter((i) => i.codigo.includes("DUPLICAD"))
  if (dup.length) {
    falhas.push({
      verificacao: "nao_criou_duplicidade",
      critica: true,
      detalhe: `${dup.length} duplicidade(s) criada(s): ${dup.map((c) => c.descricao).join("; ")}`,
    })
  }

  // 3. não removeu linhagem válida
  const delta = compararElegibilidade(e.antes.elegibilidade, e.depois.elegibilidade)
  if (delta.perdeuComprovacao) {
    falhas.push({
      verificacao: "nao_removeu_linhagem_valida",
      critica: true,
      detalhe: "A linha estava documentalmente comprovada antes da alteração e deixou de estar.",
    })
  }

  // 4. documento associado à pessoa correta
  for (const a of e.associacoesDocumentais) {
    if (a.pessoaEsperadaId != null && a.pessoaEsperadaId !== a.pessoaId) {
      falhas.push({
        verificacao: "documento_associado_a_pessoa_correta",
        critica: true,
        detalhe: `Documento #${a.documentoId} foi associado à pessoa ${a.pessoaId}, mas a proposta indicava ${a.pessoaEsperadaId}.`,
      })
    }
  }

  // 5. necessidade satisfeita só com documento vinculado
  for (const n of e.necessidadesAtendidas) {
    if (!n.temDocumentoVinculado) {
      falhas.push({
        verificacao: "nao_satisfez_necessidade_incorreta",
        critica: true,
        detalhe: `Necessidade #${n.necessidadeId} foi marcada como atendida sem documento vinculado.`,
      })
    }
  }

  // 6. nenhum processo fora do autorizado
  const autorizados = new Set(e.processosAutorizados)
  const invasores = e.processosTocados.filter((p) => !autorizados.has(p))
  if (invasores.length) {
    falhas.push({
      verificacao: "nao_alterou_outro_processo",
      critica: true,
      detalhe: `A operação tocou os processos ${invasores.join(", ")}, que não estavam no escopo autorizado.`,
    })
  }

  // 7. evidência mais forte contrária
  if (e.evidenciaContrariaMaisForte) {
    falhas.push({
      verificacao: "nao_contradisse_evidencia_mais_forte",
      critica: true,
      detalhe: "Existe evidência contrária de peso maior que a evidência que sustentou a alteração.",
    })
  }

  // 8. inconsistência temporal
  const temporais = novas.filter(
    (i) =>
      i.codigo === "OBITO_ANTES_DO_NASCIMENTO" ||
      i.codigo === "CASAMENTO_APOS_OBITO" ||
      i.codigo === "LONGEVIDADE_IMPLAUSIVEL" ||
      i.codigo.startsWith("MOTOR_CONFLITO"),
  )
  if (temporais.length) {
    falhas.push({
      verificacao: "nao_produziu_inconsistencia_temporal",
      critica: true,
      detalhe: temporais.map((t) => t.descricao).join("; "),
    })
  }

  // 9. relação biologicamente impossível
  const bio = novas.filter(
    (i) =>
      i.codigo === "FILHO_NASCIDO_ANTES_DO_GENITOR" ||
      i.codigo === "GENITOR_IDADE_IMPOSSIVEL" ||
      i.codigo === "CONJUGES_INCOMPATIVEIS" ||
      i.codigo === "FILIACAO_CONTRADITORIA",
  )
  if (bio.length) {
    falhas.push({
      verificacao: "nao_criou_relacao_biologicamente_impossivel",
      critica: true,
      detalhe: bio.map((t) => t.descricao).join("; "),
    })
  }

  // 10. elegibilidade sem revisão
  if ((delta.mudouResultado || delta.mudouTransmissor) && !e.linhaAprovadaPorHumano) {
    falhas.push({
      verificacao: "nao_alterou_elegibilidade_sem_revisao",
      critica: true,
      detalhe: `A elegibilidade mudou (${delta.descricao}) sem aprovação humana explícita para alteração de linha.`,
    })
  }

  // Não crítica, mas registrada: inconsistências ALTAS novas.
  const altas = novas.filter((i) => i.severidade === "ALTO")
  if (altas.length) {
    falhas.push({
      verificacao: "inconsistencias_altas_criadas",
      critica: false,
      detalhe: altas.map((a) => a.descricao).join("; "),
    })
  }

  const criticas = falhas.filter((f) => f.critica)
  return { ok: criticas.length === 0, falhas, criticas }
}
