export interface UploadedFile {
  url: string;        // URL pública (substitui `ufsUrl` / `url` do UploadThing)
  key: string;        // chave no bucket — útil pra delete futuro
  name: string;
  size: number;
  type: string;
}

export interface UploadOptions {
  /** Pasta lógica dentro do bucket. Default: "uploads". Ex: "documentos", "protocolos". */
  prefix?: string;
  /** Callback de progresso (0–100) por arquivo. */
  onProgress?: (file: File, percent: number) => void;
  /** Callback chamado quando um arquivo termina (substitui o callback do UploadThing). */
  onFileComplete?: (file: UploadedFile) => void;
}

/**
 * Faz upload de um array de arquivos pro R2 via presigned URL.
 * Substitui o `uploadFiles` do UploadThing.
 */
export async function uploadFiles(
  files: File[],
  options: UploadOptions = {}
): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];

  // Pega o token JWT do localStorage (mesmo padrão usado nas outras chamadas do sistema)
  const authToken =
    typeof window !== "undefined" ? localStorage.getItem("authToken") : null;

  if (!authToken) {
    throw new Error("Sua sessão expirou. Faça login novamente.");
  }

  for (const file of files) {
    // 1) Pega presigned URL
    const presignRes = await fetch("/api/storage/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
        prefix: options.prefix,
      }),
    });

    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}));
      throw new Error(err.error || `Falha no presign de ${file.name}`);
    }

    const { uploadUrl, publicUrl, key } = (await presignRes.json()) as {
      uploadUrl: string;
      publicUrl: string;
      key: string;
    };

    // 2) PUT direto no R2 (com progresso via XHR)
    await putToR2(file, uploadUrl, (p) => options.onProgress?.(file, p));

    const uploaded: UploadedFile = {
      url: publicUrl,
      key,
      name: file.name,
      size: file.size,
      type: file.type,
    };

    options.onFileComplete?.(uploaded);
    out.push(uploaded);
  }

  return out;
}

function putToR2(
  file: File,
  url: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 PUT falhou (${xhr.status}): ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error("Erro de rede no upload"));
    xhr.send(file);
  });
}