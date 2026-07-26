// src/app/api/gerenciamento/configuracao-processo/route.ts
//
// READ-MODEL ÚNICO da configuração por Tipo de Processo. SOMENTE LEITURA —
// não escreve, não aplica regra, não duplica fonte de verdade: apenas projeta o
// que já existe (MacroWorkflow/FaseMacro, PhaseInternalWorkflow/Step,
// PhaseAutomationRule, PhaseInternalMode, MatrizDocumental, ProdutoFinanceiro).
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
    const [tipos, internos, automacoes, variacoes, matriz, configsFin, catalogoFases] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        orderBy: [{ countryLabel: 'asc' }, { name: 'asc' }],
        include: { macroWorkflow: { include: { fases: { orderBy: { ordem: 'asc' } } } } },
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
      prisma.phaseInternalMode.groupBy({
        by: ['tipoProcessoId'],
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
    const variacoesPor = contaPor(variacoes)
    const matrizPor = contaPor(matriz)
    const configFinPor = contaPor(configsFin)

    const out = tipos.map((t) => {
      const macro = t.macroWorkflow
      const wfDoTipo = [...(internosPorTipo.get(t.id) ?? []), ...(internosPorTipo.get(null) ?? [])]
      const fases = (macro?.fases ?? []).map((f) => ({
        phaseKey: f.phaseKey,
        label: f.label,
        ordem: f.ordem,
        required: f.required,
        conditional: f.conditional,
        entryRule: f.entryRule,
        slaDays: f.slaDays,
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
        code: t.code,
        name: t.name,
        countryKey: t.countryKey,
        countryLabel: t.countryLabel,
        nationalityLabel: t.nationalityLabel,
        modalityKey: t.modalityKey,
        modalityLabel: t.modalityLabel,
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
          variacoes: variacoesPor.get(t.id) ?? 0,
          regrasDocumentais: matrizPor.get(t.id) ?? 0,
          configsFinanceiras: configFinPor.get(t.id) ?? 0,
        },
      }
    })

    return NextResponse.json({ tipos: out, catalogoFases })
  } catch (e) {
    console.error('GET configuracao-processo', e)
    return NextResponse.json({ error: 'Erro ao carregar a configuração dos processos.' }, { status: 500 })
  }
}
