/**
 * Tipos do módulo Financeiro — v3 final.
 *
 * Substitui os antigos:
 *   - src/types/financeiro-context.ts  (deletado)
 *   - src/types/financeiro-v2.ts       (deletado)
 *
 * Contém TODOS os tipos/interfaces que os componentes e PDFs usavam:
 *   - Componentes: CardFatura, CardPastaDocumental, GerarReciboModal
 *   - PDFs: gerar-recibo, gerar-relatorios, pdf-base
 *
 * Mantém os mesmos nomes e aliases do código legado pra compatibilidade total.
 *
 * Path correto: @/src/types/financeiro
 */

// ============================================================================
// Moeda / formas de pagamento
// ============================================================================

export type Moeda = 'BRL' | 'EUR' | 'USD';

/** Alias legado (antigo `MoedaV2` do V2) */
export type MoedaV2 = Moeda;

export type FormaPagamento =
  | 'PIX'
  | 'CARTAO_CREDITO'
  | 'CARTAO_DEBITO'
  | 'BOLETO'
  | 'TRANSFERENCIA'
  | 'DINHEIRO'
  | 'CHEQUE'
  | 'OUTRO';

export type StatusFatura = 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'PARCIAL';

export type NaturezaOutroCusto = 'COBRAR' | 'REPASSAR';

export type TipoPessoa = 'CONTRATANTE' | 'REQUERENTE';

// ============================================================================
// Destinatário / Pagamento
// ============================================================================

export interface DestinatarioPagamento {
  id: number;
  nome: string;
  tipo?: TipoPessoa;
}

export interface PagamentoFaturaEnriquecido {
  id: number;
  faturaId: number;
  valor: number;
  data: string;
  formaPagamento?: FormaPagamento | string | null;
  valorOriginal?: number | null;
  cambio?: number | null;
  comprovanteUrl?: string | null;
  comprovanteNome?: string | null;
  observacao?: string | null;
  estornado: boolean;
  estornadoEm?: string | null;
  estornoMotivo?: string | null;
  createdAt: string;
  destinatarios?: DestinatarioPagamento[];
}

export type PagamentoFatura = PagamentoFaturaEnriquecido;

// ============================================================================
// Fatura enriquecida (com todos os campos derivados usados no V2)
// ============================================================================

export interface FaturaDestinatario {
  id: number;
  nome: string;
}

export interface ParcelaBoleto {
  id: number;
  faturaId: number;
  numero: number;
  valor: number;
  dataVencimento: string;
  pago: boolean;
  dataPagamento?: string | null;
}

export interface FaturaEnriquecida {
  id: number;
  processoId: number;
  descricao: string;
  valor: number;
  status: StatusFatura;
  dataEmissao: string;
  dataVencimento?: string | null;
  observacoes?: string | null;

  // Moeda
  moeda: Moeda;
  valorOriginal?: number | null;
  cambio?: number | null;

  // Pagamento
  metodoPagamento?: FormaPagamento | null;
  parcelas: number;
  valorParcela?: number | null;

  // ========== Agregados derivados (calculados no enriquecimento) ==========
  /** Total pago (moeda original) */
  valorPago: number;
  /** Restante (moeda original) */
  valorRestante: number;
  /** Total convertido para BRL */
  valorTotalBRL: number;
  /** Total pago convertido para BRL */
  valorPagoBRL: number;
  /** Restante convertido para BRL */
  valorRestanteBRL: number;

  // Relações populadas
  pagamentos: PagamentoFaturaEnriquecido[];
  destinatarios: FaturaDestinatario[];
  parcelasBoleto?: ParcelaBoleto[];

  createdAt: string;
  updatedAt: string;
}

export type FaturaFinanceira = FaturaEnriquecida;

// ============================================================================
// Pasta Documental
// ============================================================================

export interface PastaDocumentalItem {
  pessoaId: number;
  pessoaNome: string;
  tipoServicoId: number;
  /** Nome do serviço (ex.: "Certidão Inteiro Teor"). */
  servico: string;
  tipoRegistro?: string | null;
  valor: number;
  interno?: boolean;
  repassado?: boolean;
  pago?: boolean;
}

/**
 * Versão "achatada" usada nos PDFs (gerar-relatorios).
 * Sem IDs, só os campos texto pra imprimir.
 */
export interface PastaDocumentalDetalhePDF {
  pessoa: string;
  servico: string;
  registro: string;
  valor: number;
}

// ============================================================================
// Pessoa no contexto
// ============================================================================

export interface PessoaContexto {
  id: number;
  nome: string;
  tipo: TipoPessoa;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}

// ============================================================================
// Conta a Pagar
// ============================================================================

export interface ContaPagarResumo {
  id: number;
  descricao: string;
  valor: number;
  valorPago?: number | null;
  dataVencimento: string;
  dataPagamento?: string | null;
  status: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'CANCELADO' | 'AGENDADO';
  fornecedor?: string | null;
  categoria?: string | null;
  processoId?: number | null;
}

// ============================================================================
// Outro Custo (futuro CRUD — Lote 3)
// ============================================================================

export interface PagamentoOutroCusto {
  id: number;
  outroCustoId: number;
  valor: number;
  data: string;
  forma?: FormaPagamento | null;
  pagadorTipo?: TipoPessoa | 'OUTRO' | null;
  pagadorId?: number | null;
  pagadorNome?: string | null;
  comprovanteUrl?: string | null;
  comprovanteNome?: string | null;
  observacao?: string | null;
  estornado: boolean;
  estornadoEm?: string | null;
  estornoMotivo?: string | null;
  createdAt: string;
}

