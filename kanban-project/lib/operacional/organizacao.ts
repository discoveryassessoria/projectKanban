// lib/operacional/organizacao.ts
// ============================================================================
// A CAMADA OPERACIONAL DO FUNCIONÁRIO — organização, aptidão, disponibilidade
// e capacidade.
//
// Três conceitos que este arquivo mantém SEPARADOS de propósito, porque
// misturá-los é como sistemas de distribuição costumam apodrecer:
//
//   AUTORIZAÇÃO   Perfil + permissoesCustom. Não mora aqui e não é tocada.
//   ORGANIZAÇÃO   equipe (`GrupoUsuario`) — já existia, foi REUTILIZADA.
//   CAPACIDADE    aptidão, disponibilidade e teto — o que este arquivo lê.
//
// A direção importa: nada aqui CONCEDE elegibilidade. Ser apto, estar
// disponível e ter capacidade sobrando não autoriza ninguém — apenas RESTRINGE
// quem já tem permissão. Se um dia esta camada ficar vazia, o sistema volta a
// ser exatamente o que era antes dela: elegível = quem pode executar.
//
// ─── POR QUE A APTIDÃO É POR FASE ───────────────────────────────────────────
// A fase publicada é a única dimensão que TODA tarefa carrega
// (`Tarefa.faseMacroKey`), e é o vocabulário do negócio: Genealogia, Emissão
// documental, Retificação de registros, Tradução juramentada, Apostilamento.
// O item do catálogo seria mais fino, mas metade das tarefas não tem
// necessidade vinculada — a regra ficaria inaplicável na metade dos casos.
// A chave é validada contra o catálogo publicado; não é string solta.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { TipoIndisponibilidade } from '@prisma/client'
import { FASES } from '@/src/lib/process-stage/fases-catalog'

/** As fases publicadas, como o cadastro deve oferecê-las. */
export function fasesDisponiveis(): Array<{ faseKey: string; label: string }> {
  return Object.values(FASES)
    .map((f) => ({ faseKey: f.phaseKey, label: f.label, ordem: f.ordem }))
    .sort((a, b) => a.ordem - b.ordem || a.label.localeCompare(b.label))
    .map(({ faseKey, label }) => ({ faseKey, label }))
}

const CHAVES_VALIDAS = new Set(Object.values(FASES).map((f) => f.phaseKey.toLowerCase()))

/** Uma fase existe? A escrita recusa o que o catálogo não conhece. */
export function faseValida(faseKey: string): boolean {
  return CHAVES_VALIDAS.has(faseKey.trim().toLowerCase())
}

export function rotuloDaFase(faseKey: string): string {
  const f = Object.values(FASES).find((x) => x.phaseKey.toLowerCase() === faseKey.trim().toLowerCase())
  return f?.label ?? faseKey
}

// ─── LEITURA EM LOTE ────────────────────────────────────────────────────────

export interface Indisponibilidade {
  id: number
  tipo: TipoIndisponibilidade
  inicio: string
  fim: string | null
  motivo: string | null
}

export interface OrganizacaoDoUsuario {
  usuarioId: number
  nome: string
  equipes: Array<{ id: number; code: string | null; nome: string }>
  aptidoes: string[]
  /** A indisponibilidade VIGENTE agora, se houver. */
  indisponivelPor: Indisponibilidade | null
  /** Todas, para a tela de gestão — inclusive as encerradas. */
  indisponibilidades: Indisponibilidade[]
  limiteExecutaveis: number | null
  observacaoCapacidade: string | null
}

const serializar = (i: { id: number; tipo: TipoIndisponibilidade; inicio: Date; fim: Date | null; motivo: string | null }): Indisponibilidade => ({
  id: i.id, tipo: i.tipo, inicio: i.inicio.toISOString(), fim: i.fim?.toISOString() ?? null, motivo: i.motivo,
})

/** Vigente = já começou e ainda não terminou. `fim` nulo é indisponibilidade em aberto. */
export function vigenteEm(i: { inicio: Date; fim: Date | null }, agora: Date): boolean {
  return i.inicio <= agora && (i.fim == null || i.fim > agora)
}

/**
 * A CAMADA INTEIRA, DE UMA VEZ.
 *
 * Quatro consultas, independentemente de quantos usuários existem. O
 * recomendador avalia N tarefas contra M usuários — se isto fosse por pessoa,
 * seria N×M idas ao banco.
 */
