const paths: Record<string, string> = {
  home: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  news: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 8h5v5H7zM15 8h3M15 12h3M7 16h11"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M7 14h2M13 14h2M7 17h2"/>',
  grid: '<rect x="3" y="3" width="8" height="18" rx="2"/><rect x="15" y="3" width="6" height="8" rx="2"/><rect x="15" y="15" width="6" height="6" rx="2"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',
  inbox: '<path d="M5 4h14l3 12v4H2v-4L5 4ZM2 15h6l2 3h4l2-3h6"/>',
  settings:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  book: '<path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-3-1-7-2-10 1Z"/>',
  chart: '<path d="M3 3v18h18M6 16l5-5 4 2 6-9"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  github:
    '<path d="M9 20c-4 1-4-2-6-2M15 22v-4c0-1-.2-2-1-2 4-.5 6-2 6-6 0-2-.5-3-1.5-4 .2-1 .2-3-.5-4-2 0-3 1-4 2a14 14 0 0 0-5 0C8 3 6 2 4 2c-.7 1-.7 3-.5 4C2.5 7 2 8 2 10c0 4 2 5.5 6 6-.8.7-1 2-1 3v3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  grip: '<circle cx="8" cy="6" r="1"/><circle cx="16" cy="6" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="18" r="1"/><circle cx="16" cy="18" r="1"/>',
};
export function Icon({ name }: { name: string }) {
  return (
    <span className="ico">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: paths[name] || paths.spark }}
      />
    </span>
  );
}
export function Sculpture() {
  return (
    <div className="sculpture" aria-hidden="true">
      <i className="orbit" />
      <i className="orbit" />
      <i className="orbit" />
      <i className="orbit" />
      <div className="planet-system">
        <div className="satellite-track" />
        <div className="planet" />
        <i className="satellite-light" />
      </div>
    </div>
  );
}
