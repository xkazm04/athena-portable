/**
 * `@athena/demo-kit/ui` - shared primitives, and only where plumbing demands sameness.
 *
 * Styles live in `@athena/demo-kit/ui/demo-kit.css`; import it once from the app's globals.css.
 * Everything is themed through `--dk-*` custom properties so the apps can look nothing alike.
 */
export { AppShell, type AppShellProps, type NavItem } from "./AppShell";
export { DataTable, type Column, type DataTableProps, type SortDir } from "./DataTable";
export { DetailPane, type DetailField, type DetailPaneProps } from "./DetailPane";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { ToastProvider, useToast, type ToastMessage, type ToastTone } from "./Toast";
export {
  ThemeVariantSwitcher,
  useThemeVariant,
  useVariantValue,
  type ThemeVariant,
  type ThemeVariantSwitcherProps,
} from "./theme";
