// src/components/financeiro/modals/ComprovanteModal.tsx
"use client"

import { ModalBase } from "./ModalBase"

interface Props {
  url: string
  nome: string
  onClose: () => void
}

export function ComprovanteModal({ url, nome, onClose }: Props) {
  const ehPDF = url.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")

  return (
    <ModalBase
      title="Comprovante de Pagamento"
      subtitle={nome}
      icon="📎"
      color="green"
      size="xl"
      onClose={onClose}
      footer={
        <>
          {url && (
            <a href={url} download={nome} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm">
              ⬇ Baixar
            </a>
          )}
          <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Fechar</button>
        </>
      }
    >
      <div className="text-center">
        {!url ? (
          <div className="py-12 text-gray-500">Nenhum arquivo anexado</div>
        ) : ehPDF ? (
          <iframe src={url} className="w-full h-[60vh] border rounded-lg" />
        ) : (
          <img src={url} alt={nome} className="max-w-full max-h-[60vh] mx-auto rounded-lg" />
        )}
      </div>
    </ModalBase>
  )
}