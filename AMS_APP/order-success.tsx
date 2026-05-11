import { useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  Animated, Easing, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme, Palette } from '@/context/theme';

const APP_FONT = Platform.select({ ios: 'Arial', android: 'sans-serif', default: 'Arial' });

const METHOD_LABEL: Record<string, string> = {
  esewa:  'eSewa',
  khalti: 'Khalti',
  cod:    'Cash on Delivery',
};

export default function OrderSuccessScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const params = useLocalSearchParams<{
    orderId?: string; amount?: string; method?: string; productName?: string;
  }>();

  const orderId   = params.orderId   ?? '—';
  const amount    = parseInt(params.amount ?? '0', 10);
  const method    = (params.method ?? 'esewa').toLowerCase();
  const product   = params.productName ?? 'Your order';
  const isPending = method === 'cod';

  const scale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1, useNativeDriver: true,
      tension: 60, friction: 6,
    }).start();
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={[styles.body, { paddingTop: insets.top + 60 }]}>
        <Animated.View style={[styles.iconCircle, { transform: [{ scale }] }]}>
          <Ionicons
            name={isPending ? 'time-outline' : 'checkmark'}
            size={44}
            color="#fff"
          />
        </Animated.View>

        <Text style={styles.title}>
          {isPending ? 'Order Placed' : 'Payment Successful'}
        </Text>
        <Text style={styles.subtitle}>
          {isPending
            ? "We've got your order. Our courier will collect cash on delivery."
            : 'Your order has been confirmed. We\'ll start preparing it now.'}
        </Text>

        <View style={styles.receiptCard}>
          <View style={styles.receiptRow}>
            <Text style={styles.receiptLabel}>Order ID</Text>
            <Text style={styles.receiptValue}>#{orderId}</Text>
          </View>
          <View style={styles.receiptDivider} />

          <View style={styles.receiptRow}>
            <Text style={styles.receiptLabel}>Item</Text>
            <Text style={[styles.receiptValue, { flex: 1, textAlign: 'right' }]} numberOfLines={1}>
              {product}
            </Text>
          </View>
          <View style={styles.receiptDivider} />

          <View style={styles.receiptRow}>
            <Text style={styles.receiptLabel}>Payment</Text>
            <Text style={styles.receiptValue}>{METHOD_LABEL[method] ?? method}</Text>
          </View>
          <View style={styles.receiptDivider} />

          <View style={styles.receiptRow}>
            <Text style={styles.receiptLabel}>Total</Text>
            <Text style={styles.receiptTotal}>NPR {amount.toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.deliveryNote}>
          <Ionicons name="cube-outline" size={14} color={theme.textMuted} />
          <Text style={styles.deliveryText}>
            Estimated delivery 2–4 business days inside Kathmandu Valley.
          </Text>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.replace('/(tabs)/profile')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>BACK TO ACCOUNT</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => router.replace('/(tabs)/shop')}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryBtnText}>Continue shopping</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(t: Palette) {
  const isDark = t.mode === 'dark';
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },

    body: { flex: 1, alignItems: 'center', paddingHorizontal: 28 },

    iconCircle: {
      width: 92, height: 92, borderRadius: 46,
      backgroundColor: t.accent,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 22,
      shadowColor: '#0d0d12', shadowOpacity: 0.25,
      shadowOffset: { width: 0, height: 12 }, shadowRadius: 24,
      elevation: 8,
    },

    title: {
      fontSize: 26, fontWeight: '800', color: t.textPrimary,
      letterSpacing: -0.6, marginBottom: 8, fontFamily: APP_FONT,
    },
    subtitle: {
      fontSize: 14, color: t.textSecondary, textAlign: 'center',
      lineHeight: 22, marginBottom: 28, maxWidth: 320,
      fontFamily: APP_FONT,
    },

    receiptCard: {
      width: '100%',
      backgroundColor: t.surface,
      borderRadius: 18, padding: 18,
      borderWidth: 1, borderColor: t.hairline,
    },
    receiptRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 6,
    },
    receiptLabel: { fontSize: 12.5, color: t.textSecondary, fontFamily: APP_FONT },
    receiptValue: { fontSize: 13.5, fontWeight: '600', color: t.textPrimary, marginLeft: 16, fontFamily: APP_FONT },
    receiptTotal: { fontSize: 18, fontWeight: '800', color: t.textPrimary, letterSpacing: -0.4, fontFamily: APP_FONT },
    receiptDivider: { height: 1, backgroundColor: t.hairline, marginVertical: 4 },

    deliveryNote: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginTop: 16,
    },
    deliveryText: { fontSize: 12, color: t.textMuted, fontFamily: APP_FONT },

    footer: { paddingHorizontal: 22, paddingTop: 16, gap: 10 },
    primaryBtn: {
      backgroundColor: t.accent,
      paddingVertical: 16, borderRadius: 18,
      alignItems: 'center',
      shadowColor: '#0d0d12', shadowOpacity: 0.2,
      shadowOffset: { width: 0, height: 8 }, shadowRadius: 16,
      elevation: 6,
    },
    primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1.4, fontFamily: APP_FONT },
    secondaryBtn: {
      backgroundColor: t.surface,
      paddingVertical: 16, borderRadius: 18,
      alignItems: 'center',
      borderWidth: 1, borderColor: t.hairline,
    },
    secondaryBtnText: { color: t.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: APP_FONT },
  });
}
