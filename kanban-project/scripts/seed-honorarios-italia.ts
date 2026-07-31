// scripts/seed-honorarios-italia.ts
// Cadastro OFICIAL e IDEMPOTENTE dos Honorários Contratuais — Cidadania Italiana.
// Reutiliza as entidades oficiais: ServicoProduto + ItemCatalogo + ProdutoFinanceiro
// (Config Financeira RECEITA/EUR) + TabelaValor (valorBase + valorAdicional). Sem
// estrutura paralela, sem hardcode no motor. Rodar novamente NÃO duplica.
import { prisma } from "@/lib/prisma";
import { sincronizarItemDeServico } from "@/src/services/catalogo-sync";
import { garantirConfigFinanceiraDeServico } from "@/src/services/config-financeira-auto";
import { slugTecnico, gerarChaveUnica } from "@/src/lib/catalogo/chave-tecnica-interna";
import { garantirCategoriasServico } from "@/prisma/categorias-servico-oficiais";
const p: any = prisma;

const NOME = "Honorários Contratuais — Cidadania Italiana";
const VALOR_BASE = 6290.0;
const VALOR_ADICIONAL = 1640.0;

async function main() {
  // Cadastros oficiais primeiro — o serviço referencia por id.
  const categorias = await garantirCategoriasServico(p);
  const categoriaId = categorias.get("CIDNAC") ?? null;
  const paisItalia = await p.catalogoPais.findFirst({ where: { countryKey: "italia" }, select: { id: true } });
  if (!paisItalia) throw new Error('País "italia" não está em CatalogoPais. Cadastre em Gerenciamento › Países e Regiões antes de rodar o seed.');

  // 1) Serviço (find-or-create por nome)
  let servico = await p.servicoProduto.findFirst({ where: { name: NOME } });
  if (!servico) {
    const code = await gerarChaveUnica(slugTecnico(NOME, "SERVICO"), async (c: string) =>
      !!(await p.servicoProduto.findUnique({ where: { code: c }, select: { id: true } })) ||
      !!(await p.itemCatalogo.findUnique({ where: { code: c }, select: { id: true } })));
    const itemCatalogoId = await sincronizarItemDeServico(p, { code, name: NOME, categoriaId });
    servico = await p.servicoProduto.create({ data: { code, name: NOME, aplicacaoGlobal: false, ativo: true, itemCatalogoId } });
  }
  // APLICAÇÃO TERRITORIAL — Itália, por vínculo real. Idempotente.
  await p.servicoProduto.update({ where: { id: servico.id }, data: { aplicacaoGlobal: false } });
  await p.servicoProdutoPais.deleteMany({ where: { servicoId: servico.id, paisId: { not: paisItalia.id } } });
  await p.servicoProdutoPais.createMany({ data: [{ servicoId: servico.id, paisId: paisItalia.id }], skipDuplicates: true });

  console.log(`Serviço: ${servico.publicCode ?? "?"} — ${servico.name} (id ${servico.id}, item ${servico.itemCatalogoId})`);

  // 2) Config Financeira (idempotente por itemCatalogoId) — natureza RECEITA, moeda EUR
  const cfg = await garantirConfigFinanceiraDeServico(p, { itemCatalogoId: servico.itemCatalogoId, nome: NOME });
  await p.produtoFinanceiro.update({ where: { id: cfg.id }, data: {
    possuiReceita: true, possuiCusto: false, moedaPadrao: "EUR", ativo: true,
  } });
  console.log(`Config Financeira: id ${cfg.id} (RECEITA, EUR)`);

  // 3) Tabela de Preços — valorBase + valorAdicional (find-or-update por modoCalculo)
  let preco = await p.tabelaValor.findFirst({ where: { modoCalculo: "honorario_por_requerente", natureza: "VENDA", arquivado: false } });
  const dadosPreco = {
    name: NOME, natureza: "VENDA", modoCalculo: "honorario_por_requerente",
    valor: VALOR_BASE, valorBase: VALOR_BASE, valorAdicional: VALOR_ADICIONAL,
    unidade: "requerente", itemCatalogoId: servico.itemCatalogoId, configuracaoFinanceiraItemId: cfg.id,
    prioridade: 100, arquivado: false, legadoPendente: false,
  };
  if (!preco) { preco = await p.tabelaValor.create({ data: dadosPreco }); }
  else { preco = await p.tabelaValor.update({ where: { id: preco.id }, data: dadosPreco }); }
  console.log(`Tabela de Preços: id ${preco.id} — base €${preco.valorBase} + adicional €${preco.valorAdicional}/requerente`);

  // 4) Câmbio EUR→BRL ativo (necessário p/ o motor lançar; senão vira pendência)
  const cot = await p.cotacaoCambio.findFirst({ where: { moedaDe: "EUR", moedaPara: "BRL", ativo: true } });
  if (!cot) {
    await p.cotacaoCambio.create({ data: { moedaDe: "EUR", moedaPara: "BRL", taxa: 6.2, ativo: true } });
    console.log("Câmbio EUR→BRL: criado (6,20)");
  } else {
    console.log(`Câmbio EUR→BRL: já existe (${cot.taxa})`);
  }

  console.log("✅ Seed idempotente concluído.");
  await (prisma as any).$disconnect();
}
main().catch(async (e) => { console.error("ERRO:", e); await (prisma as any).$disconnect(); process.exit(1); });
