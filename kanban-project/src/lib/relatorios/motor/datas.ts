// src/lib/relatorios/motor/datas.ts
//
// DATA DE FILTRO É DIA DO CALENDÁRIO, NÃO INSTANTE.
//
// `new Date("2023-01-01")` é meia-noite em UTC — que no Brasil é 21h do dia 31.
// Filtrar "de 01/01" assim traz três horas do dia anterior e perde as três
// primeiras do último dia. O erro é invisível: o relatório continua devolvendo
// números, só que errados nas bordas — exatamente onde alguém confere.
//
// Aqui "2023-01-01" vira 00:00:00 LOCAL, e o fim do período vira 23:59:59.999
// LOCAL. É assim que o operador lê a pergunta que fez.

/** "2023-01-01" → 1º de janeiro, 00:00:00 no fuso do servidor. */
export function inicioDoDia(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number)
  return new Date(a, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
}

/** "2023-01-31" → 31 de janeiro, 23:59:59.999. `ate` é INCLUSIVO. */
export function fimDoDia(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number)
  return new Date(a, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999)
}

/** Só para exibir: o mesmo dia que o operador escolheu, sem escorregar. */
export function rotuloDeData(iso?: string | null): string {
  if (!iso) return "…"
  return inicioDoDia(iso).toLocaleDateString("pt-BR")
}
