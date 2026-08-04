import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { phaseKeyToFaseCode } from '@/src/lib/process-stage/fases-catalog'

// GET - Bootstrap: tipos de processo + catálogo de fases (+ flags dos países)
export async function GET(request: NextRequest) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const [tipos, catalogoFases, paises] = await Promise.all([
      prisma.tipoProcessoNacionalidade.findMany({
        where: { arquivado: false },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, countryKey: true, countryLabel: true, modalityLabel: true, ativo: true },
      }),
      prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: { ordemPadrao: 'asc' } }),
      prisma.catalogoPais.findMany({ select: { countryKey: true, flag: true } }),
    ])

    // marca quais tipos já têm workflow
    const comWf = await prisma.macroWorkflow.findMany({ select: { tipoProcessoId: true } })
    const setWf = new Set(comWf.map((m) => m.tipoProcessoId))
    const tiposOut = tipos.map((t) => ({ ...t, temWorkflow: setWf.has(t.id) }))

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

      // O macro NASCE canônico ou não nasce. O catálogo de fases é um cadastro
      // editável, e uma chave que não existe no catálogo oficial produz uma fase que
      // o motor nunca vai resolver — o processo trava nela. Foi assim que três
      // macrofluxos nasceram com `traducao`/`retificacao`.
      //
      // RECUSAR, nunca converter: traduzir a chave aqui seria um alias escondido no
      // endpoint, e o operador continuaria cadastrando errado sem saber.
      const invalidas = cat.filter((f) => phaseKeyToFaseCode(f.phaseKey) == null)
      if (invalidas.length > 0) {
        return NextResponse.json(
          {
            error:
              `O catálogo de fases tem ${invalidas.length} fase(s) com chave fora do catálogo oficial: ` +
              invalidas.map((f) => `"${f.phaseKey}" (${f.label})`).join(', ') +
              '. Corrija o cadastro em Gerenciamento › Processos › Estrutura › Fases antes de criar o macrofluxo — ' +
              'um macro criado assim nasce com fases que o motor não resolve.',
            code: 'CATALOGO_FASE_COM_CHAVE_INVALIDA',
            fases: invalidas.map((f) => ({ id: f.id, phaseKey: f.phaseKey, label: f.label })),
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