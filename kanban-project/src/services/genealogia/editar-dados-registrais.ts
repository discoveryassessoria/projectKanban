// src/services/genealogia/editar-dados-registrais.ts
// ============================================================================
// EDITAR OS DADOS REGISTRAIS DE UMA CERTIDÃO, em qualquer fase (06/10/2026). Regras e textos: `src/lib/genealogia/dados-registrais-edicao.ts` (puro).
//  • Só grava no Documento. NÃO reabre o passo, NÃO muda a fase, NÃO cancela operação, NÃO reenvia nada ao cartório.
//  • Histórico do processo: antes → depois, quem e quando; motivo obrigatório se o "Localizar registro" já estava concluído; registra se o pedido ao cartório já tinha saído.
//  • Dispara a MESMA sincronização com a árvore (`sincronizarDocumento`): vazio preenche, diferente → vale o registro, com histórico e divergência resolvida.
// ============================================================================
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { notificarDocumentoAlterado } from "@/src/services/registral/gancho-documental"
import { sincronizarDocumento, type ResultadoDaSincronizacao } from "@/src/services/genealogia/sincronizar-com-registro"
import { aplicarPlanoNaArvore, aplicarSubstituicoes, mensagemDaConfirmacao, planejarConfirmacao, type DecisoesDeConfirmacao, type DivergenciaPendente } from "@/src/services/genealogia/confirmacao-arvore"
import {
  CAMPOS_EDITAVEIS, avisoDoRequerimentoEnviado, motivoValido, mostrarMudanca, mudancasDaEdicao, normalizarCampo,
  type MudancaDeCampo, type ValoresEditaveis,
} from "@/src/lib/genealogia/dados-registrais-edicao"

export const ACAO_DADOS_REGISTRAIS_EDITADOS = "DADOS_REGISTRAIS_EDITADOS"

export interface ContextoDeEdicao {
  documentoId: number
  tipo: string | null
  pessoaId: number
  pessoaNome: string
  /** O passo "Localizar registro" já foi concluído? (então a edição é correção e exige motivo) */
  passoConcluido: boolean
  /** Quando o requerimento ao cartório saiu (a solicitação mais recente), ou `null` se não saiu. */
  requerimentoEnviadoEm: string | null
  valores: Record<string, string | null>
}

const SELECT_VALORES = {
  id: true, tipo: true, pessoaId: true, data_evento: true, data_registro: true, pais_registro: true, estado_registro: true, cidade_registro: true, cartorio: true, livro: true, folha: true, termo: true,
  pessoa: { select: { nome: true, sobrenome: true, arvoreId: true } },
} as const

const valoresDe = (d: Record<string, unknown>): ValoresEditaveis => Object.fromEntries(CAMPOS_EDITAVEIS.map((c) => [c.chave, d[c.chave] as string | Date | null])) as ValoresEditaveis

export async function contextoDeEdicao(documentoId: number): Promise<ContextoDeEdicao | null> {
  const doc = await prisma.documento.findUnique({ where: { id: documentoId }, select: SELECT_VALORES })
  if (!doc) return null
  const [passo, solicitacao] = await Promise.all([
    prisma.phaseWorkflowStepInstance.findFirst({ where: { documentoId, stepKey: "localizar_registro", status: "CONCLUIDO" }, select: { id: true } }),
    prisma.solicitacaoDocumento.findFirst({ where: { documentoId }, orderBy: { id: "desc" }, select: { dataEnvio: true } }),
  ])
  return {
    documentoId, tipo: doc.tipo, pessoaId: doc.pessoaId, pessoaNome: `${doc.pessoa.nome}${doc.pessoa.sobrenome ? ` ${doc.pessoa.sobrenome}` : ""}`,
    passoConcluido: passo != null, requerimentoEnviadoEm: solicitacao?.dataEnvio.toISOString() ?? null,
    valores: Object.fromEntries(CAMPOS_EDITAVEIS.map((c) => [c.chave, normalizarCampo(c, valoresDe(doc as never)[c.chave])])),
  }
}

export type ResultadoDaEdicao =
  | { ok: true; mudancas: MudancaDeCampo[]; sincronizacao: ResultadoDaSincronizacao; aviso: string | null }
  | { ok: false; codigo: "NAO_ENCONTRADO" | "SEM_MUDANCA" | "MOTIVO_OBRIGATORIO" | "REQUERIMENTO_JA_ENVIADO" | "INVALIDO"; mensagem: string; aviso?: string | null }
  | { ok: false; codigo: "CONFIRMACAO_ARVORE"; mensagem: string; divergencias: DivergenciaPendente[] }

