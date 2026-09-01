// app/api/app/processos/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';
import { FASES, phaseKeyToFaseCode } from '@/src/lib/process-stage/fases-catalog';
import { resolveOperationalProjectionBatch } from '@/src/lib/process-stage/operational-projection';

export async function GET(request: NextRequest) {
  try {
    const payload = extrairToken(request);
    if (!payload) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Buscar processos onde o email do cliente está vinculado
    // como Contratante OU Requerente
    const whereConditions = [];

    if (payload.contratanteId) {
      whereConditions.push({
        contratantes: {
          some: { contratanteId: payload.contratanteId },
        },
      });
    }

    if (payload.requerenteId) {
      whereConditions.push({
        requerentes: {
          some: { requerenteId: payload.requerenteId },
        },
      });
    }

    if (whereConditions.length === 0) {
      return NextResponse.json({ processos: [] });
    }

    const processos = await prisma.processo.findMany({
      where: {
        OR: whereConditions,
      },
      select: {
        id: true,
        nome: true,
        paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } },
        faseAtualKey: true,
        dataInicio: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (processos.length === 0) {
      return NextResponse.json({ processos: [] });
    }

    // ── Progresso: FONTE OFICIAL, em lote ──────────────────────────────────
    // Mesma função usada pelo Kanban: poucas queries agregadas para N
    // processos (sem N+1). Nunca calcular progresso por conta própria aqui —
    // o número que o cliente vê tem que ser idêntico ao da equipe.
    const projecoes = await resolveOperationalProjectionBatch(
      processos.map((p) => p.id)
    );
    const projecaoPorProcesso = new Map(
      processos.map((p, i) => [p.id, projecoes[i]])
    );

    const processosFormatados = processos.map((processo) => {
      const projecao = projecaoPorProcesso.get(processo.id);
      const progresso = projecao?.progress.percentage ?? 0;
      const total = projecao?.metrics.required ?? 0;
      const concluidas = projecao?.metrics.completed ?? 0;

      // Status visual do processo, derivado do progresso da fase atual
      let statusVisual: 'finalizado' | 'em_execucao' | 'pendente' = 'pendente';
      if (progresso === 100) statusVisual = 'finalizado';
      else if (progresso > 0) statusVisual = 'em_execucao';

      // Nome da fase atual pelo catálogo (label bonito, ex.: "Genealogia"),
      // não a chave crua do banco ("genealogia"). Mesma fonte usada na rota
      // de detalhe do processo — mantém as duas telas consistentes.
      const faseAtualCode = phaseKeyToFaseCode(processo.faseAtualKey);
      const etapaAtualLabel = faseAtualCode ? FASES[faseAtualCode].label : null;

      return {
        id: processo.id,
        nome: processo.nome,
        pais: (processo.paisCanonico?.countryKey ?? null),
        etapaAtual: etapaAtualLabel,
        progresso,
        // Contagem da FASE atual (não de tarefas): quanto falta nesta etapa.
        totalTarefas: total,
        tarefasConcluidas: concluidas,
        statusVisual,
        dataInicio: processo.dataInicio,
        // LEGADO: o modelo Tarefa não é mais alimentado pelo motor. Mantido
        // vazio para não quebrar a tela antiga; o detalhe do processo usa o
        // campo `andamento`, com os passos reais da fase.
        tarefas: [],
      };
    });

    return NextResponse.json({ processos: processosFormatados });
  } catch (error) {
    console.error('Erro ao buscar processos:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}