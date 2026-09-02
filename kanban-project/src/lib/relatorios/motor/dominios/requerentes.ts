// DOMÍNIO REQUERENTES — 1 linha = 1 requerente.
//
// A pessoa que requer a cidadania, do ponto de vista CADASTRAL e da situação
// dela dentro do procedimento. Um requerente pode estar em mais de um processo;
// a linha continua sendo a pessoa, e os processos entram achatados — senão
// alguém aparece duas vezes e a contagem de pessoas deixa de ser contagem de
// pessoas.
//
// Idade e faixa etária são DERIVADAS na leitura. Idade gravada é a única que
// erra sozinha, todo ano, no aniversário.

import { prisma } from "@/lib/prisma"
import { VINCULO_PROCESSO_ATIVO } from "@/src/lib/genealogia/vinculo-ativo"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, idade, igualId, periodo, porCampo } from "./_comuns"

const INCLUDE = {
  pessoa: { select: { id: true, publicCode: true, nome: true, arvoreId: true } },
  processos: {
    where: VINCULO_PROCESSO_ATIVO,
    select: {
      processo: {
        select: {
          id: true, codigo: true, nome: true, faseAtualKey: true, dataConclusao: true,
          paisCanonico: { select: { countryKey: true, countryLabel: true } },
          familia: { select: { id: true, nome: true } },
        },
      },
    },
  },
  _count: { select: { protocolosCobertos: true } },
} as const

/** O primeiro processo ativo é o que a tela mostra; os demais entram na célula. */
const principal = (l: any) => l.processos?.[0]?.processo ?? null

