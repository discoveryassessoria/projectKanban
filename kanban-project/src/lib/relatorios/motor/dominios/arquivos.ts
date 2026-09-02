// DOMÍNIO ARQUIVOS E EVIDÊNCIAS — 1 linha = 1 arquivo armazenado.
//
// O que EXISTE de fato no armazenamento, e a que ele está preso: documento,
// solicitação, protocolo, passo. Serve para achar o comprovante quando alguém
// pergunta "cadê o anexo daquele protocolo".
//
// ESTE DOMÍNIO NÃO DECIDE COMPLETUDE. Ter arquivo não significa requisito
// satisfeito — quem diz isso é Completude, lendo a necessidade. Aqui só se
// afirma que o byte está guardado.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { cadastro, contem, dataBR, emLista, emListaId, igualId, periodo, porCampo } from "./_comuns"

const INCLUDE = {
  documento: {
    select: {
      id: true, status: true,
      pessoa: { select: { id: true, nome: true, sobrenome: true, arvoreId: true } },
      documentType: { select: { name: true } },
    },
  },
  documentType: { select: { id: true, name: true } },
  solicitacao: { select: { id: true, status: true, orgao: { select: { name: true } } } },
  protocolo: { select: { id: true, numeroProtocolo: true, processoId: true } },
  criadoPor: { select: { id: true, nome: true } },
} as const

export const DOMINIO_ARQUIVOS: DominioDef = {
  key: "arquivos",
  rotulo: "Arquivos e Evidências",
  descricao: "Os arquivos efetivamente guardados e a que estão vinculados — sem julgar completude.",
  grain: "1 linha = 1 arquivo",
  permissao: "processos.ver",
  ordem: 16,
  grupo: "Integridade",
  aceitaNacionalidade: true,
  ondeNacionalidade: (countryKey) => ({
    documento: { pessoa: { arvore: { processos: { some: { paisCanonico: { countryKey } } } } } },
  }),

  filtros: [
    { key: "nome", rotulo: "Nome do arquivo", tipo: "texto", paraWhere: contem("nome") },
    { key: "tipo_arquivo", rotulo: "Tipo de arquivo",
      descricao: "Original, tradução, apostila, comprovante…", tipo: "texto", paraWhere: contem("tipo") },
    { key: "tipo_documental", rotulo: "Tipo documental", tipo: "multi_selecao", opcoes: cadastro("itens_documentais"),
      paraWhere: emListaId("documentTypeId") },
    { key: "vigente", rotulo: "Versão vigente",
      descricao: "Arquivo substituído deixa de ser vigente, mas continua guardado.",
      tipo: "booleano", paraWhere: (v) => (v.tipo === "booleano" ? { vigente: v.valor } : null) },
    { key: "de_protocolo", rotulo: "Ligado a um protocolo", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { protocoloId: { not: null } } : { protocoloId: null }) },
    { key: "de_solicitacao", rotulo: "Ligado a uma solicitação", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { solicitacaoId: { not: null } } : { solicitacaoId: null }) },
    { key: "periodo", rotulo: "Período de envio", tipo: "intervalo_data", paraWhere: (v) => periodo("createdAt", v) },
    { key: "enviado_por", rotulo: "Enviado por", tipo: "entidade", opcoes: cadastro("usuarios"), paraWhere: igualId("criadoPorId") },
    { key: "sem_classificacao", rotulo: "Sem tipo documental classificado",
      descricao: "Arquivo guardado sem dizer o que é.", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null : v.valor ? { documentTypeId: null } : { documentTypeId: { not: null } }) },
  ],

  agrupamentos: [
    porCampo("tipo", "Tipo de arquivo", (l) => l.tipo),
    porCampo("tipo_documental", "Tipo documental", (l) => l.documentType?.name ?? l.documento?.documentType?.name),
    porCampo("vigencia", "Vigência", (l) => (l.vigente ? "Vigente" : "Substituído")),
    porCampo("vinculo", "Vínculo", (l) =>
      l.protocoloId ? "Protocolo" : l.solicitacaoId ? "Solicitação" : l.stepInstanceId ? "Passo" : "Documento"),
    porCampo("enviado_por", "Enviado por", (l) => l.criadoPor?.nome),
  ],

  colunas: [
    { key: "nome", rotulo: "Arquivo", valor: (l) => l.nome, link: (l) => l.url ?? null },
    { key: "tipo", rotulo: "Tipo", valor: (l) => l.tipo },
    { key: "tipo_documental", rotulo: "Tipo documental",
      valor: (l) => l.documentType?.name ?? l.documento?.documentType?.name ?? null },
    { key: "pessoa", rotulo: "Pessoa",
      valor: (l) => (l.documento?.pessoa ? `${l.documento.pessoa.nome} ${l.documento.pessoa.sobrenome ?? ""}`.trim() : null) },
    { key: "vinculo", rotulo: "Vinculado a",
      valor: (l) => l.protocolo ? `Protocolo ${l.protocolo.numeroProtocolo ?? `#${l.protocolo.id}`}`
        : l.solicitacao ? `Solicitação #${l.solicitacao.id}`
        : l.stepInstanceId ? `Passo #${l.stepInstanceId}` : `Documento #${l.documentoId}`,
      link: (l) => (l.protocolo?.processoId ? `/processos/${l.protocolo.processoId}` : null) },
    { key: "orgao", rotulo: "Órgão da solicitação", valor: (l) => l.solicitacao?.orgao?.name ?? null },
    { key: "vigente", rotulo: "Vigente", valor: (l) => (l.vigente ? "sim" : "não") },
    { key: "substituido", rotulo: "Substituído em", valor: (l) => dataBR(l.substituidoEm) },
    { key: "motivo", rotulo: "Motivo da substituição", valor: (l) => l.motivoSubstituicao ?? null },
    { key: "tamanho", rotulo: "Tamanho (KB)",
      valor: (l) => (l.tamanho ? Math.round(l.tamanho / 1024) : null), alinhamento: "direita", somavel: true },
    { key: "mime", rotulo: "Formato", valor: (l) => l.mimeType ?? null },
    { key: "enviado_por", rotulo: "Enviado por", valor: (l) => l.criadoPor?.nome ?? null },
    { key: "enviado_em", rotulo: "Enviado em", valor: (l) => dataBR(l.createdAt) },
  ],

  ordenacoes: [
    { key: "enviado", rotulo: "Envio", orderBy: (d) => [{ createdAt: d }, { id: d }] },
    { key: "nome", rotulo: "Nome", orderBy: (d) => [{ nome: d }] },
  ],

  filtrosPrincipais: ["nome", "periodo", "tipo_documental"],
  colunasIniciais: ["nome", "tipo", "tipo_documental", "pessoa", "vinculo", "vigente", "enviado_por", "enviado_em"],
  ordenacaoPadrao: { key: "enviado", direcao: "desc" },

  contar: (where) => prisma.documentoArquivo.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.documentoArquivo.findMany({ where, orderBy, skip: pular, take: levar, include: INCLUDE }),

  visoesDoSistema: [
    { key: "vigentes", nome: "Vigentes",
      spec: { filtros: [{ key: "vigente", valor: { tipo: "booleano", valor: true } }] } },
    { key: "sem-classificacao", nome: "Sem tipo documental",
      spec: { filtros: [{ key: "sem_classificacao", valor: { tipo: "booleano", valor: true } }] } },
    { key: "de-protocolo", nome: "Comprovantes de protocolo",
      spec: { filtros: [{ key: "de_protocolo", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-tipo", nome: "Por tipo", spec: { filtros: [], agruparPor: "tipo" } },
  ],
}
