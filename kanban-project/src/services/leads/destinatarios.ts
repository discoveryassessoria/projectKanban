// src/services/leads/destinatarios.ts
// ============================================================================
// QUEM ATENDE LEADS — docs/leads-mandato.md, regras 19, 20 e 27.
//
// Pela COMPETÊNCIA (`leads.atender`, exclusiva: só por concessão nominal), nunca por `tipo === 'admin'`.
// É a lista de quem recebe o aviso no sino. Hoje é uma pessoa só; conceder a outra é cadastro, não
// mudança neste arquivo.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { calcularPermissoes, temPermissao, type MapaPermissoes } from "@/src/lib/permissoes"

export const PERMISSAO_DE_LEADS = "leads.atender" as const

export async function usuariosQueAtendemLeads(): Promise<number[]> {
  const usuarios = await prisma.usuario.findMany({
    select: { id: true, tipo: true, permissoesCustom: true, perfil: { select: { permissoes: true } } },
    orderBy: { id: "asc" },
  })
  return usuarios
    .filter((u) =>
      temPermissao(
        calcularPermissoes(u.tipo, (u.perfil?.permissoes as MapaPermissoes | null) ?? null, (u.permissoesCustom as MapaPermissoes | null) ?? null),
        PERMISSAO_DE_LEADS,
      ),
    )
    .map((u) => u.id)
}
