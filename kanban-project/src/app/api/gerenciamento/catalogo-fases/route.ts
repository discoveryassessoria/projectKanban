// src/app/api/gerenciamento/catalogo-fases/route.ts
//
// CATÁLOGO DE FASES (CatalogoFase) — cadastro ÚNICO das fases do sistema.
// ARQUITETURA: fases são cadastradas EXCLUSIVAMENTE aqui (Gerenciamento →
// Processos → Estrutura → Fases). O Workflow apenas REFERENCIA estas fases
// (Workflow Macro monta a sequência a partir deste catálogo). Nenhum outro
// módulo cria cadastro paralelo de fases.
//
// Aditivo: usa a tabela CatalogoFase que já existia (antes só semeada/lida pelo
// bootstrap de /api/gerenciamento/workflow-macro). Nenhuma migration.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// "Emissão de Certidões" -> "emissao_de_certidoes"
function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// GET — catálogo completo + em quantos fluxos (FaseMacro) cada fase é usada.
// O "usos" é o que impede exclusão silenciosa de uma fase em produção.
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [fases, usos] = await Promise.all([
      prisma.catalogoFase.findMany({ orderBy: [{ ordemPadrao: 'asc' }, { label: 'asc' }] }),
      prisma.faseMacro.groupBy({ by: ['phaseKey'], _count: { _all: true } }),
    ])
    const usoPorKey = new Map(usos.map((u) => [u.phaseKey, u._count._all]))
    return NextResponse.json({
      fases: fases.map((f) => ({ ...f, usos: usoPorKey.get(f.phaseKey) ?? 0 })),
    })
  } catch (e) {
    console.error('GET catalogo-fases', e)
    return NextResponse.json({ error: 'Erro ao carregar o catálogo de fases.' }, { status: 500 })
  }
}

// POST — cria uma fase no catálogo.
export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const b = await request.json().catch(() => ({}))
    const label = String(b?.label || '').trim()
    if (!label) return NextResponse.json({ error: 'Informe o nome da fase.' }, { status: 400 })

    const phaseKey = (String(b?.phaseKey || '').trim() || slug(label)).slice(0, 60)
    if (!phaseKey) return NextResponse.json({ error: 'Não foi possível gerar a chave da fase.' }, { status: 400 })

    const jaExiste = await prisma.catalogoFase.findUnique({ where: { phaseKey } })
    if (jaExiste) return NextResponse.json({ error: `Já existe uma fase com a chave "${phaseKey}".` }, { status: 409 })

    const fase = await prisma.catalogoFase.create({
      data: {
        phaseKey,
        label,
        ordemPadrao: Number.isFinite(Number(b?.ordemPadrao)) ? Number(b.ordemPadrao) : 0,
        requiredPadrao: b?.requiredPadrao !== false,
        conditionalPadrao: !!b?.conditionalPadrao,
        slaDiasPadrao: Number.isFinite(Number(b?.slaDiasPadrao)) ? Number(b.slaDiasPadrao) : 30,
        ativo: b?.ativo !== false,
      },
    })
    return NextResponse.json({ fase: { ...fase, usos: 0 } }, { status: 201 })
  } catch (e) {
    console.error('POST catalogo-fases', e)
    return NextResponse.json({ error: 'Erro ao criar a fase.' }, { status: 500 })
  }
}
