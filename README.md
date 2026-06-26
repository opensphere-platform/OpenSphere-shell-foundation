# foundation — kind: subShell (F/E + B/E 수직 도메인)

kind: subShell  ·  hostRef: main  ·  tier 2 (host = 도메인 B/E 소유자)
frontend/ : opensphere-foundation-shell/ui (in-tree)
backend/  : foundation-shell/control-plane + foundation-{data,comm,ai,observability}
note: 공유 인프라 도메인 — 타 셸 consume(자기 복제 금지). v0.5 레퍼런스 구현
정본: 00-V2-구조설계.md §3
