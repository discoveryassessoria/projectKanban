// src/services/modelos/outorgante.ts
//
// RESOLUÇÃO DO OUTORGANTE — os dados variáveis vêm do CADASTRO, e de mais lugar
// nenhum.
//
// Não se lê observação, não se lê metadata, não se lê título de processo, não se
// lê arquivo anterior e não se aceita nome digitado na hora. O outorgante é uma
// linha do cadastro do cliente (Contratante ou Requerente) e, quando essa linha
// já aponta para a identidade humana única (CP-1), a Pessoa complementa o que só
// ela guarda — profissão e sexo.
//
// O QUE FALTA BLOQUEIA. O checklist devolvido aqui é o mesmo que a tela mostra e
// o mesmo que o motor de geração consulta: uma fonte, duas leituras. Não existe
// caminho em que a tela diga "ok" e o servidor gere com campo vazio.

import type { Prisma } from "@prisma/client"
import { prisma } from "@/src/lib/prisma"
import {
  VARIAVEIS_MODELO,
  concordarPortador,
  dataPorExtenso,
  definicaoDaVariavel,
  flexionar,
  formatarCep,
  formatarCpf,
  generoGramatical,
  montarLinhaEndereco,
  type GeneroGramatical,
} from "@/src/lib/documentos/modelos/variaveis"

export type PapelOutorgante = "contratante" | "requerente"

export interface ReferenciaOutorgante {
  papel: PapelOutorgante
  id: number
}

/** Dados brutos do cadastro, antes de qualquer formatação. */
export interface CadastroOutorgante {
  papel: PapelOutorgante
  id: number
  publicCode: string | null
  nome: string
  cpf: string | null
  rg: string | null
  sexo: string | null
  estadoCivil: string | null
  nacionalidade: string | null
  profissao: string | null
  endereco: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  cep: string | null
  pais: string | null
  pessoaId: number | null
}

const SELECAO = {
  id: true,
  publicCode: true,
  nome: true,
  cpf: true,
  rg: true,
  sexo: true,
  estadoCivil: true,
  nacionalidade: true,
  endereco: true,
  numero: true,
  complemento: true,
  bairro: true,
  cidade: true,
  estado: true,
  cep: true,
  pais: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } },
  personId: true,
  pessoa: { select: { id: true, profissao: true, sexo: true } },
} as const

