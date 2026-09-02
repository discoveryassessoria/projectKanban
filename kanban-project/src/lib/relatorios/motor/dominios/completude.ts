// DOMÍNIO COMPLETUDE — 1 linha = 1 requisito APLICÁVEL.
//
// A pergunta é uma só: o que DEVERIA existir contra o que EXISTE.
//
// ─── POR QUE ISTO NÃO DUPLICA CERTIDÕES E DOCUMENTOS ────────────────────────
// A linha aqui é o REQUISITO, e a leitura é o percentual. Certidões e Documentos
// mostram o item; Completude mostra o quanto falta e leva ao domínio dono pelo
// drill-down. É a mesma necessidade lida por outra pergunta — não uma segunda
// contagem, porque o motor lê a MESMA tabela.
//
// ─── O DENOMINADOR ──────────────────────────────────────────────────────────
// Percentual de completude usa como denominador só o que É APLICÁVEL. Requisito
// dispensado sai da conta — ele incidia e deixou de ser exigido; mantê-lo puxaria
// a completude para baixo por algo que já foi resolvido. Requisito que nunca
// incidiu não entra nem no numerador nem no denominador.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, dataBR, emLista, emListaId, igualId, porCampo } from "./_comuns"

/** Os quatro estados que a operação distingue. Vêm do motor de completude. */
const ESTADOS = [
  { valor: "PENDENTE", rotulo: "Pendente" },
  { valor: "EM_ATENDIMENTO", rotulo: "Em atendimento" },
  { valor: "ATENDIDA", rotulo: "Satisfeito" },
  { valor: "NAO_LOCALIZADA", rotulo: "Não localizada" },
  { valor: "DISPENSADA", rotulo: "Dispensado" },
]

const INCLUDE = {
  itemCatalogo: {
    select: { id: true, name: true, code: true,
      tiposDocumento: { select: { categoriaDocumental: { select: { code: true, name: true } } } } },
  },
  pessoa: { select: { id: true, nome: true, sobrenome: true, arvoreId: true } },
  processo: {
    select: {
      id: true, codigo: true, nome: true, faseAtualKey: true,
      paisCanonico: { select: { countryKey: true, countryLabel: true } },
      familia: { select: { id: true, nome: true } },
    },
  },
  documentos: { select: { id: true, status: true, arquivo_url: true }, take: 1 },
} as const

/** SATISFEITO só quando a necessidade foi ATENDIDA. O resto é o que falta. */
const satisfeito = (l: any) => l.status === "ATENDIDA"
/** DISPENSADO sai do denominador — incidia, deixou de ser exigido. */
const aplicavel = (l: any) => l.status !== "DISPENSADA"

/** O domínio que DONO daquela pendência, para o drill-down. */
const dono = (l: any) =>
  l.itemCatalogo?.tiposDocumento?.some((t: any) => t.categoriaDocumental?.code === "REGISTRO_CIVIL")
    ? "Certidões" : "Documentos"

