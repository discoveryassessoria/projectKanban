// src/services/registral/aplicar.ts
//
// MRG — APLICAÇÃO TRANSACIONAL de proposta (requisitos 13 e 14).
//
// A sequência é rígida e não tem atalho:
//
//   1. autorizar (permissão exigida pela matriz — nunca por tipo de usuário)
//   2. IMPACTO PRÉVIO: fotografar o estado, simular, comparar. Bloqueado → aborta
//      antes de escrever qualquer coisa.
//   3. versão ANTES (snapshot lógico)
//   4. TRANSAÇÃO: escrever tudo (pessoa/vínculo/fato/evidência/necessidade/alias)
//   5. REVALIDAÇÃO dentro da transação: as dez verificações do requisito 14.
//      Qualquer falha crítica → throw → ROLLBACK de tudo.
//   6. versão DEPOIS + auditoria + evento
//
// Nada aqui "avisa depois". Estado parcialmente atualizado não existe: ou a
// operação inteira vale, ou nada vale.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { permissaoDaProposta, type PermissaoRegistral } from "@/src/lib/genealogia/registral/campos"
import { chaveDecisao, chaveImpacto, correlationId as montarCorrelation } from "@/src/lib/genealogia/registral/chaves"
import {
  analisarImpacto,
  fotografar,
  revalidar,
  type ContagensImpacto,
  type EstadoGenealogico,
  type FotoEstado,
} from "@/src/lib/genealogia/registral/impacto"
import type { CampoRegistral } from "@/src/lib/genealogia/registral/tipos"
import { adicionarNome } from "@/src/services/cadastro-mestre/nome-pessoa"
import { atenderNecessidade, garantirNecessidade, reabrir } from "@/src/services/necessidade-documental"
import { auditar, logRegistral, publicarEvento } from "./auditoria"
import { ACOES_AUDITORIA, EVENTOS, VERSAO_MOTOR } from "./constantes"
import {
  carregarComprovacao,
  carregarContexto,
  carregarFatos,
  carregarNomes,
  carregarPessoas,
  carregarUnioes,
  processosQueDependemDe,
  requerentesQueDependemDe,
} from "./estado"
import { criarVersao, snapshotAtual } from "./versionamento"

export type ErroAplicacao =
  | "PROPOSTA_NAO_ENCONTRADA"
  | "STATUS_INVALIDO"
  | "SEM_PERMISSAO"
  | "BLOQUEADA_SEM_DESBLOQUEIO"
  | "IMPACTO_BLOQUEADO"
  | "REVALIDACAO_FALHOU"
  | "OPERACAO_NAO_SUPORTADA"
  | "ALVO_INVALIDO"
  | "SEM_ARVORE"

export interface ResultadoAplicacao {
  ok: boolean
  propostaId: number
  codigo?: ErroAplicacao
  mensagem: string
  versaoAntes?: number
  versaoDepois?: number
  impactoId?: number
  falhasRevalidacao?: string[]
}

export interface AtorAplicacao {
  usuarioId: number | null
  /** Mapa de permissões efetivas do ator (calculado por lib/permissoes). */
  permissoes: Record<string, boolean>
  /** true quando é o próprio motor aplicando o que a matriz classificou como AUTOMATICA. */
  ehMotor: boolean
}

function temPermissao(ator: AtorAplicacao, p: PermissaoRegistral): boolean {
  if (ator.ehMotor) return true
  return ator.permissoes[p] === true
}

/**
 * Aplica uma proposta. `motivo` é obrigatório para decisão humana — decisão sem
 * motivo escrito é decisão que ninguém consegue auditar depois.
 */
