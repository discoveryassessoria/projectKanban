// src/services/coleta/coleta-conferencia.ts
// ============================================================================
// PRÉ-CADASTRO E CONFERÊNCIA — o lado do administrador (docs/coleta-de-dados-mandato.md).
//
//   listarPreCadastro   leitura, só consulta (nada entra no cadastro de clientes).
//   conferirColeta      o administrador decide quem entra; os confirmados viram
//                       Requerente/Contratante vinculados ao processo; o link encerra.
//   concluirAnexos      copia os arquivos dos confirmados para os anexos do cliente.
//
// O QUE ESTA PORTA NÃO FAZ (decisão de produto): não cria `Pessoa`, não chama
// `vincularRequerente`, não toca a árvore, não gera necessidade/tarefa. Cadastro no
// processo ≠ dentro da árvore. A regra que recusa NOME idêntico no cadastro manual
// não se aplica aqui (nome igual com CPF diferente só avisa); CPF igual REAPROVEITA.
// ============================================================================

import { incluirNoProcesso } from "@/src/services/processo-requerentes"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { mascararCpf } from "@/src/lib/cpf"
import {
  CATEGORIA_ANEXO_DO_TIPO, papelValido,
  type DadosColeta, type PapelColeta, type TipoArquivoColeta,
} from "@/src/lib/coleta/campos"
import { copiarParaAnexoDeCliente, apagarObjetoColeta } from "./storage-coleta"
import { linkAtivoDoProcesso } from "./coleta-link"

// ── LEITURA ─────────────────────────────────────────────────────────────────

export interface ClienteRef { id: number; nome: string; publicCode: string | null }

export interface EnvioParaConferencia {
  id: number
  status: string
  papelDeclarado: PapelColeta
  reenvios: number
  criadoEm: Date
  atualizadoEm: Date
  dados: DadosColeta | null
  arquivos: Array<{ id: number; tipo: TipoArquivoColeta; nome: string; tamanho: number; mime: string }>
  semIdentidade: boolean
  semComprovante: boolean
  /** CPF igual: a conferência REAPROVEITA estes cadastros (um por papel). */
  mesmoCpf: { requerente: ClienteRef | null; contratante: ClienteRef | null }
  /** Nome igual com CPF diferente: só aviso. */
  mesmoNome: Array<ClienteRef & { tipo: "REQUERENTE" | "CONTRATANTE" }>
}

export interface PreCadastro {
  link: { id: number; codigo: string; criadoEm: Date } | null
  pendentes: number
  envios: EnvioParaConferencia[]
}

const variantesDoCpf = (cpf: string) => [cpf, mascararCpf(cpf)]

