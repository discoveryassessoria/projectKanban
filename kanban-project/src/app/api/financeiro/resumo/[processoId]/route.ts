// src/app/api/financeiro/resumo/[processoId]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const processoIdNum = parseInt(processoId)

    // 1) Pasta Documental: soma dos CustoPessoa
    const custosPessoa = await prisma.custoPessoa.findMany({
      where: { processoId: processoIdNum },
      include: {
        pessoa: { select: { id: true, nome: true, sobrenome: true } },
        tipoServico: { select: { id: true, nome: true } }
      }
    })

    const pastaTotal = custosPessoa.reduce((s: number, c: any) => s + Number(c.valor || 0), 0)

    const pastaDetalhes = custosPessoa
      .filter((c: any) => Number(c.valor) > 0)
      .map((c: any) => ({
        pessoaId: c.pessoaId,
        pessoa: [c.pessoa.nome, c.pessoa.sobrenome].filter(Boolean).join(" "),
        servico: c.tipoServico.nome,
        registro: c.tipoRegistro || "—",
        valor: Number(c.valor)
      }))

    // TODO: conectar ao modelo real de pagamentos da pasta quando existir
    const pastaPago = 0

    // 2) Contas a Pagar
    const contasPagar = await prisma.contaPagar.findMany({
      where: { processoId: processoIdNum },
      include: {
        fornecedor: { select: { id: true, nome: true } },
        categoria: { select: { id: true, nome: true } }
      },
      orderBy: { dataVencimento: "asc" }
    })

    const contasPagarSerialized = contasPagar.map((c: any) => ({
      id: c.id,
      descricao: c.descricao,
      fornecedor: c.fornecedor?.nome,
      valor: Number(c.valor),
      valorPago: c.valorPago ? Number(c.valorPago) : null,
      dataVencimento: c.dataVencimento.toISOString(),
      status: c.status
    }))

    // 3) Dados do processo para seleção de pagador
    const processo = await prisma.processo.findUnique({
      where: { id: processoIdNum },
      include: {
        requerentes: { include: { requerente: true } },
        contratantes: { include: { contratante: true } },
        status: true,
      }
    })

    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    const pessoas = [
      ...processo.requerentes.map((r: any) => ({
        id: r.requerente.id, nome: r.requerente.nome, tipo: "REQUERENTE" as const,
        endereco: r.requerente.endereco, numero: r.requerente.numero,
        bairro: r.requerente.bairro, cidade: r.requerente.cidade,
        estado: r.requerente.estado, cep: r.requerente.cep, pais: r.requerente.pais,
      })),
      ...processo.contratantes.map((c: any) => ({
        id: c.contratante.id, nome: c.contratante.nome, tipo: "CONTRATANTE" as const,
        endereco: c.contratante.endereco, numero: c.contratante.numero,
        bairro: c.contratante.bairro, cidade: c.contratante.cidade,
        estado: c.contratante.estado, cep: c.contratante.cep, pais: c.contratante.pais,
      }))
    ]

    return NextResponse.json({
      pais: processo.pais,
      nomeProcesso: processo.nome,
      etapaAtual: processo.status?.nome || "",
      pessoas,
      pastaTotal,
      pastaPago,
      pastaDetalhes,
      contasPagar: contasPagarSerialized,
    })
  } catch (error: any) {
    console.error("Erro no resumo financeiro:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}