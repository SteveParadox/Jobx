import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="container error-page">
      <div className="eyebrow" style={{ justifyContent: 'center' }}>
        404 · A DIFFERENT DIRECTION
      </div>
      <h1>
        This page has moved
        <br />
        out of view.
      </h1>
      <p>The link may be outdated or the opportunity may have been removed.</p>
      <Link href="/jobs" className="button button-primary">
        Explore current jobs →
      </Link>
    </div>
  );
}
