import type { NavIcon } from "@/lib/navigation";

// Ícones de traço simples (24×24), no estilo do layout de referência.
const PATHS: Record<NavIcon | "logout" | "logo" | "search" | "mic" | "send" | "minus" | "stop" | "menu", string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  plus: "M12 5v14M5 12h14",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  cart: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20.5h.01M17 20.5h.01",
  tag: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19.5a1.5 1.5 0 1 0 0-.01M17 19.5a1.5 1.5 0 1 0 0-.01",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01",
  coins: "M8 8.5a5 2.5 0 1 0 10 0 5 2.5 0 1 0-10 0M8 8.5v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4M3 13a5 2.5 0 0 0 5 2.5M3 13v4c0 1.4 2.2 2.5 5 2.5 1.6 0 3-.4 4-1M3 13c0-1.1 1.4-2 3.4-2.4",
  chart: "M4 20V10M10 20V4M16 20v-7M21 20H3",
  bot: "M5 9h14v10H5zM12 5v4M9 14h.01M15 14h.01M2 13v2M22 13v2",
  zap: "M13 2 4 14h7l-1 8 9-12h-7z",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  shield: "M12 3 4 6v6c0 5 3.4 8.2 8 9 4.6-.8 8-4 8-9V6zM9 12l2 2 4-4",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  logout: "M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9",
  logo: "M5 4h6v16H5zM13 4h6l-6 8z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  send: "M4 12 20 4l-6 16-3-7zM11 13l9-9",
  minus: "M5 12h14",
  stop: "M7 7h10v10H7z",
  menu: "M4 7h16M4 12h16M4 17h16",
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
