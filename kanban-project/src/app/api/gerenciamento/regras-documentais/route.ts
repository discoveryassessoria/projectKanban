// src/app/api/gerenciamento/regras-documentais/route.ts
//
// API CANÔNICA das Regras Documentais (base persistente = MatrizDocumental
// ampliada — fonte ÚNICA). GET: lista + dados de apoio + conflitos. POST: cria
// rascunho. Validação no BACKEND. NÃO cria Documento/Necessidade/Tarefa.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import {
  carregarRegras, dadosDeApoio, validarRegraInput, normalizarInput,
  auditar, usuarioIdDe, novoCodigoRegra, ordemFaseGlobal,
} from "@/src/lib/documentos/regras-documentais/persistencia"
import { regraInputParaData } from "@/src/lib/documentos/regras-documentais/mapear"
import { detectarConflitos } from "@/src/lib/documentos/regras-documentais/conflitos"

// GET — lista de regras (canônicas) + dados de apoio + conflitos detectados
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const [regras, apoio] = await Promise.all([carregarRegras(), dadosDeApoio()])
    const conflitos = detectarConflitos(regras, ordemFaseGlobal())
    return NextResponse.json({ regras, ...apoio, conflitos })
  } catch (e) {
    console.error("GET regras-documentais", e)
    return NextResponse.json({ error: "Erro ao carregar as regras documentais." }, { status: 500 })
  }
}

// POST — cria uma regra em RASCUNHO (nunca publica automaticamente)
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const b = await request.json()
    const input = normalizarInput(b)
    const erros = validarRegraInput(input, true)
    if (erros.length) return NextResponse.json({ error: erros[0].mensagem, erros }, { status: 400 })

    const usuarioId = await usuarioIdDe(request)
    const data = regraInputParaData(input)
    // primários (dual-write) derivados das coleções
    const primeiroProc = input.tipoProcessoIds?.[0] ?? input.tipoProcessoId ?? 0
    const primeiroDoc = input.documentosAceitos?.[0] ?? input.documentTypeCode ?? ""
    const codigo = novoCodigoRegra(primeiroProc, primeiroDoc)

    const row = await prisma.matrizDocumental.create({
      data: {
        ...(data as object),
        tipoProcessoId: primeiroProc,
        documentTypeCode: primeiroDoc,
        codigo,
        versao: 1,
        status: "RASCUNHO",
        criadoPor: usuarioId ?? undefined,
        atualizadoPor: usuarioId ?? undefined,
      },
    })
    await auditar(prisma, { acao: "REGRA_CRIADA", entidadeId: row.id, descricao: `Regra documental criada (rascunho): ${row.nome ?? row.documentTypeCode}`, detalhes: { codigo, input }, usuarioId })
    return NextResponse.json({ regra: row }, { status: 201 })
  } catch (e) {
    console.error("POST regras-documentais", e)
    return NextResponse.json({ error: "Erro ao criar a regra documental." }, { status: 500 })
  }
}
