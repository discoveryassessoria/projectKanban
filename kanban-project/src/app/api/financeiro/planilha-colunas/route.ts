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
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { prisma } from "@/lib/prisma"
import {
  listarColunasConfiguradas, listarItensDisponiveis, adicionarColuna,
  adicionarColunaDeEtapa, listarCategoriasDisponiveis,
} from "@/lib/financeiro/leitura/planilha-colunas"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "financeiro.ver")
  if (erro) return erro
  const [colunas, disponiveis, categorias] = await Promise.all([
    listarColunasConfiguradas(),          // todas: o editor precisa reativar as inativas
    listarItensDisponiveis(),
    listarCategoriasDisponiveis(),        // coluna de ETAPA resolve o item pela linha
  ])
  return NextResponse.json({ colunas, disponiveis, categorias })
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "financeiro.coluna_criar")
  if (erro) return erro
  try {
    const body = await request.json().catch(() => ({}))
    const autorInicial = (await extrairUsuarioComPermissoes(request))?.userId ?? null

    // COLUNA DE ETAPA — a que resolve o item pela LINHA (ver planilha-matriz.ts).
    // "Certidão Inteiro Teor" entra por aqui: ela é a categoria, não a certidão
    // de nascimento. Documento específico continua entrando pelo caminho de
    // baixo, mas ele pertence à dimensão de LINHA e o configurador avisa isso.
    if (body?.estrategia === "ITEM_DO_REGISTRO") {
      const categoriaItemId = Number(body?.categoriaItemId)
      if (!Number.isInteger(categoriaItemId) || categoriaItemId <= 0) {
        return NextResponse.json({ error: "categoriaItemId é obrigatório para coluna de etapa" }, { status: 400 })
      }
      const coluna = await adicionarColunaDeEtapa({ categoriaItemId, rotuloOverride: body?.rotuloOverride ?? null })
      await prisma.logAuditoria.create({
        data: {
          acao: "PLANILHA_COLUNA_ADICIONADA",
          entidade: "PlanilhaDocumentalColuna",
          entidadeId: coluna.id,
          usuarioId: autorInicial,
          descricao: `Coluna de etapa "${coluna.rotulo}" adicionada à Planilha Documental (resolve o item pelo registro da linha).`,
          detalhes: { estrategia: "ITEM_DO_REGISTRO", categoriaItemId, colunaId: coluna.id },
        },
      }).catch(() => {})
      return NextResponse.json({ coluna })
    }

    const origem = body?.origem
    const itemId = Number(body?.itemId)
    if (origem !== "SERVICO" && origem !== "DOCUMENTO") {
      return NextResponse.json({ error: "origem deve ser SERVICO ou DOCUMENTO" }, { status: 400 })
    }
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "itemId é obrigatório" }, { status: 400 })
    }
    const coluna = await adicionarColuna({ origem, itemId, rotuloOverride: body?.rotuloOverride ?? null })

    // AUDITORIA — coluna econômica é decisão de negócio e passa a ter autor. Sem
    // isto, descobrir quem criou uma coluna dependia de correlacionar `criadoEm`
    // com o histórico de sessões; foi exatamente o que precisou ser feito em
    // 09/08/2026 para rastrear quatro colunas criadas numa validação técnica.
    const autor = autorInicial
    await prisma.logAuditoria.create({
      data: {
        acao: "PLANILHA_COLUNA_ADICIONADA",
        entidade: "PlanilhaDocumentalColuna",
        entidadeId: coluna.id,
        usuarioId: autor,
        descricao: `Coluna "${coluna.rotuloCanonico}" (${coluna.origem}) adicionada à Planilha Documental.`,
        detalhes: { origem: coluna.origem, itemId, colunaId: coluna.id },
      },
    }).catch(() => {})

    return NextResponse.json({ coluna })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 })
  }
}
