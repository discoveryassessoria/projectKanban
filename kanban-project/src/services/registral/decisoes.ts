// src/services/registral/decisoes.ts
//
// MRG — DECISÕES HUMANAS: aprovar, rejeitar, adiar, reverter, resolver conflito.
//
// Toda decisão é append-only em DecisaoRevisaoRegistral e registra QUAL PERMISSÃO
// foi exercida. Sem isso, "quem autorizou" é uma pergunta sem resposta seis meses
// depois.
//
// Reverter NUNCA apaga: desativa fatos, restaura campos a partir do snapshot da
// versão anterior e cria uma versão nova. Pessoa jamais é excluída — reverter a
// criação de uma pessoa devolve pendência humana, não um DELETE.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { permissaoDaProposta, type PermissaoRegistral } from "@/src/lib/genealogia/registral/campos"
import { chaveDecisao } from "@/src/lib/genealogia/registral/chaves"
import { METRICAS } from "@/src/lib/genealogia/registral/metricas"
import { auditar, registrarMetricas } from "./auditoria"
import { ACOES_AUDITORIA } from "./constantes"
import { aplicarProposta, type AtorAplicacao, type ResultadoAplicacao } from "./aplicar"
import { criarVersao, planoDeReversao } from "./versionamento"

export interface ResultadoDecisao {
  ok: boolean
  propostaId?: number
  conflitoId?: number
  mensagem: string
  codigo?: string
  detalhe?: unknown
}

function temPermissao(ator: AtorAplicacao, p: PermissaoRegistral): boolean {
  return ator.ehMotor || ator.permissoes[p] === true
}

/** APROVAR = decidir + aplicar (transacional, com revalidação). */
export async function aprovarProposta(p: {
  propostaId: number
  ator: AtorAplicacao
  motivo: string
  desbloqueioExplicito?: boolean
}): Promise<ResultadoAplicacao> {
  const r = await aplicarProposta(p)
  if (r.ok) {
    await registrarMetricas(
      prisma,
      [{ chave: METRICAS.PROPOSTAS_APROVADAS, escopo: `usuario:${p.ator.usuarioId ?? 0}`, valor: 1 }],
      new Date(),
    )
  }
  return r
}

export async function rejeitarProposta(p: {
  propostaId: number
  ator: AtorAplicacao
  motivo: string
  /** true quando o operador está declarando que a sugestão do motor era falsa. */
  falsoPositivo?: boolean
}): Promise<ResultadoDecisao> {
  if (!p.motivo?.trim()) {
    return { ok: false, codigo: "MOTIVO_OBRIGATORIO", mensagem: "Rejeitar exige motivo escrito." }
  }
  const proposta = await prisma.propostaReconciliacao.findUnique({
    where: { id: p.propostaId },
    select: { id: true, tipo: true, criticidade: true, status: true },
  })
  if (!proposta) return { ok: false, codigo: "NAO_ENCONTRADA", mensagem: "Proposta não encontrada." }
  if (proposta.status === "APLICADA") {
    return {
      ok: false,
      codigo: "JA_APLICADA",
      mensagem: "Proposta já aplicada: use reversão, não rejeição.",
    }
  }

  const permissao = permissaoDaProposta(proposta.tipo, proposta.criticidade)
  if (!temPermissao(p.ator, permissao)) {
    return { ok: false, codigo: "SEM_PERMISSAO", mensagem: `Esta decisão exige a permissão ${permissao}.` }
  }

  const rodada = await prisma.decisaoRevisaoRegistral.count({ where: { propostaId: p.propostaId } })

  await prisma.$transaction(async (tx) => {
    await tx.propostaReconciliacao.update({
      where: { id: p.propostaId },
      data: {
        status: "REJEITADA",
        decididoPorId: p.ator.usuarioId,
        decididoEm: new Date(),
        decisaoNota: p.motivo.slice(0, 500),
      },
    })
    await tx.decisaoRevisaoRegistral.create({
      data: {
        propostaId: p.propostaId,
        decisao: "REJEITAR",
        motivo: p.motivo.slice(0, 500),
        permissao,
        responsavelId: p.ator.usuarioId,
        chaveIdempotencia: chaveDecisao({
          propostaId: p.propostaId,
          decisao: "REJEITAR",
          responsavelId: p.ator.usuarioId,
          rodada,
        }),
      },
    })
  })

  await auditar(prisma, {
    acao: ACOES_AUDITORIA.PROPOSTA_REJEITADA,
    entidade: "PropostaReconciliacao",
    entidadeId: p.propostaId,
    descricao: `Proposta ${proposta.tipo} rejeitada.`,
    detalhes: { motivo: p.motivo, falsoPositivo: !!p.falsoPositivo },
    usuarioId: p.ator.usuarioId,
  })

  await registrarMetricas(
    prisma,
    [
      { chave: METRICAS.PROPOSTAS_REJEITADAS, escopo: `usuario:${p.ator.usuarioId ?? 0}`, valor: 1 },
      ...(p.falsoPositivo
        ? [{ chave: METRICAS.FALSOS_POSITIVOS, escopo: `regra:${proposta.tipo}`, valor: 1 }]
        : []),
    ],
    new Date(),
  )

  return { ok: true, propostaId: p.propostaId, mensagem: "Proposta rejeitada e decisão registrada." }
}

