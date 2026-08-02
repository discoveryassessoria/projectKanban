// Uma organização do cadastro mestre. O código público (ORG-n) é IMUTÁVEL: não
// entra na whitelist de campos editáveis. Categorias são substituídas em bloco
// quando `categoriaIds` vem no corpo.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { FUNCOES, detectarDuplicidade, normalizarIdentificacaoFiscal } from '@/src/services/organizacao-identidade'
import type { FuncaoOrganizacao } from '@prisma/client'

const INCLUDE_CATEGORIAS = {
  categorias: { select: { categoriaId: true, categoria: { select: { id: true, code: true, nome: true, ativo: true } } } },
} as const

const txt = (v: unknown, max?: number) => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return max ? t.slice(0, max) : t
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const b = await request.json()
    const atual = await prisma.orgaoProtocolo.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Órgão não encontrado.' }, { status: 404 })

    const nomeFinal = b.name !== undefined ? (txt(b.name, 200) ?? atual.name) : atual.name
    const paisFinal = b.country !== undefined ? txt(b.country, 60) : atual.country
    if (nomeFinal !== atual.name || paisFinal !== atual.country) {
      const colide = await prisma.orgaoProtocolo.findFirst({
        where: { name: nomeFinal, country: paisFinal, id: { not: id } },
        select: { id: true, publicCode: true },
      })
      if (colide) {
        return NextResponse.json(
          { error: `Já existe uma organização com este nome neste país (${colide.publicCode ?? `#${colide.id}`}).` },
          { status: 409 },
        )
      }
    }

    // Editar também não pode gerar duplicidade: renomear para algo muito parecido
    // com outra organização é avisado antes de gravar.
    if (b.name !== undefined && b.confirmarNova !== true) {
      const suspeitas = await detectarDuplicidade(prisma, { name: nomeFinal, country: paisFinal }, { ignorarId: id })
      if (suspeitas.length) {
        return NextResponse.json({
          error: 'O novo nome ficou muito parecido com outra organização já cadastrada.',
          duplicidade: { suspeitas },
          acao: 'CONFIRMAR_ENTIDADE_DIFERENTE',
          dica: 'Reenvie com confirmarNova:true se forem entidades diferentes.',
        }, { status: 409 })
      }
    }

    const campo = <T,>(chave: string, atualValor: T, transformar: (v: unknown) => T): T =>
      b[chave] !== undefined ? transformar(b[chave]) : atualValor

    const orgao = await prisma.$transaction(async (tx) => {
      await tx.orgaoProtocolo.update({
        where: { id },
        data: {
          name: nomeFinal,
          nomeFantasia: campo('nomeFantasia', atual.nomeFantasia, (v) => txt(v, 200)),
          type: campo('type', atual.type, (v) => txt(v, 30)),
          country: paisFinal,
          state: campo('state', atual.state, (v) => txt(v, 60)),
          provincia: campo('provincia', atual.provincia, (v) => txt(v, 80)),
          // FUNÇÕES: a organização é uma só e acumula papéis. A edição substitui
          // a lista quando enviada — mas nunca cria outro cadastro.
          funcoes: b.funcoes !== undefined
            ? (Array.isArray(b.funcoes) ? FUNCOES.filter((f) => (b.funcoes as unknown[]).includes(f)) : atual.funcoes) as FuncaoOrganizacao[]
            : atual.funcoes,
          identificacaoFiscal: campo('identificacaoFiscal', atual.identificacaoFiscal, (v) => normalizarIdentificacaoFiscal(txt(v, 40))),
          tipoIdentificacaoFiscal: campo('tipoIdentificacaoFiscal', atual.tipoIdentificacaoFiscal, (v) => txt(v, 20)),
          formaPagamento: campo('formaPagamento', atual.formaPagamento, (v) => txt(v, 60)),
          chavePix: campo('chavePix', atual.chavePix, (v) => txt(v, 140)),
          tipoChavePix: campo('tipoChavePix', atual.tipoChavePix, (v) => txt(v, 20)),
          banco: campo('banco', atual.banco, (v) => txt(v, 120)),
          agencia: campo('agencia', atual.agencia, (v) => txt(v, 20)),
          conta: campo('conta', atual.conta, (v) => txt(v, 30)),
          tipoConta: campo('tipoConta', atual.tipoConta, (v) => txt(v, 20)),
          prazoPagamentoDias: campo('prazoPagamentoDias', atual.prazoPagamentoDias, (v) =>
            v === null || v === '' || v === undefined ? null : (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null)),
          contatoFinanceiro: campo('contatoFinanceiro', atual.contatoFinanceiro, (v) => txt(v, 200)),
          observacoesFinanceiras: campo('observacoesFinanceiras', atual.observacoesFinanceiras, (v) => txt(v)),
          statusFinanceiro: campo('statusFinanceiro', atual.statusFinanceiro, (v) => txt(v, 20)),
          city: campo('city', atual.city, (v) => txt(v, 100)),
          endereco: campo('endereco', atual.endereco, (v) => txt(v, 300)),
          cep: campo('cep', atual.cep, (v) => txt(v, 20)),
          site: campo('site', atual.site, (v) => txt(v, 300)),
          email: campo('email', atual.email, (v) => txt(v, 200)),
          telefone: campo('telefone', atual.telefone, (v) => txt(v, 60)),
          idioma: campo('idioma', atual.idioma, (v) => txt(v, 10)),
          moeda: campo('moeda', atual.moeda, (v) => txt(v, 10)),
          horario: campo('horario', atual.horario, (v) => txt(v, 200)),
          responsavel: campo('responsavel', atual.responsavel, (v) => txt(v, 200)),
          observacoes: campo('observacoes', atual.observacoes, (v) => txt(v)),
          queueRule: campo('queueRule', atual.queueRule, (v) => txt(v, 200)),
          tags: campo('tags', atual.tags, (v) =>
            Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x).trim()).filter(Boolean))) : [],
          ),
          ativo: b.ativo !== undefined ? !!b.ativo : atual.ativo,
        },
      })

      if (Array.isArray(b.categoriaIds)) {
        const ids: number[] = Array.from(new Set(b.categoriaIds.map(Number).filter((n: number) => Number.isInteger(n))))
        await tx.organizacaoCategoria.deleteMany({ where: { orgaoId: id, categoriaId: { notIn: ids.length ? ids : [-1] } } })
        if (ids.length) {
          await tx.organizacaoCategoria.createMany({
            data: ids.map((categoriaId) => ({ orgaoId: id, categoriaId })),
            skipDuplicates: true,
          })
        }
      }

      return tx.orgaoProtocolo.findUnique({ where: { id }, include: INCLUDE_CATEGORIAS })
    })

    return NextResponse.json({ orgao })
  } catch (e) {
    console.error('PUT orgaos-protocolo/[id]', e)
    return NextResponse.json({ error: 'Erro ao salvar órgão.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.orgaoProtocolo.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Órgão não encontrado.' }, { status: 404 })

    // Histórico nunca se quebra: organização que já recebeu protocolo é INATIVADA.
    const protocolos = await prisma.protocolo.count({ where: { orgaoId: id } })
    if (protocolos > 0) {
      const orgao = await prisma.orgaoProtocolo.update({ where: { id }, data: { ativo: false }, include: INCLUDE_CATEGORIAS })
      return NextResponse.json({ ok: true, inativado: true, protocolos, orgao })
    }

    await prisma.orgaoProtocolo.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE orgaos-protocolo/[id]', e)
    return NextResponse.json({ error: 'Erro ao excluir órgão.' }, { status: 500 })
  }
}
