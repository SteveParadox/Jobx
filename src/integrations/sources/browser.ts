import { env } from '@/lib/config';
import { escapeHtml } from '@/lib/security';
import { parseHtmlPage } from './adapters';
import {
  HTML_TYPES,
  JSON_TYPES,
  SourceError,
  type Snapshot,
  type SourceContext,
} from './contracts';
import { normalizedRecord, snapshotFromRows } from './normalize';

export async function fetchBrowser(ctx: SourceContext): Promise<Snapshot> {
  if (!env.SOURCE_BROWSER_ENABLED || !ctx.config.browserPermitted)
    throw new SourceError(
      'BROWSER_DISABLED',
      'Browser execution requires operator enablement and explicit source permission',
    );
  const { chromium } = await import('playwright');
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 20000 });
  } catch {
    throw new SourceError(
      'BROWSER_RUNTIME',
      'Chromium could not start; verify installation and non-root sandbox support',
    );
  }
  let context: Awaited<ReturnType<typeof browser.newContext>>;
  try {
    context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      userAgent: 'CareerAtlasBot/1.0',
      javaScriptEnabled: true,
    });
  } catch {
    await browser.close();
    throw new SourceError('BROWSER_RUNTIME', 'Could not create an isolated browser context');
  }
  const abort = () => {
    void context.close();
  };
  ctx.signal.addEventListener('abort', abort, { once: true });
  let failure: unknown;
  try {
    // Chromium never makes outbound HTTP connections itself. Every allowed GET is
    // fulfilled through the DNS-pinned transport, hostname policy, robots and budget.
    await context.route('**/*', async (route) => {
      const request = route.request();
      const type = request.resourceType();
      if (
        request.method() !== 'GET' ||
        !['document', 'script', 'stylesheet', 'xhr', 'fetch'].includes(type)
      ) {
        await route.abort();
        return;
      }
      try {
        const types =
          type === 'document'
            ? HTML_TYPES
            : type === 'script'
              ? ['application/javascript', 'text/javascript', 'application/x-javascript']
              : type === 'stylesheet'
                ? ['text/css']
                : [...JSON_TYPES, ...HTML_TYPES];
        const response = await ctx.request(request.url(), types);
        if (
          type === 'document' &&
          /noindex|nofollow/i.test(response.headers.get('x-robots-tag') ?? '')
        )
          throw new SourceError('PAGE_ROBOTS', 'Page prohibits collection');
        const body =
          type === 'document' && response.url !== request.url()
            ? `<base href="${escapeHtml(response.url)}">${response.body}`
            : response.body;
        await route.fulfill({
          status: response.status,
          body,
          headers: {
            'content-type': response.headers.get('content-type')!,
            'content-security-policy':
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'",
          },
        });
      } catch (error) {
        failure = error;
        await route.abort();
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    const result: Snapshot = { records: [], rejected: [], complete: true, requests: 0 };
    let next: string | undefined = ctx.source.endpointUrl!;
    const seen = new Set<string>();
    for (let i = 0; next && i < ctx.config.maxPages; i++) {
      ctx.signal.throwIfAborted();
      await ctx.checkCancelled();
      if (seen.has(next)) throw new SourceError('REPEATED_PAGE', 'Browser pagination cycle');
      seen.add(next);
      await page.goto(next, { waitUntil: 'domcontentloaded', timeout: ctx.config.timeoutMs });
      await page.waitForSelector(
        ctx.config.waitForSelector ??
          [ctx.config.itemSelector, ctx.config.emptySelector].filter(Boolean).join(', '),
        { timeout: ctx.config.timeoutMs, state: 'attached' },
      );
      if (failure) throw failure;
      const html = await page.content();
      if (Buffer.byteLength(html) > ctx.config.maxBytes)
        throw new SourceError('RESPONSE_LIMIT', 'Rendered document exceeds byte limit');
      const parsed = parseHtmlPage(html, page.url(), ctx);
      if (ctx.config.detailSelector)
        throw new SourceError(
          'CONFIGURATION',
          'Browser adapter expects complete records on each rendered catalog page',
        );
      const batch = snapshotFromRows(parsed.rows, (row) =>
        normalizedRecord(
          { ...(row as object), sourceUrl: (row as { applyUrl: string }).applyUrl },
          page.url(),
        ),
      );
      result.records.push(...batch.records);
      result.rejected.push(...batch.rejected);
      result.complete &&= batch.complete;
      next = parsed.next ? new URL(parsed.next, page.url()).toString() : undefined;
    }
    if (next) throw new SourceError('PAGINATION_LIMIT', 'Browser catalog reached its page limit');
    result.requests = ctx.requestCount();
    return result;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(
      'BROWSER_RENDER',
      'Permitted page rendering did not complete within its limits',
      true,
    );
  } finally {
    ctx.signal.removeEventListener('abort', abort);
    await context.close();
    await browser.close();
  }
}
