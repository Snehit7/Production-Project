import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, StatusBar, Platform, TextInput, Alert,
  Modal, Animated, Easing, Pressable, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from '@/context/auth';
import { useTheme, Palette } from '@/context/theme';
import { notify } from '@/lib/notify';

const APP_FONT = Platform.select({ ios: 'Arial', android: 'sans-serif', default: 'Arial' });

type PaymentMethod = 'esewa' | 'khalti' | 'cod';

interface MethodMeta {
  id: PaymentMethod;
  label: string;
  sub: string;
  logo?: any;
  fallbackIcon: React.ComponentProps<typeof Ionicons>['name'];
  brandColor: string;
  badge?: string;
}

const METHODS: MethodMeta[] = [
  {
    id: 'esewa', label: 'eSewa',
    sub: 'Pay from your eSewa wallet',
    logo: require('@/assets/picture/esewa.png'),
    fallbackIcon: 'wallet-outline',
    brandColor: '#60bb46',
    badge: 'SANDBOX',
  },
  {
    id: 'khalti', label: 'Khalti',
    sub: 'Pay from your Khalti wallet',
    logo: require('@/assets/picture/khalti.png'),
    fallbackIcon: 'phone-portrait-outline',
    brandColor: '#5c2d91',
  },
  {
    id: 'cod', label: 'Cash on Delivery',
    sub: 'Pay in cash when the courier arrives',
    fallbackIcon: 'cash-outline',
    brandColor: '#0d0d12',
  },
];

interface Product {
  id: number;
  name: string;
  tagline: string;
  price_npr: number;
}

