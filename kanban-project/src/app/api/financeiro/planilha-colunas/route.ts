// src/app/api/financeiro/planilha-colunas/route.ts
// ============================================================================
// CONFIGURAÇÃO DAS COLUNAS DA PLANILHA DOCUMENTAL — global, por cadastro.
//
// GLOBAL de propósito (§29): a planilha é a mesma para todos os processos. A
// configuração por processo que existia antes — `POST /api/processos/[id]/servicos`,
// que criava `TipoServico` por NOME dentro de cada processo — é justamente a
// fragmentação que este endpoint substitui: cada processo acabava com a sua
// própria lista de serviços, sem vínculo com o Cadastro Mestre nem com preço.
//
// Aqui não se cria serviço nem documento: escolhe-se QUAL item canônico vira
// coluna. Preço nunca passa por esta rota.
// ============================================================================
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { listarColunasConfiguradas, listarItensDisponiveis, adicionarColuna } from "@/lib/financeiro/leitura/planilha-colunas"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "financeiro.ver")
  if (erro) return erro
  const [colunas, disponiveis] = await Promise.all([
    listarColunasConfiguradas(),          // todas: o editor precisa reativar as inativas
    listarItensDisponiveis(),
  ])
  return NextResponse.json({ colunas, disponiveis })
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "financeiro.coluna_criar")
  if (erro) return erro
  try {
    const body = await request.json().catch(() => ({}))
    const origem = body?.origem
    const itemId = Number(body?.itemId)
    if (origem !== "SERVICO" && origem !== "DOCUMENTO") {
      return NextResponse.json({ error: "origem deve ser SERVICO ou DOCUMENTO" }, { status: 400 })
    }
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "itemId é obrigatório" }, { status: 400 })
    }
    const coluna = await adicionarColuna({ origem, itemId, rotuloOverride: body?.rotuloOverride ?? null })
    return NextResponse.json({ coluna })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 })
  }
}
