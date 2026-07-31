// src/app/api/gerenciamento/cadastros/[entidade]/route.ts
//
// API GENÉRICA dos cadastros simples do Gerenciamento. A forma de cada cadastro
// vem do REGISTRO ÚNICO (src/lib/gerenciamento/cadastros-registry.ts) — não há
// CRUD copiado por entidade nem spec duplicada entre backend e frontend.
//
// Aceita SOMENTE as entidades declaradas no registro (allow-list): nenhuma tabela
// arbitrária é exposta. Mesma permissão dos demais cadastros: usuarios.gerenciar.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { CADASTROS, FONTES, type CadastroSpec } from '@/src/lib/gerenciamento/cadastros-registry'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import {
  normalizarNome, chaveSemantica, gerarCodigo, proximaOrdem,
} from '@/lib/gerenciamento/cadastro-identidade'

type Delegate = {
  findMany: (args?: Record<string, unknown>) => Promise<Record<string, unknown>[]>
  findUnique: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>
  create: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
  count: (args?: Record<string, unknown>) => Promise<number>
}
const db = prisma as unknown as Record<string, Delegate>

export const spec = (entidade: string): CadastroSpec | null => CADASTROS[entidade] ?? null

/** monta o `data` do Prisma a partir do corpo, respeitando a spec (nada além dela). */
export function dadosDaSpec(cfg: CadastroSpec, body: Record<string, unknown>, criando: boolean) {
  const data: Record<string, unknown> = {}
  for (const campo of cfg.campos) {
    if (campo.tipo === 'multiselect') continue // relação é tratada à parte
    if (!(campo.key in body)) continue
    if (campo.imutavel && !criando) continue
    // Campo administrado pelo sistema NUNCA vem do cliente — nem na criação.
    if (campo.somenteLeitura) continue
    const v = body[campo.key]
    if (campo.tipo === 'number') data[campo.key] = v === '' || v == null ? null : Number(v)
    else if (campo.tipo === 'bool') data[campo.key] = !!v
    else if (campo.tipo === 'select' && campo.fonte === 'tiposProcesso') data[campo.key] = v === '' || v == null ? null : Number(v)
    else if (cfg.identidade && campo.key === cfg.identidade) data[campo.key] = normalizarNome(String(v ?? ''))
    else data[campo.key] = v === '' || v == null ? null : String(v)
  }
  return data
}