export async function adiarProposta(p: {
  propostaId: number
  ator: AtorAplicacao
  motivo: string
}): Promise<ResultadoDecisao> {
  if (!p.motivo?.trim()) {
    return { ok: false, codigo: "MOTIVO_OBRIGATORIO", mensagem: "Adiar exige motivo escrito." }
  }
  const proposta = await prisma.propostaReconciliacao.findUnique({
    where: { id: p.propostaId },
    select: { tipo: true, criticidade: true, status: true },
  })
  if (!proposta) return { ok: false, codigo: "NAO_ENCONTRADA", mensagem: "Proposta não encontrada." }
  if (proposta.status !== "PENDENTE") {
    return { ok: false, codigo: "STATUS_INVALIDO", mensagem: `Só proposta PENDENTE pode ser adiada (atual: ${proposta.status}).` }
  }
  const permissao = permissaoDaProposta(proposta.tipo, proposta.criticidade)
  if (!temPermissao(p.ator, "registral.revisar") && !temPermissao(p.ator, permissao)) {
    return { ok: false, codigo: "SEM_PERMISSAO", mensagem: "Adiar exige permissão de revisão." }
  }

  const rodada = await prisma.decisaoRevisaoRegistral.count({ where: { propostaId: p.propostaId } })
  await prisma.$transaction(async (tx) => {
    await tx.propostaReconciliacao.update({
      where: { id: p.propostaId },
      data: { status: "ADIADA", decididoPorId: p.ator.usuarioId, decididoEm: new Date(), decisaoNota: p.motivo.slice(0, 500) },
    })
    await tx.decisaoRevisaoRegistral.create({
      data: {
        propostaId: p.propostaId,
        decisao: "ADIAR",
        motivo: p.motivo.slice(0, 500),
        permissao: "registral.revisar",
        responsavelId: p.ator.usuarioId,
        chaveIdempotencia: chaveDecisao({ propostaId: p.propostaId, decisao: "ADIAR", responsavelId: p.ator.usuarioId, rodada }),
      },
    })
  })
  await auditar(prisma, {
    acao: ACOES_AUDITORIA.PROPOSTA_ADIADA,
    entidade: "PropostaReconciliacao",
    entidadeId: p.propostaId,
    descricao: "Proposta adiada.",
    detalhes: { motivo: p.motivo },
    usuarioId: p.ator.usuarioId,
  })
  return { ok: true, propostaId: p.propostaId, mensagem: "Proposta adiada." }
}

/**
 * REVERSÃO de uma proposta aplicada. Transacional e conservadora:
 *   · restaura campos de Pessoa a partir do snapshot da versão ANTES;
 *   · desativa os fatos criados/atualizados pela aplicação (histórico fica);
 *   · desativa aliases acrescentados;
 *   · NÃO exclui pessoa (proibido) — devolve pendência explícita;
 *   · cria versão nova e registra a decisão.
 */
