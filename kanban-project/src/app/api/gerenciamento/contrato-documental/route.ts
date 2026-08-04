// src/app/api/gerenciamento/contrato-documental/route.ts
//
// AS OPÇÕES DO CONTRATO — famílias, naturezas e perfis, para os selects do
// Cadastro Mestre.
//
// Rota única de propósito: a tela precisa das três listas ao mesmo tempo para
// montar um formulário coerente (a natureza escolhida decide se o perfil é
// obrigatório). Três requisições dariam três instantes diferentes do cadastro.
//
// O perfil vem com o WORKFLOW junto — é o que a tela exibe em modo leitura assim
// que o operador escolhe um perfil: versão publicada, escopo, quantidade de
// passos. Sem isso a tela teria de adivinhar, e adivinhar é como o texto vira
// chave estrutural.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const [familias, naturezas, perfis] = await Promise.all([
      prisma.familiaDocumental.findMany({
        where: { ativo: true },
        orderBy: [{ ordem: "asc" }, { name: "asc" }],
        select: { id: true, code: true, name: true, descricao: true },
      }),
      prisma.naturezaOperacionalDocumento.findMany({
        where: { ativo: true },
        orderBy: [{ ordem: "asc" }, { name: "asc" }],
        select: { id: true, code: true, name: true, descricao: true, exigeWorkflow: true },
      }),
      prisma.perfilOperacionalDocumento.findMany({
        where: { ativo: true },
        orderBy: [{ name: "asc" }],
        select: {
          id: true, code: true, name: true, descricao: true,
          escopoInstanciacao: true, exigeProcesso: true, exigePessoa: true, exigeDocumento: true,
          familiaDocumental: { select: { id: true, code: true, name: true } },
          workflow: {
            select: {
              id: true, name: true, versao: true, active: true, phaseKey: true,
              escopoExecucao: true, exigeDocumento: true, exigePessoa: true,
              _count: { select: { passos: true } },
            },
          },
        },
      }),
    ])
    return NextResponse.json({ familias, naturezas, perfis })
  } catch (e) {
    console.error("GET contrato-documental", e)
    return NextResponse.json({ error: "Erro ao carregar o contrato documental." }, { status: 500 })
  }
}
