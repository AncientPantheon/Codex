/**
 * ZBOM Zone Expansion Profiles — verbatim port of OuronetUI's
 * `src/lib/zbomProfiles.ts` (the helper backing the ZBOM settings card).
 *
 * simple:   all zones collapsed
 * basic:    Zone 0 (INFO) expanded, rest collapsed (default)
 * advanced: all zones expanded
 * custom:   individual zone toggles from settings
 *
 * Zone 2 has special behavior: when collapsed, autonomous fields hide
 * but free (user-input) fields remain visible.
 *
 * `ZbomProfile` is re-used from the package's canonical `types/entities`
 * (it already lives on `UiSettings.zbomProfile`) rather than re-declared.
 */

import type { ZbomProfile } from "../types/entities.js";

export interface ZbomZoneExpansion {
  zone0Info: boolean;
  zone1Patron: boolean;
  zone2Inputs: boolean;
  zone3Signing: boolean;
}

const PROFILES: Record<Exclude<ZbomProfile, "custom">, ZbomZoneExpansion> = {
  simple:   { zone0Info: false, zone1Patron: false, zone2Inputs: false, zone3Signing: false },
  basic:    { zone0Info: true,  zone1Patron: false, zone2Inputs: false, zone3Signing: false },
  advanced: { zone0Info: true,  zone1Patron: true,  zone2Inputs: true,  zone3Signing: true  },
};

/**
 * Get zone expansion for a profile.
 * For "custom", pass individual zone settings.
 */
export function getZbomExpansion(
  profile: ZbomProfile,
  custom?: { zbomZone0?: boolean; zbomZone1?: boolean; zbomZone2?: boolean; zbomZone3?: boolean },
): ZbomZoneExpansion {
  if (profile === "custom" && custom) {
    return {
      zone0Info:    custom.zbomZone0 ?? true,
      zone1Patron:  custom.zbomZone1 ?? false,
      zone2Inputs:  custom.zbomZone2 ?? false,
      zone3Signing: custom.zbomZone3 ?? false,
    };
  }
  return PROFILES[profile as Exclude<ZbomProfile, "custom">] ?? PROFILES.basic;
}

/**
 * Detect which profile matches a set of individual zone settings.
 * Returns "custom" if no preset matches.
 */
export function detectProfile(z0: boolean, z1: boolean, z2: boolean, z3: boolean): ZbomProfile {
  if (!z0 && !z1 && !z2 && !z3) return "simple";
  if (z0 && !z1 && !z2 && !z3) return "basic";
  if (z0 && z1 && z2 && z3) return "advanced";
  return "custom";
}
