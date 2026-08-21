// src/services/dependencias-do-passo.ts
// ============================================================================
// QUEM DEPENDE DE QUEM — e o que isso implica ao concluir e ao reabrir.
//
// ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────────
// "Vem depois na lista" e "depende de" eram a mesma coisa. Concluir um passo abria
// o de ORDEM seguinte; reabrir um passo bloqueava tudo com `ordem > N`. Enquanto o
// roteiro fosse uma fila reta, os dois coincidiam. Assim que uma fase tem dois
// caminhos independentes — conferir a certidão e providenciar a procuração, por
// exemplo — a coincidência acaba: reabrir a conferência derrubava a procuração, que
// não dependia dela e cujo trabalho estava feito.
//
// ─── A REGRA ────────────────────────────────────────────────────────────────
// Um passo fica disponível quando TODAS as suas dependências estão concluídas.
// Reabrir um passo alcança os DESCENDENTES dele — os que dependem, direta ou
// indiretamente. Quem não desce dessa raiz não é tocado.
//
// ─── ORDEM CONTINUA EXISTINDO ───────────────────────────────────────────────
// Ela decide APRESENTAÇÃO e desempate, não liberação. Um roteiro sem dependência
// declarada continua sendo lido como fila — é o que os workflows publicados antes
// deste módulo dizem, e eles não mudam de significado por causa dele.
// ============================================================================

export interface PassoComDependencia {
  id: number
  stepKey: string
  ordem: number
  status: string
  dependeDeStepKeys: string[] | null
}

/** Estados em que um passo já cumpriu o que devia — o que libera quem depende dele. */
export const ESTADOS_CUMPRIDOS = new Set(["CONCLUIDO", "DISPENSADO", "APROVADO"])

/**
 * As dependências deste passo estão todas cumpridas?
 *
 * Sem dependência declarada, a resposta é sim — e é a resposta certa: um passo que
 * não depende de nada não tem por que esperar.
 */
export function dependenciasCumpridas(
  passo: Pick<PassoComDependencia, "dependeDeStepKeys">,
  cumpridasPorChave: Set<string>,
): boolean {
  const deps = passo.dependeDeStepKeys ?? []
  return deps.every((d) => cumpridasPorChave.has(d))
}

/** As chaves cumpridas dentro de um conjunto de passos da MESMA unidade. */
export function chavesCumpridas(passos: PassoComDependencia[]): Set<string> {
  return new Set(passos.filter((p) => ESTADOS_CUMPRIDOS.has(p.status)).map((p) => p.stepKey))
}

/**
 * OS PASSOS QUE PASSAM A PODER COMEÇAR depois que `concluida` foi cumprida.
 *
 * Devolve TODOS os liberados, não "o próximo": numa configuração em que B e C
 * dependem de A, concluir A libera os dois. Devolver um só era o que fazia o
 * paralelismo declarado virar fila na prática.
 */
export function liberadosPor(
  passos: PassoComDependencia[],
  concluida: string,
  esperando: ReadonlySet<string> = new Set(["PENDENTE", "BLOQUEADO"]),
): PassoComDependencia[] {
  const cumpridas = chavesCumpridas(passos)
  cumpridas.add(concluida)
  return passos
    .filter((p) => esperando.has(p.status))
    .filter((p) => (p.dependeDeStepKeys ?? []).includes(concluida))
    .filter((p) => dependenciasCumpridas(p, cumpridas))
    .sort((a, b) => a.ordem - b.ordem || a.id - b.id)
}

/**
 * OS DESCENDENTES de um passo — quem depende dele, direta ou indiretamente.
 *
 * É esta lista que a reabertura alcança. Tolerante a ciclo por construção (visitados),
 * embora a publicação já recuse ciclos: um dado antigo inconsistente não pode
 * transformar reabrir um passo em laço infinito.
 */
export function descendentes(passos: PassoComDependencia[], raiz: string): PassoComDependencia[] {
  const porChave = new Map<string, PassoComDependencia[]>()
  for (const p of passos) {
    for (const d of p.dependeDeStepKeys ?? []) {
      const l = porChave.get(d) ?? []
      l.push(p)
      porChave.set(d, l)
    }
  }
  const vistos = new Set<string>([raiz])
  const fila = [raiz]
  const saida: PassoComDependencia[] = []
  while (fila.length) {
    const atual = fila.shift()!
    for (const filho of porChave.get(atual) ?? []) {
      if (vistos.has(filho.stepKey)) continue
      vistos.add(filho.stepKey)
      saida.push(filho)
      fila.push(filho.stepKey)
    }
  }
  return saida.sort((a, b) => a.ordem - b.ordem || a.id - b.id)
}

/**
 * O QUE UMA REABERTURA ALCANÇA, separado do que ela NÃO alcança.
 *
 * `alcancados` volta a depender do passo reaberto. `preservados` são os que estavam
 * na mesma unidade e não descendem dele: o trabalho deles continua valendo, e
 * derrubá-los seria destruir execução alheia — que é exatamente o que `ordem > N`
 * fazia sem que ninguém tivesse decidido.
 */
export function impactoDaReabertura(
  passos: PassoComDependencia[],
  raiz: string,
): { alcancados: PassoComDependencia[]; preservados: PassoComDependencia[] } {
  const desc = descendentes(passos, raiz)
  const chaves = new Set(desc.map((p) => p.stepKey))
  return {
    alcancados: desc,
    preservados: passos.filter((p) => p.stepKey !== raiz && !chaves.has(p.stepKey)),
  }
}
