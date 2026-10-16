'use client';
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container error-page">
      <h1>We couldn’t load this page.</h1>
      <p>Please try again. Your saved information remains in your account.</p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