export async function lerOrganizacao(agora = new Date()): Promise<Map<number, OrganizacaoDoUsuario>> {
  const [usuarios, grupos, aptidoes, indisponibilidades, capacidades] = await Promise.all([
    prisma.usuario.findMany({ select: { id: true, nome: true }, orderBy: { id: 'asc' } }),
    prisma.grupoUsuario.findMany({
      where: { ativo: true },
      select: { id: true, code: true, nome: true, membros: { select: { usuarioId: true } } },
    }),
    prisma.aptidaoOperacional.findMany({ select: { usuarioId: true, faseKey: true } }),
    prisma.indisponibilidadeOperacional.findMany({
      select: { id: true, usuarioId: true, tipo: true, inicio: true, fim: true, motivo: true },
      orderBy: { inicio: 'desc' },
    }),
    prisma.capacidadeOperacional.findMany({ select: { usuarioId: true, limiteExecutaveis: true, observacao: true } }),
  ])

  const mapa = new Map<number, OrganizacaoDoUsuario>()
  for (const u of usuarios) {
    mapa.set(u.id, {
      usuarioId: u.id, nome: u.nome, equipes: [], aptidoes: [],
      indisponivelPor: null, indisponibilidades: [], limiteExecutaveis: null, observacaoCapacidade: null,
    })
  }
  for (const g of grupos) {
    for (const m of g.membros) {
      mapa.get(m.usuarioId)?.equipes.push({ id: g.id, code: g.code, nome: g.nome })
    }
  }
  for (const a of aptidoes) mapa.get(a.usuarioId)?.aptidoes.push(a.faseKey.toLowerCase())
  for (const i of indisponibilidades) {
    const o = mapa.get(i.usuarioId)
    if (!o) continue
    o.indisponibilidades.push(serializar(i))
    if (o.indisponivelPor == null && vigenteEm(i, agora)) o.indisponivelPor = serializar(i)
  }
  for (const c of capacidades) {
    const o = mapa.get(c.usuarioId)
    if (!o) continue
    o.limiteExecutaveis = c.limiteExecutaveis
    o.observacaoCapacidade = c.observacao
  }
  return mapa
}

/**
 * AS FASES QUE JÁ TÊM APTIDÃO DECLARADA.
 *
 * É isto que liga a regra: enquanto ninguém for declarado apto para uma fase,
 * ela não restringe. Sem esta noção, criar a tabela vazia tornaria TODA tarefa
 * inelegível de um dia para o outro — a pior forma de estrear uma regra.
 */
export async function fasesComAptidaoDeclarada(): Promise<Set<string>> {
  const linhas = await prisma.aptidaoOperacional.groupBy({ by: ['faseKey'] })
  return new Set(linhas.map((l) => l.faseKey.toLowerCase()))
}

// ─── ESCRITA (cadastro, não runtime) ────────────────────────────────────────

/** Declara as aptidões de uma pessoa — a lista inteira, para não deixar sobra. */
export async function definirAptidoes(usuarioId: number, faseKeys: string[]): Promise<{ ok: true } | { ok: false; erro: string }> {
  const normalizadas = [...new Set(faseKeys.map((f) => f.trim().toLowerCase()).filter(Boolean))]
  const invalidas = normalizadas.filter((f) => !faseValida(f))
  if (invalidas.length) return { ok: false, erro: `fase(s) fora do catálogo publicado: ${invalidas.join(', ')}` }

  await prisma.$transaction(async (tx) => {
    await tx.aptidaoOperacional.deleteMany({ where: { usuarioId, faseKey: { notIn: normalizadas } } })
    for (const faseKey of normalizadas) {
      await tx.aptidaoOperacional.upsert({
        where: { usuarioId_faseKey: { usuarioId, faseKey } },
        create: { usuarioId, faseKey },
        update: {},
      })
    }
  })
  return { ok: true }
}

/** Abre uma indisponibilidade. Encerrar é preencher `fim`, nunca apagar. */
export async function abrirIndisponibilidade(args: {
  usuarioId: number
  tipo: TipoIndisponibilidade
  inicio: Date
  fim?: Date | null
  motivo?: string | null
  autorId: number
}): Promise<{ ok: true; id: number } | { ok: false; erro: string }> {
  if (args.fim && args.fim <= args.inicio) return { ok: false, erro: 'o fim tem de ser depois do início' }
  const criada = await prisma.indisponibilidadeOperacional.create({
    data: {
      usuarioId: args.usuarioId, tipo: args.tipo, inicio: args.inicio,
      fim: args.fim ?? null, motivo: args.motivo?.slice(0, 300) ?? null, criadoPorId: args.autorId,
    },
    select: { id: true },
  })
  return { ok: true, id: criada.id }
}

/** Encerra AGORA — o registro fica, com a data em que deixou de valer. */
export async function encerrarIndisponibilidade(id: number, agora = new Date()): Promise<{ ok: true } | { ok: false; erro: string }> {
  const atual = await prisma.indisponibilidadeOperacional.findUnique({ where: { id }, select: { inicio: true, fim: true } })
  if (!atual) return { ok: false, erro: 'indisponibilidade não encontrada' }
  if (atual.fim != null && atual.fim <= agora) return { ok: false, erro: 'já estava encerrada' }
  await prisma.indisponibilidadeOperacional.update({
    where: { id },
    data: { fim: agora > atual.inicio ? agora : atual.inicio },
  })
  return { ok: true }
}

/** Define (ou remove, com `null`) o teto de trabalho executável. */
export async function definirCapacidade(args: {
  usuarioId: number
  limiteExecutaveis: number | null
  observacao?: string | null
  autorId: number
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const n = args.limiteExecutaveis
  if (n != null && (!Number.isInteger(n) || n < 0)) return { ok: false, erro: 'o limite tem de ser um inteiro não negativo' }
  await prisma.capacidadeOperacional.upsert({
    where: { usuarioId: args.usuarioId },
    create: {
      usuarioId: args.usuarioId, limiteExecutaveis: n,
      observacao: args.observacao?.slice(0, 300) ?? null, atualizadoPorId: args.autorId,
    },
    update: {
      limiteExecutaveis: n,
      observacao: args.observacao?.slice(0, 300) ?? null, atualizadoPorId: args.autorId,
    },
  })
  return { ok: true }
}
