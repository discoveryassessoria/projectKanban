import { PrismaClient } from "@prisma/client"
import { CODE_REGISTRY } from "./codigos/entity-registry"
import { gerarCodigoPublico, sincronizarSequenciaComTabela } from "./codigos/code-generator"
import { escopoDe } from "./codigos/code-patterns"

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof buildPrisma>; prismaBase?: PrismaClient }

/**
 * URL do runtime, com o pool contido.
 *
 * CAUSA RAIZ do "too many database connections": cada instância de função
 * serverless abre o SEU pool, e o padrão do Prisma é `num_cpus * 2 + 1` — algo
 * como 5 a 9 conexões POR INSTÂNCIA. Com dezenas de instâncias vivas (Fluid
 * Compute reaproveita, mas escala horizontalmente sob carga) mais os scripts que
 * rodam durante builds concorrentes, o banco chega ao teto e passa a recusar
 * `findUnique` como se fosse erro da aplicação.
 *
 * Enquanto a URL do runtime for uma conexão TCP direta, cada instância fica com
 * UMA conexão. É o ajuste padrão para serverless: a concorrência vem do número
 * de instâncias, não do tamanho do pool de cada uma.
 *
 * Se a URL já for pooled (`prisma+postgres://`, Accelerate, PgBouncer), nada é
 * alterado — quem gerencia o pool ali é o proxy, e mexer no limite atrapalha.
 *
 * O valor nunca é lido, comparado ou registrado: só se acrescentam parâmetros.
 */
function urlDoRuntime(): string | undefined {
  const bruta = process.env.PRISMA_DATABASE_URL
  if (!bruta) return undefined

  const pooled =
    bruta.startsWith("prisma+postgres://") ||
    bruta.includes("accelerate.prisma-data.net") ||
    bruta.includes("pooler.") ||
    bruta.includes("pgbouncer=true")
  if (pooled) return bruta

  const jaTem = bruta.includes("connection_limit=")
  if (jaTem) return bruta

  const separador = bruta.includes("?") ? "&" : "?"
  // POR QUE NÃO 1: com uma única conexão, QUALQUER concorrência dentro da mesma
  // instância é fatal por construção. Uma transação longa — a criação de processo
  // leva até 20s — segura a conexão inteira, e a requisição seguinte espera o
  // `pool_timeout` e morre com "Timed out fetching a new connection from the
  // connection pool". Foi exatamente esse o erro que bloqueou a criação de
  // processo em produção.
  //
  // 5 é pequeno o bastante para o total continuar governado pelo número de
  // instâncias (que é o raciocínio correto em serverless) e grande o bastante
  // para uma transação em curso não bloquear as leituras ao lado.
  //
  // `pool_timeout` alto o bastante para uma requisição esperar a vez em vez de
  // falhar na hora, e baixo o bastante para não segurar a função até o limite.
  return `${bruta}${separador}connection_limit=5&pool_timeout=20`
}

// Client BASE (sem extensão) — usado pela geração de código p/ rodar o INSERT atômico da sequência
// (o gerador usa $queryRaw, não create → sem recursão do hook).
const base =
  globalForPrisma.prismaBase ??
  new PrismaClient({
    log: ["warn", "error"],
    ...(urlDoRuntime() ? { datasources: { db: { url: urlDoRuntime() as string } } } : {}),
  })

// EXTENSÃO ÚNICA: gera publicCode automaticamente no create de QUALQUER modelo registrado no
// CODE_REGISTRY, sempre pelo CodeGeneratorService central. Uniforme p/ todas as entidades — nenhum
// controller/serviço monta código. FAIL-SAFE: se a geração falhar, o create prossegue sem código
// (backfill/reconciliação cobrem) — nunca derruba a criação da entidade.
/** O erro é violação de UNIQUE no campo de código público? */
function ehColisaoDeCodigo(e: unknown, campo: string): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } }
  if (err?.code !== 'P2002') return false
  const alvo = err?.meta?.target
  const campos = Array.isArray(alvo) ? alvo.map(String) : typeof alvo === 'string' ? [alvo] : []
  return campos.some((c) => c === campo || c.includes(campo))
}

function buildPrisma() {
  return base.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const cfg = CODE_REGISTRY[model as string]
          const data = args?.data as Record<string, unknown> | undefined
          if (!cfg || !data || Array.isArray(data)) return query(args)

          // publicCode é SEMPRE gerado pelo backend: ignora qualquer valor enviado pelo cliente
          // (nunca aceita código público informado) e é OBRIGATÓRIO — se a geração falhar, o
          // create FALHA (sem fail-safe). Lacuna na sequência é aceitável; entidade sem código não.
          delete data[cfg.campo]
          data[cfg.campo] = await gerarCodigoPublico(base, cfg.entidade)
          try {
            return await query(args)
          } catch (e) {
            // AUTOCURA da sequência. Colidir no código público significa uma coisa só: o contador
            // do escopo está ATRÁS dos códigos já gravados (limpeza que preservou registros e zerou
            // CodeSequence, backfill que não avançou o contador...). Ressincroniza com o MAIOR
            // código existente na tabela e tenta UMA vez. Não é esconder erro: é a sequência
            // convergindo para a realidade — qualquer outra falha sobe intacta.
            if (!ehColisaoDeCodigo(e, cfg.campo)) throw e
            await sincronizarSequenciaComTabela(base, model as string, cfg.campo, escopoDe(cfg.entidade))
            delete data[cfg.campo]
            data[cfg.campo] = await gerarCodigoPublico(base, cfg.entidade)
            return await query(args)
          }
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

// O cache no globalThis vale TAMBÉM em produção.
//
// Antes ele existia só fora de produção, para sobreviver ao hot reload. Mas o
// módulo é avaliado mais de uma vez dentro da MESMA instância serverless (route
// handlers, middleware e instrumentação entram em bundles distintos), e sem o
// cache cada avaliação criava outro PrismaClient — outro pool inteiro, sobre o
// mesmo banco, sem ninguém fechar o anterior. Guardar aqui é o que garante um
// cliente por instância, que é a conta que o limite de conexões pressupõe.
globalForPrisma.prisma = _prisma
globalForPrisma.prismaBase = base

// Runtime = client ESTENDIDO (gera publicCode no create). Tipo exposto = PrismaClient — o hook é
// transparente (mesma assinatura) e evita propagar o tipo estendido por todo o código.
export const prisma = _prisma as unknown as PrismaClient
