import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, StatusBar, Dimensions, Platform, Image,
  FlatList, Modal, Pressable, Animated, Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';
import { useTheme, Palette } from '@/context/theme';

const { width: W } = Dimensions.get('window');
const APP_FONT = Platform.select({ ios: 'Arial', android: 'sans-serif', default: 'Arial' });

interface Product {
  id: number;
  sku: string;
  name: string;
  tagline: string;
  description: string;
  price_npr: number;
  stock: number;
}

// ── Product photos ──────────────────────────────────────────────────────────
// When the actual glove pictures are dropped into assets/picture/, swap these
// requires (e.g. require('@/assets/picture/glove_1.png')). For now we use the
// existing logo asset for all four slides so the slider renders correctly.
const PRODUCT_IMAGES = [
  require('@/assets/picture/logo5.jpg'),
  require('@/assets/picture/logo3.jpg'),
  require('@/assets/picture/logo4.jpg'),
  require('@/assets/picture/logo1.webp'),
];

// ── Sensor info shown by the (i) dialog ─────────────────────────────────────
const SENSORS = [
  { name: 'MAX30102', desc: 'Measures SpO₂ blood-oxygen saturation and heart rate using infrared light.' },
  { name: 'BMP280', desc: 'Barometric pressure sensor, derives altitude (±4 m) and the rate of ascent in metres per hour.' },
  { name: 'ESP32 microcontroller', desc: 'Reads all sensors over I²C every 5 seconds and streams the data to the AMS server over WiFi.' },
  { name: 'Buzzer + button', desc: 'On-device alert when risk reaches Moderate or higher. Button starts and stops monitoring without needing the phone.' },
];

