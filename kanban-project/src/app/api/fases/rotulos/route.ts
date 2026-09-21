// src/app/api/fases/rotulos/route.ts
//
// ROTULOS DE FASE — leitura pública (qualquer usuário autenticado, não só
// admin) do cadastro do Gerenciamento. Existe porque telas operacionais
// (Central Operacional, Minha Operação, Visão Global) resolviam o rótulo da
// fase só pelo catálogo de código (10 fases canônicas), e para qualquer fase
// cadastrada fora dele caíam num "troca `_` por espaço" manual — que é como
// TESTEVIS_fase virava "TESTEVIS fase" na Operação enquanto o processo já
// mostrava "Fase de Teste Visual" via /api/processos/[id] (achado real,
// 20/09/2026). GET /api/gerenciamento/catalogo-fases já existe, mas exige
// `usuarios.gerenciar` (admin) — inadequado para telas operacionais comuns.
//
// Inclui fase INATIVA de propósito: um processo antigo pode estar numa fase
// desativada, e o rótulo histórico continua existindo no cadastro mesmo sem
// a fase ser mais ofertada em fluxo novo.
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

export async function GET(request: NextRequest) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const fases = await prisma.catalogoFase.findMany({ select: { phaseKey: true, label: true } })
  const rotulos = Object.fromEntries(fases.map((f) => [f.phaseKey, f.label]))
  return NextResponse.json({ rotulos })
}
