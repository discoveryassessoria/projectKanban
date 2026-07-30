// src/services/cadastro-mestre/nome-pessoa.ts
//
// MDM-5 — Serviço oficial de Nomes Alternativos (aliases).
//
// Único ponto de escrita de `NomePessoa` no Discovery. Nenhum consumidor grava
// direto na tabela: a invariante "um principal ativo por pessoa" e as regras de
// afirmação auditável só valem se houver um portão.
//
// FASE 1 (esta): a tabela existe, o serviço existe, NINGUÉM lê ainda.
// Pessoa.nome/sobrenome continuam sendo a fonte. A inversão acontece na fase 3.
//
// A lógica de decisão é PURA (`planejar*`) e testável sem banco; a persistência
// é uma casca fina em volta. É assim que as invariantes ficam cobertas por
// teste num projeto cujo único banco é produção.

import type { Prisma } from "@prisma/client"
import { chaveFonetica, normalizar } from "@/src/lib/genealogia/motor/texto"
import {
  validarAfirmacao,
  validarPromocao,
  type AfirmacaoAuditavel,
  type GrauConfianca,
  type OrigemAfirmacao,
} from "@/src/lib/cadastro-mestre/afirmacao"

export type TipoNome =
  | "REGISTRAL"
  | "NASCIMENTO"
  | "CASADA"
  | "RELIGIOSO"
  | "GRAFIA_DOCUMENTO"
  | "APORTUGUESADO"
  | "IMPORTADO"

export const ROTULO_TIPO_NOME: Record<TipoNome, string> = {
  REGISTRAL: "Nome de registro",
  NASCIMENTO: "Nome de nascimento",
  CASADA: "Nome de casada",
  RELIGIOSO: "Nome religioso",
  GRAFIA_DOCUMENTO: "Grafia em documento",
  APORTUGUESADO: "Forma aportuguesada",
  IMPORTADO: "Importado",
}

export interface EntradaNome {
  pessoaId: number
  nome: string
  sobrenome?: string | null
  tipo: TipoNome
  principal?: boolean
  afirmacao: AfirmacaoAuditavel
}

export interface NomeExistente {
  id: number
  nome: string
  sobrenome: string | null
  tipo: string
  principal: boolean
  confianca: string
  ativo: boolean
}

// ---------------------------------------------------------------- puro

/**
 * Chave de idempotência de um nome. Mesma pessoa + mesma forma + mesmo tipo =
 * mesma afirmação. Sem isso, reenviar o formulário duplica o alias e a busca
 * passa a mostrar a mesma pessoa três vezes.
 */
export function chaveIdempotenciaNome(e: {
  pessoaId: number
  nome: string
  sobrenome?: string | null
  tipo: string
}): string {
  const forma = normalizar(`${e.nome} ${e.sobrenome ?? ""}`).replace(/\s+/g, "_")
  return `nome:${e.pessoaId}:${e.tipo}:${forma}`.slice(0, 200)
}

export type ErroNome =
  | "NOME_VAZIO"
  | "AFIRMACAO_INVALIDA"
  | "PROMOCAO_INVALIDA"
  | "DUPLICADO"
  | "PRINCIPAL_INEXISTENTE"
  | "REMOVER_UNICO_PRINCIPAL"

export type Plano<T> = { ok: true; plano: T } | { ok: false; codigo: ErroNome; mensagem: string }

export interface PlanoAdicionar {
  chaveIdempotencia: string
  chaveFonetica: string
  /** Quando true, este nome vira o principal e o anterior é rebaixado. */
  tornarPrincipal: boolean
  /** Id do principal atual a rebaixar (null quando não há). */
  rebaixarId: number | null
  /** Já existe idêntico: a operação é no-op idempotente. */
  jaExiste: boolean
}

/**
 * Decide o que fazer ao adicionar um nome, sem tocar no banco.
 * A primeira forma de uma pessoa é SEMPRE principal — pessoa sem nome principal
 * quebraria a projeção de `Pessoa.nome` na fase 3.
 */
