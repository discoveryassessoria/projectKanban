import { SignJWT } from 'jose'
const secret = new TextEncoder().encode(process.env.JWT_SECRET)
const email = process.argv[2] || 'ator-teste@local'
const userId = parseInt(process.argv[3] || '1')
const agora = Date.now()
const t = await new SignJWT({ userId, email, tipo: 'admin', sessaoInicio: agora })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime(Math.floor((agora + 8 * 3600 * 1000) / 1000))
  .sign(secret)
console.log(t)
