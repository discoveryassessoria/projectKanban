// src/app/api/gerenciamento/configuracao-sistema/route.ts
//
// CONFIGURAÇÃO GLOBAL chave/valor (ConfiguracaoSistema). Alimenta
// Sistema › Configurações Gerais e Sistema › Identidade Visual.
//
// Allow-list rígida: só as chaves declaradas em CHAVES são lidas/gravadas —
// a API nunca vira um armazenamento genérico. Grava com upsert (idempotente) e
// registra quem alterou.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export interface ChaveSpec {
  chave: string
  grupo: 'geral' | 'identidade'
  label: string
  tipo: 'text' | 'textarea' | 'select' | 'bool' | 'cor'
  opcoes?: string[]
  ajuda?: string
  padrao?: string
}

export const CHAVES: ChaveSpec[] = [
  // ── Configurações Gerais ────────────────────────────────────────────────
  { chave: 'empresa.nome', grupo: 'geral', label: 'Nome da empresa', tipo: 'text' },
  { chave: 'empresa.documento', grupo: 'geral', label: 'CNPJ', tipo: 'text' },
  { chave: 'empresa.email', grupo: 'geral', label: 'E-mail de contato', tipo: 'text' },
  { chave: 'empresa.telefone', grupo: 'geral', label: 'Telefone', tipo: 'text' },
  { chave: 'empresa.endereco', grupo: 'geral', label: 'Endereço', tipo: 'textarea' },
  { chave: 'geral.moedaPadrao', grupo: 'geral', label: 'Moeda padrão', tipo: 'select', opcoes: ['EUR', 'BRL', 'USD'], padrao: 'EUR', ajuda: 'Usada como sugestão nos cadastros. O câmbio oficial continua vindo da cotação.' },
  { chave: 'geral.idioma', grupo: 'geral', label: 'Idioma', tipo: 'select', opcoes: ['pt-BR', 'en-US', 'it-IT', 'es-ES'], padrao: 'pt-BR' },
  { chave: 'geral.fusoHorario', grupo: 'geral', label: 'Fuso horário', tipo: 'text', padrao: 'America/Sao_Paulo' },

  // ── Identidade Visual ───────────────────────────────────────────────────
  { chave: 'identidade.marca', grupo: 'identidade', label: 'Nome exibido da marca', tipo: 'text' },
  { chave: 'identidade.logoUrl', grupo: 'identidade', label: 'URL do logotipo', tipo: 'text', ajuda: 'Endereço público da imagem.' },
  { chave: 'identidade.corDestaque', grupo: 'identidade', label: 'Cor de destaque', tipo: 'cor', padrao: '#4f91c5' },
  { chave: 'identidade.corTexto', grupo: 'identidade', label: 'Cor de texto sobre o destaque', tipo: 'cor', padrao: '#0b1220' },
  { chave: 'identidade.assinaturaEmail', grupo: 'identidade', label: 'Assinatura padrão de e-mail', tipo: 'textarea' },
]

const PERMITIDAS = new Set(CHAVES.map((c) => c.chave))

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const linhas = await prisma.configuracaoSistema.findMany({ where: { chave: { in: [...PERMITIDAS] } } })
    const valores: Record<string, string> = {}
    for (const c of CHAVES) valores[c.chave] = c.padrao ?? ''
    for (const l of linhas) valores[l.chave] = l.valor ?? ''
    const ultima = linhas.reduce<Date | null>((max, l) => (!max || l.atualizadoEm > max ? l.atualizadoEm : max), null)
    return NextResponse.json({ chaves: CHAVES, valores, atualizadoEm: ultima })
  } catch (e) {
    console.error('GET configuracao-sistema', e)
    return NextResponse.json({ error: 'Erro ao carregar as configurações.' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const body = (await request.json().catch(() => ({}))) as { valores?: Record<string, unknown> }
    const entradas = Object.entries(body.valores ?? {}).filter(([k]) => PERMITIDAS.has(k))
    if (entradas.length === 0) return NextResponse.json({ error: 'Nenhuma configuração válida enviada.' }, { status: 400 })

    const grupoDe = new Map(CHAVES.map((c) => [c.chave, c.grupo]))
    await prisma.$transaction(
      entradas.map(([chave, valor]) =>
        prisma.configuracaoSistema.upsert({
          where: { chave },
          create: { chave, valor: valor == null ? null : String(valor), grupo: grupoDe.get(chave) ?? 'geral' },
          update: { valor: valor == null ? null : String(valor) },
        }),
      ),
    )
    return NextResponse.json({ ok: true, gravadas: entradas.length })
  } catch (e) {
    console.error('PUT configuracao-sistema', e)
    return NextResponse.json({ error: 'Erro ao salvar as configurações.' }, { status: 500 })
  }
}
