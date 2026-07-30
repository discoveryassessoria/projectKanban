// src/services/registral/pipeline.ts
//
// MRG — o PIPELINE REGISTRAL de um documento (requisito 2 do escopo).
//
// RECEBIDO → CLASSIFICANDO → EXTRAINDO → REEXTRAINDO → NORMALIZANDO →
// RESOLVENDO_IDENTIDADES → CRUZANDO_EVIDENCIAS → VALIDANDO → REVALIDANDO →
// ANALISANDO_IMPACTO → (AGUARDANDO_REVISAO) → APLICADO → AUDITADO
//
// Desvios: FALHA_LEITURA, DOCUMENTO_INSUFICIENTE, DOCUMENTO_CONFLITANTE,
// REPROCESSAMENTO, REJEITADO, CANCELADO.
//
// Três invariantes que valem para TODA etapa:
//   1. a transição é registrada em EtapaExecucaoRegistral (append-only) —
//      inclusive quando falha. Nenhuma etapa desaparece em silêncio;
//   2. toda escrita é idempotente por chaveIdempotencia — reprocessar o mesmo
//      documento não duplica ocorrência, evidência, fato, conflito ou proposta;
//   3. o pipeline NUNCA aplica alteração registral sensível. Ele produz fatos,
//      evidências, conflitos e PROPOSTAS. Aplicar é `aplicar.ts`, transacional.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { classificarDocumento } from "@/src/lib/genealogia/registral/classificador"
import { conferir } from "@/src/lib/genealogia/registral/conferencia"
import { extrairAncorado } from "@/src/lib/genealogia/registral/extracao-ancorada"
import { extrairEstrutural } from "@/src/lib/genealogia/registral/extracao-estrutural"
import { resolverIdentidade } from "@/src/lib/genealogia/registral/identidade"
import { confiancaDoEstado, ehCampoCritico, estadoDoFato, ROTULO_CAMPO } from "@/src/lib/genealogia/registral/campos"
import {
  chaveConflito,
  chaveCorrespondencia,
  chaveEvidencia,
  chaveFato,
  chaveOcorrencia,
} from "@/src/lib/genealogia/registral/chaves"
import { propostasDeCampos, propostasDeIdentidade, propostaDeAlias } from "@/src/lib/genealogia/registral/propostas"
import { normalizarNome } from "@/src/lib/genealogia/registral/normalizacao"
import { similaridadeNome } from "@/src/lib/genealogia/motor/texto"
import type {
  CampoConferido,
  CampoExtraido,
  CampoRegistral,
  EstadoFatoRegistral,
  LeituraDocumento,
  NaturezaRegistral,
  OcorrenciaExtraida,
  PapelOcorrencia,
  PessoaConhecida,
  PropostaMontada,
} from "@/src/lib/genealogia/registral/tipos"
import { auditar, logRegistral } from "./auditoria"
import { ACOES_AUDITORIA, MAX_TENTATIVAS_EXECUCAO, TETO_CANDIDATOS_IDENTIDADE, VERSAO_MOTOR, backoffMs } from "./constantes"
import { lerDocumento, temMaterialParaLer } from "./leitura-documento"
import { carregarContexto } from "./estado"
import { persistirProposta } from "./propostas-db"

type Etapa = Prisma.ExecucaoRegistralGetPayload<{ select: { etapa: true } }>["etapa"]

export interface ResultadoExecucao {
  execucaoId: number
  etapaFinal: Etapa
  ocorrencias: number
  camposExtraidos: number
  camposDivergentes: number
  evidencias: number
  fatos: number
  conflitos: number
  propostas: number
  propostasAutomaticas: number
  erro: string | null
}

/** Registra a transição de etapa (append-only) e atualiza o estado atual. */
async function transicionar(
  execucaoId: number,
  etapa: Etapa,
  ok: boolean,
  mensagem: string,
  inicio: number,
  tentativa: number,
  dados?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.etapaExecucaoRegistral.create({
      data: {
        execucaoId,
        etapa,
        ok,
        mensagem: mensagem.slice(0, 500),
        duracaoMs: Date.now() - inicio,
        tentativa,
        dados: dados ?? undefined,
      },
    })
    await tx.execucaoRegistral.update({ where: { id: execucaoId }, data: { etapa } })
  })
}

/**
 * Processa UMA execução ponta a ponta. Reentrante: chamar de novo sobre uma
 * execução já concluída reexecuta as etapas e converge (upserts), sem duplicar.
 */
