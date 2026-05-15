// lib/financeiro/templates.ts
//
// Templates financeiros por tipo de processo — port fiel do `TEMPLATES_V2`
// do mockup (casa.html). Cada template descreve as receitas e custos padrão
// que são gerados de uma vez ao aplicar o template num processo.
//
// Diferença pro mockup: aqui os tipos/categorias já são os ENUMS REAIS do
// Prisma (CategoriaReceita, TipoCusto, CategoriaCusto, Moeda) em vez das
// strings livres do HTML. O mapeamento foi feito na transcrição:
//   tipoReceita 'honorarios_principais' | 'assessoria_juridica' -> HONORARIOS
//   tipoReceita 'pasta_documental'                              -> PASTA_DOCUMENTAL
//   tipoReceita 'entrada_sinal' | 'taxa_consular' | 'taxa_administrativa' -> OUTROS
//
// É só dado — sem dependência de DB. Importável do server (rotas) e do client
// (SeletorTemplate) via `@/lib/financeiro/templates`.

// ── Tipos espelhando os enums do Prisma (mesma abordagem das rotas, que usam
//    string-literais em vez de importar @prisma/client) ──────────────────────
export type Moeda = "BRL" | "EUR" | "USD";
export type CategoriaReceita =
  | "HONORARIOS"
  | "REEMBOLSO"
  | "PASTA_DOCUMENTAL"
  | "OUTROS";
export type TipoCusto = "SERVICO" | "IMPOSTO" | "DOCUMENTO" | "DESPESA";
export type CategoriaCusto =
  | "TRADUCOES_JURAMENTACOES"
  | "APOSTILAMENTOS"
  | "HONORARIOS_ESCRITORIO"
  | "TAXAS_CONSULARES"
  | "OUTROS";

// ── Composição interna (custo automático gerado a partir de uma receita) ─────
export type ComposicaoInternaTemplate =
  | {
      tipo: "repasse_com_margem";
      valorRealRepasse: number;
      margemAdministrativa: number;
      fornecedorCusto: string;
      categoriaCusto: CategoriaCusto;
    }
  | {
      tipo: "composicao_documental";
      itens: { rubrica: string; valor: number }[];
    };

// ── Item de receita do template ──────────────────────────────────────────────
export interface TemplateReceitaItem {
  templateItemId: string;
  categoria: CategoriaReceita;
  descricao: string;
  moeda: Moeda;
  /** Valor TOTAL da receita (dividido igualmente entre os adultos). */
  valorPadrao: number;
  nParcelas: number;
  diasEntreParcelas: number;
  /** Se true, divide só entre adultos; se false, entre todos os requerentes. */
  soAdultos: boolean;
  /** Item opcional com valorPadrao <= 0 não é criado ao aplicar o template. */
  opcional: boolean;
  /** Composição interna -> gera custo(s) previsto(s) automático(s). */
  composicaoInternaTemplate?: ComposicaoInternaTemplate;
}

// ── Item de custo explícito do template ──────────────────────────────────────
export interface TemplateCustoItem {
  templateItemId: string;
  tipo: TipoCusto;
  categoria: CategoriaCusto;
  descricao: string;
  fornecedor: string | null;
  moeda: Moeda;
  valorPadrao: number;
  nParcelas: number;
  diasParaVencer: number;
  custoOperacional: boolean;
  /** Categoria de receita vinculada (null = custo não vinculado). */
  categoriaVinculada: CategoriaReceita | null;
}

