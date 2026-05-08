// lib/financeiro/parcelas.ts
// Geração das parcelas a partir de valor total, número de parcelas e data inicial.
// Mantém a periodicidade mensal (única suportada pelo HTML do Marco).
// A última parcela absorve o resto de centavos pra fechar o total exato.

export type ParcelaInput = {
  numero: number;
  vencimento: Date;
  valor: number;
};

export function gerarParcelas(
  valorTotal: number,
  nParcelas: number,
  data1: Date
): ParcelaInput[] {
  if (nParcelas < 1) {
    throw new Error("nParcelas deve ser >= 1");
  }
  if (valorTotal <= 0) {
    throw new Error("valorTotal deve ser > 0");
  }

  // Trabalha em centavos pra evitar erro de ponto flutuante
  const totalCentavos = Math.round(valorTotal * 100);
  const baseCentavos = Math.floor(totalCentavos / nParcelas);
  const restoCentavos = totalCentavos - baseCentavos * nParcelas;

  const parcelas: ParcelaInput[] = [];
  for (let i = 0; i < nParcelas; i++) {
    const venc = addMonths(data1, i);
    // A última parcela absorve o resto (pode ter centavos a mais)
    const centavos =
      i === nParcelas - 1 ? baseCentavos + restoCentavos : baseCentavos;
    parcelas.push({
      numero: i + 1,
      vencimento: venc,
      valor: centavos / 100,
    });
  }
  return parcelas;
}

/**
 * Adiciona N meses preservando o dia. Se o mês destino não tiver o dia
 * (ex: 31 de jan + 1 mês), cai pro último dia do mês destino.
 */
function addMonths(data: Date, n: number): Date {
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth();
  const dia = data.getUTCDate();

  const novoMes = mes + n;
  const novaData = new Date(Date.UTC(ano, novoMes, 1));
  // Tenta colocar o dia original; se estourar o mês, ajusta pro último dia
  const ultimoDiaMes = new Date(
    Date.UTC(novaData.getUTCFullYear(), novaData.getUTCMonth() + 1, 0)
  ).getUTCDate();
  novaData.setUTCDate(Math.min(dia, ultimoDiaMes));
  return novaData;
}
