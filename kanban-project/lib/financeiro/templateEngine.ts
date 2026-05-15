// lib/financeiro/templateEngine.ts
//
// Motor de aplicação de templates financeiros — port da engine v2 do mockup
// (`_construirReceitaV2`, `_construirCustoTemplateV2`, `_construirCustoComposicaoV2`,
// `getRequerentesFinanceiros` do casa.html).
//
// É PURO: não toca no banco. Recebe um template + os requerentes do processo
// e devolve "specs" prontas pra rota `aplicar` transformar em prisma.create.
// A geração de parcelas mensais (com a última absorvendo os centavos) espelha
// `lib/financeiro/parcelas.ts` e fica aqui pra manter o engine self-contained.

import type {
  TemplateFinanceiro,
  TemplateReceitaItem,
  ComposicaoInternaTemplate,
  Moeda,
  CategoriaReceita,
  TipoCusto,
  CategoriaCusto,
} from "./templates";

// ── Entrada: requerentes do processo ─────────────────────────────────────────
export interface RequerenteEntrada {
  requerenteId: number;
  nome: string;
  dataNascimento: Date | string | null;
}

interface RequerenteClassificado {
  requerenteId: number;
  nome: string;
  idade: number | null;
  isAdulto: boolean;
}

// ── Saída: specs ─────────────────────────────────────────────────────────────
export interface ParcelaSpec {
  numero: number;
  vencimento: Date;
  valor: number;
}

export interface ReceitaRequerenteSpec {
  idx: number;
  nome: string;
  idade: number | null;
  statusFamiliar: "Adulto" | "Menor";
  percentual: number;
  requerenteId: number | null;
}

export interface ReceitaSpec {
  templateItemId: string;
  categoria: CategoriaReceita;
  descricao: string;
  moeda: Moeda;
  valor: number;
  fxRule: "FIXO";
  fxEstimado: number;
  fxFixo: number;
  fxData: Date;
  valorBrlFixo: number;
  nParcelas: number;
  data1: Date;
  periodicidade: string;
  observacoes: string;
  requerentes: ReceitaRequerenteSpec[];
  parcelas: ParcelaSpec[];
}

export interface CustoSpec {
  templateItemId: string;
  tipo: TipoCusto;
  categoria: CategoriaCusto;
  descricao: string;
  fornecedor: string | null;
  moeda: Moeda;
  valor: number;
  fxRule: "FIXO";
  fxEstimado: number;
  fxFixo: number;
  fxData: Date;
  valorBrlFixo: number;
  nParcelas: number;
  vencimento: Date;
  custoOperacional: boolean;
  categoriaVinculada: CategoriaReceita | null;
  percentualVinculado: number | null;
  observacoes: string;
  parcelas: ParcelaSpec[];
}

export interface MontagemTemplate {
  receitas: ReceitaSpec[];
  custos: CustoSpec[];
  totalAdultos: number;
  totalMenores: number;
}

export interface OpcoesAplicacao {
  /** Data ISO da 1ª parcela / referência (default: hoje). */
  dataInicial?: string;
  /** Câmbio EUR/USD -> BRL aplicado nas receitas/custos não-BRL (default: 5.5). */
  cambio?: number;
}

const OBS_TEMPLATE = "Gerado automaticamente pelo template financeiro";

// ── Utilidades de data ───────────────────────────────────────────────────────
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function addDias(base: Date, dias: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + dias);
  return d;
}

function addMeses(base: Date, meses: number): Date {
  const d = new Date(base.getTime());
  const diaOriginal = d.getDate();
  d.setMonth(d.getMonth() + meses);
  // corrige overflow (ex.: 31/jan + 1 mês -> não vira 03/mar)
  if (d.getDate() < diaOriginal) d.setDate(0);
  return d;
}

function calcularIdade(dataNasc: Date | string | null): number | null {
  if (!dataNasc) return null;
  const dn = toDate(dataNasc);
  if (isNaN(dn.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - dn.getFullYear();
  const m = hoje.getMonth() - dn.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < dn.getDate())) idade--;
  return idade;
}

// ── Geração de parcelas mensais (espelha lib/financeiro/parcelas.ts) ─────────
// Última parcela absorve o resto de centavos pra fechar o total exato.
function gerarParcelasMensais(
  valorTotal: number,
  nParcelas: number,
  dataInicial: Date,
): ParcelaSpec[] {
  const n = Math.max(1, Math.floor(nParcelas));
  const totalCentavos = Math.round(valorTotal * 100);
  const baseCentavos = Math.floor(totalCentavos / n);
  const parcelas: ParcelaSpec[] = [];
  for (let i = 0; i < n; i++) {
    const centavos =
      i === n - 1 ? totalCentavos - baseCentavos * (n - 1) : baseCentavos;
    parcelas.push({
      numero: i + 1,
      vencimento: addMeses(dataInicial, i),
      valor: centavos / 100,
    });
  }
  return parcelas;
}

// ── Câmbio por moeda (BRL = 1) ───────────────────────────────────────────────
function cambioParaMoeda(moeda: Moeda, cambio: number): number {
  return moeda === "BRL" ? 1 : cambio;
}