export async function carregarCadastroOutorgante(
  ref: ReferenciaOutorgante,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CadastroOutorgante | null> {
  const linha =
    ref.papel === "contratante"
      ? await db.contratante.findUnique({ where: { id: ref.id }, select: SELECAO })
      : await db.requerente.findUnique({ where: { id: ref.id }, select: SELECAO })

  if (!linha) return null

  return {
    papel: ref.papel,
    id: linha.id,
    publicCode: linha.publicCode,
    nome: linha.nome,
    cpf: linha.cpf,
    rg: linha.rg,
    // O papel é a fonte primária do sexo; a identidade única cobre o papel antigo
    // que nasceu sem o campo. Nunca se infere pelo nome.
    sexo: linha.sexo ?? linha.pessoa?.sexo ?? null,
    estadoCivil: linha.estadoCivil,
    nacionalidade: linha.nacionalidade,
    // Profissão só existe na identidade humana — o papel não a guarda.
    profissao: linha.pessoa?.profissao ?? null,
    endereco: linha.endereco,
    numero: linha.numero,
    complemento: linha.complemento,
    bairro: linha.bairro,
    cidade: linha.cidade,
    estado: linha.estado,
    cep: linha.cep,
    pais: linha.pais,
    pessoaId: linha.personId ?? null,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ATO DE EMISSÃO
// ════════════════════════════════════════════════════════════════════════════

export interface AtoDeEmissao {
  localEmissao: string
  /** Data da emissão em ISO (yyyy-mm-dd) ou Date. */
  dataEmissao: string | Date
}

// ════════════════════════════════════════════════════════════════════════════
// CHECKLIST
// ════════════════════════════════════════════════════════════════════════════

export type EstadoCampo = "valido" | "ausente" | "invalido" | "nao_aplicavel"

export interface ItemChecklist {
  chave: string
  rotulo: string
  estado: EstadoCampo
  /** Valor já resolvido (formatado/flexionado). Vazio quando ausente. */
  valor: string
  /** Onde corrigir, quando falta. */
  origem: string
  /** Explicação curta quando ausente ou inválido. */
  motivo?: string
}

export interface ResolucaoOutorgante {
  cadastro: CadastroOutorgante
  genero: GeneroGramatical | null
  /** Valores prontos para o motor, por chave de variável. */
  valores: Record<string, string>
  checklist: ItemChecklist[]
  /** Chaves exigidas pelo template que estão ausentes ou inválidas. */
  pendencias: ItemChecklist[]
  podeGerar: boolean
}

/**
 * Resolve TODAS as variáveis conhecidas e devolve o checklist filtrado pelo que
 * o template realmente usa.
 *
 * `variaveisDoTemplate` vem da VERSÃO PUBLICADA — é ela que decide o que é
 * obrigatório. Um modelo que não cita profissão não bloqueia por falta de
 * profissão; o mesmo cadastro serve aos dois modelos sem regra duplicada.
 */
export function resolverOutorgante(args: {
  cadastro: CadastroOutorgante
  ato: AtoDeEmissao
  variaveisDoTemplate: string[]
}): ResolucaoOutorgante {
  const { cadastro, ato } = args
  const genero = generoGramatical(cadastro.sexo)

  const dataEmissao =
    ato.dataEmissao instanceof Date ? ato.dataEmissao : dataLocalDeIso(String(ato.dataEmissao))

  const bruto: Record<string, string> = {
    OUTORGANTE_NOME_COMPLETO: (cadastro.nome ?? "").trim(),
    ASSINATURA_NOME: (cadastro.nome ?? "").trim(),
    // Nacionalidade, estado civil e profissão entram no MEIO da qualificação
    // ("Fulana, brasileira, casada, portadora…"). O cadastro guarda a forma de
    // formulário, capitalizada ("Brasileiro(a)"); o instrumento pede o adjetivo
    // comum, em minúscula. Flexionar sem corrigir a caixa produziria "Fulana,
    // Brasileira, Casada" — gramaticalmente errado no corpo da frase.
    OUTORGANTE_NACIONALIDADE: genero ? adjetivoNoTexto(flexionar(cadastro.nacionalidade, genero)) : "",
    OUTORGANTE_ESTADO_CIVIL: genero ? adjetivoNoTexto(flexionar(cadastro.estadoCivil, genero)) : "",
    OUTORGANTE_PROFISSAO: genero ? adjetivoNoTexto(flexionar(cadastro.profissao, genero)) : "",
    OUTORGANTE_PORTADOR: genero ? concordarPortador(genero) : "",
    OUTORGANTE_RG: (cadastro.rg ?? "").trim(),
    OUTORGANTE_RG_ORGAO: "",
    OUTORGANTE_CPF: formatarCpf(cadastro.cpf),
    OUTORGANTE_LOGRADOURO: (cadastro.endereco ?? "").trim(),
    OUTORGANTE_NUMERO: (cadastro.numero ?? "").trim(),
    OUTORGANTE_COMPLEMENTO: (cadastro.complemento ?? "").trim(),
    OUTORGANTE_BAIRRO: (cadastro.bairro ?? "").trim(),
    OUTORGANTE_CIDADE: (cadastro.cidade ?? "").trim(),
    OUTORGANTE_UF: (cadastro.estado ?? "").trim(),
    OUTORGANTE_CEP: formatarCep(cadastro.cep),
    OUTORGANTE_PAIS: (cadastro.pais ?? "").trim(),
    OUTORGANTE_ENDERECO_LINHA: montarLinhaEndereco({
      logradouro: cadastro.endereco,
      numero: cadastro.numero,
      complemento: cadastro.complemento,
      bairro: cadastro.bairro,
      cidade: cadastro.cidade,
      uf: cadastro.estado,
      cep: cadastro.cep,
    }),
    LOCAL_EMISSAO: (ato.localEmissao ?? "").trim(),
    DATA_EMISSAO_EXTENSO: dataEmissao ? dataPorExtenso(dataEmissao) : "",
  }

  const usadas = new Set(args.variaveisDoTemplate)

  const checklist: ItemChecklist[] = VARIAVEIS_MODELO.map((def) => {
    const valor = bruto[def.chave] ?? ""
    const usada = usadas.has(def.chave)

    if (!usada) {
      return {
        chave: def.chave,
        rotulo: def.rotulo,
        estado: "nao_aplicavel" as EstadoCampo,
        valor,
        origem: def.campo,
        motivo: "Este modelo não usa esta informação.",
      }
    }

    // Gênero indeterminado invalida TUDO que depende de flexão. O documento não
    // pode sair concordando errado, e não há como acertar sem o dado.
    const dependeDeGenero =
      def.chave === "OUTORGANTE_NACIONALIDADE" ||
      def.chave === "OUTORGANTE_ESTADO_CIVIL" ||
      def.chave === "OUTORGANTE_PROFISSAO" ||
      def.chave === "OUTORGANTE_PORTADOR"

    if (dependeDeGenero && !genero) {
      return {
        chave: def.chave,
        rotulo: def.rotulo,
        estado: "invalido" as EstadoCampo,
        valor: "",
        origem: "sexo",
        motivo:
          "Sem o sexo no cadastro não há como flexionar o termo. O sistema não infere gênero pelo nome.",
      }
    }

    if (!valor) {
      const campoInexistente = def.chave === "OUTORGANTE_RG_ORGAO"
      return {
        chave: def.chave,
        rotulo: def.rotulo,
        estado: (def.exigidaQuandoUsada ? "ausente" : "nao_aplicavel") as EstadoCampo,
        valor: "",
        origem: def.campo,
        motivo: campoInexistente
          ? "O cadastro do cliente ainda não tem campo para órgão expedidor."
          : def.exigidaQuandoUsada
            ? "Preencha no cadastro do cliente."
            : "Sem valor no cadastro — o modelo tolera a ausência.",
      }
    }

    return {
      chave: def.chave,
      rotulo: def.rotulo,
      estado: "valido" as EstadoCampo,
      valor,
      origem: def.campo,
    }
  })

  const pendencias = checklist.filter(
    (i) => (i.estado === "ausente" || i.estado === "invalido") && usadas.has(i.chave),
  )

  // Só entram no motor as variáveis que o template usa E têm valor. Uma variável
  // usada e sem valor não vira string vazia: ela impede a geração.
  const valores: Record<string, string> = {}
  for (const chave of usadas) {
    const def = definicaoDaVariavel(chave)
    if (!def) continue
    const valor = bruto[chave] ?? ""
    if (!valor && def.exigidaQuandoUsada) continue
    valores[chave] = valor
  }

  return {
    cadastro,
    genero,
    valores,
    checklist,
    pendencias,
    podeGerar: pendencias.length === 0,
  }
}

/**
 * Adjetivo de qualificação como ele aparece no corpo do instrumento: minúsculo.
 *
 * Não mexe em nome próprio — só é aplicado às três variáveis que são adjetivos
 * comuns (nacionalidade, estado civil, profissão).
 */
function adjetivoNoTexto(termo: string): string {
  return termo.toLocaleLowerCase("pt-BR")
}

/**
 * Data local a partir de "yyyy-mm-dd".
 *
 * `new Date("2026-08-05")` é meia-noite UTC — em São Paulo isso é dia 4, e a
 * procuração sairia com a data do dia anterior.
 */
export function dataLocalDeIso(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
