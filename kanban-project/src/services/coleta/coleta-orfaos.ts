// src/services/coleta/coleta-orfaos.ts
// ============================================================================
// ARQUIVO DA COLETA SEM FORMULÁRIO (ponto (a) de docs/proposta-anexos-cliente-e-privacidade.md).
//
// O navegador sobe o arquivo (URL assinada) ANTES de enviar o formulário. Se o cliente desiste, o objeto fica em
// `privado/coleta/<link>/<uuid>/…` sem nenhuma linha em `ColetaArquivo` — e nada o apagava (a purga só olha envios descartados).
//
// ROTINA DIÁRIA (cron `coleta-orfaos`, mesmo molde de `coleta-purga`):
//   • lista o prefixo `privado/coleta/` e separa o objeto que (a) NÃO tem linha em `ColetaArquivo` e (b) tem MAIS de 48 HORAS
//     (a folga protege quem está preenchendo agora). Idade desconhecida = protegido: nunca se apaga sem saber que passou de 48 h.
//   • MODO PADRÃO = SÓ RELATAR: grava o relatório na auditoria e NÃO apaga nada.
//   • A exclusão só acontece com a variável `COLETA_ORFAOS_APAGAR=1` (DESLIGADA por padrão — o dono manda ligar depois de uma semana de
//     relatórios). Ligada, apaga UM POR UM e, imediatamente antes de cada exclusão, RECONFERE que o objeto ainda não tem linha no banco e
//     ainda tem mais de 48 h. Qualquer dúvida: não apaga.
//   • Nunca usa regra de ciclo de vida do R2 por idade (ela apagaria também arquivo COM linha, de envio ainda pendente).
//   • Só apaga no bucket onde a chave é GRAVADA (privado, no modo duplo). Objeto `privado/` que está no bucket PÚBLICO (plano B da migração)
//     é só relatado: apagar do público é ato separado, com ordem do dono.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { PREFIXO_COLETA, apagarObjetoColeta } from "./storage-coleta"
import { bucketDaEscrita } from "@/src/lib/documentos/modelos/storage-privado"
import { configDosBuckets, type ConfigBuckets } from "@/src/lib/r2-buckets"

export const HORAS_DE_FOLGA = 48
const MS_FOLGA = HORAS_DE_FOLGA * 60 * 60 * 1000
export const VARIAVEL_PARA_APAGAR = "COLETA_ORFAOS_APAGAR"

/** A exclusão está LIGADA? Só com o valor exato "1". Qualquer outra coisa (ausente, "0", "true", "sim") = só relatar. */
export const exclusaoLigada = (env: Record<string, string | undefined> = process.env): boolean => env[VARIAVEL_PARA_APAGAR] === "1"

export interface ObjetoDaColeta { bucket: string; chave: string; tamanho: number; data: string | null }

export interface ClassificacaoDeOrfaos {
  /** Sem linha em `ColetaArquivo` E com mais de 48 h: candidatos (o relatório os lista; a exclusão, se ligada, os apaga). */
  candidatos: ObjetoDaColeta[]
  /** Sem linha, mas com menos de 48 h ou de idade desconhecida: protegidos (podem estar sendo preenchidos agora). */
  protegidosPorIdade: ObjetoDaColeta[]
  /** Com linha no banco: nunca entram. */
  comLinha: number
}

/** PURA — a regra. `agora` injetável. */
export function classificarObjetosDaColeta(args: { objetos: ObjetoDaColeta[]; chavesComLinha: ReadonlySet<string>; agora: Date }): ClassificacaoDeOrfaos {
  const candidatos: ObjetoDaColeta[] = []
  const protegidosPorIdade: ObjetoDaColeta[] = []
  let comLinha = 0
  for (const o of args.objetos) {
    if (args.chavesComLinha.has(o.chave)) { comLinha++; continue }
    const t = o.data ? Date.parse(o.data) : NaN
    if (Number.isNaN(t) || args.agora.getTime() - t <= MS_FOLGA) protegidosPorIdade.push(o)
    else candidatos.push(o)
  }
  return { candidatos, protegidosPorIdade, comLinha }
}

/** As portas de fora (banco e storage) — injetáveis para o teste usar um storage de mentira. */
export interface PortasDaColeta {
  listar: () => Promise<ObjetoDaColeta[]>
  chavesComLinha: () => Promise<Set<string>>
  /** Reconferência de UMA chave, imediatamente antes de apagar. */
  temLinha: (chave: string) => Promise<boolean>
  /** Data de modificação ATUAL do objeto no bucket (null = não existe mais / desconhecida). */
  dataAtual: (bucket: string, chave: string) => Promise<string | null>
  apagar: (chave: string) => Promise<void>
  /** Bucket onde a chave é gravada (só aí se apaga). */
  bucketDeEscrita: (chave: string) => string
}

export interface RelatorioDaColeta {
  geradoEm: string
  modo: "SO_RELATAR" | "APAGANDO"
  totais: { objetosListados: number; comLinha: number; candidatos: number; protegidosPorIdade: number; bytesDosCandidatos: number }
  candidatos: ObjetoDaColeta[]
  /** Só no modo APAGANDO. */
  apagados: string[]
  pulados: Array<{ chave: string; motivo: string }>
  falhas: Array<{ chave: string; erro: string }>
}

