import type {
  GithubPrComment,
  GithubPrCommit,
  GithubPrDetail,
  GithubPrReview,
} from "@/lib/commands";

export const PR_DRAWER_WIDTH_KEY = "astryn:prs:drawer-width:v1";

export type PrTimelineEvent =
  | {
      kind: "comment";
      key: string;
      timestamp: string;
      comment: GithubPrComment;
    }
  | {
      kind: "review";
      key: string;
      timestamp: string;
      review: GithubPrReview;
    }
  | {
      kind: "commit";
      key: string;
      timestamp: string;
      commit: GithubPrCommit;
    };

export function detailTimeline(detail: GithubPrDetail): PrTimelineEvent[] {
  const events: { event: PrTimelineEvent; sourceOrder: number }[] = [];
  let sourceOrder = 0;
  for (const comment of detail.comments) {
    events.push({
      event: {
        kind: "comment",
        key: `comment:${comment.id}`,
        timestamp: comment.createdAt,
        comment,
      },
      sourceOrder: sourceOrder++,
    });
  }
  for (const review of detail.reviews) {
    events.push({
      event: {
        kind: "review",
        key: `review:${review.id}`,
        timestamp: review.submittedAt,
        review,
      },
      sourceOrder: sourceOrder++,
    });
  }
  for (const commit of detail.commits) {
    events.push({
      event: {
        kind: "commit",
        key: `commit:${commit.oid}`,
        timestamp: commit.committedAt,
        commit,
      },
      sourceOrder: sourceOrder++,
    });
  }
  return events
    .sort((left, right) => {
      const leftTime = Date.parse(left.event.timestamp);
      const rightTime = Date.parse(right.event.timestamp);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        const chronological = leftTime - rightTime;
        if (chronological !== 0) return chronological;
      }
      return left.sourceOrder - right.sourceOrder;
    })
    .map(({ event }) => event);
}

export function clampDrawerWidth(width: number, viewportWidth: number): number {
  const viewportMax = Math.max(0, viewportWidth * 0.96);
  const maximum = Math.min(1180, viewportMax);
  const minimum = Math.min(680, maximum);
  return Math.max(minimum, Math.min(maximum, width));
}

function defaultStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function defaultViewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

export function loadDrawerWidth(
  storage: Storage | null = defaultStorage(),
  viewportWidth = defaultViewportWidth(),
): number {
  let saved = Number.NaN;
  try {
    saved = Number(storage?.getItem(PR_DRAWER_WIDTH_KEY));
  } catch {
    // Fall through to the responsive default.
  }
  const preferred = Number.isFinite(saved) && saved > 0 ? saved : viewportWidth * 0.7;
  return Math.round(clampDrawerWidth(preferred, viewportWidth));
}

export function saveDrawerWidth(
  width: number,
  storage: Storage | null = defaultStorage(),
  viewportWidth = defaultViewportWidth(),
): number {
  const clamped = Math.round(clampDrawerWidth(width, viewportWidth));
  try {
    storage?.setItem(PR_DRAWER_WIDTH_KEY, String(clamped));
  } catch {
    // The resized width remains valid for this session if storage is unavailable.
  }
  return clamped;
}

export function reviewStateLabel(state: string): string {
  return state
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
