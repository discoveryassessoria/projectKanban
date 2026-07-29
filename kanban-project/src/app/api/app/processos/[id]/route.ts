// app/api/app/processos/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';
import { FASES, phaseKeyToFaseCode } from '@/src/lib/process-stage/fases-catalog';

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
        contratantes: {
          include: { contratante: { select: { id: true, publicCode: true, nome: true } } },
        },
        requerentes: {
          include: { requerente: { select: { id: true, publicCode: true, nome: true } } },
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

    // ── Timeline de etapas, montada a partir do catálogo de fases ──────────
    // fases-catalog.ts é a fonte única da verdade. faseAtualKey do banco é a
    // chave estável (ex.: "genealogia") → converter pro código da fase.
    const faseAtualCode = phaseKeyToFaseCode(processo.faseAtualKey);
    const faseAtual = faseAtualCode ? FASES[faseAtualCode] : null;
    const ordemAtual = faseAtual ? faseAtual.ordem : -1;

    const etapas = Object.values(FASES)
      .sort((a, b) => a.ordem - b.ordem)
      .map((f) => ({
        id: f.ordem,
        nome: f.label,
        ordem: f.ordem,
        atual: f.ordem === ordemAtual,
        concluida: ordemAtual >= 0 && f.ordem < ordemAtual,
      }));

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
      etapaAtual: faseAtual ? faseAtual.label : null,
      etapaAtualOrdem: ordemAtual,
      dataInicio: processo.dataInicio,
      previsaoTermino: processo.previsaoTermino,
      progressoGeral,
      totalTarefas,
      tarefasConcluidas,
      // Timeline de etapas (montada do catálogo de fases)
      etapas,
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