// lib/operacional/torre-pais.ts
// ============================================================================
// O PAÍS DO CABEÇALHO FILTRA TODAS AS ABAS — Torre nova, Etapa A (01/10/2026). PURO: a tela e o teste usam as MESMAS funções.
//
// Cada aba recorta pelo país de um jeito natural ao seu grain:
//   • Tarefas · Terceiros · Visão geral (KPIs, frase, agenda) — pela linha de tarefa (`LinhaDaTorre.pais`);
//   • Radar · Processos — pelo processo (`ProcessoDaTorre.pais`);
//   • Precisa de você — pelo processo da decisão (`itensDoPais`): decisão sem processo (ex.: "Carga" de uma pessoa) não é de país
//     nenhum e some quando um país é escolhido;
//   • Equipe — o servidor recorta as MESMAS linhas por país antes de somar a carga (`GET /api/torre/equipe?pais=`).
// O país é identificado pelo ROTULO do cadastro (`CatalogoPais.countryLabel`), o mesmo que a linha e o processo carregam.
// ============================================================================

/** Só as decisões do país: cada uma vale pelo país do seu processo; sem processo (ou de outro país) fica de fora. Sem país escolhido → todas. */
export function itensDoPais<T extends { processoId: number | null }>(
  itens: T[], paisRotulo: string | null, paisDoProcesso: ReadonlyMap<number, string | null>,
): T[] {
  if (!paisRotulo) return itens
  return itens.filter((i) => i.processoId != null && paisDoProcesso.get(i.processoId) === paisRotulo)
}

/** O país de cada processo, juntando a lista de processos e as linhas de tarefa (a 1ª fonte vence). */
export function mapaDePaisPorProcesso(
  processos: Array<{ processoId: number; pais: string | null }>, linhas: Array<{ processoId: number | null; pais: string | null }>,
): Map<number, string | null> {
  const m = new Map<number, string | null>()
  for (const p of processos) m.set(p.processoId, p.pais)
  for (const l of linhas) if (l.processoId != null && !m.has(l.processoId)) m.set(l.processoId, l.pais)
  return m
}

/** Quantos processos ativos há em cada país (para os botões "Itália 280"). A chave é o rótulo. */
export function contagemDeProcessosPorPais(processos: Array<{ pais: string | null }>): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of processos) if (p.pais) m.set(p.pais, (m.get(p.pais) ?? 0) + 1)
  return m
}