export const DOMINIO_REQUERENTES: DominioDef = {
  key: "requerentes",
  rotulo: "Requerentes",
  descricao: "Cada pessoa que requer a cidadania: dados cadastrais, família, processo, idade e situação.",
  grain: "1 linha = 1 requerente",
  permissao: "processos.ver",
  ordem: 2,
  aceitaNacionalidade: true,
  // Pela NACIONALIDADE DO PROCESSO em que a pessoa está — o requerente não tem
  // nacionalidade ofertada própria; ele participa de um processo que tem.
  ondeNacionalidade: (countryKey) => ({
    processos: { some: { ...VINCULO_PROCESSO_ATIVO, processo: { paisCanonico: { countryKey } } } },
  }),

  filtros: [
    { key: "nome", rotulo: "Nome", tipo: "texto", paraWhere: contem("nome") },
    { key: "documento", rotulo: "CPF, RG ou passaporte", tipo: "texto",
      paraWhere: (v) => (v.tipo === "texto" && v.texto.trim()
        ? { OR: [
            { cpf: { contains: v.texto.trim(), mode: "insensitive" } },
            { rg: { contains: v.texto.trim(), mode: "insensitive" } },
            { passaporte: { contains: v.texto.trim(), mode: "insensitive" } },
            { publicCode: { contains: v.texto.trim(), mode: "insensitive" } },
          ] }
        : null) },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: (v) => (v.tipo === "entidade" ? { processos: { some: { ...VINCULO_PROCESSO_ATIVO, processo: { familiaId: v.id } } } } : null) },
    { key: "processo", rotulo: "Processo", tipo: "entidade", opcoes: cadastro("processos"),
      paraWhere: (v) => (v.tipo === "entidade" ? { processos: { some: { ...VINCULO_PROCESSO_ATIVO, processoId: v.id } } } : null) },
    { key: "nascimento", rotulo: "Período de nascimento", tipo: "intervalo_data",
      paraWhere: (v) => periodo("dataNascimento", v) },
    { key: "menor", rotulo: "Menor de idade",
      descricao: "Derivado da data de nascimento na leitura.", tipo: "booleano",
      paraWhere: (v) => {
        if (v.tipo !== "booleano") return null
        const corte = new Date()
        corte.setFullYear(corte.getFullYear() - 18)
        return v.valor ? { dataNascimento: { gt: corte } } : { dataNascimento: { lte: corte } }
      } },
    { key: "estado", rotulo: "Estado (UF)", tipo: "texto", paraWhere: contem("estado") },
    { key: "cidade", rotulo: "Cidade", tipo: "texto", paraWhere: contem("cidade") },
    { key: "sem_email", rotulo: "Sem e-mail", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { OR: [{ email: null }, { email: "" }] } : { email: { not: null } }) },
    { key: "sem_cpf", rotulo: "Sem CPF", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { OR: [{ cpf: null }, { cpf: "" }] } : { cpf: { not: null } }) },
    { key: "sem_nascimento", rotulo: "Sem data de nascimento", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { dataNascimento: null } : { dataNascimento: { not: null } }) },
    { key: "sem_processo", rotulo: "Sem processo vinculado",
      descricao: "Cadastrado, mas ainda fora de qualquer processo.", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { processos: { none: { ...VINCULO_PROCESSO_ATIVO } } } : { processos: { some: { ...VINCULO_PROCESSO_ATIVO } } }) },
    { key: "na_arvore", rotulo: "Vinculado à árvore genealógica", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { personId: { not: null } } : { personId: null }) },
  ],

  agrupamentos: [
    porCampo("familia", "Família", (l) => principal(l)?.familia?.nome),
    porCampo("nacionalidade", "Nacionalidade do processo", (l) => principal(l)?.paisCanonico?.countryLabel),
    porCampo("fase", "Fase do processo", (l) => principal(l)?.faseAtualKey),
    porCampo("estado", "Estado (UF)", (l) => l.estado),
    porCampo("cidade", "Cidade", (l) => l.cidade),
    porCampo("faixa", "Faixa etária", (l) => {
      const i = idade(l.dataNascimento)
      if (i == null) return null
      return i < 18 ? "Menor de 18" : i < 30 ? "18–29" : i < 45 ? "30–44" : i < 60 ? "45–59" : "60 ou mais"
    }),
    porCampo("vinculo", "Vínculo com processo", (l) => (l.processos?.length ? "Com processo" : "Sem processo")),
  ],

  colunas: [
    { key: "codigo", rotulo: "Código", valor: (l) => l.publicCode ?? `#${l.id}` },
    { key: "nome", rotulo: "Nome", valor: (l) => l.nome },
    { key: "cpf", rotulo: "CPF", valor: (l) => l.cpf ?? null },
    { key: "rg", rotulo: "RG", valor: (l) => l.rg ?? null },
    { key: "passaporte", rotulo: "Passaporte", valor: (l) => l.passaporte ?? null },
    { key: "nascimento", rotulo: "Nascimento", valor: (l) => dataBR(l.dataNascimento) },
    { key: "idade", rotulo: "Idade", valor: (l) => idade(l.dataNascimento), alinhamento: "direita" },
    { key: "sexo", rotulo: "Sexo", valor: (l) => l.sexo ?? null },
    { key: "estado_civil", rotulo: "Estado civil", valor: (l) => l.estadoCivil ?? null },
    { key: "email", rotulo: "E-mail", valor: (l) => l.email ?? null },
    { key: "telefone", rotulo: "Telefone", valor: (l) => l.telefone ?? null },
    { key: "cidade", rotulo: "Cidade", valor: (l) => l.cidade ?? null },
    { key: "estado", rotulo: "Estado", valor: (l) => l.estado ?? null },
    { key: "residencia", rotulo: "Residência",
      valor: (l) => [l.endereco, l.numero, l.bairro, l.cidade, l.estado].filter(Boolean).join(", ") || null },
    { key: "familia", rotulo: "Família", valor: (l) => principal(l)?.familia?.nome ?? null,
      link: (l) => (principal(l)?.familia ? `/genealogy?familiaId=${principal(l).familia.id}` : null) },
    { key: "processo", rotulo: "Processo",
      valor: (l) => { const p = principal(l); return p ? `${p.codigo ?? p.id} — ${p.nome}` : null },
      link: (l) => (principal(l) ? `/processos/${principal(l).id}` : null) },
    { key: "processos_todos", rotulo: "Todos os processos",
      valor: (l) => l.processos?.map((x: any) => x.processo.codigo ?? x.processo.id).join(" · ") || null },
    { key: "nacionalidade", rotulo: "Nacionalidade do processo", valor: (l) => principal(l)?.paisCanonico?.countryLabel ?? null },
    { key: "fase", rotulo: "Fase do processo", valor: (l) => principal(l)?.faseAtualKey ?? null },
    { key: "situacao_processo", rotulo: "Situação do processo",
      valor: (l) => { const p = principal(l); return p ? (p.dataConclusao ? "Concluído" : "Em andamento") : null } },
    { key: "protocolos", rotulo: "Protocolos", valor: (l) => l._count?.protocolosCobertos ?? 0, alinhamento: "direita", somavel: true },
    { key: "arvore", rotulo: "Na árvore", valor: (l) => (l.personId ? "sim" : "não") },
  ],

  ordenacoes: [
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ nome: d }] },
    { key: "nascimento", rotulo: "Nascimento", orderBy: (d) => [{ dataNascimento: d }, { id: d }] },
    { key: "cadastro", rotulo: "Cadastro", orderBy: (d) => [{ createdAt: d }, { id: d }] },
  ],

  filtrosPrincipais: ["nome", "familia", "nascimento"],
  colunasIniciais: ["codigo", "nome", "cpf", "nascimento", "idade", "familia", "processo", "nacionalidade", "fase"],
  ordenacaoPadrao: { key: "nome", direcao: "asc" },

  contar: (where) => prisma.requerente.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.requerente.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "sem-processo", nome: "Cadastrados sem processo",
      spec: { filtros: [{ key: "sem_processo", valor: { tipo: "booleano", valor: true } }] } },
    { key: "menores", nome: "Menores de idade",
      spec: { filtros: [{ key: "menor", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-nascimento", nome: "Sem data de nascimento",
      spec: { filtros: [{ key: "sem_nascimento", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-cpf", nome: "Sem CPF",
      spec: { filtros: [{ key: "sem_cpf", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-familia", nome: "Por família", spec: { filtros: [], agruparPor: "familia" } },
    { key: "por-faixa", nome: "Por faixa etária", spec: { filtros: [], agruparPor: "faixa" } },
  ],
}
