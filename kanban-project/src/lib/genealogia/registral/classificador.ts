// src/lib/genealogia/registral/classificador.ts
//
// MRG — etapa CLASSIFICANDO. Puro.
//
// O que classifica: a NATUREZA REGISTRAL do documento (nascimento, casamento,
// óbito, batismo, naturalização, imigração, identificação).
//
// Hierarquia de decisão, do mais forte para o mais fraco:
//   1. tipo declarado no Sistema Documental (é o dono do tipo — a árvore não
//      redefine tipo de documento, só o lê);
//   2. chave estruturada de `Documento.registral` / `structuredData`
//      (birth/marriage/death) — dado já revisado por humano na AD2;
//   3. evidência textual da transcrição (títulos e fórmulas registrais).
//
// Quando (1) e (3) discordam, o resultado carrega `divergenciaComDeclarado` e a
// execução vira DOCUMENTO_CONFLITANTE — o motor não sobrescreve o tipo declarado
// pelo Sistema Documental, ele denuncia a contradição.

import { normalizar } from "@/src/lib/genealogia/motor/texto"
import type { LeituraDocumento, NaturezaRegistral } from "./tipos"

export interface ResultadoClassificacao {
  natureza: NaturezaRegistral
  confianca: number
  /** De onde veio a decisão: "declarado" | "estruturado" | "texto". */
  fonte: string
  /** Natureza sugerida pelo texto, quando difere do declarado. */
  naturezaTextual: NaturezaRegistral | null
  divergenciaComDeclarado: boolean
  /** Trechos que sustentaram a decisão textual (para evidência). */
  indicios: string[]
  /** true quando não há material suficiente para classificar. */
  insuficiente: boolean
}

/** Mapeia o tipo declarado (enum/código do Sistema Documental) para natureza. */
export function naturezaDoTipoDeclarado(tipo: string | null | undefined): NaturezaRegistral | null {
  const t = normalizar(tipo)
  if (!t) return null
  if (t.includes("NASCIMENTO") || t.includes("NASC")) return "NASCIMENTO"
  if (t.includes("CASAMENTO") || t.includes("MATRIMON")) return "CASAMENTO"
  if (t.includes("OBITO") || t.includes("MORTE") || t.includes("FALEC")) return "OBITO"
  if (t.includes("BATISMO") || t.includes("BATIS")) return "BATISMO"
  if (t.includes("NATURALIZ") || t === "CNN") return "NATURALIZACAO"
  if (t.includes("IMIGRA") || t.includes("DESEMBARQUE") || t.includes("CHEGADA")) return "IMIGRACAO"
  if (
    t.includes("RG") ||
    t.includes("CPF") ||
    t.includes("CNH") ||
    t.includes("PASSAPORTE") ||
    t.includes("IDENTIDADE")
  ) {
    return "IDENTIFICACAO"
  }
  return null
}

interface Assinatura {
  natureza: NaturezaRegistral
  /** Expressões que, em texto de certidão, só aparecem nesse tipo. */
  fortes: RegExp[]
  /** Expressões de apoio (somam menos). */
  fracas: RegExp[]
}