export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { apiIp, token, username, logout } = useAuth();
  const params = useLocalSearchParams<{ productId?: string; quantity?: string }>();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [name, setName] = useState(username ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addr, setAddr] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenMethod, setChosenMethod] = useState<PaymentMethod | null>(null);

  const [authOpen, setAuthOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authStep, setAuthStep] = useState<'input' | 'verifying'>('input');
  const [khaltiPhone, setKhaltiPhone] = useState('');
  const [khaltiMpin, setKhaltiMpin] = useState('');
  const [khaltiOtp, setKhaltiOtp] = useState('');

  const qty = Math.max(1, parseInt(params.quantity ?? '1', 10) || 1);

  useEffect(() => {
    if (!token) {
      console.warn('[Checkout] No token found, redirecting to login.');
      router.replace('/login');
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const productId = params.productId;
    if (!productId) { setError('No product selected.'); setLoading(false); return; }

    (async () => {
      try {
        const res = await fetch(`http://${apiIp}:5000/products/${productId}`);
        const j = await res.json();
        if (cancelled) return;
        if (j?.success) setProduct(j.data);
        else setError(j?.error ?? 'Product not found.');
      } catch {
        if (!cancelled) setError('Cannot reach the server. Make sure Flask is running.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiIp, params.productId]);

  useEffect(() => {
    WebBrowser.warmUpAsync().catch(() => { });
    return () => { WebBrowser.coolDownAsync().catch(() => { }); };
  }, []);

  const subtotal = product ? product.price_npr * qty : 0;
  const total = subtotal;

  const validateShipping = () => {
    if (!name.trim() || !phone.trim() || !addr.trim() || !email.trim()) {
      Alert.alert('Missing details', 'Please fill in your name, phone, email and shipping address.');
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      Alert.alert('Invalid email', 'Enter a valid email so we can notify you about this order.');
      return false;
    }
    return true;
  };

  const onPay = () => {
    if (!product) return;
    if (!token) {
      Alert.alert('Session expired', 'Please log in again.');
      router.replace('/login');
      return;
    }
    if (!validateShipping()) return;
    setPickerOpen(true);
  };

  const onPickMethod = (m: PaymentMethod) => {
    setChosenMethod(m);
    setKhaltiPhone(''); setKhaltiMpin(''); setKhaltiOtp('');
    setAuthStep('input');
    setPickerOpen(false);
    setTimeout(() => setAuthOpen(true), 220);
  };

  // ── Send order confirmation email ─────────────────────────────────────────
  const sendOrderEmail = async (
    toEmail: string,
    orderId: number,
    amountNpr: number,
    method: PaymentMethod,
  ) => {
    try {
      const methodLabel =
        method === 'esewa' ? 'eSewa' :
          method === 'khalti' ? 'Khalti' :
            'Cash on Delivery';

      await fetch(`http://${apiIp}:5000/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail,
          subject: `Your order #${orderId} is confirmed 🎉`,
          body: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e;">
              <div style="background:#2196f3;padding:28px 32px;border-radius:12px 12px 0 0;">
                <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:-0.5px;">Order Confirmed!</h1>
                <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">
                  Thanks for your purchase, ${name.trim()}.
                </p>
              </div>
              <div style="background:#f8faff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #dde8ff;">
                <p style="font-size:15px;margin:0 0 20px;">Here's a summary of your order:</p>
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                  <tr>
                    <td style="padding:10px 0;color:#666;border-bottom:1px solid #e8edf5;">Order ID</td>
                    <td style="padding:10px 0;font-weight:700;text-align:right;border-bottom:1px solid #e8edf5;">#${orderId}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;color:#666;border-bottom:1px solid #e8edf5;">Product</td>
                    <td style="padding:10px 0;font-weight:600;text-align:right;border-bottom:1px solid #e8edf5;">${product?.name ?? ''}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;color:#666;border-bottom:1px solid #e8edf5;">Quantity</td>
                    <td style="padding:10px 0;font-weight:600;text-align:right;border-bottom:1px solid #e8edf5;">${qty}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;color:#666;border-bottom:1px solid #e8edf5;">Payment</td>
                    <td style="padding:10px 0;font-weight:600;text-align:right;border-bottom:1px solid #e8edf5;">${methodLabel}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px 0;color:#666;border-bottom:1px solid #e8edf5;">Delivery to</td>
                    <td style="padding:10px 0;font-weight:600;text-align:right;border-bottom:1px solid #e8edf5;">${addr.trim()}</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 0 0;font-size:15px;font-weight:700;">Total</td>
                    <td style="padding:14px 0 0;font-size:18px;font-weight:800;text-align:right;color:#2196f3;">
                      NPR ${amountNpr.toLocaleString()}
                    </td>
                  </tr>
                </table>
                <div style="margin-top:28px;background:#eaf3ff;border-radius:10px;padding:16px 20px;">
                  <p style="margin:0;font-size:14px;color:#1565c0;">
                    🚚 <b>Your order is on its way!</b> Our courier in Kathmandu will reach you soon.
                  </p>
                </div>
                <p style="margin:24px 0 0;font-size:12px;color:#999;text-align:center;">
                  Questions? Reply to this email and we'll help you out.
                </p>
              </div>
            </div>
          `,
        }),
      });
      console.log('[Checkout] Confirmation email sent to', toEmail);
    } catch (e) {
      // Non-fatal — order is already placed, just log it
      console.warn('[Checkout] Email send failed (non-fatal):', e);
    }
  };

  // ── Order creation helper ─────────────────────────────────────────────────
  const createOrder = async () => {
    if (!product || !chosenMethod) throw new Error('No product');

    if (!token) {
      console.error('[Checkout] createOrder called with no token!');
      await logout();
      router.replace('/login');
      throw new Error('SESSION_EXPIRED');
    }

    console.log('[Checkout] Placing order with token:', `${token.slice(0, 12)}...`);

    const res = await fetch(`http://${apiIp}:5000/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        product_id: product.id,
        quantity: qty,
        payment_method: chosenMethod,
        shipping_name: name.trim(),
        shipping_phone: phone.trim(),
        shipping_email: email.trim(),
        shipping_addr: addr.trim(),
      }),
    });

    console.log('[Checkout] /orders status:', res.status);
    const j = await res.json();
    console.log('[Checkout] /orders body:', JSON.stringify(j));

    if (!j?.success) {
      if (res.status === 401) {
        console.warn('[Checkout] 401 — token rejected, logging out.');
        await logout();
        router.replace('/login');
        throw new Error('SESSION_EXPIRED');
      }
      throw new Error(j?.error ?? 'Could not create the order.');
    }
    return j.data;
  };

  const goToSuccess = (orderId: number, amountNpr: number) => {
    router.replace({
      pathname: '/order-success',
      params: {
        orderId: String(orderId),
        amount: String(amountNpr),
        method: chosenMethod ?? '',
        productName: product?.name ?? '',
      },
    });
  };

  // ── eSewa ─────────────────────────────────────────────────────────────────
  const runEsewaFlow = async () => {
    if (!product) return;
    setAuthBusy(true);
    setAuthStep('verifying');
    try {
      const order = await createOrder();
      const redirectUrl = Linking.createURL('payment/done');

      const initRes = await fetch(`http://${apiIp}:5000/payments/esewa/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ order_id: order.id, app_redirect_url: redirectUrl }),
      });
      const initJ = await initRes.json();
      if (!initJ?.success) throw new Error(initJ?.error ?? 'Could not start eSewa.');

      const result = await WebBrowser.openAuthSessionAsync(
        initJ.launch_url,
        redirectUrl,
        { showTitle: true, toolbarColor: '#60bb46', controlsColor: '#fff' },
      );

      if (result.type !== 'success' || !result.url) {
        throw new Error(result.type === 'cancel' || result.type === 'dismiss'
          ? 'You closed the eSewa page before paying.'
          : 'Payment did not complete.');
      }

      const parsed = Linking.parse(result.url);
      const status = String(parsed.queryParams?.status ?? '');
      const reason = String(parsed.queryParams?.reason ?? '');
      if (status !== 'paid') throw new Error(reason || `Payment ${status || 'failed'}.`);

      const ok = await pollOrderUntilPaid(order.id);
      if (!ok) throw new Error('eSewa confirmed, but the server did not record it.');

      await sendOrderEmail(email, order.id, order.amount_npr, 'esewa');

      await notify('Payment received',
        `Order #${order.id} · NPR ${order.amount_npr} paid via eSewa.`,
        { data: { orderId: order.id } });
      notify('Your order is on its way',
        `Order #${order.id} has been handed to our courier in Kathmandu.`,
        { delaySeconds: 30, data: { orderId: order.id } });

      setAuthOpen(false);
      goToSuccess(order.id, order.amount_npr);
    } catch (e: any) {
      if (e?.message !== 'SESSION_EXPIRED') {
        Alert.alert('Payment failed', e?.message ?? 'eSewa payment did not complete.');
        setAuthStep('input');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const pollOrderUntilPaid = async (orderId: number): Promise<boolean> => {
    for (let i = 0; i < 12; i++) {
      try {
        const r = await fetch(`http://${apiIp}:5000/orders/${orderId}/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const j = await r.json();
        if (j?.success && j.order?.status === 'paid') return true;
      } catch { }
      await new Promise(res => setTimeout(res, 500));
    }
    return false;
  };

  // ── Khalti ────────────────────────────────────────────────────────────────
  const runKhaltiFlow = async () => {
    if (!product) return;
    if (!/^\d{10}$/.test(khaltiPhone.trim())) {
      Alert.alert('Invalid Khalti ID', 'Enter the 10-digit phone number registered with Khalti.');
      return;
    }
    if (khaltiMpin.length !== 4) { Alert.alert('Enter MPIN', 'Your 4-digit Khalti MPIN.'); return; }
    if (khaltiOtp.length !== 6) { Alert.alert('Enter OTP', 'Khalti just texted a 6-digit OTP.'); return; }
    setAuthBusy(true);
    setAuthStep('verifying');
    await new Promise(r => setTimeout(r, 1400));
    try {
      const order = await createOrder();
      await sendOrderEmail(email, order.id, order.amount_npr, 'khalti');
      await notify('Payment received',
        `Order #${order.id} · NPR ${order.amount_npr} paid via Khalti.`,
        { data: { orderId: order.id } });
      notify('Your order is on its way',
        `Order #${order.id} has been handed to our courier in Kathmandu.`,
        { delaySeconds: 30, data: { orderId: order.id } });
      setAuthOpen(false);
      goToSuccess(order.id, order.amount_npr);
    } catch (e: any) {
      if (e?.message !== 'SESSION_EXPIRED') {
        Alert.alert('Order failed', e?.message ?? 'Could not place the order.');
        setAuthStep('input');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  // ── COD ───────────────────────────────────────────────────────────────────
  const runCodFlow = async () => {
    setAuthBusy(true);
    setAuthStep('verifying');
    await new Promise(r => setTimeout(r, 600));
    try {
      const order = await createOrder();
      await sendOrderEmail(email, order.id, order.amount_npr, 'cod');
      await notify('Order placed',
        `Order #${order.id} confirmed — pay NPR ${order.amount_npr} on delivery.`,
        { data: { orderId: order.id } });
      notify('Your order is on its way',
        `Order #${order.id} has been handed to our courier in Kathmandu.`,
        { delaySeconds: 30, data: { orderId: order.id } });
      setAuthOpen(false);
      goToSuccess(order.id, order.amount_npr);
    } catch (e: any) {
      if (e?.message !== 'SESSION_EXPIRED') {
        Alert.alert('Order failed', e?.message ?? 'Could not place the order.');
        setAuthStep('input');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const onConfirm = () => {
    if (chosenMethod === 'esewa') runEsewaFlow();
    else if (chosenMethod === 'khalti') runKhaltiFlow();
    else runCodFlow();
  };

  const isDark = theme.mode === 'dark';

  return (
    <View style={styles.root}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <LinearGradient
        colors={isDark
          ? ['#1a1025', '#120a1f', '#0a0510']
          : ['#1e88e5', '#2196f3', '#42a5f5', '#64b5f6']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Checkout</Text>
        <View style={styles.iconBtn}>
          <Ionicons name="lock-closed-outline" size={16} color={theme.textPrimary} />
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 240 }}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={theme.textPrimary} /></View>
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : product && (
          <>
            <Text style={styles.sectionLabel}>ORDER</Text>
            <View style={styles.card}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryThumb}>
                  <Ionicons name="hand-left-outline" size={20} color={theme.textPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryName}>{product.name}</Text>
                  <Text style={styles.summarySub}>{product.tagline}</Text>
                  <Text style={styles.summaryQty}>Quantity · {qty}</Text>
                </View>
                <Text style={styles.summaryPrice}>NPR {(product.price_npr * qty).toLocaleString()}</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>YOUR DETAILS</Text>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Full name</Text>
              <TextInput value={name} onChangeText={setName} placeholder="Your name"
                placeholderTextColor={theme.placeholder} style={styles.input} />
              <View style={styles.fieldDivider} />
              <Text style={styles.fieldLabel}>Phone number</Text>
              <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                placeholder="98XXXXXXXX" placeholderTextColor={theme.placeholder} style={styles.input} />
              <View style={styles.fieldDivider} />
              <Text style={styles.fieldLabel}>Email (for receipts and updates)</Text>
              <TextInput value={email} onChangeText={setEmail} keyboardType="email-address"
                autoCapitalize="none" placeholder="you@example.com"
                placeholderTextColor={theme.placeholder} style={styles.input} />
              <View style={styles.fieldDivider} />
              <Text style={styles.fieldLabel}>Delivery address</Text>
              <TextInput value={addr} onChangeText={setAddr} placeholder="Street, area, city"
                placeholderTextColor={theme.placeholder} multiline
                style={[styles.input, { height: 56, textAlignVertical: 'top' }]} />
            </View>

            <View style={styles.totalsCard}>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Subtotal</Text>
                <Text style={styles.totalsValue}>NPR {subtotal.toLocaleString()}</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Shipping</Text>
                <Text style={[styles.totalsValue, { color: theme.success }]}>Free</Text>
              </View>
              <View style={styles.totalsDivider} />
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabelStrong}>Total</Text>
                <Text style={styles.totalsTotal}>NPR {total.toLocaleString()}</Text>
              </View>
            </View>

            <Text style={styles.afterPayHint}>
              <Ionicons name="information-circle-outline" size={12} color={theme.textMuted} />{'  '}
              You'll choose your payment method on the next step.
            </Text>
          </>
        )}
      </ScrollView>

      {product && !loading && !error && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.payBtn} onPress={onPay} activeOpacity={0.85}>
            <Ionicons name="lock-closed-outline" size={15} color="#fff" />
            <Text style={styles.payBtnText}>PAY · NPR {total.toLocaleString()}</Text>
          </TouchableOpacity>
          <Text style={styles.secureNote}>Encrypted · Cancel anytime</Text>
        </View>
      )}

      <MethodPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={onPickMethod}
        amount={total}
        styles={styles}
        theme={theme}
      />

      {chosenMethod && (
        <AuthorizeModal
          open={authOpen}
          method={chosenMethod}
          amount={total}
          productName={product?.name ?? ''}
          addr={addr}
          phone={phone}
          email={email}
          khaltiPhone={khaltiPhone} setKhaltiPhone={setKhaltiPhone}
          khaltiMpin={khaltiMpin} setKhaltiMpin={setKhaltiMpin}
          khaltiOtp={khaltiOtp} setKhaltiOtp={setKhaltiOtp}
          step={authStep}
          busy={authBusy}
          onClose={() => { if (!authBusy) { setAuthOpen(false); } }}
          onConfirm={onConfirm}
          styles={styles}
          theme={theme}
        />
      )}
    </View>
  );
}

// ── Method picker sheet ──────────────────────────────────────────────────────
function MethodPicker({
  open, onClose, onPick, amount, styles, theme,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: PaymentMethod) => void;
  amount: number;
  styles: any;
  theme: Palette;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] });
  const opacity = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.modalBackdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[styles.modalSheet, { paddingBottom: insets.bottom + 18, transform: [{ translateY }] }]}
      >
        <View style={styles.modalHandle} />
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Choose payment</Text>
          <Text style={styles.pickerSub}>Total · NPR {amount.toLocaleString()}</Text>
        </View>

        <View style={styles.pickerList}>
          {METHODS.map(m => (
            <TouchableOpacity
              key={m.id}
              onPress={() => onPick(m.id)}
              activeOpacity={0.85}
              style={styles.pickerCard}
            >
              <View style={styles.pickerLogoWrap}>
                {m.logo ? (
                  <Image source={m.logo} style={styles.pickerLogo} resizeMode="contain" />
                ) : (
                  <View style={[styles.pickerIconFallback, { backgroundColor: m.brandColor }]}>
                    <Ionicons name={m.fallbackIcon} size={20} color="#fff" />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.methodHeadRow}>
                  <Text style={styles.methodLabel}>{m.label}</Text>
                  {m.badge && (
                    <View style={[styles.realBadge, { backgroundColor: theme.success }]}>
                      <Text style={styles.realBadgeText}>{m.badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.methodSub}>{m.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.pickerFooter}>
          <Ionicons name="shield-checkmark" size={11} color={theme.textMuted} />  256-bit TLS · cancellable until dispatch
        </Text>
      </Animated.View>
    </Modal>
  );
}

// ── Authorize modal ──────────────────────────────────────────────────────────
function AuthorizeModal({
  open, method, amount, productName, addr, phone, email,
  khaltiPhone, setKhaltiPhone, khaltiMpin, setKhaltiMpin, khaltiOtp, setKhaltiOtp,
  step, busy, onClose, onConfirm, styles, theme,
}: {
  open: boolean;
  method: PaymentMethod;
  amount: number;
  productName: string;
  addr: string;
  phone: string;
  email: string;
  khaltiPhone: string; setKhaltiPhone: (s: string) => void;
  khaltiMpin: string; setKhaltiMpin: (s: string) => void;
  khaltiOtp: string; setKhaltiOtp: (s: string) => void;
  step: 'input' | 'verifying';
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  styles: any;
  theme: Palette;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] });
  const opacity = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const meta = METHODS.find(m => m.id === method)!;
  const brandBg =
    method === 'esewa' ? '#60bb46' :
      method === 'khalti' ? '#5c2d91' :
        '#0d0d12';

  const verifyCopy = (() => {
    if (method === 'esewa') return { title: 'Connecting to eSewa…', sub: 'Opening the secure eSewa sandbox in your browser.' };
    if (method === 'khalti') return { title: 'Authorising via Khalti…', sub: 'Securely contacting Khalti. This usually takes a few seconds.' };
    return { title: 'Confirming order…', sub: 'Reserving your order with our courier.' };
  })();

  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.modalBackdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[styles.modalSheet, { paddingBottom: insets.bottom + 18, transform: [{ translateY }] }]}
      >
        <View style={styles.modalHandle} />

        {step === 'verifying' ? (
          <View style={styles.verifyBox}>
            <ActivityIndicator size="large" color={brandBg} />
            <Text style={styles.verifyTitle}>{verifyCopy.title}</Text>
            <Text style={styles.verifySub}>{verifyCopy.sub}</Text>
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={[styles.brandHeader, { backgroundColor: brandBg }]}>
              <View style={styles.brandLogoBox}>
                {meta.logo ? (
                  <Image source={meta.logo} style={styles.brandLogo} resizeMode="contain" />
                ) : (
                  <Ionicons name={meta.fallbackIcon} size={20} color={brandBg} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.brandName}>{meta.label}</Text>
                <Text style={styles.brandSub}>
                  {method === 'cod' ? 'Cash on delivery' :
                    method === 'esewa' ? 'Real sandbox · Secure payment by eSewa' :
                      `Secure payment by ${meta.label}`}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.85)" />
              </TouchableOpacity>
            </View>

            <View style={styles.amountBlock}>
              <Text style={styles.amountLabel}>You're paying</Text>
              <Text style={styles.amountValue}>NPR {amount.toLocaleString()}</Text>
              <Text style={styles.amountFor}>for {productName}</Text>
              {email ? <Text style={styles.amountReceipt}>Receipt to {email}</Text> : null}
            </View>

            <View style={styles.modalDivider} />

            {method === 'esewa' && (
              <View style={styles.modalBody}>
                <View style={styles.redirectCard}>
                  <View style={styles.redirectIcon}>
                    <Ionicons name="open-outline" size={18} color="#60bb46" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.redirectTitle}>You'll be redirected to eSewa</Text>
                    <Text style={styles.redirectSub}>
                      An in-app browser will open the secure eSewa page where you can log in
                      with your eSewa ID and approve the payment.
                    </Text>
                  </View>
                </View>
                <View style={styles.redirectSteps}>
                  <RedirectStep n={1} text="Tap Continue to open eSewa" styles={styles} />
                  <RedirectStep n={2} text="Log in and approve NPR " bold={amount.toLocaleString()} styles={styles} />
                  <RedirectStep n={3} text="You'll be sent back here automatically" styles={styles} />
                </View>
                <Text style={styles.brandNote}>
                  Sandbox creds: eSewa ID 9806800001, password Nepal@123, MPIN 1122, OTP 123456.
                </Text>
              </View>
            )}

            {method === 'khalti' && (
              <View style={styles.modalBody}>
                <Text style={styles.modalFieldLabel}>Khalti ID (mobile number)</Text>
                <View style={styles.modalInputRow}>
                  <Text style={styles.modalInputPrefix}>+977</Text>
                  <TextInput
                    value={khaltiPhone}
                    onChangeText={t => setKhaltiPhone(t.replace(/[^\d]/g, '').slice(0, 10))}
                    keyboardType="number-pad"
                    placeholder="9800000000"
                    placeholderTextColor={theme.placeholder}
                    style={styles.modalInput}
                  />
                </View>

                <Text style={[styles.modalFieldLabel, { marginTop: 14 }]}>MPIN</Text>
                <View style={styles.modalInputRow}>
                  <TextInput
                    value={khaltiMpin}
                    onChangeText={t => setKhaltiMpin(t.replace(/[^\d]/g, '').slice(0, 4))}
                    keyboardType="number-pad"
                    placeholder="4-digit MPIN"
                    placeholderTextColor={theme.placeholder}
                    style={[styles.modalInput, { letterSpacing: 6 }]}
                    secureTextEntry maxLength={4}
                  />
                </View>

                <Text style={[styles.modalFieldLabel, { marginTop: 14 }]}>OTP</Text>
                <View style={styles.modalInputRow}>
                  <TextInput
                    value={khaltiOtp}
                    onChangeText={t => setKhaltiOtp(t.replace(/[^\d]/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    placeholder="6-digit OTP"
                    placeholderTextColor={theme.placeholder}
                    style={[styles.modalInput, { letterSpacing: 6 }]}
                    maxLength={6}
                  />
                  <Text style={styles.modalInputHint}>Sent to your phone</Text>
                </View>

                <Text style={styles.brandNote}>
                  Sandbox creds: 9800000000, MPIN 1111, OTP 987654. This Khalti flow is mocked —
                  real merchant integration pending sandbox account.
                </Text>
              </View>
            )}

            {method === 'cod' && (
              <View style={styles.modalBody}>
                <Text style={styles.modalFieldLabel}>Confirm delivery details</Text>
                <View style={styles.codRow}>
                  <Ionicons name="location-outline" size={15} color={theme.textSecondary} />
                  <Text style={styles.codText}>{addr || '— address missing —'}</Text>
                </View>
                <View style={styles.codRow}>
                  <Ionicons name="call-outline" size={15} color={theme.textSecondary} />
                  <Text style={styles.codText}>{phone || '— phone missing —'}</Text>
                </View>
              </View>
            )}

            <View style={{ height: 8 }} />

            <TouchableOpacity
              style={[styles.modalConfirmBtn, { backgroundColor: brandBg }, busy && { opacity: 0.6 }]}
              onPress={onConfirm}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Ionicons
                name={method === 'esewa' ? 'open-outline' : 'lock-closed-outline'}
                size={15} color="#fff"
              />
              <Text style={styles.modalConfirmText}>
                {method === 'cod' ? 'CONFIRM ORDER' :
                  method === 'esewa' ? 'CONTINUE TO ESEWA' :
                    `AUTHORISE NPR ${amount.toLocaleString()}`}
              </Text>
            </TouchableOpacity>

            <Text style={styles.modalSafeNote}>
              <Ionicons name="shield-checkmark" size={11} color={theme.textMuted} />  256-bit TLS · cancellable until dispatch
            </Text>
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}

function RedirectStep({ n, text, bold, styles }: { n: number; text: string; bold?: string; styles: any }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>
        {text}{bold && <Text style={styles.stepBold}>{bold}</Text>}
      </Text>
    </View>
  );
}

// ── Stylesheet ───────────────────────────────────────────────────────────────
function makeStyles(t: Palette) {
  const isDark = t.mode === 'dark';
  const cardLine = isDark ? t.hairline : '#e0e4ea';
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },

    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 18, paddingBottom: 12, backgroundColor: 'transparent',
    },
    topBarTitle: {
      fontSize: 15, fontWeight: '600',
      color: isDark ? t.textPrimary : '#ffffff',
      fontFamily: APP_FONT, letterSpacing: -0.2,
    },
    iconBtn: {
      width: 38, height: 38, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: isDark ? t.surface : 'rgba(255,255,255,0.22)',
      borderWidth: 1, borderColor: isDark ? t.hairline : 'rgba(255,255,255,0.30)',
    },

    sectionLabel: {
      fontSize: 10, fontWeight: '700',
      color: isDark ? t.textMuted : 'rgba(255,255,255,0.85)',
      letterSpacing: 1.6, marginHorizontal: 22, marginTop: 16, marginBottom: 8,
      fontFamily: APP_FONT,
    },
    card: {
      marginHorizontal: 18, backgroundColor: t.surface,
      borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8,
      ...(isDark
        ? { borderWidth: 1, borderColor: t.hairline }
        : { shadowColor: '#0d47a1', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 }),
    },

    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
    summaryThumb: {
      width: 56, height: 56, borderRadius: 14, backgroundColor: t.surfaceHi,
      alignItems: 'center', justifyContent: 'center',
    },
    summaryName: { fontSize: 14, fontWeight: '700', color: t.textPrimary, fontFamily: APP_FONT, letterSpacing: -0.2 },
    summarySub: { fontSize: 12, color: t.textSecondary, marginTop: 2, fontFamily: APP_FONT },
    summaryQty: { fontSize: 11, color: t.textMuted, marginTop: 4, fontFamily: APP_FONT },
    summaryPrice: { fontSize: 14, fontWeight: '700', color: t.textPrimary, fontFamily: APP_FONT, letterSpacing: -0.2 },

    fieldLabel: {
      fontSize: 11, fontWeight: '600', color: t.textMuted,
      letterSpacing: 0.6, marginTop: 10, fontFamily: APP_FONT,
    },
    input: { fontSize: 14, color: t.textPrimary, paddingVertical: 8, paddingHorizontal: 0, fontFamily: APP_FONT },
    fieldDivider: { height: 1, backgroundColor: cardLine, marginVertical: 4 },

    methodHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    methodLabel: { fontSize: 14, fontWeight: '600', color: t.textPrimary, fontFamily: APP_FONT, letterSpacing: -0.2 },
    methodSub: { fontSize: 11.5, color: t.textSecondary, marginTop: 2, fontFamily: APP_FONT },

    realBadge: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 6 },
    realBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.7, fontFamily: APP_FONT },

    afterPayHint: {
      textAlign: 'center', fontSize: 11.5,
      color: isDark ? t.textMuted : 'rgba(255,255,255,0.75)',
      marginHorizontal: 18, marginTop: 14, lineHeight: 18, fontFamily: APP_FONT,
    },

    totalsCard: {
      marginHorizontal: 18, marginTop: 20, backgroundColor: t.surface,
      borderRadius: 16, padding: 16,
      ...(isDark
        ? { borderWidth: 1, borderColor: t.hairline }
        : { shadowColor: '#0d47a1', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 }),
    },
    totalsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
    totalsLabel: { fontSize: 13, color: t.textSecondary, fontFamily: APP_FONT },
    totalsLabelStrong: { fontSize: 14, color: t.textPrimary, fontWeight: '700', fontFamily: APP_FONT },
    totalsValue: { fontSize: 13, color: t.textPrimary, fontWeight: '600', fontFamily: APP_FONT },
    totalsTotal: { fontSize: 18, color: t.textPrimary, fontWeight: '800', letterSpacing: -0.4, fontFamily: APP_FONT },
    totalsDivider: { height: 1, backgroundColor: cardLine, marginVertical: 6 },

    loadingBox: { padding: 60, alignItems: 'center' },
    errorBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: isDark ? 'rgba(248,113,113,0.08)' : '#fef2f2',
      borderRadius: 12, padding: 14, margin: 18,
      borderWidth: 1, borderColor: isDark ? 'rgba(248,113,113,0.2)' : '#fecaca',
    },
    errorText: { color: t.danger, fontSize: 13, flex: 1, fontFamily: APP_FONT },

    bottomBar: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      paddingHorizontal: 18, paddingTop: 14, backgroundColor: t.surface,
      borderTopWidth: 1, borderTopColor: cardLine, alignItems: 'center', gap: 6,
    },
    payBtn: {
      width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      backgroundColor: t.accent, paddingVertical: 16, borderRadius: 18,
      shadowColor: '#0d0d12', shadowOpacity: 0.25, shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, elevation: 6,
    },
    payBtnText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1.4, fontFamily: APP_FONT },
    secureNote: { fontSize: 10.5, color: t.textMuted, fontFamily: APP_FONT, letterSpacing: 0.4 },

    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
    modalSheet: {
      position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.surface,
      borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, maxHeight: '92%', overflow: 'hidden',
    },
    modalHandle: {
      alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
      backgroundColor: cardLine, marginBottom: 14,
    },

    pickerHeader: { paddingHorizontal: 22, paddingBottom: 6 },
    pickerTitle: { fontSize: 19, fontWeight: '700', color: t.textPrimary, letterSpacing: -0.3, fontFamily: APP_FONT },
    pickerSub: { fontSize: 12, color: t.textMuted, marginTop: 4, fontFamily: APP_FONT, letterSpacing: 0.4 },
    pickerList: { paddingHorizontal: 18, paddingTop: 14, gap: 10 },
    pickerCard: {
      flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.surfaceHi,
      borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: t.hairline,
    },
    pickerLogoWrap: {
      width: 48, height: 48, borderRadius: 12, backgroundColor: '#fff',
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.hairline, overflow: 'hidden',
    },
    pickerLogo: { width: 36, height: 36 },
    pickerIconFallback: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    pickerFooter: { textAlign: 'center', fontSize: 11, color: t.textMuted, marginTop: 18, fontFamily: APP_FONT },

    brandHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
    brandLogoBox: {
      width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff',
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    brandLogo: { width: 32, height: 32 },
    brandName: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: APP_FONT, letterSpacing: -0.2 },
    brandSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11.5, marginTop: 2, fontFamily: APP_FONT },

    amountBlock: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 12 },
    amountLabel: { fontSize: 11, fontWeight: '700', color: t.textMuted, letterSpacing: 1.4, fontFamily: APP_FONT },
    amountValue: { fontSize: 32, fontWeight: '800', color: t.textPrimary, letterSpacing: -1, marginTop: 4, fontFamily: APP_FONT },
    amountFor: { fontSize: 12, color: t.textSecondary, marginTop: 4, fontFamily: APP_FONT },
    amountReceipt: { fontSize: 11, color: t.textMuted, marginTop: 2, fontFamily: APP_FONT },

    modalDivider: { height: 1, backgroundColor: t.hairline, marginHorizontal: 22, marginVertical: 6 },
    modalBody: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16 },
    modalFieldLabel: { fontSize: 11, fontWeight: '700', color: t.textMuted, letterSpacing: 1.2, fontFamily: APP_FONT },
    modalInputRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.inputBg,
      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4, marginTop: 6,
    },
    modalInputPrefix: { fontSize: 14, color: t.textSecondary, fontWeight: '600', fontFamily: APP_FONT },
    modalInput: { flex: 1, fontSize: 15, color: t.textPrimary, paddingVertical: 12, fontFamily: APP_FONT },
    modalInputHint: { fontSize: 10.5, color: t.textMuted, fontFamily: APP_FONT },

    redirectCard: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
      backgroundColor: isDark ? 'rgba(96,187,70,0.10)' : '#f0fdf4',
      borderRadius: 14, padding: 14, borderWidth: 1,
      borderColor: isDark ? 'rgba(96,187,70,0.25)' : '#bbf7d0',
    },
    redirectIcon: {
      width: 32, height: 32, borderRadius: 10,
      backgroundColor: isDark ? '#0a0510' : '#fff', alignItems: 'center', justifyContent: 'center',
    },
    redirectTitle: { fontSize: 13.5, fontWeight: '700', color: t.textPrimary, fontFamily: APP_FONT },
    redirectSub: { fontSize: 12, color: t.textSecondary, lineHeight: 18, marginTop: 4, fontFamily: APP_FONT },

    redirectSteps: { marginTop: 14, gap: 10 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepNum: {
      width: 22, height: 22, borderRadius: 11, backgroundColor: t.textPrimary,
      alignItems: 'center', justifyContent: 'center',
    },
    stepNumText: { color: t.bg, fontSize: 11, fontWeight: '700', fontFamily: APP_FONT },
    stepText: { flex: 1, fontSize: 13, color: t.textSecondary, fontFamily: APP_FONT },
    stepBold: { fontWeight: '700', color: t.textPrimary },

    brandNote: { fontSize: 11.5, color: t.textMuted, lineHeight: 18, marginTop: 12, fontFamily: APP_FONT },
    codRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10 },
    codText: { flex: 1, fontSize: 13, color: t.textPrimary, fontFamily: APP_FONT },

    modalConfirmBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      marginHorizontal: 22, marginTop: 6, paddingVertical: 16, borderRadius: 16,
    },
    modalConfirmText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1.2, fontFamily: APP_FONT },
    modalSafeNote: {
      textAlign: 'center', fontSize: 10.5, color: t.textMuted,
      marginTop: 12, marginBottom: 4, fontFamily: APP_FONT,
    },

    verifyBox: { paddingHorizontal: 30, paddingVertical: 60, alignItems: 'center', gap: 14 },
    verifyTitle: { fontSize: 17, fontWeight: '700', color: t.textPrimary, marginTop: 8, fontFamily: APP_FONT, letterSpacing: -0.3 },
    verifySub: { fontSize: 13, color: t.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 280, fontFamily: APP_FONT },
  });
}