export default function ShopScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { apiIp, token } = useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qty, setQty] = useState(1);
  const [activeIdx, setActiveIdx] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [imageAreaHeight, setImageAreaHeight] = useState(0);

  const sliderRef = useRef<FlatList<any>>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`http://${apiIp}:5000/products`);
        const j = await res.json();
        if (cancelled) return;
        if (j?.success && j.data?.length) {
          const glove = j.data.find((p: Product) => p.sku === 'AMS-GLOVE-V1') ?? j.data[0];
          setProduct(glove);
        } else {
          setError('No products available right now.');
        }
      } catch {
        if (!cancelled) setError('Cannot reach the server. Make sure Flask is running.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiIp]);

  const onBuy = () => {
    if (!product) return;
    if (!token) { router.replace('/login'); return; }
    router.push({
      pathname: '/checkout',
      params: { productId: String(product.id), quantity: String(qty) },
    });
  };

  const setQtyClamped = (n: number) => {
    if (!product) return;
    const max = Math.max(1, product.stock || 99);
    setQty(Math.max(1, Math.min(n, max)));
  };

  // ── Loading / error ────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={theme.textPrimary} />
      </View>
    );
  }
  if (error || !product) {
    return (
      <View style={[styles.root, styles.center]}>
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
          <Text style={styles.errorText}>{error || 'Product unavailable'}</Text>
        </View>
      </View>
    );
  }

  const isDark = theme.mode === 'dark';

  // ── Main layout ────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Gradient sits behind image area + header, card slides over it */}
      <LinearGradient
        colors={isDark
          ? ['#1a1025', '#120a1f', '#0a0510']
          : ['#1e88e5', '#2196f3', '#42a5f5', '#64b5f6']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* ── Vertical image slider ── */}
      <View
        style={styles.imageArea}
        onLayout={e => setImageAreaHeight(e.nativeEvent.layout.height)}
      >
        {imageAreaHeight > 0 && (
          <FlatList
            ref={sliderRef}
            data={PRODUCT_IMAGES}
            keyExtractor={(_, i) => `slide-${i}`}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, index) => ({
              length: imageAreaHeight,
              offset: imageAreaHeight * index,
              index,
            })}
            onMomentumScrollEnd={e => {
              const h = e.nativeEvent.layoutMeasurement.height;
              if (h > 0) setActiveIdx(Math.round(e.nativeEvent.contentOffset.y / h));
            }}
            renderItem={({ item }) => (
              <View style={[styles.slide, { height: imageAreaHeight }]}>
                <Image source={item} style={styles.slideImage} resizeMode="contain" />
              </View>
            )}
          />
        )}

        {/* Vertical position dots */}
        <View style={styles.carouselDots}>
          {PRODUCT_IMAGES.map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => sliderRef.current?.scrollToIndex({ index: i, animated: true })}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[styles.carouselDot, i === activeIdx && styles.carouselDotActive]} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Detail card (slides up from bottom) ── */}
      <ScrollView
        style={styles.detailCardScroll}
        contentContainerStyle={[styles.detailCard, { paddingBottom: insets.bottom + 96 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <Text style={styles.tagline}>{product.tagline}</Text>
          <TouchableOpacity
            onPress={() => setInfoOpen(true)}
            style={styles.infoBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="information-circle-outline" size={20} color={theme.accent} />
          </TouchableOpacity>
        </View>

        {/* Stock badge */}
        <Text style={styles.stockBadge}>
          {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
        </Text>

        {/* Purchase CTA — opens the price / qty / buy sheet */}
        <TouchableOpacity
          style={[styles.purchaseBtn, product.stock === 0 && styles.buyBtnDisabled]}
          onPress={() => setPurchaseOpen(true)}
          disabled={product.stock === 0}
          activeOpacity={0.85}
        >
          <Ionicons name="cart-outline" size={16} color="#fff" style={{ marginRight: 8, }} />
          <Text style={styles.buyBtnText}>PURCHASE</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Info dialog ── */}
      <InfoDialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        productName={product.name}
        tagline={product.tagline}
        styles={styles}
        theme={theme}
      />

      {/* ── Purchase sheet (price + qty + buy now) ── */}
      <PurchaseSheet
        open={purchaseOpen}
        onClose={() => setPurchaseOpen(false)}
        product={product}
        qty={qty}
        setQtyClamped={setQtyClamped}
        onBuy={onBuy}
        styles={styles}
        theme={theme}
      />
    </View>
  );
}

// ── Purchase sheet — slides up when user taps PURCHASE ──────────────────────
function PurchaseSheet({
  open, onClose, product, qty, setQtyClamped, onBuy, styles, theme,
}: {
  open: boolean;
  onClose: () => void;
  product: Product;
  qty: number;
  setQtyClamped: (n: number) => void;
  onBuy: () => void;
  styles: any;
  theme: Palette;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [500, 0] });
  const opacity = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.dialogBackdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[styles.dialogSheet, { paddingBottom: insets.bottom + 24, transform: [{ translateY }] }]}
      >
        <View style={styles.dialogHandle} />

        {/* Product name */}
        <View style={[styles.dialogHeader, { paddingBottom: 6 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dialogProductName}>{product.name}</Text>
            <Text style={styles.dialogProductSub}>{product.tagline}</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={styles.dialogClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={18} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Price */}
        <View style={[styles.priceRow, { paddingHorizontal: 22, marginTop: 10 }]}>
          <Text style={styles.priceCurrency}>NPR </Text>
          <Text style={styles.priceNum}>{product.price_npr.toLocaleString()}</Text>
          <Text style={styles.priceSub}>  / incl. all taxes</Text>
        </View>

        {/* Quantity stepper */}
        <View style={[styles.qtyRow, { paddingHorizontal: 22, marginTop: 20 }]}>
          <Text style={styles.qtyLabel}>Quantity</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepperBtn, qty <= 1 && styles.stepperBtnDisabled]}
              onPress={() => setQtyClamped(qty - 1)}
              disabled={qty <= 1}
              activeOpacity={0.7}
            >
              <Ionicons name="remove" size={18} color={qty <= 1 ? theme.textMuted : theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{qty}</Text>
            <TouchableOpacity
              style={[styles.stepperBtn, qty >= (product.stock || 99) && styles.stepperBtnDisabled]}
              onPress={() => setQtyClamped(qty + 1)}
              disabled={qty >= (product.stock || 99)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="add"
                size={18}
                color={qty >= (product.stock || 99) ? theme.textMuted : theme.textPrimary}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Buy now */}
        <TouchableOpacity
          style={[styles.buyBtn, { marginHorizontal: 22, marginTop: 24 }, product.stock === 0 && styles.buyBtnDisabled]}
          onPress={() => { onClose(); onBuy(); }}
          disabled={product.stock === 0}
          activeOpacity={0.85}
        >
          <Text style={styles.buyBtnText}>
            BUY NOW · NPR {(product.price_npr * qty).toLocaleString()}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

// ── Sensor info dialog ──────────────────────────────────────────────────────
function InfoDialog({
  open, onClose, productName, tagline, styles, theme,
}: {
  open: boolean;
  onClose: () => void;
  productName: string;
  tagline: string;
  styles: any;
  theme: Palette;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] });
  const opacity = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.dialogBackdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[styles.dialogSheet, { paddingBottom: insets.bottom + 18, transform: [{ translateY }] }]}
      >
        <View style={styles.dialogHandle} />

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.dialogHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dialogProductName}>{productName}</Text>
              <Text style={styles.dialogProductSub}>{tagline}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.dialogClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color={theme.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.dialogSection}>SENSORS INSIDE</Text>
          <View style={styles.dialogList}>
            {SENSORS.map((s, i) => (
              <View key={s.name} style={[styles.sensorRow, i < SENSORS.length - 1 && styles.sensorRowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sensorName}>{s.name}</Text>
                  <Text style={styles.sensorDesc}>{s.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ── Theme-aware stylesheet ──────────────────────────────────────────────────
function makeStyles(t: Palette) {
  const isDark = t.mode === 'dark';
  // Inside white cards the hairline token is translucent in light mode
  const cardLine = isDark ? t.hairline : '#e0e4ea';
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { alignItems: 'center', justifyContent: 'center' },

    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 22, paddingBottom: 6,
    },
    // Header sits on gradient background → always white text
    headerTitle: {
      fontSize: 20, fontWeight: '700',
      color: isDark ? t.textPrimary : '#ffffff',
      letterSpacing: -0.4, fontFamily: APP_FONT,
    },
    iconAction: {
      width: 38, height: 38, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: isDark ? t.surface : 'rgba(255,255,255,0.22)',
      borderWidth: 1, borderColor: isDark ? t.hairline : 'rgba(255,255,255,0.30)',
    },

    // Vertical slider area
    imageArea: { flex: 1, position: 'relative' },
    slide: {
      width: W, height: undefined, flex: 1,
      alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 28, paddingVertical: 16,
    },
    slideImage: { width: '85%', height: '90%' },

    carouselDots: {
      position: 'absolute', right: 22, top: '50%',
      transform: [{ translateY: -36 }],
      gap: 10,
    },
    carouselDot: {
      width: 6, height: 6, borderRadius: 3,
      borderWidth: 1,
      borderColor: isDark ? t.textPrimary : 'rgba(255,255,255,0.70)',
      backgroundColor: 'transparent',
    },
    carouselDotActive: {
      backgroundColor: isDark ? t.textPrimary : '#ffffff',
      borderColor: isDark ? t.textPrimary : '#ffffff',
      transform: [{ scale: 1.4 }],
    },

    // Detail card
    detailCardScroll: { flexGrow: 0, maxHeight: '52%' },
    detailCard: {

      backgroundColor: t.surface,
      borderTopLeftRadius: 36, borderTopRightRadius: 36,
      paddingTop: 26, paddingHorizontal: 28,
      shadowColor: '#000', shadowOpacity: isDark ? 0.4 : 0.04,
      shadowOffset: { width: 0, height: -10 }, shadowRadius: 24,
      elevation: 8,
    },

    titleRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6,
    },
    tagline: {
      flex: 1,
      fontSize: 14, fontWeight: '500', color: t.textPrimary,
      fontFamily: APP_FONT, letterSpacing: -0.1,
    },
    infoBtn: {
      width: 32, height: 32, borderRadius: 10,
      backgroundColor: t.accentSoft,
      alignItems: 'center', justifyContent: 'center',
    },

    priceRow: {
      flexDirection: 'row', alignItems: 'baseline',
      flexWrap: 'wrap', marginTop: 2,
    },
    priceCurrency: {
      fontSize: 20, color: t.textPrimary, fontWeight: '600',
      fontFamily: APP_FONT, letterSpacing: -0.4,
    },
    priceNum: {
      fontSize: 32, fontWeight: '800', color: t.textPrimary,
      letterSpacing: -1.2, fontFamily: APP_FONT,
    },
    priceSub: {
      fontSize: 12, color: t.textMuted, fontWeight: '500',
      marginLeft: 2, fontFamily: APP_FONT,
    },

    // Quantity stepper
    qtyRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 22,
    },
    qtyLabel: {
      fontSize: 13, color: t.textSecondary, fontWeight: '500', fontFamily: APP_FONT,
    },
    stepper: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: isDark ? t.surfaceHi : '#f1f4f8',
      borderRadius: 14, padding: 4,
      borderWidth: 1, borderColor: cardLine,
    },
    stepperBtn: {
      width: 36, height: 36, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: t.surface,
    },
    stepperBtnDisabled: { opacity: 0.4 },
    stepperValue: {
      minWidth: 36, textAlign: 'center',
      fontSize: 16, fontWeight: '700', color: t.textPrimary,
      fontFamily: APP_FONT,
    },

    // "PURCHASE" button on the main card
    purchaseBtn: {
      flexDirection: 'row',
      backgroundColor: t.accent,
      paddingVertical: 17, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      marginTop: 40,
      shadowColor: '#0d0d12', shadowOpacity: 0.25,
      shadowOffset: { width: 0, height: 8 }, shadowRadius: 18,
      elevation: 6,
    },
    // "BUY NOW" button inside the purchase sheet (no extra marginTop — added inline)
    buyBtn: {
      backgroundColor: t.accent,
      paddingVertical: 17, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#0d0d12', shadowOpacity: 0.25,
      shadowOffset: { width: 0, height: 8 }, shadowRadius: 18,
      elevation: 6,
    },
    buyBtnDisabled: { backgroundColor: t.textMuted, shadowOpacity: 0 },
    buyBtnText: {
      color: '#fff', fontSize: 13, fontWeight: '700',
      letterSpacing: 1.4, fontFamily: APP_FONT,
    },
    stockBadge: {
      fontSize: 12, color: t.textMuted, fontWeight: '500',
      fontFamily: APP_FONT, marginTop: 6,
    },

    errorBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: isDark ? 'rgba(248,113,113,0.08)' : '#fef2f2',
      borderRadius: 12, padding: 14, marginHorizontal: 24,
      borderWidth: 1, borderColor: isDark ? 'rgba(248,113,113,0.2)' : '#fecaca',
    },
    errorText: { color: t.danger, fontSize: 13, fontFamily: APP_FONT },

    // ── Info dialog ──
    dialogBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    dialogSheet: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: t.surface,
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      paddingTop: 10, maxHeight: '85%',
      overflow: 'hidden',
    },
    dialogHandle: {
      alignSelf: 'center',
      width: 44, height: 5, borderRadius: 3,
      backgroundColor: cardLine,
      marginBottom: 14,
    },
    dialogHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 22, paddingBottom: 12,
    },
    dialogProductName: {
      fontSize: 17, fontWeight: '700', color: t.textPrimary,
      fontFamily: APP_FONT, letterSpacing: -0.3,
    },
    dialogProductSub: {
      fontSize: 12, color: t.textSecondary, marginTop: 3, fontFamily: APP_FONT,
    },
    dialogClose: {
      width: 30, height: 30, borderRadius: 10,
      backgroundColor: isDark ? t.surfaceHi : '#f1f4f8',
      alignItems: 'center', justifyContent: 'center',
    },
    dialogSection: {
      fontSize: 10, fontWeight: '700', color: t.textMuted,
      letterSpacing: 1.6, paddingHorizontal: 22, marginTop: 10, marginBottom: 8,
      fontFamily: APP_FONT,
    },
    dialogList: {
      backgroundColor: isDark ? t.surfaceHi : '#f5f7fa',
      marginHorizontal: 18, borderRadius: 16,
      borderWidth: 1, borderColor: cardLine,
      overflow: 'hidden',
    },
    sensorRow: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
      paddingHorizontal: 14, paddingVertical: 14,
    },
    sensorRowBorder: { borderBottomWidth: 1, borderBottomColor: cardLine },
    sensorIcon: {
      width: 34, height: 34, borderRadius: 11,
      backgroundColor: t.accentSoft,
      alignItems: 'center', justifyContent: 'center',
    },
    sensorName: {
      fontSize: 13.5, fontWeight: '700', color: t.textPrimary,
      letterSpacing: -0.2, fontFamily: APP_FONT,
    },
    sensorDesc: {
      fontSize: 12, color: t.textSecondary, marginTop: 3, lineHeight: 18,
      fontFamily: APP_FONT,
    },
    howRow: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
      paddingHorizontal: 14, paddingVertical: 14,
    },
    howNum: {
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: t.accent,
      alignItems: 'center', justifyContent: 'center',
      marginTop: 1,
    },
    howNumText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: APP_FONT },
    howText: {
      flex: 1, fontSize: 13, color: t.textPrimary,
      lineHeight: 19, fontFamily: APP_FONT,
    },
    dialogNote: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: t.surfaceHi,
      borderRadius: 14, padding: 12,
      marginHorizontal: 18, marginTop: 14, marginBottom: 14,
    },
    dialogNoteText: {
      flex: 1, fontSize: 11.5, color: t.textSecondary,
      lineHeight: 18, fontFamily: APP_FONT,
    },
  });
}
