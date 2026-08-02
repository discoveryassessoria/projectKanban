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
import './verificacoes/agendados'
import './verificacoes/interface'
// capacidades precisam estar registradas ANTES das verificações que as avaliam
import './capacidades/operacionais'
import './verificacoes/prontidao'

export { catalogo, cobertura, dominiosSemCobertura, elegiveis, metadados, VERSAO_CATALOGO } from './catalogo'
export { executarDiagnostico, consolidar } from './motor'
export { persistirDiagnostico, ultimaExecucao, achadosAbertos, type ResumoPersistencia } from './persistencia'
export { correcoes, correcaoPorId, NUNCA_AUTOMATICO } from './correcoes'
export { notificarAchados } from './notificacoes'
export * from './tipos'
export {
  avaliarCapacidades, avaliarCapacidade, capacidades, capacidadePorCodigo,
  PRONTIDAO_LABEL, DEPENDENCIA_LABEL, ESTADOS_PRONTIDAO, piorProntidao,
  type CapacidadeAvaliada, type EstadoProntidao,
} from './capacidades'
export { avaliarContratos, type ResultadoContrato } from './contratos'
export { montarPlano, agruparPorCausaRaiz, type Recomendacao, type CausaRaiz } from './plano'
export { mapearSuperficie, lacunasDeCobertura, matrizCobertura } from './superficie'
export { executarSmoke, ROTAS_SMOKE, type ResultadoSmoke } from './smoke'
