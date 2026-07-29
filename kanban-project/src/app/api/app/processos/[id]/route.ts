// app/api/app/processos/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extrairToken } from '@/src/lib/app-auth';
import {
  FASES,
  phaseKeyToFaseCode,
  getStepsForFase,
  getProcessSteps,
} from '@/src/lib/process-stage/fases-catalog';
import { resolveOperationalProjection } from '@/src/lib/process-stage/operational-projection';

// Rótulos amigáveis dos tipos de documento (mesma lista da Central Operacional).
const TIPO_LABELS: Record<string, string> = {
  CERTIDAO_NASCIMENTO: 'Certidão de Nascimento',
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: 'Certidão de Nascimento (inteiro teor)',
  CERTIDAO_CASAMENTO: 'Certidão de Casamento',
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: 'Certidão de Casamento (inteiro teor)',
  CERTIDAO_OBITO: 'Certidão de Óbito',
  CERTIDAO_OBITO_INTEIRO_TEOR: 'Certidão de Óbito (inteiro teor)',
  CERTIDAO_BATISMO: 'Certidão de Batismo',
  CNN: 'CNN',
  CARTA_NATURALIZACAO: 'Carta de Naturalização',
  RG: 'RG',
  CPF: 'CPF',
  CNH: 'CNH',
  PASSAPORTE_BRASILEIRO: 'Passaporte brasileiro',
  TITULO_ELEITOR: 'Título de Eleitor',
  RESERVISTA: 'Reservista',
  PASSAPORTE_ESTRANGEIRO: 'Passaporte estrangeiro',
  CERTIDAO_CIDADANIA_ESTRANGEIRA: 'Certidão de Cidadania',
  COMPROVANTE_RESIDENCIA: 'Comprovante de Residência',
  TRADUCAO_JURAMENTADA: 'Tradução Juramentada',
  APOSTILA_HAIA: 'Apostila de Haia',
  FOTO_3X4: 'Foto 3x4',
  PROCURACAO: 'Procuração',
  ARVORE_GENEALOGICA_DOC: 'Árvore Genealógica',
  OUTRO: 'Documento',
};

// Estados do passo traduzidos para o que o CLIENTE precisa entender.
// Vocabulário interno (bloqueio, falha, aprovação) não é exposto.
const STATUS_CONCLUIDO = ['CONCLUIDO', 'EXECUTADO', 'DISPENSADO'];
const STATUS_EM_ANDAMENTO = [
  'DISPONIVEL',
  'EM_ANDAMENTO',
  'AGUARDANDO',
  'AGUARDANDO_APROVACAO',
  'BLOQUEADO',
  'FALHOU',
];
// SUPERSEDIDO e CANCELADO são ruído de reabertura interna — não aparecem.
const STATUS_OCULTOS = ['SUPERSEDIDO', 'CANCELADO'];

function traduzirStatus(status: string): 'concluida' | 'em_andamento' | 'a_fazer' {
  if (STATUS_CONCLUIDO.includes(status)) return 'concluida';
  if (STATUS_EM_ANDAMENTO.includes(status)) return 'em_andamento';
  return 'a_fazer';
}

function humanizar(stepKey: string): string {
  const texto = stepKey.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

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

    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      include: {
        contratantes: {
          include: { contratante: { select: { id: true, publicCode: true, nome: true } } },
        },
        requerentes: {
          include: { requerente: { select: { id: true, publicCode: true, nome: true } } },
        },
      },
    });

    if (!processo) {
      return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 });
    }

    // Verificar se o cliente tem acesso a este processo
    const temAcesso =
      (payload.contratanteId &&
        processo.contratantes.some((c) => c.contratanteId === payload.contratanteId)) ||
      (payload.requerenteId &&
        processo.requerentes.some((r) => r.requerenteId === payload.requerenteId));

    if (!temAcesso) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    // ── Timeline de etapas, montada a partir do catálogo de fases ──────────
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

    // ── Progresso: FONTE OFICIAL (mesma do Kanban e do cabeçalho interno) ──
    // Nunca calcular progresso por conta própria aqui: o número que o cliente
    // vê tem que ser idêntico ao que a equipe vê.
    const projection = await resolveOperationalProjection(processoId);
    const progressoGeral = projection.progress.percentage;
    const totalEtapasFase = projection.metrics.required;
    const etapasConcluidasFase = projection.metrics.completed;

    // ── Andamento: passos reais da fase atual (runtime v2) ─────────────────
    const instancia = processo.faseAtualKey
      ? await prisma.phaseWorkflowInstance.findFirst({
          where: {
            processoId,
            faseMacroKey: processo.faseAtualKey,
            status: { in: ['ATIVO', 'AGUARDANDO', 'BLOQUEADO'] },
          },
          orderBy: { ciclo: 'desc' },
          include: {
            steps: {
              orderBy: { ordem: 'asc' },
              include: {
                documento: {
                  select: {
                    tipo: true,
                    pessoa: { select: { nome: true, sobrenome: true } },
                  },
                },
                necessidade: {
                  select: {
                    itemCatalogo: { select: { name: true } },
                    pessoa: { select: { nome: true, sobrenome: true } },
                  },
                },
              },
            },
          },
        })
      : null;

    // Títulos vêm do catálogo de fases (fonte da verdade), não do banco.
    const titulosPorStepKey = new Map<string, string>();
    if (faseAtualCode) {
      for (const s of getStepsForFase(faseAtualCode)) titulosPorStepKey.set(s.stepKey, s.title);
      for (const s of getProcessSteps(faseAtualCode)) titulosPorStepKey.set(s.stepKey, s.title);
    }

    const nomeDe = (p?: { nome: string; sobrenome: string | null } | null) =>
      p ? `${p.nome}${p.sobrenome ? ' ' + p.sobrenome : ''}` : null;

    const andamento = (instancia?.steps ?? [])
      .filter((s) => !STATUS_OCULTOS.includes(String(s.status)))
      .map((s) => {
        const docLabel = s.documento?.tipo
          ? TIPO_LABELS[s.documento.tipo] ?? 'Documento'
          : null;
        const necLabel = s.necessidade?.itemCatalogo?.name ?? null;
        const pessoaNome =
          nomeDe(s.documento?.pessoa) ?? nomeDe(s.necessidade?.pessoa) ?? null;

        return {
          id: s.id,
          titulo: titulosPorStepKey.get(s.stepKey) ?? humanizar(s.stepKey),
          documento: docLabel ?? necLabel,
          pessoa: pessoaNome,
          status: traduzirStatus(String(s.status)),
          concluidaEm: s.completedAt,
        };
      });

    return NextResponse.json({
      id: processo.id,
      nome: processo.nome,
      pais: processo.pais,
      etapaAtual: faseAtual ? faseAtual.label : null,
      etapaAtualOrdem: ordemAtual,
      dataInicio: processo.dataInicio,
      previsaoTermino: processo.previsaoTermino,
      progressoGeral,
      // Contagem da FASE atual (não de tarefas): "X de N" do que falta nesta etapa.
      totalTarefas: totalEtapasFase,
      tarefasConcluidas: etapasConcluidasFase,
      // Timeline de etapas (montada do catálogo de fases)
      etapas,
      // Andamento real da fase atual (runtime v2)
      andamento,
      // LEGADO: o modelo Tarefa não é mais alimentado pelo motor. Mantido vazio
      // para não quebrar telas antigas do app; remover quando a tela for atualizada.
      tarefas: [],
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