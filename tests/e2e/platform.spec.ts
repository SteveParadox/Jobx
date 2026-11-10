import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const password = 'Local-demo-password-2026!';
let browserClient = 0;
async function signIn(page: Page, email = 'candidate@example.invalid') {
  // CI models a trusted ingress with distinct browser clients.
  await page
    .context()
    .setExtraHTTPHeaders({ 'x-real-ip': `198.18.${process.pid % 254}.${++browserClient}` });
  await page.goto('/auth');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole('heading', { name: 'Your career workspace.' })).toBeVisible();
}
test.afterAll(async () => {
  await pool.end();
});
test('server-rendered public details include the real fixture description and canonical, without demo JobPosting markup', async ({
  request,
}) => {
  const response = await request.get(
    '/job/11111111-1111-4111-8111-000000000001/demo-backend-engineer',
  );
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('Development fixture, not a real vacancy');
  expect(html).toContain('rel="canonical"');
  expect(html).not.toContain('"@type":"JobPosting"');
  expect(response.headers()['x-robots-tag']).toContain('noindex');
});
test('unknown pages return HTTP 404 rather than a streamed 200', async ({ request }) => {
  for (const url of ['/does-not-exist-observer-check', '/jobs/nonexistent-observer-landing']) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(404);
    expect(await response.text()).toContain('This page has moved');
  }
});

test('anonymous dashboard visitors are redirected before private data is requested', async ({
  page,
}) => {
  const dashboardRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/platform/dashboard')
      dashboardRequests.push(request.url());
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\\/auth\\?next=%2Fdashboard/);
  await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible();
  expect(dashboardRequests).toHaveLength(0);
});

