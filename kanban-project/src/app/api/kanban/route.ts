import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  // ...sua lógica...
  return new Response('OK');
}