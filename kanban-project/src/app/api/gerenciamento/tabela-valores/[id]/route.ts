import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

function toAmount(v: any): number {
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// R17 — vigência precisa ser ISO 'YYYY-MM-DD' (o EXCLUDE de sobreposição depende disso).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
function vigenciaInvalida(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false
  return !ISO_DATE.test(String(v)) || Number.isNaN(Date.parse(String(v)))
}

// Mapeia violações de constraint (R16 unique / R17 EXCLUDE / R14-R15 CHECK) → HTTP claro.
function mapDbError(e: any): NextResponse | null {
  const msg = String(e?.message ?? '')
  if (e?.code === 'P2002' || msg.includes('config_contexto_ativo'))
    return NextResponse.json({ error: 'Já existe um preço ativo idêntico (mesma config, contexto, moeda, unidade, faixa, prioridade e vigência).' }, { status: 409 })
  if (msg.includes('vigencia_sem_sobreposicao'))
    return NextResponse.json({ error: 'Vigência sobreposta a outro preço ativo no mesmo contexto e prioridade. Use prioridade distinta ou ajuste o período.' }, { status: 409 })
  if (msg.includes('papel_obrigatorio') || msg.includes('um_mestre_dominio') || msg.includes('pivo_obrigatorio'))
    return NextResponse.json({ error: 'Configuração financeira inválida (papel/mestre/pivô).' }, { status: 400 })
  return null
}

// PUT - Atualizar regra de valor
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.tabelaValor.findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })

    const b = await request.json()
    if (b.valor !== undefined && toAmount(b.valor) <= 0) {
      return NextResponse.json({ error: 'Valor deve ser maior que zero.' }, { status: 400 })
    }
    if (vigenciaInvalida(b.vigenciaInicio) || vigenciaInvalida(b.vigenciaFim)) {
      return NextResponse.json({ error: 'Vigência deve estar no formato ISO YYYY-MM-DD.' }, { status: 400 })
    }
    // R20 — a config (mestre) é imutável na edição: uma tentativa de trocá-la é criação de novo registro.
    if (b.configuracaoFinanceiraItemId !== undefined && Number(b.configuracaoFinanceiraItemId) !== atual.configuracaoFinanceiraItemId) {
      return NextResponse.json({ error: 'Não é permitido trocar a Configuração Financeira de um preço existente. Crie um novo preço e arquive este.' }, { status: 400 })
    }
    try {
      const regra = await prisma.tabelaValor.update({
        where: { id },
        data: {
          // config (chave) é imutável na edição; aqui muda-se preço/contexto/vigência/prioridade.
          name: b.name !== undefined ? String(b.name).trim() : atual.name,
          processoTipoId: b.processoTipoId !== undefined ? (b.processoTipoId ? String(b.processoTipoId).trim() : null) : atual.processoTipoId,
          modalidadeId: b.modalidadeId !== undefined ? (b.modalidadeId ? Number(b.modalidadeId) : null) : atual.modalidadeId,
          fornecedorId: b.fornecedorId !== undefined ? (b.fornecedorId ? Number(b.fornecedorId) : null) : atual.fornecedorId,
          moeda: b.moeda !== undefined ? b.moeda : atual.moeda,
          valor: b.valor !== undefined ? toAmount(b.valor) : atual.valor,
          modoCalculo: b.modoCalculo !== undefined ? b.modoCalculo : atual.modoCalculo,
          unidade: b.unidade !== undefined ? (b.unidade || null) : atual.unidade,
          quantidadeMinima: b.quantidadeMinima !== undefined ? (b.quantidadeMinima === '' || b.quantidadeMinima == null ? null : Number(b.quantidadeMinima)) : atual.quantidadeMinima,
          quantidadeMaxima: b.quantidadeMaxima !== undefined ? (b.quantidadeMaxima === '' || b.quantidadeMaxima == null ? null : Number(b.quantidadeMaxima)) : atual.quantidadeMaxima,
          vigenciaInicio: b.vigenciaInicio !== undefined ? (b.vigenciaInicio ? String(b.vigenciaInicio) : null) : atual.vigenciaInicio,
          vigenciaFim: b.vigenciaFim !== undefined ? (b.vigenciaFim ? String(b.vigenciaFim) : null) : atual.vigenciaFim,
          prioridade: b.prioridade !== undefined ? (Number(b.prioridade) || 0) : atual.prioridade,
          arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
        },
        include: { fornecedor: { select: { id: true, nome: true } } },
      })
      return NextResponse.json({ regra })
    } catch (e: any) {
      const mapped = mapDbError(e)
      if (mapped) return mapped
      throw e
    }
  } catch (error) {
    console.error('Erro ao atualizar regra de valor:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE - R19: NÃO exclui fisicamente; ARQUIVA (preserva histórico/auditoria e o vínculo).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro

    const { id: idStr } = await params
    const id = Number(idStr)
    const atual = await prisma.tabelaValor.findUnique({ where: { id }, select: { id: true } })
    if (!atual) return NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })
    // arquivar (não deletar): sai da tela/resolver mas mantém histórico. O índice
    // parcial (WHERE arquivado=false) libera o contexto para um novo preço.
    await prisma.tabelaValor.update({ where: { id }, data: { arquivado: true } })

    return NextResponse.json({ ok: true, arquivado: true })
  } catch (error) {
    console.error('Erro ao arquivar regra de valor:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}