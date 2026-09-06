import type { NextConfig } from "next";

// O provedor de OCR local (src/services/registral/ocr/tesseract-local.ts) chama
// `scripts/ocr/rasterizar-pdf.mjs` num processo Node separado via `spawn` — uma
// referência só em RUNTIME, que o rastreador de dependências do Next (@vercel/nft)
// não enxerga como import estático. Sem isto, a função compila normalmente (o
// script nem é importado em código TS) mas falha em produção só na hora de rodar,
// porque o arquivo simplesmente não existe no bundle — exatamente o tipo de "parece
// certo, não funciona" que este projeto não aceita. `canvas` é dependência nativa
// do próprio script; incluído explicitamente pelo mesmo motivo.
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/processos/[processoId]/analise-v2/extrair": [
      "./scripts/ocr/rasterizar-pdf.mjs",
      "./node_modules/canvas/**",
      "./node_modules/pdfjs-dist-legado/**",
      "./node_modules/tesseract.js/**",
      "./node_modules/tesseract.js-core/**",
    ],
    "/api/documentos/[id]/transcricao/executar": [
      "./scripts/ocr/rasterizar-pdf.mjs",
      "./node_modules/canvas/**",
      "./node_modules/pdfjs-dist-legado/**",
      "./node_modules/tesseract.js/**",
      "./node_modules/tesseract.js-core/**",
    ],
  },
};

export default nextConfig;
