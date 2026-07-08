// src/app/api/processos/[processoId]/custos/route.ts
// ✅ ATUALIZADO: Custos por documento (tipoRegistro) ao invés de apenas por pessoa
// ✅ PASSO 3 (E8): a Planilha agora MOSTRA o Custo do motor econômico (fonte oficial),
//    com CustoPessoa como FALLBACK (adapter — não removido). Formato de resposta idêntico.

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// Serviços padrão que serão criados automaticamente
const SERVICOS_PADRAO = [
  { nome: "Certidão Inteiro Teor", ordem: 0 },
  { nome: "Desmaterialização", ordem: 1 },
  { nome: "Apostilamento Certidão", ordem: 2 },
  { nome: "Tradução Juramentada", ordem: 3 },
  { nome: "Apostilamento Tradução", ordem: 4 },
  { nome: "Retificação", ordem: 5 },
]

// Tipos de certidão que queremos mostrar
const TIPOS_CERTIDAO = [
  'CERTIDAO_NASCIMENTO',
  'CERTIDAO_NASCIMENTO_INTEIRO_TEOR',
  'CERTIDAO_CASAMENTO',
  'CERTIDAO_CASAMENTO_INTEIRO_TEOR',
  'CERTIDAO_OBITO',
  'CERTIDAO_OBITO_INTEIRO_TEOR',
]

// Helper para extrair tipo de registro
function getTipoRegistro(tipoDocumento: string): 'Nascimento' | 'Casamento' | 'Óbito' | null {
  if (tipoDocumento.includes('NASCIMENTO')) return 'Nascimento'
  if (tipoDocumento.includes('CASAMENTO')) return 'Casamento'
  if (tipoDocumento.includes('OBITO')) return 'Óbito'
  return null
}

// Ordem para ordenação dos tipos de registro
function getOrdemRegistro(tipo: string): number {
  if (tipo === 'Nascimento') return 1
  if (tipo === 'Casamento') return 2
  if (tipo === 'Óbito') return 3
  return 99
}