export async function aplicarProposta(p: {
  propostaId: number
  ator: AtorAplicacao
  motivo: string
  /** Confirmação explícita para propostas classificadas como BLOQUEIO. */
  desbloqueioExplicito?: boolean
  instante?: number
}): Promise<ResultadoAplicacao> {
  const instante = p.instante ?? Date.now()

  const proposta = await prisma.propostaReconciliacao.findUnique({
    where: { id: p.propostaId },
    select: {
      id: true,
      processoId: true,
      arvoreId: true,
      tipo: true,
      criticidade: true,
      status: true,
      entidadeAlvo: true,
      alvoId: true,
      campo: true,
      valorAtual: true,
      valorProposto: true,
      operacao: true,
      pessoasAfetadas: true,
      aplicavelAutomaticamente: true,
      correlationId: true,
      confianca: true,
      evidenciasContrarias: true,
      evidenciasFavoraveis: true,
    },
  })
  if (!proposta) {
    return { ok: false, propostaId: p.propostaId, codigo: "PROPOSTA_NAO_ENCONTRADA", mensagem: "Proposta não encontrada." }
  }
  if (proposta.status !== "PENDENTE" && proposta.status !== "ADIADA" && proposta.status !== "APROVADA") {
    return {
      ok: false,
      propostaId: proposta.id,
      codigo: "STATUS_INVALIDO",
      mensagem: `Proposta em status ${proposta.status}: só PENDENTE, ADIADA ou APROVADA podem ser aplicadas.`,
    }
  }

  // ---------------------------------------------------------------- 1. autorizar
  const permissao = permissaoDaProposta(proposta.tipo, proposta.criticidade)
  if (!temPermissao(p.ator, permissao)) {
    return {
      ok: false,
      propostaId: proposta.id,
      codigo: "SEM_PERMISSAO",
      mensagem: `Esta operação exige a permissão ${permissao}.`,
    }
  }
  if (proposta.criticidade === "BLOQUEIO") {
    if (p.ator.ehMotor) {
      return {
        ok: false,
        propostaId: proposta.id,
        codigo: "BLOQUEADA_SEM_DESBLOQUEIO",
        mensagem: "Proposta bloqueada: o motor nunca aplica operação classificada como bloqueio.",
      }
    }
    if (!p.desbloqueioExplicito) {
      return {
        ok: false,
        propostaId: proposta.id,
        codigo: "BLOQUEADA_SEM_DESBLOQUEIO",
        mensagem:
          "Proposta classificada como BLOQUEIO. Exige confirmação explícita de desbloqueio, com permissão dedicada e motivo escrito.",
      }
    }
  }
  if (p.ator.ehMotor && !proposta.aplicavelAutomaticamente) {
    return {
      ok: false,
      propostaId: proposta.id,
      codigo: "STATUS_INVALIDO",
      mensagem: "O motor só aplica propostas marcadas como aplicáveis automaticamente.",
    }
  }
  if (!p.motivo?.trim() && !p.ator.ehMotor) {
    return { ok: false, propostaId: proposta.id, codigo: "STATUS_INVALIDO", mensagem: "Motivo escrito é obrigatório." }
  }

  const ctx = await carregarContexto(prisma, proposta.processoId)
  const arvoreId = proposta.arvoreId ?? ctx?.arvoreId ?? null
  if (arvoreId == null) {
    return {
      ok: false,
      propostaId: proposta.id,
      codigo: "SEM_ARVORE",
      mensagem: "O processo desta proposta não tem árvore vinculada.",
    }
  }

  const correlationId =
    proposta.correlationId ||
    montarCorrelation({ prefixo: "mrg-aplic", processoId: proposta.processoId, referencia: proposta.id, instante })

  const pessoasAfetadas = Array.isArray(proposta.pessoasAfetadas)
    ? (proposta.pessoasAfetadas as unknown[]).map(Number).filter((x) => Number.isFinite(x))
    : []

  // -------------------------------------------------------- 2. impacto prévio
  const estadoAntes = await carregarEstadoBruto(proposta.processoId, arvoreId)
  const antes = fotografar(estadoAntes)

  const operacao = (proposta.operacao ?? {}) as Record<string, unknown>
  const simulado = fotografar(
    simularEstado(estadoAntes, {
      tipo: proposta.tipo,
      alvoId: proposta.alvoId,
      campo: proposta.campo as CampoRegistral | null,
      valorProposto: proposta.valorProposto,
      operacao,
    }),
  )

  const processosAfetados = await processosQueDependemDe(prisma, pessoasAfetadas)
  const requerentesAfetados = await requerentesQueDependemDe(prisma, pessoasAfetadas)

  const contagens: ContagensImpacto = {
    pessoasAfetadas: pessoasAfetadas.length,
    arvoresAfetadas: 1,
    requerentesAfetados: requerentesAfetados.length,
    processosAfetados: processosAfetados.length,
    vinculosAlterados: vinculosAlteradosPor(proposta.tipo),
    documentosRelacionados: typeof operacao.documentoId === "number" ? 1 : 0,
    necessidadesRecalculadas: 0,
  }

  const linhaAprovada =
    !p.ator.ehMotor && (proposta.criticidade === "BLOQUEIO" ? p.desbloqueioExplicito === true : true)

  const impacto = analisarImpacto({ antes, depois: simulado, contagens, linhaAprovadaPorHumano: linhaAprovada })

  const impactoPrevio = await prisma.impactoAplicacaoRegistral.upsert({
    where: { chaveIdempotencia: chaveImpacto({ propostaId: proposta.id, momento: "PREVIO" }) },
    update: dadosImpacto(impacto, "PREVIO"),
    create: {
      ...dadosImpacto(impacto, "PREVIO"),
      propostaId: proposta.id,
      momento: "PREVIO",
      chaveIdempotencia: chaveImpacto({ propostaId: proposta.id, momento: "PREVIO" }),
    },
    select: { id: true },
  })

  if (impacto.bloqueado) {
    await prisma.propostaReconciliacao.update({
      where: { id: proposta.id },
      data: { status: "ABORTADA", motivoAbortoRevalidacao: impacto.motivoBloqueio },
    })
    await auditar(prisma, {
      acao: ACOES_AUDITORIA.PROPOSTA_ABORTADA,
      entidade: "PropostaReconciliacao",
      entidadeId: proposta.id,
      descricao: `Aplicação abortada na análise de impacto prévia: ${impacto.motivoBloqueio}`,
      detalhes: { impacto: impacto.resumo, contagens },
      usuarioId: p.ator.usuarioId,
      correlationId,
    })
    return {
      ok: false,
      propostaId: proposta.id,
      codigo: "IMPACTO_BLOQUEADO",
      mensagem: `Aplicação abortada: ${impacto.motivoBloqueio}`,
      impactoId: impactoPrevio.id,
    }
  }

  // ---------------------------------------------------------- 3. versão ANTES
  const snapAntes = await snapshotAtual(prisma, arvoreId, proposta.processoId)
  const versaoAntes = await criarVersao(prisma, {
    arvoreId,
    processoId: proposta.processoId,
    motivo: `Antes de aplicar a proposta #${proposta.id} (${proposta.tipo})`,
    propostaId: proposta.id,
    correlationId,
    criadoPorId: p.ator.usuarioId,
    snapshot: snapAntes,
  })

  // ------------------------------------------- 4/5. transação + revalidação
  const rodada = await prisma.decisaoRevisaoRegistral.count({ where: { propostaId: proposta.id } })

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const efeitos = await escrever(tx, {
        proposta: {
          id: proposta.id,
          processoId: proposta.processoId,
          tipo: proposta.tipo,
          alvoId: proposta.alvoId,
          campo: proposta.campo as CampoRegistral | null,
          valorProposto: proposta.valorProposto,
          valorAtual: proposta.valorAtual,
          operacao,
        },
        ator: p.ator,
        motivo: p.motivo,
        correlationId,
      })

      // ---- revalidação DENTRO da transação
      const depoisReal = await fotografarEstado(proposta.processoId, arvoreId, tx)

      const rev = revalidar({
        antes,
        depois: depoisReal,
        associacoesDocumentais: efeitos.associacoesDocumentais,
        necessidadesAtendidas: efeitos.necessidadesAtendidas,
        processosTocados: efeitos.processosTocados.length ? efeitos.processosTocados : [proposta.processoId],
        processosAutorizados: processosAfetados.length ? processosAfetados : [proposta.processoId],
        evidenciaContrariaMaisForte: pesoContrarioMaior(
          proposta.evidenciasFavoraveis,
          proposta.evidenciasContrarias,
        ),
        linhaAprovadaPorHumano: linhaAprovada,
      })

      if (!rev.ok) {
        throw new ErroRevalidacao(rev.criticas.map((f) => `${f.verificacao}: ${f.detalhe}`))
      }

      const impactoPosterior = analisarImpacto({
        antes,
        depois: depoisReal,
        contagens: { ...contagens, necessidadesRecalculadas: efeitos.necessidadesAtendidas.length },
        linhaAprovadaPorHumano: linhaAprovada,
      })

      await tx.impactoAplicacaoRegistral.upsert({
        where: { chaveIdempotencia: chaveImpacto({ propostaId: proposta.id, momento: "POSTERIOR" }) },
        update: dadosImpacto(impactoPosterior, "POSTERIOR"),
        create: {
          ...dadosImpacto(impactoPosterior, "POSTERIOR"),
          propostaId: proposta.id,
          momento: "POSTERIOR",
          chaveIdempotencia: chaveImpacto({ propostaId: proposta.id, momento: "POSTERIOR" }),
        },
      })

      const versaoDepois = await criarVersao(tx, {
        arvoreId,
        processoId: proposta.processoId,
        motivo: `Após aplicar a proposta #${proposta.id} (${proposta.tipo})`,
        propostaId: proposta.id,
        correlationId,
        criadoPorId: p.ator.usuarioId,
      })

      await tx.propostaReconciliacao.update({
        where: { id: proposta.id },
        data: {
          status: "APLICADA",
          decididoPorId: p.ator.usuarioId,
          decididoEm: new Date(instante),
          decisaoNota: (p.motivo || "Aplicada automaticamente pelo motor (operação inequívoca).").slice(0, 500),
          aplicadoEm: new Date(instante),
          versaoArvoreAntes: versaoAntes.versao,
          versaoArvoreDepois: versaoDepois.versao,
          motivoAbortoRevalidacao: null,
          necessidadesAfetadas: efeitos.necessidadesAtendidas.map((n) => n.necessidadeId) as unknown as Prisma.InputJsonValue,
        },
      })

      await tx.decisaoRevisaoRegistral.create({
        data: {
          propostaId: proposta.id,
          decisao: "APROVAR",
          motivo: (p.motivo || "Aplicação automática pelo motor").slice(0, 500),
          permissao,
          responsavelId: p.ator.usuarioId,
          correlationId,
          chaveIdempotencia: chaveDecisao({
            propostaId: proposta.id,
            decisao: "APROVAR",
            responsavelId: p.ator.usuarioId,
            rodada,
          }),
        },
      })

      await publicarEvento(tx, {
        tipo: EVENTOS.PROPOSTA_APLICADA,
        aggregateType: "PropostaReconciliacao",
        aggregateId: proposta.id,
        payload: {
          propostaId: proposta.id,
          processoId: proposta.processoId,
          arvoreId,
          tipo: proposta.tipo,
          versaoDepois: versaoDepois.versao,
        },
        correlationId,
        chaveIdempotencia: `mrg:evt:aplicada:${proposta.id}:${versaoDepois.versao}`,
      })

      return { versaoDepois: versaoDepois.versao, falhas: rev.falhas.map((f) => `${f.verificacao}: ${f.detalhe}`) }
    })

    await auditar(prisma, {
      acao: ACOES_AUDITORIA.PROPOSTA_APLICADA,
      entidade: "PropostaReconciliacao",
      entidadeId: proposta.id,
      descricao: `Proposta ${proposta.tipo} aplicada (versão ${versaoAntes.versao} → ${resultado.versaoDepois}).`,
      detalhes: {
        tipo: proposta.tipo,
        criticidade: proposta.criticidade,
        motivo: p.motivo,
        impacto: impacto.resumo,
        avisosRevalidacao: resultado.falhas,
        versaoMotor: VERSAO_MOTOR,
      },
      usuarioId: p.ator.usuarioId,
      correlationId,
    })

    return {
      ok: true,
      propostaId: proposta.id,
      mensagem: "Proposta aplicada, revalidada e versionada.",
      versaoAntes: versaoAntes.versao,
      versaoDepois: resultado.versaoDepois,
      impactoId: impactoPrevio.id,
      falhasRevalidacao: resultado.falhas,
    }
  } catch (e) {
    const falhas = e instanceof ErroRevalidacao ? e.falhas : [e instanceof Error ? e.message : String(e)]
    // A transação já sofreu ROLLBACK: nada foi escrito. Registrar o aborto é
    // escrita nova, fora da transação revertida.
    await prisma.propostaReconciliacao
      .update({
        where: { id: proposta.id },
        data: { status: "ABORTADA", motivoAbortoRevalidacao: falhas.join(" · ").slice(0, 4000) },
      })
      .catch((erroMarcacao) =>
        // Não engolir: se nem marcar ABORTADA foi possível, isso tem de aparecer.
        logRegistral("error", "falha_ao_marcar_proposta_abortada", {
          propostaId: proposta.id,
          erro: erroMarcacao instanceof Error ? erroMarcacao.message : String(erroMarcacao),
        }),
      )
    await auditar(prisma, {
      acao: ACOES_AUDITORIA.PROPOSTA_ABORTADA,
      entidade: "PropostaReconciliacao",
      entidadeId: proposta.id,
      descricao: "Aplicação revertida automaticamente: revalidação pós-aplicação falhou.",
      detalhes: { falhas },
      usuarioId: p.ator.usuarioId,
      correlationId,
    })
    logRegistral("error", "aplicacao_revertida", { propostaId: proposta.id, falhas })
    return {
      ok: false,
      propostaId: proposta.id,
      codigo: e instanceof ErroRevalidacao ? "REVALIDACAO_FALHOU" : "OPERACAO_NAO_SUPORTADA",
      mensagem:
        e instanceof ErroRevalidacao
          ? "Alteração revertida automaticamente: a revalidação pós-aplicação reprovou."
          : `Falha ao aplicar: ${falhas.join(" · ")}`,
      falhasRevalidacao: falhas,
      versaoAntes: versaoAntes.versao,
    }
  }
}

