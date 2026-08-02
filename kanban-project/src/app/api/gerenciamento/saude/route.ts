// src/app/api/gerenciamento/saude/route.ts
//
// GET  — último retrato persistido + catálogo + cobertura + achados vivos.
// POST — executa o diagnóstico (modo RAPIDO | COMPLETO | PROFUNDO) e persiste.
//
// O GET nunca inventa estado: se nunca houve execução, ele diz "SAÚDE
// DESCONHECIDA" em vez de "saudável".

import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import {
  achadosAbertos, catalogo, cobertura, dominiosSemCobertura, executarDiagnostico,
  metadados, persistirDiagnostico, ultimaExecucao, VERSAO_CATALOGO,
  DOMINIO_LABEL, ESTADO_LABEL, SEVERIDADE_LABEL, type ModoExecucao,
} from '@/lib/saude'

const MODOS: ModoExecucao[] = ['RAPIDO', 'COMPLETO', 'PROFUNDO']

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const [ultima, achados] = await Promise.all([ultimaExecucao(), achadosAbertos()])
    return NextResponse.json({
      // "nunca executado" NÃO é "saudável" — é desconhecido.
      execucao: ultima,
      estadoAtual: ultima?.estado ?? 'INDISPONIVEL',
      motivoEstado: ultima?.motivoEstado ?? 'o diagnóstico nunca foi executado neste ambiente',
      achados,
      catalogo: catalogo().map(metadados),
      cobertura: cobertura(),
      dominiosSemCobertura: dominiosSemCobertura(),
      versaoCatalogo: VERSAO_CATALOGO,
      rotulos: { dominios: DOMINIO_LABEL, estados: ESTADO_LABEL, severidades: SEVERIDADE_LABEL },
    })
  } catch (e) {
    console.error('GET saude', e)
    return NextResponse.json({ error: 'Erro ao carregar a saúde do sistema.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))
    const modo: ModoExecucao = MODOS.includes(body?.modo) ? body.modo : 'COMPLETO'
    const somenteCodigos: string[] | undefined = Array.isArray(body?.somenteCodigos) && body.somenteCodigos.length
      ? body.somenteCodigos.map(String)
      : undefined

    const resultado = await executarDiagnostico({ modo, somenteCodigos })
    const persistencia = await persistirDiagnostico(resultado, { disparadoPorId: usuario?.userId ?? null })

    return NextResponse.json({ resultado, persistencia })
  } catch (e) {
    console.error('POST saude', e)
    // Falha do próprio motor é INDISPONÍVEL — jamais silêncio otimista.
    return NextResponse.json(
      { error: 'O motor de diagnóstico não conseguiu executar.', estado: 'INDISPONIVEL', detalhe: String((e as Error)?.message ?? e).slice(0, 300) },
      { status: 500 },
    )
  }
}
