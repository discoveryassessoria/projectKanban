// scripts/ci/postgres-efemero.mjs
// ============================================================================
// UM POSTGRES REAL, DESCARTÁVEL — para o build de produção poder rodar a suíte crítica
// contra banco de verdade (nunca mock), sem depender de serviço externo.
//
// Usa os binários oficiais do pacote `embedded-postgres` (initdb/pg_ctl/postgres, com as
// extensões contrib — o baseline usa `btree_gist`). Provado no build da Vercel (Amazon Linux
// 2023, root, 30 cores/60 GB): o Postgres recusa rodar como root, então, sendo root, copiamos
// os binários para fora de `/vercel/path0`, criamos um usuário sem privilégio e subimos o
// servidor COM ELE. fsync desligado: é banco descartável, velocidade é o objetivo.
//
// Não escuta em nada além de 127.0.0.1 e morre com o processo (`parar()` + saída do node).
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SO = `${process.platform}-${process.arch}`

export function localizarBinarios() {
  const nativo = join(RAIZ, 'node_modules', '@embedded-postgres', SO, 'native')
  if (!existsSync(join(nativo, 'bin', 'initdb'))) {
    throw new Error(`binários do Postgres efêmero ausentes para ${SO}: ${nativo} — instale o devDependency "embedded-postgres".`)
  }
  return nativo
}

/**
 * Recria os symlinks das bibliotecas (`libpq.so.5 → libpq.so.5.x` etc.). O pacote os grava em
 * `native/pg-symlinks.json` e os recria num `postinstall`; quando as dependências vêm de CACHE
 * (build da Vercel) o postinstall não roda e o `initdb` morre com "libpq.so.5: cannot open shared
 * object file". Idempotente: o que já existe é ignorado.
 */
export function hidratarSymlinks(nativo) {
  const arquivo = join(nativo, 'pg-symlinks.json')
  if (!existsSync(arquivo)) return 0
  const raizPacote = dirname(nativo)
  let criados = 0
  for (const { source, target } of JSON.parse(readFileSync(arquivo, 'utf8'))) {
    const destino = join(raizPacote, target)
    try { symlinkSync(basename(source), destino); criados++ } catch { /* já existe */ }
  }
  return criados
}

export async function subirPostgresEfemero({ porta = 55432 } = {}) {
  let nativo = localizarBinarios()
  hidratarSymlinks(nativo)
  const root = typeof process.getuid === 'function' && process.getuid() === 0
  const usuarioSo = 'pgci'
  let uid, gid
  const base = mkdtempSync(join(tmpdir(), 'pg-efemero-'))
  const dados = join(base, 'dados'); const sock = join(base, 'sock'); const log = join(base, 'pg.log')

  if (root) {
    // Fora de /vercel/path0 (o usuário sem privilégio não lê lá) e legível por todos.
    const copia = '/opt/pg-efemero-nativo'
    rmSync(copia, { recursive: true, force: true })
    cpSync(nativo, copia, { recursive: true, verbatimSymlinks: true })
    execFileSync('chmod', ['-R', 'a+rX', copia])
    nativo = copia
    try { execFileSync('id', [usuarioSo], { stdio: 'ignore' }) } catch { execFileSync('useradd', ['-m', usuarioSo]) }
    uid = Number(execFileSync('id', ['-u', usuarioSo], { encoding: 'utf8' }))
    gid = Number(execFileSync('id', ['-g', usuarioSo], { encoding: 'utf8' }))
    chmodSync(base, 0o755)
  }
  mkdirSync(dados, { recursive: true }); mkdirSync(sock, { recursive: true })
  if (root) execFileSync('chown', ['-R', `${uid}:${gid}`, dados, sock, base]), chmodSync(dados, 0o700)
  else chmodSync(dados, 0o700)

  const env = { PATH: process.env.PATH, LC_ALL: 'C', LD_LIBRARY_PATH: join(nativo, 'lib'), DYLD_LIBRARY_PATH: join(nativo, 'lib') }
  const rodar = (bin, args) => {
    const r = spawnSync(join(nativo, 'bin', bin), args, { encoding: 'utf8', env, ...(root ? { uid, gid } : {}) })
    if (r.status !== 0) throw new Error(`${bin} falhou (exit ${r.status}):\n${r.stdout}\n${r.stderr}`)
    return r.stdout
  }
  rodar('initdb', ['-D', dados, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'])
  rodar('pg_ctl', ['-D', dados, '-w', '-l', log, '-o',
    `-p ${porta} -k ${sock} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=400 -c shared_buffers=256MB`,
    'start'])

  let parado = false
  const parar = () => {
    if (parado) return; parado = true
    try { rodar('pg_ctl', ['-D', dados, '-m', 'immediate', 'stop']) } catch { /* já parado */ }
    try { rmSync(base, { recursive: true, force: true }) } catch { /* ignora */ }
  }
  process.on('exit', parar)
  return { host: '127.0.0.1', porta, usuario: 'postgres', parar }
}