class ErroRevalidacao extends Error {
  readonly falhas: string[]
  constructor(falhas: string[]) {
    super(`revalidação falhou: ${falhas.join(" · ")}`)
    this.name = "ErroRevalidacao"
    this.falhas = falhas
  }
}

// ============================================================================
// escrita por tipo de proposta
// ============================================================================

interface EfeitosEscrita {
  associacoesDocumentais: Array<{ documentoId: number; pessoaId: number; pessoaEsperadaId: number | null }>
  necessidadesAtendidas: Array<{ necessidadeId: number; temDocumentoVinculado: boolean }>
  processosTocados: number[]
}

async function escrever(
  tx: Prisma.TransactionClient,
  p: {
    proposta: {
      id: number
      processoId: number
      tipo: string
      alvoId: number | null
      campo: CampoRegistral | null
      valorProposto: string | null
      valorAtual: string | null
      operacao: Record<string, unknown>
    }
    ator: AtorAplicacao
    motivo: string
    correlationId: string
  },
): Promise<EfeitosEscrita> {
  const efeitos: EfeitosEscrita = {
    associacoesDocumentais: [],
    necessidadesAtendidas: [],
    processosTocados: [p.proposta.processoId],
  }
  const { tipo, alvoId, campo, valorProposto, operacao } = p.proposta

  switch (tipo) {
    // ---- CONFIRMAR: não muda dado. Eleva o fato a confirmado por evidência.
    case "CONFIRMAR_DADO": {
      if (alvoId == null || campo == null) throw new Error("Proposta de confirmação sem alvo ou campo.")
      await promoverFato(tx, alvoId, campo, "CONFIRMADO")
      break
    }

    // ---- COMPLETAR: preenche campo VAZIO. Nunca sobrescreve.
    case "COMPLETAR_DADO": {
      if (alvoId == null || campo == null || valorProposto == null) {
        throw new Error("Proposta de complemento incompleta.")
      }
      const escreveu = await escreverCampoPessoa(tx, alvoId, campo, valorProposto, operacao, false)
      if (!escreveu) throw new Error("O campo já tem valor: complementar exigiria sobrescrever.")
      await promoverFato(tx, alvoId, campo, "CONFIRMADO")
      break
    }

    // ---- CORRIGIR: substitui valor existente (só chega aqui com aprovação).
    case "CORRIGIR_DADO": {
      if (alvoId == null || campo == null || valorProposto == null) {
        throw new Error("Proposta de correção incompleta.")
      }
      await escreverCampoPessoa(tx, alvoId, campo, valorProposto, operacao, true)
      await supersederFato(tx, alvoId, campo, valorProposto, p.ator.usuarioId, p.motivo)
      break
    }

    // ---- ALIAS: acrescenta forma de nome pelo serviço oficial (MDM-5).
    case "ADICIONAR_NOME_ALTERNATIVO": {
      if (alvoId == null || valorProposto == null) throw new Error("Proposta de alias incompleta.")
      const partes = valorProposto.trim().split(/\s+/)
      const nome = partes[0]
      const sobrenome = partes.slice(1).join(" ") || null
      const r = await adicionarNome(tx, {
        pessoaId: alvoId,
        nome: nome.slice(0, 50),
        sobrenome: sobrenome ? sobrenome.slice(0, 40) : null,
        tipo: (typeof operacao.tipoNome === "string" ? operacao.tipoNome : "GRAFIA_DOCUMENTO") as "GRAFIA_DOCUMENTO",
        principal: false,
        afirmacao: {
          origem: "DOCUMENTO",
          confianca: "PROVAVEL",
          responsavelId: p.ator.usuarioId,
          afirmadoEm: new Date(),
          justificativa: `Grafia registrada a partir do documento #${operacao.documentoId ?? "?"} pelo motor registral.`,
          evidenciaNecessidadeId: null,
        },
      })
      if (!r.ok) throw new Error(`Serviço de nomes recusou: ${r.mensagem}`)
      break
    }

    // ---- VINCULAR: a ocorrência do documento passa a apontar para a pessoa.
    case "VINCULAR_PESSOA_EXISTENTE": {
      if (alvoId == null) throw new Error("Proposta de vínculo sem pessoa alvo.")
      const documentoId = typeof operacao.documentoId === "number" ? operacao.documentoId : null
      const papel = typeof operacao.papel === "string" ? operacao.papel : null
      if (documentoId == null || papel == null) throw new Error("Proposta de vínculo sem documento/papel.")

      const atualizadas = await tx.ocorrenciaDocumental.updateMany({
        where: { documentoId, papel: papel as Prisma.EnumPapelOcorrenciaFilter["equals"] },
        data: { pessoaResolvidaId: alvoId, resolvidaAutomaticamente: false },
      })
      if (atualizadas.count === 0) throw new Error("Nenhuma ocorrência documental corresponde ao vínculo proposto.")

      // A evidência passa a apontar para a pessoa vinculada — é o que dá
      // rastreabilidade ao vínculo.
      await tx.evidenciaRegistral.updateMany({
        where: { documentoId, pessoaId: null },
        data: { pessoaId: alvoId },
      })
      efeitos.associacoesDocumentais.push({ documentoId, pessoaId: alvoId, pessoaEsperadaId: alvoId })
      break
    }

    // ---- CRIAR PESSOA: nasce com triagem já feita (a proposta É a triagem).
    case "CRIAR_PESSOA": {
      const nomeBruto = typeof operacao.nomeBruto === "string" ? operacao.nomeBruto : valorProposto
      if (!nomeBruto) throw new Error("Proposta de criação sem nome.")
      const arvoreId = await arvoreDoProcesso(tx, p.proposta.processoId)
      if (arvoreId == null) throw new Error("Processo sem árvore: não há onde criar a pessoa.")

      const partes = nomeBruto.trim().split(/\s+/)
      const atributos = (operacao.atributos ?? {}) as Record<string, unknown>
      const criada = await tx.pessoa.create({
        data: {
          nome: partes[0].slice(0, 50),
          sobrenome: partes.slice(1).join(" ").slice(0, 40) || null,
          sexo: typeof operacao.sexoInferido === "string" ? operacao.sexoInferido : null,
          data_nasc: dataOuNulo(atributos.dataNascimento),
          data_obito: dataOuNulo(atributos.dataObito),
          local_nasc: textoOuNulo(atributos.localNascimento, 100),
          pais_nasc: textoOuNulo(atributos.paisNascimento, 50),
          profissao: textoOuNulo(atributos.profissao, 100),
          arvoreId,
          vivo: atributos.dataObito == null,
        },
        select: { id: true },
      })

      const documentoId = typeof operacao.documentoId === "number" ? operacao.documentoId : null
      const papel = typeof operacao.papel === "string" ? operacao.papel : null
      if (documentoId != null && papel != null) {
        await tx.ocorrenciaDocumental.updateMany({
          where: { documentoId, papel: papel as Prisma.EnumPapelOcorrenciaFilter["equals"] },
          data: { pessoaResolvidaId: criada.id, resolvidaAutomaticamente: false },
        })
        efeitos.associacoesDocumentais.push({ documentoId, pessoaId: criada.id, pessoaEsperadaId: criada.id })
      }

      // Registra a decisão de identidade na trilha oficial do Cadastro Mestre
      // (MDM-3) — sem isso, uma pessoa criada pelo motor não tem rastro de triagem.
      await tx.decisaoDeduplicacao.create({
        data: {
          chaveDedup: `mrg:proposta:${p.proposta.id}`,
          candidatosAvaliados: (operacao.candidatos ?? []) as Prisma.InputJsonValue,
          nivelTriagem: "CONFIRMACAO",
          decisao: "CRIOU_NOVA",
          pessoaResultanteId: criada.id,
          justificativa: p.motivo.slice(0, 500),
          decididoPorId: p.ator.usuarioId,
          chaveIdempotencia: `mrg:dedup:proposta:${p.proposta.id}`,
        },
      })
      break
    }

    // ---- RELAÇÃO: filiação. Estrutura da árvore continua em Pessoa.paiId/maeId.
    case "CRIAR_RELACIONAMENTO":
    case "CORRIGIR_RELACIONAMENTO": {
      const filhoId = numeroOuNulo(operacao.filhoId) ?? alvoId
      const genitorId = numeroOuNulo(operacao.genitorId)
      const papel = operacao.papel === "MAE" ? "MAE" : "PAI"
      if (filhoId == null || genitorId == null) throw new Error("Proposta de relação sem filho/genitor.")
      if (filhoId === genitorId) throw new Error("Filho e genitor são a mesma pessoa.")
      await tx.pessoa.update({
        where: { id: filhoId },
        data: papel === "PAI" ? { paiId: genitorId } : { maeId: genitorId },
      })
      efeitos.processosTocados = await processosQueDependemDe(tx, [filhoId, genitorId])
      break
    }

    case "REMOVER_RELACIONAMENTO": {
      const filhoId = numeroOuNulo(operacao.filhoId) ?? alvoId
      const papel = operacao.papel === "MAE" ? "MAE" : "PAI"
      if (filhoId == null) throw new Error("Proposta de remoção sem filho.")
      await tx.pessoa.update({
        where: { id: filhoId },
        data: papel === "PAI" ? { paiId: null } : { maeId: null },
      })
      efeitos.processosTocados = await processosQueDependemDe(tx, [filhoId])
      break
    }

    // ---- DOCUMENTAL: as transições são do SISTEMA DOCUMENTAL, pelos serviços dele.
    case "SATISFAZER_NECESSIDADE": {
      const necessidadeId = numeroOuNulo(operacao.necessidadeId) ?? alvoId
      if (necessidadeId == null) throw new Error("Proposta sem necessidade alvo.")
      const nec = await tx.necessidadeDocumental.findUnique({
        where: { id: necessidadeId },
        select: { id: true, processoId: true, _count: { select: { documentos: true } } },
      })
      if (!nec) throw new Error("Necessidade não encontrada.")
      await atenderNecessidade(necessidadeId, tx)
      efeitos.necessidadesAtendidas.push({
        necessidadeId,
        temDocumentoVinculado: nec._count.documentos > 0,
      })
      efeitos.processosTocados = [nec.processoId]
      break
    }

    case "REABRIR_NECESSIDADE": {
      const necessidadeId = numeroOuNulo(operacao.necessidadeId) ?? alvoId
      if (necessidadeId == null) throw new Error("Proposta sem necessidade alvo.")
      await reabrir(necessidadeId, tx)
      break
    }

    case "CRIAR_NECESSIDADE": {
      const itemCatalogoId = numeroOuNulo(operacao.itemCatalogoId)
      const pessoaId = numeroOuNulo(operacao.pessoaId) ?? alvoId
      if (itemCatalogoId == null) throw new Error("Proposta sem Documento Mestre (itemCatalogoId).")
      await garantirNecessidade(
        {
          processoId: p.proposta.processoId,
          itemCatalogoId,
          pessoaId,
          uniaoId: numeroOuNulo(operacao.uniaoId),
          origem: "ARVORE",
          obrigatoriedade: operacao.obrigatoria === false ? "OPCIONAL" : "OBRIGATORIA",
          motivoAplicabilidade: p.motivo.slice(0, 1000),
        },
        tx,
      )
      break
    }

    // ---- DIVERGÊNCIA: marca o fato como contestado. Não altera o documento.
    case "MARCAR_DOCUMENTO_DIVERGENTE": {
      if (alvoId == null || campo == null) throw new Error("Proposta de divergência sem alvo/campo.")
      await tx.fatoRegistral.updateMany({
        where: { pessoaId: alvoId, campo, ativo: true },
        data: { estado: "DIVERGENTE", confianca: "CONTESTADO" },
      })
      break
    }

    // ---- BLOQUEADAS estruturais: exigem serviço dedicado, ainda não existente.
    //      Recusar é o comportamento correto: aplicar "quase certo" numa fusão de
    //      identidade é o único erro deste sistema que não tem volta.
    case "MESCLAR_PESSOAS":
    case "SEPARAR_PESSOAS":
      throw new Error(
        `${tipo} exige serviço de fusão/separação de identidade com reversão garantida, que não existe no Discovery. A proposta permanece registrada com toda a análise de impacto, e nada foi alterado.`,
      )

    case "SOLICITAR_RETIFICACAO":
      throw new Error(
        "SOLICITAR_RETIFICACAO é uma ação do fluxo documental de retificação (RetificacaoPacote), não do motor genealógico. A proposta fica registrada como pendência para o Sistema Documental.",
      )

    default:
      throw new Error(`Tipo de proposta não suportado: ${tipo}`)
  }

  return efeitos
}

