/** Keep provider error strings out of the UI and map known codes to actionable copy. */
export function authErrorMessage(code: string | null): string {
  if (!code) return '';
  const normalized = code.trim().toLowerCase().replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'signup_disabled':
    case 'sign_up_disabled':
      return 'No account is linked to this provider yet. Choose Create account to register first.';
    case 'account_not_linked':
    case 'unable_to_link_account':
    case 'email_does_not_match':
      return 'This sign-in method is not linked to your account. Sign in using your original method.';
    case 'access_denied':
      return 'Sign-in was canceled or access was declined. You can try again.';
    case 'email_not_found':
    case 'user_email_not_found':
    case 'email_is_missing':
      return 'Your provider did not supply an email address. Make sure your primary email is verified.';
    case 'email_not_verified':
      return 'Verify your email address before continuing.';
    case 'invalid_token':
    case 'token_expired':
    case 'invalid_verification_token':
    case 'invalid_or_expired_token':
      return 'The verification link is invalid or expired. Request a new one.';
    case 'invalid_state':
    case 'state_mismatch':
    case 'oauth_state_mismatch':
      return 'Your sign-in session expired or could not be verified. Please try again.';
    default:
      return "We couldn't complete sign-in. Try again or use your email and password.";
  }
}
