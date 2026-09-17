/** Shared brightness and panel-opacity bounds for Desktop character themes. */

/** Wallpaper `filter: brightness()` minimum, as an integer percent. */
export const CHARACTER_THEME_BRIGHTNESS_MIN = 50
/** Wallpaper `filter: brightness()` maximum, as an integer percent. */
export const CHARACTER_THEME_BRIGHTNESS_MAX = 150
/** Wallpaper brightness that matches the previous unfiltered wallpaper. */
export const CHARACTER_THEME_BRIGHTNESS_DEFAULT = 100
/** Conversation and details overlay minimum, as an integer percent. */
export const CHARACTER_THEME_OPACITY_MIN = 20
/** Conversation and details overlay maximum, as an integer percent. */
export const CHARACTER_THEME_OPACITY_MAX = 100
/** Conversation overlay that keeps the wallpaper readable. */
export const CHARACTER_THEME_OPACITY_DEFAULT = 56
/** Sidebar mix used when overlay opacity is at {@link CHARACTER_THEME_OPACITY_DEFAULT}. */
const CHARACTER_THEME_SIDEBAR_OPACITY_AT_DEFAULT = 29

/** Wallpaper brightness and chrome overlay persisted next to `characterTheme`. */
export interface CharacterThemeAppearance {
  /** Wallpaper brightness percent, inclusive of {@link CHARACTER_THEME_BRIGHTNESS_MIN}. */
  readonly brightness: number
  /** Conversation overlay percent, inclusive of {@link CHARACTER_THEME_OPACITY_MIN}. */
  readonly opacity: number
}

/**
 * Clamp one integer percent into an inclusive range.
 * @param value - persisted settings value.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @param fallback - used when the value is missing or not an integer in range.
 */
export function clampCharacterThemePercent(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

/**
 * @param settings - Desktop settings snapshot fields.
 * @returns clamped wallpaper brightness and panel overlay.
 */
export function characterThemeAppearance(settings?: {
  readonly characterThemeBrightness?: unknown
  readonly characterThemeOpacity?: unknown
}): CharacterThemeAppearance {
  return {
    brightness: clampCharacterThemePercent(
      settings?.characterThemeBrightness,
      CHARACTER_THEME_BRIGHTNESS_MIN,
      CHARACTER_THEME_BRIGHTNESS_MAX,
      CHARACTER_THEME_BRIGHTNESS_DEFAULT,
    ),
    opacity: clampCharacterThemePercent(
      settings?.characterThemeOpacity,
      CHARACTER_THEME_OPACITY_MIN,
      CHARACTER_THEME_OPACITY_MAX,
      CHARACTER_THEME_OPACITY_DEFAULT,
    ),
  }
}

/**
 * @param opacity - conversation overlay percent.
 * @returns sidebar mix percent, keeping the 29/56 ratio.
 */
export function characterThemeSidebarOpacity(opacity: number): number {
  return Math.max(
    CHARACTER_THEME_OPACITY_MIN,
    Math.round(opacity * CHARACTER_THEME_SIDEBAR_OPACITY_AT_DEFAULT / CHARACTER_THEME_OPACITY_DEFAULT),
  )
}