// ============================================================================
// helpers de escrita
// ============================================================================

async function arvoreDoProcesso(tx: Prisma.TransactionClient, processoId: number): Promise<number | null> {
  const p = await tx.processo.findUnique({ where: { id: processoId }, select: { arvoreId: true } })
  return p?.arvoreId ?? null
}

const CAMPO_PARA_COLUNA: Partial<Record<CampoRegistral, keyof Prisma.PessoaUpdateInput>> = {
  DATA_NASCIMENTO: "data_nasc",
  DATA_OBITO: "data_obito",
  LOCAL_NASCIMENTO: "local_nasc",
  PAIS_NASCIMENTO: "pais_nasc",
  DATA_BATISMO: "data_batismo",
  LOCAL_BATISMO: "local_batismo",
  PROFISSAO: "profissao",
  NACIONALIDADE: "nacionalidade",
  SEXO: "sexo",
  NATURALIZACAO: "data_naturalizacao",
  DATA_EMIGRACAO: "data_emigracao",
}

const LIMITES: Partial<Record<CampoRegistral, number>> = {
  LOCAL_NASCIMENTO: 100,
  PAIS_NASCIMENTO: 50,
  LOCAL_BATISMO: 100,
  PROFISSAO: 100,
  NACIONALIDADE: 50,
  SEXO: 10,
}

