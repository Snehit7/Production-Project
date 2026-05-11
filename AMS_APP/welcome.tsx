import { useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Pressable,
  Dimensions,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';

const { width: W, height: H } = Dimensions.get('window');

export default function WelcomeScreen() {
  const styles = useMemo(() => makeStyles(), []);

  const fadeLogo = useRef(new Animated.Value(0)).current;
  const fadeImg = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeLogo, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(fadeImg, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.timing(titleAnim, {
      toValue: 1,
      duration: 700,
      delay: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const goToLogin = () => router.replace('/login');

  const translateY = titleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });

  return (
    <Pressable style={styles.root} onPress={goToLogin}>
      <StatusBar style="dark" />

      {/* Logo */}
      <Animated.View style={[styles.logoWrap, { opacity: fadeLogo }]}>
        <Image
          source={require('@/assets/picture/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>

      {/* Title */}
      <View style={styles.titleWrap} pointerEvents="none">
        <Animated.Text
          style={[
            styles.title,
            {
              opacity: titleAnim,
              transform: [{ translateY }],
            },
          ]}
        >
          Welcome back,
        </Animated.Text>
      </View>

      {/* Bottom Image */}
      <Animated.View style={[styles.bottomImageWrap, { opacity: fadeImg }]}>
        <Image
          source={require('@/assets/picture/login.jpg')}
          style={styles.bottomImage}
          resizeMode="cover"
        />

        <LinearGradient
          colors={['#ffffff', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)']}
          locations={[0, 0.35, 1]}
          style={styles.bottomFade}
          pointerEvents="none"
        />
      </Animated.View>
    </Pressable>
  );
}

const LOGO_SIZE = 64;
const BOTTOM_H = Math.min(H * 0.5, 420);

function makeStyles() {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: '#ffffff', // pure white
    },

    logoWrap: {
      position: 'absolute',
      top: 56,
      left: 22,
      zIndex: 5,
    },

    logo: {
      width: LOGO_SIZE,
      height: LOGO_SIZE,
    },

    titleWrap: {
      position: 'absolute',
      top: H * 0.35,
      left: 25,
      alignItems: 'flex-start',
    },

    title: {
      fontSize: 64,
      color: '#111',
      fontStyle: 'italic',
      fontWeight: '500',
      letterSpacing: 0.5,
      fontFamily: Platform.select({
        ios: 'Snell Roundhand',
        android: 'cursive',
      }),
      textShadowColor: 'rgba(0,0,0,0.08)',
      textShadowOffset: { width: 0, height: 4 },
      textShadowRadius: 14,
    },

    bottomImageWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: BOTTOM_H,
      opacity: 1,
    },

    bottomImage: {
      width: W,
      height: BOTTOM_H,
    },

    bottomFade: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 110,
    },
  });
}