export async function reverterProposta(p: {
  propostaId: number
  ator: AtorAplicacao
  motivo: string
}): Promise<ResultadoDecisao> {
  if (!p.motivo?.trim()) {
    return { ok: false, codigo: "MOTIVO_OBRIGATORIO", mensagem: "Reverter exige motivo escrito." }
  }
  if (!temPermissao(p.ator, "registral.reverter")) {
    return { ok: false, codigo: "SEM_PERMISSAO", mensagem: "Reverter exige a permissão registral.reverter." }
  }

  const proposta = await prisma.propostaReconciliacao.findUnique({
    where: { id: p.propostaId },
    select: {
      id: true,
      processoId: true,
      arvoreId: true,
      tipo: true,
      status: true,
      versaoArvoreAntes: true,
      correlationId: true,
    },
  })
  if (!proposta) return { ok: false, codigo: "NAO_ENCONTRADA", mensagem: "Proposta não encontrada." }
  if (proposta.status !== "APLICADA") {
    return { ok: false, codigo: "STATUS_INVALIDO", mensagem: `Só proposta APLICADA pode ser revertida (atual: ${proposta.status}).` }
  }
  if (proposta.arvoreId == null || proposta.versaoArvoreAntes == null) {
    return {
      ok: false,
      codigo: "SEM_VERSAO_ANTERIOR",
      mensagem: "Não há versão anterior registrada: reverter sem alvo conhecido seria adivinhar.",
    }
  }

  const plano = await planoDeReversao(prisma, proposta.arvoreId, proposta.processoId, proposta.versaoArvoreAntes)
  if (plano.erro) return { ok: false, codigo: "PLANO_INVALIDO", mensagem: plano.erro }

  const rodada = await prisma.decisaoRevisaoRegistral.count({ where: { propostaId: p.propostaId } })

  const aplicadas: string[] = []
  await prisma.$transaction(async (tx) => {
    for (const op of plano.operacoes) {
      switch (op.acao) {
        case "RESTAURAR_CAMPO": {
          const pessoaId = Number(op.id)
          if (!Number.isFinite(pessoaId) || !op.campo) break
          const dados = montarRestauracao(op.campo, op.valor)
          if (dados) {
            await tx.pessoa.update({ where: { id: pessoaId }, data: dados })
            aplicadas.push(op.descricao)
          }
          break
        }
        case "DESATIVAR_FATO": {
          const [sujeito, campo] = String(op.id).split("|")
          const pessoaId = Number(sujeito.replace(/^u/, ""))
          if (!Number.isFinite(pessoaId) || !campo) break
          await tx.fatoRegistral.updateMany({
            where: { pessoaId, campo: campo as Prisma.EnumCampoRegistralFilter["equals"], ativo: true },
            data: { ativo: false, estado: "SUBSTITUIDO_COM_HISTORICO" },
          })
          aplicadas.push(op.descricao)
          break
        }
        case "REATIVAR_FATO": {
          const [sujeito, campo] = String(op.id).split("|")
          const pessoaId = Number(sujeito.replace(/^u/, ""))
          if (!Number.isFinite(pessoaId) || !campo) break
          const anterior = await tx.fatoRegistral.findFirst({
            where: { pessoaId, campo: campo as Prisma.EnumCampoRegistralFilter["equals"], ativo: false },
            orderBy: { versao: "desc" },
            select: { id: true },
          })
          if (anterior) {
            await tx.fatoRegistral.updateMany({
              where: { pessoaId, campo: campo as Prisma.EnumCampoRegistralFilter["equals"], ativo: true },
              data: { ativo: false, estado: "SUBSTITUIDO_COM_HISTORICO" },
            })
            await tx.fatoRegistral.update({
              where: { id: anterior.id },
              data: { ativo: true, estado: "EM_REVISAO", confianca: "CONTESTADO" },
            })
            aplicadas.push(op.descricao)
          }
          break
        }
        case "DESATIVAR_ALIAS": {
          const pessoaId = Number(op.id)
          if (!Number.isFinite(pessoaId) || !op.valor) break
          const partes = op.valor.trim().split(/\s+/)
          await tx.nomePessoa.updateMany({
            where: {
              pessoaId,
              nome: partes[0],
              sobrenome: partes.slice(1).join(" ") || null,
              principal: false,
              ativo: true,
            },
            data: { ativo: false },
          })
          aplicadas.push(op.descricao)
          break
        }
        case "REMOVER_UNIAO":
        case "RESTAURAR_UNIAO":
          // União criada/removida por proposta ainda não é escrita por este motor
          // (não há tipo de proposta que crie União). Registrar como pendência é
          // o correto: inventar a operação seria alterar dado sem origem.
          plano.impossivel.push(op.descricao)
          break
      }
    }

    await tx.propostaReconciliacao.update({
      where: { id: p.propostaId },
      data: {
        status: "REVERTIDA",
        revertidoEm: new Date(),
        revertidaPorId: p.ator.usuarioId,
        decisaoNota: p.motivo.slice(0, 500),
      },
    })

    await tx.decisaoRevisaoRegistral.create({
      data: {
        propostaId: p.propostaId,
        decisao: "REVERTER",
        motivo: p.motivo.slice(0, 500),
        permissao: "registral.reverter",
        responsavelId: p.ator.usuarioId,
        correlationId: proposta.correlationId,
        chaveIdempotencia: chaveDecisao({
          propostaId: p.propostaId,
          decisao: "REVERTER",
          responsavelId: p.ator.usuarioId,
          rodada,
        }),
      },
    })

    await criarVersao(tx, {
      arvoreId: proposta.arvoreId as number,
      processoId: proposta.processoId,
      motivo: `Reversão da proposta #${p.propostaId} (${proposta.tipo})`,
      propostaId: p.propostaId,
      correlationId: proposta.correlationId,
      criadoPorId: p.ator.usuarioId,
    })
  })

  await auditar(prisma, {
    acao: ACOES_AUDITORIA.PROPOSTA_REVERTIDA,
    entidade: "PropostaReconciliacao",
    entidadeId: p.propostaId,
    descricao: `Proposta ${proposta.tipo} revertida à versão ${proposta.versaoArvoreAntes}.`,
    detalhes: { motivo: p.motivo, operacoesAplicadas: aplicadas, pendenciasHumanas: plano.impossivel },
    usuarioId: p.ator.usuarioId,
    correlationId: proposta.correlationId,
  })
  await registrarMetricas(
    prisma,
    [{ chave: METRICAS.ALTERACOES_REVERTIDAS, escopo: `processo:${proposta.processoId}`, valor: 1 }],
    new Date(),
  )

  return {
    ok: true,
    propostaId: p.propostaId,
    mensagem:
      plano.impossivel.length > 0
        ? `Reversão aplicada com ${plano.impossivel.length} pendência(s) que exigem ação humana (nada foi excluído).`
        : "Reversão aplicada e versionada.",
    detalhe: { aplicadas, pendencias: plano.impossivel },
  }
}

