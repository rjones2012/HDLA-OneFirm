'use client';
// The OneFirm shell: left nav + page frame. Every module renders inside this.
//   <Shell module="billing" title="October billing" eyebrow="Billing · 38 drafts" actions={<Button/>}>…</Shell>
import { usePathname } from 'next/navigation';
import { useAuth, MODULES, getAccessibleModules } from '../../lib/auth';
import { LoginScreen } from '../AuthGate';
import { STAFF_NAMES } from '../marketing-shared';

const ROLE_LABEL = { partner: 'Partner', operations: 'Operations', office: 'Office', marketing: 'Marketing', principal: 'Principal', staff: 'Staff' };

export function Shell({ module, title, eyebrow, subtitle, actions, children, wide }) {
  const { user, profile, loading, signOut } = useAuth();
  const pathname = usePathname();

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted animate-pulse">Loading…</div>;
  if (!user) return <LoginScreen />;

  const role = profile?.role || 'staff';
  const allowed = getAccessibleModules(role);
  const nav = MODULES.filter(m => allowed.includes(m.id));
  const active = module || (MODULES.find(m => m.path !== '/' && pathname.startsWith(m.path))?.id) || 'home';

  if (!allowed.includes(active)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white border border-rule rounded p-8 w-[420px] text-center">
          <h1 className="text-xl mb-2">Not available to your role</h1>
          <p className="text-sm text-muted mb-4">{profile?.display_name || profile?.initials || 'Your account'} doesn&apos;t have access to this module.</p>
          <a href="/" className="text-sm font-bold text-accent">← Home</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-wrap bg-ground">
      <nav aria-label="Modules" className="w-[224px] bg-white border-r border-rule flex flex-col py-7 shrink-0">
        <a href="/" className="px-6 pb-7 flex items-center gap-3">
          <img src="/logo_hdla.png" alt="HDLA" className="w-[72px] h-auto" />
          <span className="font-flecha text-[15px] leading-none text-ink">OneFirm</span>
        </a>
        <div className="flex flex-col gap-0.5">
          {nav.map(m => {
            const on = m.id === active;
            if (m.quiet) return null;
            return <a key={m.id} href={m.path} className={'flex items-center px-6 py-2.5 text-sm ' + (on ? 'font-bold border-l-[3px] border-accent pl-[21px]' : 'font-normal text-ink hover:text-accent')}>{m.label}</a>;
          })}
          {nav.some(m => m.quiet) && <div className="h-px bg-rule my-3 mx-6" />}
          {nav.filter(m => m.quiet).map(m => {
            const on = m.id === active;
            return <a key={m.id} href={m.path} className={'flex items-center px-6 py-2.5 text-[13px] ' + (on ? 'font-bold border-l-[3px] border-accent pl-[21px]' : 'text-muted hover:text-accent')}>{m.label}</a>;
          })}
        </div>
        <div className="mt-auto px-6 pt-5 border-t border-rule flex flex-col gap-1">
          <div className="font-bold text-[13px]">{profile?.display_name || STAFF_NAMES[profile?.initials] || profile?.initials || ''}</div>
          <div className="text-xs text-muted">{ROLE_LABEL[role] || role}{profile?.office ? ` · ${profile.office}` : ''}</div>
          <button onClick={signOut} className="text-left text-xs text-muted hover:text-accent mt-1.5">Sign out</button>
        </div>
      </nav>
      <main className={'flex-[999_1_560px] min-w-0 px-10 pt-7 pb-12 ' + (wide ? '' : '')}>
        {(title || eyebrow || actions) && (
          <header className="flex justify-between items-end gap-6 flex-wrap mb-6">
            <div className="flex flex-col gap-1.5">
              {eyebrow && <div className="text-xs tracking-[0.08em] uppercase text-muted font-normal">{eyebrow}</div>}
              {title && <h1 className="m-0 text-[34px] leading-[1.1]">{title}</h1>}
              {subtitle && <div className="text-[15px] text-muted">{subtitle}</div>}
            </div>
            {actions && <div className="flex gap-2 flex-wrap items-center">{actions}</div>}
          </header>
        )}
        {children}
      </main>
    </div>
  );
}
