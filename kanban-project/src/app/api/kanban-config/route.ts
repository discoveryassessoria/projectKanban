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
        // A oferta aponta para a IDENTIDADE do país; a chave que o board usa
        // para agrupar é lida da relação, não de uma cópia no tipo.
        select: {
          id: true, code: true, name: true,
          pais: { select: { countryKey: true } },
          // Um Tipo pode habilitar Administrativa, Judicial ou ambas (mandato
          // "Reconstrução da hierarquia", 22/09/2026) — a lista completa vai em
          // `modalidades` (o modal "criar processo" usa para deixar escolher);
          // `modalityLabel` (deprecated) continua best-effort (a primeira
          // habilitada) só para não quebrar o consumidor existente
          // (kanban-content.tsx), que já tolera o campo estar ausente.
          modalidadesHabilitadas: {
            where: { ativo: true },
            select: { modalidade: { select: { id: true, modalityKey: true, modalityLabel: true } } },
            orderBy: { modalidadeId: "asc" },
          },
        },
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

    // fases por tipo — UNIÃO das fases de todos os Workflow Macro do Tipo (um
    // por modalidade habilitada), sem repetir a mesma chave. `findMany` sem
    // `where` agora devolve potencialmente MAIS de uma linha por
    // tipoProcessoId (uma por modalidade) — um `Map.set` sequencial
    // sobrescreveria as fases da primeira modalidade com as da última.
    const fasesPorTipo = new Map<number, { phaseKey: string; label: string; ordem: number }[]>()
    for (const wf of workflows) {
      const atuais = fasesPorTipo.get(wf.tipoProcessoId) ?? []
      const vistas = new Set(atuais.map((f) => f.phaseKey))
      for (const f of wf.fases) { if (!vistas.has(f.phaseKey)) { vistas.add(f.phaseKey); atuais.push(f) } }
      fasesPorTipo.set(wf.tipoProcessoId, atuais)
    }

    const tiposOut = tipos.map(({ pais, modalidadesHabilitadas, ...t }) => ({
      ...t,
      // APRESENTAÇÃO derivada das relações — nunca de coluna espelhada.
      countryKey: pais.countryKey,
      modalityLabel: modalidadesHabilitadas[0]?.modalidade.modalityLabel ?? null,
      modalidades: modalidadesHabilitadas.map((h) => h.modalidade),
      fases: fasesPorTipo.get(t.id) || [],
    }))

    return NextResponse.json({ paises, tipos: tiposOut })
  } catch (error) {
    console.error("Erro no kanban-config:", error)
    return NextResponse.json({ error: "Erro ao carregar configuração do kanban" }, { status: 500 })
  }
}