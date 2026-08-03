import { createHmac, timingSafeEqual } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

const forbidden = () =>
  NextResponse.json({ error: "Forbidden" }, { status: 403 })

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const mode = searchParams.get("hub.mode")
  const token = searchParams.get("hub.verify_token")
  const challenge = searchParams.get("hub.challenge")
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (
    mode !== "subscribe" ||
    !verifyToken ||
    token !== verifyToken ||
    challenge === null
  ) {
    return forbidden()
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}

export async function POST(request: NextRequest) {
  const body = Buffer.from(await request.arrayBuffer())
  const signatureHeader = request.headers.get("x-hub-signature-256")
  const appSecret = process.env.WHATSAPP_APP_SECRET
  const signatureMatch = signatureHeader?.match(/^sha256=([0-9a-f]{64})$/i)

  if (!appSecret || !signatureMatch) {
    return forbidden()
  }

  const receivedSignature = Buffer.from(signatureMatch[1], "hex")
  const expectedSignature = createHmac("sha256", appSecret)
    .update(body)
    .digest()

  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    return forbidden()
  }

  return new NextResponse(null, { status: 200 })
}
