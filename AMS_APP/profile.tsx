import { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Alert, ScrollView, StatusBar, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/context/auth';
import { useTheme, Palette, ThemeMode } from '@/context/theme';

const APP_VERSION = '1.0.0';
const APP_FONT = Platform.select({ ios: 'Arial', android: 'sans-serif', default: 'Arial' });

// ── Reusable row ─────────────────────────────────────────────────────────────
function Row({
  icon, label, value, onPress, danger, lastInGroup, accent, styles, theme,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  lastInGroup?: boolean;
  accent?: boolean;
  styles: any;
  theme: Palette;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, !lastInGroup && styles.rowBorder]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={styles.rowIcon}>
        <Ionicons
          name={icon}
          size={17}
          color={danger ? theme.danger : accent ? theme.accent : theme.textSecondary}
        />
      </View>
      <Text style={[styles.rowLabel, danger && { color: theme.danger }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {onPress && !danger && (
          <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { username, apiIp, setApiIp, logout, token } = useAuth();
  const { theme, mode, setMode } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [editingIp, setEditingIp] = useState(false);
  const [tempIp, setTempIp] = useState('');
  const [serverInfo, setServerInfo] = useState<{ model: string; accuracy: string } | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);

  const initials = (username ?? 'U')
    .split(/[\s@]/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`http://${apiIp}:5000/auth/logout`, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
            } catch { /* ignore — local logout still happens */ }
            await logout();
            router.replace('/login');
          },
        },
      ]
    );
  };

  const checkServer = async () => {
    setCheckingServer(true);
    try {
      const res = await fetch(`http://${apiIp}:5000/health`);
      const data = await res.json();
      setServerInfo({ model: data.model, accuracy: data.accuracy });
    } catch {
      Alert.alert('Unreachable', `Could not connect to ${apiIp}:5000.\nMake sure Flask is running.`);
      setServerInfo(null);
    } finally {
      setCheckingServer(false);
    }
  };

  const isDark = mode === 'dark';

  return (
    <View style={styles.root}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Blue gradient fills the whole page behind the white cards */}
      <LinearGradient
        colors={isDark
          ? ['#1a1025', '#120a1f', '#0a0510']
          : ['#1e88e5', '#2196f3', '#42a5f5', '#64b5f6']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 80 },
        ]}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Account</Text>
        </View>

        {/* ── Avatar block ── */}
        <View style={styles.avatarRow}>
          <LinearGradient
            colors={['#3a1d6b', '#7c3aed']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{initials}</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{username ?? 'Guest'}</Text>
            <Text style={styles.userMeta}>The British College, Kathmandu</Text>
          </View>
          <View style={styles.signedInPill}>
            <View style={styles.signedInDot} />
            <Text style={styles.signedInText}>Active</Text>
          </View>
        </View>

        {/* ── Account ── */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <Row styles={styles} theme={theme}
            icon="person-circle-outline" label="Username" value={username ?? 'Guest'} />
          <Row styles={styles} theme={theme}
            icon="shield-checkmark-outline" label="Session" value="Secure" />
          <Row styles={styles} theme={theme}
            icon="notifications-outline" label="Risk alerts" value="Enabled" lastInGroup />
        </View>



        {/* ── Appearance ── */}
        <Text style={styles.sectionLabel}>Appearance</Text>
        <View style={styles.card}>
          <View style={styles.themeRow}>
            <View style={styles.rowIcon}>
              <Ionicons
                name={isDark ? 'moon' : 'sunny'}
                size={17}
                color={theme.accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Theme</Text>
            </View>
            <View style={styles.themeToggle}>
              {(['light', 'dark'] as ThemeMode[]).map(m => {
                const selected = mode === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setMode(m)}
                    style={[styles.themeOption, selected && styles.themeOptionActive]}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={m === 'light' ? 'sunny-outline' : 'moon-outline'}
                      size={14}
                      color={selected ? '#fff' : theme.textSecondary}
                    />
                    <Text style={[styles.themeOptionText, selected && { color: '#fff' }]}>
                      {m === 'light' ? 'Light' : 'Dark'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
        {/* ── Activity ── */}
        <Text style={styles.sectionLabel}>Activity</Text>
        <View style={styles.card}>
          <Row styles={styles} theme={theme}
            icon="bag-outline" label="Product"
            onPress={() => router.push('/shop')} />
        </View>

        {/* ── About ── */}
        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.card}>
          <Row styles={styles} theme={theme}
            icon="information-circle-outline" label="App version" value={APP_VERSION} />
          <Row styles={styles} theme={theme}
            icon="school-outline" label="Institution" value="The British College" />
          <Row styles={styles} theme={theme}
            icon="location-outline" label="Location" value="Kathmandu, Nepal" lastInGroup />
        </View>

        {/* ── AMS risk legend ── */}
        <Text style={styles.sectionLabel}>AMS risk levels</Text>
        <View style={styles.card}>
          {[
            { level: 'Low', color: '#4ade80', desc: 'Safe to continue trekking' },
            { level: 'Medium', color: '#facc15', desc: 'Slow down, acclimatise' },
            { level: 'High', color: '#fb923c', desc: 'Stop ascending, rest 24–48h' },
            { level: 'Severe', color: '#f87171', desc: 'Descend, seek medical help' },
          ].map((r, i, arr) => (
            <View
              key={r.level}
              style={[styles.riskRow, i < arr.length - 1 && styles.rowBorder]}
            >
              <View style={[styles.riskDot, { backgroundColor: r.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.riskLevel, { color: r.color }]}>{r.level}</Text>
                <Text style={styles.riskDesc}>{r.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Logout ── */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color={theme.danger} />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>

        {/* ── Server (Flask IP) — at the very bottom ── */}
        <Text style={styles.sectionLabel}>Server</Text>
        <View style={styles.card}>
          {/* IP edit */}
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="wifi-outline" size={17} color={theme.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              {editingIp ? (
                <TextInput
                  style={styles.ipInput}
                  value={tempIp}
                  onChangeText={setTempIp}
                  keyboardType="decimal-pad"
                  autoFocus
                  selectionColor={theme.accent}
                  placeholder="192.168.x.x"
                  placeholderTextColor={theme.textMuted}
                />
              ) : (
                <Text style={styles.ipValue}>{apiIp}:5000</Text>
              )}
            </View>
            {editingIp ? (
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => { setApiIp(tempIp); setEditingIp(false); }}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => { setTempIp(apiIp); setEditingIp(true); }}
              >
                <Ionicons name="pencil-outline" size={14} color={theme.accent} />
              </TouchableOpacity>
            )}</View>
        </View>

        <Text style={styles.footer}>
          AMS Monitor · v{APP_VERSION}{'\n'}
          The British College
        </Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(t: Palette) {
  const isDark = t.mode === 'dark';
  // Inside white cards the hairline token is too translucent in light mode
  const cardLine = isDark ? t.hairline : '#e0e4ea';
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    scroll: { paddingHorizontal: 22 },

    // Header — on the gradient, always white in light mode
    header: { marginBottom: 22 },
    headerTitle: {
      color: isDark ? t.textPrimary : '#ffffff',
      fontSize: 28, fontWeight: '700',
      letterSpacing: -0.5, fontFamily: APP_FONT, marginBottom: 15
    },

    // Avatar
    avatarRow: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: t.surface,
      borderRadius: 18,
      padding: 16,
      marginBottom: 14,
      borderWidth: isDark ? 0 : 1, borderColor: t.hairline,
    },
    avatar: {
      width: 54, height: 54, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: {
      fontSize: 19, fontWeight: '700', color: '#fff',
      letterSpacing: 0.3, fontFamily: APP_FONT,
    },
    userName: {
      fontSize: 17, fontWeight: '600', color: t.textPrimary,
      letterSpacing: -0.2, fontFamily: APP_FONT,
    },
    userMeta: {
      fontSize: 12, color: t.textMuted, marginTop: 2, fontFamily: APP_FONT,
    },
    signedInPill: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: isDark ? 'rgba(74,222,128,0.10)' : 'rgba(22,163,74,0.10)',
      borderRadius: 99,
      paddingHorizontal: 9, paddingVertical: 4,
    },
    signedInDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.success },
    signedInText: { fontSize: 11, color: t.success, fontWeight: '700', fontFamily: APP_FONT },

    // Section label — sits on gradient background, white in light mode
    sectionLabel: {
      fontSize: 13, fontWeight: '600',
      color: isDark ? t.textMuted : 'rgba(255,255,255,0.80)',
      marginBottom: 8, marginLeft: 2, marginTop: 4,
      fontFamily: APP_FONT,
    },

    card: {
      backgroundColor: t.surface,
      borderRadius: 16,
      overflow: 'hidden',
      marginBottom: 22,
      // In light mode the card is white on vivid blue; a subtle shadow gives depth
      ...(isDark
        ? {}
        : { shadowColor: '#0d47a1', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 }),
    },

    // Row
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
    },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: cardLine },
    rowTopBorder: { borderTopWidth: 1, borderTopColor: cardLine },
    rowIcon: {
      width: 28, height: 28, borderRadius: 9,
      alignItems: 'center', justifyContent: 'center',
    },
    rowLabel: { flex: 1, fontSize: 14, color: t.textPrimary, fontWeight: '500', fontFamily: APP_FONT },
    rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rowValue: { fontSize: 13, color: t.textSecondary, fontFamily: APP_FONT },

    // Theme row
    themeRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
    },
    themeSub: {
      fontSize: 11.5, color: t.textMuted, marginTop: 2, fontFamily: APP_FONT,
    },
    themeToggle: {
      flexDirection: 'row',
      backgroundColor: isDark ? t.surfaceHi : '#f1f4f8',
      borderRadius: 12, padding: 3,
      borderWidth: 1, borderColor: cardLine,
    },
    themeOption: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: 9,
    },
    themeOptionActive: { backgroundColor: t.accent },
    themeOptionText: {
      fontSize: 11.5, fontWeight: '600',
      color: t.textSecondary, fontFamily: APP_FONT,
    },

    // IP
    ipValue: { fontSize: 12, color: t.textSecondary, marginTop: 2, fontFamily: APP_FONT },
    ipInput: { fontSize: 13, color: t.textPrimary, marginTop: 2, padding: 0, fontFamily: APP_FONT },
    editBtn: {
      width: 30, height: 30, borderRadius: 9,
      backgroundColor: t.accentSoft,
      alignItems: 'center', justifyContent: 'center',
    },
    saveBtn: {
      backgroundColor: t.success, borderRadius: 9,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 0.3, fontFamily: APP_FONT },

    // Server info
    serverInfoRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14 },
    serverInfoItem: { flex: 1, alignItems: 'center' },
    serverInfoLabel: { fontSize: 11, color: t.textMuted, marginBottom: 4, fontWeight: '600', fontFamily: APP_FONT },
    serverInfoValue: { fontSize: 13, fontWeight: '700', color: t.textPrimary, fontFamily: APP_FONT },
    serverInfoDivider: { width: 1, backgroundColor: cardLine },

    // Risk legend
    riskRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
    },
    riskDot: { width: 10, height: 10, borderRadius: 5 },
    riskLevel: { fontSize: 13, fontWeight: '700', marginBottom: 2, fontFamily: APP_FONT },
    riskDesc: { fontSize: 12, color: t.textSecondary, fontFamily: APP_FONT },

    // Logout
    logoutBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      backgroundColor: isDark ? 'rgba(248,113,113,0.08)' : '#fef2f2',
      borderRadius: 14,
      paddingVertical: 14,
      marginBottom: 22,
    },
    logoutText: { color: t.danger, fontSize: 14, fontWeight: '700', fontFamily: APP_FONT },

    footer: {
      textAlign: 'center', fontSize: 11,
      color: isDark ? t.textMuted : 'rgba(255,255,255,0.60)',
      lineHeight: 17, marginTop: 8, fontFamily: APP_FONT,
    },
  });
}
