import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Path, Circle, Line as SvgLine, Defs,
  LinearGradient as SvgLinearGradient, Stop,
} from 'react-native-svg';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/context/theme';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Risk config (mirrors home dashboard) ──────────────────────────────────────
const RISK_CONFIG: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  Low: { color: '#4ade80', bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.25)', icon: 'checkmark-circle' },
  Medium: { color: '#f5c842', bg: 'rgba(245,200,66,0.12)', border: 'rgba(245,200,66,0.25)', icon: 'warning' },
  High: { color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.25)', icon: 'alert-circle' },
  Severe: { color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.25)', icon: 'skull' },
};
const RISK_ORDER = ['Low', 'Medium', 'High', 'Severe'];

interface HistoryEntry {
  id: number;
  timestamp: string;
  spo2_pct: number;
  heart_rate: number;
  altitude: number;
  ascent_rate: number;
  hours_at_altitude: number;
  risk_level: string;
  risk_score: number;
  confidence: number;
  recommendation: string;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function StatPill({ icon, value, unit, color }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: number | string; unit: string; color: string;
}) {
  return (
    <View style={[styles.statPill, { backgroundColor: color + '15', borderColor: color + '30' }]}>
      <Ionicons name={icon} size={11} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statUnit}>{unit}</Text>
    </View>
  );
}

