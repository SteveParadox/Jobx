import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
const id = () => uuid('id').defaultRandom().primaryKey();
const time = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
export const user = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: time('created_at'),
  updatedAt: time('updated_at'),
  role: text('role').notNull().default('candidate'),
  disabled: boolean('disabled').notNull().default(false),
});
export const session = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);
export const account = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [uniqueIndex('account_provider_idx').on(t.providerId, t.accountId)],
);
export const verification = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);
export const profiles = pgTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  headline: text('headline').notNull().default(''),
  country: text('country'),
  skills: text('skills').array().notNull().default([]),
  experience: jsonb('experience').notNull().default([]),
  education: jsonb('education').notNull().default([]),
  preferences: jsonb('preferences').notNull().default({}),
  emailConsent: boolean('email_consent').notNull().default(false),
  aiConsent: boolean('ai_consent').notNull().default(false),
  updatedAt: time('updated_at'),
});
export const employers = pgTable('employers', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull().default(''),
  website: text('website').notNull(),
  industry: text('industry'),
  headquarters: text('headquarters'),
  size: text('size'),
  logoUrl: text('logo_url'),
  verificationStatus: text('verification_status').notNull().default('pending'),
  disabled: boolean('disabled').notNull().default(false),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: time('created_at'),
  updatedAt: time('updated_at'),
});
export const memberships = pgTable(
  'employer_memberships',
  {
    employerId: uuid('employer_id')
      .notNull()
      .references(() => employers.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('recruiter'),
  },
  (t) => [primaryKey({ columns: [t.employerId, t.userId] })],
);
export const invitations = pgTable('employer_invitations', {
  id: id(),
  employerId: uuid('employer_id')
    .notNull()
    .references(() => employers.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: time('created_at'),
});
export const employerVerifications = pgTable('employer_verifications', {
  id: id(),
  employerId: uuid('employer_id')
    .notNull()
    .references(() => employers.id),
  reviewerId: text('reviewer_id').references(() => user.id),
  status: text('status').notNull(),
  evidence: text('evidence').notNull(),
  createdAt: time('created_at'),
});
export const sources = pgTable(
  'job_sources',
  {
    id: id(),
    employerId: uuid('employer_id')
      .notNull()
      .references(() => employers.id),
    provider: text('provider').notNull(),
    boardToken: text('board_token').notNull(),
    permissionEvidence: text('permission_evidence').notNull(),
    attribution: text('attribution').notNull(),
    permittedFields: text('permitted_fields').array().notNull().default([]),
    removalPolicy: text('removal_policy').notNull(),
    intervalMinutes: integer('interval_minutes').notNull().default(60),
    enabled: boolean('enabled').notNull().default(false),
    autoPublish: boolean('auto_publish').notNull().default(false),
    approvalStatus: text('approval_status').notNull().default('pending'),
    approvedBy: text('approved_by').references(() => user.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    authorizationExpiresAt: timestamp('authorization_expires_at', { withTimezone: true }),
    endpointUrl: text('endpoint_url'),
    approvedHostname: text('approved_hostname'),
    applicationHostnames: text('application_hostnames').array().notNull().default([]),
    usageConditions: text('usage_conditions').notNull().default(''),
    config: jsonb('config').notNull().default({}),
    revision: integer('revision').notNull().default(1),
    validatedRevision: integer('validated_revision'),
    lastTestAt: timestamp('last_test_at', { withTimezone: true }),
    missingConfirmations: integer('missing_confirmations').notNull().default(2),
    missingGraceMinutes: integer('missing_grace_minutes').notNull().default(60),
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    health: text('health').notNull().default('unconfigured'),
    syncLeaseToken: uuid('sync_lease_token'),
    syncLeaseUntil: timestamp('sync_lease_until', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdAt: time('created_at'),
  },
  (t) => [uniqueIndex('source_board_idx').on(t.provider, t.boardToken)],
);
export const ingestionTasks = pgTable(
  'ingestion_tasks',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    kind: text('kind').notNull().default('sync'),
    status: text('status').notNull().default('queued'),
    payload: jsonb('payload'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    availableAt: time('available_at'),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    lastError: text('last_error'),
    errorCode: text('error_code'),
    result: jsonb('result'),
    createdAt: time('created_at'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('ingestion_tasks_due_idx').on(t.status, t.availableAt),
    index('ingestion_tasks_source_idx').on(t.sourceId, t.createdAt),
  ],
);
export const sourceHostBudgets = pgTable('source_host_budgets', {
  hostname: text('hostname').primaryKey(),
  nextRequestAt: time('next_request_at'),
});
export const syncRuns = pgTable('source_sync_runs', {
  id: id(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id),
  status: text('status').notNull(),
  taskId: uuid('task_id').references(() => ingestionTasks.id),
  revision: integer('revision').notNull().default(1),
  count: integer('count').notNull().default(0),
  imported: integer('imported').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  closed: integer('closed').notNull().default(0),
  duplicates: integer('duplicates').notNull().default(0),
  quarantined: integer('quarantined').notNull().default(0),
  protected: integer('protected').notNull().default(0),
  requests: integer('requests').notNull().default(0),
  durationMs: integer('duration_ms'),
  complete: boolean('complete').notNull().default(false),
  error: text('error'),
  startedAt: time('started_at'),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    employerId: uuid('employer_id')
      .notNull()
      .references(() => employers.id),
    sourceOwnerId: uuid('source_owner_id').references(() => sources.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    descriptionHtml: text('description_html').notNull(),
    descriptionText: text('description_text').notNull(),
    category: text('category'),
    skills: text('skills').array().notNull().default([]),
    country: text('country'),
    region: text('region'),
    city: text('city'),
    locationLabel: text('location_label').notNull(),
    workplace: text('workplace').notNull().default('unknown'),
    remoteCountries: text('remote_countries').array().notNull().default([]),
    employmentType: text('employment_type'),
    seniority: text('seniority'),
    experienceMin: integer('experience_min'),
    education: text('education'),
    visaSponsorship: boolean('visa_sponsorship'),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    currency: text('currency'),
    salaryPeriod: text('salary_period'),
    applicationMethod: text('application_method').notNull().default('external'),
    resumeRequired: boolean('resume_required').notNull().default(false),
    applyUrl: text('apply_url'),
    status: text('status').notNull().default('draft'),
    isDemo: boolean('is_demo').notNull().default(false),
    originalPostedAt: timestamp('original_posted_at', { withTimezone: true }),
    firstDiscoveredAt: time('first_discovered_at'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    fingerprint: text('fingerprint').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [
    index('jobs_active_date_idx').on(t.status, t.originalPostedAt),
    index('jobs_location_idx').on(t.country, t.city, t.workplace),
    index('jobs_employer_idx').on(t.employerId),
    index('jobs_fingerprint_idx').on(t.employerId, t.fingerprint),
  ],
);
export const mappings = pgTable(
  'source_job_mappings',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    externalId: text('external_id').notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    sourceUrl: text('source_url').notNull(),
    rawPayload: jsonb('raw_payload'),
    normalizedPayload: jsonb('normalized_payload'),
    sourcePostedAt: timestamp('source_posted_at', { withTimezone: true }),
    firstMissingAt: timestamp('first_missing_at', { withTimezone: true }),
    lastObservedAt: time('last_observed_at'),
    missingCount: integer('missing_count').notNull().default(0),
    lastMissingAt: timestamp('last_missing_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('source_identity_idx').on(t.sourceId, t.externalId),
    index('mapping_job_idx').on(t.jobId),
  ],
);
export const jobHistory = pgTable('job_change_history', {
  id: id(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  change: jsonb('change').notNull(),
  createdAt: time('created_at'),
});
export const jobReports = pgTable('job_reports', {
  id: id(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  reporterId: text('reporter_id').references(() => user.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'),
  resolution: text('resolution'),
  createdAt: time('created_at'),
});
export const resumes = pgTable('resumes', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull().unique(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull(),
  status: text('status').notNull().default('quarantined'),
  createdAt: time('created_at'),
});
export const savedJobs = pgTable(
  'saved_jobs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    createdAt: time('created_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.jobId] })],
);
export const savedSearches = pgTable('saved_searches', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull(),
  createdAt: time('created_at'),
});
export const candidatePreferences = pgTable('candidate_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  emailAlertsEnabled: boolean('email_alerts_enabled').notNull().default(true),
  searchHistoryEnabled: boolean('search_history_enabled').notNull().default(false),
  historyConsentedAt: timestamp('history_consented_at', { withTimezone: true }),
  updatedAt: time('updated_at'),
});
export const searchHistory = pgTable(
  'search_history',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    filters: jsonb('filters').notNull(),
    lastUsedAt: time('last_used_at'),
  },
  (t) => [
    uniqueIndex('search_history_user_fingerprint_idx').on(t.userId, t.fingerprint),
    index('search_history_user_date_idx').on(t.userId, t.lastUsedAt),
    index('search_history_date_idx').on(t.lastUsedAt),
  ],
);
export const alerts = pgTable('job_alerts', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull(),
  frequency: text('frequency').notNull().default('daily'),
  channel: text('channel').notNull().default('email'),
  enabled: boolean('enabled').notNull().default(true),
  unsubscribeHash: text('unsubscribe_hash').notNull().unique(),
  consentedAt: time('consented_at'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: time('created_at'),
});
export const applications = pgTable(
  'applications',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    coverLetter: text('cover_letter').notNull().default(''),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('new'),
    createdAt: time('created_at'),
    updatedAt: time('updated_at'),
  },
  (t) => [uniqueIndex('application_candidate_job_idx').on(t.userId, t.jobId)],
);
export const applicationEvents = pgTable('application_events', {
  id: id(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  status: text('status').notNull(),
  note: text('note'),
  internal: boolean('internal').notNull().default(true),
  createdAt: time('created_at'),
});
export const notifications = pgTable('notifications', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  href: text('href'),
  dedupeKey: text('dedupe_key').notNull().unique(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: time('created_at'),
});
export const deliveries = pgTable('notification_deliveries', {
  id: id(),
  alertId: uuid('alert_id').references(() => alerts.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => jobs.id),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  dedupeKey: text('dedupe_key').notNull().unique(),
  to: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
  providerId: text('provider_id'),
  lastError: text('last_error'),
  createdAt: time('created_at'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});
export const plans = pgTable('subscription_plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  durationDays: integer('duration_days').notNull(),
  activeJobs: integer('active_jobs').notNull(),
  featured: boolean('featured').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
});
export const checkouts = pgTable('checkout_attempts', {
  id: id(),
  employerId: uuid('employer_id')
    .notNull()
    .references(() => employers.id),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id),
  provider: text('provider').notNull(),
  reference: text('reference').notNull().unique(),
  providerReference: text('provider_reference').unique(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  durationDays: integer('duration_days').notNull(),
  activeJobs: integer('active_jobs').notNull(),
  featured: boolean('featured').notNull(),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: time('created_at'),
});
export const transactions = pgTable(
  'payment_transactions',
  {
    id: id(),
    attemptId: uuid('attempt_id')
      .notNull()
      .unique()
      .references(() => checkouts.id),
    provider: text('provider').notNull(),
    providerTransactionId: text('provider_transaction_id').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('paid'),
    createdAt: time('created_at'),
  },
  (t) => [uniqueIndex('provider_transaction_idx').on(t.provider, t.providerTransactionId)],
);
export const subscriptions = pgTable('employer_subscriptions', {
  id: id(),
  employerId: uuid('employer_id')
    .notNull()
    .references(() => employers.id),
  attemptId: uuid('attempt_id')
    .notNull()
    .unique()
    .references(() => checkouts.id),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id),
  status: text('status').notNull().default('active'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  activeJobs: integer('active_jobs').notNull(),
  featured: boolean('featured').notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: time('created_at'),
});
export const invoices = pgTable('invoices', {
  id: id(),
  transactionId: uuid('transaction_id')
    .notNull()
    .unique()
    .references(() => transactions.id),
  employerId: uuid('employer_id')
    .notNull()
    .references(() => employers.id),
  number: text('number').notNull().unique(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  createdAt: time('created_at'),
});
export const placements = pgTable('featured_placements', {
  id: id(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  employerId: uuid('employer_id')
    .notNull()
    .references(() => employers.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
});
export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entityId: text('entity_id'),
  detail: jsonb('detail').notNull().default({}),
  createdAt: time('created_at'),
});
export const ingestionErrors = pgTable('ingestion_errors', {
  id: id(),
  runId: uuid('run_id')
    .notNull()
    .references(() => syncRuns.id),
  externalId: text('external_id'),
  stage: text('stage').notNull(),
  reason: text('reason').notNull(),
  rawPayload: jsonb('raw_payload'),
  disposition: text('disposition').notNull().default('quarantined'),
  createdAt: time('created_at'),
});
export const indexingNotifications = pgTable(
  'indexing_notifications',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    result: text('result'),
    createdAt: time('created_at'),
  },
  (t) => [uniqueIndex('indexing_dedupe_idx').on(t.jobId, t.type, t.version)],
);
export const editorial = pgTable('editorial_pages', {
  id: id(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  bodyHtml: text('body_html').notNull(),
  published: boolean('published').notNull().default(false),
  author: text('author').notNull(),
  updatedAt: time('updated_at'),
});
export const settings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: time('updated_at'),
});
export const analytics = pgTable('analytics_events', {
  id: id(),
  event: text('event').notNull(),
  jobId: uuid('job_id').references(() => jobs.id),
  properties: jsonb('properties').notNull().default({}),
  createdAt: time('created_at'),
});
export const supportRequests = pgTable('support_requests', {
  id: id(),
  email: text('email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: time('created_at'),
});
export const workerHeartbeat = pgTable('worker_heartbeat', {
  id: text('id').primaryKey(),
  updatedAt: time('updated_at'),
});
export const outbox = pgTable('outbox', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  createdAt: time('created_at'),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
});

// Local verification inbox. Runtime refuses this transport outside development/test.
export const developmentEmails = pgTable('development_emails', {
  id: id(),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  createdAt: time('created_at'),
});


/** Discovered candidates are not authorized sources. Approval remains a separate workflow. */
export const discoveryCandidates = pgTable(
  'discovery_candidates',
  {
    id: id(),
    canonicalUrl: text('canonical_url').notNull().unique(),
    hostname: text('hostname').notNull(),
    provider: text('provider'),
    boardToken: text('board_token'),
    employerId: uuid('employer_id').references(() => employers.id, { onDelete: 'set null' }),
    state: text('state').notNull().default('DISCOVERED'),
    requiresPermissionReview: boolean('requires_permission_review').notNull().default(true),
    evidence: jsonb('evidence').notNull().default([]),
    firstDiscoveredAt: time('first_discovered_at'),
    lastObservedAt: time('last_observed_at'),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewNote: text('review_note'),
  },
  (t) => [
    index('discovery_candidates_state_idx').on(t.state, t.lastObservedAt),
    index('discovery_candidates_hostname_idx').on(t.hostname),
  ],
);
export const discoveryRuns = pgTable('discovery_runs', {
  id: id(),
  trigger: text('trigger').notNull(),
  status: text('status').notNull().default('running'),
  seedsSeen: integer('seeds_seen').notNull().default(0),
  candidatesFound: integer('candidates_found').notNull().default(0),
  candidatesUpdated: integer('candidates_updated').notNull().default(0),
  rejected: integer('rejected').notNull().default(0),
  error: text('error'),
  startedAt: time('started_at'),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
