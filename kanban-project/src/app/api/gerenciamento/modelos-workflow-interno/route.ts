import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verificarPermissao } from '@/src/lib/verificar-permissao';

function slug(s: string) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const PRIOS = ['low', 'medium', 'high'];

// normaliza um passo vindo do cliente -> shape do banco (ordem = índice + 1)
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

// GET /api/gerenciamento/modelos-workflow-interno
// -> { modelos: [...] (com passos, inclui arquivados), catalogoFases: [{phaseKey,label}] }
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const [modelos, catalogoFases] = await Promise.all([
      prisma.modeloWorkflowInterno.findMany({
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        include: { passos: { orderBy: { ordem: 'asc' } } },
      }),
      prisma.catalogoFase.findMany({
        orderBy: { ordemPadrao: 'asc' },
        select: { phaseKey: true, label: true },
      }),
    ]);
    return NextResponse.json({ modelos, catalogoFases });
  } catch (e) {
    console.error('GET modelos-workflow-interno', e);
    return NextResponse.json({ error: 'Erro ao listar modelos de workflow interno.' }, { status: 500 });
  }
}

// POST /api/gerenciamento/modelos-workflow-interno -> cria template (usuário) + passos
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const b = await request.json();
    if (!b?.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Dê um nome ao modelo.' }, { status: 400 });
    }
    const name = String(b.name).trim();
    // templateKey único por construção (slug do nome + timestamp base36)
    const templateKey = `${slug(name) || 'iw_tpl'}-${Date.now().toString(36)}`;
    const category = b.category ? String(b.category) : null;
    const recommendedPhases = Array.isArray(b.recommendedPhases) ? b.recommendedPhases : [];
    const passos = Array.isArray(b.steps) ? b.steps.map(normalizeStep) : [];

    const modelo = await prisma.modeloWorkflowInterno.create({
      data: {
        templateKey,
        name,
        description: b.description ? String(b.description) : null,
        category,
        recommendedPhases,
        isSystemTemplate: false,
        arquivado: !!b.arquivado,
        passos: { create: passos },
      },
      include: { passos: { orderBy: { ordem: 'asc' } } },
    });
    return NextResponse.json({ modelo }, { status: 201 });
  } catch (e) {
    console.error('POST modelos-workflow-interno', e);
    return NextResponse.json({ error: 'Erro ao criar modelo de workflow interno.' }, { status: 500 });
  }
}