// src/app/api/gerenciamento/fornecedores/route.ts
// GET  - Listar fornecedores
// POST - Criar fornecedor
//
// Mantém os campos ricos do schema + pais + moedaPadrao (novos, do mockup).
// `tipo` (obrigatório) guarda a CATEGORIA do mockup
//   (registry_office/translator/apostille_service/lawyer/correspondent/
//    courier/consultant/government_fee/software/office/other).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// GET - Listar
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const fornecedores = await prisma.fornecedor.findMany({
      orderBy: { nome: 'asc' },
      include: { _count: { select: { contasPagar: true } } },
    })

    return NextResponse.json({ fornecedores })
  } catch (error) {
    console.error('Erro ao listar fornecedores:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()

    if (!b.nome || !String(b.nome).trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
    }
    if (!b.tipo || !String(b.tipo).trim()) {
      return NextResponse.json({ error: 'Tipo (categoria) é obrigatório' }, { status: 400 })
    }

    const fornecedor = await prisma.fornecedor.create({
      data: {
        nome: String(b.nome).trim(),
        tipo: String(b.tipo).trim(),
        nomeFantasia: s(b.nomeFantasia),
        cpfCnpj: s(b.cpfCnpj),
        inscricaoEstadual: s(b.inscricaoEstadual),
        inscricaoMunicipal: s(b.inscricaoMunicipal),
        telefone: s(b.telefone),
        celular: s(b.celular),
        email: s(b.email),
        website: s(b.website),
        cep: s(b.cep),
        endereco: s(b.endereco),
        numero: s(b.numero),
        complemento: s(b.complemento),
        bairro: s(b.bairro),
        cidade: s(b.cidade),
        estado: s(b.estado),
        pais: s(b.pais),
        banco: s(b.banco),
        agencia: s(b.agencia),
        conta: s(b.conta),
        tipoConta: s(b.tipoConta),
        chavePix: s(b.chavePix),
        tipoChavePix: s(b.tipoChavePix),
        moedaPadrao: b.moedaPadrao || 'BRL',
        observacoes: s(b.observacoes),
        ativo: b.ativo === undefined ? true : !!b.ativo,
      },
    })

    return NextResponse.json({ fornecedor }, { status: 201 })
  } catch (error) {
    console.error('Erro ao criar fornecedor:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}