/** opções dos selects/multiselects que vêm de outra tabela (id + rótulo apenas). */
async function carregarFontes(cfg: CadastroSpec) {
  const usadas = [...new Set(cfg.campos.map((c) => c.fonte).filter((f): f is string => !!f))]
  const out: Record<string, { valor: string; label: string }[]> = {}
  for (const nome of usadas) {
    const f = FONTES[nome]
    if (!f) continue
    const rows = await db[f.model].findMany({
      where: f.where,
      select: Object.fromEntries([[f.valor, true], ...f.label.map((l) => [l, true])]),
      take: 500,
    }).catch(() => [])
    out[nome] = rows.map((r) => ({
      valor: String(r[f.valor]),
      label: f.label.map((l) => r[l]).filter(Boolean).join(' ') || String(r[f.valor]),
    }))
  }
  return out
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ entidade: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const { entidade } = await params
  const cfg = spec(entidade)
  if (!cfg) return NextResponse.json({ error: 'Cadastro não encontrado.' }, { status: 404 })
  try {
    const orderBy = (cfg.ordenarPor ?? [{ campo: 'id', direcao: 'asc' as const }]).map((o) => ({ [o.campo]: o.direcao }))
    const registros = await db[cfg.model].findMany({
      orderBy,
      ...(cfg.relacao ? { include: { [cfg.relacao.prop]: { select: { [cfg.relacao.campoAlvo]: true } } } } : {}),
    })
    const out = cfg.relacao
      ? registros.map((r) => {
          const vinc = (r[cfg.relacao!.prop] as Record<string, unknown>[] | undefined) ?? []
          const { [cfg.relacao!.prop]: _omit, ...resto } = r
          void _omit
          return { ...resto, [cfg.relacao!.campoForm]: vinc.map((v) => String(v[cfg.relacao!.campoAlvo])) }
        })
      : registros
    return NextResponse.json({ spec: cfg, registros: out, fontes: await carregarFontes(cfg) })
  } catch (e) {
    console.error(`GET cadastros/${entidade}`, e)
    return NextResponse.json({ error: 'Erro ao carregar o cadastro.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ entidade: string }> }) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const { entidade } = await params
  const cfg = spec(entidade)
  if (!cfg) return NextResponse.json({ error: 'Cadastro não encontrado.' }, { status: 404 })
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    for (const c of cfg.campos) {
      if (c.obrigatorio && !String(body[c.key] ?? '').trim()) {
        return NextResponse.json({ error: `Informe ${c.label.toLowerCase()}.` }, { status: 400 })
      }
    }
    const data = dadosDaSpec(cfg, body, true)

    // Registros existentes: base para duplicidade, código único e próxima posição.
    const existentes = cfg.identidade || cfg.ordenavel || cfg.codeDe
      ? await db[cfg.model].findMany({ orderBy: { id: 'asc' } })
      : []

    // DUPLICIDADE por equivalência semântica — caixa, acento e espaço excedente
    // não criam cadastro novo.
    if (cfg.identidade) {
      const nome = normalizarNome(String(body[cfg.identidade] ?? ''))
      const chave = chaveSemantica(nome)
      const colide = existentes.find((r) => chaveSemantica(String(r[cfg.identidade!] ?? '')) === chave)
      if (colide) {
        return NextResponse.json(
          { error: `Já existe uma categoria equivalente: "${String(colide[cfg.identidade])}".`, campo: cfg.identidade },
          { status: 409 },
        )
      }
    }

    // CÓDIGO gerado pelo sistema a partir do nome. Nunca vem do cliente.
    const temCode = cfg.campos.some((c) => c.key === 'code')
    if (temCode && cfg.codeDe) {
      const base = normalizarNome(String(body[cfg.codeDe] ?? ''))
      const code = gerarCodigo(base, existentes.map((r) => String(r.code ?? '')))
      if (code) data.code = code
    }

    // ORDEM: nasce no fim da lista. O operador não digita posição.
    if (cfg.ordenavel) data.ordem = proximaOrdem(existentes as { id: number; ordem?: number | null }[])

    if (data.ativo === undefined) data.ativo = true

    const criado = await db[cfg.model].create({ data })
    if (cfg.auditoria) {
      await registrarAuditoria(request, {
        acao: 'CRIAR', entidade: cfg.auditoria, entidadeId: Number(criado.id),
        descricao: `${cfg.titulo}: criado ${String(criado[cfg.identidade ?? 'id'] ?? criado.id)}`,
        detalhes: data as Record<string, unknown>,
      })
    }

    // vínculos N:N (ex.: membros da equipe)
    if (cfg.relacao && Array.isArray(body[cfg.relacao.campoForm])) {
      const alvos = (body[cfg.relacao.campoForm] as unknown[]).map((v) => Number(v)).filter((n) => Number.isFinite(n))
      if (alvos.length) {
        await (prisma as unknown as Record<string, { createMany: (a: Record<string, unknown>) => Promise<unknown> }>)[cfg.relacao.model].createMany({
          data: alvos.map((alvo) => ({ [cfg.relacao!.campoPai]: criado.id, [cfg.relacao!.campoAlvo]: alvo })),
          skipDuplicates: true,
        })
      }
    }
    return NextResponse.json({ registro: criado }, { status: 201 })
  } catch (e) {
    console.error(`POST cadastros/${entidade}`, e)
    return NextResponse.json({ error: 'Erro ao criar o registro.' }, { status: 500 })
  }
}