// ── Altitude line chart ───────────────────────────────────────────────────────
function AltitudeChart({ entries, width }: { entries: HistoryEntry[]; width: number }) {
  const H = 130, PAD_X = 14, PAD_T = 14, PAD_B = 18;
  // last up to 14 entries; oldest left → newest right
  const data = entries.slice(0, 14).reverse();

  if (data.length < 2) {
    return (
      <View style={[styles.chartEmpty, { width, height: H }]}>
        <Ionicons name="analytics-outline" size={22} color="rgba(255,255,255,0.18)" />
        <Text style={styles.chartEmptyText}>Need at least 2 readings to plot trend</Text>
      </View>
    );
  }

  const alts = data.map(d => d.altitude);
  const minA = Math.min(...alts);
  const maxA = Math.max(...alts);
  const span = Math.max(maxA - minA, 1);

  const stepX = (width - PAD_X * 2) / (data.length - 1);
  const innerH = H - PAD_T - PAD_B;
  const pts = data.map((d, i) => ({
    x: PAD_X + i * stepX,
    y: PAD_T + (1 - (d.altitude - minA) / span) * innerH,
  }));

  const smooth = pts.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx} ${prev.y} ${cx} ${p.y} ${p.x} ${p.y}`;
  }, '');
  const fill = `${smooth} L ${pts[pts.length - 1].x} ${H - PAD_B} L ${pts[0].x} ${H - PAD_B} Z`;

  return (
    <View>
      <Svg width={width} height={H}>
        <Defs>
          <SvgLinearGradient id="altFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#a855f7" stopOpacity="0.45" />
            <Stop offset="1" stopColor="#a855f7" stopOpacity="0" />
          </SvgLinearGradient>
        </Defs>

        {[0.25, 0.5, 0.75].map(p => (
          <SvgLine
            key={p}
            x1={PAD_X} y1={PAD_T + innerH * p}
            x2={width - PAD_X} y2={PAD_T + innerH * p}
            stroke="rgba(255,255,255,0.06)" strokeDasharray="3 4"
          />
        ))}

        <Path d={fill} fill="url(#altFill)" />
        <Path
          d={smooth} stroke="#a855f7" strokeWidth={2.5} fill="none"
          strokeLinecap="round" strokeLinejoin="round"
        />
        {pts.map((p, i) => (
          <Circle
            key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4 : 2.4}
            fill={i === pts.length - 1 ? '#fff' : '#c084fc'}
            stroke={i === pts.length - 1 ? '#a855f7' : 'transparent'}
            strokeWidth={i === pts.length - 1 ? 2 : 0}
          />
        ))}
      </Svg>

      {/* Y-axis labels overlaid */}
      <Text style={[styles.axisTop, { top: PAD_T - 4 }]}>{maxA.toFixed(0)} m</Text>
      <Text style={[styles.axisBottom, { bottom: 2 }]}>{minA.toFixed(0)} m</Text>
    </View>
  );
}

// ── Risk donut ────────────────────────────────────────────────────────────────
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const polar = (a: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const start = polar(startAngle);
  const end = polar(endAngle);
  const large = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

function RiskDonut({ entries }: { entries: HistoryEntry[] }) {
  const SIZE = 130, STROKE = 16;
  const cx = SIZE / 2, cy = SIZE / 2, r = (SIZE - STROKE) / 2;

  const counts = RISK_ORDER.map(k => ({
    key: k,
    count: entries.filter(e => e.risk_level === k).length,
    cfg: RISK_CONFIG[k],
  }));
  const total = counts.reduce((a, b) => a + b.count, 0) || 1;

  let cursor = 0;
  const segments = counts
    .filter(c => c.count > 0)
    .map(c => {
      const angle = (c.count / total) * 360;
      // shrink slightly so segments don't visually merge
      const start = cursor + 1;
      const end = cursor + angle - 1;
      cursor += angle;
      if (end <= start) return null;
      return { ...c, start, end };
    })
    .filter(Boolean) as { key: string; count: number; cfg: any; start: number; end: number }[];

  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={SIZE} height={SIZE}>
        <Circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={STROKE} fill="none" />
        {segments.map(s => (
          <Path
            key={s.key}
            d={describeArc(cx, cy, r, s.start, s.end)}
            stroke={s.cfg.color}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
        ))}
      </Svg>
      <View style={styles.donutCenter}>
        <Text style={styles.donutNum}>{counts.reduce((a, b) => a + b.count, 0)}</Text>
        <Text style={styles.donutLabel}>READINGS</Text>
      </View>
    </View>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { apiIp, token } = useAuth();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [fetched, setFetched] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await fetch(`http://${apiIp}:5000/history?limit=50`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.success) setEntries(data.data);
      else setError('Failed to load history.');
    } catch {
      setError('Cannot reach the server. Make sure Flask is running.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setFetched(true);
    }
  }, [apiIp, token]);

  const clearHistory = async () => {
    try {
      await fetch(`http://${apiIp}:5000/history`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setEntries([]);
    } catch {
      setError('Could not clear history.');
    }
  };

  if (!fetched && !loading) fetchHistory();

  const altChartW = SCREEN_W - 40 - 32; // page padding 20 + card padding 16
  const latestAlt = entries[0]?.altitude;
  const altDelta = entries.length >= 2 ? entries[0].altitude - entries[1].altitude : 0;
  const counts = RISK_ORDER.map(k => ({
    key: k,
    count: entries.filter(e => e.risk_level === k).length,
    cfg: RISK_CONFIG[k],
  }));

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.bg }]}>
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
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchHistory(true)}
            tintColor="#a855f7"
          />
        }
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>History</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => fetchHistory()}>
              <Ionicons name="refresh-outline" size={18} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
            {entries.length > 0 && (
              <TouchableOpacity style={[styles.iconBtn, styles.iconBtnDanger]} onPress={clearHistory}>
                <Ionicons name="trash-outline" size={17} color="#f87171" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Charts ── */}
        {entries.length > 0 && (
          <>
            {/* Altitude trend */}
            <View style={styles.chartCard}>
              <View style={styles.chartHead}>
                <View>
                  <Text style={styles.chartLabel}>Altitude Trend</Text>
                  <Text style={styles.chartTitle}>
                    {latestAlt != null ? `${latestAlt.toFixed(0)} m` : '— m'}
                  </Text>
                </View>
                {entries.length >= 2 && (
                  <View style={[
                    styles.deltaPill,
                    {
                      backgroundColor: altDelta >= 0 ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                      borderColor: altDelta >= 0 ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'
                    },
                  ]}>
                    <Ionicons
                      name={altDelta >= 0 ? 'trending-up' : 'trending-down'}
                      size={11}
                      color={altDelta >= 0 ? '#4ade80' : '#f87171'}
                    />
                    <Text style={[styles.deltaText, { color: altDelta >= 0 ? '#4ade80' : '#f87171' }]}>
                      {altDelta >= 0 ? '+' : ''}{altDelta.toFixed(0)} m
                    </Text>
                  </View>
                )}
              </View>
              <AltitudeChart entries={entries} width={altChartW} />
              <Text style={styles.chartFoot}>last {Math.min(entries.length, 14)} readings</Text>
            </View>

            {/* Risk distribution */}
            <View style={styles.chartCard}>
              <View style={styles.chartHead}>
                <View>
                  <Text style={styles.chartLabel}>Risk Distribution</Text>
                  <Text style={styles.chartTitle}>By severity</Text>
                </View>
              </View>

              <View style={styles.donutRow}>
                <RiskDonut entries={entries} />
                <View style={styles.legend}>
                  {counts.map(c => {
                    const pct = entries.length > 0 ? (c.count / entries.length) * 100 : 0;
                    return (
                      <View key={c.key} style={styles.legendRow}>
                        <View style={[styles.legendDot, { backgroundColor: c.cfg.color }]} />
                        <Text style={styles.legendKey}>{c.key}</Text>
                        <View style={styles.legendBarTrack}>
                          <View style={[styles.legendBarFill, { width: `${pct}%`, backgroundColor: c.cfg.color }]} />
                        </View>
                        <Text style={styles.legendCount}>{c.count}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Recent</Text>
          </>
        )}

        {/* ── Loading ── */}
        {loading && (
          <View style={styles.centreBox}>
            <ActivityIndicator size="large" color="#a855f7" />
            <Text style={styles.centreText}>Loading history…</Text>
          </View>
        )}

        {/* ── Error ── */}
        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={15} color="#f87171" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ── Empty state ── */}
        {!loading && fetched && entries.length === 0 && !error && (
          <View style={styles.centreBox}>
            <View style={styles.emptyIcon}>
              <Ionicons name="time-outline" size={36} color="rgba(255,255,255,0.15)" />
            </View>
            <Text style={styles.emptyTitle}>No predictions yet</Text>
            <Text style={styles.emptyBody}>Run a prediction on the Monitor tab and it will appear here.</Text>
          </View>
        )}

        {/* ── Entry cards ── */}
        {entries.map(entry => {
          const cfg = RISK_CONFIG[entry.risk_level] ?? RISK_CONFIG['Low'];
          const isOpen = expanded === entry.id;
          return (
            <TouchableOpacity
              key={entry.id}
              style={[styles.entryCard, { borderColor: isOpen ? cfg.border : 'rgba(255,255,255,0.08)' }]}
              onPress={() => setExpanded(isOpen ? null : entry.id)}
              activeOpacity={0.88}
            >
              {/* Top row */}
              <View style={styles.entryTop}>
                <View style={[styles.riskBadge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                  <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
                  <Text style={[styles.riskBadgeText, { color: cfg.color }]}>{entry.risk_level.toUpperCase()}</Text>
                </View>
                <View style={styles.entryTopRight}>
                  <Text style={styles.confText}>{entry.confidence.toFixed(0)}%</Text>
                  <Text style={styles.timeText}>{formatTime(entry.timestamp)}</Text>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={15}
                    color="rgba(255,255,255,0.25)"
                  />
                </View>
              </View>

              {/* Stat pills row */}
              <View style={styles.pillRow}>
                <StatPill icon="water-outline" value={entry.spo2_pct} unit="%" color="#60a5fa" />
                <StatPill icon="heart-outline" value={entry.heart_rate} unit="bpm" color="#f87171" />
                <StatPill icon="trending-up-outline" value={entry.altitude} unit="m" color="#a855f7" />
                <StatPill icon="speedometer-outline" value={entry.ascent_rate} unit="m/h" color="#a78bfa" />
              </View>

              {/* Expanded recommendation */}
              {isOpen && (
                <View style={styles.expandedSection}>
                  <View style={styles.expandedDivider} />
                  <View style={styles.expandedRow}>
                    <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.25)" />
                    <Text style={styles.expandedMeta}>
                      {entry.hours_at_altitude}h at altitude  ·  Ascent {entry.ascent_rate} m/hr
                    </Text>
                  </View>
                  <View style={styles.expandedRow}>
                    <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.25)" />
                    <Text style={styles.expandedMeta}>
                      {new Date(entry.timestamp).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <View style={[styles.recBox, { borderLeftColor: cfg.color }]}>
                    <Text style={styles.recText}>{entry.recommendation}</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ── Solid-surface palette (no glass) ─────────────────────────────────────────
const BG_BASE = '#0a0510';
const SURFACE = '#181020';
const HAIRLINE = '#26192e';
const TEXT_PRIMARY = '#f5f1f8';
const TEXT_SECONDARY = '#9c8eaa';
const TEXT_MUTED = '#6e6379';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG_BASE },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 18, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: TEXT_MUTED, marginTop: 4 },
  headerActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 12, backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center'
  },
  iconBtnDanger: { backgroundColor: 'rgba(248,113,113,0.08)' },

  // Chart cards (solid surface)
  chartCard: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  chartHead: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginBottom: 10,
  },
  chartLabel: { fontSize: 12, color: TEXT_MUTED, fontWeight: '600' },
  chartTitle: { fontSize: 22, color: TEXT_PRIMARY, fontWeight: '800', marginTop: 2, letterSpacing: -0.4 },
  chartFoot: { marginTop: 8, fontSize: 11, color: TEXT_MUTED, fontWeight: '500' },
  chartEmpty: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  chartEmptyText: { color: TEXT_MUTED, fontSize: 12 },

  axisTop: { position: 'absolute', right: 4, fontSize: 10, color: TEXT_MUTED, fontWeight: '600' },
  axisBottom: { position: 'absolute', right: 4, fontSize: 10, color: TEXT_MUTED, fontWeight: '600' },

  deltaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99
  },
  deltaText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },

  // Donut + legend
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  donutCenter: { position: 'absolute', alignItems: 'center' },
  donutNum: { color: TEXT_PRIMARY, fontSize: 22, fontWeight: '800' },
  donutLabel: { color: TEXT_MUTED, fontSize: 9.5, fontWeight: '700', marginTop: 1 },
  legend: { flex: 1, gap: 9 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendKey: { color: TEXT_SECONDARY, fontSize: 12, fontWeight: '600', width: 56 },
  legendBarTrack: {
    flex: 1, height: 5, borderRadius: 3,
    backgroundColor: HAIRLINE, overflow: 'hidden',
  },
  legendBarFill: { height: '100%', borderRadius: 3 },
  legendCount: { color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700', minWidth: 18, textAlign: 'right' },

  // Section label — sentence case, no shouty caps
  sectionLabel: {
    fontSize: 13, color: TEXT_MUTED, fontWeight: '600',
    marginTop: 18, marginBottom: 10, marginLeft: 4,
  },

  // States
  centreBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  centreText: { color: TEXT_MUTED, fontSize: 14 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 24, backgroundColor: SURFACE,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: TEXT_SECONDARY },
  emptyBody: { fontSize: 13, color: TEXT_MUTED, textAlign: 'center', lineHeight: 20, maxWidth: 260 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(248,113,113,0.1)', borderRadius: 12,
    padding: 14, marginBottom: 16
  },
  errorText: { color: '#f87171', fontSize: 13, flex: 1 },

  // Entry card (solid)
  entryCard: {
    backgroundColor: SURFACE, borderRadius: 16,
    borderWidth: 1, padding: 16, marginBottom: 10
  },
  entryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  entryTopRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  riskBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20
  },
  riskBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  confText: { fontSize: 12, fontWeight: '600', color: TEXT_SECONDARY },
  timeText: { fontSize: 12, color: TEXT_MUTED },

  // Stat pills
  pillRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  statPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10
  },
  statValue: { fontSize: 12, fontWeight: '700' },
  statUnit: { fontSize: 10, color: TEXT_MUTED, fontWeight: '500' },

  // Expanded
  expandedSection: { marginTop: 14 },
  expandedDivider: { height: 1, backgroundColor: HAIRLINE, marginBottom: 12 },
  expandedRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  expandedMeta: { fontSize: 12, color: TEXT_MUTED },
  recBox: { borderLeftWidth: 3, paddingLeft: 12, marginTop: 6 },
  recText: { fontSize: 13, color: TEXT_SECONDARY, lineHeight: 21 },
});
