import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GUTTER, space } from '../theme';
import { Text } from '../theme/Text';

/** Large title with an optional quiet subtitle and trailing action. */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space.md }]}>
      <View style={{ flex: 1 }}>
        <Text variant="largeTitle" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <Text variant="footnote" tone="subtle" style={{ marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: GUTTER, paddingBottom: space.md, gap: space.md },
});
