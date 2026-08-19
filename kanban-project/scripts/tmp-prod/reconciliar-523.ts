// Executa o RECONCILIADOR CANÔNICO sobre o estado real do processo 523.
// Não força nada: se o gate estiver fechado, ele explica e não escreve.
import { reconciliarMotorDeFases } from '../../src/lib/motor/reconciliar-motor-fases'
async function main() {
  const d = await reconciliarMotorDeFases(523, { origem: 'reconciliacao-manual-523' })
  console.log(JSON.stringify(d, null, 2))
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
