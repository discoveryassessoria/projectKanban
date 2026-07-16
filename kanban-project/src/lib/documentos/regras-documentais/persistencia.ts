// src/lib/documentos/regras-documentais/persistencia.ts
//
// Camada de servidor das Regras Documentais: carga, dados de apoio, validação de
// backend, auditoria e usuário. NÃO cria Documento/Necessidade/Tarefa nem toca
// runtime — só persiste a CONFIGURAÇÃO das regras (MatrizDocumental ampliada).

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { extrairUsuarioKanban } from "@/lib/kanban-auth"
import { FASES } from "@/src/lib/process-stage/fases-catalog"
import {
  type RegraInput, matrizParaRegra,
} from "./mapear"
import {
  PUBLICOS_ALVO, type PublicoAlvo, type Obrigatoriedade, type ConjuntoCondicoes,
} from "./tipos"
import { validarConjunto } from "./condicoes"

export async function usuarioIdDe(request: Request): Promise<number | null> {
  const u = await extrairUsuarioKanban(request)
  return u?.userId ?? null
}

// ---- carga ----
export async function carregarRegrasRaw() {
  return prisma.matrizDocumental.findMany({ orderBy: [{ tipoProcessoId: "asc" }, { criadoEm: "asc" }] })
}
export async function carregarRegras() {
  const rows = await carregarRegrasRaw()
  return rows.map(matrizParaRegra)
}

