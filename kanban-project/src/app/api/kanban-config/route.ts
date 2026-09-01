// ESTE ARQUIVO VAI EM: src/app/api/kanban-config/route.ts
//
// Configuração do kanban vinda do GERENCIAMENTO (motor):
// - paises = as NACIONALIDADES OFERTADAS, não os países existentes.
// - tipos  = TipoProcessoNacionalidade ativos, cada um com as FASES do
//            Workflow Macro (só showInKanban, em ordem) = as COLUNAS do board
//
// Gated por processos.ver (quem vê o kanban precisa disso; a rota de
// gerenciamento é só admin, por isso esta existe).

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro

  try {
    const [paises, tipos, workflows] = await Promise.all([
      // EXISTIR NÃO É SER OFERTADO.
      //
      // Esta lista devolvia todo `CatalogoPais` ativo — então cadastrar um país
      // para outra finalidade (o país de um consulado, por exemplo) faria surgir
      // uma aba de cidadania que a empresa não vende. País é identidade
      // geográfica; oferta é CONFIGURAÇÃO sobre ela, e a configuração que já
      // existe é o Tipo de Processo por nacionalidade: sem um tipo ativo, não há
      // o que abrir naquele país.
      prisma.catalogoPais.findMany({
        where: {
          ativo: true,
          tiposDeProcesso: { some: { ativo: true, arquivado: false } },
        },
        orderBy: { countryLabel: "asc" },
        select: { countryKey: true, countryLabel: true, flag: true },
      }),
      prisma.tipoProcessoNacionalidade.findMany({
        where: { ativo: true, arquivado: false },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, countryKey: true, modalityLabel: true },
      }),
      prisma.macroWorkflow.findMany({
        select: {
          tipoProcessoId: true,
          fases: {
            where: { showInKanban: true },
            orderBy: { ordem: "asc" },
            select: { phaseKey: true, label: true, ordem: true },
          },
        },
      }),
    ])

    // fases por tipo (junta pelo tipoProcessoId — não depende de nome de relação)
    const fasesPorTipo = new Map<number, { phaseKey: string; label: string; ordem: number }[]>()
    for (const wf of workflows) fasesPorTipo.set(wf.tipoProcessoId, wf.fases)

    const tiposOut = tipos.map((t) => ({ ...t, fases: fasesPorTipo.get(t.id) || [] }))

    return NextResponse.json({ paises, tipos: tiposOut })
  } catch (error) {
    console.error("Erro no kanban-config:", error)
    return NextResponse.json({ error: "Erro ao carregar configuração do kanban" }, { status: 500 })
  }
}