// src/lib/coleta/campos.ts
// ============================================================================
// CAMPOS DO FORMULÁRIO PÚBLICO DE COLETA — validação e normalização PURAS
// (cliente e servidor usam a mesma). Os campos são os do cadastro de cliente
// (Contratante/Requerente), sem passaporte, sem CRNM e sem dados de nascimento
// de país/estado/cidade (docs/coleta-de-dados-mandato.md §2).
// ============================================================================

import { cpfValido, soDigitosCpf } from "@/src/lib/cpf"

export const PAPEIS_COLETA = ["REQUERENTE", "CONTRATANTE", "AMBOS"] as const
export type PapelColeta = (typeof PAPEIS_COLETA)[number]

export const TIPOS_ARQUIVO_COLETA = ["IDENTIDADE", "COMPROVANTE_ENDERECO"] as const
export type TipoArquivoColeta = (typeof TIPOS_ARQUIVO_COLETA)[number]

export const ROTULO_TIPO_ARQUIVO: Record<TipoArquivoColeta, string> = {
  IDENTIDADE: "RG ou CNH",
  COMPROVANTE_ENDERECO: "Comprovante de endereço",
}

/** Categoria do anexo de cliente (`AnexoRequerente/Contratante.categoria`) que o tipo vira na confirmação. */
export const CATEGORIA_ANEXO_DO_TIPO: Record<TipoArquivoColeta, string> = {
  IDENTIDADE: "RG",
  COMPROVANTE_ENDERECO: "COMPROVANTE_ENDERECO",
}

/** Mesmas opções do cadastro de cliente (contratantes-tabela.tsx). */
export const SEXO_OPCOES = ["Masculino", "Feminino", "Outro"] as const
export const ESTADO_CIVIL_OPCOES = ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)", "União Estável", "Separado(a)"] as const
export const NACIONALIDADE_OPCOES = ["Brasileiro(a)", "Português(a)", "Italiano(a)", "Espanhol(a)", "Alemão(ã)", "Americano(a)", "Outro"] as const

export const CONSENTIMENTO_VERSAO = "2026-10-03"
export const TEXTO_CONSENTIMENTO =
  "Autorizo a Discovery Assessoria a usar os dados e os documentos que estou enviando para analisar e conduzir " +
  "o meu processo (e o das pessoas que cadastrei, com a autorização delas). Sei que posso pedir a exclusão desses dados."

/** Limites de arquivo (iguais aos da rota de upload comum, mais restritos em tipo). */
export const MAX_BYTES_ARQUIVO_COLETA = 10 * 1024 * 1024
export const MAX_ARQUIVOS_POR_TIPO = 3
export const MIMES_ARQUIVO_COLETA: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"])

export interface DadosColeta {
  nome: string
  cpf: string
  rg: string | null
  dataNascimento: string | null // yyyy-mm-dd
  sexo: string | null
  estadoCivil: string | null
  nacionalidade: string | null
  telefone: string | null
  email: string | null
  pais: string
  cep: string | null
  endereco: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
}

export type ErrosColeta = Partial<Record<keyof DadosColeta | "papel" | "consentimento", string>>

const texto = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.trim() : ""
  return s ? s.slice(0, max) : null
}

function dataValida(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 10) : ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  if (d.getTime() > Date.now() || s < "1900-01-01") return null
  return s
}

/** Valida e normaliza o corpo do envio. `ok: false` traz o erro por campo (mensagem para o cliente). */
export function validarDadosColeta(bruto: Record<string, unknown>):
  | { ok: true; dados: DadosColeta }
  | { ok: false; erros: ErrosColeta } {
  const erros: ErrosColeta = {}

  const nome = texto(bruto.nome, 100)
  if (!nome) erros.nome = "Informe o nome completo."

  const cpf = soDigitosCpf(bruto.cpf as string)
  if (!cpf) erros.cpf = "Informe o CPF."
  else if (!cpfValido(cpf)) erros.cpf = "CPF inválido. Confira os números."

  const dnRaw = typeof bruto.dataNascimento === "string" ? bruto.dataNascimento.trim() : ""
  const dataNascimento = dnRaw ? dataValida(dnRaw) : null
  if (dnRaw && !dataNascimento) erros.dataNascimento = "Data de nascimento inválida."

  const emailRaw = texto(bruto.email, 100)
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) erros.email = "E-mail inválido."

  const oneOf = (v: unknown, lista: readonly string[], campo: keyof DadosColeta, msg: string) => {
    const s = texto(v, 50)
    if (s && !lista.includes(s)) { erros[campo] = msg; return null }
    return s
  }
  const sexo = oneOf(bruto.sexo, SEXO_OPCOES, "sexo", "Escolha uma das opções.")
  const estadoCivil = oneOf(bruto.estadoCivil, ESTADO_CIVIL_OPCOES, "estadoCivil", "Escolha uma das opções.")
  const nacionalidade = oneOf(bruto.nacionalidade, NACIONALIDADE_OPCOES, "nacionalidade", "Escolha uma das opções.")

  if (Object.keys(erros).length > 0 || !nome) return { ok: false, erros }

  return {
    ok: true,
    dados: {
      nome: nome!,
      cpf,
      rg: texto(bruto.rg, 20),
      dataNascimento,
      sexo,
      estadoCivil,
      nacionalidade,
      telefone: texto(bruto.telefone, 20),
      email: emailRaw,
      pais: texto(bruto.pais, 50) ?? "Brasil",
      cep: texto(bruto.cep, 15),
      endereco: texto(bruto.endereco, 200),
      numero: texto(bruto.numero, 20),
      complemento: texto(bruto.complemento, 100),
      bairro: texto(bruto.bairro, 100),
      cidade: texto(bruto.cidade, 100),
      estado: texto(bruto.estado, 50),
    },
  }
}

export function papelValido(v: unknown): v is PapelColeta {
  return typeof v === "string" && (PAPEIS_COLETA as readonly string[]).includes(v)
}

export function tipoArquivoValido(v: unknown): v is TipoArquivoColeta {
  return typeof v === "string" && (TIPOS_ARQUIVO_COLETA as readonly string[]).includes(v)
}
