// src/services/coleta/coleta-envio.ts
// ============================================================================
// ENVIO PÚBLICO — o que o cliente manda pelo link.
//
// NUNCA devolve dado já enviado (a página pública só recebe `{ ok }`). Um envio por
// CPF por link: reenviar o mesmo CPF com o link ativo ATUALIZA o pendente (conta o
// reenvio; arquivos anteriores ficam). Envio já decidido (confirmado/descartado) não
// é alterado — responde igual, sem revelar nada.
// ============================================================================

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  CONSENTIMENTO_VERSAO, MAX_ARQUIVOS_POR_TIPO, MAX_BYTES_ARQUIVO_COLETA, MIMES_ARQUIVO_COLETA,
  papelValido, tipoArquivoValido, validarDadosColeta,
  type ErrosColeta, type PapelColeta, type TipoArquivoColeta,
} from "@/src/lib/coleta/campos"
import { conferirObjetoColeta, chaveDoLink } from "./storage-coleta"
import { resolverLinkPublico } from "./coleta-link"

/** Envios por IP por hora (freio no banco, vale entre instâncias). */
export const MAX_ENVIOS_POR_IP_HORA = 30
/** Arquivos por tipo por envio, somando reenvios (os antigos não são apagados). */
const MAX_TOTAL_POR_TIPO = MAX_ARQUIVOS_POR_TIPO * 2

export interface ArquivoDeclarado { tipo: TipoArquivoColeta; chave: string; nome: string; tamanho: number; mime: string }

export type ResultadoEnvio =
  | { ok: true }
  | { ok: false; code: "LINK_INDISPONIVEL" | "LIMITE" | "CAMPOS" | "CONSENTIMENTO" | "ARQUIVO"; message: string; erros?: ErrosColeta }

const MSG_LINK = "Este link não está mais disponível. Fale com a Discovery para receber um novo."

async function contarEnviosRecentesDoIp(ipHash: string): Promise<number> {
  return prisma.coletaEnvio.count({ where: { ipHash, atualizadoEm: { gt: new Date(Date.now() - 60 * 60 * 1000) } } })
}

export function validarArquivosDeclarados(linkId: number, bruto: unknown): { ok: true; arquivos: ArquivoDeclarado[] } | { ok: false; message: string } {
  if (bruto == null) return { ok: true, arquivos: [] }
  if (!Array.isArray(bruto)) return { ok: false, message: "Arquivos inválidos." }
  const arquivos: ArquivoDeclarado[] = []
  const porTipo = new Map<string, number>()
  for (const a of bruto as Array<Record<string, unknown>>) {
    if (!a || !tipoArquivoValido(a.tipo)) return { ok: false, message: "Tipo de documento inválido." }
    const tamanho = Number(a.tamanho)
    const mime = String(a.mime ?? "")
    const chave = String(a.chave ?? "")
    if (!chaveDoLink(linkId, chave)) return { ok: false, message: "Arquivo inválido." }
    if (!Number.isInteger(tamanho) || tamanho <= 0 || tamanho > MAX_BYTES_ARQUIVO_COLETA) return { ok: false, message: "Arquivo grande demais (máximo 10 MB)." }
    if (!MIMES_ARQUIVO_COLETA.has(mime)) return { ok: false, message: "Envie imagem (JPG, PNG, WEBP) ou PDF." }
    const n = (porTipo.get(a.tipo) ?? 0) + 1
    if (n > MAX_ARQUIVOS_POR_TIPO) return { ok: false, message: `Envie no máximo ${MAX_ARQUIVOS_POR_TIPO} arquivos por tipo de documento.` }
    porTipo.set(a.tipo, n)
    arquivos.push({ tipo: a.tipo, chave, nome: String(a.nome ?? "arquivo").slice(0, 200), tamanho, mime })
  }
  return { ok: true, arquivos }
}

export async function registrarEnvioPublico(args: { codigo: string; corpo: Record<string, unknown>; ipHash: string }): Promise<ResultadoEnvio> {
  const resolvido = await resolverLinkPublico(args.codigo)
  if (!resolvido) return { ok: false, code: "LINK_INDISPONIVEL", message: MSG_LINK }
  const { link } = resolvido

  if ((await contarEnviosRecentesDoIp(args.ipHash)) >= MAX_ENVIOS_POR_IP_HORA) {
    return { ok: false, code: "LIMITE", message: "Muitas tentativas em pouco tempo. Tente de novo mais tarde." }
  }

  if (args.corpo.consentimento !== true) {
    return { ok: false, code: "CONSENTIMENTO", message: "É preciso concordar com o uso dos dados para enviar." }
  }
  if (!papelValido(args.corpo.papel)) {
    return { ok: false, code: "CAMPOS", message: "Informe se a pessoa é requerente, contratante ou os dois.", erros: { papel: "Escolha uma opção." } }
  }
  const papel: PapelColeta = args.corpo.papel

  const v = validarDadosColeta((args.corpo.dados ?? {}) as Record<string, unknown>)
  if (!v.ok) return { ok: false, code: "CAMPOS", message: "Confira os campos destacados.", erros: v.erros }

  const decl = validarArquivosDeclarados(link.id, args.corpo.arquivos)
  if (!decl.ok) return { ok: false, code: "ARQUIVO", message: decl.message }
  for (const a of decl.arquivos) {
    if (!(await conferirObjetoColeta(a.chave, a.tamanho, a.mime))) {
      return { ok: false, code: "ARQUIVO", message: `Não foi possível confirmar o arquivo "${a.nome}". Envie de novo.` }
    }
  }

  const dados = v.dados
  const agora = new Date()
  const resultado = await prisma.$transaction(async (tx) => {
    const existente = await tx.coletaEnvio.findUnique({
      where: { linkId_cpf: { linkId: link.id, cpf: dados.cpf } },
      include: { arquivos: { select: { tipo: true } } },
    })
    // Já decidido: não altera nada e não revela (responde como sucesso).
    if (existente && existente.status !== "PENDENTE") return "IGNORADO" as const

    if (existente) {
      for (const tipo of ["IDENTIDADE", "COMPROVANTE_ENDERECO"] as const) {
        const ja = existente.arquivos.filter((x) => x.tipo === tipo).length
        const novos = decl.arquivos.filter((x) => x.tipo === tipo).length
        if (ja + novos > MAX_TOTAL_POR_TIPO) return "ARQUIVOS_DEMAIS" as const
      }
    }
    const envio = existente
      ? await tx.coletaEnvio.update({
          where: { id: existente.id },
          data: {
            dados: dados as unknown as Prisma.InputJsonValue, papel, consentimentoEm: agora, consentimentoVersao: CONSENTIMENTO_VERSAO,
            ipHash: args.ipHash, reenvios: { increment: 1 }, reenviadoEm: agora,
          },
        })
      : await tx.coletaEnvio.create({
          data: {
            linkId: link.id, cpf: dados.cpf, dados: dados as unknown as Prisma.InputJsonValue, papel,
            consentimentoEm: agora, consentimentoVersao: CONSENTIMENTO_VERSAO, ipHash: args.ipHash,
          },
        })
    if (decl.arquivos.length > 0) {
      await tx.coletaArquivo.createMany({
        data: decl.arquivos.map((a) => ({ envioId: envio.id, tipo: a.tipo, chave: a.chave, nome: a.nome, tamanho: a.tamanho, mime: a.mime })),
        skipDuplicates: true,
      })
    }
    return "OK" as const
  })

  if (resultado === "ARQUIVOS_DEMAIS") return { ok: false, code: "ARQUIVO", message: "Limite de arquivos por documento atingido." }
  return { ok: true }
}
