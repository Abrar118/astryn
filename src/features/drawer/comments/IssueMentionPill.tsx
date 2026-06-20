import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { StatusIcon, PRIORITIES } from "../issueGlyphs";
import type { MentionTarget } from "../markdownComponents";

function humanizeStateType(type: string): string {
  switch (type) {
    case "backlog": return "Backlog";
    case "unstarted": return "Todo";
    case "started": return "In Progress";
    case "completed": return "Done";
    case "canceled": return "Canceled";
    default: return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

function HoverCard({
  target,
  anchorRect,
}: {
  target: MentionTarget;
  anchorRect: DOMRect;
}) {
  const CARD_HEIGHT_EST = 160;
  const CARD_WIDTH = 320;
  const GAP = 6;

  // Position above or below the anchor depending on space
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  const placeAbove = spaceBelow < CARD_HEIGHT_EST + GAP && spaceAbove > spaceBelow;

  let top: number;
  if (placeAbove) {
    top = anchorRect.top - CARD_HEIGHT_EST - GAP + window.scrollY;
  } else {
    top = anchorRect.bottom + GAP + window.scrollY;
  }

  // Clamp horizontal position so card stays on-screen
  let left = anchorRect.left + window.scrollX;
  const rightEdge = left + CARD_WIDTH;
  if (rightEdge > window.innerWidth - 8) {
    left = window.innerWidth - CARD_WIDTH - 8;
  }
  if (left < 8) left = 8;

  const priorityEntry = PRIORITIES.find((p) => p.value === target.priority);
  const stateLabel = target.stateName ?? humanizeStateType(target.stateType);

  return (
    <div
      role="tooltip"
      style={{ top, left, width: CARD_WIDTH }}
      className="pointer-events-none fixed z-50 rounded-xl border border-border bg-popover p-3 shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
    >
      {/* Top row */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{target.identifier}</span>
        {target.assigneeName && (
          <span className="ml-auto flex items-center gap-1.5">
            <Avatar name={target.assigneeName} size={18} />
            <span className="text-xs text-muted-foreground">{target.assigneeName}</span>
          </span>
        )}
      </div>

      {/* Title */}
      <p className="line-clamp-2 font-medium text-foreground">{target.title}</p>

      {/* Divider */}
      <div className="my-2.5 border-t border-border" />

      {/* Bottom row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {/* Status */}
        <span className="flex items-center gap-1">
          <StatusIcon type={target.stateType} color={target.stateColor} />
          {stateLabel}
        </span>

        {/* Project */}
        {target.projectName && (
          <span className="flex items-center gap-1">
            <Box className="size-3.5" />
            {target.projectName}
          </span>
        )}

        {/* Priority */}
        {priorityEntry && (
          <span className="flex items-center gap-1">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: priorityEntry.color }} />
            {priorityEntry.label}
          </span>
        )}
      </div>
    </div>
  );
}

export function IssueMentionPill({
  target,
  href,
  onActivate,
}: {
  target: MentionTarget;
  href: string;
  onActivate: (href: string) => void;
}) {
  const [showCard, setShowCard] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleOpen = useCallback(() => {
    if (openTimerRef.current !== null) return;
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      if (buttonRef.current) {
        setAnchorRect(buttonRef.current.getBoundingClientRect());
        setShowCard(true);
      }
    }, 150);
  }, []);

  const cancelOpen = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    setShowCard(false);
    setAnchorRect(null);
  }, []);

  useEffect(() => {
    return () => {
      if (openTimerRef.current !== null) clearTimeout(openTimerRef.current);
    };
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onActivate(href)}
        onMouseEnter={scheduleOpen}
        onMouseLeave={cancelOpen}
        onFocus={scheduleOpen}
        onBlur={cancelOpen}
        className="mx-px inline-flex items-center gap-1 rounded-md border border-border bg-secondary/70 px-1.5 py-0.5 align-baseline text-[0.85em] font-medium text-foreground no-underline transition-colors hover:bg-accent"
      >
        <StatusIcon type={target.stateType} color={target.stateColor} />
        <span className="text-muted-foreground">{target.identifier}</span>
        <span className="max-w-[24rem] truncate">{target.title}</span>
      </button>
      {showCard && anchorRect &&
        createPortal(
          <HoverCard target={target} anchorRect={anchorRect} />,
          document.body,
        )}
    </>
  );
}
