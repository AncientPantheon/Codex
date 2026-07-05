// @ancientpantheon/codex-ouronet/google-drive — opt-in cloud sync.
//
// Separate subpath so consumers that don't want Google Drive don't pull in
// its OAuth + Google API deps. Per spec §2.5 G2 and §8 Q2 (resolved).
//
// Inventory:
//   - useGoogleDrive() hook: { isLinked, email, lastSavedAt, login, logout,
//                              saveCodex, loadCodex }
//   - <GoogleDriveSyncPanel>: headless component bundling the hook + UI flow
//
// Ports OuronetUI's `useGoogleDrive` hook + the
// `CodexSettingsTab.GoogleSyncCardContent` component shape, themed via
// render-prop slots so consumers can match their visual identity.
//
// Implementation lands in Phase 6 of the modular-codex spec (alongside other
// components).
// See: stoa-js/.bee/specs/2026-05-24-ouronet-codex-modular-package/spec.md §2.5G + §8.2
export {};
