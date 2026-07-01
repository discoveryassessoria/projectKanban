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

const uid = (tipoProcessoId: number | null, phaseKey: string, key: string) =>
  `${tipoProcessoId ?? 'all'}::${phaseKey}::${key}`;

// GET /api/gerenciamento/modos-fase
// -> { tiposProcesso: [{id,name,fases:[{phaseKey,label,ordem}]}], modos: [...], modelosInternos: [...] }
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const [tiposRaw, modos, modelosInternos] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { arquivado: false },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          macroWorkflow: {
            select: {
              fases: {
                orderBy: { ordem: 'asc' },
                select: { phaseKey: true, label: true, ordem: true },
              },
            },
          },
        },
      }),
      prisma.phaseInternalMode.findMany({ orderBy: { criadoEm: 'asc' } }),
      prisma.modeloInternoFase.findMany({
        where: { arquivado: false },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          modeKey: true,
          category: true,
          recommendedPhases: true,
          description: true,
          conditionOfUse: true,
          operationalImpact: true,
          documentalImpact: true,
          financialImpact: true,
          protocolImpact: true,
          isSystemTemplate: true,
        },
      }),
    ]);
    const tiposProcesso = tiposRaw.map((t) => ({
      id: t.id,
      name: t.name,
      fases: t.macroWorkflow?.fases || [],
    }));
    return NextResponse.json({ tiposProcesso, modos, modelosInternos });
  } catch (e) {
    console.error('GET modos-fase', e);
    return NextResponse.json({ error: 'Erro ao carregar modos das fases.' }, { status: 500 });
  }
}

// POST /api/gerenciamento/modos-fase
//   Ad-hoc:  { tipoProcessoId, phaseKey, label, description?, condition?, impactos..., active? }
//   Aplicar: { aplicar: true, tipoProcessoId, phaseKey, templateIds: number[] }
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const b = await request.json();
    const tipoProcessoId: number | null = b?.tipoProcessoId != null ? Number(b.tipoProcessoId) : null;
    const phaseKey: string = b?.phaseKey ? String(b.phaseKey) : '';
    if (!phaseKey) return NextResponse.json({ error: 'Selecione uma fase.' }, { status: 400 });

    // ----- APLICAR modelos da biblioteca (2A) -----
    if (b?.aplicar) {
      const ids: number[] = Array.isArray(b.templateIds) ? b.templateIds.map(Number) : [];
      if (!ids.length) return NextResponse.json({ error: 'Selecione ao menos um modelo.' }, { status: 400 });
      let aplicados = 0;
      let jaExistiam = 0;
      for (const tid of ids) {
        const tpl = await prisma.modeloInternoFase.findUnique({ where: { id: tid } });
        if (!tpl || tpl.arquivado) continue;
        const key = tpl.modeKey;
        const modeUid = uid(tipoProcessoId, phaseKey, key);
        const existe = await prisma.phaseInternalMode.findUnique({ where: { modeUid } });
        if (existe) {
          jaExistiam++;
          continue;
        }
        await prisma.phaseInternalMode.create({
          data: {
            modeUid,
            templateId: tpl.id,
            tipoProcessoId,
            phaseKey,
            key,
            label: tpl.name,
            description: tpl.description,
            condition: tpl.conditionOfUse,
            impactOperational: tpl.operationalImpact,
            impactDocument: tpl.documentalImpact,
            impactFinancial: tpl.financialImpact,
            impactProtocol: tpl.protocolImpact,
            active: true,
          },
        });
        await prisma.modeloInternoFase.update({
          where: { id: tpl.id },
          data: { usedByCount: { increment: 1 } },
        });
        aplicados++;
      }
      return NextResponse.json({ aplicados, jaExistiam }, { status: 201 });
    }

    // ----- AD-HOC (criar modo direto) -----
    const label = b?.label ? String(b.label).trim() : '';
    if (!label) return NextResponse.json({ error: 'Informe o nome do modo.' }, { status: 400 });
    const key = slug(label) || `modo_${Date.now().toString(36)}`;
    const modeUid = uid(tipoProcessoId, phaseKey, key);
    const existe = await prisma.phaseInternalMode.findUnique({ where: { modeUid } });
    if (existe) {
      return NextResponse.json({ error: 'Já existe um modo com essa chave nesta fase.' }, { status: 409 });
    }
    const modo = await prisma.phaseInternalMode.create({
      data: {
        modeUid,
        templateId: null,
        tipoProcessoId,
        phaseKey,
        key,
        label,
        description: b.description ? String(b.description) : null,
        condition: b.condition ? String(b.condition) : null,
        impactOperational: b.impactOperational ? String(b.impactOperational) : null,
        impactDocument: b.impactDocument ? String(b.impactDocument) : null,
        impactFinancial: b.impactFinancial ? String(b.impactFinancial) : null,
        impactProtocol: b.impactProtocol ? String(b.impactProtocol) : null,
        active: b.active !== false,
      },
    });
    return NextResponse.json({ modo }, { status: 201 });
  } catch (e) {
    console.error('POST modos-fase', e);
    return NextResponse.json({ error: 'Erro ao salvar o modo da fase.' }, { status: 500 });
  }
}