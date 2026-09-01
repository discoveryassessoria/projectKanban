// DOMÍNIO QUALIDADE E INTEGRIDADE — 1 linha = 1 ocorrência de inconsistência.
//
// ─── POR QUE ESTE DOMÍNIO É O MAIS IMPORTANTE ───────────────────────────────
// Os outros dezesseis mostram dados. Este responde se dá para acreditar neles.
// Quando alguém diz "o sistema não é confiável", é aqui que a resposta aparece:
// duplicidade, órfão, vínculo quebrado, campo obrigatório vazio, divergência
// entre Cadastro Mestre e operação.
//
// ─── ELE NÃO INVENTA VERIFICAÇÃO ────────────────────────────────────────────
// A fonte é `SaudeAchado`, gravada pelo motor de Saúde do Sistema que já roda
// por cron. Este domínio é LEITURA: não executa diagnóstico, não decide
// severidade e não conserta nada. Reimplementar as regras aqui criaria uma
// segunda opinião sobre a saúde do sistema — exatamente o problema que a
// arquitetura inteira existe para evitar.

import { prisma } from "@/lib/prisma"
import type { DominioDef } from "../tipos"
import { contem, dataBR, diasEntre, emLista, periodo, porCampo } from "./_comuns"

const SEVERIDADES = [
  { valor: "CRITICO", rotulo: "Crítico" },
  { valor: "ERRO", rotulo: "Erro" },
  { valor: "ALERTA", rotulo: "Alerta" },
  { valor: "INFORMATIVO", rotulo: "Informativo" },
]

