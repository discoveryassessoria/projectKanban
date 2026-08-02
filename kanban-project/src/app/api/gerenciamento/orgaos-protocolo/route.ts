// src/app/api/gerenciamento/orgaos-protocolo/route.ts
// Cadastro mestre de Órgãos e Organizações (Gerenciamento › Órgãos e Organizações).
// O código público (ORG1, ORG2…) é gerado pelo CodeGeneratorService no create e
// NUNCA aceito do cliente. Categorias são N:N (uma entidade pode ser cartório E
// tradutor). Anti-duplicidade por nome oficial + país.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import {
  detectarDuplicidade,
  normalizarIdentificacaoFiscal,
  resolverOrganizacao,
  unirFuncoes,
  FUNCOES,
} from '@/src/services/organizacao-identidade'
import type { FuncaoOrganizacao } from '@prisma/client'

const INCLUDE_CATEGORIAS = {
  categorias: { select: { categoriaId: true, categoria: { select: { id: true, code: true, nome: true, ativo: true } } } },
} as const

const s = (v: unknown, max?: number) => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return max ? t.slice(0, max) : t
}
const listaTags = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x).trim()).filter(Boolean))) : []

const listaFuncoes = (v: unknown): FuncaoOrganizacao[] =>
  Array.isArray(v) ? FUNCOES.filter((f) => v.includes(f)) : []

/** Campos livres da ficha — mesmos no POST e no PUT. */
function camposDaFicha(b: Record<string, unknown>) {
  return {
    nomeFantasia: s(b.nomeFantasia, 200),
    provincia: s(b.provincia, 80),
    identificacaoFiscal: normalizarIdentificacaoFiscal(s(b.identificacaoFiscal, 40)),
    tipoIdentificacaoFiscal: s(b.tipoIdentificacaoFiscal, 20),
    formaPagamento: s(b.formaPagamento, 60),
    chavePix: s(b.chavePix, 140),
    tipoChavePix: s(b.tipoChavePix, 20),
    banco: s(b.banco, 120),
    agencia: s(b.agencia, 20),
    conta: s(b.conta, 30),
    tipoConta: s(b.tipoConta, 20),
    prazoPagamentoDias: Number.isInteger(Number(b.prazoPagamentoDias)) && b.prazoPagamentoDias !== null && b.prazoPagamentoDias !== ''
      ? Number(b.prazoPagamentoDias) : null,
    contatoFinanceiro: s(b.contatoFinanceiro, 200),
    observacoesFinanceiras: s(b.observacoesFinanceiras),
    statusFinanceiro: s(b.statusFinanceiro, 20),
    type: s(b.type, 30),
    country: s(b.country, 60),
    state: s(b.state, 60),
    city: s(b.city, 100),
    endereco: s(b.endereco, 300),
    cep: s(b.cep, 20),
    site: s(b.site, 300),
    email: s(b.email, 200),
    telefone: s(b.telefone, 60),
    idioma: s(b.idioma, 10),
    moeda: s(b.moeda, 10),
    horario: s(b.horario, 200),
    responsavel: s(b.responsavel, 200),
    observacoes: s(b.observacoes),
    queueRule: s(b.queueRule, 200),
    tags: listaTags(b.tags),
  }
}

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const orgaos = await prisma.orgaoProtocolo.findMany({
      orderBy: [{ country: 'asc' }, { name: 'asc' }],
      include: INCLUDE_CATEGORIAS,
    })
    return NextResponse.json({ orgaos })
  } catch (e) {
    console.error('GET orgaos-protocolo', e)
    return NextResponse.json({ error: 'Erro ao carregar órgãos.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json()
    const name = s(b.name, 200)
    if (!name) return NextResponse.json({ error: 'Informe o nome oficial.' }, { status: 400 })

    const ficha = camposDaFicha(b)
    const funcoes = listaFuncoes(b.funcoes)
    const categoriaIds: number[] = Array.isArray(b.categoriaIds)
      ? Array.from(new Set(b.categoriaIds.map(Number).filter((n: number) => Number.isInteger(n))))
      : []

    // ── ORGANIZAÇÃO ÚNICA ────────────────────────────────────────────────────
    // A entidade é procurada na ordem obrigatória (identificação fiscal → nome
    // oficial + país → nome fantasia + país). Se já existe, NÃO se cria outra:
    // acrescentam-se funções e categorias ao registro que já é a organização.
    const resolucao = await resolverOrganizacao(prisma, {
      name, nomeFantasia: ficha.nomeFantasia, country: ficha.country,
      identificacaoFiscal: ficha.identificacaoFiscal,
    })
    if (resolucao.id) {
      if (b.confirmarAcrescimo !== true) {
        return NextResponse.json({
          error: `Esta organização já existe: ${resolucao.registro?.publicCode ?? `#${resolucao.id}`} — ${resolucao.registro?.name}.`,
          duplicidade: { existente: resolucao.registro, resolvidoPor: resolucao.como },
          acao: 'ACRESCENTAR_FUNCAO',
          dica: 'Reenvie com confirmarAcrescimo:true para acrescentar as funções e categorias ao cadastro existente.',
        }, { status: 409 })
      }
      const atual = await prisma.orgaoProtocolo.findUniqueOrThrow({ where: { id: resolucao.id }, select: { funcoes: true } })
      const orgao = await prisma.$transaction(async (tx) => {
        await tx.orgaoProtocolo.update({
          where: { id: resolucao.id! },
          data: { funcoes: unirFuncoes(atual.funcoes, funcoes) },
        })
        if (categoriaIds.length) {
          await tx.organizacaoCategoria.createMany({
            data: categoriaIds.map((categoriaId) => ({ orgaoId: resolucao.id!, categoriaId })),
            skipDuplicates: true,
          })
        }
        return tx.orgaoProtocolo.findUnique({ where: { id: resolucao.id! }, include: INCLUDE_CATEGORIAS })
      })
      return NextResponse.json({ orgao, acrescentado: true, resolvidoPor: resolucao.como })
    }

    // Nada casou por identidade exata. Antes de criar, AVISA sobre parecidas —
    // detectar não é fundir: quem decide é quem cadastra.
    const suspeitas = await detectarDuplicidade(prisma, { name, nomeFantasia: ficha.nomeFantasia, country: ficha.country })
    if (suspeitas.length && b.confirmarNova !== true) {
      return NextResponse.json({
        error: 'Encontramos organizações muito parecidas. Confirme que esta é uma entidade diferente.',
        duplicidade: { suspeitas },
        acao: 'CONFIRMAR_ENTIDADE_DIFERENTE',
        dica: 'Reenvie com confirmarNova:true se for comprovadamente outra entidade.',
      }, { status: 409 })
    }

    const orgao = await prisma.$transaction(async (tx) => {
      const criado = await tx.orgaoProtocolo.create({
        data: { name, ...ficha, funcoes: funcoes.length ? funcoes : ['ORGAO'], ativo: b.ativo !== false },
      })
      if (categoriaIds.length) {
        await tx.organizacaoCategoria.createMany({
          data: categoriaIds.map((categoriaId) => ({ orgaoId: criado.id, categoriaId })),
          skipDuplicates: true,
        })
      }
      return tx.orgaoProtocolo.findUnique({ where: { id: criado.id }, include: INCLUDE_CATEGORIAS })
    })

    return NextResponse.json({ orgao }, { status: 201 })
  } catch (e) {
    console.error('POST orgaos-protocolo', e)
    return NextResponse.json({ error: 'Erro ao criar órgão.' }, { status: 500 })
  }
}
