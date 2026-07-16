import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verificarPermissao } from '@/src/lib/verificar-permissao';

// CONSOLIDAÇÃO DO AVANÇO DE FASE — type=phase_transition não é mais criável.
// O avanço de fase é exclusivo do PhaseAdvanceService; modelos só descrevem
// EFEITOS. Modelos legados desse tipo permanecem legíveis (histórico), mas não
// podem ser criados nem editados de volta para esse tipo.
const TIPOS_EFEITO_PERMITIDOS = new Set(['task', 'financial', 'document', 'event', 'protocol', 'alert'])
const MSG_TIPO_AVANCO_PROIBIDO =
  'Modelos de automação descrevem apenas EFEITOS. "Avanço de fase" (phase_transition) foi descontinuado: o avanço é controlado pelo Workflow Interno + Workflow Macro via PhaseAdvanceService.'

function slug(s: string) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// GET /api/gerenciamento/modelos-automacao
// -> { modelos: [...] (inclui arquivados), catalogoFases: [{phaseKey,label}] }
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const [modelos, catalogoFases] = await Promise.all([
      prisma.modeloAutomacao.findMany({
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      prisma.catalogoFase.findMany({
        orderBy: { ordemPadrao: 'asc' },
        select: { phaseKey: true, label: true },
      }),
    ]);
    return NextResponse.json({ modelos, catalogoFases });
  } catch (e) {
    console.error('GET modelos-automacao', e);
    return NextResponse.json({ error: 'Erro ao listar modelos de automação.' }, { status: 500 });
  }
}

// POST /api/gerenciamento/modelos-automacao -> cria modelo (usuário)
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const b = await request.json();
    if (!b?.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Dê um nome ao modelo.' }, { status: 400 });
    }
    const tipo = b.type ? String(b.type) : 'task';
    if (tipo === 'phase_transition' || !TIPOS_EFEITO_PERMITIDOS.has(tipo)) {
      return NextResponse.json({ error: MSG_TIPO_AVANCO_PROIBIDO, code: 'PHASE_TRANSITION_PROIBIDO' }, { status: 422 });
    }
    const name = String(b.name).trim();
    const templateKey = `${slug(name) || 'auto_tpl'}-${Date.now().toString(36)}`;

    const modelo = await prisma.modeloAutomacao.create({
      data: {
        templateKey,
        name,
        description: b.description ? String(b.description) : null,
        type: tipo,
        category: b.category ? String(b.category) : null,
        recommendedPhases: Array.isArray(b.recommendedPhases) ? b.recommendedPhases : [],
        scope: b.scope ? String(b.scope) : 'phase',
        trigger: b.trigger ? String(b.trigger) : null,
        action: b.action ? String(b.action) : null,
        conditions: Array.isArray(b.conditions) ? b.conditions : [],
        defaultParams: b.defaultParams && typeof b.defaultParams === 'object' ? b.defaultParams : {},
        idempotencyPattern: b.idempotencyPattern ? String(b.idempotencyPattern) : 'processId+phaseKey',
        isSystemTemplate: false,
        arquivado: !!b.arquivado,
      },
    });
    return NextResponse.json({ modelo }, { status: 201 });
  } catch (e) {
    console.error('POST modelos-automacao', e);
    return NextResponse.json({ error: 'Erro ao criar modelo de automação.' }, { status: 500 });
  }
}