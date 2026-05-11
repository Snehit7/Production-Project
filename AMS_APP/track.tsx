import { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, StatusBar, TouchableOpacity,
  Dimensions, Animated, Easing, Modal, Linking, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, G, Line } from 'react-native-svg';
import { Pedometer } from 'expo-sensors';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/context/theme';

const { width: W } = Dimensions.get('window');

// ── Wave geometry ────────────────────────────────────────────────────────────
const WAVE_W = W;
const WAVE_H = 150;
const SAMPLES = 260;
const TICK_MS = 22;
const GAP_SAMPLES = 6;
const ACTIVE_WINDOW_MS = 30000; // ECG stays live for 30 s after last data (covers post-reading gap)

// PQRST shape generator (phase 0..1 within one heartbeat)
function ecgY(phase: number) {
  let y = 0;
  y += 9 * Math.exp(-Math.pow((phase - 0.18) / 0.030, 2));
  y -= 7 * Math.exp(-Math.pow((phase - 0.30) / 0.012, 2));
  y += 60 * Math.exp(-Math.pow((phase - 0.33) / 0.010, 2));
  y -= 18 * Math.exp(-Math.pow((phase - 0.36) / 0.012, 2));
  y += 14 * Math.exp(-Math.pow((phase - 0.58) / 0.045, 2));
  return y;
}

// Risk=label + colour
const STATUS_MAP: Record<string, { label: string; color: string }> = {
  Low: { label: 'Normal', color: '#4ade80' },
  Medium: { label: 'Elevated', color: '#fbbf24' },
  High: { label: 'High Risk', color: '#f97316' },
  Severe: { label: 'Critical', color: '#ef4444' },
  '--': { label: 'Waiting…', color: 'rgba(255,255,255,0.45)' },
};

// Nepal emergency contacts
type EmergencyContact = {
  name: string;
  number: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  group: 'personal' | 'services';
  subtitle: string;
  priority?: boolean;
};
const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { name: 'Mom', number: '+9779801234567', icon: 'heart-outline', group: 'personal', subtitle: 'Primary contact', priority: true },
  { name: 'Ambulance', number: '102', icon: 'medkit-outline', group: 'services', subtitle: 'Medical evacuation' },
  { name: 'Police', number: '100', icon: 'shield-checkmark-outline', group: 'services', subtitle: 'Nepal Police' },
  { name: 'Heli Rescue', number: '+97714410537', icon: 'airplane-outline', group: 'services', subtitle: 'Helicopter evacuation' },
  { name: 'Tourist Police', number: '1144', icon: 'people-outline', group: 'services', subtitle: 'Tourist assistance' },
  { name: 'Fire', number: '101', icon: 'flame-outline', group: 'services', subtitle: 'Fire brigade' },
  { name: 'Nepal Army', number: '+97714246135', icon: 'ribbon-outline', group: 'services', subtitle: 'Mountain rescue' },
];

