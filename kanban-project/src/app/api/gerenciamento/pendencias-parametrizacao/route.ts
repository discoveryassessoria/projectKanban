// GET /api/gerenciamento/pendencias-parametrizacao?phaseKey=
//
// O que falta para o cadastro gerar dinheiro. DERIVADO — nada é persistido:
// preencher o preço na tela faz a pendência desaparecer na próxima leitura, sem
// rotina de limpeza e sem risco de a lista envelhecer.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { pendenciasDaParametrizacao } from "@/src/services/financeiro/pendencias-parametrizacao"

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const phaseKey = req.nextUrl.searchParams.get("phaseKey") ?? undefined
    return NextResponse.json(await pendenciasDaParametrizacao(phaseKey ? { phaseKey } : undefined))
  } catch (e) {
    console.error("GET pendencias-parametrizacao", e)
    return NextResponse.json({ error: "Erro ao apurar as pendências." }, { status: 500 })
  }
}