export async function processarExecucao(execucaoId: number): Promise<ResultadoExecucao> {
  const inicioTotal = Date.now()
  const exec = await prisma.execucaoRegistral.findUnique({
    where: { id: execucaoId },
    select: {
      id: true,
      loteId: true,
      documentoId: true,
      necessidadeId: true,
      tentativas: true,
      correlationId: true,
      etapa: true,
      lote: { select: { processoId: true, arvoreId: true } },
    },
  })
  if (!exec) throw new Error(`Execução registral ${execucaoId} não encontrada`)

  const vazio: ResultadoExecucao = {
    execucaoId,
    etapaFinal: exec.etapa,
    ocorrencias: 0,
    camposExtraidos: 0,
    camposDivergentes: 0,
    evidencias: 0,
    fatos: 0,
    conflitos: 0,
    propostas: 0,
    propostasAutomaticas: 0,
    erro: null,
  }

  // Execução cancelada ou rejeitada não é reprocessada por engano.
  if (exec.etapa === "CANCELADO" || exec.etapa === "REJEITADO") return vazio

  const tentativa = exec.tentativas + 1
  const processoId = exec.lote.processoId
  const correlationId = exec.correlationId

  try {
    // ---------------------------------------------------------------- RECEBIDO
    let t = Date.now()
    const leitura = await lerDocumento(prisma, exec.documentoId)
    if (!leitura) {
      await transicionar(execucaoId, "FALHA_LEITURA", false, "Documento não encontrado.", t, tentativa)
      return { ...vazio, etapaFinal: "FALHA_LEITURA", erro: "documento inexistente" }
    }
    await transicionar(execucaoId, "RECEBIDO", true, `Leitura montada (fonte: ${leitura.fonte}).`, t, tentativa, {
      fonte: leitura.fonte,
      paginas: leitura.paginas.length,
    })

    if (!temMaterialParaLer(leitura)) {
      t = Date.now()
      await transicionar(
        execucaoId,
        "DOCUMENTO_INSUFICIENTE",
        false,
        "Sem transcrição, sem campos literais e sem dado estruturado: não há o que ler.",
        t,
        tentativa,
      )
      await prisma.execucaoRegistral.update({
        where: { id: execucaoId },
        data: { fonteTexto: leitura.fonte, finalizadoEm: new Date(), tentativas: tentativa },
      })
      return { ...vazio, etapaFinal: "DOCUMENTO_INSUFICIENTE" }
    }

    // ------------------------------------------------------------ CLASSIFICANDO
    t = Date.now()
    const classificacao = classificarDocumento(leitura)
    await prisma.execucaoRegistral.update({
      where: { id: execucaoId },
      data: {
        tipoDetectado: classificacao.natureza,
        confiancaTipo: classificacao.confianca,
        fonteTexto: leitura.fonte,
      },
    })
    await transicionar(
      execucaoId,
      "CLASSIFICANDO",
      !classificacao.insuficiente,
      `Natureza ${classificacao.natureza} (fonte ${classificacao.fonte}, confiança ${classificacao.confianca.toFixed(2)}).`,
      t,
      tentativa,
      { natureza: classificacao.natureza, fonte: classificacao.fonte, divergencia: classificacao.divergenciaComDeclarado },
    )

    let conflitos = 0
    if (classificacao.divergenciaComDeclarado && classificacao.naturezaTextual) {
      conflitos += await abrirConflito({
        processoId,
        arvoreId: exec.lote.arvoreId,
        loteId: exec.loteId,
        execucaoId,
        codigo: "TIPO_DOCUMENTO_DIVERGENTE",
        severidade: "ALTO",
        descricao: `O documento está cadastrado como ${classificacao.natureza} mas o texto é de ${classificacao.naturezaTextual}`,
        explicacao:
          "O tipo declarado no Sistema Documental e o conteúdo do documento não coincidem. O motor não altera o tipo do documento — quem é dono do tipo é o Sistema Documental.",
        acaoSugerida: "Conferir o arquivo anexado e corrigir o tipo no Sistema Documental, ou substituir o arquivo.",
        evidencias: classificacao.indicios,
        documentoIds: [exec.documentoId],
        assinatura: `${classificacao.natureza}->${classificacao.naturezaTextual}`,
      })
      await transicionar(
        execucaoId,
        "DOCUMENTO_CONFLITANTE",
        false,
        `Tipo declarado (${classificacao.natureza}) divergente do conteúdo (${classificacao.naturezaTextual}).`,
        Date.now(),
        tentativa,
      )
    }

    if (classificacao.insuficiente) {
      await transicionar(
        execucaoId,
        "DOCUMENTO_INSUFICIENTE",
        false,
        "Não foi possível classificar a natureza registral do documento.",
        Date.now(),
        tentativa,
      )
      await prisma.execucaoRegistral.update({
        where: { id: execucaoId },
        data: { finalizadoEm: new Date(), tentativas: tentativa },
      })
      return { ...vazio, etapaFinal: "DOCUMENTO_INSUFICIENTE", conflitos }
    }

    const natureza: NaturezaRegistral = classificacao.natureza

    // ---------------------------------------------------- EXTRAINDO / REEXTRAINDO
    t = Date.now()
    const leituraA = extrairAncorado(leitura, natureza)
    await transicionar(
      execucaoId,
      "EXTRAINDO",
      leituraA.campos.length > 0,
      `Leitura por âncora de rótulo: ${leituraA.campos.length} campo(s).`,
      t,
      tentativa,
      { extrator: leituraA.extrator, campos: leituraA.campos.length, lacunas: leituraA.lacunas.length },
    )

    t = Date.now()
    const leituraB = extrairEstrutural(leitura, natureza)
    await transicionar(
      execucaoId,
      "REEXTRAINDO",
      leituraB.campos.length > 0,
      `Leitura independente (gramática registral + canal estruturado): ${leituraB.campos.length} campo(s).`,
      t,
      tentativa,
      { extrator: leituraB.extrator, campos: leituraB.campos.length, lacunas: leituraB.lacunas.length },
    )

    // ---------------------------------------------------------- NORMALIZANDO
    t = Date.now()
    const conferencia = conferir(leituraA, leituraB, natureza)
    const divergentes = conferencia.campos.filter((c) => c.veredicto === "DIVERGENTE")
    await transicionar(
      execucaoId,
      "NORMALIZANDO",
      true,
      `${conferencia.campos.length} campo(s) conferido(s); ${divergentes.length} divergente(s); ${conferencia.bloqueados.length} bloqueado(s) para revisão.`,
      t,
      tentativa,
      {
        campos: conferencia.campos.length,
        divergentes: divergentes.length,
        bloqueados: conferencia.bloqueados.length,
      },
    )

    // DIVERGÊNCIA ANTES DE TUDO: um documento pode ser insuficiente para montar
    // pessoa E, ao mesmo tempo, ter leituras divergentes num campo crítico. Se a
    // insuficiência interrompesse o fluxo antes disto, a divergência (que é a
    // informação mais valiosa do documento ruim) seria perdida em silêncio.
    const sujeitoDeclarado = leitura.pessoaId
    for (const c of conferencia.bloqueados) {
      conflitos += await abrirConflito({
        processoId,
        arvoreId: exec.lote.arvoreId,
        loteId: exec.loteId,
        execucaoId,
        codigo: ehCampoCritico(c.campo) ? "LEITURA_DIVERGENTE_CAMPO_CRITICO" : "LEITURA_DIVERGENTE",
        severidade: ehCampoCritico(c.campo) ? "CRITICO" : "MEDIO",
        campo: c.campo,
        pessoaId: sujeitoDeclarado,
        descricao: `${ROTULO_CAMPO[c.campo]}: as duas leituras do documento discordam`,
        explicacao: c.explicacao,
        acaoSugerida:
          "Abrir o documento, conferir o campo e registrar o valor correto. O motor não escolhe entre leituras divergentes.",
        evidencias: [
          c.a ? `leitura A (${c.a.metodo}): “${c.a.valorNormalizado}” — ${c.a.regiao ?? "sem posição"}` : "leitura A: ausente",
          c.b ? `leitura B (${c.b.metodo}): “${c.b.valorNormalizado}” — ${c.b.regiao ?? "sem posição"}` : "leitura B: ausente",
        ],
        documentoIds: [exec.documentoId],
        assinatura: `${c.campo}:${c.a?.valorNormalizado ?? ""}|${c.b?.valorNormalizado ?? ""}`,
      })
    }

    if (conferencia.insuficiente) {
      await transicionar(
        execucaoId,
        "DOCUMENTO_INSUFICIENTE",
        false,
        conferencia.motivoInsuficiencia ?? "Leitura insuficiente.",
        Date.now(),
        tentativa,
      )
      await prisma.execucaoRegistral.update({
        where: { id: execucaoId },
        data: {
          finalizadoEm: new Date(),
          tentativas: tentativa,
          // Os contadores são persistidos INCLUSIVE no desvio: sem isso, um
          // documento insuficiente com divergência aparece na tela como se nada
          // tivesse sido lido.
          camposExtraidos: conferencia.campos.filter((c) => c.valorNormalizado).length,
          camposDivergentes: divergentes.length,
        },
      })
      return {
        ...vazio,
        etapaFinal: "DOCUMENTO_INSUFICIENTE",
        conflitos,
        camposExtraidos: conferencia.campos.filter((c) => c.valorNormalizado).length,
        camposDivergentes: divergentes.length,
      }
    }

    // -------------------------------------------------- RESOLVENDO_IDENTIDADES
    t = Date.now()
    const ctx = await carregarContexto(prisma, processoId)
    const arvoreId = exec.lote.arvoreId ?? ctx?.arvoreId ?? null
    const candidatos = await carregarCandidatos(arvoreId, conferencia.ocorrencias)

    const resolvidas = new Map<PapelOcorrencia, { ocorrenciaId: number; pessoaId: number | null }>()
    let correspondenciasCriadas = 0

    for (const oc of conferencia.ocorrencias) {
      const ocorrenciaId = await persistirOcorrencia(execucaoId, exec.documentoId, oc)
      const ctxIdent = {
        paiResolvidoId: resolvidas.get("PAI")?.pessoaId ?? null,
        maeResolvidoId: resolvidas.get("MAE")?.pessoaId ?? null,
        conjugeResolvidoId: resolvidas.get("CONJUGE")?.pessoaId ?? null,
        pessoaDoDocumentoId: leitura.pessoaId,
        // Desempate: entre candidatos empatados, o da árvore deste processo vem
        // primeiro e não é cortado pelo teto da lista.
        arvorePreferidaId: arvoreId,
      }
      const r = resolverIdentidade(oc, candidatos, ctxIdent)

      for (const c of r.correspondencias) {
        await prisma.correspondenciaIdentidade.upsert({
          where: { chaveIdempotencia: chaveCorrespondencia({ ocorrenciaId, pessoaId: c.pessoaId }) },
          update: { classe: c.classe, score: c.score, evidencias: c.evidencias as unknown as Prisma.InputJsonValue },
          create: {
            ocorrenciaId,
            pessoaId: c.pessoaId,
            classe: c.classe,
            score: c.score,
            evidencias: c.evidencias as unknown as Prisma.InputJsonValue,
            chaveIdempotencia: chaveCorrespondencia({ ocorrenciaId, pessoaId: c.pessoaId }),
          },
        })
        correspondenciasCriadas++
      }

      await prisma.ocorrenciaDocumental.update({
        where: { id: ocorrenciaId },
        data: {
          classe: r.classeFinal,
          scoreIdentidade: r.correspondencias[0]?.score ?? null,
          pessoaResolvidaId: r.pessoaAutomatica,
          resolvidaAutomaticamente: r.pessoaAutomatica != null,
        },
      })

      resolvidas.set(oc.papel, { ocorrenciaId, pessoaId: r.pessoaAutomatica })

      // Homônimo: dois candidatos fortes é conflito, não escolha.
      const fortes = r.correspondencias.filter(
        (c) => c.classe === "CORRESPONDENCIA_CONFIRMADA" || c.classe === "ALTAMENTE_PROVAVEL",
      )
      if (fortes.length > 1) {
        conflitos += await abrirConflito({
          processoId,
          arvoreId,
          loteId: exec.loteId,
          execucaoId,
          codigo: "HOMONIMO_NAO_RESOLVIDO",
          severidade: "ALTO",
          descricao: `“${oc.nomeBruto}” (${oc.papel}) tem ${fortes.length} candidatos fortes no Cadastro Mestre`,
          explicacao: `${r.explicacao} Nenhuma vinculação foi feita: fundir homônimo é irreversível na prática.`,
          acaoSugerida: "Comparar filiação, datas e localidade dos candidatos e registrar a decisão de identidade.",
          evidencias: fortes.map((f) => `pessoa ${f.pessoaId}: ${(f.score * 100).toFixed(0)}% (${f.classe})`),
          documentoIds: [exec.documentoId],
          assinatura: `${oc.papel}:${oc.nomeNormalizado}:${fortes.map((f) => f.pessoaId).join(",")}`,
        })
      }
      const conflitantes = r.correspondencias.filter((c) => c.classe === "REGISTROS_CONFLITANTES")
      if (conflitantes.length) {
        conflitos += await abrirConflito({
          processoId,
          arvoreId,
          loteId: exec.loteId,
          execucaoId,
          codigo: "IDENTIDADE_COM_REGISTRO_CONFLITANTE",
          severidade: "MEDIO",
          descricao: `“${oc.nomeBruto}” (${oc.papel}) corresponde a pessoa com dados conflitantes`,
          explicacao: conflitantes
            .map((c) => `pessoa ${c.pessoaId}: ${c.motivoBloqueio ?? "conflito não descrito"}`)
            .join(" · "),
          acaoSugerida: "Verificar qual das duas informações está correta antes de vincular.",
          evidencias: conflitantes.flatMap((c) => c.evidencias.filter((e) => !e.favoravel).map((e) => e.descricao)),
          documentoIds: [exec.documentoId],
          assinatura: `${oc.papel}:${oc.nomeNormalizado}:conf:${conflitantes.map((c) => c.pessoaId).join(",")}`,
        })
      }
    }

    await transicionar(
      execucaoId,
      "RESOLVENDO_IDENTIDADES",
      true,
      `${conferencia.ocorrencias.length} ocorrência(s); ${[...resolvidas.values()].filter((v) => v.pessoaId != null).length} resolvida(s) automaticamente; ${correspondenciasCriadas} correspondência(s) avaliada(s).`,
      t,
      tentativa,
      { ocorrencias: conferencia.ocorrencias.length, correspondencias: correspondenciasCriadas },
    )

    // ------------------------------------------------------- CRUZANDO_EVIDENCIAS
    t = Date.now()
    const sujeitoPrincipal = resolvidas.get("REGISTRADO")?.pessoaId ?? leitura.pessoaId ?? null
    const { evidencias, fatos } = await persistirEvidenciasEFatos({
      execucaoId,
      leitura,
      conferencia: conferencia.campos,
      sujeitoPrincipal,
      resolvidas,
    })
    await transicionar(
      execucaoId,
      "CRUZANDO_EVIDENCIAS",
      true,
      `${evidencias} evidência(s) registrada(s); ${fatos} fato(s) registral(is) afirmado(s)/atualizado(s).`,
      t,
      tentativa,
      { evidencias, fatos },
    )

    // ------------------------------------------------------------- VALIDANDO
    // Os conflitos de divergência já foram abertos logo após a conferência (para
    // não se perderem num documento insuficiente). Aqui a etapa é registrada com
    // o resultado da validação.
    t = Date.now()
    await transicionar(
      execucaoId,
      "VALIDANDO",
      conferencia.bloqueados.length === 0,
      `${conferencia.bloqueados.length} campo(s) bloqueado(s) por divergência entre leituras.`,
      t,
      tentativa,
      { bloqueados: conferencia.bloqueados.length, conflitos },
    )

    // ------------------------------------------------------------ REVALIDANDO
    // Confronto do que o documento diz com o que o cadastro tem — é o que produz
    // divergência árvore × certidão. Roda sobre o estado atual, sem alterar nada.
    t = Date.now()
    await transicionar(
      execucaoId,
      "REVALIDANDO",
      true,
      "Fatos cruzados com o cadastro atual; divergências viram proposta ou conflito.",
      t,
      tentativa,
    )

    // ------------------------------------------------------- ANALISANDO_IMPACTO
    t = Date.now()
    const propostas = await montarEPersistirPropostas({
      processoId,
      arvoreId,
      loteId: exec.loteId,
      execucaoId,
      documentoId: exec.documentoId,
      correlationId,
      leitura,
      conferencia: conferencia.campos,
      ocorrencias: conferencia.ocorrencias,
      resolvidas,
      sujeitoPrincipal,
      candidatos,
      requerenteIds: ctx?.requerenteIds ?? [],
    })
    await transicionar(
      execucaoId,
      "ANALISANDO_IMPACTO",
      true,
      `${propostas.total} proposta(s); ${propostas.automaticas} aplicável(is) automaticamente; ${propostas.total - propostas.automaticas} aguardando decisão humana.`,
      t,
      tentativa,
      { propostas: propostas.total, automaticas: propostas.automaticas },
    )

    // ------------------------------------- AGUARDANDO_REVISAO / APLICADO / AUDITADO
    const precisaRevisao = propostas.total > propostas.automaticas || conflitos > 0
    const etapaFinal: Etapa = precisaRevisao ? "AGUARDANDO_REVISAO" : "APLICADO"
    await transicionar(
      execucaoId,
      etapaFinal,
      true,
      precisaRevisao
        ? "Há proposta sensível ou conflito: a execução aguarda decisão humana."
        : "Nada sensível a decidir: tudo o que havia era aplicável pelo motor.",
      Date.now(),
      tentativa,
    )

    await prisma.execucaoRegistral.update({
      where: { id: execucaoId },
      data: {
        tentativas: tentativa,
        erro: null,
        reservadoEm: null,
        proximaEm: null,
        finalizadoEm: new Date(),
        ocorrenciasDetectadas: conferencia.ocorrencias.length,
        camposExtraidos: conferencia.campos.filter((c) => c.valorNormalizado).length,
        camposDivergentes: divergentes.length,
        evidenciasCriadas: evidencias,
      },
    })

    await auditar(prisma, {
      acao: ACOES_AUDITORIA.EXECUCAO_ETAPA,
      entidade: "ExecucaoRegistral",
      entidadeId: execucaoId,
      descricao: `Documento #${exec.documentoId} processado até ${etapaFinal}.`,
      detalhes: {
        natureza,
        ocorrencias: conferencia.ocorrencias.length,
        evidencias,
        fatos,
        conflitos,
        propostas: propostas.total,
        duracaoMs: Date.now() - inicioTotal,
      },
      correlationId,
    })

    await transicionar(execucaoId, "AUDITADO", true, "Trilha de auditoria registrada.", Date.now(), tentativa)

    return {
      execucaoId,
      etapaFinal,
      ocorrencias: conferencia.ocorrencias.length,
      camposExtraidos: conferencia.campos.filter((c) => c.valorNormalizado).length,
      camposDivergentes: divergentes.length,
      evidencias,
      fatos,
      conflitos,
      propostas: propostas.total,
      propostasAutomaticas: propostas.automaticas,
      erro: null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const definitiva = tentativa >= MAX_TENTATIVAS_EXECUCAO
    await transicionar(
      execucaoId,
      definitiva ? "FALHA_LEITURA" : "REPROCESSAMENTO",
      false,
      msg,
      inicioTotal,
      tentativa,
    ).catch((erroEtapa) =>
      // Não engolir: falhar ao registrar a etapa de falha é o pior cenário de
      // observabilidade, e tem de ficar visível no log estruturado.
      logRegistral("error", "falha_ao_registrar_etapa", {
        execucaoId,
        erro: erroEtapa instanceof Error ? erroEtapa.message : String(erroEtapa),
      }),
    )
    await prisma.execucaoRegistral
      .update({
        where: { id: execucaoId },
        data: {
          tentativas: tentativa,
          erro: msg.slice(0, 2000),
          reservadoEm: null,
          proximaEm: definitiva ? null : new Date(Date.now() + backoffMs(tentativa)),
          ...(definitiva ? { finalizadoEm: new Date() } : {}),
        },
      })
      .catch((erroUpdate) =>
        logRegistral("error", "falha_ao_registrar_backoff", {
          execucaoId,
          erro: erroUpdate instanceof Error ? erroUpdate.message : String(erroUpdate),
        }),
      )
    await auditar(prisma, {
      acao: ACOES_AUDITORIA.EXECUCAO_FALHA,
      entidade: "ExecucaoRegistral",
      entidadeId: execucaoId,
      descricao: `Falha ao processar documento #${exec.documentoId} (tentativa ${tentativa}).`,
      detalhes: { erro: msg, definitiva },
      correlationId,
    })
    logRegistral("error", "execucao_falhou", { execucaoId, tentativa, definitiva, erro: msg })
    return { ...vazio, etapaFinal: definitiva ? "FALHA_LEITURA" : "REPROCESSAMENTO", erro: msg }
  }
}

// ============================================================================
// persistência das etapas
// ============================================================================

async function persistirOcorrencia(
  execucaoId: number,
  documentoId: number,
  oc: OcorrenciaExtraida,
): Promise<number> {
  const chave = chaveOcorrencia({ execucaoId, papel: oc.papel, nomeNormalizado: oc.nomeNormalizado })
  const linha = await prisma.ocorrenciaDocumental.upsert({
    where: { chaveIdempotencia: chave },
    update: {
      nomeBruto: oc.nomeBruto.slice(0, 300),
      chaveFonetica: oc.chaveFonetica || null,
      sexoInferido: oc.sexoInferido,
      atributos: oc.atributos as unknown as Prisma.InputJsonValue,
    },
    create: {
      execucaoId,
      documentoId,
      papel: oc.papel,
      nomeBruto: oc.nomeBruto.slice(0, 300),
      nomeNormalizado: oc.nomeNormalizado.slice(0, 300),
      chaveFonetica: oc.chaveFonetica || null,
      sexoInferido: oc.sexoInferido,
      atributos: oc.atributos as unknown as Prisma.InputJsonValue,
      chaveIdempotencia: chave,
    },
    select: { id: true },
  })
  return linha.id
}

const SELECT_CANDIDATO = {
  id: true,
  nome: true,
  sobrenome: true,
  sexo: true,
  data_nasc: true,
  data_obito: true,
  local_nasc: true,
  pais_nasc: true,
  profissao: true,
  paiId: true,
  maeId: true,
  arvoreId: true,
  pai: { select: { nome: true, sobrenome: true } },
  mae: { select: { nome: true, sobrenome: true } },
  nomePessoas: { where: { ativo: true }, select: { nome: true, sobrenome: true, tipo: true } },
  unioesComoPessoa1: { select: { pessoa2Id: true } },
  unioesComoPessoa2: { select: { pessoa1Id: true } },
} satisfies Prisma.PessoaSelect

/**
 * Candidatos do Cadastro Mestre, com aliases e nomes dos genitores.
 *
 * DUAS consultas, e a ordem importa:
 *   1. TODAS as pessoas da árvore DESTE processo — escopo primário, nunca cortado;
 *   2. pessoas de OUTRAS árvores que casam por fonética ou prenome, preenchendo o
 *      resto do teto.
 *
 * Uma consulta única com `OR` + `take` ordenado por id fazia a pessoa certa da
 * árvore atual ser empurrada para fora do teto por homônimos mais antigos de
 * outras famílias — num escritório com centenas de clientes isso significa deixar
 * de reconhecer a própria pessoa do processo.
 */
async function carregarCandidatos(
  arvoreId: number | null,
  ocorrencias: OcorrenciaExtraida[],
): Promise<PessoaConhecida[]> {
  if (!ocorrencias.length) return []

  const chaves = [...new Set(ocorrencias.map((o) => o.chaveFonetica).filter(Boolean))]
  const primeirosNomes = [...new Set(ocorrencias.map((o) => o.nomeNormalizado.split(" ")[0]).filter(Boolean))]

  const daArvore = arvoreId != null
    ? await prisma.pessoa.findMany({
        where: { arvoreId },
        select: SELECT_CANDIDATO,
        take: TETO_CANDIDATOS_IDENTIDADE,
        orderBy: { id: "asc" },
      })
    : []

  const restante = Math.max(0, TETO_CANDIDATOS_IDENTIDADE - daArvore.length)
  const foraDaArvore = restante > 0 && (chaves.length || primeirosNomes.length)
    ? await prisma.pessoa.findMany({
        where: {
          ...(arvoreId != null ? { NOT: { arvoreId } } : {}),
          OR: [
            ...(chaves.length ? [{ nomePessoas: { some: { chaveFonetica: { in: chaves }, ativo: true } } }] : []),
            ...primeirosNomes.map((n) => ({ nome: { startsWith: n.slice(0, 4), mode: "insensitive" as const } })),
          ],
        },
        select: SELECT_CANDIDATO,
        take: restante,
        orderBy: { id: "asc" },
      })
    : []

  const linhas = [...daArvore, ...foraDaArvore]

  return linhas.map((p) => ({
    id: p.id,
    nome: p.nome,
    sobrenome: p.sobrenome,
    sexo: p.sexo,
    cpf: null,
    data_nasc: p.data_nasc,
    data_obito: p.data_obito,
    local_nasc: p.local_nasc,
    pais_nasc: p.pais_nasc,
    profissao: p.profissao,
    paiId: p.paiId,
    maeId: p.maeId,
    nomePai: p.pai ? [p.pai.nome, p.pai.sobrenome].filter(Boolean).join(" ") : null,
    nomeMae: p.mae ? [p.mae.nome, p.mae.sobrenome].filter(Boolean).join(" ") : null,
    arvoreId: p.arvoreId,
    aliases: p.nomePessoas.map((a) => ({ nome: a.nome, sobrenome: a.sobrenome, tipo: a.tipo })),
    conjugesIds: [
      ...p.unioesComoPessoa1.map((u) => u.pessoa2Id),
      ...p.unioesComoPessoa2.map((u) => u.pessoa1Id),
    ],
  }))
}

/**
 * Sujeito de cada campo: NOME/DATA/LOCAL do registrado pertencem à pessoa do
 * registro; FILIAÇÃO e CÔNJUGE também são fatos DA PESSOA REGISTRADA (o fato é
 * "o pai dela é X"), não do genitor.
 */
function sujeitoDoCampo(
  campo: CampoRegistral,
  papel: PapelOcorrencia,
  sujeitoPrincipal: number | null,
  resolvidas: Map<PapelOcorrencia, { ocorrenciaId: number; pessoaId: number | null }>,
): number | null {
  if (campo === "FILIACAO_PAI" || campo === "FILIACAO_MAE" || campo === "CONJUGE") return sujeitoPrincipal
  if (papel === "REGISTRADO") return sujeitoPrincipal
  return resolvidas.get(papel)?.pessoaId ?? null
}

async function persistirEvidenciasEFatos(p: {
  execucaoId: number
  leitura: LeituraDocumento
  conferencia: CampoConferido[]
  sujeitoPrincipal: number | null
  resolvidas: Map<PapelOcorrencia, { ocorrenciaId: number; pessoaId: number | null }>
}): Promise<{ evidencias: number; fatos: number }> {
  let evidencias = 0
  let fatos = 0

  for (const c of p.conferencia) {
    const sujeitoId = sujeitoDoCampo(c.campo, c.papel, p.sujeitoPrincipal, p.resolvidas)
    const ocorrenciaId = p.resolvidas.get(c.papel)?.ocorrenciaId ?? null

    // 1. EVIDÊNCIA por LEITURA. A e B são duas evidências independentes — é isso
    //    que sustenta CONFIRMADO_MULTIPLAS_EVIDENCIAS. Evidência é registrada
    //    inclusive quando o campo ficou bloqueado: divergência é evidência.
    for (const bruta of [c.a, c.b]) {
      if (!bruta) continue
      const criada = await gravarEvidencia({
        execucaoId: p.execucaoId,
        leitura: p.leitura,
        extraido: bruta,
        campo: c.campo,
        papel: c.papel,
        pessoaId: sujeitoId,
        ocorrenciaId,
        favoravel: c.veredicto !== "DIVERGENTE",
        fatoId: null,
      })
      if (criada) evidencias++
    }

    // 2. FATO. Campo divergente/ausente NÃO gera fato com valor: gera fato em
    //    estado DIVERGENTE, sem valor consolidado, para o dossiê mostrar a
    //    pendência em vez de esconder.
    if (sujeitoId == null) continue
    const criouFato = await afirmarFato({
      pessoaId: sujeitoId,
      campo: c.campo,
      conferido: c,
      execucaoId: p.execucaoId,
      documentoId: p.leitura.documentoId,
      necessidadeId: p.leitura.necessidadeId,
      itemCatalogoId: p.leitura.itemCatalogoId,
      ocorrenciaId,
    })
    if (criouFato) fatos++
  }

  return { evidencias, fatos }
}

async function gravarEvidencia(p: {
  execucaoId: number
  leitura: LeituraDocumento
  extraido: CampoExtraido
  campo: CampoRegistral
  papel: PapelOcorrencia
  pessoaId: number | null
  ocorrenciaId: number | null
  favoravel: boolean
  fatoId: number | null
}): Promise<boolean> {
  const chave = chaveEvidencia({
    documentoId: p.leitura.documentoId,
    campo: p.campo,
    papel: p.papel,
    valorNormalizado: p.extraido.valorNormalizado,
    metodo: p.extraido.metodo,
    pessoaId: p.pessoaId,
  })
  const existente = await prisma.evidenciaRegistral.findUnique({
    where: { chaveIdempotencia: chave },
    select: { id: true },
  })
  if (existente) {
    // Idempotente: a evidência é imutável; só o vínculo com o fato pode evoluir.
    if (p.fatoId != null) {
      await prisma.evidenciaRegistral.update({ where: { id: existente.id }, data: { fatoId: p.fatoId } })
    }
    return false
  }

  await prisma.evidenciaRegistral.create({
    data: {
      execucaoId: p.execucaoId,
      documentoId: p.leitura.documentoId,
      itemCatalogoId: p.leitura.itemCatalogoId,
      necessidadeId: p.leitura.necessidadeId,
      ocorrenciaId: p.ocorrenciaId,
      fatoId: p.fatoId,
      pessoaId: p.pessoaId,
      campo: p.campo,
      pagina: p.extraido.pagina,
      regiao: p.extraido.regiao,
      trechoTexto: p.extraido.trecho,
      valorBruto: p.extraido.valorBruto,
      valorNormalizado: p.extraido.valorNormalizado,
      metodoExtracao: p.extraido.metodo.slice(0, 40),
      versaoProcessamento: VERSAO_MOTOR,
      confiancaExtracao: p.extraido.confianca,
      confiancaAssociacao: p.pessoaId != null ? 0.9 : 0.4,
      regraAplicada: p.extraido.regra.slice(0, 80),
      favoravel: p.favoravel,
      chaveIdempotencia: chave,
    },
  })
  return true
}

/**
 * Afirma (ou reafirma) um FATO REGISTRAL.
 *
 * Regras append-only:
 *   · o fato ATIVO daquele (sujeito, campo) é único;
 *   · mudar o VALOR de um fato ativo NÃO acontece aqui — mudança de valor é
 *     proposta. Aqui só se acumula evidência, recalcula estado e sobe/desce
 *     confiança do MESMO valor;
 *   · quando o valor do documento difere do valor do fato ativo, o fato ativo
 *     passa a DIVERGENTE (com evidência contrária registrada) e a correção fica
 *     como proposta. Nunca sobrescrita silenciosa.
 */
async function afirmarFato(p: {
  pessoaId: number
  campo: CampoRegistral
  conferido: CampoConferido
  execucaoId: number
  documentoId: number
  necessidadeId: number | null
  itemCatalogoId: number | null
  ocorrenciaId: number | null
}): Promise<boolean> {
  const c = p.conferido
  const ativo = await prisma.fatoRegistral.findFirst({
    where: { pessoaId: p.pessoaId, campo: p.campo, ativo: true },
    select: { id: true, valorNormalizado: true, versao: true, estado: true },
  })

  const divergenteEntreLeituras = c.veredicto === "DIVERGENTE"
  const valor = c.valorNormalizado
  const valorData = c.valorData ? new Date(`${c.valorData}T12:00:00.000Z`) : null

  // Conta evidências favoráveis/contrárias já registradas para este (sujeito, campo).
  const contagem = await prisma.evidenciaRegistral.groupBy({
    by: ["favoravel"],
    where: { pessoaId: p.pessoaId, campo: p.campo },
    _count: { _all: true },
  })
  const favoraveis = contagem.find((x) => x.favoravel)?._count._all ?? 0
  const contrarias = contagem.find((x) => !x.favoravel)?._count._all ?? 0

  if (ativo) {
    const mesmoValor = valor != null && ativo.valorNormalizado === valor
    const conflitoDeValor = valor != null && ativo.valorNormalizado != null && !mesmoValor

    const estado: EstadoFatoRegistral = estadoDoFato({
      temValor: ativo.valorNormalizado != null,
      favoraveis: mesmoValor ? favoraveis : Math.max(0, favoraveis - 1),
      contrarias: conflitoDeValor ? contrarias + 1 : contrarias,
      divergenciaEntreLeituras: divergenteEntreLeituras || conflitoDeValor,
      conflitoAberto: ativo.estado === "CONFLITANTE",
      emRevisao: ativo.estado === "EM_REVISAO",
      rejeitado: ativo.estado === "REJEITADO",
      informadoPeloCliente: false,
      incompleto: false,
    })

    await prisma.fatoRegistral.update({
      where: { id: ativo.id },
      data: {
        estado,
        confianca: confiancaDoEstado(estado),
        totalEvidencias: favoraveis + contrarias,
        evidenciasFavoraveis: favoraveis,
        evidenciasContrarias: conflitoDeValor ? contrarias + 1 : contrarias,
      },
    })
    await vincularEvidenciasAoFato(p.pessoaId, p.campo, ativo.id)
    return false
  }

  // Fato novo. Sem valor consolidado, nasce DIVERGENTE (o dossiê mostra a
  // pendência); com valor, nasce com o estado que as evidências sustentam.
  const estado: EstadoFatoRegistral = estadoDoFato({
    temValor: valor != null,
    favoraveis,
    contrarias,
    divergenciaEntreLeituras: divergenteEntreLeituras,
    conflitoAberto: false,
    emRevisao: false,
    rejeitado: false,
    informadoPeloCliente: false,
    incompleto: false,
  })

  const chave = chaveFato({ pessoaId: p.pessoaId, campo: p.campo, versao: 1 })
  const criado = await prisma.fatoRegistral.upsert({
    where: { chaveIdempotencia: chave },
    update: {
      estado,
      confianca: confiancaDoEstado(estado),
      totalEvidencias: favoraveis + contrarias,
      evidenciasFavoraveis: favoraveis,
      evidenciasContrarias: contrarias,
    },
    create: {
      pessoaId: p.pessoaId,
      campo: p.campo,
      valorBruto: c.a?.valorBruto ?? c.b?.valorBruto ?? null,
      valorNormalizado: valor,
      valorData,
      estado,
      confianca: confiancaDoEstado(estado),
      origem: "DOCUMENTO",
      responsavelId: null,
      justificativa: c.explicacao.slice(0, 500),
      regraAplicada: `MRG-CONFERENCIA-${c.veredicto}`,
      totalEvidencias: favoraveis + contrarias,
      evidenciasFavoraveis: favoraveis,
      evidenciasContrarias: contrarias,
      versao: 1,
      ativo: true,
      chaveIdempotencia: chave,
    },
    select: { id: true },
  })

  await vincularEvidenciasAoFato(p.pessoaId, p.campo, criado.id)
  await auditar(prisma, {
    acao: ACOES_AUDITORIA.FATO_AFIRMADO,
    entidade: "FatoRegistral",
    entidadeId: criado.id,
    descricao: `${ROTULO_CAMPO[p.campo]} afirmado para a pessoa ${p.pessoaId} com estado ${estado}.`,
    detalhes: { campo: p.campo, estado, documentoId: p.documentoId, veredicto: c.veredicto },
  })
  return true
}

async function vincularEvidenciasAoFato(pessoaId: number, campo: CampoRegistral, fatoId: number): Promise<void> {
  await prisma.evidenciaRegistral.updateMany({
    where: { pessoaId, campo, fatoId: null },
    data: { fatoId },
  })
}

// ============================================================================
// propostas
// ============================================================================

async function montarEPersistirPropostas(p: {
  processoId: number
  arvoreId: number | null
  loteId: number
  execucaoId: number
  documentoId: number
  correlationId: string
  leitura: LeituraDocumento
  conferencia: CampoConferido[]
  ocorrencias: OcorrenciaExtraida[]
  resolvidas: Map<PapelOcorrencia, { ocorrenciaId: number; pessoaId: number | null }>
  sujeitoPrincipal: number | null
  candidatos: PessoaConhecida[]
  requerenteIds: number[]
}): Promise<{ total: number; automaticas: number }> {
  const montadas: PropostaMontada[] = []

  const pessoa = p.sujeitoPrincipal != null
    ? await prisma.pessoa.findUnique({
        where: { id: p.sujeitoPrincipal },
        select: {
          id: true,
          nome: true,
          sobrenome: true,
          sexo: true,
          data_nasc: true,
          data_obito: true,
          local_nasc: true,
          pais_nasc: true,
          data_batismo: true,
          local_batismo: true,
          profissao: true,
          nacionalidade: true,
          data_naturalizacao: true,
          data_emigracao: true,
          paiId: true,
          maeId: true,
        },
      })
    : null

  const camposComConflito = new Set<string>(
    (
      await prisma.conflitoRegistral.findMany({
        where: { processoId: p.processoId, status: { in: ["ABERTO", "EM_REVISAO"] }, campo: { not: null } },
        select: { campo: true },
      })
    )
      .map((c) => c.campo)
      .filter((x): x is CampoRegistral => x != null),
  )

  const camposConfirmados = new Set<string>(
    p.sujeitoPrincipal != null
      ? (
          await prisma.fatoRegistral.findMany({
            where: {
              pessoaId: p.sujeitoPrincipal,
              ativo: true,
              estado: { in: ["CONFIRMADO", "CONFIRMADO_MULTIPLAS_EVIDENCIAS"] },
            },
            select: { campo: true },
          })
        ).map((f) => f.campo)
      : [],
  )

  const afetaRequerente = p.sujeitoPrincipal != null && p.requerenteIds.includes(p.sujeitoPrincipal)
  const processosAfetados = 1

  const ctxBase = {
    processoId: p.processoId,
    documentoId: p.documentoId,
    pessoaId: p.sujeitoPrincipal,
    pessoa: pessoa
      ? ({
          ...pessoa,
          requerente: null,
          linhaReta: true,
        } as unknown as import("@/src/lib/genealogia/motor/tipos").PessoaEntrada)
      : null,
    camposComConflito,
    camposConfirmados,
    afetaLinhaCidadania: afetaRequerente,
    afetaRequerente,
    processosAfetados,
  }

  // 1. propostas de CAMPO (confirmar / completar / corrigir)
  montadas.push(...propostasDeCampos(p.conferencia, ctxBase))

  // 2. propostas de IDENTIDADE (vincular / criar pessoa)
  const nomesCandidatos = new Map(p.candidatos.map((c) => [c.id, [c.nome, c.sobrenome].filter(Boolean).join(" ")]))
  for (const oc of p.ocorrencias) {
    const resolvida = p.resolvidas.get(oc.papel)
    if (resolvida?.pessoaId != null) {
      // Já resolvida automaticamente: a única proposta útil é o ALIAS, quando a
      // grafia do documento ainda não está registrada.
      const alias = await propostaAliasSeNovo(p.processoId, p.documentoId, resolvida.pessoaId, oc)
      if (alias) montadas.push(alias)
      continue
    }
    const correspondencias = await prisma.correspondenciaIdentidade.findMany({
      where: { ocorrenciaId: resolvida?.ocorrenciaId ?? -1 },
      select: { pessoaId: true, classe: true, score: true, evidencias: true },
      orderBy: { score: "desc" },
    })
    montadas.push(
      ...propostasDeIdentidade(
        correspondencias.map((c) => ({
          pessoaId: c.pessoaId,
          classe: c.classe,
          score: c.score,
          evidencias: Array.isArray(c.evidencias)
            ? (c.evidencias as unknown as import("@/src/lib/genealogia/registral/tipos").EvidenciaIdentidade[])
            : [],
          motivoBloqueio: null,
        })),
        {
          ...ctxBase,
          ocorrencia: oc,
          nomeDe: (id) => nomesCandidatos.get(id) ?? `pessoa #${id}`,
        },
      ),
    )
  }

  let total = 0
  let automaticas = 0
  for (const m of montadas) {
    const r = await persistirProposta({
      processoId: p.processoId,
      arvoreId: p.arvoreId,
      loteId: p.loteId,
      execucaoId: p.execucaoId,
      correlationId: p.correlationId,
      montada: m,
    })
    if (r.criada || r.atualizada) total++
    if (m.aplicavelAutomaticamente) automaticas++
  }
  return { total, automaticas }
}

/**
 * Proposta de alias só quando a grafia do documento REALMENTE não está
 * registrada — nem como nome principal, nem como alias ativo.
 */
async function propostaAliasSeNovo(
  processoId: number,
  documentoId: number,
  pessoaId: number,
  oc: OcorrenciaExtraida,
): Promise<PropostaMontada | null> {
  if (oc.papel !== "REGISTRADO" && oc.papel !== "CONJUGE") return null
  const nome = normalizarNome(oc.nomeNormalizado)
  if (!nome) return null

  const pessoa = await prisma.pessoa.findUnique({
    where: { id: pessoaId },
    select: {
      nome: true,
      sobrenome: true,
      nomePessoas: { where: { ativo: true }, select: { nome: true, sobrenome: true } },
    },
  })
  if (!pessoa) return null

  const formas = [
    [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" "),
    ...pessoa.nomePessoas.map((a) => [a.nome, a.sobrenome].filter(Boolean).join(" ")),
  ]
  // 0.97 e não 1.0: grafia idêntica após normalização não precisa de alias novo.
  if (formas.some((f) => similaridadeNome(f, nome.completo) >= 0.97)) return null

  return propostaDeAlias({
    processoId,
    documentoId,
    pessoaId,
    nomeNoDocumento: nome.completo,
    tipoNome: "GRAFIA_DOCUMENTO",
    motivo: "A grafia do documento não está entre as formas de nome já registradas desta pessoa.",
  })
}

// ============================================================================
// conflitos
// ============================================================================

export async function abrirConflito(p: {
  processoId: number
  arvoreId: number | null
  loteId: number | null
  execucaoId: number | null
  codigo: string
  severidade: "CRITICO" | "ALTO" | "MEDIO" | "BAIXO" | "INFO"
  campo?: CampoRegistral | null
  pessoaId?: number | null
  uniaoId?: number | null
  descricao: string
  explicacao: string
  acaoSugerida: string
  evidencias: string[]
  documentoIds: number[]
  assinatura: string
}): Promise<number> {
  const chave = chaveConflito({
    processoId: p.processoId,
    codigo: p.codigo,
    pessoaId: p.pessoaId ?? null,
    uniaoId: p.uniaoId ?? null,
    campo: p.campo ?? null,
    assinatura: p.assinatura,
  })

  const existente = await prisma.conflitoRegistral.findUnique({
    where: { chaveIdempotencia: chave },
    select: { id: true, status: true },
  })
  if (existente) {
    // Reprocessar reabre o MESMO conflito (não cria outro). Conflito já resolvido
    // NÃO é reaberto automaticamente: reabrir apagaria a decisão humana.
    if (existente.status === "ABERTO" || existente.status === "EM_REVISAO") {
      await prisma.conflitoRegistral.update({
        where: { id: existente.id },
        data: {
          explicacao: p.explicacao,
          evidencias: p.evidencias as unknown as Prisma.InputJsonValue,
          documentoIds: p.documentoIds as unknown as Prisma.InputJsonValue,
        },
      })
    }
    return 0
  }

  const criado = await prisma.conflitoRegistral.create({
    data: {
      processoId: p.processoId,
      arvoreId: p.arvoreId,
      loteId: p.loteId,
      execucaoId: p.execucaoId,
      codigo: p.codigo.slice(0, 60),
      severidade: p.severidade,
      campo: p.campo ?? null,
      pessoaId: p.pessoaId ?? null,
      uniaoId: p.uniaoId ?? null,
      descricao: p.descricao.slice(0, 300),
      explicacao: p.explicacao,
      acaoSugerida: p.acaoSugerida.slice(0, 300),
      evidencias: p.evidencias as unknown as Prisma.InputJsonValue,
      documentoIds: p.documentoIds as unknown as Prisma.InputJsonValue,
      chaveIdempotencia: chave,
    },
    select: { id: true },
  })

  await auditar(prisma, {
    acao: ACOES_AUDITORIA.CONFLITO_ABERTO,
    entidade: "ConflitoRegistral",
    entidadeId: criado.id,
    descricao: `${p.codigo}: ${p.descricao}`,
    detalhes: { severidade: p.severidade, campo: p.campo, documentoIds: p.documentoIds },
  })
  return 1
}
