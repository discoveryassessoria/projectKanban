// GET /api/genealogy/pessoas-repetidas?nome=&sobrenome=&dataNascimento=YYYY-MM-DD&arvoreId=
// ============================================================================
// Aviso "já existe uma pessoa parecida em outro processo" (Etapa 6). LEITURA pura.
// Permissão: `arvore.ver` (é a tela da árvore) E `processos.ver` (a resposta
// aponta para OUTROS processos — quem não pode ver processos não recebe nada).
// Sem nome de 3+ letras e data completa a resposta é vazia, sem tocar no banco.
// ============================================================================
import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { parametrosDaConsulta } from "@/src/lib/genealogia/pessoa-repetida"
import { buscarPessoasRepetidas } from "@/src/services/genealogia/pessoas-repetidas"

export async function GET(request: NextRequest) {
  const semArvore = await verificarPermissao(request, "arvore.ver")
  if (semArvore) return semArvore
  const semProcessos = await verificarPermissao(request, "processos.ver")
  if (semProcessos) return semProcessos

  const sp = request.nextUrl.searchParams
  const arvoreIdAtual = Number(sp.get("arvoreId"))
  if (!Number.isInteger(arvoreIdAtual) || arvoreIdAtual <= 0) {
    return NextResponse.json({ error: "arvoreId é obrigatório" }, { status: 400 })
  }
  const params = parametrosDaConsulta({
    nome: sp.get("nome"),
    sobrenome: sp.get("sobrenome"),
    dataNascimento: sp.get("dataNascimento"),
  })
  if (!params) return NextResponse.json({ candidatos: [] })

  try {
    const candidatos = await buscarPessoasRepetidas(prisma, { ...params, arvoreIdAtual })
    return NextResponse.json({ candidatos })
  } catch (error) {
    console.error("Erro ao buscar pessoas repetidas:", error)
    return NextResponse.json({ error: "Erro ao buscar pessoas parecidas" }, { status: 500 })
  }
}
