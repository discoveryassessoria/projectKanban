// src/app/api/gerenciamento/taxas-pagamento/formas/[formaId]/route.ts
// ============================================================================
// CONFIGURAÇÃO AGREGADA de UMA Forma de Pagamento.
//   GET  → forma + adquirentes + bandeiras + grade (crédito) / taxa (débito/
//          único) / encargos (boleto) + condição de boleto.
//   PUT  → salva TODA a configuração de forma TRANSACIONAL (uma taxa por
//          forma×bandeira; grade regravada). Persistência normalizada; a UI
//          opera o agregado. Célula VAZIA ≠ 0% (vazia = sem linha na grade).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { INCLUDE_PARCELAMENTO, regravarLinhas, type LinhaParcelamento } from '@/lib/financeiro/taxa-parcelamento'
import { perfilForma, nomeTaxaAuto } from '@/lib/financeiro/taxa-identidade'
import { proximoCodigoTaxa } from '../../identidade-server'

// ── GET: detalhe agregado ───────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: { params: Promise<{ formaId: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { formaId: idStr } = await params
    const formaId = Number(idStr)

    const forma = await prisma.formaPagamentoCadastro.findUnique({ where: { id: formaId }, select: { id: true, name: true, code: true, type: true, ativo: true } })
    if (!forma) return NextResponse.json({ error: 'Forma não encontrada' }, { status: 404 })
    const perfil = perfilForma(forma.type)

    const [taxas, adquirentes, bandeiras, condBoleto] = await Promise.all([
      prisma.taxaPagamento.findMany({ where: { formasAplicaveis: { has: formaId } }, include: { ...INCLUDE_PARCELAMENTO }, orderBy: { name: 'asc' } }),
      prisma.adquirente.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, ativo: true, formasSuportadas: true } }),
      prisma.bandeira.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, ativo: true } }),
      perfil.calculo === 'BOLETO' ? prisma.condicaoPagamento.findFirst({ where: { codigo: 'COND-BOLETO' }, select: { id: true, multaPercent: true, jurosMesPercent: true, carenciaDias: true } }) : Promise.resolve(null),
    ])

    const taxasView = taxas.map((t) => ({
      id: t.id, code: t.code, name: t.name, adquirenteId: t.adquirenteId, bandeiraId: t.bandeiraId, finalidade: t.finalidade,
      ativo: t.ativo, feePercent: t.feePercent != null ? Number(t.feePercent) : null, fixedFee: t.fixedFee != null ? Number(t.fixedFee) : null,
      quemAbsorve: t.quemAbsorve, vigenciaInicio: t.vigenciaInicio, vigenciaFim: t.vigenciaFim,
      // grade: uma linha por parcela; célula ausente = combinação indisponível.
      grade: (t.parcelamento ?? []).map((l) => ({ parcela: l.parcelasDe, feePercent: l.feePercent != null ? Number(l.feePercent) : null })),
    }))

    return NextResponse.json({
      forma, perfil,
      adquirentes, bandeiras, taxas: taxasView,
      boleto: condBoleto ? { condicaoId: condBoleto.id, multaPercent: condBoleto.multaPercent != null ? Number(condBoleto.multaPercent) : null, jurosMesPercent: condBoleto.jurosMesPercent != null ? Number(condBoleto.jurosMesPercent) : null, carenciaDias: condBoleto.carenciaDias ?? null } : null,
    })
  } catch (error) {
    console.error('Erro no detalhe de taxas por forma:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// ── validações de negócio (backend = autoridade) ──
function validarSpec(s: any): string | null {
  const pct = s.feePercent
  if (pct != null && (Number(pct) < 0 || Number(pct) > 100)) return 'Taxa percentual deve estar entre 0% e 100%.'
  if (s.fixedFee != null && Number(s.fixedFee) < 0) return 'Valor fixo não pode ser negativo.'
  const vistos = new Set<number>()
  for (const g of s.grade ?? []) {
    const p = Math.trunc(Number(g.parcela))
    if (!(p >= 1 && p <= 12)) return `Parcela inválida na grade: ${g.parcela}.`
    if (vistos.has(p)) return `Parcela repetida na grade: ${p}x.`
    vistos.add(p)
    if (g.feePercent != null && (Number(g.feePercent) < 0 || Number(g.feePercent) > 100)) return `Taxa inválida em ${p}x (0–100%).`
  }
  return null
}

// ── PUT: salva a configuração agregada da forma (transacional) ──
export async function PUT(request: NextRequest, { params }: { params: Promise<{ formaId: string }> }) {
  try {
    const erro = await verificarPermissao(request, 'usuarios.gerenciar')
    if (erro) return erro
    const { formaId: idStr } = await params
    const formaId = Number(idStr)

    const forma = await prisma.formaPagamentoCadastro.findUnique({ where: { id: formaId }, select: { id: true, name: true, type: true } })
    if (!forma) return NextResponse.json({ error: 'Forma não encontrada' }, { status: 404 })

    const b = await request.json()
    const specs: any[] = Array.isArray(b.taxas) ? b.taxas : []
    for (const s of specs) { const e = validarSpec(s); if (e) return NextResponse.json({ error: e }, { status: 400 }) }

    // Bandeiras (para o nome automático). Uma consulta.
    const bandeiras = await prisma.bandeira.findMany({ select: { id: true, nome: true } })
    const nomeBand = new Map(bandeiras.map((x) => [x.id, x.nome]))

    const resultado = await prisma.$transaction(async (tx) => {
      let criadas = 0, atualizadas = 0
      for (const s of specs) {
        const bandeiraId = s.bandeiraId != null ? Number(s.bandeiraId) : null
        const adquirenteId = s.adquirenteId != null ? Number(s.adquirenteId) : null
        const finalidade = s.finalidade ? String(s.finalidade).toUpperCase() : null
        // grade → linhas normalizadas (parcelasDe = parcelasAte). Só as células
        // PREENCHIDAS viram linha; vazia = indisponível (não é 0%).
        const linhas: LinhaParcelamento[] = (s.grade ?? [])
          .filter((g: any) => g.feePercent !== null && g.feePercent !== undefined && g.feePercent !== '')
          .map((g: any) => ({ parcelasDe: Math.trunc(Number(g.parcela)), parcelasAte: Math.trunc(Number(g.parcela)), feePercent: Number(g.feePercent), fixedFee: null, antecipacao: false }))

        const dados: any = {
          feePercent: s.feePercent != null && s.feePercent !== '' ? Number(s.feePercent) : (linhas[0]?.feePercent ?? null),
          fixedFee: s.fixedFee != null && s.fixedFee !== '' ? Number(s.fixedFee) : null,
          ativo: s.ativo !== false,
          quemAbsorve: s.quemAbsorve ?? undefined,
          adquirenteId, bandeiraId, finalidade,
        }

        if (s.id) {
          await tx.taxaPagamento.update({ where: { id: Number(s.id) }, data: dados })
          if (s.grade !== undefined) await regravarLinhas(tx, Number(s.id), linhas)
          atualizadas++
        } else {
          // nova config de bandeira: cria a taxa normalizada + código automático.
          const code = await proximoCodigoTaxa(tx)
          const name = nomeTaxaAuto({ formaType: forma.type, formaNome: forma.name, bandeiraNome: bandeiraId != null ? nomeBand.get(bandeiraId) ?? null : null, finalidade })
          await tx.taxaPagamento.create({ data: {
            code, name, ativo: dados.ativo, prioridade: 0, quemAbsorve: dados.quemAbsorve ?? 'EMPRESA',
            feeType: dados.fixedFee != null ? 'fixed' : 'percentage', feePercent: dados.feePercent, fixedFee: dados.fixedFee,
            categoria: forma.type?.startsWith('CARTAO') ? 'TAXA_CARTAO' : perfilForma(forma.type).calculo === 'BOLETO' ? 'TARIFA_BANCARIA' : 'GATEWAY',
            aplicaParcela: 'TODAS', formasAplicaveis: [formaId], adquirenteId, bandeiraId, finalidade,
            vigenciaInicio: new Date(),
            ...(linhas.length ? { parcelamento: { create: linhas.map((l, i) => ({ ...l, ordem: i })) } } : {}),
          } })
          criadas++
        }
      }

      // Boleto: encargos ficam na condição COND-BOLETO (multa/juros/carência).
      if (b.boleto && b.boleto.condicaoId) {
        await tx.condicaoPagamento.update({ where: { id: Number(b.boleto.condicaoId) }, data: {
          multaPercent: b.boleto.multaPercent != null ? Number(b.boleto.multaPercent) : undefined,
          jurosMesPercent: b.boleto.jurosMesPercent != null ? Number(b.boleto.jurosMesPercent) : undefined,
          carenciaDias: b.boleto.carenciaDias != null ? Math.trunc(Number(b.boleto.carenciaDias)) : undefined,
        } })
      }
      return { criadas, atualizadas }
    })

    await registrarAuditoria(request, { acao: 'EDITAR', entidade: 'TaxaPagamentoForma', entidadeId: formaId, descricao: `Config de taxas da forma "${forma.name}": ${resultado.atualizadas} atualizada(s), ${resultado.criadas} criada(s).` })
    return NextResponse.json({ ok: true, ...resultado })
  } catch (error) {
    console.error('Erro ao salvar taxas por forma:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