const COLUNAS_RESTAURAVEIS: Record<string, keyof Prisma.PessoaUncheckedUpdateInput> = {
  nome: "nome",
  sobrenome: "sobrenome",
  sexo: "sexo",
  dataNasc: "data_nasc",
  dataObito: "data_obito",
  localNasc: "local_nasc",
  paisNasc: "pais_nasc",
  paiId: "paiId",
  maeId: "maeId",
  requerente: "requerente",
  linhaReta: "linhaReta",
}

function montarRestauracao(
  campo: string,
  valor: string | null,
): Prisma.PessoaUncheckedUpdateInput | null {
  const coluna = COLUNAS_RESTAURAVEIS[campo]
  if (!coluna) return null
  if (coluna === "data_nasc" || coluna === "data_obito") {
    return {
      [coluna]: valor ? new Date(`${valor.slice(0, 10)}T12:00:00.000Z`) : null,
    } as Prisma.PessoaUncheckedUpdateInput
  }
  if (coluna === "paiId" || coluna === "maeId") {
    const n = valor == null ? null : Number(valor)
    return {
      [coluna]: n != null && Number.isFinite(n) && n > 0 ? n : null,
    } as Prisma.PessoaUncheckedUpdateInput
  }
  if (coluna === "linhaReta") return { linhaReta: valor === "true" }
  return { [coluna]: valor } as Prisma.PessoaUncheckedUpdateInput
}

