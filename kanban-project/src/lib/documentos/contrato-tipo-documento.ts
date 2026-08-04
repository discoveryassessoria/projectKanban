// src/lib/documentos/contrato-tipo-documento.ts
//
// O CONTRATO DO TIPO DE DOCUMENTO na camada de rota — leitura e guard.
//
// Mora aqui, e não dentro de uma das rotas, porque POST (criar) e PUT (editar)
// precisam da MESMA regra. Se cada uma tivesse a sua, a criação e a edição
// divergiriam — e divergir sobre o que é válido é como o cadastro chega a estados
// que o contrato existe para impedir.

import { prisma } from "@/lib/prisma"
import { conferirTipoDocumento, respostaDeRecusa, type FalhaContrato } from "./contrato-documental"

/**
 * O que a tela precisa para MOSTRAR o contrato em modo leitura. Traz o workflow
 * por trás do perfil: sem ele a tela não teria como exibir versão publicada,
 * escopo e quantidade de passos — e voltaria a inventar esses dados.
 */
export const INCLUDE_CONTRATO = {
  familiaDocumental: { select: { id: true, code: true, name: true, ativo: true } },
  naturezaOperacional: {
    select: { id: true, code: true, name: true, exigeWorkflow: true, ativo: true },
  },
  perfilOperacional: {
    select: {
      id: true, code: true, name: true, ativo: true,
      escopoInstanciacao: true, exigeProcesso: true, exigePessoa: true, exigeDocumento: true,
      workflow: {
        select: {
          id: true, name: true, versao: true, active: true, phaseKey: true,
          escopoExecucao: true, exigeDocumento: true, exigePessoa: true,
          _count: { select: { passos: true } },
        },
      },
    },
  },
} as const

const temCampo = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k)
const num = (v: unknown) => (v == null || v === "" ? null : Number(v))

/**
 * Campos do contrato que a rota aceita gravar. SEMPRE por ID: nome de família,
 * de natureza ou de perfil não entram — texto não é chave estrutural.
 * Só grava o que veio no corpo; ausente significa "não mexer", não "apagar".
 */
export function dadosDoContrato(b: Record<string, unknown>): Record<string, number | null> {
  const d: Record<string, number | null> = {}
  if (temCampo(b, "familiaDocumentalId")) d.familiaDocumentalId = num(b.familiaDocumentalId)
  if (temCampo(b, "naturezaOperacionalId")) d.naturezaOperacionalId = num(b.naturezaOperacionalId)
  if (temCampo(b, "perfilOperacionalId")) d.perfilOperacionalId = num(b.perfilOperacionalId)
  return d
}

/**
 * Cobra o guard sobre o estado RESULTANTE da gravação — o que veio no corpo
 * somado ao que já está gravado. Conferir só o corpo deixaria passar a edição que
 * troca a natureza para uma que exige workflow sem mexer no perfil.
 *
 * Devolve `null` quando pode gravar; o corpo da recusa quando não.
 */
export async function conferirContratoDoTipo(
  b: Record<string, unknown>,
  idAtual: number | null,
): Promise<{ error: string; contrato: FalhaContrato[] } | null> {
  if (!temCampo(b, "naturezaOperacionalId") && !temCampo(b, "perfilOperacionalId")) return null

  const atual = idAtual
    ? await prisma.tipoDocumentoCadastro.findUnique({
        where: { id: idAtual },
        select: { naturezaOperacionalId: true, perfilOperacionalId: true },
      })
    : null

  const naturezaId = temCampo(b, "naturezaOperacionalId")
    ? num(b.naturezaOperacionalId)
    : atual?.naturezaOperacionalId ?? null
  const perfilId = temCampo(b, "perfilOperacionalId")
    ? num(b.perfilOperacionalId)
    : atual?.perfilOperacionalId ?? null

  const natureza = naturezaId
    ? await prisma.naturezaOperacionalDocumento.findUnique({
        where: { id: naturezaId },
        select: { exigeWorkflow: true },
      })
    : null

  const falhas = conferirTipoDocumento({
    naturezaExigeWorkflow: natureza?.exigeWorkflow === true,
    perfilOperacionalId: perfilId,
  })
  return falhas.length ? respostaDeRecusa(falhas) : null
}
