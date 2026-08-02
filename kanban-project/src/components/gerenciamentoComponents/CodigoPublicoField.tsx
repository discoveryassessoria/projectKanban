// src/components/gerenciamentoComponents/CodigoPublicoField.tsx
//
// PADRÃO OFICIAL do Discovery: no topo de todo formulário de cadastro mestre que
// possua publicCode, mostrar o CÓDIGO PÚBLICO em modo SOMENTE LEITURA.
//   - registro novo (sem código ainda) → "Será gerado automaticamente ao salvar."
//   - registro salvo → o código definitivo (CLI-1, SRV-1, DOC1, FOR-1, USR-4...).
// A chave técnica interna NUNCA aparece. O usuário nunca digita identificadores.

export function CodigoPublicoField({
  codigo,
  className = "",
}: {
  codigo?: string | null
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs text-white/60">Código</label>
      {codigo ? (
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm font-bold text-white/80">
          {codigo}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] px-3 py-2 text-sm italic text-white/40">
          Será gerado automaticamente ao salvar.
        </div>
      )}
    </div>
  )
}
