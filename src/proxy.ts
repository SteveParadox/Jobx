import { NextResponse, type NextRequest } from 'next/server';
// Deployment environment is checked at request time, including standalone Docker images.
export function proxy(_request: NextRequest) {
  void _request;
  // A built self-hosted service may otherwise silently serve development/noindex content.
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ENV)
    return NextResponse.json(
      { error: 'APP_ENV must be explicitly configured for production runtime' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  const response = NextResponse.next();
  if (process.env.APP_ENV !== 'production')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  else response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|icon.svg).*)'] };
