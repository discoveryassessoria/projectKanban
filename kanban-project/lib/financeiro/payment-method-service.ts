// lib/financeiro/payment-method-service.ts
// ============================================================================
// PaymentMethodService — ponto ÚNICO de acesso às regras de Forma de Pagamento.
// Enums vêm de payment-method-constants; validações PURAS de payment-method-rules.
// Aqui fica só o IO (Prisma). Componentes/endpoints NUNCA reimplementam regra —
// chamam este módulo (ou os puros reexportados).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { paraFormaView, type FormaView } from './payment-method-rules'

export {
  TIPOS_FORMA, TIPOS_FORMA_LABEL, TIPOS_INTEGRACAO, PRAZOS_LIQUIDACAO, CATEGORIAS_FORMA,
} from './payment-method-constants'
export {
  validarCompatibilidadeCondicao, validarCompatibilidadeCobranca, paraFormaView,
  type FormaView, type CondicaoCompat, type ResultadoCompat, type ContextoCobranca,
} from './payment-method-rules'

/** Único ponto que toca o banco. Formas ativas normalizadas para FormaView. */
export async function listarFormasAtivas(): Promise<FormaView[]> {
  const formas = await prisma.formaPagamentoCadastro.findMany({
    where: { ativo: true }, orderBy: [{ ordem: 'asc' }, { name: 'asc' }],
  })
  return formas.map(paraFormaView)
}
