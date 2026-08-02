// tests/ui/telas.ts
//
// A suíte de interface não mantém lista própria de telas: ela lê a NAVEGAÇÃO
// OFICIAL. Assim, item de menu novo entra em teste no mesmo commit em que
// nasce, e item removido sai sozinho — sem segunda fonte de verdade.

import { MANAGEMENT_NAVIGATION, type ManagementNavigationItem } from '@/src/components/gerenciamentoComponents/managementNavigation'

export interface TelaDeTeste {
  /** chave do deep-link ?screen= */
  screen: string
  /** rótulo exibido no menu */
  rotulo: string
  /** módulo a que pertence */
  modulo: string
}

function coletar(item: ManagementNavigationItem, modulo: string, saida: TelaDeTeste[]) {
  // Módulo sem submenu declara `screen`; item de folha usa a própria `key`
  // como chave do deep-link — é assim que `moduloDaScreen` resolve.
  const chave = item.screen ?? (item.children?.length ? undefined : item.key)
  if (item.status === 'active' && chave) {
    saida.push({ screen: chave, rotulo: item.label, modulo })
  }
  for (const filho of item.children ?? []) coletar(filho, modulo, saida)
}

/** Toda tela ATIVA alcançável pelo menu oficial do Gerenciamento. */
export function telasAtivas(): TelaDeTeste[] {
  const saida: TelaDeTeste[] = []
  for (const modulo of MANAGEMENT_NAVIGATION) {
    if (modulo.status !== 'active') continue
    coletar(modulo, modulo.fullLabel ?? modulo.label, saida)
  }
  // deduplica por screen mantendo a primeira ocorrência (a do menu)
  const vistas = new Set<string>()
  return saida.filter((t) => (vistas.has(t.screen) ? false : (vistas.add(t.screen), true)))
}

/**
 * Ruído conhecido do navegador que NÃO é defeito da tela: extensões, avisos de
 * desenvolvimento do React/Next e falhas de rede de recurso externo.
 *
 * A lista é curta de propósito. Silenciar erro em massa transformaria este
 * teste no mesmo tipo de mentira que o painel de saúde existe para combater.
 */
export const RUIDO_CONSOLE = [
  'Download the React DevTools',
  'Warning: ReactDOM.render',
  'hydrat', // aviso de hidratação do modo dev do Next
  'favicon',
  'net::ERR_ABORTED',
  'Failed to load resource: the server responded with a status of 404',
]

export const ehRuido = (texto: string) => RUIDO_CONSOLE.some((r) => texto.toLowerCase().includes(r.toLowerCase()))
