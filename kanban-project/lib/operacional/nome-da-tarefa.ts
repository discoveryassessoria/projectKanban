// lib/operacional/nome-da-tarefa.ts
// ============================================================================
// O NOME DA TAREFA É O DO TRABALHO — NUNCA O DA ETAPA.
//
// Em produção nasceu uma tarefa chamada "Solicitar certidão". Esse é o nome do
// PRIMEIRO PASSO de um workflow de cinco. Na fila, ela mentia duas vezes: dizia
// que o trabalho era "solicitar" (quando é obter a certidão) e sugeria que o
// modelo etapa-é-tarefa tinha voltado — logo depois de tê-lo eliminado.
//
// A causa: `garantirTarefaDePasso` batizava a tarefa com o título do snapshot
// do passo, porque no desenho antigo a tarefa ERA o passo. Sobreviveu à
// mudança de identidade.
//
// ─── A REGRA ────────────────────────────────────────────────────────────────
// A tarefa se chama pela UNIDADE DE TRABALHO que a originou, na ordem:
//
//   1. nome explícito da unidade operacional, quando configurado;
//   2. o item de catálogo da NECESSIDADE (a obrigação documental);
//   3. o tipo do DOCUMENTO que a originou;
//   4. o nome da etapa — SOMENTE quando a unidade inteira é aquela etapa;
//   5. um rótulo neutro, que não finge saber o que não sabe.
//
// O degrau 4 é o que separa esta regra de um patch: um workflow de passo único
// (a Genealogia com "Localizar registro da certidão") legitimamente se chama
// pelo passo, porque ali o passo É o trabalho. Com dois ou mais passos, o nome
// do primeiro é sempre a resposta errada.
//
// A pessoa entra como qualificador, não como identidade: duas certidões de
// nascimento no mesmo processo são trabalhos diferentes porque são de pessoas
// diferentes.
// ============================================================================

export interface OrigemDoNome {
  /** Nome explícito da unidade operacional, quando o cadastro declara um. */
  nomeConfigurado?: string | null
  /** Item de catálogo da necessidade documental — a obrigação. */
  itemDaNecessidade?: string | null
  /** Tipo/descrição do documento que originou o trabalho. */
  nomeDoDocumento?: string | null
  /** Nome da pessoa a quem o trabalho se refere. */
  pessoa?: string | null
  /** Título da etapa. Só vira nome quando a unidade tem UMA etapa. */
  tituloDaEtapa?: string | null
  /** Quantas etapas a unidade de trabalho tem. */
  etapasDaUnidade: number
}

/** Junta o que identifica o trabalho com quem ele se refere. */
function comPessoa(base: string, pessoa?: string | null): string {
  const p = pessoa?.trim()
  return p ? `${base} · ${p}` : base
}

/**
 * Resolve o nome da tarefa. Determinístico e total: sempre devolve algo
 * legível, e nunca o nome de uma etapa de workflow multietapa.
 */
export function nomeDaTarefa(o: OrigemDoNome): string {
  const limpar = (s?: string | null) => {
    const v = s?.trim()
    return v && v.length > 0 ? v : null
  }

  // 1 · o cadastro mandou. Nome explícito não se discute.
  const configurado = limpar(o.nomeConfigurado)
  if (configurado) return comPessoa(configurado, o.pessoa).slice(0, 200)

  // 2 · a obrigação documental — é o que a operação de fato persegue.
  const item = limpar(o.itemDaNecessidade)
  if (item) return comPessoa(item, o.pessoa).slice(0, 200)

  // 3 · o documento. Menos preciso que a necessidade (não carrega o item de
  // catálogo), mas ainda é o TRABALHO, não a etapa.
  const documento = limpar(o.nomeDoDocumento)
  if (documento) return comPessoa(documento, o.pessoa).slice(0, 200)

  // 4 · UMA etapa só: aqui o passo é o trabalho, e chamá-la pelo passo é
  // correto — é o caso da Genealogia. Com duas ou mais, cai adiante.
  const etapa = limpar(o.tituloDaEtapa)
  if (etapa && o.etapasDaUnidade <= 1) return comPessoa(etapa, o.pessoa).slice(0, 200)

  // 5 · Não sabemos o nome do trabalho. Dizer isso é melhor do que assumir o
  // nome da primeira etapa e transformar uma lacuna de cadastro numa mentira
  // que ninguém percebe.
  return comPessoa("Trabalho documental", o.pessoa).slice(0, 200)
}

/**
 * O NOME VEIO DA ETAPA INDEVIDAMENTE?
 *
 * Usado pela reconciliação para achar as tarefas batizadas pela regra
 * defeituosa — sem tocar em título que uma pessoa escolheu.
 */
export function nomeVeioDaEtapa(titulo: string, titulosDasEtapas: string[], etapasDaUnidade: number): boolean {
  if (etapasDaUnidade <= 1) return false
  const t = titulo.trim().toLowerCase()
  // O título pode ter ganhado o sufixo da pessoa; compara-se a base.
  const base = t.split(" · ")[0]
  return titulosDasEtapas.some((e) => e.trim().toLowerCase() === base)
}
