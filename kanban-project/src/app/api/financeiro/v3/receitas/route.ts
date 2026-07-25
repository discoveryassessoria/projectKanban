// /api/financeiro/v3/receitas — aba Receitas (KPIs + tabela) do Financeiro V3.
//   GET  — lista/KPIs (motor V3)
//   POST — lançamento MANUAL de Receita a partir de um item do Catálogo Mestre.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { listarReceitas } from '@/lib/financeiro/leitura/receitas-lista'
import { criarReceitaManualCanonica } from '@/lib/financeiro/receitas/criar-receita-manual'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { temPermissao } from '@/src/lib/permissoes'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const processoId = req.nextUrl.searchParams.get("processoId"); return NextResponse.json({ disponivel: true, ...(await listarReceitas(processoId ? Number(processoId) : undefined)) })
}

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  const b = await req.json().catch(() => ({}))
  const processoId = b?.processoId != null ? Number(b.processoId) : null
  const itemCatalogoId = b?.itemCatalogoId != null ? Number(b.itemCatalogoId) : null
  if (!processoId) return NextResponse.json({ ok: false, erro: 'processoId é obrigatório.' }, { status: 400 })
  if (!itemCatalogoId) return NextResponse.json({ ok: false, erro: 'Selecione um item do Cadastro Mestre.' }, { status: 400 })

  const actor = await extrairUsuarioComPermissoes(req)
  // override de valor do Cadastro Mestre exige permissão específica (editar valores) ou admin.
  const podeOverridePreco = actor?.tipo === 'admin' || (actor ? temPermissao(actor.permissoes, 'financeiro.custos_editar') : false)
  const vinculo = String(b?.vinculo ?? 'PROCESSO').toUpperCase().startsWith('PART') || b?.vinculo === 'requerentes' ? 'PARTICIPANTES' : 'PROCESSO'
  const participantes = Array.isArray(b?.participantes) ? b.participantes.map((p: Record<string, unknown>) => ({ requerenteId: Number(p.requerenteId), nome: String(p.nome ?? ''), valor: Number(p.valor ?? 0) })) : []

  try {
    const r = await criarReceitaManualCanonica({
      processoId, itemCatalogoId,
      descricao: b?.descricao ?? null,
      quantidade: b?.quantidade != null ? Number(b.quantidade) : 1,
      valorUnitarioOverride: b?.valorUnitario != null ? Number(b.valorUnitario) : (b?.valorUnitarioOverride != null ? Number(b.valorUnitarioOverride) : null),
      desconto: b?.desconto != null ? Number(b.desconto) : 0,
      faseLabel: b?.faseLabel ?? null,
      vinculo: vinculo as 'PROCESSO' | 'PARTICIPANTES',
      participantes,
      idempotencyKey: b?.idempotencyKey ? String(b.idempotencyKey) : null,
      justificativaOverride: b?.justificativaOverride ?? null,
      podeOverridePreco,
      criadoPorId: actor?.userId ?? null,
    })
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.erros[0] ?? 'Falha ao criar a receita.', erros: r.erros }, { status: 422 })
    await registrarAuditoria(req, { acao: 'CRIAR', entidade: 'ReceitaManual', entidadeId: r.obrigacaoRef ?? 0, descricao: `Receita manual canônica (${r.moeda} ${r.totalContratado}, item ${itemCatalogoId})`, detalhes: { processoId, itemCatalogoId, total: r.totalContratado, moeda: r.moeda, receitaIds: r.receitaIds, grupo: r.grupo, vinculo, idempotente: r.idempotente } })
    return NextResponse.json({ ...r, ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao criar a receita.' }, { status: 422 })
  }
}
