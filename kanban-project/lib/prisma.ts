import { PrismaClient } from "@prisma/client"
import { CODE_REGISTRY } from "./codigos/entity-registry"
import { gerarCodigoPublico } from "./codigos/code-generator"

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof buildPrisma>; prismaBase?: PrismaClient }

// Client BASE (sem extensão) — usado pela geração de código p/ rodar o INSERT atômico da sequência
// (o gerador usa $queryRaw, não create → sem recursão do hook).
const base = globalForPrisma.prismaBase ?? new PrismaClient({ log: ["warn", "error"] })

// EXTENSÃO ÚNICA: gera publicCode automaticamente no create de QUALQUER modelo registrado no
// CODE_REGISTRY, sempre pelo CodeGeneratorService central. Uniforme p/ todas as entidades — nenhum
// controller/serviço monta código. FAIL-SAFE: se a geração falhar, o create prossegue sem código
// (backfill/reconciliação cobrem) — nunca derruba a criação da entidade.
function buildPrisma() {
  return base.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const cfg = CODE_REGISTRY[model as string]
          const data = args?.data as Record<string, unknown> | undefined
          if (cfg && data && !Array.isArray(data)) {
            // publicCode é SEMPRE gerado pelo backend: ignora qualquer valor enviado pelo cliente
            // (nunca aceita código público informado) e é OBRIGATÓRIO — se a geração falhar, o
            // create FALHA (sem fail-safe). Lacuna na sequência é aceitável; entidade sem código não.
            delete data[cfg.campo]
            data[cfg.campo] = await gerarCodigoPublico(base, cfg.entidade)
          }
          return query(args)
        },
        // createMany: gera 1 código por linha (também obrigatório; ignora valor do cliente).
        async createMany({ model, args, query }) {
          const cfg = CODE_REGISTRY[model as string]
          const data = args?.data
          if (cfg && data) {
            const rows = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[]
            for (const row of rows) {
              delete row[cfg.campo]
              row[cfg.campo] = await gerarCodigoPublico(base, cfg.entidade)
            }
          }
          return query(args)
        },
        // GUARDA DE EDIÇÃO: o código público é imutável. Qualquer update/updateMany que tente
        // alterar publicCode tem o campo REMOVIDO do data (ignorado silenciosamente) — nenhuma
        // rota comum pode editar o código. (Correção administrativa auditada seria ferramenta à parte.)
        async update({ model, args, query }) {
          const cfg = CODE_REGISTRY[model as string]
          const data = args?.data as Record<string, unknown> | undefined
          if (cfg && data && cfg.campo in data) delete data[cfg.campo]
          return query(args)
        },
        async updateMany({ model, args, query }) {
          const cfg = CODE_REGISTRY[model as string]
          const data = args?.data as Record<string, unknown> | undefined
          if (cfg && data && cfg.campo in data) delete data[cfg.campo]
          return query(args)
        },
      },
    },
  })
}

const _prisma = globalForPrisma.prisma ?? buildPrisma()

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = _prisma
  globalForPrisma.prismaBase = base
}

// Runtime = client ESTENDIDO (gera publicCode no create). Tipo exposto = PrismaClient — o hook é
// transparente (mesma assinatura) e evita propagar o tipo estendido por todo o código.
export const prisma = _prisma as unknown as PrismaClient