test('invalid unsubscribe tokens never report success', async ({ request }) => {
  const response = await request.post('/api/platform/unsubscribe', {
    headers: { Origin: new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').origin },
    data: { token: 'forged-not-a-valid-alert-token-1234567890' },
  });
  expect(response.status()).toBe(404);
  expect((await response.json()).error).toContain('invalid');
});

test('bad search query strings show a helpful message rather than raw Zod issues', async ({
  page,
}) => {
  await page.goto('/jobs?country=THIS_IS_NOT_A_COUNTRY&sort=invalid');
  await expect(
    page.getByText('Some search filters are invalid. Check the selected values and try again.'),
  ).toBeVisible();
  await expect(page.getByText(/Invalid input|Invalid option|expected string/)).toHaveCount(0);
});

test('visitor searches, paginates and opens a job', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Job title, company or skill').fill('Demo');
  await page.getByRole('button', { name: 'Find jobs' }).click();
  await expect(page).toHaveURL(/jobs\?/);
  await expect(page.getByRole('heading', { name: '26 active opportunities' })).toBeVisible();
  await page.getByRole('link', { name: 'Next →', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('.job-card')).toHaveCount(6);
  await page.locator('.job-card h3 a').first().click();
  await expect(page.locator('.prose')).toContainText('Development fixture');
});
test('filters preserve state and mobile dialog is keyboard accessible', async ({
  page,
  isMobile,
}) => {
  await page.goto('/jobs');
  if (isMobile) await page.getByRole('button', { name: 'Filters & sort' }).click();
  const form = isMobile ? page.getByRole('dialog') : page.locator('.desktop-filters');
  await form.getByLabel('Country code', { exact: true }).fill('GB');
  await form.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/country=GB/);
  await expect(page.getByRole('heading', { name: '0 active opportunities' })).toBeVisible();
});
test('candidate saves a job, creates and unsubscribes an alert and submits a native application', async ({
  page,
}) => {
  await pool.query(
    "delete from applications where user_id='demo-candidate';delete from saved_jobs where user_id='demo-candidate';delete from job_alerts where user_id='demo-candidate'",
  );
  await signIn(page);
  await page.goto('/job/11111111-1111-4111-8111-000000000001/demo-backend-engineer');
  await page.getByRole('button', { name: 'Save job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved to workspace' })).toBeVisible();
  await page
    .getByLabel('Cover letter')
    .fill('This is a controlled end-to-end fixture application.');
  await page.getByRole('button', { name: 'Submit application', exact: true }).click();
  await expect(
    page.getByText('Application received. You can track it in your workspace.', { exact: true }),
  ).toBeVisible();
  await page.goto('/jobs?q=backend');
  await page.getByLabel('Alert name').fill('Backend fixture alert');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create job alert' }).click();
  await expect(page.getByRole('status')).toContainText('Your alert is active');
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Applications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo Backend Engineer' })).toBeVisible();
  await page.getByRole('tab', { name: 'Alerts & searches' }).click();
  await expect(page.getByRole('heading', { name: 'Backend fixture alert' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('daily · email · Paused')).toBeVisible();
});
test('external apply uses the authorized destination without requiring sign-in', async ({
  page,
}) => {
  await page.goto('/job/11111111-1111-4111-8111-000000000002/demo-external-engineer');
  const link = page.getByRole('link', { name: 'Apply on employer site' });
  await expect(link).toHaveAttribute('href', 'https://example.com/demo-application');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});
test('candidate controls search history, edits alerts and saved searches, and marks updates read', async ({
  page,
}) => {
  await pool.query("delete from candidate_preferences where user_id='demo-candidate'");
  await pool.query("delete from search_history where user_id='demo-candidate'");
  await pool.query("delete from saved_searches where user_id='demo-candidate'");
  await signIn(page);
  await page.getByRole('tab', { name: 'Privacy', exact: true }).click();
  await expect(page.getByLabel('Remember my recent job searches.')).not.toBeChecked();
  await page.getByLabel('Remember my recent job searches.').check();
  await page.getByLabel('Allow email job alerts I have subscribed to.').uncheck();
  await page.getByRole('button', { name: 'Save privacy preferences' }).click();
  await expect(page.getByText('Preferences saved.', { exact: true })).toBeVisible();
  const recorded = page.waitForResponse(
    (r) => r.url().endsWith('/api/platform/search-history') && r.request().method() === 'POST',
  );
  await page.goto('/jobs?q=Demo%20Backend');
  expect(await (await recorded).json()).toEqual({ recorded: true });
  await page.getByRole('button', { name: 'Save this search' }).click();
  await expect(page.getByText('Search saved to your workspace.', { exact: true })).toBeVisible();
  await page.getByLabel('Alert name').fill('Editable in-app fixture');
  await page.getByLabel('Delivery channel').selectOption('in_app');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create job alert' }).click();
  await expect(page.getByText('Your alert is active. Manage it in your workspace.')).toBeVisible();
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Alerts & searches', exact: true }).click();
  const alertRow = page
    .locator('.workspace-row')
    .filter({ has: page.getByRole('heading', { name: 'Editable in-app fixture', exact: true }) });
  await alertRow.getByRole('button', { name: 'Edit alert', exact: true }).click();
  const editor = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Edit alert', exact: true }) });
  await editor.getByLabel('Frequency').selectOption('weekly');
  await editor.getByLabel('I agree to receive matching vacancies', { exact: false }).check();
  await editor.getByRole('button', { name: 'Save alert settings' }).click();
  await expect(page.getByText('Alert settings saved.', { exact: true })).toBeVisible();
  await expect(alertRow).toContainText('weekly · in_app · Enabled');
  const savedRow = page
    .locator('.workspace-row')
    .filter({ has: page.getByRole('link', { name: 'Demo Backend →', exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Edit search', exact: true }) });
  await savedRow.getByRole('button', { name: 'Edit search', exact: true }).click();
  const savedEditor = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Edit saved search', exact: true }) });
  await savedEditor.getByLabel('Name', { exact: true }).fill('My Lagos shortlist');
  await savedEditor.getByLabel('City', { exact: true }).fill('Lagos');
  await savedEditor.getByRole('button', { name: 'Save search settings' }).click();
  await expect(
    page.getByRole('link', { name: 'My Lagos shortlist →', exact: true }),
  ).toHaveAttribute('href', /city=Lagos/);
  await expect(page.getByRole('link', { name: 'Demo Backend →', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search history', exact: true }).click();
  await expect(
    page.getByText('Your next filtered search will appear here.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Privacy', exact: true }).click();
  await page.getByLabel('Remember my recent job searches.').uncheck();
  await page.getByRole('button', { name: 'Save privacy preferences' }).click();
  await expect(page.getByText('Preferences saved.', { exact: true })).toBeVisible();
  const { rows } = await pool.query(
    "select count(*)::integer as count from search_history where user_id='demo-candidate'",
  );
  expect(rows[0].count).toBe(0);
  await pool.query(
    "insert into notifications(user_id,title,body,dedupe_key) values('demo-candidate','Controlled E2E update','Explicit test notification','e2e-read-update') on conflict(dedupe_key) do update set read_at=null",
  );
  await page.goto('/dashboard');
  const notification = page
    .locator('.workspace-row')
    .filter({ has: page.getByRole('heading', { name: 'Controlled E2E update', exact: true }) });
  await notification.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(notification.getByText('Read', { exact: true })).toBeVisible();
});
test('employer sign-in gate offers a styled entry and returns users to the workspace', async ({
  page,
  isMobile,
}) => {
  await page.goto('/employers');
  await expect(
    page.getByRole('heading', { name: 'Your next great hire starts here.' }),
  ).toBeVisible();

  // Text-only assertions miss unloaded stylesheets. Verify the CSS module actually applies.
  const layout = page.getByTestId('employer-access-layout');
  await expect(layout).toHaveCSS('display', 'grid');
  await expect(page.getByTestId('employer-access-primary')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.getByTestId('employer-access-side')).toHaveCSS(
    'background-color',
    'rgb(21, 61, 47)',
  );
  const columnCount = await layout.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  );
  expect(columnCount).toBe(isMobile ? 1 : 2);
  await expect(page.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
    'href',
    '/auth?next=%2Femployers',
  );
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/auth\?mode=register&next=%2Femployers/);
  await expect(page.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('Google and GitHub choices are consistent across employer and account access', async ({
  page,
}) => {
  await page.goto('/auth?next=%2Femployers');
  await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible();
  const googleEnabled = await page.getByRole('button', { name: 'Continue with Google' }).count();
  const githubEnabled = await page.getByRole('button', { name: 'Continue with GitHub' }).count();
  expect(googleEnabled).toBeLessThanOrEqual(1);
  expect(githubEnabled).toBeLessThanOrEqual(1);

  await page.getByRole('tab', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(
    googleEnabled,
  );
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(
    githubEnabled,
  );

  await page.goto('/employers');
  await expect(
    page.getByRole('heading', { name: 'Your next great hire starts here.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(
    googleEnabled,
  );
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(
    githubEnabled,
  );
});

for (const providerName of ['Google', 'GitHub'] as const) {
  test(`${providerName} OAuth starts the correct login and signup flows`, async ({ page }) => {
    const requests: Array<{
      provider: string;
      callbackURL: string;
      errorCallbackURL: string;
      requestSignUp: boolean;
    }> = [];
    await page.route('**/api/auth/sign-in/social', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'OAuth test interruption' }),
      });
    });

    await page.goto('/auth?next=%2Femployers');
    await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible();
    const providerButton = page.getByRole('button', { name: `Continue with ${providerName}` });

    // Report each missing provider as skipped, never count it as a passed test.
    test.skip(
      (await providerButton.count()) === 0,
      `${providerName} OAuth credentials not configured in the E2E server.`,
    );

    await providerButton.click();
    await expect(page.getByRole('alert')).toContainText('OAuth test interruption');
    expect(requests.at(-1)).toMatchObject({
      provider: providerName.toLowerCase(),
      callbackURL: '/employers',
      errorCallbackURL: '/auth?next=%2Femployers',
      requestSignUp: false,
    });

    await page.getByRole('tab', { name: 'Create account' }).click();
    const requestsBeforeConsent = requests.length;
    await providerButton.click();
    await expect(page.getByRole('alert')).toContainText('Please accept the Terms');
    expect(requests).toHaveLength(requestsBeforeConsent);

    await page.getByRole('checkbox').check();
    await providerButton.click();
    await expect(page.getByRole('alert')).toContainText('OAuth test interruption');
    expect(requests.at(-1)).toMatchObject({
      provider: providerName.toLowerCase(),
      callbackURL: '/employers',
      errorCallbackURL: '/auth?next=%2Femployers',
      requestSignUp: true,
    });
  });
}

test('employer workspace distinguishes API failures from sign-in requirements', async ({
  page,
}) => {
  let attempts = 0;
  await page.route('**/api/platform/employers', async (route) => {
    attempts += 1;
    await route.fulfill({
      status: attempts === 1 ? 503 : 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: attempts === 1 ? 'Service temporarily unavailable' : 'Please sign in',
      }),
    });
  });
  await page.goto('/employers');
  await expect(
    page.getByRole('heading', { name: "We couldn't load your employer workspace." }),
  ).toBeVisible();
  await expect(page.getByText('Service temporarily unavailable')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to continue' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('link', { name: 'Sign in to continue' })).toBeVisible();
});

test('unverified employers see email verification instead of a generic sign-in prompt', async ({
  page,
}) => {
  await page.route('**/api/platform/employers', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Verify your email first' }),
    }),
  );
  await page.goto('/employers');
  await expect(
    page.getByRole('heading', { name: 'One more step: verify your email.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: "I've verified my email" })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to continue' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(0);
});

test('employer drafts a job and submits it for approval', async ({ page }) => {
  await signIn(page, 'employer@example.invalid');
  await page.goto('/employers');
  await page.getByRole('button', { name: 'Create a vacancy' }).click();
  await page.getByLabel('Actual job title').fill('Demo moderated workflow fixture');
  await page
    .getByLabel('Description, responsibilities, qualifications & benefits')
    .fill(
      'Development fixture only. This is not a real vacancy. Build reliable sample software with a fictional product team, document decisions, test important failure cases and collaborate through code review.',
    );
  await page.getByLabel('Location label').fill('Lagos, Nigeria');
  await page.getByLabel('Country code', { exact: true }).fill('NG');
  await page.getByLabel('Applications', { exact: true }).selectOption('native');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  const row = page
    .locator('.panel')
    .filter({
      has: page.getByRole('heading', { name: 'Demo moderated workflow fixture', exact: true }),
    })
    .last();
  await row.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('status')).toContainText('Submitted for moderation');
  await page.getByRole('tab', { name: 'Applicants', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Applications you can act on.' })).toBeVisible();
});
test('administrator sees moderation and source controls', async ({ page }) => {
  await signIn(page, 'admin@example.invalid');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Trust is built in the details.' })).toBeVisible();
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Authorized data, accountable updates.' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'SEO', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Index only what earns its place.' }),
  ).toBeVisible();
});
test('unauthorized requests cannot read employer applicants or administrative data', async ({
  request,
}) => {
  expect(
    (
      await request.get('/api/platform/employers/7e883f89-1164-4b04-a85b-16fc02d7fc5b/applications')
    ).status(),
  ).toBe(401);
  expect((await request.get('/api/platform/admin/overview')).status()).toBe(401);
});
test('registration verifies through the development inbox and supports password recovery', async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.invalid`;
  await page.goto('/auth');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Full name').fill('Registration Fixture');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('If this address is new');
  const { rows } = await pool.query(
    'select html from development_emails where recipient=$1 order by created_at desc limit 1',
    [email],
  );
  const link = rows[0].html.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&');
  // Better Auth deliberately returns a synthetic 200 for a duplicate signup.
  // The UI must stay truthful, and a second verification email is not sent.
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Already registered?');
  const duplicateEmails = await pool.query(
    'select count(*)::integer as count from development_emails where recipient=$1',
    [email],
  );
  expect(duplicateEmails.rows[0].count).toBe(1);
  await page.goto(link);
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
  const reset = await pool.query(
    'select html from development_emails where recipient=$1 order by created_at desc limit 1',
    [email],
  );
  await page.goto(reset.rows[0].html.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&'));
  await page.getByLabel('Password', { exact: true }).fill('changed-fixture-password-2026!');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('status')).toContainText('Password reset.');
});

test('administrator links a discovery review to an employer and creates only a disabled pending source', async ({
  page,
}) => {
  const boardToken = 'discovery-e2e-' + crypto.randomUUID();
  const canonicalUrl = 'https://boards.greenhouse.io/' + boardToken;
  const employerId = '7e883f89-1164-4b04-a85b-16fc02d7fc5b';
  await pool.query(
    `INSERT INTO discovery_candidates (canonical_url, hostname, provider, board_token, state)
    VALUES ($1, 'boards.greenhouse.io', 'greenhouse', $2, 'REVIEW_REQUIRED')`,
    [canonicalUrl, boardToken],
  );
  try {
    await signIn(page, 'admin@example.invalid');
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Discovery', exact: true }).click();
    const article = page
      .locator('article')
      .filter({ has: page.getByRole('link', { name: canonicalUrl, exact: true }) });
    await article.getByLabel('Review state').selectOption('IDENTIFIED');
    await article.getByLabel('Verified employer ID (required to identify)').fill(employerId);
    await article
      .getByLabel('Review note (required)')
      .fill('Controlled fictional employer and board review for browser regression.');
    await article.getByRole('button', { name: 'Save review', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Candidate review saved');
    await article.getByText('Create disabled source draft', { exact: true }).click();
    await expect(article.getByLabel('Verified employer ID', { exact: true })).toHaveValue(
      employerId,
    );
    await article
      .getByLabel('Permission evidence')
      .fill('Explicit fictional fixture permission for this browser regression only.');
    await article.getByLabel('Application hostnames').fill('jobs.notion.com, careers.example.com');
    await article
      .getByLabel('Usage conditions')
      .fill('Controlled fixture only; no live redistribution rights.');
    await article
      .getByLabel('Removal policy')
      .fill('Remove fictional fixture listings after confirmed closure.');
    await article.getByRole('button', { name: 'Create pending source draft' }).click();
    await expect(page.getByRole('status')).toContainText('Disabled source draft created');
    const { rows } = await pool.query(
      'SELECT enabled, auto_publish, approval_status, employer_id, application_hostnames FROM job_sources WHERE provider=$1 AND board_token=$2',
      ['greenhouse', boardToken],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      enabled: false,
      auto_publish: false,
      approval_status: 'pending',
      employer_id: employerId,
      application_hostnames: ['jobs.notion.com', 'careers.example.com'],
    });
  } finally {
    await pool.query('DELETE FROM job_sources WHERE provider=$1 AND board_token=$2', [
      'greenhouse',
      boardToken,
    ]);
    await pool.query('DELETE FROM discovery_candidates WHERE canonical_url=$1', [canonicalUrl]);
  }
});
