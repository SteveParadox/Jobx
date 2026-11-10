import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '../../src/lib/auth-error-message';

describe('OAuth callback error mapping', () => {
  it('does not mislabel normal provider failures as expired verification links', () => {
    expect(authErrorMessage('access_denied')).toMatch(/canceled|declined/i);
    expect(authErrorMessage('account_not_linked')).toContain('original method');
    expect(authErrorMessage('signup disabled')).toContain('Create account');
  });

  it('handles missing emails and expired OAuth state without reflecting untrusted input', () => {
    expect(authErrorMessage('USER_EMAIL_NOT_FOUND')).toContain('email address');
    expect(authErrorMessage('state_mismatch')).toContain('expired');
    expect(authErrorMessage('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('preserves the invalid verification-link message only for token errors', () => {
    expect(authErrorMessage('invalid_token')).toContain('invalid or expired');
    expect(authErrorMessage(null)).toBe('');
  });
});
