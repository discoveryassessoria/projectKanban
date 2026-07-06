// ESTE ARQUIVO SUBSTITUI: src/app/api/processos/route.ts
//
// NOVO (6/jul): GATILHO AUTOMÁTICO — se a chave MotorConfig.autoExecutarAoAvancar
// estiver LIGADA (Gerenciamento → Executor do Motor), ao CRIAR o processo o motor
// roda sozinho as automações "ao entrar na fase" da PRIMEIRA fase.
// Se o motor falhar, o processo é criado normal — só loga o erro.
// (Mantém o fix anterior: sem exigir Status legado; statusId é opcional.)

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { logProcesso } from "@/lib/auditoria"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { executarMotorNaFase } from '@/src/lib/motor/executor'

// GET - Buscar processos (filtrado por país, requerente ou contratante)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const pais = searchParams.get("pais")
    const requerenteId = searchParams.get("requerenteId")
    const contratanteId = searchParams.get("contratanteId")
    const motor = searchParams.get("motor") // ✅ MOTOR

    // Construir filtro dinâmico
    const where: any = {}

    if (pais) {
      where.pais = pais
    }

    // ✅ Filtro por requerente
    if (requerenteId) {
      where.requerentes = {
        some: {
          requerenteId: parseInt(requerenteId)
        }
      }
    }

    // ✅ Filtro por contratante
    if (contratanteId) {
      where.contratantes = {
        some: {
          contratanteId: parseInt(contratanteId)
        }
      }
    }

    // ✅ MOTOR: só processos conectados ao motor (tipoProcessoMotorId preenchido)
    if (motor === "1") {
      where.tipoProcessoMotorId = { not: null }
    }

    const processos = await prisma.processo.findMany({
      where,
      include: {
        status: true,
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
        requerentes: {
          include: {
            requerente: true
          }
        },
        tarefas: {
          include: {
            responsavel: true
          },
          orderBy: { createdAt: "desc" }
        },
        _count: {
          select: {
            tarefas: {
              where: { tarefaPaiId: { not: null } }
            },
            anexos: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    })

    // Formatar para incluir contratantes e requerentes como arrays simples
    const processosFormatados = processos.map(p => ({
      ...p,
      contratantes: p.contratantes.map(c => c.contratante),
      requerentes: p.requerentes.map(r => r.requerente)
    }))

    return NextResponse.json({ processos: processosFormatados })
  } catch (error) {
    console.error("Erro ao buscar processos:", error)
    return NextResponse.json(
      { error: "Erro ao buscar processos" },
      { status: 500 }
    )
  }
}

// POST - Criar novo processo
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, 'processos.criar')
    if (erro) return erro

    const body = await request.json()
    const {
      nome,
      descricao,
      observacoes,
      statusId,
      pais,
      contratanteIds,
      arvoreId,
      previsaoTermino,
      requerenteIds,
      tipoProcessoMotorId,
    } = body

    if (!nome) {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 }
      )
    }

    if (!pais) {
      return NextResponse.json(
        { error: "País é obrigatório" },
        { status: 400 }
      )
    }

    const paisCat = await prisma.catalogoPais.findFirst({ where: { countryKey: pais, ativo: true } })
    if (!paisCat) return NextResponse.json({ error: "País inválido ou inativo." }, { status: 400 })

    if (!tipoProcessoMotorId) return NextResponse.json({ error: "Escolha o tipo de processo." }, { status: 400 })
    const tipoMotor = await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: tipoProcessoMotorId } })
    if (!tipoMotor || tipoMotor.countryKey !== pais) {
      return NextResponse.json({ error: "Tipo de processo inválido para este país." }, { status: 400 })
    }

    const wf = await prisma.macroWorkflow.findUnique({
      where: { tipoProcessoId: tipoMotor.id },
      include: { fases: { where: { showInKanban: true }, orderBy: { ordem: "asc" } } },
    })
    if (!wf || wf.fases.length === 0) {
      return NextResponse.json({ error: "Este tipo ainda não tem fases. Monte o workflow em Gerenciamento → Workflows e Fases." }, { status: 400 })
    }

    const primeiraFase = wf.fases[0].phaseKey

    // Criar o processo — nasce na 1ª fase do motor.
    // statusId legado só é salvo se alguma tela antiga ainda mandar (opcional).
    const processo = await prisma.processo.create({
      data: {
        nome,
        descricao: descricao || null,
        observacoes: observacoes || null,
        pais,
        faseAtualKey: primeiraFase,
        statusId: statusId ?? null,
        arvoreId: arvoreId || null,
        previsaoTermino: previsaoTermino ? new Date(previsaoTermino) : null,
        tipoProcessoMotorId,   // ✅ nasce ligado ao motor
      }
    })

    // Criar relacionamentos com contratantes se fornecidos
    if (contratanteIds?.length > 0) {
      await prisma.processoContratante.createMany({
        data: contratanteIds.map((contratanteId: number) => ({
          processoId: processo.id,
          contratanteId
        }))
      })
    }

    // Criar relacionamentos com requerentes se fornecidos
    if (requerenteIds?.length > 0) {
      await prisma.processoRequerente.createMany({
        data: requerenteIds.map((requerenteId: number) => ({
          processoId: processo.id,
          requerenteId
        }))
      })
    }

    // ✅ REGISTRAR LOG
    await logProcesso.criar(processo.nome, processo.id)

    // ✅ GATILHO AUTOMÁTICO: roda as automações "ao entrar na fase" da 1ª fase
    let motor: unknown = null
    try {
      const cfg = await prisma.motorConfig.findUnique({ where: { id: 1 } })
      if (cfg?.autoExecutarAoAvancar) {
        motor = await executarMotorNaFase(processo.id, tipoProcessoMotorId, primeiraFase, "entered")
      }
    } catch (e) {
      console.error("Gatilho automático do motor falhou (criar processo):", e)
    }

    // Buscar processo completo com relacionamentos
    const processoCompleto = await prisma.processo.findUnique({
      where: { id: processo.id },
      include: {
        status: true,
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
        requerentes: {
          include: {
            requerente: true
          }
        }
      }
    })

    // Formatar resposta
    const processoFormatado = {
      ...processoCompleto,
      contratantes: processoCompleto?.contratantes.map(c => c.contratante) || [],
      requerentes: processoCompleto?.requerentes.map(r => r.requerente) || []
    }

    return NextResponse.json({ processo: processoFormatado, motor }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar processo:", error)
    return NextResponse.json(
      { error: "Erro ao criar processo" },
      { status: 500 }
    )
  }
}