/** Resolve (ou descarta) um conflito registral. Append-only. */
export async function decidirConflito(p: {
  conflitoId: number
  ator: AtorAplicacao
  decisao: "RESOLVER_CONFLITO" | "DESCARTAR_CONFLITO"
  motivo: string
}): Promise<ResultadoDecisao> {
  if (!p.motivo?.trim()) {
    return { ok: false, codigo: "MOTIVO_OBRIGATORIO", mensagem: "Decidir conflito exige motivo escrito." }
  }
  if (!temPermissao(p.ator, "registral.revisar")) {
    return { ok: false, codigo: "SEM_PERMISSAO", mensagem: "Exige a permissão registral.revisar." }
  }
  const conflito = await prisma.conflitoRegistral.findUnique({
    where: { id: p.conflitoId },
    select: { id: true, codigo: true, status: true, severidade: true },
  })
  if (!conflito) return { ok: false, codigo: "NAO_ENCONTRADO", mensagem: "Conflito não encontrado." }
  if (conflito.status === "RESOLVIDO" || conflito.status === "DESCARTADO") {
    return { ok: false, codigo: "JA_DECIDIDO", mensagem: `Conflito já está ${conflito.status}.` }
  }
  // Conflito CRÍTICO não pode ser simplesmente descartado: descartar sem resolver
  // deixaria a árvore afirmando algo impossível.
  if (p.decisao === "DESCARTAR_CONFLITO" && conflito.severidade === "CRITICO") {
    if (!temPermissao(p.ator, "registral.administrar_regras")) {
      return {
        ok: false,
        codigo: "DESCARTE_DE_CRITICO",
        mensagem:
          "Conflito crítico só pode ser descartado por quem administra as regras registrais — e o motivo fica registrado.",
      }
    }
  }

  const rodada = await prisma.decisaoRevisaoRegistral.count({ where: { conflitoId: p.conflitoId } })
  await prisma.$transaction(async (tx) => {
    await tx.conflitoRegistral.update({
      where: { id: p.conflitoId },
      data: {
        status: p.decisao === "RESOLVER_CONFLITO" ? "RESOLVIDO" : "DESCARTADO",
        resolvidoPorId: p.ator.usuarioId,
        resolvidoEm: new Date(),
        resolucaoNota: p.motivo.slice(0, 500),
      },
    })
    await tx.decisaoRevisaoRegistral.create({
      data: {
        conflitoId: p.conflitoId,
        decisao: p.decisao,
        motivo: p.motivo.slice(0, 500),
        permissao: "registral.revisar",
        responsavelId: p.ator.usuarioId,
        chaveIdempotencia: chaveDecisao({
          conflitoId: p.conflitoId,
          decisao: p.decisao,
          responsavelId: p.ator.usuarioId,
          rodada,
        }),
      },
    })
  })

  await auditar(prisma, {
    acao: ACOES_AUDITORIA.CONFLITO_RESOLVIDO,
    entidade: "ConflitoRegistral",
    entidadeId: p.conflitoId,
    descricao: `Conflito ${conflito.codigo} ${p.decisao === "RESOLVER_CONFLITO" ? "resolvido" : "descartado"}.`,
    detalhes: { motivo: p.motivo, severidade: conflito.severidade },
    usuarioId: p.ator.usuarioId,
  })

  return { ok: true, conflitoId: p.conflitoId, mensagem: "Decisão registrada." }
}