// ── Percentuais que somam exatamente 100 (resto na última posição) ───────────
function distribuirPercentuais(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(10000 / n) / 100;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(i === n - 1 ? Number((100 - base * (n - 1)).toFixed(2)) : base);
  }
  return out;
}

// ── Classificação de requerentes (adultos / menores) ─────────────────────────
// Espelha `getRequerentesFinanceiros`: requerente sem data de nascimento entra
// como adulto provisório.
function classificarRequerentes(reqs: RequerenteEntrada[]): {
  adultos: RequerenteClassificado[];
  menores: RequerenteClassificado[];
  todos: RequerenteClassificado[];
} {
  const adultos: RequerenteClassificado[] = [];
  const menores: RequerenteClassificado[] = [];
  const todos: RequerenteClassificado[] = [];
  for (const r of reqs) {
    const idade = calcularIdade(r.dataNascimento);
    const isAdulto = idade == null ? true : idade >= 18;
    const c: RequerenteClassificado = {
      requerenteId: r.requerenteId,
      nome: r.nome,
      idade,
      isAdulto,
    };
    todos.push(c);
    if (isAdulto) adultos.push(c);
    else menores.push(c);
  }
  return { adultos, menores, todos };
}

// ── Mapeia rubrica de composição documental -> CategoriaCusto ────────────────
function rubricaParaCategoriaCusto(rubrica: string): CategoriaCusto {
  const r = rubrica.toLowerCase();
  if (r.includes("tradu")) return "TRADUCOES_JURAMENTACOES";
  if (r.includes("apostila")) return "APOSTILAMENTOS";
  if (r.includes("honorár") || r.includes("honorar") || r.includes("advog"))
    return "HONORARIOS_ESCRITORIO";
  if (r.includes("consul") || r.includes("taxa") || r.includes("emolument"))
    return "TAXAS_CONSULARES";
  return "OUTROS";
}

// ── Construção de uma receita ────────────────────────────────────────────────
function construirReceita(
  item: TemplateReceitaItem,
  ctx: {
    dataInicial: Date;
    cambio: number;
    moedaPadrao: Moeda;
    adultos: RequerenteClassificado[];
    todos: RequerenteClassificado[];
  },
): ReceitaSpec | null {
  const targets = item.soAdultos ? ctx.adultos : ctx.todos;
  if (targets.length === 0) return null;
  // opcional com valor zerado não é criado (igual à engine v2)
  if (item.opcional && (!item.valorPadrao || item.valorPadrao <= 0)) return null;

  const moeda = item.moeda || ctx.moedaPadrao;
  const cambio = cambioParaMoeda(moeda, ctx.cambio);
  const valor = item.valorPadrao || 0;
  const percentuais = distribuirPercentuais(targets.length);

  return {
    templateItemId: item.templateItemId,
    categoria: item.categoria,
    descricao: item.descricao,
    moeda,
    valor,
    fxRule: "FIXO",
    fxEstimado: cambio,
    fxFixo: cambio,
    fxData: ctx.dataInicial,
    valorBrlFixo: Number((valor * cambio).toFixed(2)),
    nParcelas: item.nParcelas || 1,
    data1: ctx.dataInicial,
    periodicidade: "Mensal",
    observacoes: OBS_TEMPLATE,
    requerentes: targets.map((t, idx) => ({
      idx,
      nome: t.nome,
      idade: t.idade,
      statusFamiliar: t.isAdulto ? "Adulto" : "Menor",
      percentual: percentuais[idx],
      requerenteId: t.requerenteId,
    })),
    parcelas: gerarParcelasMensais(
      valor,
      item.nParcelas || 1,
      ctx.dataInicial,
    ),
  };
}

// ── Construção de um custo explícito do template ─────────────────────────────
function construirCustoTemplate(
  item: TemplateFinanceiro["custos"][number],
  ctx: { dataInicial: Date; cambio: number; moedaPadrao: Moeda },
): CustoSpec | null {
  const valor = item.valorPadrao || 0;
  if (valor <= 0) return null;

  const moeda = item.moeda || ctx.moedaPadrao;
  const cambio = cambioParaMoeda(moeda, ctx.cambio);
  const vencimento = addDias(ctx.dataInicial, item.diasParaVencer || 30);

  return {
    templateItemId: item.templateItemId,
    tipo: item.tipo,
    categoria: item.categoria,
    descricao: item.descricao,
    fornecedor: item.fornecedor,
    moeda,
    valor,
    fxRule: "FIXO",
    fxEstimado: cambio,
    fxFixo: cambio,
    fxData: ctx.dataInicial,
    valorBrlFixo: Number((valor * cambio).toFixed(2)),
    nParcelas: item.nParcelas || 1,
    vencimento,
    custoOperacional: item.custoOperacional,
    categoriaVinculada: item.categoriaVinculada,
    // não-operacional sem vínculo explícito fica null nos dois campos —
    // os custos do template que precisam de vínculo já trazem categoriaVinculada
    percentualVinculado: item.categoriaVinculada != null ? 100 : null,
    observacoes: OBS_TEMPLATE,
    parcelas: gerarParcelasMensais(valor, item.nParcelas || 1, vencimento),
  };
}

