// app/api/app/processos/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';

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
      include: {
        // Contar tarefas de nível raiz (containers/atividades)
        tarefas: {
          where: { tarefaPaiId: null },
          select: {
            id: true,
            titulo: true,
            concluida: true,
            statusTarefa: true,
            ordem: true,
            // Contar subtarefas
            subtarefas: {
              select: {
                id: true,
                concluida: true,
                statusTarefa: true,
              },
            },
          },
          orderBy: { ordem: 'asc' },
        },
        contratantes: {
          include: {
            contratante: { select: { nome: true } },
          },
        },
        requerentes: {
          include: {
            requerente: { select: { nome: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Formatar resposta
    const processosFormatados = processos.map((processo) => {
      // Calcular progresso geral
      const tarefasRaiz = processo.tarefas;
      const totalTarefas = tarefasRaiz.length;
      const tarefasConcluidas = tarefasRaiz.filter((t) => {
        // Uma tarefa é "efetivamente concluída" se:
        // - Ela própria está concluída, OU
        // - Todas as subtarefas estão concluídas
        if (t.concluida) return true;
        if (t.subtarefas.length > 0) {
          return t.subtarefas.every((s) => s.concluida);
        }
        return false;
      }).length;

      const progresso = totalTarefas > 0 ? Math.round((tarefasConcluidas / totalTarefas) * 100) : 0;

      // Determinar status visual do processo
      let statusVisual: 'finalizado' | 'em_execucao' | 'pendente' = 'pendente';
      if (progresso === 100) statusVisual = 'finalizado';
      else if (progresso > 0) statusVisual = 'em_execucao';

      return {
        id: processo.id,
        nome: processo.nome,
        pais: processo.pais,
        etapaAtual: processo.faseAtualKey ?? null,
        progresso,
        totalTarefas,
        tarefasConcluidas,
        statusVisual,
        dataInicio: processo.dataInicio,
        // Tarefas de nível raiz com progresso individual
        tarefas: tarefasRaiz.map((t) => {
          const totalSub = t.subtarefas.length;
          const subConcluidas = t.subtarefas.filter((s) => s.concluida).length;
          const efetivamenteConcluida = t.concluida || (totalSub > 0 && subConcluidas === totalSub);

          return {
            id: t.id,
            titulo: t.titulo,
            concluida: efetivamenteConcluida,
            totalSubtarefas: totalSub,
            subtarefasConcluidas: subConcluidas,
            progresso: totalSub > 0 ? Math.round((subConcluidas / totalSub) * 100) : (efetivamenteConcluida ? 100 : 0),
          };
        }),
      };
    });

    return NextResponse.json({ processos: processosFormatados });
  } catch (error) {
    console.error('Erro ao buscar processos:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