// ── Template completo ────────────────────────────────────────────────────────
export interface TemplateFinanceiro {
  id: string;
  label: string;
  moedaPadrao: Moeda;
  receitas: TemplateReceitaItem[];
  custos: TemplateCustoItem[];
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════
export const TEMPLATES_FINANCEIROS: Record<string, TemplateFinanceiro> = {
  "cidadania-espanhola": {
    id: "cidadania-espanhola",
    label: "Nacionalidade Espanhola",
    moedaPadrao: "EUR",
    receitas: [
      {
        templateItemId: "esp_honorarios",
        categoria: "HONORARIOS",
        descricao: "Honorários profissionais do processo",
        moeda: "EUR",
        valorPadrao: 5000,
        nParcelas: 10,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
      },
      {
        templateItemId: "esp_entrada",
        categoria: "OUTROS",
        descricao: "Entrada inicial do processo",
        moeda: "EUR",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
      {
        templateItemId: "esp_pasta",
        categoria: "PASTA_DOCUMENTAL",
        descricao: "Pasta documental do processo",
        moeda: "BRL",
        valorPadrao: 10000,
        nParcelas: 4,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
        composicaoInternaTemplate: {
          tipo: "composicao_documental",
          itens: [
            { rubrica: "Certidões", valor: 2000 },
            { rubrica: "Apostilas", valor: 1500 },
            { rubrica: "Traduções", valor: 2500 },
            { rubrica: "Envios", valor: 500 },
          ],
        },
      },
      {
        templateItemId: "esp_consular",
        categoria: "OUTROS",
        descricao: "Taxa consular e gestão administrativa",
        moeda: "EUR",
        valorPadrao: 400,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
        composicaoInternaTemplate: {
          tipo: "repasse_com_margem",
          valorRealRepasse: 300,
          margemAdministrativa: 100,
          fornecedorCusto: "Consulado da Espanha",
          categoriaCusto: "TAXAS_CONSULARES",
        },
      },
      {
        templateItemId: "esp_admin",
        categoria: "OUTROS",
        descricao: "Taxa administrativa do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
    ],
    custos: [
      {
        templateItemId: "esp_correios",
        tipo: "DESPESA",
        categoria: "OUTROS",
        descricao: "Correios / DHL",
        fornecedor: "Correios",
        moeda: "BRL",
        valorPadrao: 500,
        nParcelas: 1,
        diasParaVencer: 30,
        custoOperacional: true,
        categoriaVinculada: null,
      },
    ],
  },

  "cidadania-italiana-judicial": {
    id: "cidadania-italiana-judicial",
    label: "Cidadania Italiana Judicial",
    moedaPadrao: "BRL",
    receitas: [
      {
        templateItemId: "itj_honorarios",
        categoria: "HONORARIOS",
        descricao: "Honorários profissionais do processo",
        moeda: "BRL",
        valorPadrao: 18000,
        nParcelas: 12,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
      },
      {
        templateItemId: "itj_entrada",
        categoria: "OUTROS",
        descricao: "Entrada inicial do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
      {
        templateItemId: "itj_pasta",
        categoria: "PASTA_DOCUMENTAL",
        descricao: "Pasta documental do processo",
        moeda: "BRL",
        valorPadrao: 12000,
        nParcelas: 4,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
        composicaoInternaTemplate: {
          tipo: "composicao_documental",
          itens: [
            { rubrica: "Certidões e buscas", valor: 2500 },
            { rubrica: "Traduções juramentadas", valor: 3500 },
            { rubrica: "Apostilas", valor: 1500 },
            { rubrica: "Envios DHL", valor: 800 },
          ],
        },
      },
      {
        templateItemId: "itj_assessoria",
        categoria: "HONORARIOS",
        descricao: "Assessoria jurídica vinculada ao processo",
        moeda: "EUR",
        valorPadrao: 15000,
        nParcelas: 10,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
        composicaoInternaTemplate: {
          tipo: "repasse_com_margem",
          valorRealRepasse: 8000,
          margemAdministrativa: 7000,
          fornecedorCusto: "Studio Legale Itália",
          categoriaCusto: "HONORARIOS_ESCRITORIO",
        },
      },
      {
        templateItemId: "itj_admin",
        categoria: "OUTROS",
        descricao: "Taxa administrativa do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
    ],
    custos: [
      {
        templateItemId: "itj_custas",
        tipo: "IMPOSTO",
        categoria: "OUTROS",
        descricao: "Custas judiciais (Itália)",
        fornecedor: "Tribunal italiano",
        moeda: "EUR",
        valorPadrao: 2000,
        nParcelas: 1,
        diasParaVencer: 60,
        custoOperacional: false,
        categoriaVinculada: null,
      },
      {
        templateItemId: "itj_correios",
        tipo: "DESPESA",
        categoria: "OUTROS",
        descricao: "Correios / DHL internacional",
        fornecedor: "DHL",
        moeda: "BRL",
        valorPadrao: 800,
        nParcelas: 1,
        diasParaVencer: 30,
        custoOperacional: true,
        categoriaVinculada: null,
      },
    ],
  },

  "cidadania-italiana-administrativa": {
    id: "cidadania-italiana-administrativa",
    label: "Cidadania Italiana Administrativa",
    moedaPadrao: "BRL",
    receitas: [
      {
        templateItemId: "ita_honorarios",
        categoria: "HONORARIOS",
        descricao: "Honorários profissionais do processo",
        moeda: "BRL",
        valorPadrao: 12000,
        nParcelas: 10,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
      },
      {
        templateItemId: "ita_entrada",
        categoria: "OUTROS",
        descricao: "Entrada inicial do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
      {
        templateItemId: "ita_pasta",
        categoria: "PASTA_DOCUMENTAL",
        descricao: "Pasta documental do processo",
        moeda: "BRL",
        valorPadrao: 10000,
        nParcelas: 3,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
        composicaoInternaTemplate: {
          tipo: "composicao_documental",
          itens: [
            { rubrica: "Certidões e buscas", valor: 2000 },
            { rubrica: "Traduções juramentadas", valor: 3000 },
            { rubrica: "Apostilas", valor: 1200 },
            { rubrica: "Comune / taxas", valor: 800 },
            { rubrica: "Envios DHL", valor: 600 },
          ],
        },
      },
      {
        templateItemId: "ita_admin",
        categoria: "OUTROS",
        descricao: "Taxa administrativa do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
    ],
    custos: [
      {
        templateItemId: "ita_correios",
        tipo: "DESPESA",
        categoria: "OUTROS",
        descricao: "Correios / DHL internacional",
        fornecedor: "DHL",
        moeda: "BRL",
        valorPadrao: 600,
        nParcelas: 1,
        diasParaVencer: 30,
        custoOperacional: true,
        categoriaVinculada: null,
      },
    ],
  },

  "nacionalidade-portuguesa": {
    id: "nacionalidade-portuguesa",
    label: "Nacionalidade Portuguesa",
    moedaPadrao: "BRL",
    receitas: [
      {
        templateItemId: "prt_honorarios",
        categoria: "HONORARIOS",
        descricao: "Honorários profissionais do processo",
        moeda: "BRL",
        valorPadrao: 10000,
        nParcelas: 10,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
      },
      {
        templateItemId: "prt_entrada",
        categoria: "OUTROS",
        descricao: "Entrada inicial do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
      {
        templateItemId: "prt_pasta",
        categoria: "PASTA_DOCUMENTAL",
        descricao: "Pasta documental do processo",
        moeda: "BRL",
        valorPadrao: 9000,
        nParcelas: 3,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
        composicaoInternaTemplate: {
          tipo: "composicao_documental",
          itens: [
            { rubrica: "Certidões e buscas", valor: 1800 },
            { rubrica: "Traduções juramentadas", valor: 2500 },
            { rubrica: "Apostilas", valor: 1000 },
            { rubrica: "Conservatória / emolumentos", valor: 1200 },
            { rubrica: "Envios DHL", valor: 500 },
          ],
        },
      },
      {
        templateItemId: "prt_consular",
        categoria: "OUTROS",
        descricao: "Taxa consular e gestão administrativa",
        moeda: "EUR",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
        composicaoInternaTemplate: {
          tipo: "repasse_com_margem",
          valorRealRepasse: 0,
          margemAdministrativa: 0,
          fornecedorCusto: "Consulado de Portugal",
          categoriaCusto: "TAXAS_CONSULARES",
        },
      },
      {
        templateItemId: "prt_admin",
        categoria: "OUTROS",
        descricao: "Taxa administrativa do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
    ],
    custos: [
      {
        templateItemId: "prt_correios",
        tipo: "DESPESA",
        categoria: "OUTROS",
        descricao: "Correios / DHL internacional",
        fornecedor: "DHL",
        moeda: "BRL",
        valorPadrao: 500,
        nParcelas: 1,
        diasParaVencer: 30,
        custoOperacional: true,
        categoriaVinculada: null,
      },
    ],
  },

  "portugal-sefardita": {
    id: "portugal-sefardita",
    label: "Portugal Sefardita",
    moedaPadrao: "BRL",
    receitas: [
      {
        templateItemId: "sef_honorarios",
        categoria: "HONORARIOS",
        descricao: "Honorários profissionais do processo",
        moeda: "BRL",
        valorPadrao: 22000,
        nParcelas: 12,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
      },
      {
        templateItemId: "sef_entrada",
        categoria: "OUTROS",
        descricao: "Entrada inicial do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
      {
        templateItemId: "sef_pasta",
        categoria: "PASTA_DOCUMENTAL",
        descricao: "Pasta documental do processo",
        moeda: "BRL",
        valorPadrao: 10000,
        nParcelas: 3,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
        composicaoInternaTemplate: {
          tipo: "composicao_documental",
          itens: [
            { rubrica: "Pesquisa genealógica", valor: 3000 },
            { rubrica: "Certidões e traduções", valor: 3000 },
            { rubrica: "Apostilas", valor: 1000 },
            { rubrica: "Conservatória", valor: 1500 },
            { rubrica: "Envios DHL", valor: 500 },
          ],
        },
      },
      {
        templateItemId: "sef_assessoria",
        categoria: "HONORARIOS",
        descricao: "Assessoria jurídica e parecer CIL",
        moeda: "BRL",
        valorPadrao: 5000,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: false,
        composicaoInternaTemplate: {
          tipo: "repasse_com_margem",
          valorRealRepasse: 2500,
          margemAdministrativa: 2500,
          fornecedorCusto: "CIL / Comunidade judaica",
          categoriaCusto: "OUTROS",
        },
      },
      {
        templateItemId: "sef_admin",
        categoria: "OUTROS",
        descricao: "Taxa administrativa do processo",
        moeda: "BRL",
        valorPadrao: 0,
        nParcelas: 1,
        diasEntreParcelas: 30,
        soAdultos: true,
        opcional: true,
      },
    ],
    custos: [
      {
        templateItemId: "sef_correios",
        tipo: "DESPESA",
        categoria: "OUTROS",
        descricao: "Correios / DHL internacional",
        fornecedor: "DHL",
        moeda: "BRL",
        valorPadrao: 600,
        nParcelas: 1,
        diasParaVencer: 30,
        custoOperacional: true,
        categoriaVinculada: null,
      },
    ],
  },
};

// ── Metadados leves pro seletor (key, label, contagens) ──────────────────────
export interface TemplateResumo {
  key: string;
  label: string;
  receitas: number;
  custos: number;
}

export function listarTemplates(): TemplateResumo[] {
  return Object.values(TEMPLATES_FINANCEIROS).map((t) => ({
    key: t.id,
    label: t.label,
    receitas: t.receitas.length,
    custos: t.custos.length,
  }));
}

export function getTemplate(id: string): TemplateFinanceiro | null {
  return TEMPLATES_FINANCEIROS[id] ?? null;
}