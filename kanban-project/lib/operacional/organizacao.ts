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
// ─── A APTIDÃO É POR UNIDADE DE TRABALHO, NÃO POR FASE ──────────────────────
// Esta camada já nasceu uma vez com a dimensão errada: aptidão apontava para a
// FASE MACRO, e o primeiro cadastro real produziu "apto para Finalizado".
//
// Fase diz ONDE O PROCESSO ESTÁ. Aptidão diz QUE TRABALHO A PESSOA SABE FAZER.
// A dimensão correta é o PERFIL OPERACIONAL (`PerfilOperacionalDocumento`), que
// o Cadastro Mestre já define como "qual workflow processa este documento" —
// "Emissão de Certidão" atende nascimento, casamento e óbito, porque o processo
// operacional é o mesmo e o que muda é a instância.
//
// Não foi criado catálogo de competências: seria uma segunda fonte mestre para
// o que o perfil já é.
// ============================================================================
import { prisma } from '@/lib/prisma'
import type { TipoIndisponibilidade } from '@prisma/client'

/** Uma unidade de trabalho executável — o que se cadastra como aptidão. */
export interface UnidadeOperacional {
  perfilOperacionalId: number
  code: string
  nome: string
  /** Contexto secundário para quem lê a tela: "Certidão de Registro Civil". */
  familia: string | null
}

/**
 * AS UNIDADES DE TRABALHO — vêm do Cadastro Mestre, não de lista no código.
 *
 * Só perfis ATIVOS: um perfil desativado não deve virar competência nova.
 */
export async function unidadesOperacionais(): Promise<UnidadeOperacional[]> {
  const perfis = await prisma.perfilOperacionalDocumento.findMany({
    where: { ativo: true },
    select: { id: true, code: true, name: true, familiaDocumental: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })
  return perfis.map((p) => ({
    perfilOperacionalId: p.id, code: p.code, nome: p.name,
    familia: p.familiaDocumental?.name ?? null,
  }))
}

/** A unidade existe e está ativa? A escrita recusa o que o cadastro não tem. */
export async function unidadeValida(perfilOperacionalId: number): Promise<boolean> {
  if (!Number.isInteger(perfilOperacionalId) || perfilOperacionalId <= 0) return false
  return (await prisma.perfilOperacionalDocumento.count({
    where: { id: perfilOperacionalId, ativo: true },
  })) > 0
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
  /** Unidades de trabalho que esta pessoa executa (ids de perfil operacional). */
  aptidoes: number[]
  /** As mesmas, com nome e família — para a tela e para a explicação. */
  aptidoesDetalhadas: UnidadeOperacional[]
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
    prisma.aptidaoOperacional.findMany({
      select: {
        usuarioId: true, perfilOperacionalId: true,
        perfilOperacional: { select: { id: true, code: true, name: true, familiaDocumental: { select: { name: true } } } },
      },
    }),
    prisma.indisponibilidadeOperacional.findMany({
      select: { id: true, usuarioId: true, tipo: true, inicio: true, fim: true, motivo: true },
      orderBy: { inicio: 'desc' },
    }),
    prisma.capacidadeOperacional.findMany({ select: { usuarioId: true, limiteExecutaveis: true, observacao: true } }),
  ])

  const mapa = new Map<number, OrganizacaoDoUsuario>()
  for (const u of usuarios) {
    mapa.set(u.id, {
      usuarioId: u.id, nome: u.nome, equipes: [], aptidoes: [], aptidoesDetalhadas: [],
      indisponivelPor: null, indisponibilidades: [], limiteExecutaveis: null, observacaoCapacidade: null,
    })
  }
  for (const g of grupos) {
    for (const m of g.membros) {
      mapa.get(m.usuarioId)?.equipes.push({ id: g.id, code: g.code, nome: g.nome })
    }
  }
  for (const a of aptidoes) {
    const o = mapa.get(a.usuarioId)
    if (!o) continue
    o.aptidoes.push(a.perfilOperacionalId)
    o.aptidoesDetalhadas.push({
      perfilOperacionalId: a.perfilOperacional.id,
      code: a.perfilOperacional.code,
      nome: a.perfilOperacional.name,
      familia: a.perfilOperacional.familiaDocumental?.name ?? null,
    })
  }
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
 * AS UNIDADES QUE JÁ TÊM APTIDÃO DECLARADA.
 *
 * É isto que liga a regra, e a política é POR UNIDADE, não global: enquanto
 * ninguém for declarado apto para uma unidade, ela não restringe. Assim que
 * alguém for, só quem foi declarado passa naquela unidade — e as demais
 * unidades seguem livres, cada uma no seu tempo de implantação.
 *
 * Sem esta noção, criar a tabela vazia tornaria TODA tarefa inelegível de um dia
 * para o outro — a pior forma possível de estrear uma regra.
 */
export async function unidadesComAptidaoDeclarada(): Promise<Set<number>> {
  const linhas = await prisma.aptidaoOperacional.groupBy({ by: ['perfilOperacionalId'] })
  return new Set(linhas.map((l) => l.perfilOperacionalId))
}

