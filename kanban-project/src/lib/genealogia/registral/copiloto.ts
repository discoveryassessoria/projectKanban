// src/lib/genealogia/registral/copiloto.ts
//
// MRG — COPILOTO GENEALÓGICO (requisito 16). Puro e determinístico.
//
// O que ele é: uma camada de CONSULTA que responde perguntas usando SOMENTE os
// dados e as evidências que existem no Discovery. Cada resposta traz conclusão,
// evidências, confiança, pendências e origem dos dados.
//
// O que ele NÃO é: um modelo de linguagem. Não há geração de texto livre nem
// chamada externa. A intenção da pergunta é classificada por padrão léxico e a
// resposta é montada a partir do dossiê. Isso é deliberado: um copiloto que pode
// inventar não serve para um sistema registral — e "nunca inventar informações"
// é requisito explícito.

import { normalizar } from "@/src/lib/genealogia/motor/texto"
import { ROTULO_CAMPO } from "./campos"
import type {
  CampoRegistral,
  EstadoFatoRegistral,
  Inconsistencia,
  ResultadoElegibilidade,
  SeveridadeRegistral,
} from "./tipos"

export type IntencaoCopiloto =
  | "QUEM_TRANSMITE"
  | "QUAL_LINHA"
  | "ONDE_QUEBRA"
  | "VINCULOS_NAO_COMPROVADOS"
  | "CERTIDOES_FALTANDO"
  | "DADOS_DIVERGENTES"
  | "POSSIVEIS_DUPLICIDADES"
  | "POR_QUE_CONFIRMADO"
  | "QUAL_DOCUMENTO_COMPROVA"
  | "IMPACTO_DE_CORRECAO"
  | "NAO_RECONHECIDA"

interface Padrao {
  intencao: IntencaoCopiloto
  termos: string[][]
}

/** Cada linha de `termos` é um conjunto AND; a lista externa é OR. */
const PADROES: Padrao[] = [
  { intencao: "QUEM_TRANSMITE", termos: [["QUEM", "TRANSMITE"], ["ASCENDENTE", "TRANSMISSOR"], ["DANTE", "CAUSA"], ["QUEM", "DA", "DIREITO"]] },
  { intencao: "QUAL_LINHA", termos: [["QUAL", "LINHA"], ["LINHA", "GENEALOGICA"], ["CAMINHO", "GENEALOGICO"], ["MOSTRAR", "LINHA"]] },
  { intencao: "ONDE_QUEBRA", termos: [["ONDE", "QUEBRA"], ["QUEBRA", "LINHA"], ["ONDE", "PARA"], ["LINHA", "INTERROMPID"]] },
  { intencao: "VINCULOS_NAO_COMPROVADOS", termos: [["VINCULO", "NAO", "COMPROVAD"], ["VINCULOS", "COMPROVAD"], ["PARENTESCO", "COMPROVAD"]] },
  { intencao: "CERTIDOES_FALTANDO", termos: [["CERTIDO", "FALTA"], ["QUE", "FALTA"], ["DOCUMENTO", "FALTA"], ["PENDENCIA", "DOCUMENTAL"]] },
  { intencao: "DADOS_DIVERGENTES", termos: [["DADO", "DIVERG"], ["DIVERGENCIA"], ["CONTRADI"]] },
  { intencao: "POSSIVEIS_DUPLICIDADES", termos: [["DUPLICID"], ["PESSOA", "DUPLICAD"], ["MESMA", "PESSOA", "DUAS"]] },
  { intencao: "POR_QUE_CONFIRMADO", termos: [["POR", "QUE", "CONFIRMAD"], ["PORQUE", "CONFIRMAD"], ["COMO", "CONFIRMAD"], ["BASE", "CONFIRMA"]] },
  { intencao: "QUAL_DOCUMENTO_COMPROVA", termos: [["QUAL", "DOCUMENTO", "COMPROVA"], ["DOCUMENTO", "COMPROVA", "VINCULO"], ["QUE", "DOCUMENTO", "PROVA"]] },
  { intencao: "IMPACTO_DE_CORRECAO", termos: [["IMPACTO"], ["SE", "CORRIGIR"], ["O", "QUE", "MUDA"], ["CONSEQUENCIA"]] },
]