// ── Real-time sweeping ECG (hospital monitor style) ──────────────────────────
function ECGMonitor({ bpm, active }: { bpm: number; active: boolean }) {
  const samplesRef = useRef<number[]>(new Array(SAMPLES).fill(NaN));
  const cursorRef = useRef(0);
  const startRef = useRef(Date.now());
  const [, force] = useState(0);

  useEffect(() => {
    if (!active) {
      // Reset to flat line
      samplesRef.current = new Array(SAMPLES).fill(NaN);
      cursorRef.current = 0;
      startRef.current = Date.now();
      force(t => (t + 1) & 0xffff);
      return;
    }
    const id = setInterval(() => {
      const cycleMs = 60000 / Math.max(30, Math.min(220, bpm));
      const elapsed = Date.now() - startRef.current;
      const phase = (elapsed % cycleMs) / cycleMs;
      const y = ecgY(phase);

      const idx = cursorRef.current;
      samplesRef.current[idx] = y;
      for (let i = 1; i <= GAP_SAMPLES; i++) {
        samplesRef.current[(idx + i) % SAMPLES] = NaN;
      }
      cursorRef.current = (idx + 1) % SAMPLES;
      force(t => (t + 1) & 0xffff);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [bpm, active]);

  const buildPath = () => {
    const s = samplesRef.current;
    let d = '';
    let needMove = true;
    for (let i = 0; i < SAMPLES; i++) {
      const v = s[i];
      if (Number.isNaN(v)) { needMove = true; continue; }
      const x = (i / (SAMPLES - 1)) * WAVE_W;
      const y = WAVE_H / 2 - v;
      d += needMove ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`;
      needMove = false;
    }
    return d;
  };

  const headIdx = (cursorRef.current - 1 + SAMPLES) % SAMPLES;
  const headVal = samplesRef.current[headIdx];
  const headX = (headIdx / (SAMPLES - 1)) * WAVE_W;
  const headY = Number.isNaN(headVal) ? WAVE_H / 2 : WAVE_H / 2 - headVal;

  return (
    <View style={{ width: WAVE_W, height: WAVE_H }}>
      <Svg width={WAVE_W} height={WAVE_H}>
        <Path
          d={`M0,${WAVE_H / 2} L${WAVE_W},${WAVE_H / 2}`}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1"
        />
        {active ? (
          <>
            <Path
              d={buildPath()}
              fill="none"
              stroke="rgba(120,180,255,0.25)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d={buildPath()}
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <G>
              <Circle cx={headX} cy={headY} r={6} fill="rgba(255,255,255,0.18)" />
              <Circle cx={headX} cy={headY} r={3.2} fill="#ffffff" />
            </G>
          </>
        ) : (
          // Flat idle line
          <Path
            d={`M0,${WAVE_H / 2} L${WAVE_W},${WAVE_H / 2}`}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        )}
      </Svg>
    </View>
  );
}

// ── History numbers strip — slides left when a new value arrives ─────────────
function HistoryStrip({ values }: { values: number[] }) {
  const slide = useRef(new Animated.Value(0)).current;
  const prevLenRef = useRef(values.length);

  useEffect(() => {
    if (values.length !== prevLenRef.current) {
      slide.setValue(40);
      Animated.timing(slide, {
        toValue: 0,
        duration: 450,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      prevLenRef.current = values.length;
    }
  }, [values.length]);

  const display = values.length > 0 ? values.slice(-7) : [];
  return (
    <View style={styles.histRow}>
      <Animated.View style={{ flexDirection: 'row', flex: 1, justifyContent: 'space-around', transform: [{ translateX: slide }] }}>
        {display.map((v, i) => {
          const isCurrent = i === display.length - 1;
          return (
            <Text
              key={`${i}-${v}`}
              style={[styles.histNum, isCurrent && styles.histNumCurrent]}
            >
              {v}
            </Text>
          );
        })}
      </Animated.View>
    </View>
  );
}

// ── Circular timer ────────────────────────────────────────────────────────────
const TIMER_R = 30;
const TIMER_SIZE = (TIMER_R + 8) * 2;
const CIRCUMF = 2 * Math.PI * TIMER_R;

function TimerButton({
  seconds, paused, onToggle,
}: { seconds: number; paused: boolean; onToggle: () => void }) {
  const arcLen = CIRCUMF * ((seconds % 60) / 60);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <TouchableOpacity style={styles.timerTouch} onPress={onToggle} activeOpacity={0.85}>
      <Svg width={TIMER_SIZE} height={TIMER_SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={TIMER_SIZE / 2} cy={TIMER_SIZE / 2} r={TIMER_R}
          stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" fill="rgba(2,6,23,0.85)"
        />
        <Circle
          cx={TIMER_SIZE / 2} cy={TIMER_SIZE / 2} r={TIMER_R}
          stroke="#4FC3F7" strokeWidth="2.5" fill="none"
          strokeDasharray={[arcLen, CIRCUMF - arcLen] as any}
          strokeLinecap="round"
          rotation="-90"
          origin={`${TIMER_SIZE / 2},${TIMER_SIZE / 2}`}
        />
      </Svg>
      <Text style={styles.timerTime}>{mm}:{ss}</Text>
      <Ionicons name={paused ? 'play' : 'pause'} size={9} color="rgba(255,255,255,0.7)" style={{ marginTop: 1 }} />
    </TouchableOpacity>
  );
}

// ── Elevation card with animated mountain & altitude counter ─────────────────
const ELEV_CARD_W = W - 36;            // card outer width
const ELEV_INNER = ELEV_CARD_W - 24;  // minus card horizontal padding (12 each side)
const ELEV_NUM_W = 92;                // altitude number column
const ELEV_W = ELEV_INNER - ELEV_NUM_W;
const ELEV_H = 110;

function ElevationCard({ altitude, active, isDark }: { altitude: number | string; active: boolean; isDark: boolean }) {
  const numAlt = typeof altitude === 'number' ? altitude : 0;
  const animValue = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [displayAlt, setDisplayAlt] = useState(0);
  const prevAltRef = useRef(0);

  // Smooth tween for the altitude number
  useEffect(() => {
    const from = prevAltRef.current;
    const to = numAlt;
    if (from === to) return;
    animValue.setValue(0);
    const id = animValue.addListener(({ value }) => {
      setDisplayAlt(Math.round(from + (to - from) * value));
    });
    Animated.timing(animValue, {
      toValue: 1,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      prevAltRef.current = to;
    });
    return () => animValue.removeListener(id);
  }, [numAlt]);

  // Slow continuous drift on a cloud / shimmer
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Pulsing marker dot (only when active)
  useEffect(() => {
    if (!active) { pulse.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  // Mountain marker position — clamped 0..3500 m of elevation
  const elevPct = Math.max(0, Math.min(1, numAlt / 3500));
  const markerX = 16 + elevPct * (ELEV_W - 32);
  // Match the front mountain ridge curve roughly
  const markerY = ELEV_H - 28 - elevPct * 50;

  const cloudX = drift.interpolate({ inputRange: [0, 1], outputRange: [-40, ELEV_W + 40] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <View style={[styles.elevCard, !isDark && {
      backgroundColor: 'rgba(255,255,255,0.88)',
      borderColor: 'rgba(30,136,229,0.22)',
      shadowColor: '#1565c0', shadowOpacity: 0.10, shadowRadius: 8, elevation: 3,
    }]}>
      <View style={styles.elevHeader}>
        <Ionicons name="trending-up" size={13} color={isDark ? 'rgba(255,255,255,0.55)' : '#1565c0'} />
        <Text style={[styles.elevLabel, !isDark && { color: '#1565c0' }]}>ELEVATION</Text>
      </View>

      <View style={styles.elevBody}>
        <View style={styles.elevNumberWrap}>
          <Text style={[styles.elevNumber, !isDark && { color: '#0a1f33' }]}>{active ? displayAlt : '--'}</Text>
          <Text style={[styles.elevUnit, !isDark && { color: '#2c5478' }]}>m</Text>
        </View>

        <View style={{ width: ELEV_W, height: ELEV_H, overflow: 'hidden' }}>
          <Svg width={ELEV_W} height={ELEV_H}>
            {/* Sky fade */}
            <Path
              d={`M0,0 L${ELEV_W},0 L${ELEV_W},${ELEV_H} L0,${ELEV_H} Z`}
              fill="rgba(80,140,220,0.04)"
            />
            {/* Back ridge */}
            <Path
              d={`M0,${ELEV_H - 10}
                  L20,${ELEV_H - 35}
                  L55,${ELEV_H - 60}
                  L90,${ELEV_H - 30}
                  L130,${ELEV_H - 70}
                  L170,${ELEV_H - 45}
                  L210,${ELEV_H - 80}
                  L${ELEV_W},${ELEV_H - 50}
                  L${ELEV_W},${ELEV_H} L0,${ELEV_H} Z`}
              fill={isDark ? 'rgba(120,140,200,0.18)' : 'rgba(21,101,192,0.20)'}
            />
            {/* Front ridge */}
            <Path
              d={`M0,${ELEV_H - 5}
                  L25,${ELEV_H - 25}
                  L60,${ELEV_H - 55}
                  L100,${ELEV_H - 20}
                  L150,${ELEV_H - 65}
                  L195,${ELEV_H - 35}
                  L${ELEV_W},${ELEV_H - 40}
                  L${ELEV_W},${ELEV_H} L0,${ELEV_H} Z`}
              fill={isDark ? 'rgba(95,115,180,0.32)' : 'rgba(21,101,192,0.35)'}
            />
            {/* Snow caps on the front ridge */}
            <Path
              d={`M52,${ELEV_H - 50} L60,${ELEV_H - 55} L68,${ELEV_H - 50}`}
              stroke={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.90)'}
              strokeWidth="2" fill="none" strokeLinecap="round"
            />
            <Path
              d={`M142,${ELEV_H - 60} L150,${ELEV_H - 65} L158,${ELEV_H - 60}`}
              stroke={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.90)'}
              strokeWidth="2" fill="none" strokeLinecap="round"
            />
          </Svg>

          {/* Drifting cloud */}
          <Animated.View style={[
            styles.elevCloud,
            !isDark && { backgroundColor: 'rgba(21,101,192,0.10)' },
            { transform: [{ translateX: cloudX }] },
          ]} />

          {/* Pulse + dot marker */}
          {active && (
            <Animated.View
              style={[
                styles.elevMarkerPulse,
                {
                  left: markerX - 7, top: markerY - 7,
                  transform: [{ scale: pulseScale }], opacity: pulseOpacity,
                },
              ]}
            />
          )}
          <View style={[styles.elevMarkerDot, { left: markerX - 4, top: markerY - 4 }]} />
        </View>
      </View>
    </View>
  );
}

// ── Footstep card (Pedometer) ────────────────────────────────────────────────
const STEP_GOAL = 10000;

function StepsCard({
  steps, available, isDark,
}: {
  steps: number;
  available: boolean | null;
  isDark: boolean;
}) {
  const pct = Math.max(0, Math.min(1, steps / STEP_GOAL));
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fill, {
      toValue: pct,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const widthInterp = fill.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'],
  });

  const km = (steps * 0.000762).toFixed(2); // ~76cm per stride
  const kcal = Math.round(steps * 0.04);    // rough estimate

  const statIconCol = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(21,101,192,0.75)';
  return (
    <View style={[styles.stepsCard, !isDark && {
      backgroundColor: 'rgba(255,255,255,0.88)',
      borderColor: 'rgba(30,136,229,0.22)',
      shadowColor: '#1565c0', shadowOpacity: 0.10, shadowRadius: 8, elevation: 3,
    }]}>
      <View style={styles.stepsHeader}>
        <Ionicons name="footsteps" size={13} color={isDark ? 'rgba(255,255,255,0.55)' : '#1565c0'} />
        <Text style={[styles.stepsLabel, !isDark && { color: '#1565c0' }]}>STEPS TODAY</Text>
        {available === false && (
          <Text style={[styles.stepsBadge, !isDark && { color: '#b91c1c' }]}>Sensor unavailable</Text>
        )}
      </View>

      <View style={styles.stepsBody}>
        <View style={styles.stepsNumWrap}>
          <Text style={[styles.stepsNum, !isDark && { color: '#0a1f33' }]}>
            {available === false ? '--' : steps.toLocaleString()}
          </Text>
          <Text style={[styles.stepsGoal, !isDark && { color: '#2c5478' }]}>/ {STEP_GOAL.toLocaleString()}</Text>
        </View>

        <View style={[styles.stepsBarTrack, !isDark && { backgroundColor: 'rgba(21,101,192,0.10)' }]}>
          <Animated.View style={[styles.stepsBarFill, { width: widthInterp }, !isDark && { backgroundColor: '#1565c0' }]} />
        </View>

        <View style={styles.stepsStatsRow}>
          <View style={styles.stepsStat}>
            <Ionicons name="walk-outline" size={11} color={statIconCol} />
            <Text style={[styles.stepsStatText, !isDark && { color: '#1e3a5f' }]}>{km} km</Text>
          </View>
          <View style={[styles.stepsDivider, !isDark && { backgroundColor: 'rgba(21,101,192,0.18)' }]} />
          <View style={styles.stepsStat}>
            <Ionicons name="flame-outline" size={11} color={statIconCol} />
            <Text style={[styles.stepsStatText, !isDark && { color: '#1e3a5f' }]}>{kcal} kcal</Text>
          </View>
          <View style={[styles.stepsDivider, !isDark && { backgroundColor: 'rgba(21,101,192,0.18)' }]} />
          <View style={styles.stepsStat}>
            <Ionicons name="trophy-outline" size={11} color={statIconCol} />
            <Text style={[styles.stepsStatText, !isDark && { color: '#1e3a5f' }]}>{Math.round(pct * 100)}%</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ── Emergency overlay ────────────────────────────────────────────────────────
function EmergencyOverlay({
  visible, onDismiss,
}: { visible: boolean; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();

  const call = (num: string) => {
    const clean = num.replace(/\s+/g, '');
    Linking.openURL(`tel:${clean}`).catch(() => { });
  };

  // Auto-dial Mom on first appearance (single press = "call mom then show overlay")
  const dialedRef = useRef(false);
  useEffect(() => {
    if (visible && !dialedRef.current) {
      dialedRef.current = true;
      const mom = EMERGENCY_CONTACTS.find(c => c.priority);
      if (mom) call(mom.number);
    }
    if (!visible) dialedRef.current = false;
  }, [visible]);

  const personal = EMERGENCY_CONTACTS.filter(c => c.group === 'personal');
  const services = EMERGENCY_CONTACTS.filter(c => c.group === 'services');

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={styles.emergRoot}>
        <View style={[styles.emergHeader, { paddingTop: insets.top + 18 }]}>
          <View style={styles.emergHeaderRow}>
            <View style={styles.emergStatusDot} />
            <Text style={styles.emergStatusText}>Emergency mode</Text>
          </View>
          <Text style={styles.emergTitle}>Need help?</Text>
          <Text style={styles.emergSub}>Tap a contact to call. Calling priority first.</Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Priority hero card ── */}
          {personal.map((c, i) => (
            <TouchableOpacity
              key={i}
              activeOpacity={0.9}
              onPress={() => call(c.number)}
              style={styles.priorityCard}
            >
              <View style={styles.priorityIcon}>
                <Ionicons name={c.icon} size={24} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.priorityLabel}>{c.subtitle.toUpperCase()}</Text>
                <Text style={styles.priorityName}>{c.name}</Text>
                <Text style={styles.priorityNum}>{c.number}</Text>
              </View>
              <View style={styles.priorityCallBtn}>
                <Ionicons name="call" size={18} color="#fff" />
                <Text style={styles.priorityCallText}>Call</Text>
              </View>
            </TouchableOpacity>
          ))}

          {/* ── Emergency services ── */}
          <Text style={styles.emergGroupLabel}>Emergency services</Text>
          <View style={styles.servicesCard}>
            {services.map((c, i) => (
              <TouchableOpacity
                key={i}
                activeOpacity={0.7}
                onPress={() => call(c.number)}
                style={[
                  styles.serviceRow,
                  i < services.length - 1 && styles.serviceRowBorder,
                ]}
              >
                <View style={styles.serviceIcon}>
                  <Ionicons name={c.icon} size={17} color="rgba(255,255,255,0.8)" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.serviceName}>{c.name}</Text>
                  <Text style={styles.serviceSub}>{c.subtitle}</Text>
                </View>
                <Text style={styles.serviceNum}>{c.number}</Text>
                <Ionicons name="call-outline" size={16} color="rgba(255,255,255,0.55)" style={{ marginLeft: 10 }} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={[styles.emergDismissWrap, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity style={styles.emergDismiss} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={styles.emergDismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Results screen — appears when reading completes ──────────────────────────
function ResultsScreen({
  visible, bpm, spo2, altitude, bpmHist, onClose,
}: {
  visible: boolean;
  bpm: number;
  spo2: number | string;
  altitude: number | string;
  bpmHist: number[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  // R-R interval from BPM (ms)
  const rrInterval = bpm > 0 ? Math.round(60000 / bpm) : 0;

  // HRV (SDNN) — std deviation of R-R intervals derived from history
  const hrv = useMemo(() => {
    if (bpmHist.length < 2) return 0;
    const rrs = bpmHist.filter(b => b > 0).map(b => 60000 / b);
    if (rrs.length < 2) return 0;
    const mean = rrs.reduce((a, b) => a + b, 0) / rrs.length;
    const variance = rrs.reduce((a, b) => a + (b - mean) ** 2, 0) / rrs.length;
    return Math.round(Math.sqrt(variance));
  }, [bpmHist]);

  // ECG decorative path — mimics 5-peak hospital strip
  const ecgPath = useMemo(() => {
    const stripW = W - 40;
    const peakSpacing = stripW / 5;
    let path = `M -10 80 `;
    for (let i = 0; i < 5; i++) {
      const peakX = peakSpacing * (i + 0.5);
      const startX = peakX - 15;
      path += `L ${startX} 80 `;
      path += `C ${startX + 3} 80, ${startX + 5} 83, ${startX + 6} 85 `;
      path += `L ${peakX - 1} 15 `;
      path += `L ${peakX + 3} 115 `;
      path += `C ${peakX + 6} 115, ${peakX + 8} 80, ${peakX + 12} 80 `;
    }
    path += `L ${stripW + 10} 80`;
    return path;
  }, []);

  // BPM history numbers above the ECG (last 5)
  const histAbove = useMemo(() => {
    const arr = bpmHist.slice(-5);
    while (arr.length < 5) arr.unshift(bpm);
    return arr;
  }, [bpmHist, bpm]);

  // Min / max from history
  const histStats = useMemo(() => {
    const valid = bpmHist.filter(b => b > 0);
    if (valid.length === 0) return { min: bpm, max: bpm };
    return {
      min: Math.min(...valid),
      max: Math.max(...valid),
    };
  }, [bpmHist, bpm]);

  // HRV scatter dots
  const chartW = W - 80;
  const chartH = 140;
  const dots = useMemo(() => {
    const out: { x: number; y: number; r: number; color: string }[] = [];
    const cols = 32;
    const random = (s: number) => {
      const x = Math.sin(s) * 10000; return x - Math.floor(x);
    };
    for (let i = 0; i < cols; i++) {
      const x = (i / (cols - 1)) * (chartW - 20) + 10;
      const norm = i / cols;
      let act = Math.sin(norm * Math.PI) * 0.5 + 0.2;
      if (norm > 0.4 && norm < 0.7) act += 0.4;
      const baseH = act * 80 + 20;
      const num = Math.floor(random(i) * 6) + 4;
      for (let j = 0; j < num; j++) {
        const seed = i * 100 + j;
        const yOff = (random(seed) - 0.5) * baseH;
        let y = chartH / 2 - baseH / 2 + yOff + 10;
        y = Math.max(8, Math.min(chartH - 12, y));
        const cr = random(seed + 1);
        let color = '#2563eb';
        if (cr > 0.85) color = '#db2777';
        else if (cr > 0.7) color = '#9333ea';
        else if (cr > 0.4) color = '#3b82f6';
        else if (cr > 0.2) color = '#1e3a8a';
        out.push({
          x, y,
          r: random(seed + 2) * 2.5 + 2,
          color,
        });
      }
    }
    return out;
  }, [chartW]);

  const altLabel = typeof altitude === 'number' ? `${altitude} m` : '--';
  const spo2Label = typeof spo2 === 'number' ? `${spo2}%` : '--';

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={[resStyles.root, { paddingTop: insets.top + 8 }]}>
        <LinearGradient
          colors={['#0f0f17', '#0a0a14', '#06060d']}
          style={StyleSheet.absoluteFill}
        />

        {/* Header */}
        <View style={resStyles.header}>
          <Text style={resStyles.headerTitle}>Reading Complete</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* BPM history numbers */}
          <View style={resStyles.histRow}>
            {histAbove.map((v, i) => (
              <Text key={i} style={resStyles.histNum}>{v}</Text>
            ))}
          </View>

          {/* ECG strip */}
          <View style={resStyles.ecgWrap}>
            <Svg width={W - 40} height={140}>
              <Path d={ecgPath} stroke="#ffffff" strokeWidth={1.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </Svg>
          </View>

          {/* BPM block */}
          <View style={resStyles.bpmRow}>
            <View style={resStyles.bpmLeft}>
              <Text style={resStyles.bpmNum}>{bpm > 0 ? bpm : '--'}</Text>
              <Text style={resStyles.bpmUnit}>BPM</Text>
            </View>
            <View style={resStyles.bpmRight}>
              <Text style={resStyles.bpmStat}>
                <Text style={resStyles.bpmStatVal}>{histStats.min}</Text> min
              </Text>
              <Text style={resStyles.bpmStat}>
                <Text style={resStyles.bpmStatVal}>{histStats.max}</Text> max
              </Text>
            </View>
          </View>

          {/* R-R Interval card */}
          <View style={resStyles.statCard}>
            <Text style={resStyles.statCardLabel}>R-R Interval</Text>
            <Text style={resStyles.statCardValue}>
              {rrInterval > 0 ? rrInterval : '--'}
              <Text style={resStyles.statCardUnit}> ms</Text>
            </Text>
          </View>

          {/* HRV card with scatter chart */}
          <View style={resStyles.hrvCard}>
            <View style={resStyles.hrvHeader}>
              <Text style={resStyles.statCardLabel}>Heart Rate Variability</Text>
              <Text style={resStyles.statCardValue}>
                {hrv > 0 ? hrv : '--'}
                <Text style={resStyles.statCardUnit}> ms</Text>
              </Text>
            </View>

            <Svg width={chartW} height={chartH} style={{ marginTop: 6 }}>
              {[0, 1, 2, 3, 4, 5].map(i => {
                const x = (i / 5) * chartW;
                return (
                  <Line
                    key={i}
                    x1={x} y1={0} x2={x} y2={chartH - 24}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth={1}
                  />
                );
              })}
              {dots.map((d, i) => (
                <Circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.color} opacity={0.85} />
              ))}
            </Svg>

            <View style={resStyles.hrvLabels}>
              {['12am', '4am', '8am', '12pm', '4pm', '8pm'].map(l => (
                <Text key={l} style={resStyles.hrvLabel}>{l}</Text>
              ))}
            </View>
          </View>

          {/* Altitude + SpO2 cards */}
          <View style={resStyles.dualRow}>
            <View style={[resStyles.dualCard, { marginRight: 8 }]}>
              <View style={resStyles.dualHead}>
                <Ionicons name="trending-up" size={14} color="#4FC3F7" />
                <Text style={resStyles.dualLabel}>Altitude</Text>
              </View>
              <Text style={resStyles.dualValue}>{altLabel}</Text>
            </View>
            <View style={[resStyles.dualCard, { marginLeft: 8 }]}>
              <View style={resStyles.dualHead}>
                <Ionicons name="water" size={14} color="#ec4899" />
                <Text style={resStyles.dualLabel}>SpO₂</Text>
              </View>
              <Text style={resStyles.dualValue}>{spo2Label}</Text>
            </View>
          </View>
        </ScrollView>

        {/* Bottom-left back button */}
        <View style={[resStyles.backWrap, { bottom: insets.bottom + 18 }]}>
          <TouchableOpacity style={resStyles.backBtn} onPress={onClose} activeOpacity={0.85}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
            <Text style={resStyles.backText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function TrackScreen() {
  const insets = useSafeAreaInsets();
  const { apiIp, username } = useAuth();

  const [bpm, setBpm] = useState<number>(72);
  const [spo2, setSpo2] = useState<number | string>('--');
  const [altitude, setAltitude] = useState<number | string>('--');
  const [riskLevel, setRiskLevel] = useState('--');
  const [bpmHist, setBpmHist] = useState<number[]>([]);
  const [hasLive, setHasLive] = useState(false);
  const [lastDataAt, setLastDataAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());

  const [emergency, setEmergency] = useState(false);

  // ── Reading-session state (mirrors ESP32) ────────────────────────────────
  // 'idle'     → no finger detected. Show "Place finger on sensor".
  // 'reading'  → ESP32 captured a finger. Hide live values, run countdown.
  // 'complete' → 20-second window finished. Reveal final SpO2/HR/altitude.
  const [sessionState, setSessionState] = useState<'idle' | 'reading' | 'complete'>('idle');
  const [sessionRemaining, setSessionRemaining] = useState<number>(0);   // seconds
  const [paused, setPaused] = useState(false);

  const isReading = sessionState === 'reading';
  // Show live values as soon as we have any data — including during the
  // reading window, so the user can watch values update in real-time.
  const showVitals = hasLive;

  // Steps state (Pedometer)
  const [steps, setSteps] = useState(0);
  const [pedoAvailable, setPedoAvailable] = useState<boolean | null>(null);

  // Results overlay (shown after a reading completes)
  const [resultsVisible, setResultsVisible] = useState(false);
  const [results, setResults] = useState<{
    bpm: number; spo2: number | string; altitude: number | string; bpmHist: number[];
  } | null>(null);
  const wasActiveRef = useRef(false);
  const dismissedRef = useRef(true);    // suppress first trigger after mount (stale data)

  // The free-running recording timer was replaced by the session-driven
  // countdown below. The TimerButton now reflects the live ESP32 reading
  // window: it counts UP from 0 → 20 s while sessionState === 'reading',
  // and resets to 0 the moment the window closes.

  // active-window ticker (drives flat-vs-live ECG)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Pedometer setup ────────────────────────────────────────────────────────
  useEffect(() => {
    let watchSub: { remove: () => void } | null = null;
    let cancelled = false;
    let baseline = 0;

    (async () => {
      try {
        const available = await Pedometer.isAvailableAsync();
        if (cancelled) return;
        setPedoAvailable(available);
        if (!available) return;

        // Baseline: today's count up to now (works on iOS; may throw on Android)
        try {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          const end = new Date();
          const { steps: count } = await Pedometer.getStepCountAsync(start, end);
          if (!cancelled) {
            baseline = count;
            setSteps(count);
          }
        } catch {
          // Android often can't query history — start from 0 and add live steps
          baseline = 0;
        }

        // Live updates — receives delta steps since watch began
        watchSub = Pedometer.watchStepCount(({ steps: delta }) => {
          setSteps(baseline + delta);
        });
      } catch {
        if (!cancelled) setPedoAvailable(false);
      }
    })();

    return () => {
      cancelled = true;
      if (watchSub) watchSub.remove();
    };
  }, []);

  // Arduino polling — fast cadence so app stays in sync with OLED
  useEffect(() => {
    let lastSeenTs: string | null = null;
    const poll = async () => {
      try {
        const [lRes, hRes] = await Promise.all([
          fetch(`http://${apiIp}:5000/history/latest`),
          fetch(`http://${apiIp}:5000/history?limit=14`),
        ]);
        const lj = await lRes.json();
        const hj = await hRes.json();
        if (lj?.success && lj.data) {
          const d = lj.data;
          setBpm(Math.max(30, Math.min(220, Math.round(d.heart_rate))));
          setSpo2(Math.round(d.spo2_pct));
          setAltitude(Math.round(d.altitude));
          setRiskLevel(d.risk_level ?? '--');
          setHasLive(true);
          // mark "fresh data" only when timestamp changes (i.e. a new reading actually arrived)
          const ts = d.timestamp ?? d.created_at ?? null;
          if (ts && ts !== lastSeenTs) {
            lastSeenTs = ts;
            setLastDataAt(Date.now());
          } else if (!ts) {
            // Fallback: treat any successful poll as fresh
            setLastDataAt(Date.now());
          }
        }
        if (hj?.success && Array.isArray(hj.data)) {
          setBpmHist(hj.data.map((r: any) => Math.round(r.heart_rate)).reverse());
        }
      } catch { }
    };
    poll();
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [apiIp]);

  // Emergency polling
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`http://${apiIp}:5000/emergency`);
        const j = await r.json();
        if (j?.success && j.triggered) setEmergency(true);
      } catch { }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [apiIp]);

  // ── Session polling — drives the reading lifecycle UI ────────────────────
  // Polls /session every 500 ms so the UI swaps to "Reading…" within half
  // a second of the user placing their finger on the sensor.
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`http://${apiIp}:5000/session`);
        const j = await r.json();
        if (!j?.success) return;
        const s = j.session;
        setSessionState(s.state);
        if (s.state === 'reading' && typeof s.remaining_ms === 'number') {
          setSessionRemaining(Math.max(0, Math.ceil(s.remaining_ms / 1000)));
        } else {
          setSessionRemaining(0);     // reset when idle / complete
        }
      } catch { /* ignore — server probably unreachable */ }
    };
    poll();
    const id = setInterval(poll, 500);
    return () => clearInterval(id);
  }, [apiIp]);

  // Detect end-of-reading: was actively receiving fresh data, now idle ≥3 s
  useEffect(() => {
    const id = setInterval(() => {
      const isActive = hasLive && (Date.now() - lastDataAt) < 3000;
      // active → idle = reading just finished
      if (wasActiveRef.current && !isActive && !dismissedRef.current && hasLive) {
        setResults({
          bpm: typeof bpm === 'number' ? bpm : 0,
          spo2,
          altitude,
          bpmHist,
        });
        setResultsVisible(true);
      }
      // idle → active = a new reading session started, allow re-trigger next time
      if (!wasActiveRef.current && isActive) {
        dismissedRef.current = false;
      }
      wasActiveRef.current = isActive;
    }, 500);
    return () => clearInterval(id);
  }, [hasLive, lastDataAt, bpm, spo2, altitude, bpmHist]);

  const closeResults = () => {
    setResultsVisible(false);
    dismissedRef.current = true;
  };

  const dismissEmergency = async () => {
    setEmergency(false);
    try {
      await fetch(`http://${apiIp}:5000/emergency`, { method: 'DELETE' });
    } catch { }
  };

  // ECG stays alive during a reading AND for 30 s after the last data point
  // so it doesn't suddenly go flat when the ESP32 stops posting.
  const ecgActive = hasLive && (isReading || sessionState !== 'idle' || (now - lastDataAt) < ACTIVE_WINDOW_MS);
  const status = STATUS_MAP[riskLevel] ?? STATUS_MAP['--'];
  const greetName = username ? username.split(/[\s@]/)[0] : 'there';
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <LinearGradient
        colors={isDark
          ? ['#1a1025', '#120a1f', '#0a0510']
          : ['#1e88e5', '#2196f3', '#42a5f5', '#64b5f6']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greet}>Hello, {greetName}</Text>
          </View>
          <View style={styles.avatar}>
            <Ionicons name="heart" size={16} color="#fff" />
          </View>
        </View>

        {/* Big circular BPM card */}
        <View style={styles.centerWrap}>
          <View style={styles.circleCard}>
            <Ionicons name="pulse" size={20} color="rgba(255,255,255,0.55)" style={{ marginBottom: 6 }} />
            <Text style={styles.bpmNum}>{showVitals ? bpm : '--'}</Text>
            <Text style={styles.bpmLabel}>{isReading ? 'READING…' : 'BPM'}</Text>
          </View>
        </View>

        <HistoryStrip values={bpmHist} />

        <View style={styles.waveArea}>
          {/* ECG keeps animating during the read so the user can see life
              on the line — we just hide the numerical readout. */}
          <ECGMonitor bpm={bpm} active={ecgActive || isReading} />
        </View>

        <Text style={styles.statusText}>
          Status:{' '}
          <Text style={[styles.statusValue, { color: isReading ? '#4FC3F7' : status.color }]}>
            {isReading ? `Reading ${sessionRemaining}s left` : status.label}
          </Text>
        </Text>

        <View style={styles.vitalsRow}>
          <View style={styles.vitalItem}>
            <Ionicons name="water-outline" size={12} color="rgba(255,255,255,0.4)" />
            <Text style={styles.vitalText}>
              SpO₂  <Text style={styles.vitalValue}>{showVitals && typeof spo2 === 'number' ? `${spo2}%` : '--'}</Text>
            </Text>
          </View>
        </View>

        <ElevationCard altitude={showVitals ? altitude : '--'} active={hasLive} isDark={isDark} />

        <StepsCard steps={steps} available={pedoAvailable} isDark={isDark} />
      </ScrollView>

      {/* Floating session timer — only visible while a reading is in flight.
          Counts up from 0 to 20 s, then disappears the moment the ESP32
          posts /session/end. */}
      {isReading && (
        <View
          style={[
            styles.timerFloating,
            { bottom: insets.bottom + 18, right: 18 },
          ]}
        >
          <TimerButton
            seconds={Math.max(0, 20 - sessionRemaining)}
            paused={false}
            onToggle={() => setPaused(p => !p)}
          />
        </View>
      )}

      <EmergencyOverlay visible={emergency} onDismiss={dismissEmergency} />

      <ResultsScreen
        visible={resultsVisible}
        bpm={results?.bpm ?? 0}
        spo2={results?.spo2 ?? '--'}
        altitude={results?.altitude ?? '--'}
        bpmHist={results?.bpmHist ?? []}
        onClose={closeResults}
      />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6,
  },
  greet: { color: '#fff', fontSize: 24, fontWeight: '600', letterSpacing: -0.3 },
  greetSub: { color: 'rgba(200,180,230,0.65)', fontSize: 13, marginTop: 2 },
  avatar: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '12deg' }],
  },

  centerWrap: { alignItems: 'center', marginTop: 14 },
  circleCard: {
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#fff', shadowOpacity: 0.06, shadowRadius: 30,
  },
  bpmNum: { color: '#fff', fontSize: 64, fontWeight: '500', letterSpacing: -2, lineHeight: 70 },
  bpmLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '600', letterSpacing: 2.5, marginTop: 4 },

  histRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 18, height: 22 },
  histNum: { color: 'rgba(255,255,255,0.28)', fontSize: 13, fontWeight: '600' },
  histNumCurrent: { color: 'rgba(255,255,255,0.85)', fontSize: 15 },

  waveArea: {
    marginTop: 6,
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },

  statusText: { textAlign: 'center', marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,0.45)' },
  statusValue: { fontWeight: '700', fontSize: 13 },

  vitalsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 18, marginTop: 8,
  },
  vitalItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  vitalText: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  vitalValue: { color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  vitalDivider: { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.12)' },

  timerFloating: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
  },
  timerTouch: {
    width: TIMER_SIZE, height: TIMER_SIZE,
    alignItems: 'center', justifyContent: 'center',
  },
  timerTime: { color: '#fff', fontSize: 11, fontWeight: '500', letterSpacing: 1 },

  // Elevation card
  elevCard: {
    marginHorizontal: 18,
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    paddingTop: 10, paddingHorizontal: 12, paddingBottom: 0,
    overflow: 'hidden',
  },
  elevHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4 },
  elevLabel: {
    color: 'rgba(255,255,255,0.55)', fontSize: 10,
    fontWeight: '700', letterSpacing: 2,
  },
  elevBody: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    marginTop: 4,
  },
  elevNumberWrap: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingLeft: 4, paddingBottom: 8, width: ELEV_NUM_W,
  },
  elevNumber: {
    color: '#fff', fontSize: 36, fontWeight: '600',
    letterSpacing: -1.2, lineHeight: 38,
  },
  elevUnit: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginLeft: 4, marginBottom: 6 },
  elevCloud: {
    position: 'absolute', top: 14,
    width: 38, height: 8, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  elevMarkerPulse: {
    position: 'absolute',
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#4FC3F7',
  },
  elevMarkerDot: {
    position: 'absolute',
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#4FC3F7',
    borderWidth: 1.5, borderColor: '#fff',
  },

  // Steps card (Pedometer)
  stepsCard: {
    marginHorizontal: 18,
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    padding: 14,
  },
  stepsHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  stepsLabel: {
    color: 'rgba(255,255,255,0.55)', fontSize: 10,
    fontWeight: '700', letterSpacing: 2,
    flex: 1,
  },
  stepsBadge: {
    color: 'rgba(255,180,180,0.7)', fontSize: 9, fontWeight: '700',
    letterSpacing: 0.5,
  },
  stepsBody: { marginTop: 10 },
  stepsNumWrap: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 },
  stepsNum: {
    color: '#fff', fontSize: 32, fontWeight: '700',
    letterSpacing: -1, lineHeight: 34,
  },
  stepsGoal: {
    color: 'rgba(255,255,255,0.4)', fontSize: 13,
    marginLeft: 6, marginBottom: 4, fontWeight: '500',
  },
  stepsBarTrack: {
    height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  stepsBarFill: {
    height: '100%', borderRadius: 3,
    backgroundColor: '#a855f7',
  },
  stepsStatsRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 12, justifyContent: 'space-around',
  },
  stepsStat: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  stepsStatText: {
    color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '600',
  },
  stepsDivider: {
    width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.1)',
  },

  // ── Emergency overlay (cleaner, classier) ────────────────────────────────
  emergRoot: { flex: 1, backgroundColor: '#0a0510' },
  emergHeader: {
    paddingHorizontal: 22, paddingBottom: 22,
  },
  emergHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 14,
  },
  emergStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#f87171' },
  emergStatusText: {
    color: '#f87171', fontSize: 11, fontWeight: '700',
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  emergTitle: {
    color: '#fff', fontSize: 32, fontWeight: '700',
    letterSpacing: -0.6, marginBottom: 6,
  },
  emergSub: {
    color: 'rgba(255,255,255,0.55)', fontSize: 13.5,
    lineHeight: 20,
  },

  // Priority hero card (Mom)
  priorityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: '#1a1025',
    borderRadius: 20,
    padding: 18,
    marginBottom: 22,
  },
  priorityIcon: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: '#dc2626',
    alignItems: 'center', justifyContent: 'center',
  },
  priorityLabel: {
    color: '#f87171', fontSize: 10.5, fontWeight: '700',
    letterSpacing: 1.4,
  },
  priorityName: {
    color: '#fff', fontSize: 19, fontWeight: '700',
    letterSpacing: -0.3, marginTop: 4,
  },
  priorityNum: {
    color: 'rgba(255,255,255,0.55)', fontSize: 12.5,
    marginTop: 2,
  },
  priorityCallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#22c55e',
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 14,
  },
  priorityCallText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Group label
  emergGroupLabel: {
    color: 'rgba(255,255,255,0.45)', fontSize: 13,
    fontWeight: '600',
    marginBottom: 10, marginLeft: 4,
  },

  // Services card (single solid surface, hairline-divided rows)
  servicesCard: {
    backgroundColor: '#181020',
    borderRadius: 18,
    overflow: 'hidden',
  },
  serviceRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  serviceRowBorder: {
    borderBottomWidth: 1, borderBottomColor: '#26192e',
  },
  serviceIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  serviceName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  serviceSub: { color: 'rgba(255,255,255,0.4)', fontSize: 11.5, marginTop: 2 },
  serviceNum: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },

  emergDismissWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 22, paddingTop: 12,
    backgroundColor: 'rgba(10,5,16,0.95)',
    borderTopWidth: 1, borderTopColor: '#26192e',
  },
  emergDismiss: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 15, borderRadius: 14, alignItems: 'center',
  },
  emergDismissText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});

