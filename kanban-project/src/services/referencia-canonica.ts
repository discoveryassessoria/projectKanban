// src/services/referencia-canonica.ts
//
// A ÚNICA PORTA entre o motor declarativo e os cadastros que ele referencia.
//
// O campo declara o alvo; este serviço lista, resolve e projeta. É o único lugar do
// sistema que sabe que `ORGANIZACAO` é `OrgaoProtocolo` — nem o passo, nem a tela,
// nem o executor sabem, e é por isso que nenhum deles precisa mudar quando um alvo
// novo aparece.
//
// ─── QUATRO REGRAS QUE PARECEM DETALHE E NÃO SÃO ────────────────────────────
//
// · O NOME NUNCA É COPIADO. A execução guarda o ID; o nome é lido daqui a cada
//   leitura. Renomear a organização muda o que a tela mostra sem regravar linha
//   nenhuma de execução.
//
// · INATIVA SAI DA ESCOLHA, NÃO DO HISTÓRICO. Quem foi desativado não aparece para
//   quem vai escolher agora, e continua nomeado — marcado como inativo — em toda
//   execução que o escolheu antes. Sumir seria apagar o que aconteceu.
//
// · A AUTORIDADE É DAQUI. O formulário manda um número; quem decide se aquele número
//   existe, é do alvo certo e está em circulação é o servidor.
//
// · PERMISSÃO É POR ALVO. Referenciar uma organização exige a permissão que o alvo
//   declara — não a permissão de executar a ação, que é outra pergunta.

import { prisma } from "@/src/lib/prisma"
import { alvoDeReferencia, type ChaveDeAlvo } from "@/src/lib/motor/fontes-de-campo"

export interface EntidadeReferenciada {
  id: number
  label: string
  descricao: string | null
  ativo: boolean
}

/** Por que uma referência foi recusada. Vocabulário fechado. */
export type MotivoDeRecusa =
  | "ALVO_DESCONHECIDO"
  | "VALOR_NAO_E_ID"
  | "NAO_ENCONTRADO"
  | "INATIVO"
  | "SEM_PERMISSAO"

export interface ReferenciaAceita { ok: true; entidade: EntidadeReferenciada }
export interface ReferenciaRecusada { ok: false; motivo: MotivoDeRecusa; mensagem: string }

// ─── RESOLVEDORES POR ALVO ──────────────────────────────────────────────────
//
// Um alvo novo acrescenta uma entrada aqui e uma na declaração. Nada mais no sistema
// precisa saber que ele passou a existir.

const RESOLVEDORES: Record<ChaveDeAlvo, {
  listarAtivas: () => Promise<EntidadeReferenciada[]>
  buscarPorIds: (ids: number[]) => Promise<EntidadeReferenciada[]>
}> = {
  ORGANIZACAO: {
    listarAtivas: async () =>
      (await prisma.orgaoProtocolo.findMany({
        where: { ativo: true }, orderBy: [{ name: "asc" }], select: SELECT_ORG,
      })).map(projetarOrganizacao),
    buscarPorIds: async (ids) =>
      (await prisma.orgaoProtocolo.findMany({ where: { id: { in: ids } }, select: SELECT_ORG }))
        .map(projetarOrganizacao),
  },
  // O SEGUNDO ALVO. Acrescentá-lo custou esta entrada e a declaração — nem a
  // validação, nem a leitura da etapa, nem o painel do operador, nem o configurador
  // souberam que ele passou a existir. Era esse o teste da capacidade ser genérica.
  PROFISSIONAL: {
    listarAtivas: async () =>
      (await prisma.profissional.findMany({
        where: { ativo: true }, orderBy: [{ nome: "asc" }], select: SELECT_PROF,
      })).map(projetarProfissional),
    buscarPorIds: async (ids) =>
      (await prisma.profissional.findMany({ where: { id: { in: ids } }, select: SELECT_PROF }))
        .map(projetarProfissional),
  },
}

const SELECT_PROF = {
  id: true, nome: true, ativo: true,
  categoria: { select: { nome: true } },
  organizacao: { select: { nomeFantasia: true, name: true } },
  registros: {
    where: { ativo: true }, orderBy: { id: "asc" as const },
    select: { tipo: true, numero: true, jurisdicao: true },
  },
} as const

