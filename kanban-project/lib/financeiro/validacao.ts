// lib/financeiro/validacao.ts
// Schemas Zod usados pelas rotas /api/financeiro/*.
// Sintaxe compatível com zod v3 e v4.

import { z } from "zod";

// ============================================================
// Enums (espelham os enums do Prisma)
// ============================================================
export const FxRuleEnum = z.enum(["FIXO", "VARIAVEL"]);
export const StatusParcelaEnum = z.enum([
  "PENDENTE",
  "RECEBIDA",
  "PAGA",
  "CANCELADA",
]);
export const CategoriaReceitaEnum = z.enum([
  "HONORARIOS",
  "REEMBOLSO",
  "PASTA_DOCUMENTAL",
  "OUTROS",
]);
export const TipoCustoEnum = z.enum([
  "SERVICO",
  "IMPOSTO",
  "DOCUMENTO",
  "DESPESA",
]);
export const CategoriaCustoEnum = z.enum([
  "TRADUCOES_JURAMENTACOES",
  "APOSTILAMENTOS",
  "HONORARIOS_ESCRITORIO",
  "TAXAS_CONSULARES",
  "OUTROS",
]);
export const MoedaEnum = z.enum(["BRL", "EUR", "USD"]);
export const FormaPagamentoEnum = z.enum([
  "PIX",
  "CARTAO_CREDITO",
  "CARTAO_DEBITO",
  "BOLETO",
  "TRANSFERENCIA",
  "DINHEIRO",
  "CHEQUE",
  "OUTRO",
]);

// ============================================================
// Receita Requerente (snapshot de participante)
// ============================================================
const ReceitaRequerenteSchema = z.object({
  idx: z.number().int().min(0),
  nome: z.string().min(1).max(200),
  idade: z.number().int().min(0).max(150).nullable().optional(),
  statusFamiliar: z.enum(["Adulto", "Menor"]).nullable().optional(),
  percentual: z.number().min(0).max(100),
  requerenteId: z.number().int().positive().nullable().optional(),
});

// ============================================================
// Receita - criação
// ============================================================
export const CriarReceitaSchema = z
  .object({
    processoId: z.number().int().positive(),
    categoria: CategoriaReceitaEnum.default("OUTROS"),
    descricao: z.string().min(1).max(300),
    moeda: MoedaEnum.default("EUR"),
    valor: z.number().positive(),
    fxEstimado: z.number().positive(),
    fxRule: FxRuleEnum.default("VARIAVEL"),
    fxFixo: z.number().positive().nullable().optional(),
    fxData: z.coerce.date().nullable().optional(),
    nParcelas: z.number().int().min(1).max(120).default(1),
    data1: z.coerce.date(),
    periodicidade: z.string().max(20).default("Mensal"),
    observacoes: z.string().nullable().optional(),
    requerentes: z.array(ReceitaRequerenteSchema).min(1),
  })
  .refine((data) => data.fxRule !== "FIXO" || data.fxFixo != null, {
    message: "fxFixo é obrigatório quando fxRule = FIXO",
    path: ["fxFixo"],
  })
  .refine(
    (data) => {
      const soma = data.requerentes.reduce((s, r) => s + r.percentual, 0);
      return Math.abs(soma - 100) < 0.01;
    },
    {
      message: "Soma dos percentuais dos requerentes deve ser 100",
      path: ["requerentes"],
    }
  )
  .refine(
    (data) => {
      const idxs = data.requerentes.map((r) => r.idx);
      return new Set(idxs).size === idxs.length;
    },
    {
      message: "Os valores de idx dos requerentes devem ser únicos",
      path: ["requerentes"],
    }
  );

// ============================================================
// Receita - edição (campos textuais; regenerar parcelas é fluxo separado)
// ============================================================
export const EditarReceitaSchema = z.object({
  categoria: CategoriaReceitaEnum.optional(),
  descricao: z.string().min(1).max(300).optional(),
  observacoes: z.string().nullable().optional(),
});

// ============================================================
// Custo - criação
// ============================================================
export const CriarCustoSchema = z
  .object({
    processoId: z.number().int().positive(),
    tipo: TipoCustoEnum.default("SERVICO"),
    categoria: CategoriaCustoEnum.default("OUTROS"),
    descricao: z.string().min(1).max(300),
    fornecedor: z.string().max(200).nullable().optional(),
    moeda: MoedaEnum.default("EUR"),
    valor: z.number().positive(),
    fxEstimado: z.number().positive(),
    fxRule: FxRuleEnum.default("VARIAVEL"),
    fxFixo: z.number().positive().nullable().optional(),
    fxData: z.coerce.date().nullable().optional(),
    nParcelas: z.number().int().min(1).max(120).default(1),
    vencimento: z.coerce.date(),
    custoOperacional: z.boolean().default(false),
    categoriaVinculada: CategoriaReceitaEnum.nullable().optional(),
    percentualVinculado: z.number().min(0).max(100).nullable().optional(),
    formaPagamento: FormaPagamentoEnum.nullable().optional(),
    observacoes: z.string().nullable().optional(),
  })
  .refine((data) => data.fxRule !== "FIXO" || data.fxFixo != null, {
    message: "fxFixo é obrigatório quando fxRule = FIXO",
    path: ["fxFixo"],
  })
  .refine(
    (data) =>
      !data.custoOperacional ||
      (data.categoriaVinculada != null && data.percentualVinculado != null),
    {
      message:
        "categoriaVinculada e percentualVinculado são obrigatórios quando custoOperacional = true",
      path: ["custoOperacional"],
    }
  );

// ============================================================
// Custo - edição
// ============================================================
export const EditarCustoSchema = z.object({
  tipo: TipoCustoEnum.optional(),
  categoria: CategoriaCustoEnum.optional(),
  descricao: z.string().min(1).max(300).optional(),
  fornecedor: z.string().max(200).nullable().optional(),
  formaPagamento: FormaPagamentoEnum.nullable().optional(),
  observacoes: z.string().nullable().optional(),
});

// ============================================================
// Lançamento de parcela (recebimento OU pagamento)
// ============================================================
export const LancarParcelaSchema = z.object({
  cambioAplicado: z.number().positive(),
  dataPagamento: z.coerce.date(),
  formaPagamento: FormaPagamentoEnum.nullable().optional(),
  banco: z.string().max(100).nullable().optional(),
  comprovanteUrl: z.string().nullable().optional(),
  comprovanteNome: z.string().max(200).nullable().optional(),
  observacoes: z.string().nullable().optional(),
});

// ============================================================
// Helper para serializar erros do Zod de forma estável
// (compatível com v3 e v4)
// ============================================================
export function formatZodError(err: z.ZodError) {
  return {
    issues: err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    })),
  };
}
