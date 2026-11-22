const P: Record<string, string> = {
  edit: "M3 5h18v11H3zM3 20h18M8 20v-4M13 20v-4",
  menu: "M4 7h16M4 12h16M4 17h16",
  nodes: "M2 4h7v6H2zM15 14h7v6h-7zM9 7c5 0 1 10 6 10",
  board: "M3 3h7v10H3zM13 6h8v5h-8zM13 14h8v6h-8z",
  prev: "M6 5v14M18 6l-9 6 9 6z",
  next: "M18 5v14M6 6l9 6-9 6z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  export: "M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  cycle: "M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4",
  cursor: "M5 3l14 7-6 2-2 6z",
  rect: "M4 6h16v12H4z",
  ellipse: "M12 5a8 7 0 1 0 0 14 8 7 0 1 0 0-14z",
  star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  type: "M4 7V5h16v2M9 19h6M12 5v14",
  image: "M3 4h18v16H3zM21 16l-5-5-9 9M9 8a2 2 0 1 0 0 4 2 2 0 1 0 0-4z",
  drop: "M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z",
  cube: "M12 2l9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10",
  grid: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
  scissors: "M6 3a3 3 0 1 0 0 6 3 3 0 1 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12",
  ripple: "M3 12h4M17 12h4M7 8v8M17 8v8M10 12h4",
  magnet: "M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4M10 3v8a2 2 0 0 0 4 0V3",
  diamond: "M12 2.5c.5 0 .9.3 1.2.7l5.3 7.7c.4.6.4 1.6 0 2.2l-5.3 7.7c-.3.4-.7.7-1.2.7s-.9-.3-1.2-.7l-5.3-7.7c-.4-.6-.4-1.6 0-2.2l5.3-7.7c.3-.4.7-.7 1.2-.7z",
  keyadd: "M9 3.5c.4 0 .7.2.9.5l3.7 5.6c.3.5.3 1.3 0 1.8L9.9 17c-.2.3-.5.5-.9.5s-.7-.2-.9-.5l-3.7-5.6c-.3-.5-.3-1.3 0-1.8L8.1 4c.2-.3.5-.5.9-.5zM19 14v7M15.5 17.5h7",
  keydel: "M9 3.5c.4 0 .7.2.9.5l3.7 5.6c.3.5.3 1.3 0 1.8L9.9 17c-.2.3-.5.5-.9.5s-.7-.2-.9-.5l-3.7-5.6c-.3-.5-.3-1.3 0-1.8L8.1 4c.2-.3.5-.5.9-.5zM15.5 17.5h7",
  curve: "M3 20C10 20 9 4 21 4",
  pen: "M4 20l4.5-1L19 8.5 15.5 5 5 15.5 4 20zM13.5 7l3.5 3.5",
  line: "M5 19L19 5M5 19h.01M19 5h.01",
  shapes: "M4 4h7v7H4zM17.5 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7zM7.5 13l4 7h-8zM14 14h6v6h-6z",
  motion: "M3 18c4 0 5-12 9-12s5 12 9 12M3 18h.01M21 18h.01",
  zin: "M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14zM21 21l-4.3-4.3M11 8v6M8 11h6",
  zout: "M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14zM21 21l-4.3-4.3M8 11h6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z",
  eyeoff: "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  unlock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  music: "M9 18V5l12-2v13M6 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6zM18 13a3 3 0 1 0 0 6 3 3 0 1 0 0-6z",
  chev: "M6 9l6 6 6-6",
  group: "M3 3h18v18H3zM7 7h5v5H7zM12 12h5v5h-5z",
  x: "M6 6l12 12M18 6L6 18",
  move: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  morph: "M7 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8zM14 8h8v8h-8z",
  frame: "M7 3v18M17 3v18M3 7h18M3 17h18",
  wheel: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7zM12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21",
  plus: "M12 5v14M5 12h14",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  camera: "M3 7h12v10H3zM15 10l6-3v10l-6-3",
  history: "M12 3a9 9 0 1 1-8.5 6M3 4v5h5M12 8v4l3 2",
  sortLayer: "M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5",
  sortType: "M4 4h7v7H4zM17.5 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM7.5 13l4 7h-8zM14 14h7M17.5 14v7",
  sortStart: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2",
  sortNew: "M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M5 19l3.5-3.5M15.5 8.5L19 5",
  sortName: "M3 19l4-14 4 14M4.5 14h5M14 5h7l-7 14h7",
  mask: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 7h4.5M12 11h6M12 15h5",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  side: "M3 3h18v18H3zM9 3v18",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  anim: "M3 12h7M14 6l6 6-6 6M3 7h4M3 17h4",
  save: "M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7",
  folder: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  gimbal: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 3c-3 3-3 15 0 18M12 3c3 3 3 15 0 18M3 12h18",
};

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={"i " + (className ?? "")} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

export function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" /></svg>
  ) : (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z" fill="currentColor" /></svg>
  );
}

/** The href of a path, for use inside other SVGs (the wheel). */
export const iconPath = (name: string) => P[name];
