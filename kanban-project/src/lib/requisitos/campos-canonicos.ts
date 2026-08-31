// src/lib/requisitos/campos-canonicos.ts
//
// OS CAMPOS QUE O DISCOVERY REALMENTE TEM.
//
// ─── POR QUE ISTO É CÓDIGO E NÃO CADASTRO ───────────────────────────────────
// Este arquivo NÃO é uma lista de negócio: é o espelho do SCHEMA. Um campo só
// pode estar aqui porque existe uma coluna de verdade guardando aquele valor —
// e é por isso que ele não vira tabela administrável: cadastrar "e-mail" numa
// tela não faz a coluna existir, e deixar alguém cadastrar um campo inexistente
// produziria requisito que nunca pode ser satisfeito.
//
// O QUE É CADASTRO é a OBRIGATORIEDADE — "para esta rota, e-mail é exigido" —, e
// essa vive em `RequisitoCadastral`, no Gerenciamento. Aqui mora só a resposta a
// "onde este dado está guardado e o que significa estar preenchido".
//
// ─── O QUE ESTE ARQUIVO NÃO FAZ ─────────────────────────────────────────────
// Não guarda valor. O e-mail continua em `Requerente.email`; ninguém copia nada
// para uma tabela de relatório. Também não é EAV: as entidades continuam com
// suas colunas, e isto é apenas o mapa de leitura.

/** Entidade que É DONA do valor. O requisito aponta para o dono, nunca copia. */
export type EntidadeProprietaria = "Requerente" | "Contratante" | "Pessoa"

export interface CampoCanonico {
  /** Chave estável usada pelo cadastro de requisitos. Nunca renomear. */
  key: string
  entidade: EntidadeProprietaria
  /** Coluna(s) que compõem o dado. Endereço precisa de várias. */
  colunas: string[]
  rotulo: string
  /** O que "preenchido" significa para ESTE campo. */
  natureza: "texto" | "email" | "telefone" | "cpf" | "data" | "endereco"
  ajuda?: string
}

/**
 * SATISFEITO NÃO É "NÃO É NULO".
 *
 * `email = "x"` não é e-mail; endereço com só a cidade não é endereço. Cada
 * natureza carrega a sua regra, e ela mora AQUI para que operação e relatório
 * respondam a mesma pergunta — duas validações diferentes para o mesmo campo é
 * como o sistema passa a discordar de si mesmo.
 */
export function valorSatisfaz(campo: CampoCanonico, registro: Record<string, unknown>): boolean {
  const texto = (c: string) => {
    const v = registro[c]
    return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim()
  }

  switch (campo.natureza) {
    case "email": {
      const v = texto(campo.colunas[0])
      // Deliberadamente conservador: exige parte local, arroba, domínio com
      // ponto e TLD de 2+ letras. Não tenta ser RFC 5322 — tenta recusar o que
      // claramente não é endereço de e-mail utilizável.
      return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(v) && /\.[a-zA-Z]{2,}$/.test(v)
    }
    case "telefone": {
      // Só os dígitos importam. 10 = fixo com DDD, 11 = celular; acima disso
      // cabe internacional. Abaixo de 10 não é telefone discável no Brasil.
      const digitos = texto(campo.colunas[0]).replace(/\D/g, "")
      return digitos.length >= 10 && digitos.length <= 15
    }
    case "cpf": {
      const d = texto(campo.colunas[0]).replace(/\D/g, "")
      if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
      // Dígitos verificadores: sem isso, "12345678901" passaria por CPF.
      const dv = (ate: number) => {
        let soma = 0
        for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i)
        const r = (soma * 10) % 11
        return r === 10 ? 0 : r
      }
      return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
    }
    case "data": {
      const v = registro[campo.colunas[0]]
      if (v == null) return false
      const d = v instanceof Date ? v : new Date(String(v))
      return !Number.isNaN(d.getTime())
    }
    case "endereco":
      // Endereço é CONJUNTO. Ter só a cidade não é ter endereço — e é
      // exatamente esse o caso que o relatório de "dados incompletos" precisa
      // enxergar. Todas as colunas declaradas precisam estar preenchidas.
      return campo.colunas.every((c) => texto(c).length > 0)
    case "texto":
    default:
      return texto(campo.colunas[0]).length > 0
  }
}

/**
 * O CATÁLOGO. Cada entrada foi conferida contra o schema — não há campo aqui
 * que não exista como coluna, e nenhum valor é inventado.
 */
export const CAMPOS_CANONICOS: CampoCanonico[] = [
  { key: "requerente.nome",           entidade: "Requerente", colunas: ["nome"],           rotulo: "Nome",                natureza: "texto" },
  { key: "requerente.cpf",            entidade: "Requerente", colunas: ["cpf"],            rotulo: "CPF",                 natureza: "cpf" },
  { key: "requerente.rg",             entidade: "Requerente", colunas: ["rg"],             rotulo: "RG (número)",         natureza: "texto",
    ajuda: "É o NÚMERO no cadastro — não o documento anexado. O documento é requisito documental." },
  { key: "requerente.dataNascimento", entidade: "Requerente", colunas: ["dataNascimento"], rotulo: "Data de nascimento",  natureza: "data" },
  { key: "requerente.sexo",           entidade: "Requerente", colunas: ["sexo"],           rotulo: "Sexo",                natureza: "texto" },
  { key: "requerente.estadoCivil",    entidade: "Requerente", colunas: ["estadoCivil"],    rotulo: "Estado civil",        natureza: "texto" },
  { key: "requerente.email",          entidade: "Requerente", colunas: ["email"],          rotulo: "E-mail",              natureza: "email" },
  { key: "requerente.telefone",       entidade: "Requerente", colunas: ["telefone"],       rotulo: "Telefone",            natureza: "telefone" },
  {
    key: "requerente.endereco", entidade: "Requerente",
    colunas: ["endereco", "numero", "bairro", "cidade", "estado", "cep"],
    rotulo: "Endereço completo", natureza: "endereco",
    ajuda: "Satisfeito só quando logradouro, número, bairro, cidade, estado e CEP estão preenchidos.",
  },
  { key: "requerente.cep",         entidade: "Requerente", colunas: ["cep"],         rotulo: "CEP",                natureza: "texto" },
  { key: "requerente.passaporte",  entidade: "Requerente", colunas: ["passaporte"],  rotulo: "Passaporte (número)", natureza: "texto" },
  { key: "requerente.crnm",        entidade: "Requerente", colunas: ["crnm"],        rotulo: "CRNM (número)",      natureza: "texto" },

  { key: "contratante.nome",     entidade: "Contratante", colunas: ["nome"],     rotulo: "Nome do contratante", natureza: "texto" },
  { key: "contratante.email",    entidade: "Contratante", colunas: ["email"],    rotulo: "E-mail do contratante", natureza: "email" },
  { key: "contratante.telefone", entidade: "Contratante", colunas: ["telefone"], rotulo: "Telefone do contratante", natureza: "telefone" },
]

export const campoPorChave = (k: string) => CAMPOS_CANONICOS.find((c) => c.key === k) ?? null

/** Opções para o seletor do cadastro — derivadas do catálogo, nunca digitadas. */
export const OPCOES_DE_CAMPO = CAMPOS_CANONICOS.map((c) => ({
  valor: c.key,
  label: `${c.rotulo} · ${c.entidade}`,
}))