export interface OutroCusto {
  id: number;
  processoId: number;
  natureza: NaturezaOutroCusto;
  tipo: string;
  descricao: string;
  fornecedor?: string | null;
  valor: number;
  moeda: Moeda;
  cambio?: number | null;
  vencimento?: string | null;
  interno: boolean;
  repassado: boolean;
  pago: boolean;
  observacao?: string | null;
  pagamentos?: PagamentoOutroCusto[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Recibo (frontend)
// ============================================================================

export interface Recibo {
  id: number;
  processoId: number;
  numero: string;
  data: string;
  valorTotal: number | string;
  descricao: string;

  pagadorRequerenteId?: number | null;
  pagadorContratanteId?: number | null;
  pagadorNome?: string | null;

  pagadorRequerente?: { id: number; nome: string } | null;
  pagadorContratante?: { id: number; nome: string } | null;

  pdfUrl?: string | null;
  pdfNome?: string | null;

  emitidoPor?: { id: number; nome: string } | null;
  createdAt: string;
}

// ============================================================================
// ResumoFinanceiro — contém AMBOS os nomes (novos e legados)
// ============================================================================

export interface ResumoFinanceiro {
  // ─────────────────────────────────────────────────────────────────────────
  // Nomes novos (preferência para código novo — Lote 2, 3)
  // ─────────────────────────────────────────────────────────────────────────
  totalFaturado: number;
  totalRecebido: number;
  totalAReceber: number;
  totalVencido: number;
  totalCustos: number;
  totalCustosPagos: number;
  lucroProjetado: number;
  margem: number;        // também usado no legado
  saldoAtual: number;

  // ─────────────────────────────────────────────────────────────────────────
  // Nomes legados (usados pelos PDFs — gerar-relatorios, gerar-recibo)
  // São aliases/espelhos dos de cima, com nomes alternativos.
  // ─────────────────────────────────────────────────────────────────────────

  /** Alias de totalFaturado */
  totalCobrado: number;
  /** Alias de totalRecebido */
  recebido: number;
  /** Alias de totalAReceber */
  aReceber: number;
  /** Alias de totalVencido */
  vencido: number;

  /** Alias de totalCustos */
  custo: number;
  /** Alias de totalCustosPagos */
  custoPago: number;
  /** Custo pendente (custo − custoPago) */
  custoPendente: number;

  /** Alias de lucroProjetado */
  lucro: number;

  /** Quantidade total de faturas */
  numFaturas: number;
  /** Quantidade de faturas vencidas */
  vencidasCount: number;

  /** Percentual recebido (0-100) */
  pctRecebido: number;
  /** Percentual pago a terceiros (0-100) */
  pctPago: number;
}

// ============================================================================
// ProcessoContext — contexto mínimo usado pelos PDFs
// (diferente do FinanceiroContext — tem só os metadados do processo)
// ============================================================================

export interface ProcessoContext {
  nome: string;
  pais: string | null | undefined;
  etapaAtual?: string | null;
  requerentes: string[];
}

// ============================================================================
// FinanceiroContext — usado por CardFatura, CardPastaDocumental, etc.
// ============================================================================

export interface FinanceiroContext {
  processoId: number;
  nomeFamilia: string;
  pais?: string | null;
  etapaAtual?: string | null;

  faturas: FaturaEnriquecida[];
  outrosCustos: OutroCusto[];
  pessoas: PessoaContexto[];

  pastaTotal: number;
  pastaPago: number;
  pastaDetalhes: PastaDocumentalItem[];

  contasPagar: ContaPagarResumo[];

  resumo: ResumoFinanceiro;

  moedaBase: Moeda;
  atualizadoEm: string;

  /** Recarrega os dados do contexto. */
  refresh: () => void | Promise<void>;
}

// ============================================================================
// Helpers de criação
// ============================================================================

/**
 * Resumo financeiro zerado (com ambos os nomes de campo).
 */
export function criarResumoVazio(): ResumoFinanceiro {
  return {
    totalFaturado: 0,
    totalRecebido: 0,
    totalAReceber: 0,
    totalVencido: 0,
    totalCustos: 0,
    totalCustosPagos: 0,
    lucroProjetado: 0,
    margem: 0,
    saldoAtual: 0,

    totalCobrado: 0,
    recebido: 0,
    aReceber: 0,
    vencido: 0,
    custo: 0,
    custoPago: 0,
    custoPendente: 0,
    lucro: 0,
    numFaturas: 0,
    vencidasCount: 0,
    pctRecebido: 0,
    pctPago: 0,
  };
}

/**
 * FinanceiroContext vazio (útil pra inicializar state).
 */
export function criarContextoVazio(
  processoId: number,
  nomeFamilia: string,
  refresh: () => void = () => {}
): FinanceiroContext {
  return {
    processoId,
    nomeFamilia,
    pais: null,
    etapaAtual: null,
    faturas: [],
    outrosCustos: [],
    pessoas: [],
    pastaTotal: 0,
    pastaPago: 0,
    pastaDetalhes: [],
    contasPagar: [],
    resumo: criarResumoVazio(),
    moedaBase: 'BRL',
    atualizadoEm: new Date().toISOString(),
    refresh,
  };
}