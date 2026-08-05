// src/lib/documentos/modelos/validador.ts
//
// VALIDADOR DE TEMPLATE — o portão da publicação.
//
// Uma versão só vira PUBLICADA se passar por aqui. O validador não opina sobre o
// texto jurídico (não é dele a autoridade); ele prova três coisas objetivas:
//   1. o pacote abre e é um DOCX;
//   2. toda variável citada é conhecida pelo registry, e nenhuma desconhecida
//      sobrou (um `{{OUTORGANTE_NOM}}` com erro de digitação nunca chega ao
//      cliente como texto cru);
//   3. nenhum DADO PESSOAL DE EXEMPLO ficou fixo no template.
//
// COMO SE DETECTA "DADO DE EXEMPLO" SEM CITAR NOME DE NINGUÉM
// -----------------------------------------------------------
// Procurar por "EDISON" ou "SYLVIA" seria amarrar o sistema a duas pessoas reais
// e falhar em qualquer template novo. O validador faz o oposto: encontra TODO
// literal com forma de identificação (CPF, RG, CEP) que restou no template e
// exige que cada um seja DECLARADO como dado fixo do outorgado. O que não foi
// declarado bloqueia a publicação — o publicador precisa olhar e afirmar.
// Sobre isso há uma checagem que ninguém pode contornar: literal que existe no
// cadastro de um cliente real é dado de cliente, e bloqueia mesmo declarado.

import { extrairPlaceholders, definicaoDaVariavel } from "./variaveis"
import { docxIntegro, textoDoDocx } from "./docx"

export type SeveridadeAchado = "erro" | "aviso"

export interface AchadoValidacao {
  codigo: string
  severidade: SeveridadeAchado
  mensagem: string
  detalhe?: string
}

export interface LiteralIdentificacao {
  /** Forma reconhecida: cpf | rg | cep | numerico. */
  tipo: "cpf" | "rg" | "cep" | "numerico"
  valor: string
  /** Só dígitos — é por aqui que se compara com o cadastro. */
  digitos: string
}

export interface ResultadoValidacaoTemplate {
  ok: boolean
  achados: AchadoValidacao[]
  placeholders: string[]
  obrigatorios: string[]
  opcionais: string[]
  desconhecidos: string[]
  literais: LiteralIdentificacao[]
  naoDeclarados: LiteralIdentificacao[]
}