// ---- dados de apoio para a tela ----
export async function dadosDeApoio() {
  const [tipos, docTypes, categorias, modalidades] = await Promise.all([
    prisma.tipoProcessoNacionalidade.findMany({
      where: { ativo: true, arquivado: false },
      select: {
        id: true, name: true, countryKey: true, modalityKey: true,
        macroWorkflow: { select: { versao: true, fases: { select: { phaseKey: true, label: true, ordem: true }, orderBy: { ordem: "asc" } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true, category: true, categoriaDocumental: { select: { code: true, name: true } } }, orderBy: { name: "asc" } }),
    prisma.categoriaDocumental.findMany({ where: { ativo: true }, select: { code: true, name: true }, orderBy: { ordem: "asc" } }),
    prisma.modalidadePais.findMany({ where: { ativo: true }, select: { id: true, countryKey: true, modalityKey: true, modalityLabel: true }, orderBy: { ordem: "asc" } }),
  ])
  const tiposProcesso = tipos.map((t) => ({
    id: t.id, name: t.name, countryKey: t.countryKey, modalityKey: t.modalityKey,
    versao: t.macroWorkflow?.versao ?? null,
    fases: t.macroWorkflow?.fases ?? [],
  }))
  // catálogo canônico de fases (para faseExigencia/faseBloqueio quando o processo não tem macro)
  const fasesCatalogo = Object.values(FASES).map((f) => ({ phaseKey: f.phaseKey, label: f.label, ordem: f.ordem }))
  return { tiposProcesso, docTypes, categorias, modalidades, fasesCatalogo }
}

// mapa phaseKey → ordem (catálogo global) para detecção de conflito de fase
export function ordemFaseGlobal(): Record<string, number> {
  const m: Record<string, number> = {}
  for (const f of Object.values(FASES)) m[f.phaseKey] = f.ordem
  return m
}

// ---- validação de BACKEND (não confiar só no front) ----
export interface ErroValidacao { campo: string; mensagem: string }

export function validarRegraInput(input: RegraInput, obrigatorioProcessoEDoc = true): ErroValidacao[] {
  const erros: ErroValidacao[] = []
  if (obrigatorioProcessoEDoc) {
    if (!input.tipoProcessoId) erros.push({ campo: "tipoProcessoId", mensagem: "Selecione o tipo de processo." })
    if (!input.documentTypeCode) erros.push({ campo: "documentTypeCode", mensagem: "Selecione o tipo de documento." })
  }
  if (input.publicoAlvo && !(PUBLICOS_ALVO as readonly string[]).includes(input.publicoAlvo)) {
    erros.push({ campo: "publicoAlvo", mensagem: "Público-alvo inválido." })
  }
  if (input.obrigatoriedade && !["OBRIGATORIA", "OPCIONAL"].includes(input.obrigatoriedade)) {
    erros.push({ campo: "obrigatoriedade", mensagem: "Obrigatoriedade inválida." })
  }
  // condições estruturadas + incompatibilidades
  if (input.condicoes) {
    const probs = validarConjunto(input.condicoes)
    for (const p of probs) erros.push({ campo: "condicoes", mensagem: p.mensagem })
  }
  // validade coerente
  if (input.possuiValidade && (input.validadeDias == null || input.validadeDias <= 0)) {
    erros.push({ campo: "validadeDias", mensagem: "Informe a validade em dias (> 0) quando 'Possui validade' estiver marcado." })
  }
  // vigência coerente
  if (input.vigenciaInicio && input.vigenciaFim) {
    const ini = new Date(input.vigenciaInicio).getTime()
    const fim = new Date(input.vigenciaFim).getTime()
    if (!isNaN(ini) && !isNaN(fim) && fim < ini) erros.push({ campo: "vigenciaFim", mensagem: "Fim da vigência antes do início." })
  }
  return erros
}

export function normalizarInput(b: Record<string, unknown>): RegraInput {
  const asBool = (v: unknown) => (v === undefined ? undefined : !!v)
  const asIntN = (v: unknown) => (v === undefined || v === null || v === "" ? (v === null ? null : undefined) : Number(v))
  const asStrN = (v: unknown) => (v === undefined ? undefined : v === null || v === "" ? null : String(v))
  const cond = b.condicoes as ConjuntoCondicoes | null | undefined
  return {
    nome: asStrN(b.nome),
    descricao: asStrN(b.descricao),
    tipoProcessoId: b.tipoProcessoId !== undefined ? Number(b.tipoProcessoId) : undefined,
    modalidadeId: asIntN(b.modalidadeId) as number | null | undefined,
    paisCode: asStrN(b.paisCode),
    regiaoCode: asStrN(b.regiaoCode),
    tipoProcessoVersao: asIntN(b.tipoProcessoVersao) as number | null | undefined,
    documentTypeCode: b.documentTypeCode !== undefined ? String(b.documentTypeCode) : undefined,
    categoriaCode: asStrN(b.categoriaCode),
    obrigatoriedade: b.obrigatoriedade as Obrigatoriedade | undefined,
    publicoAlvo: b.publicoAlvo as PublicoAlvo | undefined,
    condicoes: cond === undefined ? undefined : cond,
    faseExigencia: asStrN(b.faseExigencia),
    faseBloqueio: asStrN(b.faseBloqueio),
    bloqueiaConclusaoFase: asBool(b.bloqueiaConclusaoFase),
    continuaObrigatorioNasFasesSeguintes: asBool(b.continuaObrigatorioNasFasesSeguintes),
    faseFinalExigencia: asStrN(b.faseFinalExigencia),
    obrigatorioAteFinalProcesso: asBool(b.obrigatorioAteFinalProcesso),
    possuiValidade: asBool(b.possuiValidade),
    validadeDias: asIntN(b.validadeDias) as number | null | undefined,
    exigeDataEmissao: asBool(b.exigeDataEmissao),
    renovarQuandoExpirado: asBool(b.renovarQuandoExpirado),
    antecedenciaRenovacaoDias: asIntN(b.antecedenciaRenovacaoDias) as number | null | undefined,
    prioridade: asIntN(b.prioridade) as number | undefined,
    vigenciaInicio: asStrN(b.vigenciaInicio),
    vigenciaFim: asStrN(b.vigenciaFim),
  }
}

// ---- auditoria ----
export async function auditar(
  db: Prisma.TransactionClient | typeof prisma,
  args: { acao: string; entidadeId?: number | null; descricao: string; detalhes?: unknown; usuarioId?: number | null },
) {
  await db.logAuditoria.create({
    data: {
      acao: args.acao.slice(0, 50),
      entidade: "REGRA_DOCUMENTAL",
      entidadeId: args.entidadeId ?? null,
      descricao: args.descricao.slice(0, 500),
      detalhes: (args.detalhes ?? undefined) as Prisma.InputJsonValue | undefined,
      usuarioId: args.usuarioId ?? null,
    },
  })
}

// gera um código estável novo para uma regra (grupo de versões)
export function novoCodigoRegra(tipoProcessoId: number, documentTypeCode: string): string {
  const base = `RD_${tipoProcessoId}_${documentTypeCode}`.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 44)
  // sufixo curto por tempo (rota tem Date disponível — runtime app, não sandbox)
  return `${base}_${Date.now().toString(36).toUpperCase()}`
}