// GET - Listar todos os custos do processo com dados completos
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    // Verificar se processo existe
    const processoExiste = await prisma.processo.findUnique({
      where: { id },
      select: { id: true }
    })

    if (!processoExiste) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    // Buscar serviços existentes
    let servicos = await prisma.tipoServico.findMany({
      where: { processoId: id },
      orderBy: { ordem: 'asc' }
    })

    // Se não existem tipos de serviço, criar os padrão
    if (servicos.length === 0) {
      servicos = await prisma.$transaction(async (tx) => {
        const countExistente = await tx.tipoServico.count({
          where: { processoId: id }
        })

        if (countExistente === 0) {
          for (const s of SERVICOS_PADRAO) {
            await tx.tipoServico.create({
              data: {
                processoId: id,
                nome: s.nome,
                ordem: s.ordem
              }
            })
          }
        }

        return tx.tipoServico.findMany({
          where: { processoId: id },
          orderBy: { ordem: 'asc' }
        })
      })
    }

    // Buscar pessoas da árvore com TODOS os dados necessários
    const processo = await prisma.processo.findUnique({
      where: { id },
      include: {
        arvore: {
          include: {
            pessoas: {
              include: {
                // Pai e Mãe para genitores
                pai: true,
                mae: true,
                // Uniões para cônjuge
                unioesComoPessoa1: {
                  include: {
                    pessoa2: true
                  }
                },
                unioesComoPessoa2: {
                  include: {
                    pessoa1: true
                  }
                },
                // Documentos (certidões)
                documentos: {
                  where: {
                    tipo: { in: TIPOS_CERTIDAO as any }
                  },
                  orderBy: { tipo: 'asc' }
                }
              },
              // ✅ ATUALIZADO: Ordenar por numeroLinhagem e ordemCusto
              orderBy: [
                { numeroLinhagem: 'asc' },
                { ordemCusto: 'asc' },
                { id: 'asc' }
              ]
            }
          }
        },
        custosPessoa: true
      }
    })

    const todasPessoas = processo?.arvore?.pessoas || []
    const custos = processo?.custosPessoa || []

    // ── FALLBACK (manual antigo): mapa de CustoPessoa ────────────────────────
    // Chave: pessoaId-tipoRegistro-tipoServicoId
    const custosMap: Record<string, { valor: number; observacao: string | null }> = {}
    custos.forEach(c => {
      const tipoReg = (c as any).tipoRegistro || ''
      const key = `${c.pessoaId}-${tipoReg}-${c.tipoServicoId}`
      custosMap[key] = {
        valor: Number(c.valor),
        observacao: c.observacao
      }
    })

    // ── PASSO 3 (E8): FONTE OFICIAL = tabela Custo (motor econômico) ──────────
    // A Planilha passa a MOSTRAR o Custo gerado pelo motor. O CustoPessoa acima
    // vira FALLBACK: só é usado quando NÃO há Custo oficial para aquela célula.
    // Casamento das chaves: cada linha da grade é UM documento (doc.id) e cada
    // coluna é UM tipoServico (servico.id). O Custo grava os dois campos, então
    // o join é direto por (documentoId + tipoServicoId) — sem adivinhar nada.
    const custosOficiais = await prisma.custo.findMany({
      where: {
        processoId: id,
        status: 'ATIVA',
        documentoId: { not: null },
        tipoServicoId: { not: null },
      },
      select: { documentoId: true, tipoServicoId: true, valor: true },
    })
    // Chave: documentoId-tipoServicoId → soma dos custos ativos daquela célula
    // (soma cobre o caso raro de mais de um custo na mesma célula; hoje é 1).
    const custosOficiaisMap: Record<string, number> = {}
    custosOficiais.forEach(c => {
      const key = `${c.documentoId}-${c.tipoServicoId}`
      custosOficiaisMap[key] = (custosOficiaisMap[key] || 0) + Number(c.valor)
    })

    // Criar linhas da tabela (uma linha por documento/certidão)
    const linhasTabela: any[] = []

    todasPessoas.forEach(pessoa => {
      const nomeCompleto = `${pessoa.nome} ${pessoa.sobrenome || ''}`.trim()
      const numeroLinhagem = pessoa.numeroLinhagem || 999
      const ordemCusto = (pessoa as any).ordemCusto || 0

      // Genitores
      const paiNome = pessoa.pai ? `${pessoa.pai.nome} ${pessoa.pai.sobrenome || ''}`.trim() : null
      const maeNome = pessoa.mae ? `${pessoa.mae.nome} ${pessoa.mae.sobrenome || ''}`.trim() : null

      // Cônjuges (pode ter múltiplos)
      const conjuges: string[] = []
      pessoa.unioesComoPessoa1?.forEach(u => {
        if (u.pessoa2) {
          conjuges.push(`${u.pessoa2.nome} ${u.pessoa2.sobrenome || ''}`.trim())
        }
      })
      pessoa.unioesComoPessoa2?.forEach(u => {
        if (u.pessoa1) {
          conjuges.push(`${u.pessoa1.nome} ${u.pessoa1.sobrenome || ''}`.trim())
        }
      })

      // Se a pessoa tem documentos, criar uma linha para cada
      if (pessoa.documentos && pessoa.documentos.length > 0) {
        pessoa.documentos.forEach((doc, idx) => {
          const tipoRegistro = getTipoRegistro(doc.tipo)
          if (!tipoRegistro) return

          // Pegar data do casamento da união (se tiver)
          let dataCasamento: Date | null = null
          if (tipoRegistro === 'Casamento') {
            const primeiraUniao = pessoa.unioesComoPessoa1?.[0] || pessoa.unioesComoPessoa2?.[0]
            dataCasamento = primeiraUniao?.data_inicio || null
          }

          // Puxar data da pessoa ao invés do documento
          let dataRegistro: Date | string | null = null
          if (tipoRegistro === 'Nascimento') {
            dataRegistro = pessoa.data_nasc
          } else if (tipoRegistro === 'Casamento') {
            dataRegistro = dataCasamento
          } else if (tipoRegistro === 'Óbito') {
            dataRegistro = pessoa.data_obito
          }

          // ── VALOR DA CÉLULA: oficial (Custo do motor) com fallback (CustoPessoa) ──
          const valoresPorServico: Record<number, number> = {}
          let totalLinha = 0
          servicos.forEach(servico => {
            // 1º) FONTE OFICIAL: Custo do motor para este documento + serviço
            const oficial = custosOficiaisMap[`${doc.id}-${servico.id}`]
            // 2º) FALLBACK: CustoPessoa manual antigo (mesma chave de antes)
            const legadoKey = `${pessoa.id}-${tipoRegistro}-${servico.id}`
            const legado = custosMap[legadoKey]?.valor || 0
            // Se existe custo oficial (mesmo que 0), ele manda; senão cai no manual.
            const valor = oficial != null ? oficial : legado
            valoresPorServico[servico.id] = valor
            totalLinha += valor
          })

          linhasTabela.push({
            pessoaId: pessoa.id,
            numeroLinhagem,
            ordemCusto,
            nome: nomeCompleto,
            tipoRegistro,
            ordemRegistro: getOrdemRegistro(tipoRegistro),
            data: dataRegistro,
            local: doc.cidade_registro
              ? `${doc.cidade_registro}${doc.estado_registro ? ' - ' + doc.estado_registro : ''}`
              : doc.cartorio || '',
            cartorio: doc.cartorio || '',
            livro: doc.livro || '',
            folha: doc.folha || '',
            termo: doc.termo || '',
            dadosRegistro: doc.livro || doc.folha || doc.termo
              ? `Livro ${doc.livro || '-'} / Folhas ${doc.folha || '-'} / Termo ${doc.termo || '-'}`
              : '',
            // ✅ CORRIGIDO: Cônjuge em TODAS as linhas (não só na primeira)
            conjuge: conjuges[0] || '',
            paiNome,
            maeNome,
            observacao: doc.observacoes || '',
            // Valores em CADA linha
            valores: valoresPorServico,
            total: totalLinha,
            isPrimeiraLinha: idx === 0,
            documentoId: doc.id
          })
        })
      }
    })

    // Ordenar: 1º por numeroLinhagem, 2º por ordemCusto, 3º por tipo de registro
    linhasTabela.sort((a, b) => {
      // Primeiro por número de linhagem
      if (a.numeroLinhagem !== b.numeroLinhagem) {
        return a.numeroLinhagem - b.numeroLinhagem
      }
      // Se mesmo número de linhagem, ordenar por ordemCusto
      if (a.ordemCusto !== b.ordemCusto) {
        return a.ordemCusto - b.ordemCusto
      }
      // Se mesma ordem, ordenar por pessoaId (desempate)
      if (a.pessoaId !== b.pessoaId) {
        return a.pessoaId - b.pessoaId
      }
      // Se mesma pessoa, ordenar por tipo de registro
      return a.ordemRegistro - b.ordemRegistro
    })

    // Calcular totais por serviço (soma de TODAS as linhas — já reflete o oficial)
    const totaisPorServico: Record<number, number> = {}
    servicos.forEach(servico => {
      totaisPorServico[servico.id] = linhasTabela
        .reduce((acc, l) => acc + (l.valores[servico.id] || 0), 0)
    })

    // Total geral
    const totalGeral = Object.values(totaisPorServico).reduce((acc, val) => acc + val, 0)

    // Lista de pessoas únicas para compatibilidade
    const pessoasUnicas = [...new Map(linhasTabela.map(l => [l.pessoaId, {
      id: l.pessoaId,
      nome: l.nome.split(' ')[0],
      sobrenome: l.nome.split(' ').slice(1).join(' '),
      nomeCompleto: l.nome,
      numeroLinhagem: l.numeroLinhagem
    }])).values()]

    return NextResponse.json({
      // Novo formato para tabela estilo Excel
      linhas: linhasTabela,

      // Formato antigo para compatibilidade
      pessoas: pessoasUnicas,

      servicos,
      custosMap,
      totaisPorServico,
      totalGeral,

      // 🔎 Só para conferência do Passo 3 (a tela ignora): quantas células vieram
      // da fonte oficial (Custo do motor). Some >0 = motor aparecendo na Planilha.
      custosOficiaisCount: custosOficiais.length,
    })
  } catch (error) {
    console.error("Erro ao listar custos:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// POST - Salvar/Atualizar custo de uma pessoa para um serviço
// (mantém CustoPessoa: é a ENTRADA MANUAL / fallback. Não mexer no Passo 3.)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.custos_editar')
    if (erro) return erro

    const { processoId } = await params
    const procId = parseInt(processoId)

    if (isNaN(procId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { pessoaId, tipoServicoId, tipoRegistro, valor, observacao } = body

    if (!pessoaId || !tipoServicoId) {
      return NextResponse.json({ error: "pessoaId e tipoServicoId são obrigatórios" }, { status: 400 })
    }

    // ✅ ATUALIZADO: Incluir tipoRegistro no upsert
    const custo = await prisma.custoPessoa.upsert({
      where: {
        processoId_pessoaId_tipoServicoId_tipoRegistro: {
          processoId: procId,
          pessoaId: parseInt(pessoaId),
          tipoServicoId: parseInt(tipoServicoId),
          tipoRegistro: tipoRegistro || null
        }
      },
      update: {
        valor: valor || 0,
        observacao: observacao || null
      },
      create: {
        processoId: procId,
        pessoaId: parseInt(pessoaId),
        tipoServicoId: parseInt(tipoServicoId),
        tipoRegistro: tipoRegistro || null,
        valor: valor || 0,
        observacao: observacao || null
      }
    })

    return NextResponse.json(custo)
  } catch (error) {
    console.error("Erro ao salvar custo:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// PUT - Salvar múltiplos custos de uma vez (batch)
// (mantém CustoPessoa: entrada manual / fallback. Não mexer no Passo 3.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.custos_editar')
    if (erro) return erro

    const { processoId } = await params
    const procId = parseInt(processoId)

    if (isNaN(procId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const body = await request.json()
    const { custos } = body

    if (!Array.isArray(custos)) {
      return NextResponse.json({ error: "custos deve ser um array" }, { status: 400 })
    }

    // ✅ ATUALIZADO: Incluir tipoRegistro no upsert em batch
    const resultados = await Promise.all(
      custos.map(async (c: any) => {
        return prisma.custoPessoa.upsert({
          where: {
            processoId_pessoaId_tipoServicoId_tipoRegistro: {
              processoId: procId,
              pessoaId: parseInt(c.pessoaId),
              tipoServicoId: parseInt(c.tipoServicoId),
              tipoRegistro: c.tipoRegistro || '-'
            }
          },
          update: {
            valor: c.valor || 0,
            observacao: c.observacao || null
          },
          create: {
            processoId: procId,
            pessoaId: parseInt(c.pessoaId),
            tipoServicoId: parseInt(c.tipoServicoId),
            tipoRegistro: c.tipoRegistro || '-',
            valor: c.valor || 0,
            observacao: c.observacao || null
          }
        })
      })
    )

    return NextResponse.json({ message: "Custos salvos", count: resultados.length })
  } catch (error) {
    console.error("Erro ao salvar custos em batch:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}

// ✅ NOVO: PATCH para salvar ordem das pessoas
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'financeiro.custos_editar')
    if (erro) return erro

    const { ordens } = await request.json()

    // ordens é um array de { pessoaId: number, ordemCusto: number }
    if (!Array.isArray(ordens)) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 })
    }

    // Atualizar cada pessoa
    const resultados = await Promise.all(
      ordens.map(({ pessoaId, ordemCusto }: { pessoaId: number, ordemCusto: number }) =>
        prisma.pessoa.update({
          where: { id: pessoaId },
          data: { ordemCusto }
        })
      )
    )

    return NextResponse.json({ message: "Ordem salva", count: resultados.length })
  } catch (error) {
    console.error("Erro ao salvar ordem:", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}