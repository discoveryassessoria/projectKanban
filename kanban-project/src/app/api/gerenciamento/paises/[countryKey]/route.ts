// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/paises/[countryKey]/route.ts
//
// PUT    - edita o país (nome, bandeira, nacionalidade, prefixo, moeda, ativo).
//          NÃO propaga nada: o rótulo vive só aqui, e quem exibe resolve pela
//          relação. Propagar era o sintoma de que existiam cópias.
// DELETE - exclui o país (só se NÃO tiver tipos nem processos; senão 409 →
//          a UI sugere inativar). Apaga as modalidades junto.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
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

    // Bloqueia se estiver em uso — TODAS as tabelas que referenciam o país por
    // FK, não só Tipo/Processo. Excluir sem checar as outras deixava a
    // exclusão cair no banco e voltar como erro genérico 500, escondendo o
    // motivo real (achado em teste real de produção, 22/09/2026).
    const [tipos, processos, orgaos, requisitos, servicos, condicoesPagamento, taxasPagamento] = await Promise.all([
      prisma.tipoProcessoNacionalidade.count({ where: { paisId: atual.id } }),
      prisma.processo.count({ where: ondePaisEh(countryKey) }),
      prisma.orgaoProtocolo.count({ where: { paisId: atual.id } }),
      prisma.requisitoCadastral.count({ where: { paisId: atual.id } }),
      prisma.servicoProdutoPais.count({ where: { paisId: atual.id } }),
      prisma.condicaoPagamentoPais.count({ where: { paisId: atual.id } }),
      prisma.taxaPagamentoPais.count({ where: { paisId: atual.id } }),
    ])
    const uso = { tipos, processos, orgaos, requisitos, servicos, condicoesPagamento, taxasPagamento }
    const total = tipos + processos + orgaos + requisitos + servicos + condicoesPagamento + taxasPagamento
    if (total > 0) {
      const partes = [
        tipos > 0 && `${tipos} tipo(s) de processo`,
        processos > 0 && `${processos} processo(s)`,
        orgaos > 0 && `${orgaos} órgão(s) de protocolo`,
        requisitos > 0 && `${requisitos} requisito(s) cadastral(is)`,
        servicos > 0 && `${servicos} serviço(s)/produto(s)`,
        condicoesPagamento > 0 && `${condicoesPagamento} condição(ões) de pagamento`,
        taxasPagamento > 0 && `${taxasPagamento} taxa(s) de pagamento`,
      ].filter(Boolean)
      return NextResponse.json(
        { error: `Este país tem ${partes.join(', ')}. Inative-o em vez de excluir.`, uso },
        { status: 409 }
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.modalidadePais.deleteMany({ where: { paisId: atual.id } })
      await tx.catalogoPais.delete({ where: { countryKey } })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro ao excluir país:', error)
    return NextResponse.json({ error: 'Erro ao excluir país' }, { status: 500 })
  }
}