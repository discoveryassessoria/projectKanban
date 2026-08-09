import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { modoCalculoValido, estrategiaDoModo, estrategiaUsaPrimeiroAdicional, estrategiaUsaFaixaQuantidade } from '@/lib/financeiro/modo-calculo'
import { normalizarUnidade } from '@/lib/financeiro/unidade-cobranca'
import { detectarConflitoPreco, type PrecoRegistro } from '@/lib/financeiro/conflito-preco'
import type { NaturezaPrecoRaw } from '@/lib/financeiro/natureza-financeira'

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
    // VALIDADE É ESTADO, NÃO DATA (09/08/2026). A rota deixa de aceitar e de exigir
    // vigência: preço ativo vale por tempo indeterminado, até ser editado,
    // inativado ou excluído. As colunas permanecem no schema (nullable) só para
    // o histórico já gravado — nenhuma escrita nova as preenche.
    // R20 — a config (mestre) é imutável na edição: uma tentativa de trocá-la é criação de novo registro.
    if (b.configuracaoFinanceiraItemId !== undefined && Number(b.configuracaoFinanceiraItemId) !== atual.configuracaoFinanceiraItemId) {
      return NextResponse.json({ error: 'Não é permitido trocar a Configuração Financeira de um preço existente. Crie um novo preço e arquive este.' }, { status: 400 })
    }
    // Mesma regra pelo vínculo canônico do item (é o que a tela envia hoje).
    if (b.itemCatalogoId !== undefined && atual.itemCatalogoId != null && Number(b.itemCatalogoId) !== atual.itemCatalogoId) {
      return NextResponse.json({ error: 'Não é permitido trocar o item de um preço existente. Crie um novo preço e arquive este.' }, { status: 400 })
    }
    // ESTRATÉGIA efetiva (modoCalculo canônico). A UNIDADE é escolhida pelo usuário
    // (enum UnidadeItem) — NÃO é mais derivada do modo.
    const modoFinal = b.modoCalculo !== undefined ? (b.modoCalculo ? String(b.modoCalculo) : '') : atual.modoCalculo
    if (b.modoCalculo !== undefined && !modoCalculoValido(modoFinal)) {
      return NextResponse.json({ error: 'Informe uma Estratégia de cálculo válida.' }, { status: 400 })
    }
    const modoConhecido = modoCalculoValido(modoFinal)
    // Estratégia comercial efetiva (fonte única): base/adicional e faixa de quantidade.
    const usaBaseAdic = estrategiaUsaPrimeiroAdicional(modoFinal)
    const usaFaixa = estrategiaUsaFaixaQuantidade(modoFinal)
    const ehFixo = estrategiaDoModo(modoFinal) === 'fixo'
    const parseQtd = (v: unknown) => (v === '' || v == null ? null : Number(v))
    // Unidade efetiva: aceita a enviada (normalizada), senão preserva a atual. Fixo → opcional.
    let unidadeEff = b.unidade !== undefined ? normalizarUnidade(b.unidade) : (normalizarUnidade(atual.unidade) ?? atual.unidade)
    if (b.unidade !== undefined && String(b.unidade).trim() !== '' && normalizarUnidade(b.unidade) == null)
      return NextResponse.json({ error: 'Unidade de cobrança inválida.' }, { status: 400 })
    if (!ehFixo && unidadeEff == null)
      return NextResponse.json({ error: 'Selecione a Unidade de cobrança (o que está sendo contado).' }, { status: 400 })

    // Valores EFETIVOS pós-edição (natureza é imutável). VENDA não leva fornecedor (invariante
    // do POST). Moeda vazia cai no valor atual (garantidamente não-vazio).
    const ehVenda = atual.natureza === 'VENDA' || atual.natureza === 'RECEITA'
    const fornecedorIdEff = ehVenda ? null : (b.fornecedorId !== undefined ? (b.fornecedorId ? Number(b.fornecedorId) : null) : atual.fornecedorId)
    const moedaEff = b.moeda !== undefined && String(b.moeda).trim() ? String(b.moeda).trim() : atual.moeda
    // min/max só em estratégia de FAIXA (nenhuma atual) → normaliza para null.
    const qMinEff = modoConhecido ? (usaFaixa ? (b.quantidadeMinima !== undefined ? parseQtd(b.quantidadeMinima) : atual.quantidadeMinima) : null) : atual.quantidadeMinima
    const qMaxEff = modoConhecido ? (usaFaixa ? (b.quantidadeMaxima !== undefined ? parseQtd(b.quantidadeMaxima) : atual.quantidadeMaxima) : null) : atual.quantidadeMaxima
    // Editar um preço NORMALIZA a vigência herdada: o registro passa a valer por
    // tempo indeterminado, como todo cadastro.
    const vigIniEff: string | null = null
    const vigFimEff: string | null = null
    const prioEff = b.prioridade !== undefined ? (Number(b.prioridade) || 0) : atual.prioridade
    if (vigIniEff && vigFimEff && vigIniEff > vigFimEff) {
      return NextResponse.json({ error: '"Válido até" deve ser igual ou posterior a "Válido a partir de".' }, { status: 400 })
    }
    // Preço PRIMEIRO+ADICIONAL (só na estratégia por requerente). Fora dela zera base/adicional.
    const parseAmt = (v: unknown) => (v === '' || v == null ? null : Number(v))
    const baseEff = (modoConhecido && usaBaseAdic)
      ? (b.valorBase !== undefined ? parseAmt(b.valorBase) : (atual.valorBase == null ? null : Number(atual.valorBase)))
      : null
    const adicEff = (modoConhecido && usaBaseAdic)
      ? (b.valorAdicional !== undefined ? parseAmt(b.valorAdicional) : (atual.valorAdicional == null ? null : Number(atual.valorAdicional)))
      : null
    if ((baseEff == null) !== (adicEff == null))
      return NextResponse.json({ error: 'Informe Primeiro requerente e Requerente adicional juntos (ou nenhum).' }, { status: 400 })
    if (baseEff != null && baseEff <= 0) return NextResponse.json({ error: 'Primeiro requerente deve ser maior que zero.' }, { status: 400 })
    if (adicEff != null && adicEff < 0) return NextResponse.json({ error: 'Requerente adicional não pode ser negativo.' }, { status: 400 })

    // Detecção de CONFLITO na edição (o POST já faz; o PUT não fazia → sobreposição escapava).
    if (atual.configuracaoFinanceiraItemId != null) {
      const outras = await prisma.tabelaValor.findMany({
        where: { configuracaoFinanceiraItemId: atual.configuracaoFinanceiraItemId, arquivado: false, legadoPendente: false, id: { not: id } },
        select: { id: true, configuracaoFinanceiraItemId: true, natureza: true, processoTipoId: true, faseKey: true, regiao: true, modalidadeId: true, processoId: true, itemCatalogoId: true, fornecedorId: true, quantidadeMinima: true, quantidadeMaxima: true, vigenciaInicio: true, vigenciaFim: true, prioridade: true },
      })
      const candidata: PrecoRegistro = {
        id, configuracaoFinanceiraItemId: atual.configuracaoFinanceiraItemId, natureza: atual.natureza as NaturezaPrecoRaw | null,
        processoTipoId: atual.processoTipoId, faseKey: atual.faseKey, regiao: atual.regiao, modalidadeId: atual.modalidadeId,
        processoId: atual.processoId, itemCatalogoId: atual.itemCatalogoId, fornecedorId: fornecedorIdEff,
        quantidadeMinima: qMinEff == null ? null : Number(qMinEff), quantidadeMaxima: qMaxEff == null ? null : Number(qMaxEff),
        vigenciaInicio: vigIniEff, vigenciaFim: vigFimEff, prioridade: prioEff, arquivado: false, legadoPendente: false,
      }
      const conflito = detectarConflitoPreco(candidata, outras.map((e): PrecoRegistro => ({
        id: e.id, configuracaoFinanceiraItemId: e.configuracaoFinanceiraItemId, natureza: e.natureza as NaturezaPrecoRaw | null,
        processoTipoId: e.processoTipoId, faseKey: e.faseKey, regiao: e.regiao, modalidadeId: e.modalidadeId,
        processoId: e.processoId, itemCatalogoId: e.itemCatalogoId, fornecedorId: e.fornecedorId,
        quantidadeMinima: e.quantidadeMinima == null ? null : Number(e.quantidadeMinima), quantidadeMaxima: e.quantidadeMaxima == null ? null : Number(e.quantidadeMaxima),
        vigenciaInicio: e.vigenciaInicio, vigenciaFim: e.vigenciaFim, prioridade: e.prioridade, arquivado: false, legadoPendente: false,
      })))
      if (!conflito.ok) return NextResponse.json({ error: conflito.motivo, conflitantes: conflito.conflitantes }, { status: 409 })
    }

    try {
      const regra = await prisma.tabelaValor.update({
        where: { id },
        data: {
          // config (chave) e natureza são imutáveis; muda-se preço/contexto/vigência/prioridade.
          name: b.name !== undefined ? String(b.name).trim() : atual.name,
          processoTipoId: b.processoTipoId !== undefined ? (b.processoTipoId ? String(b.processoTipoId).trim() : null) : atual.processoTipoId,
          modalidadeId: b.modalidadeId !== undefined ? (b.modalidadeId ? Number(b.modalidadeId) : null) : atual.modalidadeId,
          fornecedorId: fornecedorIdEff,
          moeda: moedaEff as never,
          valor: baseEff != null ? baseEff : (b.valor !== undefined ? toAmount(b.valor) : atual.valor),
          valorBase: baseEff,
          valorAdicional: adicEff,
          modoCalculo: modoFinal,
          unidade: unidadeEff,
          quantidadeMinima: qMinEff,
          quantidadeMaxima: qMaxEff,
          vigenciaInicio: vigIniEff,
          vigenciaFim: vigFimEff,
          prioridade: prioEff,
          arquivado: b.arquivado !== undefined ? !!b.arquivado : atual.arquivado,
        },
        include: { fornecedor: { select: { id: true, nome: true } } },
      })
    await registrarAuditoria(request, { acao: 'EDITAR', entidade: 'TabelaValor', entidadeId: regra.id, descricao: `Preço editado (#${regra.id})` })
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
    await registrarAuditoria(request, { acao: 'DESATIVAR', entidade: 'TabelaValor', entidadeId: id, descricao: `Preço arquivado (#${id})` })

    return NextResponse.json({ ok: true, arquivado: true })
  } catch (error) {
    console.error('Erro ao arquivar regra de valor:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}