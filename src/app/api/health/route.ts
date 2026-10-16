export function GET() {
  return Response.json(
    { status: 'alive', service: 'careeratlas' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
