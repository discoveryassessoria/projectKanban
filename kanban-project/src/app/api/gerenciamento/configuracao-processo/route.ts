// src/app/api/gerenciamento/configuracao-processo/route.ts
//
// READ-MODEL ÚNICO da configuração por Tipo de Processo. SOMENTE LEITURA —
// não escreve, não aplica regra, não duplica fonte de verdade: apenas projeta o
// que já existe (MacroWorkflow/FaseMacro, PhaseInternalWorkflow/Step,
// PhaseAutomationRule, MatrizDocumental, ProdutoFinanceiro).
//
// Alimenta 4 telas do Gerenciamento que antes eram scaffolds ou não existiam:
//   • Processos › Configurações › SLA            (prazos de fase e de passo)
//   • Processos › Configurações › Versões        (versão de cada definição)
//   • Processos › Configurações Gerais           (identidade/estado do tipo)
//   • Workflow  › Transições                     (cadeia de entrada entre fases)
//   • Relatórios › Diagnóstico de Configuração   (o que falta para o tipo rodar)
//
// A EDIÇÃO continua exclusivamente nas telas donas (Fluxos, Automações, etc.) —
// aqui é consulta consolidada, sem segunda porta de escrita.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [tipos, internos, automacoes, matriz, configsFin, catalogoFases] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        // Ordena pelo rótulo DO PAÍS canônico, atravessando a relação.
        orderBy: [{ pais: { countryLabel: 'asc' } }, { name: 'asc' }],
        include: {
          macroWorkflows: { include: { fases: { orderBy: { ordem: 'asc' } } } },
          pais: { select: { countryKey: true, countryLabel: true, nationalityLabel: true } },
          modalidadesHabilitadas: { where: { ativo: true }, include: { modalidade: { select: { id: true, modalityKey: true, modalityLabel: true } } } },
        },
      }),
      prisma.phaseInternalWorkflow.findMany({
        where: { arquivado: false },
        include: { passos: { orderBy: { ordem: 'asc' } } },
      }),
      prisma.phaseAutomationRule.groupBy({
        by: ['tipoProcessoId', 'kind'],
        where: { arquivado: false, active: true },
        _count: { _all: true },
      }),
      prisma.matrizDocumental.groupBy({ by: ['tipoProcessoId'], _count: { _all: true } }),
      prisma.produtoFinanceiro.groupBy({
        by: ['tipoProcessoId'],
        where: { ativo: true },
        _count: { _all: true },
      }),
      prisma.catalogoFase.findMany({
        where: { ativo: true },
        orderBy: { ordemPadrao: 'asc' },
        select: { phaseKey: true, label: true, ordemPadrao: true },
      }),
    ])

    // índices auxiliares (null = definição global, vale para TODOS os tipos)
    const internosPorTipo = new Map<number | null, typeof internos>()
    for (const w of internos) {
      const k = w.tipoProcessoId ?? null
      if (!internosPorTipo.has(k)) internosPorTipo.set(k, [])
      internosPorTipo.get(k)!.push(w)
    }
    const autoPorTipo = new Map<number, Record<string, number>>()
    for (const a of automacoes) {
      if (a.tipoProcessoId == null) continue
      const atual = autoPorTipo.get(a.tipoProcessoId) ?? {}
      atual[a.kind] = (atual[a.kind] ?? 0) + a._count._all
      autoPorTipo.set(a.tipoProcessoId, atual)
    }
    const contaPor = <T extends { tipoProcessoId: number | null; _count: { _all: number } }>(rows: T[]) => {
      const m = new Map<number | null, number>()
      for (const r of rows) m.set(r.tipoProcessoId, (m.get(r.tipoProcessoId) ?? 0) + r._count._all)
      return m
    }
    const matrizPor = contaPor(matriz)
    const configFinPor = contaPor(configsFin)

    // UMA LINHA POR (Tipo × Modalidade HABILITADA) — desde que um Tipo possa ter
    // um Workflow Macro por modalidade (mandato "Reconstrução da hierarquia",
    // 22/09/2026), "a configuração deste tipo" deixou de ser uma coisa só:
    // SLA/fases/versões são fatos de CADA combinação, não do Tipo sozinho.
    const out = tipos.flatMap((t) => (t.modalidadesHabilitadas.length > 0 ? t.modalidadesHabilitadas : [null]).map((hab) => {
      const macro = hab ? t.macroWorkflows.find((m) => m.modalidadeId === hab.modalidadeId) ?? null : (t.macroWorkflows[0] ?? null)
      const wfDoTipo = [...(internosPorTipo.get(t.id) ?? []), ...(internosPorTipo.get(null) ?? [])]
      const fases = (macro?.fases ?? []).map((f) => ({
        phaseKey: f.phaseKey,
        label: f.label,
        ordem: f.ordem,
        required: f.required,
        conditional: f.conditional,
        entryRule: f.entryRule,
        showInKanban: f.showInKanban,
        versao: f.versao,
        // workflow interno que atende esta fase (específico do tipo vence o global)
        interno: (() => {
          const w = wfDoTipo.find((x) => x.phaseKey === f.phaseKey)
          if (!w) return null
          return {
            name: w.name,
            versao: w.versao,
            global: w.tipoProcessoId == null,
            passos: w.passos.map((p) => ({
              key: p.key, label: p.label, ordem: p.ordem, required: p.required,
              createsTask: p.createsTask, slaDays: p.slaDays, versao: p.versao,
            })),
          }
        })(),
      }))
      const auto = autoPorTipo.get(t.id) ?? {}
      return {
        id: t.id,
        // Chave única de LINHA (um Tipo pode gerar 2 linhas, 1 por modalidade
        // habilitada) — consumidores que precisam de key/identidade de linha
        // usam esta, nunca `id` sozinho.
        rowKey: hab ? `${t.id}:${hab.modalidadeId}` : `${t.id}`,
        code: t.code,
        name: t.name,
        // Apresentação derivada da relação canônica.
        countryKey: t.pais.countryKey,
        countryLabel: t.pais.countryLabel,
        nationalityLabel: t.pais.nationalityLabel,
        modalidadeId: hab?.modalidadeId ?? null,
        modalityKey: hab?.modalidade.modalityKey ?? null,
        modalityLabel: hab?.modalidade.modalityLabel ?? null,
        processFamily: t.processFamily,
        serviceNature: t.serviceNature,
        ativo: t.ativo,
        arquivado: t.arquivado,
        criadoEm: t.criadoEm,
        atualizadoEm: t.atualizadoEm,
        macro: macro ? { id: macro.id, name: macro.name, ativo: macro.ativo, versao: macro.versao } : null,
        fases,
        contagens: {
          fases: fases.length,
          fasesNoKanban: fases.filter((f) => f.showInKanban).length,
          fasesComInterno: fases.filter((f) => f.interno).length,
          passos: fases.reduce((s, f) => s + (f.interno?.passos.length ?? 0), 0),
          automacoesFinanceiras: auto.financial ?? 0,
          automacoesEvento: auto.event ?? 0,
          automacoesProtocolo: auto.protocol ?? 0,
          regrasDocumentais: matrizPor.get(t.id) ?? 0,
          configsFinanceiras: configFinPor.get(t.id) ?? 0,
        },
      }
    }))

    return NextResponse.json({ tipos: out, catalogoFases })
  } catch (e) {
    console.error('GET configuracao-processo', e)
    return NextResponse.json({ error: 'Erro ao carregar a configuração dos processos.' }, { status: 500 })
  }
}
