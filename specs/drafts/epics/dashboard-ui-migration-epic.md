# Epic: Migrate proxx dashboard frontend to @devel/ui component library

**Status:** Draft
**Epic SP:** 13 (broken into 5 sub-specs ≤5 SP each)
**Priority:** P2
**Parent:** `specs/drafts/dashboard-ui-modernization.md`

## Problem

The proxx web dashboard (`web/src/`) uses hand-rolled CSS and inline styles across 6637 lines of frontend code. The `@devel/ui` component library at `packages/ui/` provides 19 production-ready React components with design tokens, Storybook documentation, and consistent accessibility.

Current dashboard has:
- 2267 lines of custom CSS (`styles.css`)
- 8 page components totaling 4388 lines (CredentialsPage alone is 1819 lines)
- No shared component primitives — every page re-implements buttons, cards, badges, inputs
- Inconsistent styling patterns (inline styles, CSS classes, Tailwind-like utilities mixed)

## Available @devel/ui components

### Base Primitives (8 components)
| Component | Variants | Use case in proxx |
|-----------|----------|-------------------|
| Button | primary, secondary, ghost, danger | All action buttons, nav items |
| Badge | default, success, warning, error, info | Account status, health indicators |
| Spinner | sm, md, lg, xl | Loading states across all pages |
| Card | default, outlined, elevated | Dashboard panels, credential cards |
| Modal | sm, md, lg, xl, full | Confirmation dialogs, forms |
| Tooltip | 8 placements | Help text, status explanations |
| Input | text, password, email, search | Search bars, form fields |
| Progress | default, success, warning, error | Quota bars, health indicators |

### AI/IDE Components (5 components)
| Component | Use case in proxx |
|-----------|-------------------|
| CommandPalette | Global command search (Ctrl+K) |
| Chat | ChatPage replacement for current custom UI |
| Toast | Notification system (replaces ad-hoc alerts) |
| FileTree | Model list navigation |
| Tabs | Dashboard tab organization |

### KMS/CMS Components (4 components)
| Component | Use case in proxx |
|-----------|-------------------|
| Feed | Event log / request log display |
| Markdown | Documentation panels, help text |
| CodeBlock | API response examples, error details |
| DiffViewer | Config change history |

## Sub-specs

| # | Sub-spec | SP | File |
|---|----------|----|------|
| 1 | Add @devel/ui dependency + ToastProvider + global theme | 2 | `epics/dashboard-ui-migration--dependency-setup.md` |
| 2 | Migrate DashboardPage + HostsPage (primitives) | 3 | `epics/dashboard-ui-migration--dashboard-hosts.md` |
| 3 | Migrate CredentialsPage (cards, modals, progress) | 5 | `epics/dashboard-ui-migration--credentials.md` |
| 4 | Migrate FederationPage + AnalyticsPage (tabs, feed, badges) | 3 | `epics/dashboard-ui-migration--federation-analytics.md` |
| 5 | Migrate ChatPage + remove custom CSS | 3 | `epics/dashboard-ui-migration--chat-cleanup.md` |

## Execution order
1 → 2 → 3 → 4 → 5 (sequential, each builds on previous)

## Definition of done
- `@devel/ui-react` is a dependency in proxx web package
- All 8 pages use @devel/ui components instead of hand-rolled equivalents
- `web/src/styles.css` reduced from 2267 lines to <500 (only page-specific overrides)
- Total frontend code reduced from 6816 lines to <4500 lines
- Toast notification system replaces ad-hoc alert patterns
- CommandPalette available via Ctrl+K
- All pages maintain existing functionality
- `pnpm build` and `pnpm web:build` pass
- No visual regressions in core workflows