const ASSINATURAS: Assinatura[] = [
  {
    natureza: "NASCIMENTO",
    fortes: [
      /CERTID(AO|ÃO)\s+DE\s+NASCIMENTO/,
      /REGISTRO\s+DE\s+NASCIMENTO/,
      /LIVRO\s+A[\s-]*\d*\s+DE\s+NASCIMENTO/,
      /NASCEU\s+(NESTA|NO|NA|EM)/,
      /ATTO\s+DI\s+NASCITA/,
    ],
    fracas: [/NASCIMENTO/, /NASCIDO\s+EM/, /NASCIDA\s+EM/, /DECLARANTE/],
  },
  {
    natureza: "CASAMENTO",
    fortes: [
      /CERTID(AO|ÃO)\s+DE\s+CASAMENTO/,
      /REGISTRO\s+DE\s+CASAMENTO/,
      /CONTRA(I|Í)RAM\s+MATRIM(O|Ô)NIO/,
      /RECEBERAM[\s-]*SE\s+EM\s+MATRIM(O|Ô)NIO/,
      /ATTO\s+DI\s+MATRIMONIO/,
      /LIVRO\s+B[\s-]*\d*\s+DE\s+CASAMENTO/,
    ],
    fracas: [/CASAMENTO/, /N(U|Ú)PCIAS/, /C(O|Ô)NJUGE/, /REGIME\s+DE\s+BENS/, /NOIVO/, /NOIVA/],
  },
  {
    natureza: "OBITO",
    fortes: [
      /CERTID(AO|ÃO)\s+DE\s+(O|Ó)BITO/,
      /REGISTRO\s+DE\s+(O|Ó)BITO/,
      /FALECEU\s+(NESTA|NO|NA|EM|AOS)/,
      /ATTO\s+DI\s+MORTE/,
      /LIVRO\s+C[\s-]*\d*\s+DE\s+(O|Ó)BITO/,
      /CAUSA\s+DA\s+MORTE/,
    ],
    fracas: [/(O|Ó)BITO/, /SEPULT/, /CEMIT(E|É)RIO/, /DECLARA(C|Ç)(AO|ÃO)\s+DE\s+(O|Ó)BITO/],
  },
  {
    natureza: "BATISMO",
    fortes: [
      /CERTID(AO|ÃO)\s+DE\s+BATISMO/,
      /LIVRO\s+DE\s+BATISMOS?/,
      /FOI\s+BATIZAD[OA]/,
      /BATIZ(EI|OU)\s+SOLENEMENTE/,
      /PADRINHOS?\s*:/,
    ],
    fracas: [/BATISMO/, /PARO(Q|C)UIA/, /PADRINHO/, /MADRINHA/, /P(A|Á)ROCO/],
  },
  {
    natureza: "NATURALIZACAO",
    fortes: [
      /CERTID(AO|ÃO)\s+NEGATIVA\s+DE\s+NATURALIZA(C|Ç)(AO|ÃO)/,
      /N(A|Ã)O\s+CONSTA.*NATURALIZA(C|Ç)(AO|ÃO)/,
      /DECRETO\s+DE\s+NATURALIZA(C|Ç)(AO|ÃO)/,
      /T(I|Í)TULO\s+DECLARAT(O|Ó)RIO/,
    ],
    fracas: [/NATURALIZA(C|Ç)(AO|ÃO)/, /NATURALIZAD[OA]/],
  },
  {
    natureza: "IMIGRACAO",
    fortes: [
      /LISTA\s+DE\s+(DESEMBARQUE|PASSAGEIROS)/,
      /REGISTRO\s+DE\s+IMIGRANTE/,
      /HOSPEDARIA\s+DE\s+IMIGRANTES/,
      /VAPOR\s+[A-Z]/,
    ],
    fracas: [/PORTO\s+DE\s+(EMBARQUE|CHEGADA)/, /NAVIO/, /IMIGRA/],
  },
  {
    natureza: "IDENTIFICACAO",
    fortes: [
      /C(E|É)DULA\s+DE\s+IDENTIDADE/,
      /CARTEIRA\s+NACIONAL\s+DE\s+HABILITA(C|Ç)(AO|ÃO)/,
      /PASSAPORTE/,
      /CADASTRO\s+DE\s+PESSOAS\s+F(I|Í)SICAS/,
    ],
    fracas: [/REGISTRO\s+GERAL/, /(O|Ó)RG(AO|ÃO)\s+EMISSOR/],
  },
]

const MINIMO_CARACTERES_UTEIS = 40

/**
 * Classifica um documento. Não escreve nada, não decide status documental.
 */