export async function listarPreCadastro(processoId: number): Promise<PreCadastro> {
  const ativo = await linkAtivoDoProcesso(processoId)
  const envios = await prisma.coletaEnvio.findMany({
    where: { link: { processoId }, status: "PENDENTE" },
    orderBy: { id: "asc" },
    include: { arquivos: { orderBy: { id: "asc" } } },
  })

  const saida: EnvioParaConferencia[] = []
  for (const e of envios) {
    const dados = (e.dados ?? null) as unknown as DadosColeta | null
    const cpf = e.cpf ?? dados?.cpf ?? ""
    const [req, con] = cpf
      ? await Promise.all([
          prisma.requerente.findFirst({ where: { cpf: { in: variantesDoCpf(cpf) } }, select: { id: true, nome: true, publicCode: true } }),
          prisma.contratante.findFirst({ where: { cpf: { in: variantesDoCpf(cpf) } }, select: { id: true, nome: true, publicCode: true } }),
        ])
      : [null, null]
    const mesmoNome: EnvioParaConferencia["mesmoNome"] = []
    if (dados?.nome) {
      const cpfs = variantesDoCpf(cpf)
      const [rs, cs] = await Promise.all([
        prisma.requerente.findMany({ where: { nome: { equals: dados.nome, mode: "insensitive" }, NOT: { cpf: { in: cpfs } } }, select: { id: true, nome: true, publicCode: true }, take: 5 }),
        prisma.contratante.findMany({ where: { nome: { equals: dados.nome, mode: "insensitive" }, NOT: { cpf: { in: cpfs } } }, select: { id: true, nome: true, publicCode: true }, take: 5 }),
      ])
      for (const r of rs) mesmoNome.push({ ...r, tipo: "REQUERENTE" })
      for (const c of cs) mesmoNome.push({ ...c, tipo: "CONTRATANTE" })
    }
    saida.push({
      id: e.id,
      status: e.status,
      papelDeclarado: (papelValido(e.papel) ? e.papel : "REQUERENTE") as PapelColeta,
      reenvios: e.reenvios,
      criadoEm: e.criadoEm,
      atualizadoEm: e.atualizadoEm,
      dados,
      arquivos: e.arquivos.map((a) => ({ id: a.id, tipo: a.tipo as TipoArquivoColeta, nome: a.nome, tamanho: a.tamanho, mime: a.mime })),
      semIdentidade: !e.arquivos.some((a) => a.tipo === "IDENTIDADE"),
      semComprovante: !e.arquivos.some((a) => a.tipo === "COMPROVANTE_ENDERECO"),
      mesmoCpf: { requerente: req, contratante: con },
      mesmoNome,
    })
  }
  return {
    link: ativo ? { id: ativo.id, codigo: ativo.codigo, criadoEm: ativo.criadoEm } : null,
    pendentes: saida.length,
    envios: saida,
  }
}

// ── CONFERÊNCIA ─────────────────────────────────────────────────────────────

export interface DecisaoConferencia { envioId: number; acao: "CONFIRMAR" | "DESCARTAR"; papel?: PapelColeta }

export type ResultadoConferencia =
  | {
      ok: true
      confirmados: Array<{ envioId: number; requerenteId: number | null; contratanteId: number | null; reaproveitou: { requerente: boolean; contratante: boolean } }>
      descartados: number
      anexos: { copiados: number; falharam: number }
    }
  | { ok: false; code: "DECISAO_INVALIDA" | "DECISAO_INCOMPLETA" | "CONFLITO"; message: string }

function dadosParaCadastro(d: DadosColeta) {
  return {
    nome: d.nome,
    cpf: d.cpf, // sem máscara (padrão novo, igual às rotas de cadastro)
    rg: d.rg,
    dataNascimento: d.dataNascimento ? new Date(`${d.dataNascimento}T00:00:00Z`) : null,
    sexo: d.sexo,
    estadoCivil: d.estadoCivil,
    nacionalidade: d.nacionalidade,
    telefone: d.telefone,
    email: d.email,
    pais: d.pais,
    endereco: d.endereco,
    numero: d.numero,
    complemento: d.complemento,
    bairro: d.bairro,
    cidade: d.cidade,
    estado: d.estado,
    cep: d.cep,
  }
}

type Tx = Prisma.TransactionClient

async function garantirRequerente(tx: Tx, processoId: number, d: DadosColeta): Promise<{ id: number; reaproveitou: boolean }> {
  const existente = await tx.requerente.findFirst({ where: { cpf: { in: variantesDoCpf(d.cpf) } }, select: { id: true } })
  const id = existente ? existente.id : (await tx.requerente.create({ data: dadosParaCadastro(d), select: { id: true } })).id
  await incluirNoProcesso(tx, processoId, [id]) // cria o vínculo que falta ou reativa o que tinha saído — pelo dono único
  return { id, reaproveitou: Boolean(existente) }
}

