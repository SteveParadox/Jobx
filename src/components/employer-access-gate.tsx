'use client';

import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { SocialSignIn } from './social-sign-in';
import styles from './employer-access-gate.module.css';

type RetryProps = { onRetry: () => void };
type ProviderFlags = { googleEnabled: boolean; githubEnabled: boolean };

export function EmployerAccessGate({
  verificationRequired,
  onRetry,
  googleEnabled,
  githubEnabled,
}: RetryProps & ProviderFlags & { verificationRequired: boolean }) {
  return (
    <div className={styles.page}>
      <section
        className={styles.layout}
        aria-labelledby="employer-entry-title"
        data-testid="employer-access-layout"
      >
        <div className={styles.primary} data-testid="employer-access-primary">
          <div className={styles.identityRow}>
            <span className={styles.identityIcon} aria-hidden="true">
              <BriefcaseBusiness size={20} strokeWidth={1.8} />
            </span>
            <span className={styles.identityText}>
              <span className={styles.identityName}>EMPLOYER WORKSPACE</span>
              <span className={styles.identitySubtext}>Your hiring hub</span>
            </span>
            <span className={styles.accessChip}>
              <LockKeyhole size={12} aria-hidden="true" />
              SECURE ACCESS
            </span>
          </div>

          <div className={styles.heroCopy}>
            <p className={styles.kicker}>
              <span className={styles.kickerLine} aria-hidden="true" />
              BUILD YOUR NEXT TEAM
            </p>
            <h1 id="employer-entry-title" className={styles.title}>
              {verificationRequired ? (
                <>
                  One more step: <span className={styles.titleAccent}>verify your email.</span>
                </>
              ) : (
                <>
                  Your next great hire <span className={styles.titleAccent}>starts here.</span>
                </>
              )}
            </h1>
            <p className={styles.description}>
              {verificationRequired
                ? 'Open the verification link sent to your email, then return here to continue setting up your hiring workspace.'
                : 'Post opportunities, track applicants and build your team from one organized workspace. Sign in or create an account to get started.'}
            </p>

            <div className={styles.actions}>
              {verificationRequired ? (
                <>
                  <button type="button" className={styles.primaryButton} onClick={onRetry}>
                    I've verified my email
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                  <Link href="/auth?next=%2Femployers" className={styles.secondaryButton}>
                    Switch account
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/auth?next=%2Femployers" className={styles.primaryButton}>
                    Sign in to continue
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                  <Link
                    href="/auth?mode=register&next=%2Femployers"
                    className={styles.secondaryButton}
                  >
                    Create an account
                  </Link>
                </>
              )}
            </div>
            <SocialSignIn
              googleEnabled={googleEnabled}
              githubEnabled={githubEnabled}
              callbackURL="/employers"
              errorCallbackURL="/auth?next=%2Femployers"
            />
          </div>

          <div className={styles.assurance}>
            <span className={styles.assuranceIcon} aria-hidden="true">
              <ShieldCheck size={18} strokeWidth={1.8} />
            </span>
            <p>
              Company profiles and vacancies go through review before publication.
              <span>Responsible hiring, built in.</span>
            </p>
          </div>
        </div>

        <aside
          className={styles.side}
          aria-label="How employer onboarding works"
          data-testid="employer-access-side"
        >
          <div className={styles.orbit} aria-hidden="true" />
          <div className={styles.sideInner}>
            <span className={styles.sideEyebrow}>THE PATH TO YOUR FIRST HIRE</span>
            <h2 className={styles.sideTitle}>
              Three simple steps.
              <span> One confident start.</span>
            </h2>
            <ol className={styles.steps}>
              <li className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  01
                </span>
                <div>
                  <strong>Create your account</strong>
                  <p>Verify your email to unlock a secure employer workspace.</p>
                </div>
                <Check className={styles.stepCheck} size={17} aria-hidden="true" />
              </li>
              <li className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  02
                </span>
                <div>
                  <strong>Set up your organization</strong>
                  <p>Add your company details for the verification process.</p>
                </div>
                <Check className={styles.stepCheck} size={17} aria-hidden="true" />
              </li>
              <li className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">
                  03
                </span>
                <div>
                  <strong>Publish your opportunity</strong>
                  <p>Prepare a vacancy and submit it for review.</p>
                </div>
                <Check className={styles.stepCheck} size={17} aria-hidden="true" />
              </li>
            </ol>
            <div className={styles.sideFooter}>
              <ShieldCheck size={15} aria-hidden="true" />
              Trust-first hiring
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

export function EmployerAccessError({ message, onRetry }: RetryProps & { message: string }) {
  return (
    <div className={styles.page}>
      <section className={styles.stateCard} aria-labelledby="employer-error-title">
        <div className={styles.stateIcon}>
          <RefreshCw size={22} aria-hidden="true" />
        </div>
        <span className={styles.stateEyebrow}>WORKSPACE UNAVAILABLE</span>
        <h1 id="employer-error-title">We couldn't load your employer workspace.</h1>
        <p>Something interrupted the request for your organization details. Please try again.</p>
        <p className={styles.errorMessage} role="alert">
          {message}
        </p>
        <button className={styles.primaryButton} type="button" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" />
          Try again
        </button>
      </section>
    </div>
  );
}

export function EmployerAccessLoading() {
  return (
    <div className={styles.page}>
      <div className={styles.loadingCard} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        Opening your employer workspace…
      </div>
    </div>
  );
}
