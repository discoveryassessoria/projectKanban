// scripts/wizard-multiselect-guard.test.ts
// ============================================================================
// GUARDA — travamento do wizard ao abrir um seletor múltiplo.
//
// CAUSA REAL do bug relatado (etapa "Aplicabilidade"):
//   o menu era `position:absolute` dentro do card (Secao) e do modal, ambos com
//   overflow. Resultado: menu CORTADO pelo card, desenhado por cima do bloco
//   seguinte ("Restrições operacionais"), sem criar espaço, e o modal inteiro
//   com `overflow-auto` competindo com o menu — a etapa parecia travada.
//
// CORREÇÃO: menu em PORTAL no <body> com `position:fixed` medido a partir do
// campo (abre acima quando não há espaço abaixo, sempre dentro da viewport, com
// scroll interno e altura máxima), SEM backdrop de tela inteira, desmontado ao
// fechar; e o modal virou coluna flex (header fixo / corpo rolável / footer fixo).
//
// (1) posicionamento e limites do menu
// (2) sem overlay residual / sem listener órfão
// (3) um seletor aberto por vez e fechamento em toda troca de etapa
// (4) casca do modal: header/corpo/footer, sem corte de menu
// (5) teclado e acessibilidade
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

const ui = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/pagamentoUI.tsx'), 'utf8')
const taxa = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx'), 'utf8')
const cond = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx'), 'utf8')
const menu = ui.slice(ui.indexOf('const menu = aberto'), ui.indexOf('return (\n    <div ref={raiz}'))

sec('1 — o menu não é mais cortado nem sobrepõe o bloco seguinte')
{
  ok('menu vai para PORTAL no body', ui.includes("import { createPortal } from 'react-dom'") && ui.includes('document.body'))
  ok('posicionamento fixo em coordenadas de viewport', menu.includes("position: 'fixed'"))
  ok('não usa mais absolute dentro do card', !menu.includes('className="absolute'))
  ok('abre acima quando não há espaço abaixo', ui.includes('const acima = espacoAbaixo < 240 && espacoAcima > espacoAbaixo'))
  ok('altura máxima entre 240 e 320px', ui.includes('Math.min(320'))
  ok('nunca ultrapassa a lateral da janela', ui.includes('window.innerWidth - margem - width') && ui.includes('if (left < margem) left = margem'))
  ok('scroll interno na lista de opções', ui.includes('overflow-y-auto'))
  ok('acima do modal (z-index alto)', menu.includes('zIndex: 120'))
  ok('reposiciona no scroll e no resize', ui.includes("window.addEventListener('scroll', reposicionar, true)") && ui.includes("window.addEventListener('resize', reposicionar)"))
}

sec('2 — nenhum overlay residual capturando cliques')
{
  ok('sem backdrop de tela inteira no seletor', !menu.includes('inset-0') && !menu.includes('fixed inset-0'))
  ok('menu é DESMONTADO ao fechar (não fica escondido)', ui.includes('const menu = aberto && pos') && ui.includes('{menu}'))
  ok('sem pointer-events forçado', !ui.includes('pointerEvents'))
  ok('listeners removidos no cleanup', ui.includes("document.removeEventListener('mousedown', fora)") && ui.includes("document.removeEventListener('keydown', tecla)") && ui.includes("window.removeEventListener('scroll', reposicionar, true)"))
  ok('registro limpo no unmount', ui.includes('React.useEffect(() => () => { abertos.delete(fecharRef.current) }, [])'))
  ok('fecha ao clicar fora (campo e menu)', ui.includes('raiz.current?.contains(alvo)') && ui.includes('menuRef.current?.contains(alvo)'))
  ok('fecha com Escape', ui.includes("if (e.key === 'Escape') fecharRef.current()"))
}

sec('3 — um seletor aberto por vez; troca de etapa fecha tudo')
{
  ok('registro central de seletores abertos', ui.includes('const abertos = new Set<() => void>()'))
  ok('abrir um fecha os outros', ui.includes('fecharTodosMultiSelects() // só um seletor aberto por vez'))
  ok('helper exportado para o wizard', ui.includes('export function fecharTodosMultiSelects()'))

  for (const [nome, src] of [['Taxa', taxa], ['Condição', cond]] as const) {
    // Avançar SEMPRE fecha os menus e valida a etapa 1 (inline no botão OU num
    // handler `proximo()` extraído — o que importa é o comportamento).
    ok(`${nome}: Próximo fecha os menus antes de avançar`, /fecharTodosMultiSelects\(\)[\s\S]{0,80}if \(step === 1/.test(src))
    ok(`${nome}: Voltar fecha os menus`, src.includes('const irPara = (n: number) => { fecharTodosMultiSelects(); setStep(n) }') && src.includes('irPara(step - 1)'))
    ok(`${nome}: fechar o wizard reseta os menus`, src.includes('fecharTodosMultiSelects(); onClose()'))
  }
  ok('fechar o modal limpa o estado aberto', ui.includes('return () => { document.removeEventListener(\'keydown\', tecla); fecharTodosMultiSelects() }'))
  ok('Escape do modal não conflita com o do menu', ui.includes("if (e.key === 'Escape' && !abertos.size) onClose()"))
}

sec('4 — casca do wizard: header fixo, corpo rolável, footer fixo')
{
  ok('ModalWizard existe no shell', ui.includes('export function ModalWizard'))
  ok('altura máxima da viewport', ui.includes('max-h-[90vh]'))
  ok('coluna flex', ui.includes('flex max-h-[90vh] w-full ${largura} flex-col'))
  ok('header e footer sem shrink', (ui.match(/shrink-0/g) || []).length >= 2)
  ok('corpo rolável (não depende do body)', ui.includes('min-h-0 flex-1 space-y-4 overflow-y-auto'))
  ok('modal não corta os menus (sem overflow-hidden no container)', !/flex max-h-\[90vh\][^"]*overflow-hidden/.test(ui))

  for (const [nome, src] of [['Taxa', taxa], ['Condição', cond]] as const) {
    ok(`${nome}: usa a casca compartilhada`, src.includes('<ModalWizard'))
    ok(`${nome}: não tem mais modal com overflow-auto`, !src.includes('max-h-[92vh] w-full max-w-2xl overflow-auto'))
    ok(`${nome}: footer sempre acessível (Voltar/Próximo)`, src.includes('footer={') && src.includes('Próximo') && src.includes('Voltar'))
  }
}

sec('5 — teclado e acessibilidade')
{
  ok('combobox anunciado', ui.includes('role="combobox"') && ui.includes('aria-expanded={aberto}'))
  ok('listbox multisselecionável', ui.includes('role="listbox"') && ui.includes('aria-multiselectable'))
  ok('setas, Home/End, Enter/Espaço', ui.includes("'ArrowDown'") && ui.includes("'ArrowUp'") && ui.includes("'Home'") && ui.includes("'End'"))
  ok('Espaço na busca não seleciona opção', ui.includes("e.key === ' ' && e.target !== buscaRef.current"))
  ok('chip removível tem rótulo acessível', ui.includes('aria-label={`Remover ${o.label}`}'))
  ok('opção marca aria-selected', ui.includes('aria-selected={on}'))
  ok('tema escuro respeitado', ui.includes('bg-zinc-900') && ui.includes('OURO'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Wizard × MultiSelect (travamento/overflow): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