export function classificarDocumento(leitura: LeituraDocumento): ResultadoClassificacao {
  const declarado = naturezaDoTipoDeclarado(leitura.tipoDeclarado)
  const porEstrutura = naturezaPorEstrutura(leitura)
  const texto = normalizar(leitura.paginas.map((p) => p.texto).join(" \n "))

  const indicios: string[] = []
  let melhor: { natureza: NaturezaRegistral; pontos: number } | null = null

  if (texto.length >= MINIMO_CARACTERES_UTEIS) {
    for (const a of ASSINATURAS) {
      let pontos = 0
      for (const re of a.fortes) {
        const m = texto.match(re)
        if (m) {
          pontos += 3
          indicios.push(m[0].slice(0, 80))
        }
      }
      for (const re of a.fracas) {
        if (re.test(texto)) pontos += 1
      }
      if (pontos > 0 && (!melhor || pontos > melhor.pontos)) melhor = { natureza: a.natureza, pontos }
    }
  }

  const naturezaTextual = melhor ? melhor.natureza : null

  // (1) declarado manda.
  if (declarado) {
    const divergencia = naturezaTextual != null && naturezaTextual !== declarado && (melhor?.pontos ?? 0) >= 3
    return {
      natureza: declarado,
      confianca: divergencia ? 0.55 : naturezaTextual === declarado ? 0.99 : 0.9,
      fonte: "declarado",
      naturezaTextual,
      divergenciaComDeclarado: divergencia,
      indicios,
      insuficiente: false,
    }
  }

  // (2) estrutura revisada.
  if (porEstrutura) {
    return {
      natureza: porEstrutura,
      confianca: 0.9,
      fonte: "estruturado",
      naturezaTextual,
      divergenciaComDeclarado: naturezaTextual != null && naturezaTextual !== porEstrutura,
      indicios,
      insuficiente: false,
    }
  }

  // (3) texto.
  if (melhor && melhor.pontos >= 3) {
    return {
      natureza: melhor.natureza,
      confianca: Math.min(0.85, 0.45 + melhor.pontos * 0.08),
      fonte: "texto",
      naturezaTextual,
      divergenciaComDeclarado: false,
      indicios,
      insuficiente: false,
    }
  }

  return {
    natureza: "DESCONHECIDO",
    confianca: 0,
    fonte: "nenhuma",
    naturezaTextual,
    divergenciaComDeclarado: false,
    indicios,
    insuficiente: true,
  }
}

function naturezaPorEstrutura(leitura: LeituraDocumento): NaturezaRegistral | null {
  const fontes = [leitura.registral, leitura.estruturado]
  for (const f of fontes) {
    if (!f || typeof f !== "object") continue
    if ("birth" in f && f.birth) return "NASCIMENTO"
    if ("marriage" in f && f.marriage) return "CASAMENTO"
    if ("death" in f && f.death) return "OBITO"
  }
  return null
}

/** Papéis esperados em cada natureza — usado pelos extratores. */
export const PAPEIS_ESPERADOS: Record<NaturezaRegistral, import("./tipos").PapelOcorrencia[]> = {
  NASCIMENTO: ["REGISTRADO", "PAI", "MAE", "AVO_PATERNO", "AVOA_PATERNA", "AVO_MATERNO", "AVOA_MATERNA", "DECLARANTE"],
  CASAMENTO: ["REGISTRADO", "CONJUGE", "PAI", "MAE", "TESTEMUNHA", "OFICIANTE"],
  OBITO: ["REGISTRADO", "PAI", "MAE", "CONJUGE", "DECLARANTE"],
  BATISMO: ["REGISTRADO", "PAI", "MAE", "PADRINHO", "MADRINHA", "OFICIANTE"],
  NATURALIZACAO: ["REGISTRADO"],
  IMIGRACAO: ["REGISTRADO", "CONJUGE", "FILHO"],
  IDENTIFICACAO: ["REGISTRADO", "PAI", "MAE"],
  DESCONHECIDO: ["REGISTRADO"],
}