async function garantirContratante(tx: Tx, processoId: number, d: DadosColeta): Promise<{ id: number; reaproveitou: boolean }> {
  const existente = await tx.contratante.findFirst({ where: { cpf: { in: variantesDoCpf(d.cpf) } }, select: { id: true } })
  const id = existente ? existente.id : (await tx.contratante.create({ data: dadosParaCadastro(d), select: { id: true } })).id
  await tx.processoContratante.createMany({ data: [{ processoId, contratanteId: id }], skipDuplicates: true })
  return { id, reaproveitou: Boolean(existente) }
}

export async function conferirColeta(processoId: number, decisoes: DecisaoConferencia[], autorId: number | null): Promise<ResultadoConferencia> {
  const pendentes = await prisma.coletaEnvio.findMany({ where: { link: { processoId }, status: "PENDENTE" }, select: { id: true, dados: true, cpf: true } })
  const idsPendentes = new Set(pendentes.map((p) => p.id))

  const porId = new Map<number, DecisaoConferencia>()
  for (const d of decisoes) {
    if (!d || !Number.isInteger(d.envioId) || (d.acao !== "CONFIRMAR" && d.acao !== "DESCARTAR") || porId.has(d.envioId)) {
      return { ok: false, code: "DECISAO_INVALIDA", message: "Decisão inválida." }
    }
    if (d.acao === "CONFIRMAR" && !papelValido(d.papel)) {
      return { ok: false, code: "DECISAO_INVALIDA", message: "Escolha o papel (requerente, contratante ou os dois) de quem for confirmado." }
    }
    if (!idsPendentes.has(d.envioId)) return { ok: false, code: "DECISAO_INVALIDA", message: "Há decisão para um envio que não está pendente neste processo." }
    porId.set(d.envioId, d)
  }
  if (porId.size !== idsPendentes.size) {
    return { ok: false, code: "DECISAO_INCOMPLETA", message: "Decida todos os envios: confirmar ou descartar." }
  }

  const agora = new Date()
  const confirmados: Array<{ envioId: number; requerenteId: number | null; contratanteId: number | null; reaproveitou: { requerente: boolean; contratante: boolean } }> = []
  let descartados = 0

  try {
    await prisma.$transaction(async (tx) => {
      for (const p of pendentes) {
        const dec = porId.get(p.id)!
        // Guarda de concorrência: só decide quem ainda está pendente.
        if (dec.acao === "DESCARTAR") {
          const r = await tx.coletaEnvio.updateMany({
            where: { id: p.id, status: "PENDENTE" },
            data: { status: "DESCARTADO", decididoEm: agora, decididoPorId: autorId },
          })
          if (r.count !== 1) throw new Error("CONFLITO")
          descartados++
          await tx.logAuditoria.create({
            data: { acao: "DESCARTAR", entidade: "COLETA_ENVIO", entidadeId: p.id, usuarioId: autorId, descricao: `Pré-cadastro descartado na conferência do processo ${processoId}.`, detalhes: { processoId } },
          })
          continue
        }

        const d = p.dados as unknown as DadosColeta
        const papel = dec.papel as PapelColeta
        const req = papel === "REQUERENTE" || papel === "AMBOS" ? await garantirRequerente(tx, processoId, d) : null
        const con = papel === "CONTRATANTE" || papel === "AMBOS" ? await garantirContratante(tx, processoId, d) : null
        const r = await tx.coletaEnvio.updateMany({
          where: { id: p.id, status: "PENDENTE" },
          data: {
            status: "CONFIRMADO", decididoEm: agora, decididoPorId: autorId, papelConfirmado: papel,
            requerenteId: req?.id ?? null, contratanteId: con?.id ?? null,
          },
        })
        if (r.count !== 1) throw new Error("CONFLITO")
        confirmados.push({
          envioId: p.id, requerenteId: req?.id ?? null, contratanteId: con?.id ?? null,
          reaproveitou: { requerente: Boolean(req?.reaproveitou), contratante: Boolean(con?.reaproveitou) },
        })
        await tx.logAuditoria.create({
          data: {
            acao: "CONFIRMAR", entidade: "COLETA_ENVIO", entidadeId: p.id, usuarioId: autorId,
            descricao: `Pré-cadastro confirmado como ${papel.toLowerCase()} no processo ${processoId}.`,
            detalhes: { processoId, papel, requerenteId: req?.id ?? null, contratanteId: con?.id ?? null, reaproveitou: { requerente: Boolean(req?.reaproveitou), contratante: Boolean(con?.reaproveitou) } },
          },
        })
      }
      // A coleta acabou: o link encerra com a conferência.
      await tx.coletaLink.updateMany({
        where: { processoId, encerradoEm: null },
        data: { encerradoEm: agora, motivoEncerramento: "CONFERENCIA", encerradoPorId: autorId },
      })
    }, { maxWait: 20000, timeout: 60000 })
  } catch (e) {
    if (e instanceof Error && e.message === "CONFLITO") {
      return { ok: false, code: "CONFLITO", message: "Outra pessoa mexeu nestes envios agora. Recarregue a lista." }
    }
    throw e
  }

  const anexos = await concluirAnexos(processoId)
  return { ok: true, confirmados, descartados, anexos }
}

