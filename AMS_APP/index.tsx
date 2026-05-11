import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/context/theme';

// ── Risk metadata ────────────────────────────────────────────────────────────
type RiskLevel = 'Low' | 'Medium' | 'High' | 'Severe';

const RISK_META: Record<RiskLevel, {
  color: string; iconBg: string; icon: keyof typeof Ionicons.glyphMap; label: string;
}> = {
  Low: { color: '#16a34a', iconBg: '#bbf7d0', icon: 'checkmark-circle', label: 'Low Risk' },
  Medium: { color: '#ca8a04', iconBg: '#fde68a', icon: 'alert-circle', label: 'Medium Risk' },
  High: { color: '#ea580c', iconBg: '#fed7aa', icon: 'warning', label: 'High Risk' },
  Severe: { color: '#dc2626', iconBg: '#fecaca', icon: 'alert', label: 'Severe Risk' },
};

const RULE_RECOMMENDATIONS: Record<RiskLevel, string> = {
  Low: 'All vitals look healthy. Continue your trek at the current pace, stay hydrated, and enjoy the ascent.',
  Medium: 'Some early warning signs detected. Slow your ascent rate, take longer rest breaks, and avoid further altitude gain for the next few hours.',
  High: 'High risk of altitude sickness. Stop ascending immediately. Rest at your current altitude or descend by 300–500 m. Monitor symptoms closely.',
  Severe: 'Severe altitude sickness risk. Descend immediately to a lower elevation. If symptoms include confusion, severe shortness of breath, or chest pain, seek emergency help now.',
};