/**
 * Escreve o campo no cadastro da Pessoa. `permitirSobrescrever=false` recusa
 * quando já existe valor — é o que garante que "completar" nunca substitui.
 * NOME_REGISTRAL é escrito pelo serviço oficial de nomes, não aqui.
 */
async function escreverCampoPessoa(
  tx: Prisma.TransactionClient,
  pessoaId: number,
  campo: CampoRegistral,
  valor: string,
  operacao: Record<string, unknown>,
  permitirSobrescrever: boolean,
): Promise<boolean> {
  if (campo === "NOME_REGISTRAL") {
    const partes = valor.trim().split(/\s+/)
    const atual = await tx.pessoa.findUnique({ where: { id: pessoaId }, select: { nome: true, sobrenome: true } })
    if (!atual) throw new Error("Pessoa não encontrada.")
    const temValor = !!atual.nome?.trim()
    if (temValor && !permitirSobrescrever) return false
    await tx.pessoa.update({
      where: { id: pessoaId },
      data: { nome: partes[0].slice(0, 50), sobrenome: partes.slice(1).join(" ").slice(0, 40) || null },
    })
    return true
  }

  const coluna = CAMPO_PARA_COLUNA[campo]
  if (!coluna) {
    // Campo que não tem coluna própria em Pessoa (ex.: REFERENCIA_REGISTRAL,
    // IDADE_DECLARADA). O valor vive no FatoRegistral, que é o dono do dado
    // registral — não se inventa coluna nem se escreve em campo alheio.
    return true
  }

  const atual = await tx.pessoa.findUnique({ where: { id: pessoaId } })
  if (!atual) throw new Error("Pessoa não encontrada.")
  const atualValor = (atual as unknown as Record<string, unknown>)[coluna as string]
  const temValor = atualValor != null && String(atualValor) !== ""
  if (temValor && !permitirSobrescrever) return false

  const ehData = coluna === "data_nasc" || coluna === "data_obito" || coluna === "data_batismo" || coluna === "data_naturalizacao" || coluna === "data_emigracao"
  const limite = LIMITES[campo] ?? 200
  const data: Prisma.PessoaUpdateInput = ehData
    ? ({ [coluna]: new Date(`${valor.slice(0, 10)}T12:00:00.000Z`) } as Prisma.PessoaUpdateInput)
    : ({ [coluna]: valor.slice(0, limite) } as Prisma.PessoaUpdateInput)

  await tx.pessoa.update({ where: { id: pessoaId }, data })
  void operacao
  return true
}

