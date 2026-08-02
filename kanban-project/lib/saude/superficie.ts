// lib/saude/superficie.ts
//
// DESCOBERTA AUTOMÁTICA DE SUPERFÍCIE.
//
// O sistema precisa saber tudo o que DEVERIA estar verificando. Aqui a
// superfície real é descoberta por varredura (rotas, páginas, menus, entidades,
// crons, tipos de evento) e comparada com o catálogo de verificações e de
// capacidades. O que sobra é lacuna de cobertura — e lacuna impede declarar
// o sistema saudável.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { catalogo } from './catalogo'
import { capacidades } from './capacidades'
import { TIPOS_DRENADOS } from '@/src/services/outbox-dispatcher'

const RAIZ = process.cwd()
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const existe = (p: string) => existsSync(join(RAIZ, p))

function varrer(dir: string, filtro: (p: string) => boolean, limite = 5000): string[] {
  const raiz = join(RAIZ, dir)
  if (!existsSync(raiz)) return []
  const achados: string[] = []
  const pilha = [raiz]
  while (pilha.length && achados.length < limite) {
    const atual = pilha.pop()!
    for (const nome of readdirSync(atual)) {
      if (nome === 'node_modules' || nome === '.next' || nome.startsWith('.')) continue
      const caminho = join(atual, nome)
      if (statSync(caminho).isDirectory()) pilha.push(caminho)
      else if (filtro(caminho)) achados.push(caminho.replace(RAIZ + '/', ''))
    }
  }
  return achados
}

export interface Superficie {
  paginas: string[]
  apis: string[]
  apisAdministrativas: string[]
  telasGerenciamento: string[]
  itensDeMenu: string[]
  entidades: string[]
  crons: string[]
  tiposEvento: string[]
  servicos: string[]
}

/** Fotografa o que o sistema EXPÕE hoje. */
export function mapearSuperficie(): Superficie {
  const paginas = varrer('src/app', (p) => p.endsWith('/page.tsx'))
    .map((p) => '/' + p.replace('src/app/', '').replace('/page.tsx', ''))
    .filter((p) => !p.includes('('))
  const apis = varrer('src/app/api', (p) => p.endsWith('route.ts'))
    .map((p) => '/' + p.replace('src/app/', '').replace('/route.ts', ''))
  const nav = existe('src/components/gerenciamentoComponents/managementNavigation.tsx')
    ? ler('src/components/gerenciamentoComponents/managementNavigation.tsx') : ''
  const page = existe('src/app/administrator/page.tsx') ? ler('src/app/administrator/page.tsx') : ''
  const bloco = page.split('const TELAS: Record<string, React.ComponentType>')[1]?.split('\n}')[0] ?? ''
  const schema = existe('prisma/schema.prisma') ? ler('prisma/schema.prisma') : ''
  const vercel = existe('vercel.json') ? JSON.parse(ler('vercel.json')) as { crons?: { path: string }[] } : {}

  return {
    paginas,
    apis,
    apisAdministrativas: apis.filter((a) => a.includes('/api/gerenciamento/')),
    telasGerenciamento: [...new Set([...bloco.matchAll(/^\s{2}"?([a-zA-Z_][\w-]*)"?:/gm)].map((m) => m[1]))],
    itensDeMenu: [...new Set([...nav.matchAll(/\ba\(\s*\d+\s*,\s*"([\w-]+)"/g)].map((m) => m[1]))],
    entidades: [...new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]))],
    crons: (vercel.crons ?? []).map((c) => c.path),
    tiposEvento: [...TIPOS_DRENADOS],
    servicos: varrer('src/services', (p) => p.endsWith('.ts')).map((p) => p.replace('src/services/', '')),
  }
}

export interface LacunaCobertura {
  tipo: 'ROTA' | 'API' | 'MENU' | 'ENTIDADE' | 'CRON' | 'MODULO' | 'CAPACIDADE'
  alvo: string
  detalhe: string
}

/**
 * Compara a superfície com o que é verificado. Uma lacuna aqui NÃO é
 * necessariamente um defeito — é falta de VIGILÂNCIA, e por isso mantém o
 * diagnóstico incompleto em vez de saudável.
 */
export function lacunasDeCobertura(s: Superficie): LacunaCobertura[] {
  const lacunas: LacunaCobertura[] = []

  // texto de todas as verificações e capacidades, para procurar menção ao alvo
  const textoVerificacoes = catalogo().map((v) => `${v.codigo} ${v.nome} ${v.descricao} ${v.modulo} ${v.rotaCorrecao ?? ''}`).join(' ').toLowerCase()
  const textoCapacidades = capacidades().map((c) =>
    `${c.codigo} ${c.nome} ${c.descricao} ${c.modulo} ${c.dependencias.map((d) => `${d.nome} ${d.rota ?? ''}`).join(' ')}`,
  ).join(' ').toLowerCase()
  // acento não pode gerar lacuna falsa: "/api/cron/cambio" precisa casar com
  // uma verificação chamada "Câmbio com cotação recente".
  const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const vigiado = semAcento(`${textoVerificacoes} ${textoCapacidades}`)

  // crons sem monitoramento declarado
  for (const c of s.crons) {
    if (!vigiado.includes(semAcento(c.toLowerCase().replace('/api/cron/', '')))) {
      lacunas.push({ tipo: 'CRON', alvo: c, detalhe: 'job agendado sem verificação de saúde que o vigie' })
    }
  }

  // menus sem tela registrada (defeito real, não só lacuna)
  const telas = new Set(s.telasGerenciamento)
  const aliasSrc = existe('src/app/administrator/page.tsx')
    ? (ler('src/app/administrator/page.tsx').match(/ALIAS_TELAS: Record<string, string> = \{([^}]*)\}/)?.[1] ?? '')
    : ''
  const aliases = new Set([...aliasSrc.matchAll(/"?([\w-]+)"?\s*:/g)].map((m) => m[1]))
  for (const item of s.itensDeMenu) {
    if (!telas.has(item) && !aliases.has(item)) {
      lacunas.push({ tipo: 'MENU', alvo: item, detalhe: 'item de menu sem tela registrada nem alias' })
    }
  }

  // módulos de negócio sem capacidade declarada
  const modulosEsperados = ['Processos', 'Documentos', 'Financeiro', 'Usuários e Acessos', 'Comunicações', 'Relatórios']
  const modulosCobertos = new Set(capacidades().map((c) => c.modulo))
  for (const m of modulosEsperados) {
    if (!modulosCobertos.has(m)) {
      lacunas.push({ tipo: 'MODULO', alvo: m, detalhe: 'módulo de negócio sem nenhuma capacidade operacional declarada' })
    }
  }

  return lacunas
}

/** Matriz módulo × cobertura, para a aba Cobertura da tela. */
export interface LinhaMatriz {
  modulo: string
  capacidades: number
  capacidadesProntas: number
  verificacoes: number
  temTesteFuncional: boolean
}

export function matrizCobertura(prontas: Set<string>): LinhaMatriz[] {
  const modulos = new Set([...capacidades().map((c) => c.modulo), ...catalogo().map((v) => v.modulo.split(' /')[0])])
  return [...modulos].sort().map((modulo) => {
    const caps = capacidades().filter((c) => c.modulo === modulo)
    return {
      modulo,
      capacidades: caps.length,
      capacidadesProntas: caps.filter((c) => prontas.has(c.codigo)).length,
      verificacoes: catalogo().filter((v) => v.modulo.startsWith(modulo)).length,
      temTesteFuncional: caps.length > 0,
    }
  })
}