export function planejarAdicionar(
  entrada: EntradaNome,
  existentes: NomeExistente[],
): Plano<PlanoAdicionar> {
  if (!entrada.nome?.trim()) {
    return { ok: false, codigo: "NOME_VAZIO", mensagem: "Nome é obrigatório." }
  }

  const v = validarAfirmacao(entrada.afirmacao)
  if (!v.valido) {
    return { ok: false, codigo: "AFIRMACAO_INVALIDA", mensagem: v.mensagem }
  }

  const chave = chaveIdempotenciaNome(entrada)
  const ativos = existentes.filter((n) => n.ativo)
  const identico = ativos.find(
    (n) =>
      normalizar(n.nome) === normalizar(entrada.nome) &&
      normalizar(n.sobrenome ?? "") === normalizar(entrada.sobrenome ?? "") &&
      n.tipo === entrada.tipo,
  )
  if (identico) {
    return {
      ok: true,
      plano: {
        chaveIdempotencia: chave,
        chaveFonetica: chaveFonetica(entrada.sobrenome || entrada.nome),
        tornarPrincipal: false,
        rebaixarId: null,
        jaExiste: true,
      },
    }
  }

  const principalAtual = ativos.find((n) => n.principal) ?? null
  // Sem nenhum nome ativo, este vira principal por definição.
  const tornarPrincipal = entrada.principal === true || principalAtual == null

  return {
    ok: true,
    plano: {
      chaveIdempotencia: chave,
      chaveFonetica: chaveFonetica(entrada.sobrenome || entrada.nome),
      tornarPrincipal,
      rebaixarId: tornarPrincipal && principalAtual ? principalAtual.id : null,
      jaExiste: false,
    },
  }
}

export interface PlanoTrocarPrincipal {
  promoverId: number
  rebaixarId: number | null
}

export function planejarTrocarPrincipal(
  novoPrincipalId: number,
  existentes: NomeExistente[],
): Plano<PlanoTrocarPrincipal> {
  const ativos = existentes.filter((n) => n.ativo)
  const alvo = ativos.find((n) => n.id === novoPrincipalId)
  if (!alvo) {
    return {
      ok: false,
      codigo: "PRINCIPAL_INEXISTENTE",
      mensagem: "O nome escolhido não existe ou não está ativo.",
    }
  }
  const atual = ativos.find((n) => n.principal && n.id !== novoPrincipalId) ?? null
  return { ok: true, plano: { promoverId: novoPrincipalId, rebaixarId: atual?.id ?? null } }
}

export interface PlanoRemover {
  removerId: number
  /** Quem assume como principal quando o removido era o principal. */
  novoPrincipalId: number | null
}

/**
 * Remover é desativar (append-only). Remover o principal exige eleger outro na
 * mesma operação — pessoa sem principal deixa `Pessoa.nome` sem origem.
 */
export function planejarRemover(
  nomeId: number,
  existentes: NomeExistente[],
  sucessorId?: number | null,
): Plano<PlanoRemover> {
  const ativos = existentes.filter((n) => n.ativo)
  const alvo = ativos.find((n) => n.id === nomeId)
  if (!alvo) {
    return { ok: false, codigo: "PRINCIPAL_INEXISTENTE", mensagem: "Nome não encontrado." }
  }
  if (!alvo.principal) return { ok: true, plano: { removerId: nomeId, novoPrincipalId: null } }

  const candidatos = ativos.filter((n) => n.id !== nomeId)
  if (candidatos.length === 0) {
    return {
      ok: false,
      codigo: "REMOVER_UNICO_PRINCIPAL",
      mensagem: "Esta é a única forma de nome ativa: eleja outra antes de remover.",
    }
  }
  const sucessor =
    (sucessorId != null ? candidatos.find((n) => n.id === sucessorId) : null) ??
    candidatos.find((n) => n.tipo === "REGISTRAL") ??
    candidatos[0]
  return { ok: true, plano: { removerId: nomeId, novoPrincipalId: sucessor.id } }
}

export interface PlanoReafirmar {
  nomeId: number
  de: GrauConfianca
  para: GrauConfianca
}

export function planejarReafirmar(
  nomeId: number,
  novaConfianca: GrauConfianca,
  novaAfirmacao: AfirmacaoAuditavel,
  existentes: NomeExistente[],
): Plano<PlanoReafirmar> {
  const alvo = existentes.find((n) => n.id === nomeId && n.ativo)
  if (!alvo) {
    return { ok: false, codigo: "PRINCIPAL_INEXISTENTE", mensagem: "Nome não encontrado." }
  }
  const de = alvo.confianca as GrauConfianca
  const v = validarPromocao(de, novaConfianca, novaAfirmacao)
  if (!v.valido) return { ok: false, codigo: "PROMOCAO_INVALIDA", mensagem: v.mensagem }
  return { ok: true, plano: { nomeId, de, para: novaConfianca } }
}

/** Formas de busca de uma pessoa, para o índice do Cadastro Mestre. */
export function formasBuscaveis(nomes: NomeExistente[]): string[] {
  const set = new Set<string>()
  for (const n of nomes) {
    if (!n.ativo) continue
    const completo = [n.nome, n.sobrenome].filter(Boolean).join(" ")
    if (completo) set.add(completo)
  }
  return [...set]
}

// ---------------------------------------------------------------- persistência

