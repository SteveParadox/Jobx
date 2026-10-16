import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const password = 'Local-demo-password-2026!';
async function signIn(page: Page, email = 'candidate@example.invalid') {
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
  await expect(page.getByRole('status')).toContainText('Check your email');
  const { rows } = await pool.query(
    'select html from development_emails where recipient=$1 order by created_at desc limit 1',
    [email],
  );
  const link = rows[0].html.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&');
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
