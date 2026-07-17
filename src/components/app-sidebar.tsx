'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/projects', label: 'Projects' },
  { href: '/approvals', label: 'Approvals' },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-52 shrink-0 border-r border-border bg-surface p-4">
      <Link href="/projects" className="mb-6 block font-display text-lg font-semibold tracking-tight">
        VRT<span className="text-accent">.</span>
      </Link>
      <nav className="flex flex-col gap-1">
        {links.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded px-3 py-2 text-sm ${
                active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
