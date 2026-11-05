import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { font, useTheme, type Colors } from './index';

/**
 * The type scale. Every piece of text in the app goes through one of these
 * variants, so sizes, weights and line heights stay consistent.
 * Prices use IBM Plex Mono so digits line up in columns.
 */
const variants = {
  largeTitle: { fontFamily: font.bold, fontSize: 30, lineHeight: 34, letterSpacing: -0.6 },
  title: { fontFamily: font.semibold, fontSize: 21, lineHeight: 26, letterSpacing: -0.3 },
  headline: { fontFamily: font.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -0.1 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21 },
  bodyMedium: { fontFamily: font.medium, fontSize: 15, lineHeight: 21 },
  callout: { fontFamily: font.regular, fontSize: 14, lineHeight: 19 },
  footnote: { fontFamily: font.regular, fontSize: 13, lineHeight: 17 },
  footnoteMedium: { fontFamily: font.medium, fontSize: 13, lineHeight: 17 },
  caption: { fontFamily: font.medium, fontSize: 11.5, lineHeight: 14, letterSpacing: 0.2 },
  overline: { fontFamily: font.semibold, fontSize: 11.5, lineHeight: 14, letterSpacing: 0.9, textTransform: 'uppercase' },
  // Single big numbers use the text face with proportional digits; fixed-width
  // digits and points only help when prices line up in a column.
  priceXL: { fontFamily: font.bold, fontSize: 42, lineHeight: 46, letterSpacing: -1 },
  priceL: { fontFamily: font.semibold, fontSize: 24, lineHeight: 28, letterSpacing: -0.4 },
  priceM: { fontFamily: font.monoSemibold, fontSize: 17, lineHeight: 21, letterSpacing: -0.3 },
  priceS: { fontFamily: font.monoMedium, fontSize: 13, lineHeight: 16 },
  priceXS: { fontFamily: font.mono, fontSize: 12, lineHeight: 15 },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof variants;
export type Tone = 'text' | 'muted' | 'subtle' | 'signal' | 'warn' | 'danger' | 'invert';

const toneColor = (c: Colors, tone: Tone) =>
  ({ text: c.text, muted: c.muted, subtle: c.subtle, signal: c.signalText, warn: c.warn, danger: c.danger, invert: c.invertText })[tone];

export function Text({ variant = 'body', tone = 'text', style, ...rest }: TextProps & { variant?: TextVariant; tone?: Tone }) {
  const { c } = useTheme();
  return <RNText maxFontSizeMultiplier={1.6} {...rest} style={[variants[variant], { color: toneColor(c, tone) }, style]} />;
}
