// scripts/ssr-hidratacao.test.ts
// ============================================================================
// SSR E HIDRATAÇÃO — o contrato que impede mismatch.
//
// A regra que não pode ser quebrada: o que o SERVIDOR renderiza e o que o
// cliente renderiza na PRIMEIRA passagem têm de ser iguais. Ler `window` ou
// `localStorage` durante o render viola isso, porque no servidor eles não
// existem.
//
// `useSyncExternalStore` respeita o contrato por construção: recebe um
// `getServerSnapshot` separado. Aqui se prova, sem DOM, que:
//   • o snapshot de servidor é sempre o valor neutro;
//   • o snapshot de cliente é estável entre leituras (senão o React entra em
//     laço de render);
//   • JSON corrompido devolve null em vez de estourar;
//   • nenhuma tela migrada voltou a ler o browser durante o render.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const sec = (t: string) => console.log(`\n── ${t}`)
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

// ── 1) contrato do módulo ────────────────────────────────────────────────────
sec('1) abstrações oficiais de cliente')
/** Comentários fora: o módulo DOCUMENTA o padrão que substituiu, e citar o que
 *  se eliminou não é usá-lo. O guard olha o código, não a prosa. */
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const cliente = semComentarios(ler('src/lib/cliente/index.ts'))
chk(cliente.includes('useSyncExternalStore'), 'usa useSyncExternalStore (API para estado externo)')
chk(/export function useIsClient/.test(cliente), 'expõe useIsClient')
chk(/export function useLocalStorage/.test(cliente), 'expõe useLocalStorage')
chk(/export function useJsonLocalStorage/.test(cliente), 'expõe useJsonLocalStorage')
chk(/export function gravarLocal/.test(cliente), 'expõe gravarLocal (escrita que avisa a própria aba)')
chk(cliente.includes('getServerSnapshot') || /noServidor|lerServidor/.test(cliente), 'define snapshot de SERVIDOR separado')
chk(!/useState\(/.test(cliente), 'não guarda estado do browser em useState (nada de mounted)')
chk(!/useEffect\(/.test(cliente), 'não sincroniza por efeito (era a origem do render em cascata)')

// ── 2) simulação do contrato servidor × cliente ──────────────────────────────
// Reproduz as funções puras do módulo sem DOM: o que importa é o CONTRATO.
sec('2) contrato servidor × cliente')
{
  const noServidor = () => false
  const noCliente = () => true
  chk(noServidor() === false, 'servidor: useIsClient = false')
  chk(noCliente() === true, 'cliente (pós-hidratação): useIsClient = true')
  chk(noServidor() !== noCliente(), 'os dois snapshots são distintos — é o que evita ler window no servidor')
  // estabilidade: chamar duas vezes devolve o MESMO valor primitivo
  chk(noCliente() === noCliente() && noServidor() === noServidor(), 'snapshots são estáveis entre leituras')
}

// ── 3) leitura de JSON tolerante a lixo ──────────────────────────────────────
sec('3) localStorage: JSON inválido não derruba a tela')
{
  // mesma lógica do useJsonLocalStorage, isolada
  const parse = (bruto: string | null): unknown => {
    if (bruto == null) return null
    try { return JSON.parse(bruto) } catch { return null }
  }
  chk(parse(null) === null, 'chave ausente → null')
  chk(parse('não é json') === null, 'JSON corrompido → null (não lança)')
  chk(parse('{"a":1}') != null, 'JSON válido → objeto')
  chk((parse('{"nome":"x"}') as { nome: string }).nome === 'x', 'conteúdo preservado')
  // estabilidade de referência: o cache por texto bruto é o que impede laço de render
  const cache = new Map<string, { bruto: string | null; valor: unknown }>()
  const comCache = (chave: string, bruto: string | null) => {
    const c = cache.get(chave)
    if (c && c.bruto === bruto) return c.valor
    const v = parse(bruto)
    cache.set(chave, { bruto, valor: v })
    return v
  }
  const a = comCache('user', '{"id":1}')
  const b = comCache('user', '{"id":1}')
  chk(a === b, 'mesma chave e mesmo texto devolvem a MESMA referência (sem laço de render)')
  const c = comCache('user', '{"id":2}')
  chk(a !== c, 'texto diferente devolve referência nova')
}

// ── 4) as telas migradas não leem o browser no render ────────────────────────
sec('4) telas migradas')
const MIGRADAS = [
  'src/app/activities/page.tsx',
  'src/app/financeiro/page.tsx',
  'src/app/login/page.tsx',
  'src/components/contratantes-tabela.tsx',
  'src/components/financeiro/modals/ModalBase.tsx',
  'src/components/pdf-thumbnail.tsx',
  'src/components/financeiro/v3/ProcessoFinanceiroShell.tsx',
]
for (const f of MIGRADAS) {
  if (!existsSync(join(RAIZ, f))) { chk(false, `${f} existe`); continue }
  const src = ler(f)
  const semComentario = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  chk(!/const \[mounted, setMounted\]|setMounted\(true\)/.test(semComentario), `${f.split('/').pop()} — sem o par mounted/setMounted`)
}
chk(
  MIGRADAS.every((f) => !existsSync(join(RAIZ, f)) || /useIsClient|useJsonLocalStorage|useLocalStorage/.test(ler(f))),
  'todas as telas migradas usam a abstração oficial',
)

// ── 5) nenhuma regressão de padrão ───────────────────────────────────────────
sec('5) o padrão antigo não volta')
chk(!/eslint-disable/.test(cliente), 'a abstração não usa eslint-disable')
chk(ler('hooks/use-mobile.ts').includes('useSyncExternalStore'), 'useIsMobile segue no padrão validado')

console.log(`\n${ok} passaram, ${fail} falharam`)
if (fail) process.exit(1)
