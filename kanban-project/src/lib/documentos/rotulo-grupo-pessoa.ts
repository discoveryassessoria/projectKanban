// src/lib/documentos/rotulo-grupo-pessoa.ts
// ============================================================================
// SUBTÍTULO DO CABEÇALHO DE PESSOA NA ABA DOCUMENTOS — função pura.
// Três fontes diziam a mesma coisa: a geração (derivada da linhagem), a
// linhagem ("Linha reta"/"Fora da linha") e o papel (que, na linha reta, JÁ é
// "Geração N" — ver rota /documentos). Resultado: "Geração 1 · Linha reta ·
// Geração 1". Cada informação aparece UMA vez, na ordem em que foi dita.
// ============================================================================
export function rotuloGrupoPessoa(input: { lineage: string; generation: number | string; role: string }): string {
  const geracao = input.lineage === "Linha reta" ? `Geração ${input.generation}` : ""
  const partes = [geracao, input.lineage, input.role].map((p) => p.trim()).filter((p) => p && p !== "—")
  const vistas = new Set<string>()
  const unicas: string[] = []
  for (const p of partes) {
    const k = p.toLowerCase()
    if (vistas.has(k)) continue
    vistas.add(k)
    unicas.push(p)
  }
  return unicas.join(" · ")
}
