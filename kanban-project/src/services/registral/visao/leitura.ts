// src/services/registral/visao/leitura.ts
//
// DUPLA LEITURA VISUAL DE UMA CERTIDÃO.
//
// Recebe o arquivo (foto ou PDF escaneado), valida o que dá para validar antes de
// gastar dinheiro, faz DUAS leituras com estratégias opostas e devolve o material
// no formato que o motor registral já sabe conferir.
//
// A conferência das duas leituras NÃO acontece aqui: quem compara é
// `conferir()`, o mesmo código que compara as leituras textuais. Isso é de
// propósito — divergência é uma decisão registral, e decisão registral mora no
// núcleo puro, coberta por teste.

import { logRegistral } from "../auditoria"
import {
  ESQUEMA_LEITURA_VISUAL,
  INSTRUCAO_LEITURA_A,
  INSTRUCAO_LEITURA_B,
  SISTEMA_LEITURA_VISUAL,
  EXTRATOR_VISUAL_A,
  EXTRATOR_VISUAL_B,
  leituraVisualParaExtracao,
  naturezaConciliada,
  validarLeituraVisual,
  vinculosAfirmados,
  type LeituraVisual,
  type VinculoAfirmado,
} from "@/src/lib/genealogia/registral/visao"
import type { NaturezaRegistral, ResultadoExtracao } from "@/src/lib/genealogia/registral/tipos"
import {
  blocoDoArquivo,
  chamarVisao,
  configVisao,
  contarPaginasPdf,
  Orcamento,
  type ConfigVisao,
} from "./cliente"

export interface ArquivoParaLeitura {
  nome: string | null
  mimeType: string | null
  conteudo: Uint8Array
  /** Só para telemetria. Nunca vai para o provedor como conteúdo. */
  referencia?: string
}

export interface ResultadoLeituraVisual {
  ok: boolean
  /** Motivo pelo qual não deu — sempre preenchido quando `ok` é falso. */
  motivo: string | null
  natureza: NaturezaRegistral
  confiancaNatureza: number
  /** true quando as duas leituras discordaram do TIPO do documento. */
  naturezaDivergente: boolean
  a: ResultadoExtracao | null
  b: ResultadoExtracao | null
  visualA: LeituraVisual | null
  visualB: LeituraVisual | null
  vinculos: VinculoAfirmado[]
  legibilidade: "BOA" | "PARCIAL" | "RUIM" | "ILEGIVEL" | null
  problemasDeImagem: string[]
  averbacoes: Array<{ texto: string; data?: string | null; tipo?: string | null }>
  /** Texto transcrito, para gravar no Documento como transcrição oficial. */
  transcricao: Array<{ pagina: number; texto: string }>
  paginas: number | null
}

/**
 * Valida o arquivo ANTES de mandar. Barato, e é o que impede um upload malicioso
 * ou simplesmente errado de virar custo e latência.
 */
export function validarArquivo(
  arquivo: ArquivoParaLeitura,
  cfg: ConfigVisao = configVisao(),
): { ok: true; paginas: number | null } | { ok: false; motivo: string } {
  if (arquivo.conteudo.length === 0) return { ok: false, motivo: "Arquivo vazio." }
  if (arquivo.conteudo.length > cfg.maxBytes) {
    return {
      ok: false,
      motivo: `Arquivo de ${Math.round(arquivo.conteudo.length / 1024 / 1024)} MB passa do limite de ${Math.round(
        cfg.maxBytes / 1024 / 1024,
      )} MB para leitura visual.`,
    }
  }
  const bloco = blocoDoArquivo(arquivo.mimeType, arquivo.nome, arquivo.conteudo)
  if (!bloco.ok) return { ok: false, motivo: bloco.motivo }

  const paginas = contarPaginasPdf(arquivo.conteudo)
  if (paginas != null && paginas > cfg.maxPaginas) {
    return {
      ok: false,
      motivo: `PDF com ${paginas} páginas passa do limite de ${cfg.maxPaginas} por documento. Separe o arquivo por certidão.`,
    }
  }
  return { ok: true, paginas }
}

/**
 * Lê a certidão DUAS vezes, com estratégias independentes.
 *
 * As duas chamadas são feitas em paralelo de propósito: elas não se conhecem, e
 * uma não pode influenciar a outra. Se a leitura B enxergasse a A, deixaria de
 * ser uma segunda opinião e viraria uma confirmação — que é exatamente o que não
 * serve para detectar erro.
 */