type ClientePrisma = Prisma.TransactionClient

export async function listarNomes(tx: ClientePrisma, pessoaId: number): Promise<NomeExistente[]> {
  const linhas = await tx.nomePessoa.findMany({
    where: { pessoaId },
    select: {
      id: true,
      nome: true,
      sobrenome: true,
      tipo: true,
      principal: true,
      confianca: true,
      ativo: true,
    },
    orderBy: [{ principal: "desc" }, { id: "asc" }],
  })
  return linhas as NomeExistente[]
}

/**
 * Adiciona uma forma de nome. Idempotente por `chaveIdempotencia`.
 * Deve rodar DENTRO de uma transação do chamador — a troca de principal e a
 * inserção precisam ser atômicas, senão o índice parcial do banco rejeita.
 */
export async function adicionarNome(
  tx: ClientePrisma,
  entrada: EntradaNome,
): Promise<{ ok: true; id: number; criado: boolean } | { ok: false; codigo: ErroNome; mensagem: string }> {
  const existentes = await listarNomes(tx, entrada.pessoaId)
  const r = planejarAdicionar(entrada, existentes)
  if (!r.ok) return r

  const { plano } = r
  if (plano.jaExiste) {
    const atual = await tx.nomePessoa.findUnique({
      where: { chaveIdempotencia: plano.chaveIdempotencia },
      select: { id: true },
    })
    if (atual) return { ok: true, id: atual.id, criado: false }
  }

  // Rebaixa ANTES de inserir: o índice parcial não admite dois principais nem
  // por um instante dentro da transação.
  if (plano.rebaixarId != null) {
    await tx.nomePessoa.update({ where: { id: plano.rebaixarId }, data: { principal: false } })
  }

  const criado = await tx.nomePessoa.upsert({
    where: { chaveIdempotencia: plano.chaveIdempotencia },
    update: {},
    create: {
      pessoaId: entrada.pessoaId,
      nome: entrada.nome.trim(),
      sobrenome: entrada.sobrenome?.trim() || null,
      tipo: entrada.tipo,
      principal: plano.tornarPrincipal,
      chaveFonetica: plano.chaveFonetica || null,
      origem: entrada.afirmacao.origem,
      confianca: entrada.afirmacao.confianca,
      responsavelId: entrada.afirmacao.responsavelId,
      afirmadoEm: entrada.afirmacao.afirmadoEm,
      justificativa: entrada.afirmacao.justificativa,
      evidenciaNecessidadeId: entrada.afirmacao.evidenciaNecessidadeId,
      chaveIdempotencia: plano.chaveIdempotencia,
    },
    select: { id: true },
  })

  return { ok: true, id: criado.id, criado: true }
}

export async function trocarPrincipal(
  tx: ClientePrisma,
  pessoaId: number,
  novoPrincipalId: number,
): Promise<{ ok: true } | { ok: false; codigo: ErroNome; mensagem: string }> {
  const existentes = await listarNomes(tx, pessoaId)
  const r = planejarTrocarPrincipal(novoPrincipalId, existentes)
  if (!r.ok) return r
  if (r.plano.rebaixarId != null) {
    await tx.nomePessoa.update({ where: { id: r.plano.rebaixarId }, data: { principal: false } })
  }
  await tx.nomePessoa.update({ where: { id: r.plano.promoverId }, data: { principal: true } })
  return { ok: true }
}

export async function removerNome(
  tx: ClientePrisma,
  pessoaId: number,
  nomeId: number,
  sucessorId?: number | null,
): Promise<{ ok: true } | { ok: false; codigo: ErroNome; mensagem: string }> {
  const existentes = await listarNomes(tx, pessoaId)
  const r = planejarRemover(nomeId, existentes, sucessorId)
  if (!r.ok) return r
  // Desativa, não apaga: a forma antiga do nome é o que explica documento antigo.
  await tx.nomePessoa.update({
    where: { id: r.plano.removerId },
    data: { ativo: false, principal: false },
  })
  if (r.plano.novoPrincipalId != null) {
    await tx.nomePessoa.update({
      where: { id: r.plano.novoPrincipalId },
      data: { principal: true },
    })
  }
  return { ok: true }
}

/** Origem padrão de um nome vindo do cadastro atual (usado no backfill da F2). */
export function afirmacaoDeImportacao(quando: Date): AfirmacaoAuditavel {
  return {
    origem: "IMPORTACAO" as OrigemAfirmacao,
    confianca: "PROVAVEL",
    responsavelId: null,
    afirmadoEm: quando,
    justificativa: "Nome já existente em Pessoa.nome/sobrenome no momento da migração MDM-5.",
    evidenciaNecessidadeId: null,
  }
}