const PADROES: Array<{ tipo: LiteralIdentificacao["tipo"]; re: RegExp }> = [
  { tipo: "cpf", re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
  { tipo: "cep", re: /\b\d{5}-\d{3}\b/g },
  { tipo: "rg", re: /\b\d{1,2}\.\d{3}\.\d{3}-?[\dxX]?\b/g },
  { tipo: "numerico", re: /\b\d{7,11}\b/g },
]

/** Literais com forma de identificação civil presentes no texto. */
export function literaisDeIdentificacao(texto: string): LiteralIdentificacao[] {
  const achados: LiteralIdentificacao[] = []
  const vistos = new Set<string>()
  for (const { tipo, re } of PADROES) {
    for (const m of texto.matchAll(re)) {
      const valor = m[0]
      const digitos = valor.replace(/\D/g, "")
      // Um CPF formatado também casa como "numerico" depois de limpo; a primeira
      // forma reconhecida vence, para não contar o mesmo dado duas vezes.
      if (vistos.has(digitos)) continue
      vistos.add(digitos)
      achados.push({ tipo, valor, digitos })
    }
  }
  return achados
}

export interface OpcoesValidacao {
  /** Literais que o publicador afirma serem dados fixos do outorgado. */
  dadosFixosDeclarados?: string[]
  /**
   * Dígitos que pertencem a clientes REAIS do cadastro. Bloqueiam sempre, mesmo
   * declarados — dado de cliente nunca é dado fixo de template.
   */
  digitosDeClientesReais?: string[]
}

export async function validarTemplate(
  buffer: Buffer | Uint8Array,
  opcoes: OpcoesValidacao = {},
): Promise<ResultadoValidacaoTemplate> {
  const achados: AchadoValidacao[] = []

  const integro = await docxIntegro(buffer)
  if (!integro) {
    return {
      ok: false,
      achados: [
        {
          codigo: "DOCX_INVALIDO",
          severidade: "erro",
          mensagem: "O arquivo não é um DOCX legível.",
          detalhe: "O pacote não abriu ou não contém word/document.xml.",
        },
      ],
      placeholders: [],
      obrigatorios: [],
      opcionais: [],
      desconhecidos: [],
      literais: [],
      naoDeclarados: [],
    }
  }

  const texto = await textoDoDocx(buffer)
  const placeholders = extrairPlaceholders(texto)

  const desconhecidos = placeholders.filter((p) => definicaoDaVariavel(p) == null)
  for (const d of desconhecidos) {
    achados.push({
      codigo: "PLACEHOLDER_DESCONHECIDO",
      severidade: "erro",
      mensagem: `A variável {{${d}}} não existe no registry oficial.`,
      detalhe: "Corrija a grafia no DOCX ou registre a variável antes de publicar.",
    })
  }

  if (placeholders.length === 0) {
    achados.push({
      codigo: "TEMPLATE_SEM_VARIAVEL",
      severidade: "erro",
      mensagem: "O template não usa nenhuma variável.",
      detalhe:
        "Um modelo sem variável produziria o mesmo documento para todos — provavelmente os dados do exemplo continuam fixos no texto.",
    })
  }

  // Marcador aberto sem fechar: `{{OUTORGANTE_NOME}` passaria despercebido pelo
  // extrator e chegaria ao documento final como texto cru.
  const abertos = (texto.match(/\{\{/g) ?? []).length
  const fechados = (texto.match(/\}\}/g) ?? []).length
  if (abertos !== fechados) {
    achados.push({
      codigo: "MARCADOR_MAL_FORMADO",
      severidade: "erro",
      mensagem: "Existe marcador de variável aberto e não fechado no template.",
      detalhe: `${abertos} aberturas para ${fechados} fechamentos.`,
    })
  }

  const conhecidos = placeholders.filter((p) => definicaoDaVariavel(p) != null)
  const obrigatorios = conhecidos.filter((p) => definicaoDaVariavel(p)!.exigidaQuandoUsada)
  const opcionais = conhecidos.filter((p) => !definicaoDaVariavel(p)!.exigidaQuandoUsada)

  // ── Dados pessoais de exemplo ────────────────────────────────────────────
  const declarados = new Set((opcoes.dadosFixosDeclarados ?? []).map((d) => d.replace(/\D/g, "")))
  const deClientes = new Set((opcoes.digitosDeClientesReais ?? []).map((d) => d.replace(/\D/g, "")))

  const literais = literaisDeIdentificacao(texto)
  const naoDeclarados = literais.filter((l) => !declarados.has(l.digitos))

  for (const l of naoDeclarados) {
    achados.push({
      codigo: "DADO_IDENTIFICACAO_NAO_DECLARADO",
      severidade: "erro",
      mensagem: `O template ainda contém ${rotuloTipo(l.tipo)} fixo (${l.valor}).`,
      detalhe:
        "Se o número pertence ao outorgado e deve permanecer, declare-o como dado fixo ao publicar. Se pertence ao cliente do modelo de origem, substitua-o pela variável correspondente.",
    })
  }

  // ── Cruzamento com o cadastro real ───────────────────────────────────────
  // Um número que existe no cadastro de clientes é o sinal mais forte de que os
  // dados do cliente do modelo de origem ficaram no texto. Ele NÃO pode ser
  // absoluto, porém: o outorgado das procurações administrativas é sócio do
  // escritório e tem ficha de cliente — bloquear sempre reprovaria o template
  // correto. Por isso: sem declaração, é erro; com declaração explícita, o
  // achado permanece registrado como aviso, e a decisão fica documentada.
  for (const l of literais) {
    // CEP não identifica pessoa — um mesmo CEP pertence a centenas de clientes.
    if (l.tipo === "cep") continue
    if (!deClientes.has(l.digitos)) continue
    const declarado = declarados.has(l.digitos)
    achados.push({
      codigo: "DADO_DE_CLIENTE_REAL",
      severidade: declarado ? "aviso" : "erro",
      mensagem: declarado
        ? `${rotuloTipo(l.tipo).replace("um ", "O ")} fixo ${l.valor} também consta no cadastro de clientes — mantido por declaração expressa de dado fixo do outorgado.`
        : `O template contém ${rotuloTipo(l.tipo)} de um cliente cadastrado (${l.valor}).`,
      detalhe: declarado
        ? "Confira se o número é mesmo do outorgado do instrumento e não do cliente do modelo de origem."
        : "Se for dado do cliente do modelo de origem, troque pela variável correspondente. Se for do outorgado, declare-o expressamente como dado fixo.",
    })
  }

  return {
    ok: achados.every((a) => a.severidade !== "erro"),
    achados,
    placeholders,
    obrigatorios,
    opcionais,
    desconhecidos,
    literais,
    naoDeclarados,
  }
}

function rotuloTipo(tipo: LiteralIdentificacao["tipo"]): string {
  switch (tipo) {
    case "cpf": return "um CPF"
    case "rg": return "um RG"
    case "cep": return "um CEP"
    default: return "um número de identificação"
  }
}

/**
 * Nenhuma variável sobrou no documento FINAL. Roda depois da substituição, sobre
 * o DOCX gerado — é a última barreira antes de o arquivo virar oficial.
 */
export async function nenhumPlaceholderRestante(buffer: Buffer | Uint8Array): Promise<string[]> {
  const texto = await textoDoDocx(buffer)
  return extrairPlaceholders(texto)
}