export const DOMINIO_COMPLETUDE: DominioDef = {
  key: "completude",
  rotulo: "Completude",
  descricao: "O que deveria existir contra o que existe — por processo, família, pessoa e fase.",
  grain: "1 linha = 1 requisito aplicável (dispensado sai do denominador)",
  permissao: "processos.ver",
  ordem: 7,
  grupo: "Documentação",
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({ processo: { paisCanonico: { countryKey } } }),

  filtros: [
    { key: "estado", rotulo: "Estado do requisito", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: ESTADOS }, paraWhere: emLista("status") },
    { key: "pendente", rotulo: "Somente o que falta", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null
        : { status: { in: ["PENDENTE", "EM_ATENDIMENTO", "NAO_LOCALIZADA"] } }) },
    { key: "bloqueante", rotulo: "Somente obrigatórios", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" || !v.valor ? null : { obrigatoriedade: "OBRIGATORIA" }) },
    { key: "tipo_requisito", rotulo: "Tipo de requisito", tipo: "multi_selecao",
      opcoes: cadastro("itens_documentais"), paraWhere: emListaId("itemCatalogoId") },
    { key: "categoria", rotulo: "Categoria documental", tipo: "multi_selecao",
      opcoes: cadastro("categorias_documentais"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length
        ? { itemCatalogo: { tiposDocumento: { some: { categoriaDocumental: { code: { in: v.valores } } } } } } : null) },
    { key: "processo", rotulo: "Processo", tipo: "entidade", opcoes: cadastro("processos"), paraWhere: igualId("processoId") },
    { key: "familia", rotulo: "Família", tipo: "entidade", opcoes: cadastro("familias"),
      paraWhere: (v) => (v.tipo === "entidade" ? { processo: { familiaId: v.id } } : null) },
    { key: "fase", rotulo: "Fase do processo", tipo: "multi_selecao", opcoes: cadastro("fases"),
      paraWhere: (v) => (v.tipo === "multi_selecao" && v.valores.length ? { processo: { faseAtualKey: { in: v.valores } } } : null) },
    { key: "pessoa", rotulo: "Pessoa (nome contém)", tipo: "texto",
      paraWhere: (v) => (v.tipo === "texto" && v.texto.trim() ? { pessoa: { nome: { contains: v.texto.trim(), mode: "insensitive" } } } : null) },
    { key: "origem", rotulo: "Origem da exigência", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "MATRIZ", rotulo: "Regra documental" }, { valor: "ARVORE", rotulo: "Árvore" },
        { valor: "MANUAL", rotulo: "Manual" }, { valor: "MIGRACAO", rotulo: "Migração" } ] },
      paraWhere: emLista("origem") },
  ],

  agrupamentos: [
    porCampo("processo", "Processo", (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null)),
    porCampo("familia", "Família", (l) => l.processo?.familia?.nome),
    porCampo("pessoa", "Pessoa", (l) => (l.pessoa ? `${l.pessoa.nome} ${l.pessoa.sobrenome ?? ""}`.trim() : null)),
    porCampo("estado", "Estado", (l) => l.status),
    porCampo("fase", "Fase", (l) => l.processo?.faseAtualKey),
    porCampo("tipo", "Tipo de requisito", (l) => l.itemCatalogo?.name),
    porCampo("dono", "Domínio proprietário", dono),
    porCampo("nacionalidade", "Nacionalidade", (l) => l.processo?.paisCanonico?.countryLabel),
  ],

  colunas: [
    { key: "requisito", rotulo: "Requisito", valor: (l) => l.itemCatalogo?.name ?? null },
    { key: "estado", rotulo: "Estado",
      valor: (l) => ESTADOS.find((e) => e.valor === l.status)?.rotulo ?? l.status },
    { key: "satisfeito", rotulo: "Satisfeito", valor: (l) => (satisfeito(l) ? "sim" : "não") },
    { key: "aplicavel", rotulo: "Entra no cálculo", valor: (l) => (aplicavel(l) ? "sim" : "não — dispensado") },
    { key: "obrigatoriedade", rotulo: "Obrigatoriedade", valor: (l) => l.obrigatoriedade },
    { key: "dono", rotulo: "Onde resolver", valor: dono },
    { key: "pessoa", rotulo: "Pessoa", valor: (l) => (l.pessoa ? `${l.pessoa.nome} ${l.pessoa.sobrenome ?? ""}`.trim() : null),
      link: (l) => (l.pessoa?.arvoreId ? `/genealogy?arvoreId=${l.pessoa.arvoreId}&pessoaId=${l.pessoa.id}` : null) },
    { key: "familia", rotulo: "Família", valor: (l) => l.processo?.familia?.nome ?? null },
    { key: "processo", rotulo: "Processo",
      valor: (l) => (l.processo ? `${l.processo.codigo ?? l.processo.id} — ${l.processo.nome}` : null),
      link: (l) => (l.processo ? `/processos/${l.processo.id}` : null) },
    { key: "nacionalidade", rotulo: "Nacionalidade", valor: (l) => l.processo?.paisCanonico?.countryLabel ?? null },
    { key: "fase", rotulo: "Fase", valor: (l) => l.processo?.faseAtualKey ?? null },
    { key: "motivo", rotulo: "Por que incide", valor: (l) => l.motivoAplicabilidade ?? null },
    { key: "origem", rotulo: "Origem da exigência", valor: (l) => l.origem },
    { key: "regra", rotulo: "Regra (versão)",
      valor: (l) => (l.matrizRegraId ? `#${l.matrizRegraId} v${l.matrizRegraVersao ?? "?"}` : null) },
    { key: "avaliada", rotulo: "Avaliada em", valor: (l) => dataBR(l.avaliadaEm) },
    { key: "criada", rotulo: "Exigida desde", valor: (l) => dataBR(l.createdAt) },
  ],

  ordenacoes: [
    { key: "criacao", rotulo: "Data em que passou a ser exigido", orderBy: (d) => [{ createdAt: d }, { id: d }] },
    { key: "estado", rotulo: "Estado", orderBy: (d) => [{ status: d }, { id: "desc" as const }] },
  ],

  filtrosPrincipais: ["estado", "processo", "pendente"],
  colunasIniciais: ["requisito", "estado", "obrigatoriedade", "pessoa", "processo", "fase", "dono", "motivo"],
  ordenacaoPadrao: { key: "estado", direcao: "asc" },

  // Necessidade superseditada não é requisito vigente: ela foi substituída, e
  // contá-la faria a completude cair por um item que não existe mais.
  contar: (where) => prisma.necessidadeDocumental.count({ where: { AND: [where, { supersedePorId: null }] } }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.necessidadeDocumental.findMany({
      where: { AND: [where, { supersedePorId: null }] }, orderBy, skip: pular, take: levar, include: INCLUDE,
    }),

  visoesDoSistema: [
    { key: "o-que-falta", nome: "O que falta",
      spec: { filtros: [{ key: "pendente", valor: { tipo: "booleano", valor: true } }] } },
    { key: "bloqueadores", nome: "Bloqueadores (obrigatórios pendentes)",
      spec: { filtros: [
        { key: "pendente", valor: { tipo: "booleano", valor: true } },
        { key: "bloqueante", valor: { tipo: "booleano", valor: true } },
      ] } },
    { key: "dispensados", nome: "Dispensados",
      spec: { filtros: [{ key: "estado", valor: { tipo: "multi_selecao", valores: ["DISPENSADA"] } }] } },
    { key: "por-processo", nome: "Por processo", spec: { filtros: [], agruparPor: "processo" } },
    { key: "por-pessoa", nome: "Por pessoa", spec: { filtros: [], agruparPor: "pessoa" } },
  ],
}
