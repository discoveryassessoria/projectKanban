// lib/saude/index.ts
//
// Ponto único de entrada da Saúde do Sistema. Importar este módulo REGISTRA o
// catálogo — nenhuma verificação roda sem estar declarada aqui dentro.

import './verificacoes/banco'
import './verificacoes/filas'
import './verificacoes/processos'
import './verificacoes/workflow'
import './verificacoes/financeiro'
import './verificacoes/organizacoes'
import './verificacoes/documentos'
import './verificacoes/acesso'
import './verificacoes/tesouraria'
import './verificacoes/plataforma'
import './verificacoes/ponta-a-ponta'

export { catalogo, cobertura, dominiosSemCobertura, elegiveis, metadados, VERSAO_CATALOGO } from './catalogo'
export { executarDiagnostico, consolidar } from './motor'
export { persistirDiagnostico, ultimaExecucao, achadosAbertos, type ResumoPersistencia } from './persistencia'
export { correcoes, correcaoPorId, NUNCA_AUTOMATICO } from './correcoes'
export { notificarAchados } from './notificacoes'
export * from './tipos'