export async function lerCertidaoDuasVezes(
  arquivo: ArquivoParaLeitura,
  orcamento: Orcamento,
  cfg: ConfigVisao = configVisao(),
): Promise<ResultadoLeituraVisual> {
  const vazio: ResultadoLeituraVisual = {
    ok: false,
    motivo: null,
    natureza: "DESCONHECIDO",
    confiancaNatureza: 0,
    naturezaDivergente: false,
    a: null,
    b: null,
    visualA: null,
    visualB: null,
    vinculos: [],
    legibilidade: null,
    problemasDeImagem: [],
    averbacoes: [],
    transcricao: [],
    paginas: null,
  }

  const validacao = validarArquivo(arquivo, cfg)
  if (!validacao.ok) return { ...vazio, motivo: validacao.motivo }

  const bloco = blocoDoArquivo(arquivo.mimeType, arquivo.nome, arquivo.conteudo)
  if (!bloco.ok) return { ...vazio, motivo: bloco.motivo }

  const pedir = (instrucao: string, rotulo: string) =>
    chamarVisao(
      {
        sistema: SISTEMA_LEITURA_VISUAL,
        // O arquivo vem PRIMEIRO e a instrução DEPOIS: a última palavra do turno
        // é a nossa, não a do documento.
        blocos: [bloco.bloco, { type: "text", text: instrucao }],
        esquema: ESQUEMA_LEITURA_VISUAL,
        referencia: `${arquivo.referencia ?? "?"}:${rotulo}`,
      },
      orcamento,
      cfg,
    )

  const [respA, respB] = await Promise.all([pedir(INSTRUCAO_LEITURA_A, "A"), pedir(INSTRUCAO_LEITURA_B, "B")])

  if (!respA.ok && !respB.ok) {
    return { ...vazio, motivo: respA.motivo, paginas: validacao.paginas }
  }

  const validA = respA.ok ? validarLeituraVisual(respA.json) : { leitura: null, problemas: [respA.motivo] }
  const validB = respB.ok ? validarLeituraVisual(respB.json) : { leitura: null, problemas: [respB.motivo] }

  // Uma leitura só não basta: sem a segunda não há como detectar divergência, e
  // entrar na árvore com leitura única é justamente o que este sistema não faz.
  if (!validA.leitura || !validB.leitura) {
    const quem = !validA.leitura ? "literal" : "registral"
    return {
      ...vazio,
      motivo: `Só uma das duas leituras independentes se completou (falhou a ${quem}). Sem as duas não há como conferir, e o documento não entra sem conferência.`,
      paginas: validacao.paginas,
      visualA: validA.leitura,
      visualB: validB.leitura,
    }
  }

  const nat = naturezaConciliada(
    { natureza: validA.leitura.natureza, confianca: validA.leitura.confiancaNatureza },
    { natureza: validB.leitura.natureza, confianca: validB.leitura.confiancaNatureza },
  )

  const extraA = leituraVisualParaExtracao(validA.leitura, EXTRATOR_VISUAL_A, nat.natureza)
  const extraB = leituraVisualParaExtracao(validB.leitura, EXTRATOR_VISUAL_B, nat.natureza)

  const legibilidade = piorDe(validA.leitura.legibilidade.nivel, validB.leitura.legibilidade.nivel)

  logRegistral("info", "visao_leitura_concluida", {
    referencia: arquivo.referencia ?? null,
    natureza: nat.natureza,
    naturezaDivergente: nat.divergente,
    camposA: extraA.campos.length,
    camposB: extraB.campos.length,
    legibilidade,
    tentativasA: respA.tentativasFeitas,
    tentativasB: respB.tentativasFeitas,
  })

  return {
    ok: true,
    motivo: null,
    natureza: nat.natureza,
    confiancaNatureza: nat.confianca,
    naturezaDivergente: nat.divergente,
    a: extraA,
    b: extraB,
    visualA: validA.leitura,
    visualB: validB.leitura,
    // Vínculos vêm da leitura registral (B), que é a que lê a narrativa de
    // filiação; a literal costuma ver só o rótulo.
    vinculos: vinculosAfirmados(validB.leitura),
    legibilidade,
    problemasDeImagem: [
      ...new Set([...validA.leitura.legibilidade.problemas, ...validB.leitura.legibilidade.problemas]),
    ],
    averbacoes: dedupAverbacoes([...validA.leitura.averbacoes, ...validB.leitura.averbacoes]),
    transcricao: transcricaoDe(validA.leitura, validB.leitura),
    paginas: validacao.paginas,
  }
}

const ORDEM_LEGIBILIDADE = ["BOA", "PARCIAL", "RUIM", "ILEGIVEL"] as const

function piorDe(
  a: "BOA" | "PARCIAL" | "RUIM" | "ILEGIVEL",
  b: "BOA" | "PARCIAL" | "RUIM" | "ILEGIVEL",
): "BOA" | "PARCIAL" | "RUIM" | "ILEGIVEL" {
  return ORDEM_LEGIBILIDADE.indexOf(a) >= ORDEM_LEGIBILIDADE.indexOf(b) ? a : b
}

function dedupAverbacoes(
  lista: Array<{ texto: string; data?: string | null; tipo?: string | null }>,
): Array<{ texto: string; data?: string | null; tipo?: string | null }> {
  const vistos = new Set<string>()
  const out: typeof lista = []
  for (const a of lista) {
    const chave = a.texto.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 120)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    out.push(a)
  }
  return out
}

/**
 * Transcrição a gravar no `Documento`. É montada a partir dos TRECHOS citados
 * pelas duas leituras — o que o sistema guarda como transcrição é exatamente o
 * que ele usou como evidência, não uma prosa gerada por cima.
 */
function transcricaoDe(a: LeituraVisual, b: LeituraVisual): Array<{ pagina: number; texto: string }> {
  const porPagina = new Map<number, string[]>()
  const juntar = (leitura: LeituraVisual, rotulo: string) => {
    for (const pessoa of leitura.pessoas) {
      for (const campo of pessoa.campos) {
        if (!campo.trecho) continue
        const pagina = campo.pagina ?? 1
        const linha = `[${rotulo}] ${pessoa.papel} · ${campo.campo}: ${campo.trecho}`
        const atual = porPagina.get(pagina) ?? []
        if (!atual.includes(linha)) atual.push(linha)
        porPagina.set(pagina, atual)
      }
    }
    for (const av of leitura.averbacoes) {
      const atual = porPagina.get(1) ?? []
      const linha = `[${rotulo}] AVERBACAO: ${av.texto}`
      if (!atual.includes(linha)) atual.push(linha)
      porPagina.set(1, atual)
    }
  }
  juntar(a, "literal")
  juntar(b, "registral")

  return [...porPagina.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([pagina, linhas]) => ({ pagina, texto: linhas.join("\n") }))
}
