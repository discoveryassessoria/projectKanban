// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/paises/[countryKey]/route.ts
//
// PUT    - edita o país (nome, bandeira, nacionalidade, prefixo, moeda, ativo).
//          NÃO propaga nada: o rótulo vive só aqui, e quem exibe resolve pela
//          relação. Propagar era o sintoma de que existiam cópias.
// DELETE - exclui o país (só se NÃO tiver Tipo de Processo nem Processo —
//          fato operacional; senão 409 → a UI sugere inativar). O resto que
//          referencia o país por FK é cadastro/configuração: desvincula
//          (Órgão de Protocolo, Requisito Cadastral) ou remove junto
//          (Modalidade, Serviço/Condição/Taxa por país, Status legado).

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { ondePaisEh } from "@/src/lib/identidade/canonica"

export async function PUT(request: Request, { params }: { params: Promise<{ countryKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey } = await params
    const atual = await prisma.catalogoPais.findUnique({ where: { countryKey } })
    if (!atual) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })

    const b = await request.json().catch(() => ({}))

    const pais = await prisma.catalogoPais.update({
      where: { countryKey },
      data: {
        countryLabel: b.countryLabel !== undefined ? String(b.countryLabel).trim() : atual.countryLabel,
        nationalityLabel: b.nationalityLabel !== undefined ? String(b.nationalityLabel).trim() : atual.nationalityLabel,
        flag: b.flag !== undefined ? (b.flag ? String(b.flag).trim() : null) : atual.flag,
        codePrefix: b.codePrefix !== undefined ? (b.codePrefix ? String(b.codePrefix).trim() : null) : atual.codePrefix,
        defaultCurrency: b.defaultCurrency !== undefined ? String(b.defaultCurrency).trim() : atual.defaultCurrency,
        ativo: b.ativo !== undefined ? Boolean(b.ativo) : atual.ativo,
      },
    })

    return NextResponse.json({ pais })
  } catch (error) {
    console.error('Erro ao editar país:', error)
    return NextResponse.json({ error: 'Erro ao editar país' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ countryKey: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro

  try {
    const { countryKey } = await params
    const atual = await prisma.catalogoPais.findUnique({ where: { countryKey } })
    if (!atual) return NextResponse.json({ error: 'País não encontrado.' }, { status: 404 })

    // SÓ FATO OPERACIONAL bloqueia exclusão (Tipo de Processo e Processo —
    // "Configuração ≠ fato histórico", mandato REGRA MASTER). Tudo o mais que
    // referencia o país por FK é CADASTRO/CONFIGURAÇÃO — a exclusão do país
    // desvincula (Órgão de Protocolo, Requisito Cadastral: `paisId` é campo de
    // ESCOPO, ficam sem país em vez de serem apagados) ou remove o que só
    // existia por causa deste país (Serviço/Condição/Taxa por país, Status
    // legado — junções puras, sem identidade própria fora do país).
    const [tipos, processos] = await Promise.all([
      prisma.tipoProcessoNacionalidade.count({ where: { paisId: atual.id } }),
      prisma.processo.count({ where: ondePaisEh(countryKey) }),
    ])
    if (tipos > 0 || processos > 0) {
      return NextResponse.json(
        { error: `Este país tem ${tipos} tipo(s) de processo e ${processos} processo(s). Inative-o em vez de excluir.` },
        { status: 409 }
      )
    }

    const desvinculados = await prisma.$transaction(async (tx) => {
      const orgaos = await tx.orgaoProtocolo.updateMany({ where: { paisId: atual.id }, data: { paisId: null } })
      const requisitos = await tx.requisitoCadastral.updateMany({ where: { paisId: atual.id }, data: { paisId: null } })
      const servicos = await tx.servicoProdutoPais.deleteMany({ where: { paisId: atual.id } })
      const condicoesPagamento = await tx.condicaoPagamentoPais.deleteMany({ where: { paisId: atual.id } })
      const taxasPagamento = await tx.taxaPagamentoPais.deleteMany({ where: { paisId: atual.id } })
      const status = await tx.status.deleteMany({ where: { paisId: atual.id } })
      await tx.modalidadePais.deleteMany({ where: { paisId: atual.id } })
      await tx.catalogoPais.delete({ where: { countryKey } })
      return {
        orgaosDesvinculados: orgaos.count, requisitosDesvinculados: requisitos.count,
        servicosRemovidos: servicos.count, condicoesPagamentoRemovidas: condicoesPagamento.count,
        taxasPagamentoRemovidas: taxasPagamento.count, statusRemovidos: status.count,
      }
    })

    const usuario = await extrairUsuarioComPermissoes(request)
    await prisma.logAuditoria.create({
      data: {
        acao: 'PAIS_EXCLUIDO', entidade: 'CatalogoPais', entidadeId: atual.id,
        descricao: `País "${atual.countryLabel}" excluído. Desvinculado: ${JSON.stringify(desvinculados)}.`,
        detalhes: desvinculados as never, usuarioId: usuario?.userId ?? null,
      },
    }).catch(() => null)

    return NextResponse.json({ ok: true, desvinculados })
  } catch (error) {
    console.error('Erro ao excluir país:', error)
    return NextResponse.json({ error: 'Erro ao excluir país' }, { status: 500 })
  }
}