import { useState, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Image, Dimensions, Animated, ScrollView,
  KeyboardTypeOptions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';

const { width: W, height: H } = Dimensions.get('window');
const HERO_H = Math.min(H * 0.46, 420);

interface FieldProps {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  styles: any;
}

function Field({
  placeholder, value, onChangeText, secureTextEntry = false, keyboardType = 'default',
  styles,
}: FieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      <TextInput
        style={styles.fieldInput}
        placeholder={placeholder}
        placeholderTextColor="#999"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor="#6b4eff"
      />
    </View>
  );
}

export default function LoginScreen() {
  const { login, apiIp, setApiIp } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(), []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingIp, setEditingIp] = useState(false);
  const [tempIp, setTempIp] = useState(apiIp);

  const btnScale = useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(btnScale, { toValue: 0.97, useNativeDriver: true }).start();

  const pressOut = () =>
    Animated.spring(btnScale, { toValue: 1, useNativeDriver: true }).start();

  const handleLogin = async () => {
    if (!username || !password) {
      setError('Please enter username and password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`http://${apiIp}:5000/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (data.success) {
        await login(data.token, data.username);
        router.replace('/(tabs)');
      } else {
        setError(data.error ?? 'Login failed.');
      }
    } catch {
      setError('Cannot reach server. Check API IP.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Hero Image */}
      <View style={styles.heroWrap}>
        <Image
          source={require('@/assets/picture/log.png')}
          style={styles.heroImage}
          resizeMode="cover"
        />

        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.6)', '#ffffff']}
          locations={[0, 0.7, 1]}
          style={styles.heroFade}
        />
      </View>

      {/* Logo */}
      <View style={[styles.topLogo, { top: insets.top + 10 }]}>
        <Image
          source={require('@/assets/picture/logo.png')}
          style={styles.topLogoImage}
          resizeMode="contain"
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ height: HERO_H - 40 }} />

          <Text style={styles.title}>LOG IN</Text>
          <Text style={styles.subtitle}>Nepal Trek Safety</Text>

          <View style={styles.form}>
            <Field
              styles={styles}
              placeholder="username"
              value={username}
              onChangeText={setUsername}
            />

            <Field
              styles={styles}
              placeholder="password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            {!!error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={13} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.btnRow}>
              <Animated.View
                style={[
                  { flex: 1, transform: [{ scale: btnScale }] },
                  loading && { opacity: 0.6 },
                ]}
              >
                <TouchableOpacity
                  onPress={handleLogin}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  disabled={loading}
                  activeOpacity={1}
                >
                  <LinearGradient
                    colors={['#28114f', '#7051a4']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.signInBtn}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.signInBtnText}>LOG IN</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>
            </View>

            <TouchableOpacity
              onPress={() => router.push('/register')}
              style={styles.signUpRow}
            >
              <Text style={styles.signUpText}>
                No account?{' '}
                <Text style={styles.signUpLink}>Sign Up</Text>
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.serverRow, { marginTop: 30 }]}>
            <Ionicons name="wifi-outline" size={11} color="#777" />

            {editingIp ? (
              <TextInput
                style={styles.serverInput}
                value={tempIp}
                onChangeText={setTempIp}
                onBlur={() => {
                  setApiIp(tempIp);
                  setEditingIp(false);
                }}
                onSubmitEditing={() => {
                  setApiIp(tempIp);
                  setEditingIp(false);
                }}
                keyboardType="decimal-pad"
                autoFocus
              />
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setTempIp(apiIp);
                  setEditingIp(true);
                }}
              >
                <Text style={styles.serverText}>{apiIp}:5000</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: '#ffffff',
    },

    heroWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: HERO_H,
      backgroundColor: '#ffffff',
    },

    heroImage: {
      width: W,
      height: HERO_H,
    },

    heroFade: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: HERO_H * 0.55,
    },

    topLogo: {
      position: 'absolute',
      left: 20,
      zIndex: 10,
    },

    topLogoImage: {
      width: 63,
      height: 63,
    },

    scroll: {
      flexGrow: 1,
      paddingHorizontal: 28,
    },

    title: {
      fontSize: 44,
      fontWeight: '900',
      color: '#111',
      letterSpacing: -1,
    },

    subtitle: {
      fontSize: 13,
      color: '#666',
      marginTop: 8,
    },

    form: {
      marginTop: 30,
      gap: 12,
    },

    field: {
      backgroundColor: '#ffffff',
      borderRadius: 14,
      height: 52,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: '#e5e5e5',
      justifyContent: 'center',
    },

    fieldFocused: {
      borderColor: '#6b4eff',
      backgroundColor: '#ffffff',
    },

    fieldInput: {
      color: '#111',
      fontSize: 15,
    },

    errorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: 'rgba(220,38,38,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(220,38,38,0.2)',
      borderRadius: 10,
      padding: 8,
    },

    errorText: {
      color: '#dc2626',
      fontSize: 12,
    },

    btnRow: {
      flexDirection: 'row',
      marginTop: 8,
    },

    signInBtn: {
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#28114f',
      shadowOpacity: 0.25,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },

    signInBtnText: {
      color: '#fff',
      fontWeight: '800',
      letterSpacing: 1.5,
    },

    signUpRow: {
      alignItems: 'center',
      marginTop: 18,
    },

    signUpText: {
      fontSize: 13,
      color: '#666',
    },

    signUpLink: {
      color: '#6b4eff',
      fontWeight: '700',
    },

    serverRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
    },

    serverText: {
      fontSize: 11,
      color: '#777',
    },

    serverInput: {
      fontSize: 11,
      color: '#6b4eff',
    },
  });
}
