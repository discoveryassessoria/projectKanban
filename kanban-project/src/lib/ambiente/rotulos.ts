// src/lib/ambiente/rotulos.ts
//
// Rótulos humanos do ambiente. Ficam separados do registro de países porque são
// decisão de apresentação, não de tema.

/**
 * "Família Rossi" a partir do nome do processo.
 *
 * O nome do processo é o do requerente principal ("Giulia Romano"), então a
 * família é o último sobrenome — ignorando partículas (de, da, dos, di, del,
 * van, von…), que sozinhas não identificam ninguém.
 */
const PARTICULAS = new Set([
  "de", "da", "do", "das", "dos", "di", "del", "della", "dello", "dei", "degli",
  "van", "von", "der", "den", "la", "le", "les", "du", "des", "y", "e",
])

export function familiaDoProcesso(nome: string | null | undefined): string | null {
  if (!nome) return null
  const partes = nome
    .trim()
    .split(/\s+/)
    .filter(p => p.length > 1 && !PARTICULAS.has(p.toLowerCase()))
  if (partes.length < 2) return null
  return `Família ${partes[partes.length - 1]}`
}
