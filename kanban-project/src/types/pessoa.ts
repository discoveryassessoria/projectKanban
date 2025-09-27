import type { Pessoa, Uniao } from "@prisma/client"

export interface PessoaWithRelations extends Pessoa {
  pai?: Pessoa
  mae?: Pessoa
  filhos?: Pessoa[]
  filhosComoPai?: Pessoa[]
  filhosComoMae?: Pessoa[]
  unioesComoPessoa1?: (Uniao & {
    pessoa2?: Pessoa
  })[]
  unioesComoPessoa2?: (Uniao & {
    pessoa1?: Pessoa
  })[]
}

// Tipo para união com pessoas carregadas
export interface UniaoWithPessoas extends Uniao {
  pessoa1?: Pessoa
  pessoa2?: Pessoa
}