export function classificarPergunta(pergunta: string): IntencaoCopiloto {
  const n = normalizar(pergunta)
  if (!n) return "NAO_RECONHECIDA"
  for (const p of PADROES) {
    for (const conjunto of p.termos) {
      if (conjunto.every((t) => n.includes(t))) return p.intencao
    }
  }
  return "NAO_RECONHECIDA"
}

// ---------------------------------------------------------------- dossiê

export interface FatoDoDossie {
  pessoaId: number | null
  uniaoId: number | null
  campo: CampoRegistral
  valorNormalizado: string | null
  estado: EstadoFatoRegistral
  confianca: string
  /** Documentos que sustentam o fato (ids + rótulo curto). */
  evidencias: Array<{ documentoId: number; rotulo: string; metodo: string; favoravel: boolean }>
}

export interface DossieCopiloto {
  processoId: number
  arvoreId: number | null
  nomePorPessoa: Map<number, string>
  elegibilidade: ResultadoElegibilidade
  inconsistencias: Inconsistencia[]
  fatos: FatoDoDossie[]
  /** Necessidades documentais abertas (dono: Sistema Documental). */
  necessidadesAbertas: Array<{
    id: number
    pessoaId: number | null
    uniaoId: number | null
    item: string
    status: string
    obrigatoria: boolean
  }>
  /** Propostas pendentes (o que aguarda decisão humana). */
  propostasPendentes: Array<{
    id: number
    tipo: string
    criticidade: string
    descricao: string
    pessoasAfetadas: number[]
  }>
}

export interface RespostaCopiloto {
  intencao: IntencaoCopiloto
  /** Conclusão em uma frase. Nunca especulativa. */
  conclusao: string
  /** Itens que sustentam a conclusão, cada um citando a origem. */
  evidencias: string[]
  /** 0..1 — derivada dos dados, não estimada por "sensação". */
  confianca: number
  pendencias: string[]
  /** Quais tabelas/módulos forneceram os dados desta resposta. */
  origemDosDados: string[]
  /** true quando o Discovery não tem dado para responder. */
  semDados: boolean
}

const SEM_DADOS = (intencao: IntencaoCopiloto, motivo: string, origem: string[]): RespostaCopiloto => ({
  intencao,
  conclusao: motivo,
  evidencias: [],
  confianca: 0,
  pendencias: ["Sem dado suficiente no Discovery para responder — nada foi inferido."],
  origemDosDados: origem,
  semDados: true,
})

