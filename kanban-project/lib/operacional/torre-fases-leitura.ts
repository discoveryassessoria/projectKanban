// lib/operacional/torre-fases-leitura.ts — o leitor de servidor da lista única de fases (ver `torre-fases.ts`). SOMENTE LEITURA.
import { prisma } from '@/lib/prisma'
import { rotuloOficialDaFase } from '@/src/lib/process-stage/fase-pre-contrato'
import { montarFasesDaTorre, type FaseDaTorre } from './torre-fases'

export async function lerFasesDaTorre(): Promise<FaseDaTorre[]> {
  const [catalogo, macros] = await Promise.all([
    prisma.catalogoFase.findMany({ where: { ativo: true }, select: { phaseKey: true, label: true, conditionalPadrao: true } }),
    prisma.macroWorkflow.findMany({ select: { fases: { select: { phaseKey: true } } } }),
  ])
  return montarFasesDaTorre(
    catalogo.map((f) => ({ phaseKey: f.phaseKey, label: rotuloOficialDaFase(f.phaseKey, f.label), conditionalPadrao: f.conditionalPadrao })),
    macros.map((m) => m.fases.map((f) => f.phaseKey)),
  )
}
