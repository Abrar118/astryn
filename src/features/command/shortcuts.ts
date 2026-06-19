export type CreateShortcut = {
  key: string;
  editable: boolean;
  overlayOpen: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

export function shouldOpenCreateShortcut(event: CreateShortcut): boolean {
  return (
    event.key.toLowerCase() === "c" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.editable &&
    !event.overlayOpen
  );
}
