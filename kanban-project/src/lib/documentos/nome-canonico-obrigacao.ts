// src/lib/documentos/nome-canonico-obrigacao.ts
//
// NOME E IDENTIDADE DA OBRIGAÇÃO DOCUMENTAL.
//
// O DEFEITO QUE ISTO CORRIGE
// --------------------------
// A regra GEN-CIVIL-NASC declara `requisitoNome = "Certidão de Nascimento"` e
// `documentosAceitos = ["IT - NAS"]`, cujo Tipo de Documento no Cadastro Mestre
// se chama "Certidão de nascimento - Inteiro Teor". A tela exibia os DOIS — o
// rótulo digitado na regra e o nome canônico do documento — como se fossem duas
// obrigações da mesma pessoa.
//
// `requisitoNome` é texto administrativo da regra. Ele nunca foi identidade de
// documento, e é isso que esta camada passa a impedir.
//
// A REGRA
// -------
// Regra que aponta para UM único documento aceito ⇒ o nome exibido vem
// exclusivamente do Cadastro Mestre do Tipo de Documento.
//
// Regra com VÁRIOS documentos aceitos (grupo alternativo: RG ou CNH) ⇒ aí sim o
// `requisitoNome` é o rótulo legítimo, porque nomeia o REQUISITO e não um
// documento: "Documento de identificação" não é o nome de nenhum tipo. Trocá-lo
// pelo nome de um dos aceitos afirmaria que só aquele serve.
//
// IDENTIDADE
// ----------
// Nenhuma deduplicação por texto. A obrigação é identificada por IDs —
// processo, pessoa, tipo documental canônico e ciclo.

/** Códigos de documento aceitos por uma regra, como o snapshot os grava. */
export function codigosAceitos(documentosAceitos: unknown): string[] {
  if (!Array.isArray(documentosAceitos)) return []
  // `null`/`undefined` viram "null"/"undefined" em String() — descarta ANTES de
  // converter, senão lixo do snapshot contaria como documento aceito e mudaria a
  // decisão "um aceito × vários aceitos".
  return documentosAceitos
    .filter((c): c is string | number => c != null && c !== "")
    .map((c) => String(c).trim())
    .filter(Boolean)
}

/**
 * Nome exibido da obrigação documental.
 *
 * `nomePorCode` resolve o código do documento aceito para o nome do Cadastro
 * Mestre. Quando ele não resolve (cadastro incompleto), cai no nome do
 * ItemCatalogo — que também é cadastro, nunca no texto da regra.
 */
export function nomeCanonicoDaObrigacao(args: {
  documentosAceitos: unknown
  requisitoNome: string | null | undefined
  itemCatalogoNome: string | null | undefined
  nomePorCode: (code: string) => string | null | undefined
}): string | null {
  const aceitos = codigosAceitos(args.documentosAceitos)
  const requisito = typeof args.requisitoNome === "string" && args.requisitoNome.trim() ? args.requisitoNome.trim() : null
  const item = args.itemCatalogoNome?.trim() || null

  // UM documento aceito: o documento TEM nome próprio no Cadastro Mestre, e é ele.
  if (aceitos.length === 1) {
    const canonico = args.nomePorCode(aceitos[0])?.trim()
    if (canonico) return canonico
    return item ?? requisito
  }

  // Vários (ou nenhum) aceitos: o requisito nomeia a EXIGÊNCIA, não um documento.
  return requisito ?? item
}

/**
 * Identidade canônica da obrigação — só IDs, nunca texto.
 *
 * Duas linhas com esta mesma identidade são a MESMA obrigação, ainda que uma
 * venha da NecessidadeDocumental e a outra do Documento que a atende.
 */
export function identidadeDaObrigacao(a: {
  processoId: number
  pessoaId: number | null
  documentTypeId: number | null
  ciclo?: number | null
}): string | null {
  if (a.pessoaId == null || a.documentTypeId == null) return null
  return `obg:${a.processoId}:${a.pessoaId}:${a.documentTypeId}:c${a.ciclo ?? 1}`
}
