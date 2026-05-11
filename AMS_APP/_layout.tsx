import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput, Platform } from 'react-native';
import { useTheme } from '@/context/theme';

// ── Global font override for all screens after login ─────────────────────────
// Arial on iOS (native), graceful fallback to sans-serif on Android.
const APP_FONT = Platform.select({ ios: 'Arial', android: 'sans-serif', default: 'Arial' });

// Apply once — this only runs when the tabs layout is mounted (i.e. post-login)
// and is scoped via setting `style.fontFamily` on the default props rather than
// touching component internals.
(Text as any).defaultProps = (Text as any).defaultProps || {};
(Text as any).defaultProps.style = [
  ...((((Text as any).defaultProps.style ?? []) as any[]).filter(Boolean) as any),
  { fontFamily: APP_FONT },
];

(TextInput as any).defaultProps = (TextInput as any).defaultProps || {};
(TextInput as any).defaultProps.style = [
  ...((((TextInput as any).defaultProps.style ?? []) as any[]).filter(Boolean) as any),
  { fontFamily: APP_FONT },
];

function TabIcon(
  name: React.ComponentProps<typeof Ionicons>['name'],
  focusedName: React.ComponentProps<typeof Ionicons>['name'],
) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? focusedName : name} size={24} color={color} />
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  return (
    <Tabs
      initialRouteName="track"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: isDark ? '#0f0a18' : '#ffffff',
          borderTopWidth: 1,
          borderTopColor: isDark ? 'rgba(255,255,255,0.07)' : theme.hairline,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: isDark ? 'rgba(255,255,255,0.3)' : theme.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
          fontFamily: APP_FONT,
        },
      }}
    >
      <Tabs.Screen
        name="track"
        options={{
          title: 'Track',
          tabBarIcon: TabIcon('heart-outline', 'heart'),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Monitor',
          tabBarIcon: TabIcon('pulse-outline', 'pulse'),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Treks',
          tabBarIcon: TabIcon('map-outline', 'map'),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: TabIcon('time-outline', 'time'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: TabIcon('person-outline', 'person'),
        }}
      />
    </Tabs>
  );
}