async function promoverFato(
  tx: Prisma.TransactionClient,
  pessoaId: number,
  campo: CampoRegistral,
  estado: "CONFIRMADO" | "CONFIRMADO_MULTIPLAS_EVIDENCIAS",
): Promise<void> {
  const fato = await tx.fatoRegistral.findFirst({
    where: { pessoaId, campo, ativo: true },
    select: { id: true, evidenciasFavoraveis: true },
  })
  if (!fato) return
  const alvo = fato.evidenciasFavoraveis >= 2 ? "CONFIRMADO_MULTIPLAS_EVIDENCIAS" : estado
  await tx.fatoRegistral.update({
    where: { id: fato.id },
    data: { estado: alvo, confianca: "CONFIRMADO" },
  })
}

/**
 * Correção de valor = NOVA VERSÃO do fato. A anterior é desativada e apontada
 * pela nova (append-only). Nenhum histórico é apagado.
 */
async function supersederFato(
  tx: Prisma.TransactionClient,
  pessoaId: number,
  campo: CampoRegistral,
  valorNovo: string,
  responsavelId: number | null,
  motivo: string,
): Promise<void> {
  const antigo = await tx.fatoRegistral.findFirst({
    where: { pessoaId, campo, ativo: true },
    orderBy: { versao: "desc" },
    select: { id: true, versao: true, valorBruto: true },
  })
  const versao = (antigo?.versao ?? 0) + 1
  const chave = `mrg:fato:p${pessoaId}:${campo}:v${versao}`

  const novo = await tx.fatoRegistral.create({
    data: {
      pessoaId,
      campo,
      valorBruto: antigo?.valorBruto ?? null,
      valorNormalizado: valorNovo.slice(0, 400),
      valorData: /^\d{4}-\d{2}-\d{2}/.test(valorNovo) ? new Date(`${valorNovo.slice(0, 10)}T12:00:00.000Z`) : null,
      estado: "CONFIRMADO",
      confianca: "CONFIRMADO",
      origem: "OPERADOR",
      responsavelId,
      justificativa: motivo.slice(0, 500),
      regraAplicada: "MRG-CORRECAO-APROVADA",
      versao,
      ativo: true,
      chaveIdempotencia: chave.slice(0, 200),
    },
    select: { id: true },
  })

  if (antigo) {
    await tx.fatoRegistral.update({
      where: { id: antigo.id },
      data: { ativo: false, estado: "SUBSTITUIDO_COM_HISTORICO", supersedidoPorId: novo.id },
    })
  }
}