/** O coração (testável): classifica e, só se `apagarLigado`, apaga um por um com reconferência. Nunca lança por causa de um objeto. */
export async function varrerColeta(portas: PortasDaColeta, opcoes: { agora?: Date; apagarLigado?: boolean } = {}): Promise<RelatorioDaColeta> {
  const agora = opcoes.agora ?? new Date()
  const objetos = await portas.listar()
  const chaves = await portas.chavesComLinha()
  const c = classificarObjetosDaColeta({ objetos, chavesComLinha: chaves, agora })
  const rel: RelatorioDaColeta = {
    geradoEm: agora.toISOString(), modo: opcoes.apagarLigado ? "APAGANDO" : "SO_RELATAR",
    totais: { objetosListados: objetos.length, comLinha: c.comLinha, candidatos: c.candidatos.length, protegidosPorIdade: c.protegidosPorIdade.length, bytesDosCandidatos: c.candidatos.reduce((s, o) => s + o.tamanho, 0) },
    candidatos: c.candidatos, apagados: [], pulados: [], falhas: [],
  }
  if (!opcoes.apagarLigado) return rel

  for (const o of c.candidatos) {
    // Só no bucket onde a chave é gravada; cópia no outro bucket (plano B) fica para ordem do dono.
    if (o.bucket !== portas.bucketDeEscrita(o.chave)) { rel.pulados.push({ chave: o.chave, motivo: "está no bucket público (plano B): só relatado" }); continue }
    try {
      // RECONFERÊNCIA imediatamente antes de apagar: continua sem linha? continua com mais de 48 h?
      if (await portas.temLinha(o.chave)) { rel.pulados.push({ chave: o.chave, motivo: "ganhou linha no banco" }); continue }
      const data = await portas.dataAtual(o.bucket, o.chave)
      const t = data ? Date.parse(data) : NaN
      if (Number.isNaN(t)) { rel.pulados.push({ chave: o.chave, motivo: "idade desconhecida ou objeto já não existe" }); continue }
      if (agora.getTime() - t <= MS_FOLGA) { rel.pulados.push({ chave: o.chave, motivo: "objeto novo (regravado há menos de 48 h)" }); continue }
      await portas.apagar(o.chave)
      rel.apagados.push(o.chave)
    } catch (e) {
      rel.falhas.push({ chave: o.chave, erro: String((e as Error)?.message ?? e).slice(0, 200) })
    }
  }
  return rel
}

/** As portas reais: R2 (só LIST/HEAD/DELETE da chave) e o banco (só leitura). */
export function portasReais(cfg: ConfigBuckets = configDosBuckets()): PortasDaColeta {
  const buckets = [...new Set([cfg.privado, cfg.publico].filter((b): b is string => !!b))]
  return {
    async listar() {
      const { r2 } = await import("@/src/lib/r2")
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3")
      const out: ObjetoDaColeta[] = []
      for (const bucket of buckets) {
        let token: string | undefined
        do {
          const r = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${PREFIXO_COLETA}/`, ContinuationToken: token, MaxKeys: 1000 }))
          for (const o of r.Contents ?? []) out.push({ bucket, chave: o.Key!, tamanho: o.Size ?? 0, data: o.LastModified?.toISOString() ?? null })
          token = r.NextContinuationToken
        } while (token)
      }
      return out
    },
    async chavesComLinha() { return new Set((await prisma.coletaArquivo.findMany({ select: { chave: true } })).map((a) => a.chave)) },
    async temLinha(chave) { return (await prisma.coletaArquivo.count({ where: { chave } })) > 0 },
    async dataAtual(bucket, chave) {
      const { r2 } = await import("@/src/lib/r2")
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3")
      const h = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: chave })).catch(() => null)
      return h?.LastModified?.toISOString() ?? null
    },
    apagar: apagarObjetoColeta,
    bucketDeEscrita: (chave) => bucketDaEscrita(chave),
  }
}

const LIMITE_NA_AUDITORIA = 300

/** A rotina inteira: varre, REGISTRA o relatório na auditoria e devolve o resumo. Por padrão NÃO apaga nada. */
export async function rodarVarreduraDaColeta(portas: PortasDaColeta = portasReais(), env: Record<string, string | undefined> = process.env): Promise<RelatorioDaColeta> {
  const rel = await varrerColeta(portas, { apagarLigado: exclusaoLigada(env) })
  await prisma.logAuditoria.create({
    data: {
      acao: "coleta_orfaos_relatorio",
      entidade: "ColetaArquivo",
      entidadeId: 0,
      descricao: rel.modo === "SO_RELATAR"
        ? `Coleta — arquivos sem formulário (só relatório, nada apagado): ${rel.totais.candidatos} com mais de ${HORAS_DE_FOLGA} h, ${rel.totais.protegidosPorIdade} recentes protegidos, ${rel.totais.comLinha} com linha no banco`
        : `Coleta — arquivos sem formulário (exclusão LIGADA): ${rel.apagados.length} apagado(s), ${rel.pulados.length} pulado(s), ${rel.falhas.length} falha(s)`,
      detalhes: JSON.parse(JSON.stringify({
        modo: rel.modo, totais: rel.totais,
        candidatos: rel.candidatos.slice(0, LIMITE_NA_AUDITORIA), candidatosTruncado: rel.candidatos.length > LIMITE_NA_AUDITORIA,
        apagados: rel.apagados, pulados: rel.pulados, falhas: rel.falhas,
      })),
    },
  })
  if (rel.falhas.length) console.error("[coleta-orfaos] falhas ao apagar:", rel.falhas)
  return rel
}
