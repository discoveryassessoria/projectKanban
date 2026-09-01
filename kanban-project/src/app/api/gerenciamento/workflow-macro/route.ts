import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { avaliarAptidaoDaFase } from '@/src/lib/process-stage/escopo-operacional-da-fase'

// GET - Bootstrap: tipos de processo + catálogo de fases (+ flags dos países)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [tipos, catalogoFases, paises] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { arquivado: false },
        orderBy: { name: 'asc' },
        select: {
          id: true, code: true, name: true, modalityLabel: true, ativo: true,
          pais: { select: { countryKey: true, countryLabel: true } },
        },
      }),
      prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: { ordemPadrao: 'asc' } }),
      prisma.catalogoPais.findMany({ select: { countryKey: true, flag: true } }),
    ])

    // marca quais tipos já têm workflow
    const comWf = await prisma.macroWorkflow.findMany({ select: { tipoProcessoId: true } })
    const setWf = new Set(comWf.map((m) => m.tipoProcessoId))
    // País do tipo é APRESENTAÇÃO derivada da relação canônica.
    const tiposOut = tipos.map(({ pais, ...t }) => ({
      ...t,
      countryKey: pais.countryKey,
      countryLabel: pais.countryLabel,
      temWorkflow: setWf.has(t.id),
    }))

    return NextResponse.json({ tipos: tiposOut, catalogoFases, paises })
  } catch (error) {
    console.error('Erro no bootstrap do workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST - Criar Workflow Macro para um tipo de processo (opcionalmente com as 10 fases padrão)
export async function POST(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const b = await request.json()
    const tipoProcessoId = Number(b.tipoProcessoId)
    if (!tipoProcessoId) return NextResponse.json({ error: 'Informe o tipo de processo.' }, { status: 400 })

    const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: tipoProcessoId } })
    if (!tipo) return NextResponse.json({ error: 'Tipo de processo não encontrado.' }, { status: 404 })

    const existente = await prisma.macroWorkflow.findUnique({ where: { tipoProcessoId }, include: { fases: { orderBy: { ordem: 'asc' } } } })
    if (existente) return NextResponse.json({ macroWorkflow: existente })

    // monta as fases padrão a partir do catálogo, se pedido
    let fasesCreate: any = undefined
    if (b.seedDefaults) {
      const cat = await prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: { ordemPadrao: 'asc' } })

      // O macro NASCE UTILIZÁVEL ou não nasce.
      //
      // A pergunta MUDOU. Antes era "esta chave está no catálogo em código?", e isso
      // recusava qualquer fase criada pelo cadastro — inclusive uma legítima. Agora é
      // "esta fase é utilizável?": tem escopo declarado (em código, para as canônicas,
      // ou no cadastro, para as novas) e não é a chave antiga de uma canônica.
      //
      // RECUSAR, nunca converter, e sempre DIZENDO o que falta: recusar sem nomear a
      // canônica foi o que deixou três macrofluxos nascerem com `traducao`/`retificacao`
      // e ninguém entender por quê.
      const aptidoes = await Promise.all(cat.map(async (f) => ({ f, a: await avaliarAptidaoDaFase(f.phaseKey) })))
      const invalidas = aptidoes.filter((x) => !x.a.apta)
      if (invalidas.length > 0) {
        return NextResponse.json(
          {
            error:
              `O catálogo tem ${invalidas.length} fase(s) que não podem compor um fluxo: ` +
              invalidas.map((x) => `"${x.f.phaseKey}" (${x.f.label}) — ${x.a.motivo}`).join(' | ') +
              ' Ajuste o cadastro em Gerenciamento › Processos › Estrutura › Fases.',
            code: 'CATALOGO_FASE_NAO_UTILIZAVEL',
            fases: invalidas.map((x) => ({ id: x.f.id, phaseKey: x.f.phaseKey, label: x.f.label, motivo: x.a.motivo, code: x.a.code, canonica: x.a.canonica ?? null })),
          },
          { status: 422 },
        )
      }
      const duplicadas = cat.filter((f, i) => cat.findIndex((x) => x.phaseKey === f.phaseKey) !== i)
      if (duplicadas.length > 0) {
        return NextResponse.json(
          {
            error: `O catálogo de fases tem chave repetida: ${duplicadas.map((f) => f.phaseKey).join(', ')}.`,
            code: 'CATALOGO_FASE_DUPLICADA',
          },
          { status: 422 },
        )
      }

      fasesCreate = {
        create: cat.map((f, i) => ({
          phaseKey: f.phaseKey,
          label: f.label,
          ordem: i + 1,
          required: f.requiredPadrao,
          conditional: f.conditionalPadrao,
          entryRule: i === 0 ? 'process_created' : 'previous_phase_completed',
          slaDays: f.slaDiasPadrao,
          showInKanban: true,
        })),
      }
    }

    const macroWorkflow = await prisma.macroWorkflow.create({
      data: { tipoProcessoId, name: `Workflow Macro · ${tipo.name}`, ativo: true, ...(fasesCreate ? { fases: fasesCreate } : {}) },
      include: { fases: { orderBy: { ordem: 'asc' } } },
    })

    return NextResponse.json({ macroWorkflow })
  } catch (error) {
    console.error('Erro ao criar workflow macro:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}