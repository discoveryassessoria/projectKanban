// lib/financeiro/leitura/posicao-processo.ts
// ============================================================================
// POSIÇÃO FINANCEIRA POR PROCESSO (Motor Financeiro V3 · Fase 3). Agrega, para um
// processo, TODAS as obrigações com sua posição completa (derivada do Ledger),
// os responsáveis contratuais (Contratante) e os nomes dos requerentes/pagadores.
// Fonte exclusiva: Ledger/projeções V3 (o legado não é fonte aqui).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { carregarPosicao, type PosicaoFinanceira } from './posicao-service'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface PosicaoProcesso {
  processoId: number
  processo: { codigo: string | null; nome: string; pais: string | null } | null
  totais: { contratado: number; saldo: number; recebido: number; obrigacoes: number }
  responsaveis: { id: number; nome: string; cpf: string | null }[]
  nomesPessoas: Record<number, string> // pessoaId → nome (requerentes/pagadores)
  obrigacoes: PosicaoFinanceira[]
}

/** Carrega a posição financeira consolidada de um processo (tudo do Ledger). */
export async function carregarPosicaoProcesso(processoId: number): Promise<PosicaoProcesso> {
  const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { codigo: true, nome: true, paisCanonico: { select: { countryKey: true } } } })
  const obrs = await prisma.obrigacaoEconomica.findMany({ where: { processoId }, select: { id: true }, orderBy: { id: 'asc' } })

  const posicoes: PosicaoFinanceira[] = []
  for (const o of obrs) {
    const p = await carregarPosicao({ obrigacaoId: o.id })
    if (p) posicoes.push(p)
  }

  // responsáveis contratuais (Contratante do processo)
  const vinculos = await prisma.processoContratante.findMany({ where: { processoId }, select: { contratanteId: true } })
  const contratantes = vinculos.length
    ? await prisma.contratante.findMany({ where: { id: { in: vinculos.map((v) => v.contratanteId) } }, select: { id: true, nome: true, cpf: true } })
    : []

  // nomes de pessoas (requerentes das distribuições + pagadores internos)
  const pessoaIds = new Set<number>()
  for (const p of posicoes) {
    p.posicaoRequerentes.forEach((r) => pessoaIds.add(r.pessoaId))
    p.timeline.forEach((t) => { if (t.pagador?.pessoaId != null) pessoaIds.add(t.pagador.pessoaId) })
  }
  const pessoas = pessoaIds.size
    ? await prisma.pessoa.findMany({ where: { id: { in: [...pessoaIds] } }, select: { id: true, nome: true, sobrenome: true } })
    : []
  const nomesPessoas: Record<number, string> = {}
  for (const p of pessoas) nomesPessoas[p.id] = [p.nome, p.sobrenome].filter(Boolean).join(' ')

  // "Recebido" é métrica de RECEBÍVEL — não mistura com a baixa de custos (A_PAGAR).
  const receb = posicoes.filter((p) => p.direcao !== 'A_PAGAR')
  const totais = {
    contratado: cent(posicoes.reduce((s, p) => s + p.valorContratado, 0)),
    saldo: cent(posicoes.reduce((s, p) => s + p.saldo, 0)),
    recebido: cent(receb.reduce((s, p) => s + p.recebidoBruto, 0)),
    obrigacoes: posicoes.length,
  }

  // O DTO expõe `pais` como APRESENTAÇÃO, derivado da identidade — o consumidor
  // não precisa saber que houve migração, e a coluna legada não é lida.
  const processoDto = processo
    ? { codigo: processo.codigo, nome: processo.nome, pais: processo.paisCanonico?.countryKey ?? null }
    : null
  return { processoId, processo: processoDto, totais, responsaveis: contratantes, nomesPessoas, obrigacoes: posicoes }
}