export function responder(pergunta: string, d: DossieCopiloto): RespostaCopiloto {
  const intencao = classificarPergunta(pergunta)
  const nome = (id: number | null | undefined) =>
    id == null ? "—" : d.nomePorPessoa.get(id) ?? `pessoa #${id}`

  switch (intencao) {
    case "QUEM_TRANSMITE": {
      const t = d.elegibilidade.ascendenteTransmissorId
      if (t == null) {
        return SEM_DADOS(
          intencao,
          "O ascendente transmissor ainda não foi identificado na árvore deste processo.",
          ["Motor de linhagem (Árvore + Cadastro Mestre)"],
        )
      }
      return {
        intencao,
        conclusao: `${nome(t)} é o ascendente transmissor apurado. Situação da linha: ${d.elegibilidade.resultado}.`,
        evidencias: [
          `Caminho apurado: ${(d.elegibilidade.caminhoPrincipal?.ids ?? []).map(nome).join(" → ") || "não apurado"}`,
          d.elegibilidade.explicacao,
        ],
        confianca: d.elegibilidade.comprovadoDocumentalmente ? 0.95 : 0.6,
        pendencias: d.elegibilidade.pendencias,
        origemDosDados: ["Motor de linhagem", "Fatos registrais (evidência documental)"],
        semDados: false,
      }
    }

    case "QUAL_LINHA": {
      const ids = d.elegibilidade.caminhoPrincipal?.ids ?? []
      if (!ids.length) {
        return SEM_DADOS(intencao, "Não há caminho genealógico apurado a partir do requerente.", ["Motor de linhagem"])
      }
      const alternativas = d.elegibilidade.caminhosAlternativos.length
      return {
        intencao,
        conclusao: `${ids.map(nome).join(" → ")} (${ids.length} gerações).`,
        evidencias: [
          d.elegibilidade.explicacao,
          alternativas
            ? `Existem ${alternativas} caminho(s) alternativo(s) apurado(s) — o principal é o mais comprovado.`
            : "Não há caminho alternativo apurado.",
          ...ids
            .filter((id) => (d.elegibilidade.caminhoPrincipal?.geracoesSemComprovacao ?? []).includes(id))
            .map((id) => `${nome(id)}: geração sem comprovação documental.`),
        ],
        confianca: d.elegibilidade.comprovadoDocumentalmente ? 0.95 : 0.65,
        pendencias: d.elegibilidade.pendencias,
        origemDosDados: ["Árvore (Pessoa/União)", "Motor de linhagem", "Fatos registrais"],
        semDados: false,
      }
    }

    case "ONDE_QUEBRA": {
      const c = d.elegibilidade.caminhoPrincipal
      if (!c) {
        return SEM_DADOS(intencao, "Não há linha apurada para avaliar quebra.", ["Motor de linhagem"])
      }
      if (c.quebraEm == null && !c.geracoesSemComprovacao.length) {
        return {
          intencao,
          conclusao: "A linha não tem quebra estrutural nem geração sem comprovação.",
          evidencias: [d.elegibilidade.explicacao],
          confianca: 0.9,
          pendencias: [],
          origemDosDados: ["Motor de linhagem", "Fatos registrais"],
          semDados: false,
        }
      }
      return {
        intencao,
        conclusao:
          c.quebraEm != null
            ? `A linha se interrompe em ${nome(c.quebraEm)}: o vínculo com o ascendente não está cadastrado.`
            : `A linha está estruturalmente completa, mas ${c.geracoesSemComprovacao.length} geração(ões) não têm comprovação documental.`,
        evidencias: [
          ...c.geracoesSemComprovacao.map((id) => `${nome(id)}: sem evidência documental da filiação/nascimento.`),
          d.elegibilidade.explicacao,
        ],
        confianca: 0.9,
        pendencias: d.elegibilidade.pendencias,
        origemDosDados: ["Árvore", "Motor de linhagem", "Fatos registrais"],
        semDados: false,
      }
    }

    case "VINCULOS_NAO_COMPROVADOS": {
      const semProva = d.fatos.filter(
        (f) =>
          (f.campo === "FILIACAO_PAI" || f.campo === "FILIACAO_MAE") &&
          f.estado !== "CONFIRMADO" &&
          f.estado !== "CONFIRMADO_MULTIPLAS_EVIDENCIAS",
      )
      const linhaSem = d.elegibilidade.caminhoPrincipal?.geracoesSemComprovacao ?? []
      if (!semProva.length && !linhaSem.length) {
        return {
          intencao,
          conclusao: "Todos os vínculos de filiação da linha têm evidência documental confirmada.",
          evidencias: d.fatos
            .filter((f) => f.campo === "FILIACAO_PAI" || f.campo === "FILIACAO_MAE")
            .slice(0, 10)
            .map((f) => `${nome(f.pessoaId)} — ${ROTULO_CAMPO[f.campo]}: ${f.estado} (${f.evidencias.length} evidência(s))`),
          confianca: 0.9,
          pendencias: [],
          origemDosDados: ["Fatos registrais", "Evidências registrais"],
          semDados: false,
        }
      }
      return {
        intencao,
        conclusao: `${semProva.length + linhaSem.length} vínculo(s) sem comprovação documental completa.`,
        evidencias: [
          ...semProva.map(
            (f) => `${nome(f.pessoaId)} — ${ROTULO_CAMPO[f.campo]}: estado ${f.estado}, ${f.evidencias.length} evidência(s).`,
          ),
          ...linhaSem.map((id) => `${nome(id)}: geração da linha sem comprovação.`),
        ],
        confianca: 0.9,
        pendencias: d.elegibilidade.pendencias,
        origemDosDados: ["Fatos registrais", "Evidências registrais", "Motor de linhagem"],
        semDados: false,
      }
    }

    case "CERTIDOES_FALTANDO": {
      const abertas = d.necessidadesAbertas.filter((n) => n.obrigatoria && n.status !== "ATENDIDA" && n.status !== "DISPENSADA")
      if (!abertas.length) {
        return {
          intencao,
          conclusao: "Não há necessidade documental obrigatória em aberto para este processo.",
          evidencias: ["Consultado o Sistema Documental (NecessidadeDocumental) — nenhuma pendência obrigatória."],
          confianca: 0.95,
          pendencias: [],
          origemDosDados: ["Sistema Documental (NecessidadeDocumental)"],
          semDados: false,
        }
      }
      return {
        intencao,
        conclusao: `${abertas.length} certidão(ões) obrigatória(s) em aberto.`,
        evidencias: abertas
          .slice(0, 25)
          .map(
            (n) =>
              `${n.item} — ${n.pessoaId != null ? nome(n.pessoaId) : n.uniaoId != null ? `união #${n.uniaoId}` : "processo"} (status ${n.status})`,
          ),
        confianca: 0.98,
        pendencias: abertas.length > 25 ? [`Mais ${abertas.length - 25} não listadas.`] : [],
        // A árvore NÃO decide exigência documental: só lê o que o Sistema
        // Documental decidiu.
        origemDosDados: ["Sistema Documental (NecessidadeDocumental / ItemCatalogo)"],
        semDados: false,
      }
    }

    case "DADOS_DIVERGENTES": {
      const divergentes = d.fatos.filter(
        (f) => f.estado === "DIVERGENTE" || f.estado === "CONFLITANTE" || f.estado === "EM_REVISAO",
      )
      const incDiv = d.inconsistencias.filter((i) => i.codigo === "DIVERGENCIA_ARVORE_CERTIDAO")
      if (!divergentes.length && !incDiv.length) {
        return {
          intencao,
          conclusao: "Nenhum dado registral divergente registrado neste processo.",
          evidencias: ["Fatos registrais em estado DIVERGENTE/CONFLITANTE: nenhum."],
          confianca: 0.9,
          pendencias: [],
          origemDosDados: ["Fatos registrais", "Motor de integridade"],
          semDados: false,
        }
      }
      return {
        intencao,
        conclusao: `${divergentes.length + incDiv.length} divergência(s) registral(is) em aberto.`,
        evidencias: [
          ...divergentes.map(
            (f) =>
              `${nome(f.pessoaId)} — ${ROTULO_CAMPO[f.campo]}: ${f.estado}${f.evidencias.length ? ` (documentos ${f.evidencias.map((e) => `#${e.documentoId}`).join(", ")})` : ""}`,
          ),
          ...incDiv.map((i) => i.descricao),
        ],
        confianca: 0.95,
        pendencias: incDiv.map((i) => i.acaoSugerida),
        origemDosDados: ["Fatos registrais", "Evidências registrais", "Motor de integridade"],
        semDados: false,
      }
    }

    case "POSSIVEIS_DUPLICIDADES": {
      const dups = d.inconsistencias.filter((i) => i.codigo.includes("DUPLICAD"))
      if (!dups.length) {
        return {
          intencao,
          conclusao: "Nenhuma possível duplicidade de pessoa detectada nesta árvore.",
          evidencias: ["Motor de integridade + triagem de duplicidade do Cadastro Mestre: nenhum par sinalizado."],
          confianca: 0.85,
          pendencias: [],
          origemDosDados: ["Motor de integridade", "Triagem MDM-3"],
          semDados: false,
        }
      }
      return {
        intencao,
        conclusao: `${dups.length} possível(is) duplicidade(s) sinalizada(s) — nenhuma foi fundida automaticamente.`,
        evidencias: dups.map((i) => `${i.descricao} — ${i.explicacao}`),
        confianca: 0.85,
        pendencias: [
          "Fusão de pessoas exige decisão humana com permissão dedicada e análise de impacto.",
          ...dups.map((i) => i.acaoSugerida),
        ],
        origemDosDados: ["Motor de integridade", "Triagem MDM-3"],
        semDados: false,
      }
    }

    case "POR_QUE_CONFIRMADO": {
      const confirmados = d.fatos.filter(
        (f) => f.estado === "CONFIRMADO" || f.estado === "CONFIRMADO_MULTIPLAS_EVIDENCIAS",
      )
      if (!confirmados.length) {
        return SEM_DADOS(
          intencao,
          "Nenhum fato registral deste processo está em estado confirmado.",
          ["Fatos registrais"],
        )
      }
      return {
        intencao,
        conclusao: `${confirmados.length} fato(s) confirmado(s), cada um por evidência documental rastreável.`,
        evidencias: confirmados
          .slice(0, 25)
          .map(
            (f) =>
              `${nome(f.pessoaId)} — ${ROTULO_CAMPO[f.campo]} = “${f.valorNormalizado ?? "—"}”: ${f.estado} por ${f.evidencias.length} evidência(s) (${f.evidencias.map((e) => `doc #${e.documentoId} via ${e.metodo}`).join("; ")})`,
          ),
        confianca: 0.97,
        pendencias: [],
        origemDosDados: ["Fatos registrais", "Evidências registrais", "Documento do Processo"],
        semDados: false,
      }
    }

    case "QUAL_DOCUMENTO_COMPROVA": {
      const filiacoes = d.fatos.filter((f) => f.campo === "FILIACAO_PAI" || f.campo === "FILIACAO_MAE")
      const comEvidencia = filiacoes.filter((f) => f.evidencias.length > 0)
      if (!comEvidencia.length) {
        return SEM_DADOS(
          intencao,
          "Nenhum vínculo de filiação deste processo tem documento vinculado como evidência.",
          ["Evidências registrais"],
        )
      }
      return {
        intencao,
        conclusao: `${comEvidencia.length} vínculo(s) com documento comprobatório identificado.`,
        evidencias: comEvidencia.map(
          (f) =>
            `${nome(f.pessoaId)} — ${ROTULO_CAMPO[f.campo]}: ${f.evidencias.map((e) => `${e.rotulo} (doc #${e.documentoId}, ${e.favoravel ? "favorável" : "contrária"})`).join("; ")}`,
        ),
        confianca: 0.95,
        pendencias: filiacoes
          .filter((f) => !f.evidencias.length)
          .map((f) => `${nome(f.pessoaId)} — ${ROTULO_CAMPO[f.campo]}: sem documento vinculado.`),
        origemDosDados: ["Evidências registrais", "Documento do Processo", "Documento Mestre"],
        semDados: false,
      }
    }

    case "IMPACTO_DE_CORRECAO": {
      if (!d.propostasPendentes.length) {
        return {
          intencao,
          conclusao: "Não há proposta de correção pendente para avaliar impacto.",
          evidencias: ["Nenhuma PropostaReconciliacao em estado PENDENTE neste processo."],
          confianca: 0.9,
          pendencias: [],
          origemDosDados: ["Propostas de reconciliação"],
          semDados: false,
        }
      }
      const bloqueadas = d.propostasPendentes.filter((p) => p.criticidade === "BLOQUEIO")
      return {
        intencao,
        conclusao: `${d.propostasPendentes.length} correção(ões) pendente(s); ${bloqueadas.length} classificada(s) como bloqueio.`,
        evidencias: d.propostasPendentes.map(
          (p) =>
            `#${p.id} ${p.tipo} (${p.criticidade}) — ${p.descricao} · afeta ${p.pessoasAfetadas.map(nome).join(", ") || "nenhuma pessoa registrada"}`,
        ),
        confianca: 0.9,
        pendencias: bloqueadas.map(
          (p) => `#${p.id} exige permissão dedicada e análise de impacto antes de qualquer aplicação.`,
        ),
        origemDosDados: ["Propostas de reconciliação", "Análise de impacto"],
        semDados: false,
      }
    }

    default:
      return {
        intencao: "NAO_RECONHECIDA",
        conclusao:
          "Não reconheci a pergunta. O copiloto responde apenas sobre dados existentes no Discovery e não gera texto livre.",
        evidencias: [],
        confianca: 0,
        pendencias: [
          "Perguntas cobertas: quem transmite a cidadania; qual é a linha; onde está a quebra; quais vínculos não estão comprovados; quais certidões faltam; quais dados divergem; quais pessoas podem estar duplicadas; por que um dado foi confirmado; qual documento comprova o vínculo; qual impacto uma correção causará.",
        ],
        origemDosDados: [],
        semDados: true,
      }
  }
}

/** Severidade agregada do dossiê — para ordenar a fila de revisão. */
export function severidadeDoDossie(d: DossieCopiloto): SeveridadeRegistral {
  if (d.inconsistencias.some((i) => i.severidade === "CRITICO")) return "CRITICO"
  if (d.elegibilidade.resultado === "LINHA_CONFLITANTE") return "CRITICO"
  if (d.inconsistencias.some((i) => i.severidade === "ALTO")) return "ALTO"
  if (d.elegibilidade.pendencias.length) return "MEDIO"
  return "INFO"
}
