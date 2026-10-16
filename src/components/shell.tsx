import { brand } from '@/lib/config';
import { ArrowUpRight, Compass } from 'lucide-react';
import Link from 'next/link';
export function Header() {
  return (
    <header className="site-header">
      <div className="container nav">
        <Link href="/" className="wordmark" aria-label={brand.name + ' home'}>
          <Compass size={29} strokeWidth={1.6} />
          {brand.name}
          <span className="logo-dot">.</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/jobs">Find a job</Link>
          <Link href="/companies">Companies</Link>
          <Link href="/resources">Career resources</Link>
        </nav>
        <div className="nav-actions">
          <Link className="employer-link" href="/employers">
            For employers <ArrowUpRight size={14} />
          </Link>
          <Link className="button button-secondary" href="/dashboard">
            My workspace
          </Link>
        </div>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link href="/" className="wordmark">
            <Compass size={25} />
            {brand.name}.
          </Link>
          <p>
            A clearer direction for your next career move.
            <br />
            Real opportunities. Transparent information.
          </p>
          <span className="footer-note">Candidates never pay to browse or apply.</span>
        </div>
        <div>
          <h2>Explore</h2>
          <Link href="/jobs">All opportunities</Link>
          <Link href="/remote-jobs">Remote jobs</Link>
          <Link href="/companies">Employers</Link>
          <Link href="/resources">Career resources</Link>
        </div>
        <div>
          <h2>For employers</h2>
          <Link href="/employers">Recruitment workspace</Link>
          <Link href="/pricing">Plans & pricing</Link>
          <Link href="/help">Help center</Link>
        </div>
        <div>
          <h2>CareerAtlas</h2>
          <Link href="/about">About us</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/trust">Trust & safety</Link>
          <Link href="/accessibility">Accessibility</Link>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>
          © {new Date().getFullYear()} {brand.name}
        </span>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/cookies">Cookie preferences</Link>
        </div>
      </div>
    </footer>
  );
}
