import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verificarPermissao } from '@/src/lib/verificar-permissao';

// PUT /api/gerenciamento/modos-fase/[id]
// Edita o modo aplicado OU faz toggle de arquivamento (mande só { arquivado }).
// NÃO altera key/modeUid/tipoProcessoId/phaseKey (a identidade do modo é fixa).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const { id } = await params;
    const modoId = Number(id);
    const b = await request.json();

    const atual = await prisma.phaseInternalMode.findUnique({ where: { id: modoId } });
    if (!atual) return NextResponse.json({ error: 'Modo não encontrado.' }, { status: 404 });

    const modo = await prisma.phaseInternalMode.update({
      where: { id: modoId },
      data: {
        label: b.label !== undefined ? String(b.label).trim() : atual.label,
        description: b.description !== undefined ? (b.description || null) : atual.description,
        condition: b.condition !== undefined ? (b.condition || null) : atual.condition,
        impactOperational: b.impactOperational !== undefined ? (b.impactOperational || null) : atual.impactOperational,
        impactDocument: b.impactDocument !== undefined ? (b.impactDocument || null) : atual.impactDocument,
        impactFinancial: b.impactFinancial !== undefined ? (b.impactFinancial || null) : atual.impactFinancial,
        impactProtocol: b.impactProtocol !== undefined ? (b.impactProtocol || null) : atual.impactProtocol,
        active: b.active !== undefined ? !!b.active : atual.active,
        arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
      },
    });
    return NextResponse.json({ modo });
  } catch (e) {
    console.error('PUT modos-fase', e);
    return NextResponse.json({ error: 'Erro ao atualizar o modo.' }, { status: 500 });
  }
}

// DELETE /api/gerenciamento/modos-fase/[id]
// Remove o modo aplicado. Se veio de um modelo (templateId), devolve 1 no usedByCount do modelo.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const { id } = await params;
    const modoId = Number(id);

    const atual = await prisma.phaseInternalMode.findUnique({ where: { id: modoId } });
    if (!atual) return NextResponse.json({ error: 'Modo não encontrado.' }, { status: 404 });

    await prisma.phaseInternalMode.delete({ where: { id: modoId } });

    // mantém o usedByCount do modelo honesto
    if (atual.templateId != null) {
      const tpl = await prisma.modeloInternoFase.findUnique({ where: { id: atual.templateId } });
      if (tpl && (tpl.usedByCount || 0) > 0) {
        await prisma.modeloInternoFase.update({
          where: { id: atual.templateId },
          data: { usedByCount: { decrement: 1 } },
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE modos-fase', e);
    return NextResponse.json({ error: 'Erro ao excluir o modo.' }, { status: 500 });
  }
}