// GET /api/gerenciamento/cartorios — status administrativo da base de Cartórios
// (fonte, contagens, última sincronização). Só leitura do banco — nunca chama a
// fonte externa diretamente (ver seção 27/28 do comando: frontend nunca depende
// da disponibilidade do portal).
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { statusDaSincronizacao } from "@/src/services/cartorios/cartorio-sync-service"

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, "usuarios.gerenciar")
  if (erro) return erro
  const status = await statusDaSincronizacao()
  return NextResponse.json(status)
}
