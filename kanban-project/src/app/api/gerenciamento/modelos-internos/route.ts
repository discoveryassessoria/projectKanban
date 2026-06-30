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

// GET /api/gerenciamento/modelos-internos
// -> { modelos: [...] (inclui arquivados), catalogoFases: [{phaseKey,label}] }
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const [modelos, catalogoFases] = await Promise.all([
      prisma.modeloInternoFase.findMany({
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
      prisma.catalogoFase.findMany({
        orderBy: { ordemPadrao: 'asc' },
        select: { phaseKey: true, label: true },
      }),
    ]);
    return NextResponse.json({ modelos, catalogoFases });
  } catch (e) {
    console.error('GET modelos-internos', e);
    return NextResponse.json({ error: 'Erro ao listar modelos internos de fase.' }, { status: 500 });
  }
}

// POST /api/gerenciamento/modelos-internos  -> cria um modelo (sempre usuário, não-padrão)
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const b = await request.json();
    if (!b?.name || !String(b.name).trim()) {
      return NextResponse.json({ error: 'Dê um nome ao modelo.' }, { status: 400 });
    }
    const name = String(b.name).trim();
    const modeKey = (b.modeKey && String(b.modeKey).trim()) || slug(name);
    const category = b.category ? String(b.category) : null;
    const recommendedPhases = Array.isArray(b.recommendedPhases) ? b.recommendedPhases : [];

    const modelo = await prisma.modeloInternoFase.create({
      data: {
        name,
        modeKey,
        category,
        recommendedPhases,
        description: b.description || null,
        conditionOfUse: b.conditionOfUse || null,
        operationalImpact: b.operationalImpact || null,
        documentalImpact: b.documentalImpact || null,
        financialImpact: b.financialImpact || null,
        protocolImpact: b.protocolImpact || null,
        isSystemTemplate: false,
        arquivado: !!b.arquivado,
      },
    });
    return NextResponse.json({ modelo }, { status: 201 });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json(
        { error: 'Já existe um modelo com essa categoria (fase principal) e chave técnica.' },
        { status: 409 },
      );
    }
    console.error('POST modelos-internos', e);
    return NextResponse.json({ error: 'Erro ao criar modelo interno de fase.' }, { status: 500 });
  }
}