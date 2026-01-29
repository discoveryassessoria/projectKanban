// src/lib/diasUteis.ts
// Cálculo de dias úteis considerando feriados nacionais brasileiros

/**
 * Calcula a data da Páscoa para um determinado ano
 * Algoritmo de Meeus/Jones/Butcher
 */
function calcularPascoa(ano: number): Date {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  
  return new Date(ano, mes - 1, dia)
}

/**
 * Retorna lista de feriados nacionais brasileiros para um ano
 */
function getFeriadosNacionais(ano: number): Date[] {
  const feriados: Date[] = []
  
  // Feriados fixos
  feriados.push(new Date(ano, 0, 1))   // Ano Novo
  feriados.push(new Date(ano, 3, 21))  // Tiradentes
  feriados.push(new Date(ano, 4, 1))   // Dia do Trabalho
  feriados.push(new Date(ano, 8, 7))   // Independência
  feriados.push(new Date(ano, 9, 12))  // Nossa Senhora Aparecida
  feriados.push(new Date(ano, 10, 2))  // Finados
  feriados.push(new Date(ano, 10, 15)) // Proclamação da República
  feriados.push(new Date(ano, 11, 25)) // Natal
  
  // Feriados móveis baseados na Páscoa
  const pascoa = calcularPascoa(ano)
  
  // Carnaval: 47 dias antes da Páscoa (terça-feira)
  const carnaval = new Date(pascoa)
  carnaval.setDate(pascoa.getDate() - 47)
  feriados.push(carnaval)
  
  // Segunda-feira de Carnaval (também é feriado bancário)
  const segundaCarnaval = new Date(carnaval)
  segundaCarnaval.setDate(carnaval.getDate() - 1)
  feriados.push(segundaCarnaval)
  
  // Quarta-feira de Cinzas (meio expediente, mas bancos fecham)
  const quartaCinzas = new Date(carnaval)
  quartaCinzas.setDate(carnaval.getDate() + 1)
  feriados.push(quartaCinzas)
  
  // Sexta-feira Santa: 2 dias antes da Páscoa
  const sextaSanta = new Date(pascoa)
  sextaSanta.setDate(pascoa.getDate() - 2)
  feriados.push(sextaSanta)
  
  // Corpus Christi: 60 dias após a Páscoa
  const corpusChristi = new Date(pascoa)
  corpusChristi.setDate(pascoa.getDate() + 60)
  feriados.push(corpusChristi)
  
  return feriados
}

/**
 * Verifica se uma data é feriado nacional
 */
function isFeriado(data: Date): boolean {
  const ano = data.getFullYear()
  const feriados = getFeriadosNacionais(ano)
  
  return feriados.some(feriado => 
    feriado.getDate() === data.getDate() &&
    feriado.getMonth() === data.getMonth() &&
    feriado.getFullYear() === data.getFullYear()
  )
}

/**
 * Verifica se é fim de semana (sábado ou domingo)
 */
function isFimDeSemana(data: Date): boolean {
  const diaSemana = data.getDay()
  return diaSemana === 0 || diaSemana === 6 // 0 = Domingo, 6 = Sábado
}

/**
 * Verifica se é dia útil (não é fim de semana nem feriado)
 */
export function isDiaUtil(data: Date): boolean {
  return !isFimDeSemana(data) && !isFeriado(data)
}

/**
 * Retorna o próximo dia útil a partir de uma data
 * Se a data já for dia útil, retorna ela mesma
 */
export function proximoDiaUtil(data: Date): Date {
  const resultado = new Date(data)
  
  while (!isDiaUtil(resultado)) {
    resultado.setDate(resultado.getDate() + 1)
  }
  
  return resultado
}

/**
 * Calcula a data de vencimento de uma parcela
 * Considerando:
 * - Mês seguinte no mesmo dia (ou último dia do mês se não existir)
 * - Se cair em fim de semana ou feriado, vai para o próximo dia útil
 */
export function calcularVencimentoParcela(
  dataBase: Date, 
  numeroParcela: number
): Date {
  // Parcela 1 = data base
  if (numeroParcela === 1) {
    return proximoDiaUtil(dataBase)
  }
  
  // Para parcelas seguintes, adiciona meses
  const mesesAdicionar = numeroParcela - 1
  const diaOriginal = dataBase.getDate()
  
  // Cria nova data adicionando os meses
  const novaData = new Date(dataBase)
  novaData.setMonth(novaData.getMonth() + mesesAdicionar)
  
  // Verifica se o dia existe no novo mês
  // Por exemplo: 31 de janeiro + 1 mês = 28/29 de fevereiro
  if (novaData.getDate() !== diaOriginal) {
    // O dia não existe no mês, volta para o último dia do mês anterior
    novaData.setDate(0) // Vai para o último dia do mês anterior
  }
  
  // Ajusta para o próximo dia útil
  return proximoDiaUtil(novaData)
}

/**
 * Gera todas as datas de vencimento para um boleto parcelado
 */
export function gerarVencimentosParcelas(
  dataVencimentoInicial: Date,
  quantidadeParcelas: number
): Date[] {
  const vencimentos: Date[] = []
  
  for (let i = 1; i <= quantidadeParcelas; i++) {
    vencimentos.push(calcularVencimentoParcela(dataVencimentoInicial, i))
  }
  
  return vencimentos
}

/**
 * Formata data para exibição (dd/mm/yyyy)
 */
export function formatarDataBR(data: Date): string {
  return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

/**
 * Retorna o nome do dia da semana
 */
export function getNomeDiaSemana(data: Date): string {
  const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  return dias[data.getDay()]
}