// lib/operacional/torre-relatorio-colunas.ts
// ============================================================================
// AS COLUNAS DO "RELATÓRIO DE CONTROLE" DA TORRE — uma lista só (módulo puro). Prévia (Detalhe do Processo) e exportações
// CSV/Excel/PDF (Detalhe e aba Processos) pedem ao motor de Relatórios (domínio Certidões) EXATAMENTE estas colunas, nesta ordem:
//
//   Certidão · Pessoa · Geração · Fase · Passo · Situação · Responsável · Iniciou · Prazo
//
// As do protótipo ("Certidão · pessoa", "Fase", "Passo · status", "Responsável", "Iniciou", "Prazo") + a Geração que já existia.
// Fase, Passo e Iniciou saem da TAREFA da certidão (`src/lib/relatorios/motor/dominios/certidoes.ts`); sem registro mostram "—".
// ============================================================================
export const COLUNAS_DO_RELATORIO_DE_CONTROLE = [
  'tipo', 'pessoa', 'geracao', 'fase_certidao', 'passo', 'status', 'responsavel_tarefa', 'iniciou', 'prazo',
] as const

/** Os rótulos que a pessoa lê no cabeçalho (o motor os define; o teste confere que batem). */
export const ROTULOS_DO_RELATORIO_DE_CONTROLE = ['Certidão', 'Pessoa', 'Geração', 'Fase', 'Passo', 'Situação', 'Responsável', 'Iniciou', 'Prazo'] as const
