// src/app/api/gerenciamento/cadastros/[entidade]/[id]/route.ts
// Edição e exclusão dos cadastros genéricos. Mesma allow-list do registro:
// entidade fora do registro devolve 404 (nenhuma tabela arbitrária é exposta).
// `code` é imutável depois de criado — é a identidade estável do registro.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { CADASTROS } from '@/src/lib/gerenciamento/cadastros-registry'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { normalizarNome, chaveSemantica } from '@/lib/gerenciamento/cadastro-identidade'
import { dadosDaSpec } from '../route'

type Delegate = {
  findMany: (args?: Record<string, unknown>) => Promise<Record<string, unknown>[]>
  count: (args?: Record<string, unknown>) => Promise<number>
  findUnique: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
  delete: (args: Record<string, unknown>) => Promise<unknown>
}
type LinkDelegate = {
  deleteMany: (args: Record<string, unknown>) => Promise<unknown>
  createMany: (args: Record<string, unknown>) => Promise<unknown>
}
const db = prisma as unknown as Record<string, Delegate>
const link = prisma as unknown as Record<string, LinkDelegate>

export async function PUT(request: NextRequest, { params }: { params: Promise<{ entidade: string; id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const { entidade, id: idStr } = await params
  const cfg = CADASTROS[entidade]
  if (!cfg) return NextResponse.json({ error: 'Cadastro não encontrado.' }, { status: 404 })
  const id = Number(idStr)
  try {
    const atual = await db[cfg.model].findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Registro não encontrado.' }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    // DUPLICIDADE na edição: compara contra os OUTROS registros. Renomear para
    // uma variação do próprio nome é permitido; colidir com outro cadastro não.
    if (cfg.identidade && body[cfg.identidade] !== undefined) {
      const chave = chaveSemantica(normalizarNome(String(body[cfg.identidade] ?? '')))
      const outros = await db[cfg.model].findMany({ orderBy: { id: 'asc' } })
      const colide = outros.find((r) => Number(r.id) !== id && chaveSemantica(String(r[cfg.identidade!] ?? '')) === chave)
      if (colide) {
        return NextResponse.json(
          { error: `Já existe uma categoria equivalente: "${String(colide[cfg.identidade])}".`, campo: cfg.identidade },
          { status: 409 },
        )
      }
    }

    const data = dadosDaSpec(cfg, body, false)
    const registro = Object.keys(data).length ? await db[cfg.model].update({ where: { id }, data }) : atual
    if (cfg.auditoria && Object.keys(data).length) {
      const virouInativo = data.ativo === false && atual.ativo !== false
      const virouAtivo = data.ativo === true && atual.ativo !== true
      await registrarAuditoria(request, {
        acao: virouInativo ? 'DESATIVAR' : virouAtivo ? 'REATIVAR' : 'EDITAR',
        entidade: cfg.auditoria, entidadeId: id,
        descricao: `${cfg.titulo}: ${String(registro[cfg.identidade ?? 'id'] ?? id)}`,
        detalhes: data as Record<string, unknown>,
      })
    }

    // vínculos N:N: substitui o conjunto (nunca apaga o registro pai)
    if (cfg.relacao && Array.isArray(body[cfg.relacao.campoForm])) {
      const alvos = (body[cfg.relacao.campoForm] as unknown[]).map((v) => Number(v)).filter((n) => Number.isFinite(n))
      await link[cfg.relacao.model].deleteMany({ where: { [cfg.relacao.campoPai]: id } })
      if (alvos.length) {
        await link[cfg.relacao.model].createMany({
          data: alvos.map((alvo) => ({ [cfg.relacao!.campoPai]: id, [cfg.relacao!.campoAlvo]: alvo })),
          skipDuplicates: true,
        })
      }
    }
    return NextResponse.json({ registro })
  } catch (e) {
    console.error(`PUT cadastros/${entidade}/${idStr}`, e)
    return NextResponse.json({ error: 'Erro ao salvar o registro.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ entidade: string; id: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const { entidade, id: idStr } = await params
  const cfg = CADASTROS[entidade]
  if (!cfg) return NextResponse.json({ error: 'Cadastro não encontrado.' }, { status: 404 })
  const id = Number(idStr)
  try {
    const atual = await db[cfg.model].findUnique({ where: { id } })
    if (!atual) return NextResponse.json({ error: 'Registro não encontrado.' }, { status: 404 })

    // EXCLUSÃO FÍSICA só sem vínculo. Havendo qualquer um, o registro é
    // patrimônio de outro dado: a resposta orienta a INATIVAR, e nada é apagado.
    for (const p of cfg.protegerExclusao ?? []) {
      const usos = await db[p.model].count({ where: { [p.campo]: id } }).catch(() => 0)
      if (usos > 0) {
        return NextResponse.json(
          {
            error: `Não é possível excluir: ${usos} ${p.rotulo} usam este registro. Inative-o — os cadastros já vinculados continuam exibindo a categoria.`,
            emUso: true, vinculos: usos,
          },
          { status: 409 },
        )
      }
    }

    // vínculos primeiro (a FK é ON DELETE CASCADE, mas não dependemos disso)
    if (cfg.relacao) await link[cfg.relacao.model].deleteMany({ where: { [cfg.relacao.campoPai]: id } })
    await db[cfg.model].delete({ where: { id } })
    if (cfg.auditoria) {
      await registrarAuditoria(request, {
        acao: 'EXCLUIR', entidade: cfg.auditoria, entidadeId: id,
        descricao: `${cfg.titulo}: excluído ${String(atual[cfg.identidade ?? 'id'] ?? id)}`,
        detalhes: atual as Record<string, unknown>,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(`DELETE cadastros/${entidade}/${idStr}`, e)
    return NextResponse.json(
      { error: 'Não foi possível excluir — o registro pode estar em uso. Inative-o em vez de excluir.' },
      { status: 409 },
    )
  }
}
