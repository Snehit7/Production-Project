import { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Modal,
  Dimensions, FlatList, Animated, PanResponder, ScrollView,
  StatusBar, ActivityIndicator, Linking, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/theme';

const { width: W, height: H } = Dimensions.get('window');

// ── Bottom sheet constants ────────────────────────────────────────────────────
const SHEET_H = H * 0.93;
const SNAP_FULL = 0;                    // card fully expanded
const SNAP_HALF = Math.round(H * 0.46); // card at half — hero is dominant
const SNAP_CLOSE = H + 50;
const HERO_H = Math.round(H * 0.62); // big background hero image

// ── Card dimensions ───────────────────────────────────────────────────────────
const CARD_H = Math.min(H * 0.66, 510);
const IMG_H = Math.round(CARD_H * 0.44);

// ── Colour maps ───────────────────────────────────────────────────────────────
const DIFF_COLOR: Record<string, string> = {
  Easy: '#4ade80', Moderate: '#f5c842', Hard: '#f87171',
};
const AMS_COLOR: Record<string, string> = {
  None: '#2e7d32', Low: '#2e7d32', Moderate: '#f9a825',
  High: '#e65100', 'Very High': '#b71c1c',
};

// ── Weather helper ────────────────────────────────────────────────────────────
function weatherIcon(code: number): React.ComponentProps<typeof Ionicons>['name'] {
  if (code === 113) return 'sunny-outline';
  if (code <= 116) return 'partly-sunny-outline';
  if (code <= 143) return 'cloudy-outline';
  if (code <= 320) return 'rainy-outline';
  if (code <= 377) return 'snow-outline';
  return 'thunderstorm-outline';
}

// ── Maps helper ───────────────────────────────────────────────────────────────
function openInMaps(name: string, lat: number, lon: number) {
  const label = encodeURIComponent(name);
  const url = Platform.OS === 'ios'
    ? `maps://?q=${label}&ll=${lat},${lon}`
    : `geo:${lat},${lon}?q=${label}`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${lat},${lon}`));
}

// ── Trek data type ────────────────────────────────────────────────────────────
type Trek = {
  id: string; name: string; region: string; tagline: string;
  weatherQuery: string;
  duration: string; distance: string; maxAltitude: string;
  difficulty: string; cost: string; season: string;
  monitoringNote: string;
  startPoint: string; description: string;
  cover: any; gallery: any[];
  category: 'trek' | 'hike';
  emergencyFacilities?: { name: string; address: string; phone: string; lat: number; lon: number }[];
};

// ── Trek data ─────────────────────────────────────────────────────────────────
const TREKS: Trek[] = [
  {
    id: 'ebc', name: 'Everest Base Camp', region: 'Solukhumbu, Nepal',
    tagline: 'The Ultimate Himalayan Challenge',
    weatherQuery: 'Namche+Bazaar+Nepal',
    duration: '12–14 days', distance: '130 km', maxAltitude: '5,364 m',
    difficulty: 'Hard', cost: '$1,200–$2,500', season: 'Mar–May, Oct–Nov',
    monitoringNote: 'Continuous monitoring is critical above Namche Bazaar (3,440 m). Spend at least two acclimatization nights before ascending. Descend immediately if severe symptoms develop.',
    startPoint: 'Lukla (fly from Kathmandu)',
    description: "Beginning with a dramatic flight into Lukla airport at 2,860 m, this legendary trail winds through ancient Sherpa villages, Buddhist monasteries, and rhododendron forests. The route passes the bustling trading hub of Namche Bazaar, the sacred Tengboche Monastery, and stark moraines before arriving at the foot of the world's highest mountain.",
    cover: require('@/assets/trek/ebc_cover.jpg'),
    gallery: [require('@/assets/trek/ebc_3.jpg'), require('@/assets/trek/ebc_2.jpg'), require('@/assets/trek/ebc_1.jpg'), require('@/assets/trek/ebc_4.jpg')],
    category: 'trek',
    emergencyFacilities: [
      { name: 'HRA Pheriche Aid Post', address: 'Pheriche (4,371 m)', phone: '+977-38-540022', lat: 27.8934, lon: 86.8190 },
      { name: 'Khunde Hospital', address: 'Khunde (3,840 m)', phone: '+977-38-540050', lat: 27.8197, lon: 86.7139 },
      { name: 'Namche Bazaar Clinic', address: 'Namche Bazaar (3,440 m)', phone: '+977-38-540110', lat: 27.8069, lon: 86.7143 },
      { name: 'Lukla Health Post', address: 'Lukla (2,860 m)', phone: '+977-38-540007', lat: 27.6867, lon: 86.7294 },
    ],
  },
  {
    id: 'circuit', name: 'Annapurna Circuit', region: 'Manang / Mustang, Nepal',
    tagline: 'A Complete Mountaineering Experience',
    weatherQuery: 'Manang+Nepal',
    duration: '15–20 days', distance: '160–230 km', maxAltitude: '5,416 m',
    difficulty: 'Hard', cost: '$800–$1,800', season: 'Mar–May, Oct–Nov',
    monitoringNote: 'Monitoring is essential from Chame (2,710 m) onwards. Allow at least two rest days in Manang before attempting Thorong La Pass. Never cross the pass if you feel unwell.',
    startPoint: 'Besisahar (bus from Kathmandu)',
    description: "One of the world's great long-distance treks, the Annapurna Circuit is a masterclass in landscape diversity. Starting in subtropical rice paddies, the route climbs through oak and rhododendron forests, passes medieval Gurung and Manangi villages, and crosses into the high-altitude rain shadow of the Mustang plateau before cresting Thorong La at 5,416 m.",
    cover: require('@/assets/trek/circuit_cover.jpg'),
    gallery: [require('@/assets/trek/circuit_1.jpg'), require('@/assets/trek/circuit_2.jpg'), require('@/assets/trek/circuit_3.jpg'), require('@/assets/trek/circuit_4.jpg')],
    category: 'trek',
    emergencyFacilities: [
      { name: 'HRA Manang Aid Post', address: 'Manang (3,519 m)', phone: '+977-66-440052', lat: 28.6667, lon: 84.0167 },
      { name: 'Chame Health Post', address: 'Chame (2,710 m)', phone: '+977-66-440031', lat: 28.5575, lon: 84.2400 },
      { name: 'Muktinath Health Post', address: 'Muktinath (3,800 m)', phone: '+977-69-440045', lat: 28.8167, lon: 83.8667 },
      { name: 'Jomsom Hospital', address: 'Jomsom (2,720 m)', phone: '+977-69-440021', lat: 28.7792, lon: 83.7278 },
    ],
  },
  {
    id: 'abc', name: 'Annapurna Base Camp', region: 'Kaski / Myagdi, Nepal',
    tagline: 'Into the Annapurna Sanctuary',
    weatherQuery: 'Chomrong+Nepal',
    duration: '7–10 days', distance: '110 km', maxAltitude: '4,130 m',
    difficulty: 'Moderate', cost: '$600–$1,200', season: 'Mar–May, Oct–Nov',
    monitoringNote: 'Monitor for AMS symptoms from Deurali (3,230 m) upwards. The enclosed sanctuary traps altitude quickly — descend to Bamboo or Chomrong if symptoms appear.',
    startPoint: 'Nayapul (bus from Pokhara)',
    description: 'The Annapurna Sanctuary is a high glacial amphitheatre completely encircled by thirteen peaks over 7,000 m. The trail leads through terraced Gurung villages, lush bamboo forests, and waterfalls before opening into a vast snowfield ringed by the south face of Annapurna I (8,091 m).',
    cover: require('@/assets/trek/abc_cover.jpg'),
    gallery: [require('@/assets/trek/abc_1.jpg'), require('@/assets/trek/abc_2.jpg'), require('@/assets/trek/abc_3.jpg'), require('@/assets/trek/abc_4.jpg')],
    category: 'trek',
    emergencyFacilities: [
      { name: 'Chomrong Health Post', address: 'Chomrong (2,170 m)', phone: '+977-61-690011', lat: 28.4000, lon: 83.8167 },
      { name: 'Ghandruk Health Post', address: 'Ghandruk (1,940 m)', phone: '+977-61-690020', lat: 28.3792, lon: 83.8083 },
      { name: 'Pokhara Regional Hospital', address: 'Pokhara (820 m)', phone: '+977-61-520066', lat: 28.2096, lon: 83.9856 },
    ],
  },
  {
    id: 'langtang', name: 'Langtang Valley', region: 'Rasuwa, Nepal',
    tagline: 'The Valley of Glaciers',
    weatherQuery: 'Syabrubesi+Nepal',
    duration: '7–10 days', distance: '65 km', maxAltitude: '3,870 m',
    difficulty: 'Moderate', cost: '$500–$1,000', season: 'Mar–May, Oct–Nov',
    monitoringNote: "AMS risk is moderate; monitor from Langtang Village (3,430 m). Allow a rest day before ascending to Kyanjin Gompa. The valley's relative accessibility makes quick descent easy if needed.",
    startPoint: 'Syabrubesi (bus from Kathmandu)',
    description: 'Just 130 km north of Kathmandu, Langtang feels a world away. The trail follows the roaring Langtang Khola through dense forests home to red pandas and langur monkeys, past colourful prayer flags and mani walls, opening onto wide yak pastures beneath Langtang Lirung (7,227 m).',
    cover: require('@/assets/trek/langtang_cover.jpg'),
    gallery: [require('@/assets/trek/langtang_1.jpg'), require('@/assets/trek/langtang_2.jpg'), require('@/assets/trek/langtang_3.jpg'), require('@/assets/trek/langtang_4.jpg')],
    category: 'trek',
    emergencyFacilities: [
      { name: 'Kyanjin Health Post', address: 'Kyanjin Gompa (3,870 m)', phone: '+977-10-540012', lat: 28.2122, lon: 85.5633 },
      { name: 'Langtang Health Post', address: 'Langtang Village (3,430 m)', phone: '+977-10-540018', lat: 28.2089, lon: 85.5222 },
      { name: 'Syabrubesi Health Post', address: 'Syabrubesi (1,460 m)', phone: '+977-10-540025', lat: 28.1583, lon: 85.3417 },
    ],
  },
  {
    id: 'poonhill', name: 'Ghorepani Poon Hill', region: 'Kaski, Nepal',
    tagline: 'Best Sunrise View in Nepal',
    weatherQuery: 'Ghorepani+Nepal',
    duration: '4–5 days', distance: '45 km', maxAltitude: '3,210 m',
    difficulty: 'Easy', cost: '$400–$800', season: 'Year-round (except monsoon)',
    monitoringNote: 'AMS risk is low on this route. Mild headaches are possible above 3,000 m — stay hydrated and ascend gradually.',
    startPoint: 'Nayapul (bus from Pokhara)',
    description: "At 4:30 AM, trekkers climb by torchlight from Ghorepani to catch one of earth's most spectacular sunrises — a 180-degree panorama of the Annapurna and Dhaulagiri ranges lit gold against a pink sky.",
    cover: require('@/assets/trek/poonhill_cover.jpg'),
    gallery: [require('@/assets/trek/poonhill_1.jpg'), require('@/assets/trek/poonhill_2.jpg'), require('@/assets/trek/poonhill_3.jpg'), require('@/assets/trek/poonhill_4.jpg')],
    category: 'trek',
    emergencyFacilities: [
      { name: 'Ghorepani Health Post', address: 'Ghorepani (2,860 m)', phone: '+977-61-440031', lat: 28.4000, lon: 83.6917 },
      { name: 'Pokhara Regional Hospital', address: 'Pokhara (820 m)', phone: '+977-61-520066', lat: 28.2096, lon: 83.9856 },
    ],
  },
  {
    id: 'gosaikunda', name: 'Gosaikunda', region: 'Rasuwa, Nepal',
    tagline: 'Sacred Alpine Lakes Trek',
    weatherQuery: 'Dhunche+Nepal',
    duration: '4–7 days', distance: '55 km', maxAltitude: '4,380 m',
    difficulty: 'Moderate', cost: '$400–$900', season: 'Mar–May, Oct–Nov',
    monitoringNote: 'The rapid altitude gain to 4,380 m over 2–3 days makes AMS monitoring important. Watch closely from Laurebina (3,900 m). Take your own pace — pilgrims often rush during Janai Purnima.',
    startPoint: 'Dhunche (bus from Kathmandu)',
    description: 'High in Langtang National Park, a chain of sacred turquoise lakes sits frozen for much of the year at 4,380 m. Holy to both Hindus and Buddhists, the trail offers stunning ridge walking with views of Ganesh Himal and Langtang Lirung.',
    cover: require('@/assets/trek/gosaikunda_cover.jpg'),
    gallery: [require('@/assets/trek/gosaikunda_1.jpg'), require('@/assets/trek/gosaikunda_2.jpg'), require('@/assets/trek/gosaikunda_3.jpg'), require('@/assets/trek/gosaikunda_4.jpg')],
    category: 'trek',
    emergencyFacilities: [
      { name: 'Laurebina Health Post', address: 'Laurebina (3,900 m)', phone: '+977-10-540055', lat: 28.0833, lon: 85.4167 },
      { name: 'Sing Gompa Clinic', address: 'Sing Gompa (3,330 m)', phone: '+977-10-540062', lat: 28.0583, lon: 85.3917 },
      { name: 'Dhunche Hospital', address: 'Dhunche (1,950 m)', phone: '+977-10-540050', lat: 28.1000, lon: 85.3000 },
    ],
  },
];

const HIKES: Trek[] = [
  {
    id: 'champadevi', name: 'Champa Devi Hill', region: 'Lalitpur, Kathmandu Valley',
    tagline: "",
    weatherQuery: 'Pharping+Nepal',
    duration: '4–5 hours', distance: '10 km', maxAltitude: '2,278 m',
    difficulty: 'Easy', cost: 'Free–$20', season: 'Oct–Apr',
    monitoringNote: 'No AMS risk on this hike. The maximum altitude of 2,278 m is well below the threshold where altitude sickness becomes a concern.',
    startPoint: 'Pharping village (30 min from Kathmandu)',
    description: "A peaceful escape from city traffic, Champa Devi Hill rises above Pharping on the southern rim of the Kathmandu Valley. The forested trail climbs through pine and rhododendron to a hilltop shrine with panoramic views across the entire valley.",
    cover: require('@/assets/hike/champadevi_cover.jpg'),
    gallery: [require('@/assets/hike/champadevi_1.jpg'), require('@/assets/hike/champadevi_2.jpeg'), require('@/assets/hike/champadevi_3.jpg'), require('@/assets/hike/champadevi_cover.jpg')],
    category: 'hike',
  },
  {
    id: 'nagarjun', name: 'Nagarjun Forest', region: 'Kathmandu Valley',
    tagline: '',
    weatherQuery: 'Kathmandu+Nepal',
    duration: '3–4 hours', distance: '8 km', maxAltitude: '2,096 m',
    difficulty: 'Easy', cost: 'Free–$10', season: 'Year-round',
    monitoringNote: 'No AMS risk. Suitable for all ages and fitness levels including beginners and families.',
    startPoint: 'Balaju Gate, Kathmandu (20 min from city centre)',
    description: "Located on the northwestern edge of Kathmandu, Nagarjun Forest Reserve is one of the most accessible nature escapes in Nepal, home to leopards, deer, and over 300 bird species.",
    cover: require('@/assets/hike/nagarjun_cover.jpg'),
    gallery: [require('@/assets/hike/nagarjun_1.jpg'), require('@/assets/hike/nagarjun_2.jpg'), require('@/assets/hike/nagarjun_3.jpeg'), require('@/assets/hike/nagarjun_cover.jpg')],
    category: 'hike',
  },
  {
    id: 'shivapuri', name: 'Shivapuri Peak', region: 'Shivapuri Nagarjuna NP, Kathmandu',
    tagline: '',
    weatherQuery: 'Kathmandu+Nepal',
    duration: '5–7 hours', distance: '14 km', maxAltitude: '2,732 m',
    difficulty: 'Moderate', cost: '$10–$30', season: 'Oct–May',
    monitoringNote: 'No AMS risk at 2,732 m. Mild headache is possible — stay hydrated. No specialist monitoring needed.',
    startPoint: 'Budhanilkantha Gate (30 min from Kathmandu)',
    description: 'Shivapuri sits at the northern edge of the Kathmandu Valley offering the highest summit accessible as a day hike from the city. The trail climbs through pristine forested ridgelines to sweeping views across the valley to Ganesh Himal and Langtang.',
    cover: require('@/assets/hike/shivapuri_cover.jpeg'),
    gallery: [require('@/assets/hike/shivapuri_1.jpg'), require('@/assets/hike/shivapuri_2.jpg'), require('@/assets/hike/shivapuri_3.jpg'), require('@/assets/hike/shivapuri_cover.jpeg')],
    category: 'hike',
  },
  {
    id: 'nagarkot', name: 'Nagarkot Sunrise', region: 'Bhaktapur, Kathmandu Valley',
    tagline: '',
    weatherQuery: 'Nagarkot+Nepal',
    duration: 'Full day / overnight', distance: '12 km', maxAltitude: '2,175 m',
    difficulty: 'Easy', cost: '$20–$100', season: 'Oct–Mar',
    monitoringNote: 'No AMS risk. The main consideration is weather — visit Oct to March for the best mountain visibility.',
    startPoint: 'Bhaktapur (30 min bus from Kathmandu)',
    description: 'Perched on the eastern rim of the Kathmandu Valley, Nagarkot offers one of the most celebrated Himalayan sunrise views accessible from the city — a sweeping panorama from Dhaulagiri in the west to Kanchenjunga in the east.',
    cover: require('@/assets/hike/nagarkot_cover.webp'),
    gallery: [require('@/assets/hike/nagarkot_1.jpg'), require('@/assets/hike/nagarkot_2.jpg'), require('@/assets/hike/nagarkot_3.webp'), require('@/assets/hike/nagarkot_cover.webp')],
    category: 'hike',
  },
];

// ── Animated child (staggered fade-up) ───────────────────────────────────────
function AnimChild({
  isActive, delay, children, style,
}: {
  isActive: boolean; delay: number;
  children: React.ReactNode; style?: object;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(22)).current;

  useEffect(() => {
    if (isActive) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 420, delay, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 420, delay, useNativeDriver: true }),
      ]).start();
    } else {
      opacity.setValue(0);
      translateY.setValue(22);
    }
  }, [isActive]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

// ── Trek card (blog-slider style) ─────────────────────────────────────────────
function TrekCard({
  trek, isActive, onExplore,
}: {
  trek: Trek; isActive: boolean; onExplore: (t: Trek) => void;
}) {
  const diffColor = DIFF_COLOR[trek.difficulty] ?? '#888';

  return (
    <View style={card.outer}>
      <View style={card.box}>

        {/* ── Cover image ── */}
        <View style={card.imgWrap}>
          {/* purple gradient base (shows while image loads) */}
          <LinearGradient
            colors={['#5b3aa8', '#2a1b6e']}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Image source={trek.cover} style={card.img} resizeMode="cover" />
          {/* colour scrim */}
          <LinearGradient
            colors={['rgba(91,58,168,0.30)', 'rgba(20,9,48,0.55)']}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* difficulty + AMS badges */}
          <View style={card.badgeRow}>
            <View style={[card.badge, { backgroundColor: diffColor + '28', borderColor: diffColor + '66' }]}>
            </View>
          </View>
        </View>

        {/* ── Content ── */}
        <View style={card.content}>
          {/* region  ↔  "date" in blog-slider */}
          <AnimChild isActive={isActive} delay={300}>
            <View style={card.regionRow}>
              <Ionicons name="location-sharp" size={11} color="#7b7992" />
              <Text style={card.region}>{trek.region}</Text>
            </View>
          </AnimChild>

          {/* trek name  ↔  "title" */}
          <AnimChild isActive={isActive} delay={400}>
            <Text style={card.name}>{trek.name}</Text>
          </AnimChild>

          {/* tagline  ↔  "text" */}
          <AnimChild isActive={isActive} delay={500} style={{ flex: 1 }}>
            <Text style={card.tagline} numberOfLines={3}>{trek.tagline}</Text>
          </AnimChild>

          {/* button  ↔  "READ MORE" */}
          <AnimChild isActive={isActive} delay={620}>
            <TouchableOpacity activeOpacity={0.85} onPress={() => onExplore(trek)}>
              <LinearGradient
                colors={['#7c3aed', '#4FC3F7']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={card.btn}
              >
                <Text style={card.btnText}>EXPLORE TREK</Text>
                <Ionicons name="arrow-forward" size={13} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>
          </AnimChild>
        </View>

      </View>
    </View>
  );
}

const card = StyleSheet.create({
  outer: { width: W, paddingHorizontal: 22, height: CARD_H },
  box: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 25,
    overflow: 'hidden',
    shadowColor: '#222',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 36,
    elevation: 18,
  },
  imgWrap: { height: IMG_H, width: '100%' },
  img: { width: '100%', height: '100%' },
  badgeRow: { position: 'absolute', top: 14, left: 14, flexDirection: 'row', gap: 7 },
  badge: { borderRadius: 99, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  content: { flex: 1, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 18 },
  regionRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  region: { color: '#7b7992', fontSize: 12, fontWeight: '500' },
  name: { fontSize: 22, fontWeight: '800', color: '#0d0925', letterSpacing: -0.3, marginBottom: 10, lineHeight: 28 },
  tagline: { color: '#4e4a67', fontSize: 13.5, lineHeight: 21, flex: 1 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 13, paddingHorizontal: 26,
    borderRadius: 50, marginTop: 14,
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45, shadowRadius: 16, elevation: 8,
  },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function TreksScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  // Browse state
  const [tab, setTab] = useState<'treks' | 'hikes'>('treks');
  const [activeCard, setActiveCard] = useState(0);
  const flatRef = useRef<FlatList>(null);

  const trekItems = TREKS.filter(t => t.category === 'trek');
  const hikeItems = TREKS.filter(t => t.category === 'hike').concat(HIKES);
  const items = tab === 'treks' ? trekItems : hikeItems;

  const onViewRef = useRef(({ viewableItems }: any) => {
    if (viewableItems[0]) setActiveCard(viewableItems[0].index ?? 0);
  });
  const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 55 });

  const handleTabChange = (next: 'treks' | 'hikes') => {
    setTab(next);
    setActiveCard(0);
    flatRef.current?.scrollToIndex({ index: 0, animated: false });
  };

  // Detail sheet state
  const [selected, setSelected] = useState<Trek | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [detailTab, setDetailTab] = useState<'overview' | 'routes' | 'ams'>('overview');
  const [expanded, setExpanded] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [weather, setWeather] = useState<{ temp: string; desc: string; icon: React.ComponentProps<typeof Ionicons>['name'] } | null>(null);
  const [weatherLoad, setWeatherLoad] = useState(false);

  // Image viewer
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIdx, setViewerIdx] = useState(0);
  const heroFlatRef = useRef<FlatList>(null);

  const sheetY = useRef(new Animated.Value(SNAP_CLOSE)).current;
  const startYRef = useRef(SNAP_HALF);

  // Close the full-screen viewer and sync hero gallery to whatever image
  // the user landed on inside the viewer — so the hero behind matches.
  const closeViewer = () => {
    setViewerOpen(false);
    if (viewerIdx !== imgIdx) {
      setImgIdx(viewerIdx);
      // Wait one frame for the modal to start dismissing, then scroll hero.
      requestAnimationFrame(() => {
        heroFlatRef.current?.scrollToIndex({ index: viewerIdx, animated: false });
      });
    }
  };

  useEffect(() => {
    if (!selected) { setWeather(null); return; }
    setWeatherLoad(true);
    fetch(`https://wttr.in/${selected.weatherQuery}?format=j1`)
      .then(r => r.json())
      .then(data => {
        const c = data.current_condition[0];
        setWeather({ temp: `${c.temp_C}°C`, desc: c.weatherDesc[0].value, icon: weatherIcon(parseInt(c.weatherCode)) });
      })
      .catch(() => setWeather({ temp: '--', desc: 'Unavailable', icon: 'cloud-outline' }))
      .finally(() => setWeatherLoad(false));
  }, [selected?.id]);

  const animateTo = (to: number, cb?: () => void) =>
    Animated.spring(sheetY, { toValue: to, useNativeDriver: true, tension: 60, friction: 12 })
      .start(cb ? ({ finished }) => { if (finished) cb(); } : undefined);

  const openSheet = (trek: Trek) => {
    setSelected(trek); setImgIdx(0); setViewerIdx(0);
    setDetailTab('overview'); setExpanded(false); setBookmarked(false);
    sheetY.setValue(SNAP_CLOSE);
    animateTo(SNAP_HALF);
  };
  const closeSheet = () => animateTo(SNAP_CLOSE, () => setSelected(null));

  // Smarter back: if sheet is fully expanded, step it down to half (revealing
  // the hero gallery again). If already at half, close the whole detail.
  const handleBack = () => {
    const cur: number = (sheetY as any)._value ?? SNAP_HALF;
    if (cur < SNAP_HALF * 0.5) {
      // Sheet is fully expanded — step it back down to half
      animateTo(SNAP_HALF);
    } else {
      // Sheet is at half — close instantly, no linger
      sheetY.setValue(SNAP_CLOSE);
      setSelected(null);
    }
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { startYRef.current = (sheetY as any)._value ?? SNAP_HALF; },
    onPanResponderMove: (_, g) => { sheetY.setValue(Math.max(-20, Math.min(SNAP_CLOSE + 50, startYRef.current + g.dy))); },
    onPanResponderRelease: (_, g) => {
      const cur: number = (sheetY as any)._value ?? SNAP_HALF;
      // Fast downward fling closes; otherwise snap to nearest of FULL / HALF / CLOSE
      if (g.vy > 1.4) {
        if (cur > SNAP_HALF * 0.6) closeSheet();
        else animateTo(SNAP_HALF);
        return;
      }
      const candidates = [
        { v: SNAP_FULL, d: Math.abs(cur - SNAP_FULL) },
        { v: SNAP_HALF, d: Math.abs(cur - SNAP_HALF) },
      ];
      // allow flicking past half to close
      if (cur > SNAP_HALF + 90) { closeSheet(); return; }
      candidates.sort((a, b) => a.d - b.d);
      animateTo(candidates[0].v);
    },
  })).current;

  const startMonitoring = () => {
    closeSheet();
    setTimeout(() => router.push('/(tabs)/track'), 220);
  };

  return (
    <LinearGradient
      colors={isDark
        ? ['#1a1025', '#120a1f', '#0a0510']
        : ['#1e88e5', '#2196f3', '#42a5f5', '#64b5f6']}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={[styles.root, { paddingTop: insets.top }]}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Discover</Text>
      </View>

      {/* ── Treks / Hikes tabs ── */}
      <View style={styles.tabBar}>
        {([['treks', 'Treks'], ['hikes', 'Day Hikes']] as const).map(([key, label]) => (
          <TouchableOpacity key={key} style={styles.tabBtn} onPress={() => handleTabChange(key)}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            {tab === key && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.tabDivider} />

      {/* ── Blog-slider cards ── */}
      <FlatList
        key={tab}
        ref={flatRef}
        data={items}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={t => t.id}
        style={{ flexGrow: 0, marginTop: 8 }}
        onViewableItemsChanged={onViewRef.current}
        viewabilityConfig={viewConfig.current}
        renderItem={({ item, index }) => (
          <TrekCard trek={item} isActive={index === activeCard} onExplore={openSheet} />
        )}
      />

      {/* ── Pagination dots ── */}
      <View style={styles.pagination}>
        {items.map((_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => {
              flatRef.current?.scrollToIndex({ index: i, animated: true });
              setActiveCard(i);
            }}
          >
            <View style={[styles.dot, i === activeCard && styles.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* ══════════════════════════════════════════════════════════
          DETAIL: hero (fixed) + draggable card
      ══════════════════════════════════════════════════════════ */}
      {!!selected && (
        <>
          {/* Fixed hero — large background gallery */}
          <View style={styles.heroLayer} pointerEvents="box-none">
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => { setViewerIdx(imgIdx); setViewerOpen(true); }}
            >
              <FlatList
                ref={heroFlatRef}
                data={selected.gallery}
                horizontal pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={{ height: HERO_H, flexGrow: 0 }}
                keyExtractor={(_, i) => String(i)}
                getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
                onMomentumScrollEnd={e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
                renderItem={({ item }) => (
                  <Image source={item} style={{ width: W, height: HERO_H }} resizeMode="cover" />
                )}
              />
            </TouchableOpacity>
            {/* Top vignette + bottom shading for legibility */}
            <LinearGradient
              colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
              style={styles.heroTopFade}
              pointerEvents="none"
            />
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(10,5,16,0.55)', 'rgba(10,5,16,0.95)']}
              locations={[0, 0.6, 1]}
              style={styles.heroBottomFade}
              pointerEvents="none"
            />
            {/* Gallery dots over hero */}
            <View style={[styles.heroDots, { top: HERO_H - 36 }]} pointerEvents="none">
              {selected.gallery.map((_, i) => (
                <View key={i} style={[styles.galleryDot, i === imgIdx && styles.galleryDotActive]} />
              ))}
            </View>
          </View>

          {/* Draggable card */}
          <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetY }] }]}>

            {/* Edge swipe area — drag handle / top strip */}
            <View
              {...panResponder.panHandlers}
              style={styles.edgeSwipe}
              pointerEvents="box-only"
            />

            <View {...panResponder.panHandlers} style={styles.handleStrip}>
              <View style={styles.handle} />
            </View>

            {/* Trek name + weather */}
            <View style={styles.sheetNameRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.sheetTitleRow}>
                  <Text style={styles.sheetName} numberOfLines={2}>{selected.name}</Text>

                </View>
                <View style={styles.sheetRegionRow}>
                  <Ionicons name="location-sharp" size={12} color="rgba(255,255,255,0.4)" />
                  <Text style={styles.sheetRegion}>{selected.region}</Text>
                  {weatherLoad
                    ? <ActivityIndicator size="small" color="#555" style={{ marginLeft: 8 }} />
                    : weather
                      ? <>
                        <Ionicons name={weather.icon} size={11} color="rgba(255,255,255,0.45)" style={{ marginLeft: 10 }} />
                        <Text style={styles.weatherText}>{weather.temp}</Text>
                      </>
                      : null
                  }
                </View>

                {/* Quick stats strip */}
                <View style={styles.quickStats}>
                  <View style={styles.qsItem}>
                    <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.5)" />
                    <Text style={styles.qsText}>{selected.duration}</Text>
                  </View>
                  <View style={styles.qsItem}>
                    <Ionicons name="trending-up-outline" size={12} color="rgba(255,255,255,0.5)" />
                    <Text style={styles.qsText}>{selected.maxAltitude}</Text>
                  </View>
                  <View style={styles.qsItem}>
                    <Ionicons name="walk-outline" size={12} color="rgba(255,255,255,0.5)" />
                    <Text style={styles.qsText}>{selected.distance}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Detail tabs */}
            <View style={styles.detailTabBar}>
              {(['overview', 'routes', 'ams'] as const).map(t => (
                <TouchableOpacity key={t} style={styles.detailTabBtn} onPress={() => setDetailTab(t)}>
                  <Text style={[styles.detailTabText, detailTab === t && styles.detailTabTextActive]}>
                    {t === 'ams' ? 'Emergency' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                  {detailTab === t && <View style={styles.detailTabIndicator} />}
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.tabDivider} />

            <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled bounces={false}
              contentContainerStyle={{ paddingBottom: 140 }}>
              <View style={{ padding: 20 }}>

                {detailTab === 'overview' && (
                  <Text style={styles.descText}>
                    {selected.description}
                  </Text>
                )}

                {detailTab === 'routes' && (
                  <View style={styles.glassCard}>
                    {[
                      { label: 'Start Point', value: selected.startPoint },
                      { label: 'Best Season', value: selected.season },
                      { label: 'Est. Cost', value: selected.cost },
                      { label: 'Distance', value: selected.distance },
                      { label: 'Max Altitude', value: selected.maxAltitude },
                      { label: 'Duration', value: selected.duration },
                    ].map((r, i) => (
                      <View key={i}>
                        {i > 0 && <View style={styles.rowDivider} />}
                        <View style={styles.routeRow}>
                          <Text style={styles.routeLabel}>{r.label}</Text>
                          <Text style={styles.routeValue}>{r.value}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {detailTab === 'ams' && (
                  <>
                    <View style={[styles.amsBanner, { backgroundColor: '#ff0000' + '18', borderColor: '#ff0000' + '40' }]}>

                      <Text style={styles.amsNote}>{selected.monitoringNote}</Text>
                    </View>

                    {selected.category === 'trek' && (
                      <View style={styles.glassCard}>
                        <Text style={styles.emerTitle}>Emergency Numbers</Text>
                        {[
                          { name: 'Nepal Police', phone: '100' },
                          { name: 'Himalayan Rescue Assoc.', phone: '01-4440292' },
                        ].map((f, i) => (
                          <View key={i} style={styles.emerRow}>
                            <View style={styles.emerLeft}>
                              <Text style={styles.emerName}>{f.name}</Text>
                            </View>
                            <TouchableOpacity
                              style={styles.callBtn}
                              onPress={() => Linking.openURL(`tel:${f.phone.replace(/[^+\d]/g, '')}`)}
                            >
                              <Ionicons name="call-outline" size={11} color="#4ade80" />
                              <Text style={styles.callBtnText}>{f.phone}</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}

                    {selected.emergencyFacilities && selected.emergencyFacilities.length > 0 && (
                      <View style={styles.glassCard}>
                        <Text style={styles.emerTitle}>Nearby Facilities</Text>
                        {selected.emergencyFacilities.map((f, i) => (
                          <View key={i}>
                            {i > 0 && <View style={styles.rowDivider} />}
                            <View style={styles.emerRow}>
                              <View style={[styles.emerLeft, { flex: 1 }]}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.emerName}>{f.name}</Text>
                                  <Text style={styles.emerAddr}>{f.address}</Text>
                                </View>
                              </View>
                              <View style={styles.emerActions}>
                                <TouchableOpacity
                                  style={styles.callBtn}
                                  onPress={() => Linking.openURL(`tel:${f.phone.replace(/[^+\d]/g, '')}`)}
                                >
                                  <Ionicons name="call-outline" size={11} color="#4ade80" />
                                  <Text style={styles.callBtnText}>Call</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.mapBtn}
                                  onPress={() => openInMaps(f.name, f.lat, f.lon)}
                                >
                                  <Text style={styles.mapBtnText}>Map</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}

                <View style={{ height: 100 }} />
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.ctaBtn} activeOpacity={0.85} onPress={startMonitoring}>
                <LinearGradient
                  colors={['#7c3aed', '#a855f7']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.ctaGradient}
                >
                  <Ionicons name="pulse-outline" size={18} color="#fff" />
                  <Text style={styles.ctaText}>Start Monitoring</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>

          </Animated.View>

          {/* Top fixed buttons — rendered last so they sit above the sheet at all snaps */}
          <TouchableOpacity
            style={[styles.backBtn, { top: insets.top + 8 }]}
            onPress={handleBack}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
          FULL-SCREEN IMAGE VIEWER
      ══════════════════════════════════════════════════════════ */}
      <Modal visible={viewerOpen} transparent={false} animationType="fade" onRequestClose={closeViewer}>
        <View style={styles.viewerRoot}>
          <FlatList
            data={selected?.gallery ?? []}
            horizontal pagingEnabled
            initialScrollIndex={viewerIdx}
            getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(_, i) => String(i)}
            onMomentumScrollEnd={e => setViewerIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
            renderItem={({ item }) => (
              <View style={{ width: W, height: H, justifyContent: 'center', alignItems: 'center' }}>
                <Image source={item} style={{ width: W, height: H }} resizeMode="contain" />
              </View>
            )}
          />
          <View style={styles.viewerCount}>
            <Text style={styles.viewerCountText}>{viewerIdx + 1} / {selected?.gallery.length ?? 0}</Text>
          </View>
          <TouchableOpacity style={[styles.viewerClose, { top: insets.top + 10 }]} onPress={closeViewer}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </LinearGradient>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: { paddingHorizontal: 28, paddingTop: 10, paddingBottom: 14 },
  headerSub: { fontSize: 11, color: 'rgba(200,180,230,0.55)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4, fontWeight: '600' },
  headerTitle: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },

  // Tabs
  tabBar: { flexDirection: 'row', paddingHorizontal: 24 },
  tabBtn: { flex: 1, paddingBottom: 11, marginTop: 15, alignItems: 'center', position: 'relative' },
  tabText: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.35)' },
  tabTextActive: { color: '#fff', fontWeight: '800' },
  tabIndicator: { position: 'absolute', bottom: -1, left: '15%', right: '15%', height: 2, backgroundColor: '#fff', borderRadius: 1 },
  tabDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: 24, marginBottom: 4 },

  // Pagination
  pagination: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    gap: 8, paddingTop: 14, paddingBottom: 8,
  },
  dot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  dotActive: {
    width: 30, height: 10, borderRadius: 5,
    backgroundColor: '#7c3aed',
    shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 10, elevation: 4,
  },

  // ── Hero (fixed background gallery) ───────────────────────────────────────
  heroLayer: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: HERO_H, backgroundColor: '#0a0510',
    overflow: 'hidden',
  },
  heroTopFade: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: 130,
  },
  heroBottomFade: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: 240,
  },
  heroDots: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },

  // ── Detail sheet ──────────────────────────────────────────────────────────
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height: SHEET_H, backgroundColor: '#120a1f',
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000', shadowOpacity: 0.5,
    shadowRadius: 30, shadowOffset: { width: 0, height: -10 },
    elevation: 30,
    overflow: 'hidden',
  },
  backBtn: {
    position: 'absolute', left: 14, zIndex: 199, elevation: 199,
    backgroundColor: 'rgba(0,0,0,0.45)', width: 40, height: 40,
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  bookmarkBtn: {
    position: 'absolute', right: 14, zIndex: 199, elevation: 199,
    backgroundColor: 'rgba(0,0,0,0.45)', width: 40, height: 40,
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  edgeSwipe: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 56,
    zIndex: 50, elevation: 50,
    backgroundColor: 'transparent',
  },
  handleStrip: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  galleryDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  galleryDotActive: { backgroundColor: '#fff', width: 20 },

  sheetNameRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sheetName: { flex: 1, fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: -0.3, lineHeight: 28 },
  amsPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  amsPillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5 },
  sheetRegionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sheetRegion: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  weatherText: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginLeft: 3 },
  quickStats: {
    flexDirection: 'row', gap: 16, marginTop: 16,
    paddingTop: 16, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  qsItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qsText: { color: 'rgba(255,255,255,0.7)', fontSize: 11.5, fontWeight: '600' },
  detailTabBar: { flexDirection: 'row', paddingHorizontal: 20 },
  detailTabBtn: { flex: 1, paddingBottom: 10, alignItems: 'center', position: 'relative' },
  detailTabText: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.3)' },
  detailTabTextActive: { color: '#a855f7', fontWeight: '700' },
  detailTabIndicator: { position: 'absolute', bottom: -1, left: '10%', right: '10%', height: 2, backgroundColor: '#a855f7', borderRadius: 1 },
  detailScroll: { flex: 1 },
  descText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 24 },
  seeMore: { color: '#a855f7', fontWeight: '600' },
  glassCard: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 25 },
  rowDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  routeRow: { padding: 18 },
  routeLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  routeValue: { fontSize: 14, fontWeight: '600', color: '#fff' },
  amsBanner: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 14 },
  amsBannerTop: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  amsRiskText: { fontSize: 13, fontWeight: '700' },
  amsNote: { fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 21 },
  emerTitle: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 0.6, padding: 16, paddingBottom: 8 },
  sosBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(183,28,28,0.25)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)', padding: 10, marginHorizontal: 14, marginBottom: 8 },
  sosText: { flex: 1, color: '#fff', fontSize: 11, lineHeight: 17 },
  emerRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  emerLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  emerName: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 2 },
  emerAddr: { fontSize: 11, color: 'rgba(255,255,255,0.35)' },
  emerActions: { flexDirection: 'row', gap: 5 },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(74,222,128,0.1)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(74,222,128,0.25)', paddingHorizontal: 8, paddingVertical: 5 },
  callBtnText: { color: '#4ade80', fontSize: 10, fontWeight: '700' },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f5c842', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  mapBtnText: { color: '#111', fontSize: 10, fontWeight: '700' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 32, backgroundColor: 'rgba(10,5,16,0.98)', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  ctaBtn: { borderRadius: 18, overflow: 'hidden', shadowColor: '#7c3aed', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  ctaGradient: { paddingVertical: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.6 },
  viewerRoot: { flex: 1, backgroundColor: '#000' },
  viewerCount: { position: 'absolute', top: 54, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20 },
  viewerCountText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  viewerClose: { position: 'absolute', right: 20, backgroundColor: 'rgba(0,0,0,0.6)', width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
