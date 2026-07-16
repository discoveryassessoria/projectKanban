import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verificarPermissao } from '@/src/lib/verificar-permissao';

// PUT /api/gerenciamento/modelos-automacao/[id]
// Edição completa OU toggle de arquivamento (mande só { arquivado }).
// Campos ausentes mantêm o valor atual. `conditions` não vem da tela -> preservado.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const { id } = await params;
    const modeloId = Number(id);
    const b = await request.json();

    const atual = await prisma.modeloAutomacao.findUnique({ where: { id: modeloId } });
    if (!atual) return NextResponse.json({ error: 'Modelo não encontrado.' }, { status: 404 });

    // ARQUITETURA NOVA — não se edita um modelo PARA phase_transition/task/document,
    // e um modelo legado desses tipos não pode ser reativado (desarquivado):
    // fica somente-leitura/arquivado para histórico. Só efeitos adicionais.
    const MSG = 'Modelos de automação descrevem apenas EFEITOS ADICIONAIS (financeiro, evento, protocolo, notificação). "Avanço de fase" é do PhaseAdvanceService; "tarefa"/"documento" obrigatório é do Workflow Interno.';
    const tipoProibido = (t?: string) => t === 'phase_transition' || t === 'task' || t === 'document';
    const novoTipo = b.type !== undefined ? String(b.type) : atual.type;
    if (tipoProibido(novoTipo)) {
      return NextResponse.json({ error: MSG, code: 'AUTOMACAO_PROIBIDA' }, { status: 422 });
    }
    if (tipoProibido(atual.type) && b.arquivado === false) {
      return NextResponse.json({ error: MSG, code: 'AUTOMACAO_LEGADA' }, { status: 422 });
    }

    const modelo = await prisma.modeloAutomacao.update({
      where: { id: modeloId },
      data: {
        name: b.name !== undefined ? String(b.name).trim() : atual.name,
        description: b.description !== undefined ? (b.description || null) : atual.description,
        type: b.type !== undefined ? String(b.type) : atual.type,
        category: b.category !== undefined ? (b.category || null) : atual.category,
        recommendedPhases:
          b.recommendedPhases !== undefined ? b.recommendedPhases : (atual.recommendedPhases ?? []),
        scope: b.scope !== undefined ? (String(b.scope) || 'phase') : atual.scope,
        trigger: b.trigger !== undefined ? (b.trigger || null) : atual.trigger,
        action: b.action !== undefined ? (b.action || null) : atual.action,
        conditions: b.conditions !== undefined ? b.conditions : (atual.conditions ?? []),
        defaultParams:
          b.defaultParams !== undefined ? b.defaultParams : (atual.defaultParams ?? {}),
        idempotencyPattern:
          b.idempotencyPattern !== undefined
            ? (String(b.idempotencyPattern) || 'processId+phaseKey')
            : atual.idempotencyPattern,
        arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
      },
    });
    return NextResponse.json({ modelo });
  } catch (e) {
    console.error('PUT modelos-automacao', e);
    return NextResponse.json({ error: 'Erro ao atualizar modelo de automação.' }, { status: 500 });
  }
}

// DELETE /api/gerenciamento/modelos-automacao/[id]
// Bloqueado se o modelo já estiver em uso (usedByCount > 0) -> use Arquivar.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const { id } = await params;
    const modeloId = Number(id);

    const atual = await prisma.modeloAutomacao.findUnique({ where: { id: modeloId } });
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

    await prisma.modeloAutomacao.delete({ where: { id: modeloId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('DELETE modelos-automacao', e);
    return NextResponse.json({ error: 'Erro ao excluir modelo de automação.' }, { status: 500 });
  }
}