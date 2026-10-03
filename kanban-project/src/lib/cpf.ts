// src/lib/cpf.ts
// ============================================================================
// CPF: normalização e conferência dos dígitos verificadores. Puro (cliente e
// servidor). Nada de regra de negócio aqui — só o algoritmo da Receita.
// ============================================================================

/** Só os dígitos (sem máscara). */
export function soDigitosCpf(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "")
}

/** Formata "12345678909" → "123.456.789-09" (devolve o texto original se não tiver 11 dígitos). */
export function mascararCpf(valor: string | null | undefined): string {
  const d = soDigitosCpf(valor)
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : String(valor ?? "")
}

function digito(base: string, pesoInicial: number): number {
  let soma = 0
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i)
  const resto = (soma * 10) % 11
  return resto === 10 ? 0 : resto
}

/** 11 dígitos, não todos iguais e com os dois dígitos verificadores corretos. */
export function cpfValido(valor: string | null | undefined): boolean {
  const d = soDigitosCpf(valor)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  return digito(d.slice(0, 9), 10) === Number(d[9]) && digito(d.slice(0, 10), 11) === Number(d[10])
}
