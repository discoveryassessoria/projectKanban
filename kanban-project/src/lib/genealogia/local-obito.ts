// src/lib/genealogia/local-obito.ts
// ============================================================================
// LOCAL DO ÓBITO EM COLUNAS PRÓPRIAS (07/10/2026) — PURO. Antes o local do falecimento morava no texto único `Pessoa.local_emigracao` («Santos-SP (1º Subd.)»),
// que TAMBÉM serve para emigração. Agora: `local_obito` (cidade), `estado_obito`, `pais_obito`. Este módulo lê o texto antigo e o formulário («Cidade - Estado»).
//   • `lerLocalDeObito`  — texto → { cidade, estado } quando dá para ler com SEGURANÇA; `null` quando não dá (nunca chuta).
//   • `podeLerComoObito` — o texto antigo só vale como local de óbito se a pessoa FALECEU e NÃO tem dado de emigração (senão pode ser local de partida).
// ============================================================================

const UFS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"])

/** «Santos-SP (1º Subd.)» → { cidade: «Santos (1º Subd.)», estado: «SP» }. «Santos» → { cidade: «Santos», estado: null }. Ilegível → `null`. */
export function lerLocalDeObito(texto: string | null | undefined): { cidade: string; estado: string | null } | null {
  const bruto = (texto ?? "").trim().replace(/\s+/g, " ")
  if (!bruto) return null
  const paren = /\s*(\([^)]*\))\s*$/.exec(bruto)
  const semParen = paren ? bruto.slice(0, paren.index).trim() : bruto
  const complemento = paren ? ` ${paren[1]}` : ""
  const com = /^(.+?)\s*[-–/,]\s*([A-Za-z]{2})$/.exec(semParen)
  if (com && UFS.has(com[2].toUpperCase())) {
    const cidade = com[1].trim()
    if (!/^[\p{L}][\p{L}' .]*$/u.test(cidade)) return null
    return { cidade: cidade + complemento, estado: com[2].toUpperCase() }
  }
  // Só uma cidade (letras, espaço, apóstrofo, ponto) — sem número, vírgula nem hífen ambíguo.
  if (/^[\p{L}][\p{L}' .]*$/u.test(semParen)) return { cidade: semParen + complemento, estado: null }
  return null
}

/** O texto antigo só pode ser lido como local de óbito se a pessoa faleceu e não tem NENHUM dado de emigração/imigração. */
export function podeLerComoObito(p: { vivo?: boolean | null; data_obito?: Date | string | null; data_emigracao?: Date | string | null; porto_embarque?: string | null; data_chegada?: Date | string | null; porto_chegada?: string | null; pais_destino?: string | null; navio?: string | null }): boolean {
  const faleceu = p.vivo === false || !!p.data_obito
  const emigrou = !!(p.data_emigracao || p.porto_embarque || p.data_chegada || p.porto_chegada || p.pais_destino || p.navio)
  return faleceu && !emigrou
}

/** Para MOSTRAR (painel da pessoa): «Cidade, Estado, País» do óbito, na mesma ordem do nascimento e do casamento; sem nenhum dos três, o texto antigo de `textoDoLocalDeObito`. */
export function localCompletoDoObito(p: { local_obito?: string | null; estado_obito?: string | null; pais_obito?: string | null; local_emigracao?: string | null }): string {
  const partes = [p.local_obito, p.estado_obito, p.pais_obito].map((v) => v?.trim()).filter(Boolean)
  return partes.length ? partes.join(", ") : textoDoLocalDeObito(p)
}

/** Para o formulário («Cidade - Estado»): junta cidade e estado do óbito. */
export function textoDoLocalDeObito(p: { local_obito?: string | null; estado_obito?: string | null; local_emigracao?: string | null }): string {
  if (p.local_obito) return p.estado_obito ? `${p.local_obito}-${p.estado_obito}` : p.local_obito
  return p.local_emigracao ?? ""
}

/** Do formulário para as colunas: «Santos-SP» → { local_obito: «Santos», estado_obito: «SP» }; texto ilegível fica inteiro na cidade (nada se perde). */
export function colunasDoLocalDeObito(texto: string | null | undefined): { local_obito: string | null; estado_obito: string | null } {
  const t = (texto ?? "").trim()
  if (!t) return { local_obito: null, estado_obito: null }
  const l = lerLocalDeObito(t)
  return l ? { local_obito: l.cidade.slice(0, 100), estado_obito: l.estado } : { local_obito: t.slice(0, 100), estado_obito: null }
}
