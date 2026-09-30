// lib/saude/verificacoes/cadastro-do-passo.ts
// ============================================================================
// "O passo tem cadastro operacional?" — a conta da CAD-012 (30/09/2026, autorizado).
//
// Um passo SELECIONADO DA BIBLIOTECA (`bibliotecaModeloId` preenchido) não tem conteúdo próprio: `acoes`/`campos`/
// `checkItens`/`subtarefas` locais ficam SEMPRE vazias por desenho, e o conteúdo executável mora na versão CONGELADA
// do Modelo que a seleção pinou (`resolverConteudoDaBiblioteca`). A CAD-012 lia só as linhas locais e acusava como
// "não tem como ser executado" passos que executam (falso positivo: Apostilamento e Retificação).
//
// A regra: cadastro LOCAL vale; senão, se o passo é da Biblioteca, vale o conteúdo congelado pinado. Um passo local
// sem ação/campo/checklist/subtarefa — ou da Biblioteca cujo congelado também está vazio (ou não resolve) — continua
// acusado.
// ============================================================================
export interface CadastroLocalDoPasso {
  acoes: unknown[]
  campos: unknown[]
  checkItens: unknown[]
  subtarefas: unknown[]
}
export interface ConteudoCongelado {
  acoes?: unknown
  campos?: unknown
  checkItens?: unknown
  subtarefas?: unknown
}

const n = (v: unknown): number => (Array.isArray(v) ? v.length : 0)

export function temCadastroOperacional(local: CadastroLocalDoPasso, congeladoDaBiblioteca: ConteudoCongelado | null): boolean {
  if (local.acoes.length || local.campos.length || local.checkItens.length || local.subtarefas.length) return true
  if (!congeladoDaBiblioteca) return false
  return n(congeladoDaBiblioteca.acoes) > 0 || n(congeladoDaBiblioteca.campos) > 0
    || n(congeladoDaBiblioteca.checkItens) > 0 || n(congeladoDaBiblioteca.subtarefas) > 0
}
