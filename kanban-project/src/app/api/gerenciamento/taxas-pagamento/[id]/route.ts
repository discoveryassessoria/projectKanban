import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { validarTaxa, paraColunasTaxa } from '../campos'
import {
  INCLUDE_APLICABILIDADE_TAXA, eixosPresentes, regravarVinculosTaxa, resolverAplicabilidadeTaxa,
} from '@/lib/financeiro/taxa-aplicabilidade'
import { INCLUDE_PARCELAMENTO, linhasDoBody, regravarLinhas, tabelaPresente, validarTabela } from '@/lib/financeiro/taxa-parcelamento'
import { resolverIdentidade, acharDuplicata } from '../identidade-server'

// PUT — Atualizar taxa (merge campo-a-campo → mapeamento único).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.taxaPagamento.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Taxa não encontrada' }, { status: 404 })

    const b = await request.json()

    // Nome recomputado a partir dos cadastros reais (o cliente não é autoridade);
    // código é IMUTÁVEL (nunca regerado na edição).
    const ident = await resolverIdentidade(b, atual)
    const merged = { ...atual, ...b, name: ident.name || atual.name, code: atual.code }
    const erros = validarTaxa(merged)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    // Unicidade lógica (exceto o próprio registro).
    const vig = b.vigenciaInicio !== undefined ? (b.vigenciaInicio ? new Date(String(b.vigenciaInicio)) : null) : (atual.vigenciaInicio ?? null)
    const ativo = b.ativo !== undefined ? !!b.ativo : atual.ativo
    if (ativo) {
      const dup = await acharDuplicata(ident, id)
      if (dup) return NextResponse.json({ error: `Já existe uma tabela ativa igual: "${dup.name}". Altere a vigência para criar uma nova versão.`, codigo: 'DUPLICADO', conflito: dup }, { status: 409 })
    }

    // Aplicabilidade: ids conferidos contra o cadastro (existe? ativo?).
    // Eixo ausente do body não é regravado — PUT parcial não apaga vínculo algum.
    const presentes = eixosPresentes(b)
    const aplic = await resolverAplicabilidadeTaxa(b)
    if (aplic.erros.length) {
      return NextResponse.json({ error: aplic.erros[0].mensagem, erros: aplic.erros }, { status: 400 })
    }

    // Tabela de parcelamento. Ausente do body = não é regravada.
    const temTabela = tabelaPresente(b)
    const linhas = temTabela ? linhasDoBody(b) : []
    if (temTabela) {
      const errosTabela = validarTabela(linhas)
      if (errosTabela.length) return NextResponse.json({ error: errosTabela[0].mensagem, erros: errosTabela }, { status: 400 })
    }

    const taxa = await prisma.$transaction(async (tx) => {
      await regravarVinculosTaxa(tx, id, aplic.selecao, presentes)
      if (temTabela) await regravarLinhas(tx, id, linhas)

      // Projeção legada: só dos eixos que o body declarou (o motor de cálculo
      // continua lendo destes arrays — nada nele foi alterado).
      const projecao: Record<string, unknown> = {}
      if (presentes.moedas) projecao.moedasAplicaveis = aplic.projecao.moedasAplicaveis
      if (presentes.paises) projecao.paises = aplic.projecao.paises
      if (presentes.servicos) projecao.servicos = aplic.projecao.servicos

      return tx.taxaPagamento.update({
        where: { id },
        data: { ...paraColunasTaxa(merged), ...projecao },
        include: { ...INCLUDE_APLICABILIDADE_TAXA, ...INCLUDE_PARCELAMENTO },
      })
    })
    return NextResponse.json({ taxa })
  } catch (error) {
    console.error('Erro ao atualizar taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE — bloqueia se a taxa estiver vinculada a alguma Condição; prefira desativar.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)

    const emCondicao = await prisma.condicaoPagamentoTaxa.count({ where: { taxaId: id } })
    if (emCondicao > 0) {
      return NextResponse.json({ error: 'Taxa vinculada a condição(ões) — desative em vez de excluir.', codigo: 'EM_USO', uso: { condicoes: emCondicao } }, { status: 409 })
    }

    await registrarAuditoria(request, { acao: 'EXCLUIR', entidade: 'TaxaPagamento', entidadeId: id, descricao: `Taxa de pagamento excluída (#${id})` })
    await prisma.taxaPagamento.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir taxa de pagamento:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
