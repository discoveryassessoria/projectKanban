"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { FileText } from "lucide-react"

// Importar react-pdf dinamicamente só no cliente
const Document = dynamic(
  () => import("react-pdf").then((mod) => mod.Document),
  { ssr: false }
)

const Page = dynamic(
  () => import("react-pdf").then((mod) => mod.Page),
  { ssr: false }
)

interface PDFThumbnailProps {
  url: string
  className?: string
}

export function PDFThumbnail({ url, className }: PDFThumbnailProps) {
  const [error, setError] = useState(false)
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    // Configurar worker apenas no cliente
    import("react-pdf").then((pdfjs) => {
      pdfjs.pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.pdfjs.version}/build/pdf.worker.min.mjs`
    })
    setIsClient(true)
  }, [])

  if (!isClient) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <div className="w-12 h-14 bg-red-500 rounded-sm flex items-center justify-center text-white text-xs font-bold animate-pulse">
          PDF
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <div className="w-12 h-14 bg-red-500 rounded-sm flex items-center justify-center text-white text-xs font-bold">
          PDF
        </div>
      </div>
    )
  }

  return (
    <div className={`flex items-center justify-center overflow-hidden bg-gray-100 ${className}`}>
      <Document
        file={url}
        onLoadError={() => setError(true)}
        loading={
          <div className="w-12 h-14 bg-red-500 rounded-sm flex items-center justify-center text-white text-xs font-bold animate-pulse">
            PDF
          </div>
        }
      >
        <Page 
          pageNumber={1} 
          width={150}
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
      </Document>
    </div>
  )
}