// ─── ESCRITA (cadastro, não runtime) ────────────────────────────────────────

/** Declara as aptidões de uma pessoa — a lista inteira, para não deixar sobra. */
export async function definirAptidoes(
  usuarioId: number,
  perfilIds: number[],
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const ids = [...new Set(perfilIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  // Recusa o que o cadastro não tem ATIVO. Aceitar um id qualquer deixaria a
  // aptidão apontando para unidade inexistente — e o critério passaria a
  // reprovar todo mundo sem que ninguém entendesse por quê.
  const validos = await prisma.perfilOperacionalDocumento.findMany({
    where: { id: { in: ids }, ativo: true }, select: { id: true },
  })
  const conhecidos = new Set(validos.map((v) => v.id))
  const invalidos = ids.filter((i) => !conhecidos.has(i))
  if (invalidos.length) {
    return { ok: false, erro: `unidade(s) operacional(is) inexistente(s) ou inativa(s): ${invalidos.join(', ')}` }
  }

  await prisma.$transaction(async (tx) => {
    await tx.aptidaoOperacional.deleteMany({ where: { usuarioId, perfilOperacionalId: { notIn: ids } } })
    for (const perfilOperacionalId of ids) {
      await tx.aptidaoOperacional.upsert({
        where: { usuarioId_perfilOperacionalId: { usuarioId, perfilOperacionalId } },
        create: { usuarioId, perfilOperacionalId },
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

// ─── A COMPETÊNCIA QUE A TAREFA EXIGE ───────────────────────────────────────

/**
 * A UNIDADE OPERACIONAL DE UMA TAREFA — derivada, nunca duplicada.
 *
 * A Tarefa NÃO ganhou uma coluna `competenciaId`. Ela já sabe de onde veio, e a
 * cadeia até o perfil é canônica e determinística:
 *
 *   Tarefa → necessidade → ItemCatalogo → TipoDocumentoCadastro → perfil
 *   Tarefa → documento   → TipoDocumentoCadastro → perfil
 *
 * `TipoDocumentoCadastro.itemCatalogoId` é ÚNICO, então o primeiro caminho não
 * tem empate. A necessidade vem primeiro porque é a CAUSA da tarefa; o documento
 * é o segundo caminho, para o trabalho que nasceu de um documento já existente.
 *
 * Guardar o perfil na Tarefa criaria uma segunda verdade que envelheceria no dia
 * em que o cadastro reclassificasse o tipo — e ninguém iria atrás das tarefas
 * antigas para corrigir.
 *
 * Tarefa sem necessidade e sem documento (trabalho avulso) não tem unidade: é
 * `null`, e o critério de aptidão simplesmente não se aplica a ela.
 */
export async function unidadesDasTarefas(tarefaIds: number[]): Promise<Map<number, number | null>> {
  const fora = new Map<number, number | null>()
  if (tarefaIds.length === 0) return fora

  const tarefas = await prisma.tarefa.findMany({
    where: { id: { in: tarefaIds } },
    select: {
      id: true,
      necessidade: { select: { itemCatalogoId: true } },
      documentoId: true,
    },
  })
  for (const t of tarefas) fora.set(t.id, null)

  // Um lote por caminho — nunca uma consulta por tarefa.
  const itemIds = [...new Set(tarefas.map((t) => t.necessidade?.itemCatalogoId).filter((i): i is number => i != null))]
  const docIds = [...new Set(tarefas.map((t) => t.documentoId).filter((i): i is number => i != null))]

  const [porItem, docs] = await Promise.all([
    itemIds.length
      ? prisma.tipoDocumentoCadastro.findMany({
          where: { itemCatalogoId: { in: itemIds }, perfilOperacionalId: { not: null } },
          select: { itemCatalogoId: true, perfilOperacionalId: true },
        })
      : Promise.resolve([]),
    docIds.length
      ? prisma.documento.findMany({
          where: { id: { in: docIds } },
          select: { id: true, documentType: { select: { perfilOperacionalId: true } } },
        })
      : Promise.resolve([]),
  ])
  const perfilDoItem = new Map(porItem.map((t) => [t.itemCatalogoId as number, t.perfilOperacionalId as number]))
  const perfilDoDoc = new Map(docs.map((d) => [d.id, d.documentType?.perfilOperacionalId ?? null]))

  for (const t of tarefas) {
    const porNecessidade = t.necessidade?.itemCatalogoId != null ? perfilDoItem.get(t.necessidade.itemCatalogoId) ?? null : null
    const porDocumento = t.documentoId != null ? perfilDoDoc.get(t.documentoId) ?? null : null
    fora.set(t.id, porNecessidade ?? porDocumento)
  }
  return fora
}

/** Nome e família de cada unidade, para a explicação e a tela. */
export async function rotulosDasUnidades(): Promise<Map<number, UnidadeOperacional>> {
  return new Map((await unidadesOperacionais()).map((u) => [u.perfilOperacionalId, u]))
}