// ── Single input field ───────────────────────────────────────────────────────
function Field({
  label, value, onChange, unit, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.fieldRow, focused && styles.fieldRowFocused]}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.25)"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          selectionColor="#a855f7"
        />
        {unit && <Text style={styles.fieldUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

// ── Risk popup modal ─────────────────────────────────────────────────────────
function RiskModal({
  visible, onClose, risk, recommendation, mode, confidence,
}: {
  visible: boolean;
  onClose: () => void;
  risk: RiskLevel | null;
  recommendation: string;
  mode: 'rule' | 'ai' | null;
  confidence: number | null;
}) {
  if (!risk) return null;
  const meta = RISK_META[risk];

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.card}>
          {/* Close X */}
          <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={20} color="#6b7280" />
          </TouchableOpacity>


          {/* Big icon */}
          <View style={[modalStyles.iconWrap, { backgroundColor: meta.iconBg }]}>
            <Ionicons name={meta.icon} size={42} color={meta.color} />
          </View>

          {/* Risk title */}
          <Text style={[modalStyles.riskLabel, { color: meta.color }]}>{meta.label}</Text>
          {mode === 'ai' && confidence !== null && (
            <Text style={modalStyles.confidence}>Model confidence: {confidence.toFixed(1)}%</Text>
          )}

          <View style={modalStyles.divider} />

          {/* Recommendation */}
          <Text style={modalStyles.recHeading}>RECOMMENDATION</Text>
          <Text style={modalStyles.recText}>{recommendation}</Text>

          {/* Got it button */}
          <TouchableOpacity onPress={onClose} style={modalStyles.okBtn} activeOpacity={0.85}>
            <LinearGradient
              colors={['#28114f', '#7051a4']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={modalStyles.okBtnGrad}
            >
              <Text style={modalStyles.okBtnText}>GOT IT</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { apiIp } = useAuth();

  const [spo2, setSpo2] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [altitude, setAltitude] = useState('');
  const [ascentRate, setAscentRate] = useState('');
  const [hours, setHours] = useState('');

  const [loading, setLoading] = useState<'rule' | 'ai' | null>(null);
  const [resultRisk, setResultRisk] = useState<RiskLevel | null>(null);
  const [resultMode, setResultMode] = useState<'rule' | 'ai' | null>(null);
  const [resultRec, setResultRec] = useState('');
  const [resultConf, setResultConf] = useState<number | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [hint, setHint] = useState('Enter your vitals.');

  const [connected, setConnected] = useState(false);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`http://${apiIp}:5000/health`);
      setConnected(res.ok);
    } catch {
      setConnected(false);
    }
  }, [apiIp]);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  const allFilled = spo2 && heartRate && altitude && ascentRate && hours;

  const handleCalculate = async (mode: 'rule' | 'ai') => {
    if (!allFilled) {
      setHint('Please fill in all five fields first.');
      return;
    }

    const sp = parseFloat(spo2);
    const hr = parseFloat(heartRate);
    const al = parseFloat(altitude);
    const ar = parseFloat(ascentRate);
    const ho = parseFloat(hours);
    if (sp < 50 || sp > 100) { setHint('SpO₂ must be between 50 and 100 %.'); return; }
    if (hr < 30 || hr > 220) { setHint('Heart rate must be between 30 and 220 bpm.'); return; }
    if (al < 0 || al > 9000) { setHint('Altitude must be between 0 and 9000 m.'); return; }

    setLoading(mode);
    setHint('');
    try {
      const res = await fetch(`http://${apiIp}:5000/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spo2_pct: sp,
          heart_rate: hr,
          altitude: al,
          ascent_rate: ar,
          hours_at_altitude: ho,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Prediction failed');

      const risk: RiskLevel = mode === 'ai'
        ? (data.prediction?.risk_level as RiskLevel)
        : (data.rule_based as RiskLevel);

      const rec = mode === 'ai'
        ? (data.recommendation ?? RULE_RECOMMENDATIONS[risk])
        : RULE_RECOMMENDATIONS[risk];

      const conf = mode === 'ai' ? (data.prediction?.confidence ?? null) : null;

      setResultRisk(risk);
      setResultMode(mode);
      setResultRec(rec);
      setResultConf(conf);
      setModalVisible(true);
      setConnected(true);
      setHint(`${RISK_META[risk].label} — tap result to view details again.`);
    } catch (err: any) {
      setConnected(false);
      setHint(err.message ?? 'Cannot reach server. Check API IP below.');
    } finally {
      setLoading(null);
    }
  };

  const reopenResult = () => { if (resultRisk) setModalVisible(true); };
  const resultColor = resultRisk ? RISK_META[resultRisk].color : '#fff';
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <LinearGradient
        colors={isDark
          ? ['#1a1025', '#120a1f', '#0a0510']
          : ['#1e88e5', '#2196f3', '#42a5f5', '#64b5f6']}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ── */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>MONITOR</Text>
            </View>
          </View>

          {/* ── Result preview ── */}
          <TouchableOpacity onPress={reopenResult} activeOpacity={resultRisk ? 0.85 : 1} style={styles.resultBlock}>
            <Text style={styles.resultLabel}>YOUR RESULT</Text>
            <View style={styles.resultRow}>
              <Text style={[styles.resultBig, { color: resultColor }]}>
                {resultRisk ?? '—'}
              </Text>
              <Ionicons
                name="help-circle-outline"
                size={16}
                color="rgba(255,255,255,0.35)"
                style={{ marginLeft: 10, marginTop: 18 }}
              />
            </View>
            <Text style={styles.resultHint}>{hint}</Text>
          </TouchableOpacity>

          {/* ── Form ── */}
          <View style={styles.form}>
            <View style={styles.row}>
              <Field label="SpO₂" value={spo2} onChange={setSpo2} unit="%" placeholder="98" />
              <Field label="Heart Rate" value={heartRate} onChange={setHeartRate} unit="bpm" placeholder="76" />
            </View>
            <View style={styles.row}>
              <Field label="Altitude" value={altitude} onChange={setAltitude} unit="m" placeholder="3500" />
              <Field label="Ascent Rate" value={ascentRate} onChange={setAscentRate} unit="m/h" placeholder="200" />
            </View>
            <View style={styles.row}>
              <Field label="Hours at Altitude" value={hours} onChange={setHours} unit="hrs" placeholder="4" />
              <View style={{ flex: 1 }} />
            </View>
          </View>

          {/* ── Buttons ── */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btnSecondary, loading === 'rule' && { opacity: 0.6 }]}
              activeOpacity={0.85}
              onPress={() => handleCalculate('rule')}
              disabled={loading !== null}
            >
              {loading === 'rule'
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnSecondaryText}>CALCULATE</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => handleCalculate('ai')}
              disabled={loading !== null}
              style={[{ flex: 1.15 }, loading === 'ai' && { opacity: 0.6 }]}
            >
              <LinearGradient
                colors={['#28114f', '#7051a4']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.btnPrimary}
              >
                {loading === 'ai' ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={14} color="#fff" />
                    <Text style={styles.btnPrimaryText}>CALCULATE WITH AI</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      <RiskModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        risk={resultRisk}
        recommendation={resultRec}
        mode={resultMode}
        confidence={resultConf}
      />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 26, paddingBottom: 60 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 3.5,
  },

  // Result block
  resultBlock: { marginTop: -10 },
  resultLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11, fontWeight: '700', letterSpacing: 2.8,
  },
  resultRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 10 },
  resultBig: {
    fontSize: 76, fontWeight: '800',
    letterSpacing: -2.5, lineHeight: 78,
  },
  resultHint: {
    color: 'rgba(255,255,255,0.5)', fontSize: 12,
    marginTop: 14, lineHeight: 18, maxWidth: 290,
    fontWeight: '500', letterSpacing: 0.3,
  },

  // Form
  form: { marginTop: 38 },
  row: { flexDirection: 'row', gap: 28, marginBottom: 26 },
  field: { flex: 1 },
  fieldLabel: {
    color: '#fff', fontSize: 12, fontWeight: '700',
    letterSpacing: 0.7, marginBottom: 6,
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.32)',
    paddingBottom: 4,
  },
  fieldRowFocused: { borderBottomColor: '#a855f7' },
  fieldInput: {
    flex: 1, color: '#fff', fontSize: 16, fontWeight: '600',
    paddingVertical: 4, padding: 0,
  },
  fieldUnit: {
    color: 'rgba(255,255,255,0.55)', fontSize: 12,
    marginLeft: 6, marginBottom: 4,
  },

  // Buttons
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 28 },
  btnSecondary: {
    flex: 1,
    height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)',
  },
  btnSecondaryText: {
    color: '#fff', fontWeight: '800', letterSpacing: 1.5, fontSize: 12,
  },
  btnPrimary: {
    height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6,
    shadowColor: '#28114f', shadowOpacity: 0.4,
    shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  btnPrimaryText: {
    color: '#fff', fontWeight: '800', letterSpacing: 1.3, fontSize: 12,
  },

});

// ── Modal styles ─────────────────────────────────────────────────────────────
const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(5,2,12,0.78)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
  },
  card: {
    width: '100%', maxWidth: 360,
    backgroundColor: '#fff', borderRadius: 28,
    paddingHorizontal: 26, paddingTop: 26, paddingBottom: 22,
    alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.35,
    shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 20,
  },
  closeBtn: {
    position: 'absolute', top: 14, right: 14,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#f3f4f6',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },
  modeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#f3eaff',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12,
    marginTop: 4, marginBottom: 12,
  },
  modeChipText: {
    color: '#7051a4', fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
  },
  iconWrap: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  riskLabel: {
    fontSize: 24, fontWeight: '800', letterSpacing: -0.5,
  },
  confidence: {
    color: '#6b7280', fontSize: 12, fontWeight: '600',
    marginTop: 4,
  },
  divider: {
    width: '100%', height: 1, backgroundColor: '#e5e7eb',
    marginVertical: 30,
  },
  recHeading: {
    color: '#0f0f17', fontSize: 15, fontWeight: '800', fontFamily: 'ArialRoundedMTBold',
    letterSpacing: 1.5, alignSelf: 'flex-start', marginBottom: 8,
  },
  recText: {
    color: '#374151', fontSize: 14, lineHeight: 22,
    textAlign: 'left', alignSelf: 'flex-start',
  },
  okBtn: { width: '100%', marginTop: 20 },
  okBtnGrad: {
    height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  okBtnText: {
    color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 1.5,
  },
});