export const DOMINIO_QUALIDADE: DominioDef = {
  key: "qualidade",
  rotulo: "Qualidade e Integridade",
  descricao: "Onde os dados estão errados: duplicidades, órfãos, vínculos quebrados e divergências.",
  grain: "1 linha = 1 ocorrência de inconsistência detectada",
  permissao: "usuarios.gerenciar",
  ordem: 17,
  // Achado é do SISTEMA, não de uma nacionalidade. Filtrar por nacionalidade
  // esconderia justamente o problema estrutural que não pertence a nenhuma.
  aceitaNacionalidade: false,
  ondeNacionalidade: () => ({}),

  filtros: [
    { key: "severidade", rotulo: "Severidade", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: SEVERIDADES }, paraWhere: emLista("severidade") },
    { key: "status", rotulo: "Situação", tipo: "multi_selecao",
      opcoes: { tipo: "catalogo", valores: [
        { valor: "ABERTO", rotulo: "Aberto" }, { valor: "RESOLVIDO", rotulo: "Resolvido" } ] },
      paraWhere: emLista("status") },
    { key: "dominio", rotulo: "Domínio afetado", tipo: "texto", paraWhere: contem("dominio") },
    { key: "modulo", rotulo: "Módulo", tipo: "texto", paraWhere: contem("modulo") },
    { key: "entidade", rotulo: "Entidade", tipo: "texto", paraWhere: contem("entidade") },
    { key: "titulo", rotulo: "Título contém", tipo: "texto", paraWhere: contem("titulo") },
    { key: "periodo_deteccao", rotulo: "Período da primeira detecção", tipo: "intervalo_data",
      paraWhere: (v) => periodo("primeiraDeteccao", v) },
    { key: "aberto_ha", rotulo: "Aberto há (dias)", tipo: "numero",
      paraWhere: (v) => {
        if (v.tipo !== "numero" || !Number.isFinite(v.numero)) return null
        const limite = new Date()
        limite.setDate(limite.getDate() - v.numero)
        return { status: "ABERTO", primeiraDeteccao: { lt: limite } }
      } },
    { key: "com_correcao", rotulo: "Tem correção automática disponível", tipo: "booleano",
      paraWhere: (v) => (v.tipo !== "booleano" ? null
        : v.valor ? { correcaoAutomatica: { not: null } } : { correcaoAutomatica: null }) },
  ],

  agrupamentos: [
    porCampo("severidade", "Severidade", (l) => l.severidade),
    porCampo("dominio", "Domínio", (l) => l.dominio),
    porCampo("modulo", "Módulo", (l) => l.modulo),
    porCampo("entidade", "Entidade", (l) => l.entidade),
    porCampo("status", "Situação", (l) => l.status),
  ],

  colunas: [
    { key: "severidade", rotulo: "Severidade", valor: (l) => l.severidade },
    { key: "titulo", rotulo: "Problema", valor: (l) => l.titulo, link: (l) => l.link ?? null },
    { key: "descricao", rotulo: "Descrição", valor: (l) => l.descricao },
    { key: "impacto", rotulo: "Impacto", valor: (l) => l.impacto ?? null },
    { key: "dominio", rotulo: "Domínio", valor: (l) => l.dominio },
    { key: "modulo", rotulo: "Módulo", valor: (l) => l.modulo },
    { key: "entidade", rotulo: "Entidade", valor: (l) => l.entidade ?? null },
    { key: "registro", rotulo: "Registro", valor: (l) => l.registroNome ?? l.registroId ?? null },
    { key: "quantidade", rotulo: "Ocorrências", valor: (l) => l.quantidade, alinhamento: "direita", somavel: true },
    { key: "status", rotulo: "Situação", valor: (l) => l.status },
    { key: "primeira", rotulo: "Detectado em", valor: (l) => dataBR(l.primeiraDeteccao) },
    { key: "ultima", rotulo: "Visto pela última vez", valor: (l) => dataBR(l.ultimaDeteccao) },
    { key: "aberto_ha", rotulo: "Aberto há (dias)",
      valor: (l) => (l.status === "ABERTO" ? diasEntre(l.primeiraDeteccao) : null), alinhamento: "direita" },
    { key: "resolvido", rotulo: "Resolvido em", valor: (l) => dataBR(l.resolvidoEm) },
    { key: "recomendacao", rotulo: "O que fazer", valor: (l) => l.recomendacao ?? null },
    { key: "correcao", rotulo: "Correção automática", valor: (l) => l.correcaoAutomatica ?? null },
    { key: "codigo", rotulo: "Código da verificação", valor: (l) => l.codigo },
  ],

  ordenacoes: [
    { key: "deteccao", rotulo: "Primeira detecção", orderBy: (d) => [{ primeiraDeteccao: d }, { id: d }] },
    { key: "quantidade", rotulo: "Ocorrências", orderBy: (d) => [{ quantidade: d }, { id: "desc" as const }] },
    { key: "severidade", rotulo: "Severidade", orderBy: (d) => [{ severidade: d }, { id: "desc" as const }] },
  ],

  colunasIniciais: ["severidade", "titulo", "dominio", "entidade", "registro", "quantidade", "status", "aberto_ha"],
  ordenacaoPadrao: { key: "deteccao", direcao: "desc" },

  contar: (where) => prisma.saudeAchado.count({ where }),
  carregar: (where, orderBy, pular, levar) =>
    prisma.saudeAchado.findMany({ where, orderBy, skip: pular, take: levar }),

  visoesDoSistema: [
    { key: "abertos", nome: "Problemas em aberto",
      spec: { filtros: [{ key: "status", valor: { tipo: "multi_selecao", valores: ["ABERTO"] } }] } },
    { key: "criticos", nome: "Críticos e erros",
      spec: { filtros: [
        { key: "status", valor: { tipo: "multi_selecao", valores: ["ABERTO"] } },
        { key: "severidade", valor: { tipo: "multi_selecao", valores: ["CRITICO", "ERRO"] } },
      ] } },
    { key: "antigos", nome: "Abertos há mais de 30 dias",
      spec: { filtros: [{ key: "aberto_ha", valor: { tipo: "numero", numero: 30 } }] } },
    { key: "corrigiveis", nome: "Com correção automática",
      spec: { filtros: [{ key: "com_correcao", valor: { tipo: "booleano", valor: true } }] } },
    { key: "por-dominio", nome: "Por domínio", spec: { filtros: [], agruparPor: "dominio" } },
  ],
}
