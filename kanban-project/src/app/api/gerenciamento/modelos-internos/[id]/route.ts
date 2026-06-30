import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verificarPermissao } from '@/src/lib/verificar-permissao';

// PUT /api/gerenciamento/modelos-internos/[id]
// Edição completa OU toggle de arquivamento (mande só { arquivado }).
// Campos ausentes no body mantêm o valor atual.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const { id } = await params;
    const modeloId = Number(id);
    const b = await request.json();

    const atual = await prisma.modeloInternoFase.findUnique({ where: { id: modeloId } });
    if (!atual) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 });

    const modelo = await prisma.modeloInternoFase.update({
      where: { id: modeloId },
      data: {
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        modeKey: b.modeKey !== undefined ? String(b.modeKey).trim() : atual.modeKey,
        category: b.category !== undefined ? (b.category || null) : atual.category,
        recommendedPhases:
          b.recommendedPhases !== undefined ? b.recommendedPhases : (atual.recommendedPhases ?? []),
        description: b.description !== undefined ? b.description : atual.description,
        conditionOfUse: b.conditionOfUse !== undefined ? b.conditionOfUse : atual.conditionOfUse,
        operationalImpact:
          b.operationalImpact !== undefined ? b.operationalImpact : atual.operationalImpact,
        documentalImpact:
          b.documentalImpact !== undefined ? b.documentalImpact : atual.documentalImpact,
        financialImpact:
          b.financialImpact !== undefined ? b.financialImpact : atual.financialImpact,
        protocolImpact: b.protocolImpact !== undefined ? b.protocolImpact : atual.protocolImpact,
        arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
      },
    });
    return NextResponse.json({ modelo });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json(
        { error: 'Já existe um modelo com essa categoria (fase principal) e chave técnica.' },
        { status: 409 },
      );
    }
    console.error('PUT modelos-internos', e);
    return NextResponse.json({ error: 'Erro ao atualizar modelo interno de fase.' }, { status: 500 });
  }
}

// DELETE /api/gerenciamento/modelos-internos/[id]
// Bloqueado se o modelo já estiver em uso (usedByCount > 0) -> use Arquivar.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const { id } = await params;
    const modeloId = Number(id);

    const atual = await prisma.modeloInternoFase.findUnique({ where: { id: modeloId } });
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

    await prisma.modeloInternoFase.delete({ where: { id: modeloId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE modelos-internos', e);
    return NextResponse.json({ error: 'Erro ao excluir modelo interno de fase.' }, { status: 500 });
  }
}