// ── Results screen styles ────────────────────────────────────────────────────
const resStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f17' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingBottom: 6,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '600' },

  histRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 6, marginTop: 22,
  },
  histNum: {
    color: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: '500',
    letterSpacing: 0.4,
  },

  ecgWrap: { marginTop: 6, alignItems: 'center' },

  bpmRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    marginTop: 10,
  },
  bpmLeft: { flexDirection: 'row', alignItems: 'flex-end' },
  bpmRight: { flexDirection: 'row', gap: 14, marginBottom: 14 },
  bpmNum: { color: '#fff', fontSize: 78, fontWeight: '300', lineHeight: 80, letterSpacing: -2 },
  bpmUnit: { color: 'rgba(255,255,255,0.55)', fontSize: 18, marginLeft: 8, marginBottom: 14, fontWeight: '500' },
  bpmStat: { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
  bpmStatVal: { color: '#fff', fontSize: 14, fontWeight: '600' },

  statCard: {
    backgroundColor: '#111322',
    padding: 18, borderRadius: 18,
    marginTop: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
  },
  statCardLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },
  statCardValue: { color: '#fff', fontSize: 22, fontWeight: '600' },
  statCardUnit: { color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: '400' },

  hrvCard: {
    backgroundColor: '#111322',
    padding: 18, borderRadius: 18,
    marginTop: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
  },
  hrvHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  hrvLabels: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 4, paddingHorizontal: 2,
  },
  hrvLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },

  dualRow: { flexDirection: 'row', marginTop: 14 },
  dualCard: {
    flex: 1,
    backgroundColor: '#111322',
    padding: 16, borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
  },
  dualHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dualLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '500' },
  dualValue: { color: '#fff', fontSize: 22, fontWeight: '600', marginTop: 8 },

  backWrap: { position: 'absolute', left: 18 },
  backBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    gap: 4,
  },
  backText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