// ── ANEXOS (pós-commit, idempotente) ────────────────────────────────────────

/**
 * Copia os arquivos dos envios CONFIRMADOS para os anexos do cliente (DENTRO do bucket privado, guardando só a chave — ver
 * `copiarParaAnexoDeCliente`) e apaga a cópia da coleta. Cada
 * `ColetaArquivo` que sobra é um arquivo ainda não migrado, então repetir é seguro.
 */
export async function concluirAnexos(processoId: number): Promise<{ copiados: number; falharam: number }> {
  const envios = await prisma.coletaEnvio.findMany({
    where: { link: { processoId }, status: "CONFIRMADO", arquivos: { some: {} } },
    include: { arquivos: true },
  })
  let copiados = 0
  let falharam = 0
  for (const e of envios) {
    for (const a of e.arquivos) {
      try {
        const alvoDoAnexo = e.requerenteId ? { dominio: "requerente" as const, id: e.requerenteId } : { dominio: "contratante" as const, id: e.contratanteId as number }
        const copia = await copiarParaAnexoDeCliente(a.chave, a.nome, alvoDoAnexo)
        const categoria = CATEGORIA_ANEXO_DO_TIPO[a.tipo as TipoArquivoColeta] ?? null
        await prisma.$transaction(async (tx) => {
          if (e.requerenteId) {
            await tx.anexoRequerente.create({ data: { nome: a.nome, nomeArquivo: a.nome, urlArquivo: copia.url, tamanho: a.tamanho, mimeType: a.mime, tipo: "Documento", requerenteId: e.requerenteId, categoria } })
          }
          if (e.contratanteId) {
            await tx.anexoContratante.create({ data: { nome: a.nome, nomeArquivo: a.nome, urlArquivo: copia.url, tamanho: a.tamanho, mimeType: a.mime, tipo: "Documento", contratanteId: e.contratanteId, categoria } })
          }
          await tx.coletaArquivo.delete({ where: { id: a.id } })
        })
        await apagarObjetoColeta(a.chave).catch(() => undefined)
        copiados++
      } catch (err) {
        falharam++
        console.error("[coleta] anexo não migrado (repetir a conferência converge):", err)
      }
    }
  }
  return { copiados, falharam }
}

/** Descarta TODOS os pendentes (botão "Seguir sem cadastrar ninguém"): uma conferência só de descartes. */
export async function descartarTodosOsPendentes(processoId: number, autorId: number | null): Promise<ResultadoConferencia> {
  const pend = await prisma.coletaEnvio.findMany({ where: { link: { processoId }, status: "PENDENTE" }, select: { id: true } })
  return conferirColeta(processoId, pend.map((p) => ({ envioId: p.id, acao: "DESCARTAR" as const })), autorId)
}
