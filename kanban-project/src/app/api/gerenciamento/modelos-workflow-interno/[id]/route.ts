import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verificarPermissao } from '@/src/lib/verificar-permissao';

const PRIOS = ['low', 'medium', 'high'];

function normalizeStep(s: any, i: number) {
  const checklist = Array.isArray(s?.checklist)
    ? s.checklist.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
    : [];
  return {
    ordem: i + 1,
    name: (s?.name && String(s.name).trim()) || `Passo ${i + 1}`,
    description: s?.description ? String(s.description) : null,
    generatesTask: s?.generatesTask !== false,
    required: s?.required !== false,
    defaultResponsibleRole: s?.defaultResponsibleRole ? String(s.defaultResponsibleRole) : null,
    defaultPriority: PRIOS.includes(s?.defaultPriority) ? s.defaultPriority : 'medium',
    defaultSlaDays: Number.isFinite(Number(s?.defaultSlaDays)) ? Number(s.defaultSlaDays) : 0,
    completionCondition: s?.completionCondition ? String(s.completionCondition) : null,
    checklist,
  };
}

// PUT /api/gerenciamento/modelos-workflow-interno/[id]
// Edição completa OU toggle de arquivamento (mande só { arquivado }).
// Se `steps` vier no body, os passos são SUBSTITUÍDOS por inteiro (delete + recreate).
// Se `steps` NÃO vier, os passos ficam intactos (ex.: arquivar/reativar).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const { id } = await params;
    const modeloId = Number(id);
    const b = await request.json();

    const atual = await prisma.modeloWorkflowInterno.findUnique({ where: { id: modeloId } });
    if (!atual) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 });

    const stepsProvided = Array.isArray(b.steps);
    const novosPassos = stepsProvided ? b.steps.map(normalizeStep) : [];

    await prisma.$transaction(async (tx) => {
      await tx.modeloWorkflowInterno.update({
        where: { id: modeloId },
        data: {
          name: b.name !== undefined ? String(b.name).trim() : atual.name,
          description: b.description !== undefined ? (b.description || null) : atual.description,
          category: b.category !== undefined ? (b.category || null) : atual.category,
          recommendedPhases:
            b.recommendedPhases !== undefined ? b.recommendedPhases : (atual.recommendedPhases ?? []),
          arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
        },
      });
      if (stepsProvided) {
        await tx.passoWorkflowInterno.deleteMany({ where: { modeloId } });
        if (novosPassos.length) {
          await tx.passoWorkflowInterno.createMany({
            data: novosPassos.map((p: any) => ({ ...p, modeloId })),
          });
        }
      }
    });

    const modelo = await prisma.modeloWorkflowInterno.findUnique({
      where: { id: modeloId },
      include: { passos: { orderBy: { ordem: 'asc' } } },
    });
    return NextResponse.json({ modelo });
  } catch (e) {
    console.error('PUT modelos-workflow-interno', e);
    return NextResponse.json({ error: 'Erro ao atualizar modelo de workflow interno.' }, { status: 500 });
  }
}

// DELETE /api/gerenciamento/modelos-workflow-interno/[id]
// Bloqueado se o modelo já estiver em uso (usedByCount > 0) -> use Arquivar.
// (os passos somem junto por cascade)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const { id } = await params;
    const modeloId = Number(id);

    const atual = await prisma.modeloWorkflowInterno.findUnique({ where: { id: modeloId } });
    if (!atual) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 });

    if ((atual.usedByCount || 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Este modelo já está sendo usado em fases de Processos de Nacionalidade. Não pode ser excluído — use Arquivar.',
        },
        { status: 409 },
      );
    }

    await prisma.modeloWorkflowInterno.delete({ where: { id: modeloId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE modelos-workflow-interno', e);
    return NextResponse.json({ error: 'Erro ao excluir modelo de workflow interno.' }, { status: 500 });
  }
}