export async function editarDadosRegistrais(args: {
  documentoId: number
  autorId: number | null
  valores: ValoresEditaveis
  motivo?: string | null
  /** O usuário viu o aviso "o pedido ao cartório já saiu com …" e confirmou. */
  confirmouRequerimentoEnviado?: boolean
  /** Escolha explícita, por campo, quando o valor digitado difere da árvore (`confirmacao-arvore.ts`). */
  decisoes?: DecisoesDeConfirmacao
}): Promise<ResultadoDaEdicao> {
  const { documentoId, autorId } = args
  const ctx = await contextoDeEdicao(documentoId)
  if (!ctx) return { ok: false, codigo: "NAO_ENCONTRADO", mensagem: "Documento não encontrado." }
  const doc = await prisma.documento.findUnique({ where: { id: documentoId }, select: SELECT_VALORES })
  if (!doc) return { ok: false, codigo: "NAO_ENCONTRADO", mensagem: "Documento não encontrado." }

  for (const c of CAMPOS_EDITAVEIS) {
    const v = args.valores[c.chave]
    if (v === undefined) continue
    if (c.tipo === "data" && v != null && String(v).trim() !== "" && normalizarCampo(c, v) == null) return { ok: false, codigo: "INVALIDO", mensagem: `A ${c.rotulo} não é uma data válida.` }
    if (c.tipo === "texto" && typeof v === "string" && v.trim().length > c.max) return { ok: false, codigo: "INVALIDO", mensagem: `${c.rotulo}: no máximo ${c.max} caracteres.` }
  }
  const mudancas = mudancasDaEdicao(valoresDe(doc as never), args.valores)
  if (mudancas.length === 0) return { ok: false, codigo: "SEM_MUDANCA", mensagem: "Nada mudou." }
  const motivo = motivoValido(ctx.passoConcluido, args.motivo)
  if (!motivo.ok) return { ok: false, codigo: "MOTIVO_OBRIGATORIO", mensagem: motivo.mensagem }
  const aviso = avisoDoRequerimentoEnviado(ctx.requerimentoEnviadoEm, mudancas)
  if (aviso && args.confirmouRequerimentoEnviado !== true) return { ok: false, codigo: "REQUERIMENTO_JA_ENVIADO", mensagem: aviso, aviso }

  // CONFIRMAÇÃO ÁRVORE × CADASTRO: valor diferente do da árvore só grava com a escolha explícita; sem ela, recusa.
  const plano = await planejarConfirmacao({ documentoId, novos: args.valores as never, atuais: doc as never, decisoes: args.decisoes ?? {} })
  if (plano.pendentes.length > 0) {
    return { ok: false, codigo: "CONFIRMACAO_ARVORE", mensagem: mensagemDaConfirmacao(plano.pendentes), divergencias: plano.pendentes }
  }

  const dados: Record<string, Date | string | null> = {}
  for (const m of mudancas) {
    const c = CAMPOS_EDITAVEIS.find((x) => x.chave === m.chave)!
    dados[m.chave] = m.depois == null ? null : c.tipo === "data" ? new Date(`${m.depois}T00:00:00.000Z`) : m.depois
  }
  const processos = doc.pessoa.arvoreId != null ? await prisma.processo.findMany({ where: { arvoreId: doc.pessoa.arvoreId }, select: { id: true } }) : []
  const detalhes = {
    documentoId, pessoaId: doc.pessoaId, pessoaNome: ctx.pessoaNome, tipoDocumento: doc.tipo, arvoreId: doc.pessoa.arvoreId,
    mudancas: mudancas.map((m) => ({ campo: m.rotulo, chave: m.chave, antes: m.antes, depois: m.depois })),
    motivo: motivo.motivo, passoJaConcluido: ctx.passoConcluido, requerimentoJaEnviado: aviso != null, requerimentoEnviadoEm: aviso != null ? ctx.requerimentoEnviadoEm : null,
    avisoRequerimento: aviso,
  }
  Object.assign(dados, aplicarSubstituicoes({}, plano)) // «o correto é o da árvore»: a Genealogia assume o valor da árvore
  await prisma.$transaction(async (tx) => {
    await tx.documento.update({ where: { id: documentoId }, data: dados as Prisma.DocumentoUpdateInput })
    for (const p of processos.length ? processos : [{ id: null as number | null }]) {
      await tx.logAuditoria.create({
        data: {
          acao: ACAO_DADOS_REGISTRAIS_EDITADOS, entidade: p.id != null ? "Processo" : "Documento", entidadeId: p.id ?? documentoId, usuarioId: autorId,
          descricao: `Dados registrais corrigidos — ${ctx.pessoaNome}: ${mudancas.map(mostrarMudanca).join("; ")}${motivo.motivo ? ` (motivo: ${motivo.motivo})` : ""}`,
          detalhes: detalhes as Prisma.InputJsonValue,
        },
      })
    }
  })

  await aplicarPlanoNaArvore(plano, { documentoId, autorId })
  notificarDocumentoAlterado({ documentoId, motivo: "documento_alterado" }).catch((e) => console.error("[dados registrais → gancho registral]", e))
  const sincronizacao = await sincronizarDocumento(documentoId, autorId, "EDICAO_DOS_DADOS_REGISTRAIS")
  return { ok: true, mudancas, sincronizacao, aviso }
}
