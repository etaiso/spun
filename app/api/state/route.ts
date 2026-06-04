import { NextRequest } from 'next/server';
import { getAllState, setState } from '@/app/lib/db/state';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(getAllState());
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!body || typeof body.key !== 'string' || typeof body.value !== 'string') {
    return new Response('expected { key: string, value: string }', { status: 400 });
  }
  setState(body.key, body.value);
  return new Response(null, { status: 204 });
}
