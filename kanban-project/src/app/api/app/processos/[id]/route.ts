// app/api/app/processos/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = extrairToken(request);
    if (!payload) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const processoId = parseInt(id);

    // Buscar processo e verificar se o cliente tem acesso
    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      include: {
        status: true,
        contratantes: {
          include: { contratante: { select: { id: true, nome: true } } },
        },
        requerentes: {
          include: { requerente: { select: { id: true, nome: true } } },
        },
        // Todas as tarefas com hierarquia completa
        tarefas: {
          where: { tarefaPaiId: null }, // Só raiz
          include: {
            subtarefas: {
              include: {
                subtarefas: { // Até 3 níveis (container > atividade > subtarefa)
                  select: {
                    id: true,
                    titulo: true,
                    concluida: true,
                    statusTarefa: true,
                    ordem: true,
                    dataConclusao: true,
                  },
                  orderBy: { ordem: 'asc' },
                },
              },
              orderBy: { ordem: 'asc' },
            },
          },
          orderBy: { ordem: 'asc' },
        },
      },
    });

    if (!processo) {
      return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 });
    }

    // Verificar se o cliente tem acesso a este processo
    const temAcesso =
      (payload.contratanteId && processo.contratantes.some((c) => c.contratanteId === payload.contratanteId)) ||
      (payload.requerenteId && processo.requerentes.some((r) => r.requerenteId === payload.requerenteId));

    if (!temAcesso) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    // Buscar todas as etapas (status) do país para mostrar a timeline
    const etapas = await prisma.status.findMany({
      where: { pais: processo.pais },
      orderBy: { ordem: 'asc' },
    });

    // Formatar tarefas em hierarquia
    const tarefasFormatadas = processo.tarefas.map((tarefa) => {
      const subtarefas = tarefa.subtarefas.map((sub) => {
        const subSubs = sub.subtarefas || [];
        const totalSubSub = subSubs.length;
        const subSubConcluidas = subSubs.filter((ss) => ss.concluida).length;
        const efetivamenteConcluida = sub.concluida || (totalSubSub > 0 && subSubConcluidas === totalSubSub);

        return {
          id: sub.id,
          titulo: sub.titulo,
          concluida: efetivamenteConcluida,
          statusTarefa: sub.statusTarefa,
          dataConclusao: sub.dataConclusao,
          subtarefas: subSubs.map((ss) => ({
            id: ss.id,
            titulo: ss.titulo,
            concluida: ss.concluida,
            statusTarefa: ss.statusTarefa,
            dataConclusao: ss.dataConclusao,
          })),
          totalSubtarefas: totalSubSub,
          subtarefasConcluidas: subSubConcluidas,
          progresso: totalSubSub > 0 ? Math.round((subSubConcluidas / totalSubSub) * 100) : (efetivamenteConcluida ? 100 : 0),
        };
      });

      const totalSubs = subtarefas.length;
      const subsConcluidas = subtarefas.filter((s) => s.concluida).length;
      const efetivamenteConcluida = tarefa.concluida || (totalSubs > 0 && subsConcluidas === totalSubs);

      return {
        id: tarefa.id,
        titulo: tarefa.titulo,
        concluida: efetivamenteConcluida,
        statusTarefa: tarefa.statusTarefa,
        subtarefas,
        totalSubtarefas: totalSubs,
        subtarefasConcluidas: subsConcluidas,
        progresso: totalSubs > 0 ? Math.round((subsConcluidas / totalSubs) * 100) : (efetivamenteConcluida ? 100 : 0),
      };
    });

    // Progresso geral
    const totalTarefas = tarefasFormatadas.length;
    const tarefasConcluidas = tarefasFormatadas.filter((t) => t.concluida).length;
    const progressoGeral = totalTarefas > 0 ? Math.round((tarefasConcluidas / totalTarefas) * 100) : 0;

    return NextResponse.json({
      id: processo.id,
      nome: processo.nome,
      pais: processo.pais,
      etapaAtual: processo.status?.nome ?? processo.faseAtualKey ?? null,
      etapaAtualOrdem: processo.status?.ordem ?? null,
      dataInicio: processo.dataInicio,
      previsaoTermino: processo.previsaoTermino,
      progressoGeral,
      totalTarefas,
      tarefasConcluidas,
      // Timeline de etapas
      etapas: etapas.map((e) => ({
        id: e.id,
        nome: e.nome,
        ordem: e.ordem,
        atual: e.id === processo.statusId,
        concluida: processo.status ? e.ordem < processo.status.ordem : false,
      })),
      // Tarefas com hierarquia
      tarefas: tarefasFormatadas,
      // Pessoas envolvidas
      contratantes: processo.contratantes.map((c) => ({
        id: c.contratante.id,
        nome: c.contratante.nome,
      })),
      requerentes: processo.requerentes.map((r) => ({
        id: r.requerente.id,
        nome: r.requerente.nome,
      })),
    });
  } catch (error) {
    console.error('Erro ao buscar processo:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
