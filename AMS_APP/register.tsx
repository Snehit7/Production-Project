import { useState, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Dimensions, Image, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import { useTheme, Palette } from '@/context/theme';

const { width: W, height: H } = Dimensions.get('window');

function Field({
  placeholder, value, onChangeText, secureTextEntry = false, keyboardType = 'default',
  styles, theme,
}: {
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: any;
  styles: any;
  theme: Palette;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      <TextInput
        style={styles.fieldInput}
        placeholder={placeholder}
        placeholderTextColor={theme.placeholder}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={theme.accent}
      />
    </View>
  );
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { apiIp } = useAuth();
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const btnScale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(btnScale, { toValue: 0.97, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1, useNativeDriver: true }).start();

  const handleRegister = async () => {
    if (!username || !email || !password || !confirm) {
      setError('All fields are required.');
      return;
    }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`http://${apiIp}:5000/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (data.success) router.replace('/login');
      else setError(data.error ?? 'Registration failed.');
    } catch {
      setError('Cannot reach server. Check API IP.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <Image
        source={require('@/assets/picture/log.png')}
        style={styles.bgImage}
        resizeMode="cover"
        blurRadius={Platform.OS === 'ios' ? 18 : 6}
      />
      <View style={styles.bgWhiteWash} pointerEvents="none" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ height: H * 0.18 }} />

          <Text style={styles.title}>Create Your{'\n'}Account</Text>


          <View style={styles.form}>
            <Field styles={styles} theme={theme}
              placeholder="username" value={username} onChangeText={setUsername} />
            <Field styles={styles} theme={theme}
              placeholder="email" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <Field styles={styles} theme={theme}
              placeholder="password" value={password} onChangeText={setPassword} secureTextEntry />
            <Field styles={styles} theme={theme}
              placeholder="confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />

            {!!error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={13} color={theme.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.btnRow}>
              <Animated.View style={[{ flex: 1, transform: [{ scale: btnScale }] }, loading && { opacity: 0.6 }]}>
                <TouchableOpacity
                  onPress={handleRegister}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  disabled={loading}
                  activeOpacity={1}
                >
                  <LinearGradient
                    colors={['#7c3aed', '#a855f7']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.signInBtn}
                  >
                    {loading
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.signInBtnText}>CREATE ACCOUNT</Text>
                    }
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>

              <View style={styles.brandPill}>
                <Image
                  source={require('@/assets/picture/logo.png')}
                  style={styles.brandLogo}
                  resizeMode="contain"
                />
              </View>
            </View>

            <TouchableOpacity onPress={() => router.back()} style={styles.signUpRow}>
              <Text style={styles.signUpText}>
                Already have an account?{'  '}
                <Text style={styles.signUpLink}>Log in</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(t: Palette) {
  const isDark = t.mode === 'dark';
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },

    bgImage: {
      position: 'absolute',
      top: -40, left: -40, right: -40, bottom: -40,
      width: W + 80, height: H + 80,
      opacity: isDark ? 0.12 : 0.22,
    },
    bgWhiteWash: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: isDark ? 'rgba(10,5,16,0.55)' : 'rgba(255,255,255,0.55)',
    },

    scroll: { flexGrow: 1, paddingHorizontal: 28 },

    title: {
      fontSize: 38, fontWeight: '900', color: t.textPrimary,
      letterSpacing: -1, lineHeight: 44,
    },
    subtitle: {
      fontSize: 13, color: t.textSecondary, marginTop: 8,
      letterSpacing: 1, textTransform: 'uppercase', fontWeight: '600',
    },

    form: { marginTop: 26, gap: 12 },
    field: {
      backgroundColor: isDark ? t.surface : 'rgba(255,255,255,0.85)',
      borderRadius: 14, height: 52,
      paddingHorizontal: 16,
      borderWidth: 1, borderColor: t.hairline,
      justifyContent: 'center',
    },
    fieldFocused: {
      borderColor: t.accent,
      backgroundColor: isDark ? t.surfaceHi : '#ffffff',
    },
    fieldInput: {
      color: t.textPrimary, fontSize: 15, letterSpacing: 0.2, padding: 0,
    },

    errorRow: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      backgroundColor: isDark ? 'rgba(248,113,113,0.10)' : 'rgba(220,38,38,0.08)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(248,113,113,0.25)' : 'rgba(220,38,38,0.2)',
      borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    },
    errorText: { color: t.danger, fontSize: 12, flex: 1 },

    btnRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8,
    },
    signInBtn: {
      height: 52, borderRadius: 26,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#7c3aed', shadowOpacity: 0.32,
      shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8,
    },
    signInBtnText: {
      color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1.5,
    },
    brandPill: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: t.surface,
      borderWidth: 1, borderColor: t.hairline,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    brandLogo: { width: 32, height: 32 },

    signUpRow: { alignItems: 'center', marginTop: 18 },
    signUpText: { fontSize: 13, color: t.textSecondary },
    signUpLink: { color: t.accent, fontWeight: '700' },
  });
}