function dataOuNulo(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null
  return new Date(`${v.slice(0, 10)}T12:00:00.000Z`)
}

function textoOuNulo(v: unknown, limite: number): string | null {
  if (typeof v !== "string" || !v.trim()) return null
  return v.trim().slice(0, limite)
}

function numeroOuNulo(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function vinculosAlteradosPor(tipo: string): number {
  if (tipo === "CRIAR_RELACIONAMENTO" || tipo === "REMOVER_RELACIONAMENTO") return 1
  if (tipo === "CORRIGIR_RELACIONAMENTO") return 2
  if (tipo === "MESCLAR_PESSOAS") return 3
  return 0
}

function pesoContrarioMaior(favoraveis: Prisma.JsonValue | null, contrarias: Prisma.JsonValue | null): boolean {
  const soma = (v: Prisma.JsonValue | null) =>
    Array.isArray(v)
      ? v.reduce((s: number, x) => s + (x && typeof x === "object" && !Array.isArray(x) ? Number((x as Prisma.JsonObject).peso ?? 1) : 1), 0)
      : 0
  return soma(contrarias) > soma(favoraveis)
}

function dadosImpacto(
  i: ReturnType<typeof analisarImpacto>,
  momento: "PREVIO" | "POSTERIOR",
): Prisma.ImpactoAplicacaoRegistralUncheckedUpdateInput & Prisma.ImpactoAplicacaoRegistralUncheckedCreateInput {
  return {
    momento,
    pessoasAfetadas: i.contagens.pessoasAfetadas,
    arvoresAfetadas: i.contagens.arvoresAfetadas,
    requerentesAfetados: i.contagens.requerentesAfetados,
    processosAfetados: i.contagens.processosAfetados,
    vinculosAlterados: i.contagens.vinculosAlterados,
    documentosRelacionados: i.contagens.documentosRelacionados,
    necessidadesRecalculadas: i.contagens.necessidadesRecalculadas,
    inconsistenciasCriadas: i.inconsistenciasCriadas.length,
    inconsistenciasResolvidas: i.inconsistenciasResolvidas.length,
    linhaAntes: i.linhaAntes as unknown as Prisma.InputJsonValue,
    linhaDepois: i.linhaDepois as unknown as Prisma.InputJsonValue,
    elegibilidadeAntes: i.elegibilidadeAntes,
    elegibilidadeDepois: i.elegibilidadeDepois,
    riscoDuplicidade: i.riscoDuplicidade,
    riscoDocumental: i.riscoDocumental,
    riscoOperacional: i.riscoOperacional,
    bloqueado: i.bloqueado,
    motivoBloqueio: i.motivoBloqueio,
    detalhes: {
      resumo: i.resumo,
      criadas: i.inconsistenciasCriadas.map((x) => ({ codigo: x.codigo, severidade: x.severidade })),
      resolvidas: i.inconsistenciasResolvidas.map((x) => ({ codigo: x.codigo, severidade: x.severidade })),
    } as unknown as Prisma.InputJsonValue,
  } as Prisma.ImpactoAplicacaoRegistralUncheckedUpdateInput & Prisma.ImpactoAplicacaoRegistralUncheckedCreateInput
}

// ============================================================================
// estado, fotografia e SIMULAÇÃO (antes / depois)
// ============================================================================

/** Lê o estado bruto (pessoas, uniões, fatos, comprovação) — insumo dos motores puros. */
async function carregarEstadoBruto(
  processoId: number,
  arvoreId: number,
  tx?: Prisma.TransactionClient,
): Promise<EstadoGenealogico> {
  const db = tx ?? prisma
  const ctx = await carregarContexto(db, processoId)
  const pessoas = await carregarPessoas(db, arvoreId)
  const pessoaIds = pessoas.map((x) => x.id)
  const unioes = await carregarUnioes(db, pessoaIds)
  const fatos = await carregarFatos(db, pessoaIds, unioes.map((u) => u.id))
  const comprovacao = await carregarComprovacao(db, processoId, pessoaIds)

  return {
    integridade: { pessoas, unioes, requerenteIds: ctx?.requerenteIds ?? [], fatos },
    elegibilidade: {
      pessoas,
      unioes,
      paisAlvo: ctx?.paisAlvo ?? null,
      requerenteId: ctx?.requerenteIds[0] ?? null,
      raizId: ctx?.raizId ?? null,
      comprovacaoPorPessoa: comprovacao,
    },
  }
}

async function fotografarEstado(
  processoId: number,
  arvoreId: number,
  tx?: Prisma.TransactionClient,
): Promise<FotoEstado> {
  return fotografar(await carregarEstadoBruto(processoId, arvoreId, tx))
}

/**
 * SIMULAÇÃO do estado depois — usada na análise de impacto PRÉVIA, antes de
 * qualquer escrita. Aplica o efeito da proposta sobre uma CÓPIA do estado e
 * refotografa com os mesmos motores puros que a revalidação usa.
 *
 * Só é previsão: a palavra final é a revalidação DENTRO da transação, sobre o
 * estado realmente escrito. A simulação existe para abortar antes de escrever.
 */
export function simularEstado(
  estado: EstadoGenealogico,
  op: {
    tipo: string
    alvoId: number | null
    campo: CampoRegistral | null
    valorProposto: string | null
    operacao: Record<string, unknown>
  },
): EstadoGenealogico {
  // Cópia rasa por elemento: os motores puros só leem, mas a simulação altera
  // campos de pessoas/uniões e não pode tocar no estado real.
  const pessoas = estado.integridade.pessoas.map((p) => ({ ...p }))
  const unioes = estado.integridade.unioes.map((u) => ({ ...u }))
  const fatos = (estado.integridade.fatos ?? []).map((f) => ({ ...f }))
  const comprovacao = new Map(
    [...estado.elegibilidade.comprovacaoPorPessoa].map(([k, v]) => [k, new Set(v)] as const),
  )
  const porId = new Map(pessoas.map((p) => [p.id, p]))

  const alvoId = op.alvoId
  const oper = op.operacao
  const numero = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  switch (op.tipo) {
    case "COMPLETAR_DADO":
    case "CORRIGIR_DADO": {
      if (alvoId == null || op.campo == null || op.valorProposto == null) break
      const p = porId.get(alvoId)
      if (!p) break
      aplicarCampoSimulado(p, op.campo, op.valorProposto)
      // O campo passa a estar comprovado (é o efeito da aprovação).
      const s = comprovacao.get(alvoId) ?? new Set<CampoRegistral>()
      s.add(op.campo)
      comprovacao.set(alvoId, s)
      break
    }

    case "CONFIRMAR_DADO": {
      if (alvoId == null || op.campo == null) break
      const s = comprovacao.get(alvoId) ?? new Set<CampoRegistral>()
      s.add(op.campo)
      comprovacao.set(alvoId, s)
      const f = fatos.find((x) => x.pessoaId === alvoId && x.campo === op.campo)
      if (f) f.estado = "CONFIRMADO"
      break
    }

    case "CRIAR_RELACIONAMENTO":
    case "CORRIGIR_RELACIONAMENTO": {
      const filhoId = numero(oper.filhoId) ?? alvoId
      const genitorId = numero(oper.genitorId)
      if (filhoId == null || genitorId == null) break
      const filho = porId.get(filhoId)
      if (!filho) break
      if (oper.papel === "MAE") filho.maeId = genitorId
      else filho.paiId = genitorId
      break
    }

    case "REMOVER_RELACIONAMENTO": {
      const filhoId = numero(oper.filhoId) ?? alvoId
      if (filhoId == null) break
      const filho = porId.get(filhoId)
      if (!filho) break
      if (oper.papel === "MAE") filho.maeId = null
      else filho.paiId = null
      break
    }

    case "CRIAR_PESSOA": {
      const nomeBruto = typeof oper.nomeBruto === "string" ? oper.nomeBruto : op.valorProposto
      if (!nomeBruto) break
      const partes = nomeBruto.trim().split(/\s+/)
      const atributos = (oper.atributos ?? {}) as Record<string, unknown>
      const novoId = -(pessoas.length + 1) // id negativo: não colide com id real
      pessoas.push({
        id: novoId,
        nome: partes[0],
        sobrenome: partes.slice(1).join(" ") || null,
        sexo: typeof oper.sexoInferido === "string" ? oper.sexoInferido : null,
        data_nasc: typeof atributos.dataNascimento === "string" ? atributos.dataNascimento : null,
        data_obito: typeof atributos.dataObito === "string" ? atributos.dataObito : null,
        local_nasc: typeof atributos.localNascimento === "string" ? atributos.localNascimento : null,
        pais_nasc: typeof atributos.paisNascimento === "string" ? atributos.paisNascimento : null,
        paiId: null,
        maeId: null,
        linhaReta: true,
      })
      break
    }

    case "SATISFAZER_NECESSIDADE": {
      // Necessidade atendida comprova os campos daquele Documento Mestre. Sem o
      // código do item aqui, o efeito comprovável é o campo indicado na proposta.
      if (alvoId != null && op.campo != null) {
        const s = comprovacao.get(alvoId) ?? new Set<CampoRegistral>()
        s.add(op.campo)
        comprovacao.set(alvoId, s)
      }
      break
    }

    case "MARCAR_DOCUMENTO_DIVERGENTE": {
      if (alvoId == null || op.campo == null) break
      const f = fatos.find((x) => x.pessoaId === alvoId && x.campo === op.campo)
      if (f) f.estado = "DIVERGENTE"
      const s = comprovacao.get(alvoId)
      if (s) s.delete(op.campo)
      break
    }

    default:
      // Tipos que não alteram estrutura nem comprovação (alias, vínculo de
      // ocorrência documental, criação de necessidade): o estado genealógico
      // simulado é igual ao atual, e é isso que a análise deve concluir.
      break
  }

  return {
    integridade: { pessoas, unioes, requerenteIds: estado.integridade.requerenteIds, fatos },
    elegibilidade: { ...estado.elegibilidade, pessoas, unioes, comprovacaoPorPessoa: comprovacao },
  }
}

/** Escreve o campo simulado na cópia da pessoa (espelha CAMPO_PARA_COLUNA). */
function aplicarCampoSimulado(
  p: import("@/src/lib/genealogia/motor/tipos").PessoaEntrada,
  campo: CampoRegistral,
  valor: string,
): void {
  switch (campo) {
    case "NOME_REGISTRAL": {
      const partes = valor.trim().split(/\s+/)
      p.nome = partes[0]
      p.sobrenome = partes.slice(1).join(" ") || null
      break
    }
    case "DATA_NASCIMENTO":
      p.data_nasc = valor
      break
    case "DATA_OBITO":
      p.data_obito = valor
      break
    case "LOCAL_NASCIMENTO":
      p.local_nasc = valor
      break
    case "PAIS_NASCIMENTO":
      p.pais_nasc = valor
      break
    case "DATA_BATISMO":
      p.data_batismo = valor
      break
    case "LOCAL_BATISMO":
      p.local_batismo = valor
      break
    case "PROFISSAO":
      p.profissao = valor
      break
    case "NACIONALIDADE":
      p.nacionalidade = valor
      break
    case "SEXO":
      p.sexo = valor
      break
    case "NATURALIZACAO":
      p.data_naturalizacao = valor
      break
    case "DATA_EMIGRACAO":
      p.data_emigracao = valor
      break
    default:
      // Campo sem coluna própria em Pessoa: vive no FatoRegistral e não altera a
      // estrutura simulada.
      break
  }
}

/** Recalcula e devolve os nomes das pessoas afetadas — usado nas mensagens. */
export async function nomesAfetados(pessoaIds: number[]): Promise<Map<number, string>> {
  return carregarNomes(prisma, pessoaIds)
}
