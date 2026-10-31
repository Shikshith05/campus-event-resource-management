"use client";

import Link from "next/link";
import { useState } from "react";

type NavigationLink = { href: string; label: string; key: string };

export default function AppNavigation({ links, active }: { links: NavigationLink[]; active: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="site-nav">
      <button
        className="menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="main-navigation"
        onClick={() => setOpen(value => !value)}
      >
        <span aria-hidden="true">{open ? "×" : "☰"}</span> Menu
      </button>
      <nav id="main-navigation" className={`nav-links${open ? " open" : ""}`} aria-label="Main navigation">
        {links.map(link => (
          <Link
            key={link.key}
            className={`nav-link${active === link.key ? " active" : ""}`}
            href={link.href}
            aria-current={active === link.key ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