function projetarProfissional(p: {
  id: number; nome: string; ativo: boolean; categoria: { nome: string }
  organizacao: { nomeFantasia: string | null; name: string } | null
  registros: Array<{ tipo: string; numero: string; jurisdicao: string | null }>
}): EntidadeReferenciada {
  // "OAB 123456/SP" é PROJEÇÃO: montada na leitura a partir do registro, nunca gravada
  // como texto. Corrigir o número no cadastro muda o que a tela mostra, e só.
  const registro = p.registros[0]
    ? `${p.registros[0].tipo} ${p.registros[0].numero}${p.registros[0].jurisdicao ? `/${p.registros[0].jurisdicao}` : ""}`
    : null
  const onde = p.organizacao?.nomeFantasia?.trim() || p.organizacao?.name || null
  return {
    id: p.id,
    label: registro ? `${p.nome} — ${registro}` : p.nome,
    descricao: [p.categoria.nome, onde].filter(Boolean).join(" · ") || null,
    ativo: p.ativo,
  }
}

const SELECT_ORG = {
  id: true, name: true, nomeFantasia: true, type: true,
  city: true, country: true, ativo: true,
} as const

function projetarOrganizacao(o: {
  id: number; name: string; nomeFantasia: string | null
  type: string | null; city: string | null; country: string | null; ativo: boolean
}): EntidadeReferenciada {
  const onde = [o.city, o.country].filter(Boolean).join(" · ")
  return {
    id: o.id,
    // O nomeFantasia é como a organização é chamada no dia a dia; o `name` é o
    // registral. Mostrar o primeiro e cair no segundo é a projeção — não um dado novo.
    label: o.nomeFantasia?.trim() || o.name,
    descricao: [o.type, onde].filter(Boolean).join(" — ") || null,
    ativo: o.ativo,
  }
}

/** As entidades que quem vai escolher AGORA pode escolher: só as ativas. */
export async function listarAlvo(alvo: string): Promise<EntidadeReferenciada[]> {
  const r = RESOLVEDORES[alvo as ChaveDeAlvo]
  return r ? r.listarAtivas() : []
}

/**
 * Resolve IDs em entidades — INCLUSIVE as inativas.
 *
 * É por isto que a leitura de uma execução antiga continua sabendo o nome de quem foi
 * escolhido: quem resolve o que já está gravado não filtra por `ativo`.
 */
export async function resolverReferencias(
  alvo: string, ids: number[],
): Promise<Map<number, EntidadeReferenciada>> {
  const r = RESOLVEDORES[alvo as ChaveDeAlvo]
  const unicos = [...new Set(ids.filter((i) => Number.isSafeInteger(i) && i > 0))]
  if (!r || unicos.length === 0) return new Map()
  return new Map((await r.buscarPorIds(unicos)).map((e) => [e.id, e]))
}

export async function resolverReferencia(alvo: string, id: number): Promise<EntidadeReferenciada | null> {
  return (await resolverReferencias(alvo, [id])).get(id) ?? null
}

/**
 * A validação que o servidor faz antes de gravar. O formulário não é autoridade sobre
 * nenhuma destas perguntas.
 */
export async function validarReferencia(args: {
  alvo: string
  valor: unknown
  rotuloDoCampo: string
  permissoes: string[]
  /** Execução em andamento pode manter o que já tinha, mesmo inativo. */
  jaEscolhidoAntes?: boolean
}): Promise<ReferenciaAceita | ReferenciaRecusada> {
  const decl = alvoDeReferencia(args.alvo)
  if (!decl) {
    return { ok: false, motivo: "ALVO_DESCONHECIDO",
      mensagem: `O campo "${args.rotuloDoCampo}" aponta para "${args.alvo}", que não é um cadastro conhecido.` }
  }
  if (!args.permissoes.includes(decl.permissao)) {
    return { ok: false, motivo: "SEM_PERMISSAO",
      mensagem: `Você não tem permissão para escolher em ${decl.label}.` }
  }
  const { idReferenciado } = await import("@/src/lib/motor/fontes-de-campo")
  const id = idReferenciado(args.valor)
  if (id == null) {
    return { ok: false, motivo: "VALOR_NAO_E_ID",
      mensagem: `"${args.rotuloDoCampo}" precisa apontar para um registro de ${decl.label} — o que veio não é um identificador.` }
  }
  const e = await resolverReferencia(args.alvo, id)
  if (!e) {
    return { ok: false, motivo: "NAO_ENCONTRADO",
      mensagem: `O registro escolhido em "${args.rotuloDoCampo}" não existe mais em ${decl.label}.` }
  }
  // INATIVA: recusada para escolha nova, aceita para quem já a tinha. É a diferença
  // entre "não use mais isto" e "apague o que você fez".
  if (!e.ativo && !decl.aceitaInativaEmNovaExecucao && !args.jaEscolhidoAntes) {
    return { ok: false, motivo: "INATIVO",
      mensagem: `"${e.label}" está inativo em ${decl.label} e não pode ser escolhido agora.` }
  }
  return { ok: true, entidade: e }
}
