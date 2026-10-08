// lib/localidade/regra-localidade.ts
// ============================================================================
// A REGRA ÚNICA DA LOCALIDADE (08/10/2026, decisão do Marco). PURA — o servidor e todas as telas leem DAQUI; nenhuma tela decide por conta própria.
//
//   BRASIL            País → Estado → Cidade → Cartório (LISTA, só cartório de verdade: tipo «cartorio»; banco, arquivo, igreja, transportadora e todo «outro» ficam FORA).
//   QUALQUER OUTRO    País (todos) → PROVÍNCIA → Cidade → Cartório em TEXTO LIVRE (só o nome digitado: sem lista, sem base nacional, sem obrigar cadastro).
//                     Província e Cidade carregam sozinhas de uma base geográfica; cidade que a base não conhece é texto livre — nunca trava o formulário.
//
// A base nacional de cartórios do Brasil (`Cartorio`, Registro Civil) e o cadastro de órgãos NUNCA aparecem para outro país.
// ============================================================================

const semAcento = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** País do registro vazio (dado legado) conta como Brasil, como sempre contou. */
export function ehPaisBrasil(pais: string | null | undefined): boolean {
  const p = semAcento(pais ?? '')
  return p === '' || p === 'brasil' || p === 'brazil' || p === 'br'
}

/** O nome da divisão administrativa: «Estado» só no Brasil; fora dele é «Província». */
export function rotuloDaDivisao(pais: string | null | undefined): 'Estado' | 'Província' {
  return ehPaisBrasil(pais) ? 'Estado' : 'Província'
}
/** O mesmo, em minúscula e com artigo, para frases de histórico/ajuda: «o estado» / «a província». */
export function termoDaDivisao(pais: string | null | undefined): { rotulo: string; comArtigo: string } {
  return ehPaisBrasil(pais) ? { rotulo: 'estado', comArtigo: 'o estado' } : { rotulo: 'província', comArtigo: 'a província' }
}

export type ModoDoCartorio = 'LISTA_DO_BRASIL' | 'TEXTO_LIVRE'
/** Brasil escolhe cartório numa lista; qualquer outro país digita o nome. */
export const modoDoCartorio = (pais: string | null | undefined): ModoDoCartorio => (ehPaisBrasil(pais) ? 'LISTA_DO_BRASIL' : 'TEXTO_LIVRE')

/** O ÚNICO tipo que entra na lista de cartórios do Brasil. «Outro» (banco, arquivo, igreja, transportadora…) nunca. */
export const TIPO_DE_CARTORIO_NA_LISTA = 'cartorio'
export const ehCartorioDaLista = (tipo: string | null | undefined): boolean => (tipo ?? '').trim().toLowerCase() === TIPO_DE_CARTORIO_NA_LISTA

/** Tipos de órgão que são registro civil (cartório e equivalentes de outros países) — para o vigia dos dados já gravados. */
export const TIPOS_DE_REGISTRO_CIVIL = ['cartorio', 'comune', 'conservatoria'] as const
export const ehOrgaoDeRegistroCivil = (tipo: string | null | undefined): boolean => (TIPOS_DE_REGISTRO_CIVIL as readonly string[]).includes((tipo ?? '').trim().toLowerCase())

/** Só o Brasil exige o cartório vinculado ao cadastro de órgãos; fora dele o nome digitado basta. */
export const exigeCartorioVinculado = (pais: string | null | undefined): boolean => ehPaisBrasil(pais)
/** Fora do Brasil só a cidade é obrigatória (a província ajuda, mas nunca trava); no Brasil, estado e cidade. */
export function localidadeCompleta(pais: string | null | undefined, estadoOuProvincia: string | null | undefined, cidade: string | null | undefined): boolean {
  const cidadeOk = (cidade ?? '').trim().length > 0
  return ehPaisBrasil(pais) ? cidadeOk && (estadoOuProvincia ?? '').trim().length > 0 : cidadeOk
}
