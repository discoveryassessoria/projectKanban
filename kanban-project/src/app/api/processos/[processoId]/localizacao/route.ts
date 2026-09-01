// src/app/api/processos/[processoId]/localizacao/route.ts
// ============================================================================
// ONDE O PROCESSO MORA NO QUADRO — país e tipo, e só isso.
//
// O deep-link operacional carrega IDs: `/kanban?processoId=X&tab=central&taskId=Y`.
// Mas o Kanban não mostra "todos os processos": ele mostra UM país e UM tipo por
// vez. Se quem clica no link está posicionado na Itália e o processo é da
// Espanha, o quadro renderiza sem aquele processo, o modal nunca monta, e o link
// falha em silêncio — sem erro, sem mensagem, só a tela errada.
//
// Colocar `pais` na própria URL resolveria o sintoma e criaria o problema
// clássico: dois lugares dizendo de que país é o processo, e um deles
// envelhecendo quando o processo é corrigido. O país do processo é do PROCESSO;
// a URL pergunta, o servidor responde.
//
// GET puro: posicionar uma tela nunca é motivo para escrever nada.
// ============================================================================

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erro = await verificarPermissao(request, 'processos.ver')
  if (erro) return erro

  const { processoId } = await params
  const id = Number.parseInt(processoId, 10)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  }

  const processo = await prisma.processo.findUnique({
    where: { id },
    select: { id: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, tipoProcessoMotorId: true },
  })
  if (!processo) {
    return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 })
  }

  return NextResponse.json({
    processoId: processo.id,
    pais: (processo.paisCanonico?.countryKey ?? null),
    tipoProcessoMotorId: processo.tipoProcessoMotorId,
  })
}
