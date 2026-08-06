import Link from "next/link";
import arcDeployment from "@/lib/deployments.5042002.json";

const CONTRACT_URL = `https://testnet.arcscan.app/address/${arcDeployment.sluice}`;
const GITHUB_URL = "https://github.com/mrnetwork0001/Sluice";

const columns: Array<{ title: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
  {
    title: "Product",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Create Stream", href: "/create" },
      { label: "Payroll Run", href: "/payroll" },
      { label: "Marketplace", href: "/marketplace" },
      { label: "Treasury", href: "/treasury" },
      { label: "Automation", href: "/automation" },
      { label: "Get Paid (no wallet)", href: "/onboard" },
    ],
  },
  {
    title: "Ecosystem",
    links: [
      { label: "Arc Explorer", href: "https://testnet.arcscan.app", external: true },
      { label: "Circle Faucet", href: "https://faucet.circle.com", external: true },
      { label: "Circle Developers", href: "https://developers.circle.com", external: true },
      { label: "CCTP", href: "https://developers.circle.com/cctp", external: true },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "GitHub", href: GITHUB_URL, external: true },
      { label: "Live Contract", href: CONTRACT_URL, external: true },
      { label: "Pitch Deck", href: `${GITHUB_URL}/blob/main/docs/PITCH_DECK.md`, external: true },
      { label: "MIT License", href: `${GITHUB_URL}/blob/main/LICENSE`, external: true },
    ],
  },
];

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11.04 11.04 0 0 1 5.78 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.26 5.66.41.36.78 1.05.78 2.12 0 1.54-.02 2.78-.02 3.16 0 .31.21.68.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-10 lg:grid-cols-2">
          {/* Brand */}
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-emerald-400 text-sm font-black text-zinc-950">
                S
              </span>
              <span className="text-lg font-black tracking-tight text-zinc-100">Sluice</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-zinc-500">
              Streaming USDC payroll on Arc. Salaries vest every second, taxes split
              themselves, and future income becomes a liquid, insurable asset.
            </p>
            <div className="mt-5 flex items-center gap-4 text-zinc-600">
              <a
                href="https://x.com/mrnetwork0001"
                target="_blank"
                rel="noreferrer"
                aria-label="X"
                className="transition-colors hover:text-zinc-300"
              >
                <XIcon />
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                className="transition-colors hover:text-zinc-300"
              >
                <GitHubIcon />
              </a>
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((column) => (
              <div key={column.title}>
                <div className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-600">
                  {column.title}
                </div>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sm text-zinc-400 transition-colors hover:text-cyan-300"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="font-mono text-sm text-zinc-400 transition-colors hover:text-cyan-300"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-6 text-xs text-zinc-600">
          <span>Sluice · Programmable Money Hackathon · DeFi Track</span>
          <span className="font-mono">Arc Testnet · chain 5042002 · gas paid in USDC</span>
        </div>
      </div>
    </footer>
  );
}
