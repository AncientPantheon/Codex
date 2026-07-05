/**
 * <CodexInfoPanel> — read-only stats panel.
 *
 * Useful for settings pages / dashboards that want to show "the codex
 * has N seeds, M accounts, K pure keypairs, last updated X ago". No
 * mutation, pure display.
 *
 * Default markup is a semantic <dl> with terms and definitions.
 * Consumers theme via className + render-prop slots, or take full
 * control via the `render` prop.
 */

import * as React from "react";
import { useCodex } from "../hooks/useCodex.js";

export interface CodexInfoRenderArgs {
  isReady: boolean;
  isLocked: boolean;
  isDirty: boolean;
  kadenaSeedsCount: number;
  ouroAccountsCount: number;
  pureKeypairsCount: number;
  addressBookCount: number;
  watchListCount: number;
  schemaVersion: number;
  lastUpdatedAt: string | null;
  lastUpdatedDevice: string;
}

export interface CodexInfoPanelProps {
  className?: string;
  render?: (args: CodexInfoRenderArgs) => React.ReactNode;
}

export function CodexInfoPanel({
  className,
  render,
}: CodexInfoPanelProps): React.JSX.Element {
  const codex = useCodex();

  const args: CodexInfoRenderArgs = {
    isReady: codex.isReady,
    isLocked: codex.isLocked,
    isDirty: codex.isDirty,
    kadenaSeedsCount: codex.kadenaSeeds.length,
    ouroAccountsCount: codex.ouroAccounts.length,
    pureKeypairsCount: codex.pureKeypairs.length,
    addressBookCount: codex.addressBook.length,
    watchListCount: codex.watchList.length,
    schemaVersion: codex.schemaVersion,
    lastUpdatedAt: codex.lastUpdatedAt,
    lastUpdatedDevice: codex.lastUpdatedDevice,
  };

  if (render) {
    return <>{render(args)}</>;
  }

  return (
    <dl className={className}>
      <dt>Status</dt>
      <dd>
        {args.isReady ? "Ready" : "Initialising…"}
        {args.isLocked ? " · Locked" : " · Unlocked"}
        {args.isDirty ? " · Unsaved" : ""}
      </dd>
      <dt>Kadena seeds</dt>
      <dd>{args.kadenaSeedsCount}</dd>
      <dt>Ouro accounts</dt>
      <dd>{args.ouroAccountsCount}</dd>
      <dt>Pure keypairs</dt>
      <dd>{args.pureKeypairsCount}</dd>
      <dt>Address book entries</dt>
      <dd>{args.addressBookCount}</dd>
      <dt>Watch list entries</dt>
      <dd>{args.watchListCount}</dd>
      <dt>Schema version</dt>
      <dd>{args.schemaVersion}</dd>
      <dt>Last updated</dt>
      <dd>
        {args.lastUpdatedAt
          ? `${args.lastUpdatedAt} (${args.lastUpdatedDevice})`
          : "never"}
      </dd>
    </dl>
  );
}