// ── Construção de custos automáticos a partir da composição de uma receita ──
function construirCustosComposicao(
  receita: ReceitaSpec,
  composicao: ComposicaoInternaTemplate,
  ctx: { dataInicial: Date; cambio: number },
): CustoSpec[] {
  const cambio = cambioParaMoeda(receita.moeda, ctx.cambio);
  const vencimento = addDias(ctx.dataInicial, 30);
  const custos: CustoSpec[] = [];

  if (composicao.tipo === "repasse_com_margem") {
    if (!composicao.valorRealRepasse || composicao.valorRealRepasse <= 0)
      return [];
    const valor = composicao.valorRealRepasse;
    custos.push({
      templateItemId: receita.templateItemId + "_repasse",
      tipo: "SERVICO",
      categoria: composicao.categoriaCusto,
      descricao: "Repasse interno automático — " + receita.descricao,
      fornecedor: composicao.fornecedorCusto || null,
      moeda: receita.moeda,
      valor,
      fxRule: "FIXO",
      fxEstimado: cambio,
      fxFixo: cambio,
      fxData: ctx.dataInicial,
      valorBrlFixo: Number((valor * cambio).toFixed(2)),
      nParcelas: 1,
      vencimento,
      custoOperacional: false,
      categoriaVinculada: receita.categoria,
      percentualVinculado: 100,
      observacoes: "Custo previsto da composição interna · " + receita.descricao,
      parcelas: gerarParcelasMensais(valor, 1, vencimento),
    });
  } else if (composicao.tipo === "composicao_documental") {
    composicao.itens.forEach((it, idx) => {
      if (!it.valor || it.valor <= 0) return;
      custos.push({
        templateItemId: receita.templateItemId + "_doc_" + idx,
        tipo: "DESPESA",
        categoria: rubricaParaCategoriaCusto(it.rubrica),
        descricao: "Custo interno — " + it.rubrica,
        fornecedor: null,
        moeda: receita.moeda,
        valor: it.valor,
        fxRule: "FIXO",
        fxEstimado: cambio,
        fxFixo: cambio,
        fxData: ctx.dataInicial,
        valorBrlFixo: Number((it.valor * cambio).toFixed(2)),
        nParcelas: 1,
        vencimento,
        custoOperacional: false,
        categoriaVinculada: receita.categoria,
        percentualVinculado: 100,
        observacoes: "Composição interna · " + receita.descricao,
        parcelas: gerarParcelasMensais(it.valor, 1, vencimento),
      });
    });
  }
  return custos;
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Monta todas as receitas e custos de um template para um processo.
 * Não toca no banco — devolve specs prontas pra prisma.create.
 */
export function montarTemplate(
  template: TemplateFinanceiro,
  requerentes: RequerenteEntrada[],
  opcoes: OpcoesAplicacao = {},
): MontagemTemplate {
  const { adultos, menores, todos } = classificarRequerentes(requerentes);
  const dataInicial = opcoes.dataInicial
    ? toDate(opcoes.dataInicial)
    : new Date();
  const cambio = opcoes.cambio && opcoes.cambio > 0 ? opcoes.cambio : 5.5;
  const moedaPadrao = template.moedaPadrao || "BRL";

  const receitas: ReceitaSpec[] = [];
  const custos: CustoSpec[] = [];

  // 1. Receitas + custos automáticos da composição interna
  for (const item of template.receitas) {
    const receita = construirReceita(item, {
      dataInicial,
      cambio,
      moedaPadrao,
      adultos,
      todos,
    });
    if (!receita) continue;
    receitas.push(receita);

    if (item.composicaoInternaTemplate) {
      const custosComp = construirCustosComposicao(
        receita,
        item.composicaoInternaTemplate,
        { dataInicial, cambio },
      );
      custos.push(...custosComp);
    }
  }

  // 2. Custos explícitos do template
  for (const item of template.custos) {
    const custo = construirCustoTemplate(item, {
      dataInicial,
      cambio,
      moedaPadrao,
    });
    if (custo) custos.push(custo);
  }

  return {
    receitas,
    custos,
    totalAdultos: adultos.length,
    totalMenores: menores.length,
  };
}

/**
 * Sugere um template a partir do país do processo.
 * Itália: se o processo tem registro de InformacaoItalia (tribunal) -> judicial,
 * caso contrário -> administrativa. Sefardita não é detectável pelo schema
 * (sem campo), então Portugal cai sempre em 'nacionalidade-portuguesa'.
 */
export function detectarTemplateSugerido(
  pais: string | null | undefined,
  temInformacaoItalia: boolean,
): string | null {
  switch (pais) {
    case "ESPANHA":
      return "cidadania-espanhola";
    case "ITALIA":
      return temInformacaoItalia
        ? "cidadania-italiana-judicial"
        : "cidadania-italiana-administrativa";
    case "PORTUGAL":
      return "nacionalidade-portuguesa";
    default:
      return null;
  }
}