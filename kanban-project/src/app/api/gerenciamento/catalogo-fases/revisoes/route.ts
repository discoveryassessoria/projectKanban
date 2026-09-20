// src/app/api/gerenciamento/catalogo-fases/revisoes/route.ts
//
// TELA "VERSÕES" (Gerenciamento → Processos → Configurações → Versões) —
// revisões do CATÁLOGO DE FASES, nunca versões de Workflow Macro/Interno
// (mandato "Catálogo de Fases", correção 20/09/2026, bug 2: "não misture
// versões do Workflow Interno com revisões do Catálogo de Fases").
//
// GET — todas as CatalogoFaseRevisao, mais recente primeiro, com: fase,
// phaseKey, revisão, status, escopo, data, autor, revisão anterior/atual,
// alterações desta revisão em relação à anterior, resultado da publicação e
// resultado da reconciliação (lidos de LogAuditoria — mesma fonte que a
// própria publicação já grava, nenhuma segunda verdade).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

interface Mudanca { campo: string; de: unknown; para: unknown }

function diffRevisoes(atual: {
  label: string; descricao: string | null; escopo: string | null; ordemPadrao: number
  requiredPadrao: boolean; conditionalPadrao: boolean; status: string; efeitosPermitidos: unknown
}, anterior: typeof atual | null): Mudanca[] {
  if (!anterior) return [{ campo: 'criação', de: null, para: 'revisão 1' }]
  const mudancas: Mudanca[] = []
  const campos: Array<keyof typeof atual> = ['label', 'descricao', 'escopo', 'ordemPadrao', 'requiredPadrao', 'conditionalPadrao', 'status']
  for (const c of campos) {
    if (JSON.stringify(atual[c]) !== JSON.stringify(anterior[c])) mudancas.push({ campo: c, de: anterior[c], para: atual[c] })
  }
  if (JSON.stringify(atual.efeitosPermitidos ?? []) !== JSON.stringify(anterior.efeitosPermitidos ?? [])) {
    mudancas.push({ campo: 'efeitosPermitidos', de: anterior.efeitosPermitidos ?? [], para: atual.efeitosPermitidos ?? [] })
  }
  return mudancas
}

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [revisoes, fases, autores, logs] = await Promise.all([
      prisma.catalogoFaseRevisao.findMany({ orderBy: [{ catalogoFaseId: 'asc' }, { revisao: 'asc' }] }),
      prisma.catalogoFase.findMany({ select: { id: true, phaseKey: true, label: true, revisaoAtual: true } }),
      prisma.usuario.findMany({ select: { id: true, nome: true } }),
      // Mesma fonte que PUT catalogo-fases/[id] já escreve: PHASE_CREATED/PHASE_UPDATED
      // trazem `detalhes.revisao` e (quando houve reconciliação) `detalhes.reconciliacao`.
      // ASC de propósito: quando a mesma revisão recebe mais de um log (ex.: a
      // publicação real e uma reenvio idempotente sem mudança), o PRIMEIRO é o
      // que corresponde à transição de verdade — é ele que carrega o resultado
      // da reconciliação, não o reenvio posterior (que não reconciliou nada).
      prisma.logAuditoria.findMany({
        where: { entidade: 'CatalogoFase', acao: { in: ['PHASE_CREATED', 'PHASE_UPDATED', 'PHASE_DISABLED', 'PHASE_ACTIVATED'] } },
        select: { entidadeId: true, acao: true, detalhes: true, criadoEm: true },
        orderBy: { criadoEm: 'asc' },
      }),
    ])
    const faseAtualPorId = new Map(fases.map((f) => [f.id, f]))
    const nomePorAutor = new Map(autores.map((a) => [a.id, a.nome]))
    const porFase = new Map<number, typeof revisoes>()
    for (const r of revisoes) {
      if (!porFase.has(r.catalogoFaseId)) porFase.set(r.catalogoFaseId, [])
      porFase.get(r.catalogoFaseId)!.push(r)
    }

    const linhas = revisoes.map((r) => {
      const doMesmaFase = porFase.get(r.catalogoFaseId) ?? []
      const idx = doMesmaFase.findIndex((x) => x.revisao === r.revisao)
      const anterior = idx > 0 ? doMesmaFase[idx - 1] : null
      const faseAtual = faseAtualPorId.get(r.catalogoFaseId)

      // Log correspondente A ESTA revisão especificamente — casa por
      // `detalhes.revisao` (PHASE_CREATED/PHASE_DISABLED) ou
      // `detalhes.revisao` (PHASE_UPDATED, gravado pelo PUT).
      const logDaRevisao = logs.find((l) => {
        if (l.entidadeId !== r.catalogoFaseId) return false
        const d = l.detalhes as { revisao?: number } | null
        return d?.revisao === r.revisao
      })
      const reconciliacao = (logDaRevisao?.detalhes as { reconciliacao?: { processosAlcancados: number; outboxRegistrados: number } } | null)?.reconciliacao ?? null

      return {
        catalogoFaseId: r.catalogoFaseId,
        fase: r.label,
        phaseKey: r.phaseKey,
        revisao: r.revisao,
        status: r.status,
        escopo: r.escopo,
        data: (logDaRevisao?.criadoEm ?? r.congeladoEm).toISOString(),
        // "removido" (não um número cru) quando o autor não resolve — nunca finge
        // que ninguém agiu (MOTOR) nem inventa nome: diz exatamente o que aconteceu.
        autor: r.congeladoPorId != null ? (nomePorAutor.get(r.congeladoPorId) ?? `usuário removido (#${r.congeladoPorId})`) : 'MOTOR',
        origem: r.origem,
        revisaoAnterior: anterior?.revisao ?? null,
        revisaoAtualDaFase: faseAtual?.revisaoAtual ?? null,
        ehVigente: faseAtual?.revisaoAtual === r.revisao,
        alteracoes: diffRevisoes(r, anterior),
        resultadoPublicacao: logDaRevisao ? 'Publicada com sucesso' : (r.revisao === 1 ? 'Criada com sucesso' : 'Sem registro de auditoria'),
        resultadoReconciliacao: reconciliacao
          ? `${reconciliacao.processosAlcancados} processo(s) alcançado(s), ${reconciliacao.outboxRegistrados} evento(s) de reconciliação registrado(s)`
          : (r.revisao === 1 ? 'Não aplicável (criação — sem processo em andamento a alcançar)' : 'Nenhuma reconciliação disparada (nenhum campo relevante mudou)'),
      }
    })

    linhas.sort((a, b) => b.data.localeCompare(a.data))
    return NextResponse.json({ revisoes: linhas })
  } catch (e) {
    console.error('GET catalogo-fases/revisoes', e)
    return NextResponse.json({ error: 'Erro ao carregar as revisões do catálogo de fases.' }, { status: 500 })
  }
}
