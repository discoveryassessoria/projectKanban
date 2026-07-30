// Superfície pública do módulo da Árvore Genealógica.
//
// Exporta SÓ o que outra parte do sistema monta. O barrel antigo reexportava
// cinco componentes de uma implementação anterior (cards e sidebar em tema
// escuro) que ninguém renderizava mais: continuavam no bundle e mantinham vivo
// o visual reprovado, prontos para reaparecer numa importação distraída.
// Foram removidos do disco, não apenas do barrel.
export { ArvoreGenealogicaView } from "./arvore-genealogica-view"
export type { PessoaArvore, UniaoArvore } from "./types"
