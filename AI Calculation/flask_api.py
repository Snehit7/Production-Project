
from flask import Flask, request, jsonify, redirect
import joblib
import pandas as pd
import traceback
import sqlite3
import os
import hashlib
import hmac
import base64
import json as jsonlib
import secrets
import urllib.parse
import urllib.request
from datetime import datetime

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


app = Flask(__name__)

# ============================================================================
# eSewa CONFIG
# ============================================================================
# Public sandbox credentials are published in eSewa's developer docs and may
# be used by anyone for testing. NEVER use these for real money — switch to
# your real merchant code + secret key (loaded from env, never hard-coded)
# before going to production.
ESEWA_MERCHANT_CODE = os.environ.get('ESEWA_MERCHANT_CODE', 'EPAYTEST')
ESEWA_SECRET_KEY    = os.environ.get('ESEWA_SECRET_KEY',    '8gBm/:&EnhH.1/q')
ESEWA_FORM_URL      = os.environ.get('ESEWA_FORM_URL',
                                     'https://rc-epay.esewa.com.np/api/epay/main/v2/form')
ESEWA_VERIFY_URL    = os.environ.get('ESEWA_VERIFY_URL',
                                     'https://rc.esewa.com.np/api/epay/transaction/status/')

def esewa_signature(message: str) -> str:
    """HMAC-SHA256(secret, message) → Base64. Used both for outgoing requests
    and for verifying eSewa's redirect response."""
    digest = hmac.new(
        ESEWA_SECRET_KEY.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256,
    ).digest()
    return base64.b64encode(digest).decode('ascii')

def esewa_status_check(product_code: str, total_amount, transaction_uuid: str):
    """Server-to-server verification with eSewa. Never trust the redirect
    payload alone — this is the only authoritative source of truth."""
    url = (
        f"{ESEWA_VERIFY_URL}"
        f"?product_code={urllib.parse.quote(str(product_code))}"
        f"&total_amount={urllib.parse.quote(str(total_amount))}"
        f"&transaction_uuid={urllib.parse.quote(str(transaction_uuid))}"
    )
    with urllib.request.urlopen(url, timeout=15) as resp:
        return jsonlib.loads(resp.read().decode('utf-8'))

# ============================================================================
# DATABASE SETUP
# ============================================================================
DB_PATH = 'ams_readings.db'

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT    NOT NULL UNIQUE,
            email      TEXT    NOT NULL UNIQUE,
            password   TEXT    NOT NULL,
            token      TEXT,
            created_at TEXT    NOT NULL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS predictions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER,
            timestamp        TEXT    NOT NULL,
            spo2_pct         REAL    NOT NULL,
            heart_rate       REAL    NOT NULL,
            altitude         REAL    NOT NULL,
            ascent_rate      REAL    NOT NULL,
            hours_at_altitude REAL   NOT NULL,
            risk_level       TEXT    NOT NULL,
            risk_score       INTEGER NOT NULL,
            confidence       REAL    NOT NULL,
            recommendation   TEXT    NOT NULL,
            rule_based       TEXT
        )
    ''')
    # ── Products (the AMS Glove and any future hardware kits) ──
    c.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sku         TEXT    NOT NULL UNIQUE,
            name        TEXT    NOT NULL,
            tagline     TEXT,
            description TEXT,
            price_npr   INTEGER NOT NULL,
            stock       INTEGER NOT NULL DEFAULT 0,
            image_url   TEXT,
            created_at  TEXT    NOT NULL
        )
    ''')
    # ── Orders ──
    c.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL,
            product_id      INTEGER NOT NULL,
            quantity        INTEGER NOT NULL DEFAULT 1,
            amount_npr      INTEGER NOT NULL,
            payment_method  TEXT    NOT NULL,
            status          TEXT    NOT NULL DEFAULT 'pending',
            shipping_name   TEXT,
            shipping_phone  TEXT,
            shipping_email  TEXT,
            shipping_addr   TEXT,
            created_at      TEXT    NOT NULL,
            FOREIGN KEY (user_id)    REFERENCES users(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    ''')
    # Backfill column for users who created the DB before email was added
    try:
        c.execute("ALTER TABLE orders ADD COLUMN shipping_email TEXT")
    except sqlite3.OperationalError:
        pass  # column already exists
    # ── Payments (real eSewa redirect flow + receipts for mock methods) ──
    c.execute('''
        CREATE TABLE IF NOT EXISTS payments (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id          INTEGER NOT NULL,
            gateway           TEXT    NOT NULL,             -- 'esewa' | 'khalti' | 'cod'
            amount_npr        INTEGER NOT NULL,
            transaction_uuid  TEXT    UNIQUE,               -- our id sent to eSewa
            esewa_ref_id      TEXT    UNIQUE,               -- eSewa's reference once paid
            khalti_pidx       TEXT    UNIQUE,               -- placeholder for future Khalti
            app_redirect_url  TEXT,                         -- where to bounce back into the app
            status            TEXT    NOT NULL DEFAULT 'initiated',  -- initiated | paid | failed | cancelled
            failure_reason    TEXT,
            created_at        TEXT    NOT NULL,
            completed_at      TEXT,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    ''')
    # ── Migrations: add columns that may not exist in older databases ──
    c.execute("PRAGMA table_info(predictions)")
    existing_cols = {row[1] for row in c.fetchall()}
    if 'user_id' not in existing_cols:
        c.execute('ALTER TABLE predictions ADD COLUMN user_id INTEGER')
        print("Migration: added user_id column to predictions table")
    if 'rule_based' not in existing_cols:
        c.execute('ALTER TABLE predictions ADD COLUMN rule_based TEXT')
        print("Migration: added rule_based column to predictions table")

    # ── Seed the AMS Glove product if it doesn't exist yet ──
    c.execute("SELECT id FROM products WHERE sku = ?", ('AMS-GLOVE-V1',))
    if not c.fetchone():
        c.execute('''
            INSERT INTO products
                (sku, name, tagline, description, price_npr, stock, image_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            'AMS-GLOVE-V1',
            'AMS Monitoring Glove',
            'Wearable altitude-sickness sensor for trekkers',
            ('Lightweight glove housing the ESP32 sensor node — MAX30102 pulse oximeter, '
             'BMP280 barometric altimeter, alert buzzer and emergency button. Streams live '
             'SpO2, heart rate, altitude and ascent rate to the AMS app over WiFi. Designed '
             'and assembled in Kathmandu for high-altitude trekking in Nepal.'),
            500,                # NPR 500
            25,                 # initial stock
            '/static/products/ams-glove.png',
            datetime.now().isoformat(),
        ))
        print("Seeded product: AMS Monitoring Glove (NPR 500)")

    conn.commit()
    conn.close()
    print("Database ready: ams_readings.db")

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def get_user_from_token(token):
    if not token:
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM users WHERE token = ?', (token,))
    user = c.fetchone()
    conn.close()
    return dict(user) if user else None

def save_prediction(data, risk_score, confidence, recommendation, rule_based_result, user_id=None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO predictions (
            user_id, timestamp, spo2_pct, heart_rate, altitude,
            ascent_rate, hours_at_altitude,
            risk_level, risk_score, confidence, recommendation, rule_based
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        user_id,
        datetime.now().isoformat(),
        data['spo2_pct'],
        data['heart_rate'],
        data['altitude'],
        data['ascent_rate'],
        data['hours_at_altitude'],
        RISK_LABELS[risk_score],
        int(risk_score),
        round(float(confidence), 2),
        recommendation,
        rule_based_result
    ))
    conn.commit()
    conn.close()

# ============================================================================
# RULE-BASED PREDICTION  (mirrors the Arduino logic — runs offline on ESP32)
# Having the same logic here lets us compare it against the Decision Tree
# and log whether they agree on every reading.
# ============================================================================
def rule_based_predict(spo2, altitude, ascent_rate, heart_rate, hours_at_altitude=0):
    """
    Pure rule-based AMS risk — identical to predictAMS() on the ESP32.
    Returns: 'Low' | 'Medium' | 'High' | 'Severe'
    """
    # Primary rule: SpO2 (most important AMS indicator)
    if   spo2 < 85: risk = 'Severe'
    elif spo2 < 90: risk = 'High'
    elif spo2 < 94: risk = 'Medium'
    else:           risk = 'Low'

    # Modifier: altitude
    if altitude > 5000 and risk == 'Low':
        risk = 'Medium'

    # Modifier: ascent rate (climbing too fast)
    if ascent_rate > 500 and risk == 'Low':
        risk = 'Medium'
    if ascent_rate > 500 and risk == 'Medium':
        risk = 'High'

    # Modifier: elevated heart rate with borderline SpO2
    if heart_rate > 110 and spo2 < 94 and risk == 'Low':
        risk = 'Medium'

    # Modifier: prolonged time at altitude without acclimatisation
    if hours_at_altitude > 24 and risk == 'Low':
        risk = 'Medium'
    if hours_at_altitude > 48 and risk == 'Medium':
        risk = 'High'

    return risk


# ============================================================================
# LOAD MODEL
# ============================================================================
print("\n" + "="*60)
print("LOADING AMS PREDICTION MODEL...")
print("="*60)

try:
    model    = joblib.load('ams_model.pkl')
    scaler   = joblib.load('scaler.pkl')
    metadata = joblib.load('model_metadata.pkl')

    FEATURE_COLUMNS = metadata['feature_columns']
    RISK_LABELS     = metadata['risk_labels']
    MODEL_NAME      = metadata['model_name']
    MODEL_ACCURACY  = metadata['accuracy']

    print(f"Model loaded: {MODEL_NAME}")
    print(f"Accuracy    : {MODEL_ACCURACY*100:.2f}%")
    print(f"\nRequired features:")
    for i, feature in enumerate(FEATURE_COLUMNS, 1):
        print(f"  {i}. {feature}")
    print("="*60 + "\n")

except FileNotFoundError as e:
    print(f"\nERROR: Model files not found.")
    print(f"Make sure these files are in the same folder as flask_api.py:")
    print(f"  - ams_model.pkl\n  - scaler.pkl\n  - model_metadata.pkl")
    print(f"\n{e}\n")
    exit(1)

except Exception as e:
    print(f"\nERROR loading model: {e}")
    print(traceback.format_exc())
    exit(1)

init_db()

# ============================================================================
# CONSTANTS
# ============================================================================
RECOMMENDATIONS = {
    0: "Low risk. Safe to continue trekking. Monitor SpO2 and heart rate regularly.",
    1: "Moderate risk. Slow down, stay hydrated, avoid further ascent today. Rest and acclimatize.",
    2: "High risk. Stop ascending immediately. Rest at current altitude for 24-48 hours. Descend if symptoms worsen.",
    3: "Severe risk. Descend to lower altitude immediately (at least 500m). Seek medical attention urgently."
}

ALERT_COLORS = {
    0: "#00FF00",
    1: "#FFFF00",
    2: "#FF8C00",
    3: "#FF0000"
}

# ============================================================================
# AUTH ENDPOINTS
# ============================================================================
@app.route('/auth/register', methods=['POST'])
def register():
    data = request.json
    if not data:
        return jsonify({'success': False, 'error': 'No data received.'}), 400

    username = data.get('username', '').strip()
    email    = data.get('email', '').strip()
    password = data.get('password', '').strip()

    if not username or not email or not password:
        return jsonify({'success': False, 'error': 'Username, email and password are required.'}), 400

    if len(password) < 6:
        return jsonify({'success': False, 'error': 'Password must be at least 6 characters.'}), 400

    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute(
            'INSERT INTO users (username, email, password, created_at) VALUES (?, ?, ?, ?)',
            (username, email, hash_password(password), datetime.now().isoformat())
        )
        conn.commit()
        conn.close()
        print(f"New user registered: {username}")
        return jsonify({'success': True, 'message': 'Account created successfully.'})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'error': 'Username or email already exists.'}), 400


@app.route('/auth/login', methods=['POST'])
def login():
    data = request.json
    if not data:
        return jsonify({'success': False, 'error': 'No data received.'}), 400

    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password are required.'}), 400

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM users WHERE username = ? AND password = ?',
              (username, hash_password(password)))
    user = c.fetchone()

    if not user:
        conn.close()
        return jsonify({'success': False, 'error': 'Invalid username or password.'}), 401

    token = secrets.token_hex(32)
    c.execute('UPDATE users SET token = ? WHERE id = ?', (token, user['id']))
    conn.commit()
    conn.close()

    print(f"User logged in: {username}")
    return jsonify({
        'success':  True,
        'token':    token,
        'username': username,
        'message':  'Login successful.'
    })


@app.route('/auth/logout', methods=['POST'])
def logout():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    user  = get_user_from_token(token)
    if user:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('UPDATE users SET token = NULL WHERE id = ?', (user['id'],))
        conn.commit()
        conn.close()
    return jsonify({'success': True, 'message': 'Logged out.'})


# ============================================================================
# ENDPOINT 1: ROOT
# ============================================================================
@app.route('/', methods=['GET'])
def root():
    return jsonify({
        'name': 'AMS Prediction API',
        'version': '1.0.0',
        'model': { 'name': MODEL_NAME, 'accuracy': f"{MODEL_ACCURACY*100:.2f}%" },
        'endpoints': {
            'GET /':          'API information',
            'GET /health':    'Health check',
            'POST /predict':  'AMS risk prediction',
            'GET /history':   'All past predictions',
            'GET /history/latest': 'Latest prediction',
            'DELETE /history': 'Clear all history'
        }
    })

# ============================================================================
# ENDPOINT 2: HEALTH CHECK
# ============================================================================
@app.route('/health', methods=['GET'])
def health_check():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM predictions')
    total = c.fetchone()[0]
    conn.close()

    return jsonify({
        'status':           'healthy',
        'timestamp':        datetime.now().isoformat(),
        'model':            MODEL_NAME,
        'accuracy':         f"{MODEL_ACCURACY*100:.2f}%",
        'total_predictions': total,
        'ready':            True
    })

# ============================================================================
# ENDPOINT 3: PREDICTION
# ============================================================================
@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json

        if not data:
            return jsonify({'success': False, 'error': 'No data received.'}), 400

        missing_features = [f for f in FEATURE_COLUMNS if f not in data]
        if missing_features:
            return jsonify({
                'success': False,
                'error': f'Missing features: {missing_features}',
                'required_features': FEATURE_COLUMNS
            }), 400

        input_data   = {feature: data[feature] for feature in FEATURE_COLUMNS}
        input_df     = pd.DataFrame([input_data])
        input_scaled = scaler.transform(input_df)

        # ── Decision Tree prediction ──
        risk_score    = model.predict(input_scaled)[0]
        probabilities = model.predict_proba(input_scaled)[0]
        confidence    = probabilities[risk_score] * 100
        dt_risk       = RISK_LABELS[risk_score]
        recommendation = RECOMMENDATIONS[risk_score]

        # ── Rule-based prediction (same logic as Arduino) ──
        rb_risk = rule_based_predict(
            spo2            = input_data['spo2_pct'],
            altitude        = input_data['altitude'],
            ascent_rate     = input_data['ascent_rate'],
            heart_rate      = input_data['heart_rate'],
            hours_at_altitude = input_data.get('hours_at_altitude', 0)
        )
        models_agree = (rb_risk == dt_risk)

        # ── Save to database (with user_id if logged in) ──
        token   = request.headers.get('Authorization', '').replace('Bearer ', '')
        user    = get_user_from_token(token)
        user_id = user['id'] if user else None
        save_prediction(input_data, risk_score, confidence, recommendation, rb_risk, user_id)

        response = {
            'success':   True,
            'timestamp': datetime.now().isoformat(),
            # Decision Tree result
            'prediction': {
                'risk_level':  dt_risk,
                'risk_score':  int(risk_score),
                'confidence':  round(float(confidence), 2),
                'alert_color': ALERT_COLORS[risk_score]
            },
            'probabilities': {
                'Low':    round(float(probabilities[0] * 100), 2),
                'Medium': round(float(probabilities[1] * 100), 2),
                'High':   round(float(probabilities[2] * 100), 2),
                'Severe': round(float(probabilities[3] * 100), 2)
            },
            'recommendation': recommendation,
            # Rule-based result (mirrors Arduino logic)
            'rule_based':    rb_risk,
            'models_agree':  models_agree,
            'input_received': {
                'spo2':        f"{input_data['spo2_pct']}%",
                'heart_rate':  f"{input_data['heart_rate']} bpm",
                'altitude':    f"{input_data['altitude']}m",
                'ascent_rate': f"{input_data['ascent_rate']} m/hr"
            }
        }

        agree_str = "✓ AGREE" if models_agree else f"✗ DISAGREE (RB={rb_risk})"
        print(f"[{datetime.now().strftime('%H:%M:%S')}] "
              f"SpO2={input_data['spo2_pct']}% HR={input_data['heart_rate']} "
              f"Alt={input_data['altitude']}m -> DT:{dt_risk} ({confidence:.1f}%)  {agree_str}")

        return jsonify(response)

    except Exception as e:
        print(f"\nERROR: {traceback.format_exc()}")
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# ENDPOINT 4: HISTORY
# ============================================================================
@app.route('/history', methods=['GET'])
def get_history():
    limit = request.args.get('limit', 50, type=int)
    conn  = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM predictions ORDER BY id DESC LIMIT ?', (limit,))
    rows = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify({'success': True, 'count': len(rows), 'data': rows})

# ============================================================================
# ENDPOINT 5: LATEST PREDICTION
# ============================================================================
@app.route('/history/latest', methods=['GET'])
def get_latest():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM predictions ORDER BY id DESC LIMIT 1')
    row = c.fetchone()
    conn.close()

    if row:
        return jsonify({'success': True, 'data': dict(row)})
    return jsonify({'success': False, 'error': 'No predictions yet.'}), 404

# ============================================================================
# ENDPOINT 6: CLEAR HISTORY
# ============================================================================
@app.route('/history', methods=['DELETE'])
def clear_history():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('DELETE FROM predictions')
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': 'History cleared.'})

# ============================================================================
# ENDPOINT 7: EMERGENCY  (triggered by hardware button on ESP32)
# ============================================================================
emergency_state = {'triggered': False, 'timestamp': None}

@app.route('/emergency', methods=['POST'])
def trigger_emergency():
    emergency_state['triggered'] = True
    emergency_state['timestamp'] = datetime.now().isoformat()
    print(f"[EMERGENCY] Triggered at {emergency_state['timestamp']}")
    return jsonify({'success': True, **emergency_state})

@app.route('/emergency', methods=['GET'])
def get_emergency():
    return jsonify({'success': True, **emergency_state})

@app.route('/emergency', methods=['DELETE'])
def clear_emergency():
    emergency_state['triggered'] = False
    emergency_state['timestamp'] = None
    print("[EMERGENCY] Dismissed")
    return jsonify({'success': True, 'message': 'Emergency cleared.'})

# ============================================================================
# ENDPOINT 8: PRODUCTS  (read-only catalogue)
# ============================================================================
@app.route('/products', methods=['GET'])
def list_products():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM products ORDER BY id ASC')
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return jsonify({'success': True, 'count': len(rows), 'data': rows})


@app.route('/products/<int:product_id>', methods=['GET'])
def get_product(product_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM products WHERE id = ?', (product_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return jsonify({'success': False, 'error': 'Product not found.'}), 404
    return jsonify({'success': True, 'data': dict(row)})


# ============================================================================
# ENDPOINT 9: ORDERS  (mock payment — no real money is processed)
# ============================================================================
ALLOWED_PAYMENT_METHODS = {'esewa', 'khalti', 'cod'}


@app.route('/orders', methods=['POST'])
def create_order():
    """
    Records an order against a logged-in user.

    Status flow per method:
      - esewa  : starts 'awaiting_payment' — flipped to 'paid' by /payments/esewa/callback
      - khalti : 'paid' (mock — Khalti merchant flow not yet wired up)
      - cod    : 'pending' — courier flips to 'paid' on physical handover
    """
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    user  = get_user_from_token(token)
    if not user:
        return jsonify({'success': False, 'error': 'Login required.'}), 401

    data = request.json or {}
    product_id     = data.get('product_id')
    quantity       = max(1, int(data.get('quantity', 1)))
    payment_method = (data.get('payment_method') or '').lower()
    shipping_name  = (data.get('shipping_name')  or '').strip()
    shipping_phone = (data.get('shipping_phone') or '').strip()
    shipping_email = (data.get('shipping_email') or '').strip()
    shipping_addr  = (data.get('shipping_addr')  or '').strip()

    if not product_id:
        return jsonify({'success': False, 'error': 'product_id is required.'}), 400
    if payment_method not in ALLOWED_PAYMENT_METHODS:
        return jsonify({
            'success': False,
            'error': f"payment_method must be one of {sorted(ALLOWED_PAYMENT_METHODS)}.",
        }), 400

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM products WHERE id = ?', (product_id,))
    product = c.fetchone()
    if not product:
        conn.close()
        return jsonify({'success': False, 'error': 'Product not found.'}), 404

    amount = int(product['price_npr']) * quantity
    # eSewa is verified asynchronously via the redirect callback — start in
    # 'awaiting_payment' and let /payments/esewa/callback promote it to 'paid'.
    if   payment_method == 'esewa': status = 'awaiting_payment'
    elif payment_method == 'cod':   status = 'pending'
    else:                           status = 'paid'   # khalti mock

    c.execute('''
        INSERT INTO orders (
            user_id, product_id, quantity, amount_npr, payment_method, status,
            shipping_name, shipping_phone, shipping_email, shipping_addr, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        user['id'], product['id'], quantity, amount, payment_method, status,
        shipping_name, shipping_phone, shipping_email, shipping_addr,
        datetime.now().isoformat(),
    ))
    order_id = c.lastrowid

    # Decrement stock if available
    if product['stock'] >= quantity:
        c.execute('UPDATE products SET stock = stock - ? WHERE id = ?', (quantity, product['id']))

    conn.commit()
    c.execute('SELECT * FROM orders WHERE id = ?', (order_id,))
    order = dict(c.fetchone())
    conn.close()

    print(f"[ORDER #{order_id}] {user['username']} -> {product['name']} "
          f"x{quantity} via {payment_method} = NPR {amount} ({status})")

    return jsonify({'success': True, 'data': order})


@app.route('/orders', methods=['GET'])
def list_orders():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    user  = get_user_from_token(token)
    if not user:
        return jsonify({'success': False, 'error': 'Login required.'}), 401

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('''
        SELECT o.*, p.name AS product_name, p.image_url AS product_image
        FROM   orders o
        JOIN   products p ON p.id = o.product_id
        WHERE  o.user_id = ?
        ORDER  BY o.id DESC
    ''', (user['id'],))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return jsonify({'success': True, 'count': len(rows), 'data': rows})


# ============================================================================
# ENDPOINT 9.5: READING SESSION STATE
# ============================================================================
# Lifecycle of one ESP32 reading window:
#
#   ESP32                                   Flask                         App
#   ─────                                   ─────                         ───
#   finger detected ──── POST /session/start ──> state='reading'  ◄──── poll /session
#   read 20s, post /predict every 1.5s                            ◄──── poll /history/latest
#   window closes  ───── POST /session/end ────> state='complete' ◄──── poll /session
#                                                final value cached
#
# The app uses /session to know whether to:
#   - show "Place finger on sensor" (idle)
#   - show a countdown timer + "Reading…" with placeholders (reading)
#   - reveal the final SpO2 / HR / altitude (complete)
#
# State is held in a process-local dict. That's fine for the prototype —
# only one device at a time. For multi-trekker production this would move
# to a DB table keyed by user.
# ============================================================================

# Must match READING_DURATION_MS in the ESP32 sketch
READING_DURATION_MS = 20000

SESSION_STATE = {
    'state':         'idle',      # 'idle' | 'reading' | 'complete'
    'started_at':    None,        # ISO timestamp
    'completed_at':  None,        # ISO timestamp
    'duration_ms':   READING_DURATION_MS,
    'final':         None,        # {'spo2_pct', 'heart_rate', 'altitude', 'risk_level'}
}


@app.route('/session/start', methods=['POST'])
def session_start():
    """ESP32 calls this the moment a finger is detected. Resets the cached
    final value and flips the app into 'reading' UI."""
    SESSION_STATE['state']        = 'reading'
    SESSION_STATE['started_at']   = datetime.now().isoformat()
    SESSION_STATE['completed_at'] = None
    SESSION_STATE['final']        = None
    print(f"[session] START at {SESSION_STATE['started_at']}")
    return jsonify({'success': True, 'session': SESSION_STATE})


@app.route('/session/end', methods=['POST'])
def session_end():
    """ESP32 calls this when the 20-second window completes. Caches the
    final values so the app can reveal them as the result of the session."""
    data = request.json or {}
    SESSION_STATE['state']        = 'complete'
    SESSION_STATE['completed_at'] = datetime.now().isoformat()
    SESSION_STATE['final'] = {
        'spo2_pct':   data.get('spo2_pct'),
        'heart_rate': data.get('heart_rate'),
        'altitude':   data.get('altitude'),
        'risk_level': data.get('risk_level'),
    }
    print(f"[session] END   final={SESSION_STATE['final']}")
    return jsonify({'success': True, 'session': SESSION_STATE})


@app.route('/session/reset', methods=['POST'])
def session_reset():
    """Manual reset hook — handy from the app's debug menu."""
    SESSION_STATE['state']        = 'idle'
    SESSION_STATE['started_at']   = None
    SESSION_STATE['completed_at'] = None
    SESSION_STATE['final']        = None
    return jsonify({'success': True, 'session': SESSION_STATE})


@app.route('/session', methods=['GET'])
def get_session():
    """Polled by the Track tab. Adds elapsed_ms / remaining_ms so the
    countdown timer doesn't have to be reconstructed client-side."""
    out = dict(SESSION_STATE)
    if SESSION_STATE['state'] == 'reading' and SESSION_STATE['started_at']:
        try:
            started = datetime.fromisoformat(SESSION_STATE['started_at'])
            elapsed_ms = int((datetime.now() - started).total_seconds() * 1000)
            remaining_ms = max(0, SESSION_STATE['duration_ms'] - elapsed_ms)
            out['elapsed_ms']   = elapsed_ms
            out['remaining_ms'] = remaining_ms
            # Self-heal: if ESP32 crashed mid-read and never sent /session/end,
            # auto-flip to 'complete' a couple of seconds after the window
            # would have ended. The cached 'final' will be None — the app
            # treats that as "no result available".
            if elapsed_ms > SESSION_STATE['duration_ms'] + 5000:
                SESSION_STATE['state']        = 'complete'
                SESSION_STATE['completed_at'] = datetime.now().isoformat()
                out = dict(SESSION_STATE)
        except Exception:
            pass
    return jsonify({'success': True, 'session': out})


# ============================================================================
# ENDPOINT 10: ORDER STATUS  (polled by the app while a payment is in flight)
# ============================================================================
@app.route('/orders/<int:order_id>/status', methods=['GET'])
def order_status(order_id):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    user  = get_user_from_token(token)
    if not user:
        return jsonify({'success': False, 'error': 'Login required.'}), 401

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM orders WHERE id = ? AND user_id = ?', (order_id, user['id']))
    order = c.fetchone()
    if not order:
        conn.close()
        return jsonify({'success': False, 'error': 'Order not found.'}), 404

    c.execute('''
        SELECT id, gateway, status, esewa_ref_id, failure_reason
        FROM   payments WHERE order_id = ?
        ORDER  BY id DESC LIMIT 1
    ''', (order_id,))
    payment = c.fetchone()
    conn.close()

    return jsonify({
        'success': True,
        'order':   dict(order),
        'payment': dict(payment) if payment else None,
    })


# ============================================================================
# ENDPOINT 11: eSewa PAYMENTS  (real sandbox integration via redirect)
# ============================================================================
# Flow:
#   1. App  POST /payments/esewa/initiate { order_id, app_redirect_url }
#      → server creates a payments row, returns a launch_url
#   2. App  opens launch_url in expo-web-browser
#   3. /payments/esewa/launch serves an HTML page that auto-POSTs the signed
#      form to eSewa's hosted checkout
#   4. User pays on eSewa's page
#   5. eSewa redirects the in-app browser to /payments/esewa/callback?data=...
#   6. Server verifies the response signature, then independently calls eSewa's
#      status API server-to-server, then atomically marks the order as paid
#   7. Server redirects to the app's deep link, expo-web-browser closes, app
#      polls /orders/<id>/status to confirm
# ============================================================================
def _build_app_redirect(redirect_url: str, **params) -> str:
    """Append params onto the app's deep-link redirect URL safely."""
    if not redirect_url:
        # Sensible default — matches the scheme in app.json
        redirect_url = 'amsapp://payment/done'
    sep = '&' if '?' in redirect_url else '?'
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    return f"{redirect_url}{sep}{qs}"


@app.route('/payments/esewa/initiate', methods=['POST'])
def esewa_initiate():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    user  = get_user_from_token(token)
    if not user:
        return jsonify({'success': False, 'error': 'Login required.'}), 401

    data = request.json or {}
    order_id          = data.get('order_id')
    app_redirect_url  = (data.get('app_redirect_url') or 'amsapp://payment/done').strip()
    if not order_id:
        return jsonify({'success': False, 'error': 'order_id is required.'}), 400

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM orders WHERE id = ? AND user_id = ?', (order_id, user['id']))
    order = c.fetchone()
    if not order:
        conn.close()
        return jsonify({'success': False, 'error': 'Order not found.'}), 404
    if order['payment_method'] != 'esewa':
        conn.close()
        return jsonify({'success': False, 'error': 'Order is not an eSewa order.'}), 400
    if order['status'] == 'paid':
        conn.close()
        return jsonify({'success': False, 'error': 'Order already paid.'}), 400

    # Unique transaction UUID — eSewa requires alphanumeric + hyphens only
    transaction_uuid = f"AMS-{order_id}-{secrets.token_hex(4)}"
    c.execute('''
        INSERT INTO payments
            (order_id, gateway, amount_npr, transaction_uuid,
             app_redirect_url, status, created_at)
        VALUES (?, 'esewa', ?, ?, ?, 'initiated', ?)
    ''', (order_id, order['amount_npr'], transaction_uuid,
          app_redirect_url, datetime.now().isoformat()))
    payment_id = c.lastrowid
    conn.commit()
    conn.close()

    # Use whatever host the client used to reach us so the launch URL is
    # automatically reachable from the same network as the app.
    base_url   = request.host_url.rstrip('/')
    launch_url = f"{base_url}/payments/esewa/launch?paymentId={payment_id}"

    print(f"[eSewa] Initiated payment #{payment_id} for order #{order_id} "
          f"(NPR {order['amount_npr']}, uuid={transaction_uuid})")

    return jsonify({
        'success':    True,
        'payment_id': payment_id,
        'launch_url': launch_url,
        'redirect_url': app_redirect_url,
    })


@app.route('/payments/esewa/launch', methods=['GET'])
def esewa_launch():
    """Shows an order-summary page for 2 seconds, then auto-POSTs the signed
    payment form to eSewa. The brief pause lets the user confirm their shipping
    details before the browser leaves our domain."""
    payment_id = request.args.get('paymentId')
    if not payment_id:
        return 'Missing paymentId', 400

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    # Join orders + products so we can show shipping details on the confirm page
    c.execute('''
        SELECT p.id, p.gateway, p.status, p.transaction_uuid, p.amount_npr,
               p.app_redirect_url,
               o.shipping_name, o.shipping_phone, o.shipping_email, o.shipping_addr,
               o.quantity,
               pr.name AS product_name
        FROM   payments p
        JOIN   orders   o  ON o.id  = p.order_id
        JOIN   products pr ON pr.id = o.product_id
        WHERE  p.id = ?
    ''', (payment_id,))
    row = c.fetchone()
    conn.close()

    if not row or row['gateway'] != 'esewa':
        return 'Payment not found', 404
    if row['status'] != 'initiated':
        return f"Payment already {row['status']}", 400

    transaction_uuid = row['transaction_uuid']
    total_amount     = str(row['amount_npr'])
    base_url         = request.host_url.rstrip('/')
    success_url      = f"{base_url}/payments/esewa/callback?paymentId={payment_id}"
    failure_url      = f"{base_url}/payments/esewa/cancel?paymentId={payment_id}"

    # Signature — fixed field order per eSewa v2 docs
    sig_string = (
        f"total_amount={total_amount},"
        f"transaction_uuid={transaction_uuid},"
        f"product_code={ESEWA_MERCHANT_CODE}"
    )
    signature = esewa_signature(sig_string)

    # Build shipping summary for the confirm card
    ship_name    = row['shipping_name']  or ''
    ship_phone   = row['shipping_phone'] or ''
    ship_email   = row['shipping_email'] or ''
    ship_addr    = row['shipping_addr']  or ''
    product_name = row['product_name']   or 'AMS Monitoring Glove'
    qty          = row['quantity']       or 1

    addr_line = ', '.join(p for p in [ship_addr, ship_phone] if p) or 'Not provided'
    email_row = (f'<div class="order-row"><span class="lbl">Email</span>'
                 f'<span class="val">{ship_email}</span></div>') if ship_email else ''

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Confirm &amp; Pay — eSewa</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ min-height: 100vh; background: #f4f6f9; display: flex; align-items: center;
         justify-content: center; padding: 24px;
         font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }}
  .card {{ background: #fff; border-radius: 16px; padding: 24px 22px;
           width: 100%; max-width: 360px;
           box-shadow: 0 4px 20px rgba(0,0,0,0.08); }}
  .esewa-logo {{ display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }}
  .esewa-dot  {{ width: 10px; height: 10px; border-radius: 50%; background: #60bb46; }}
  .esewa-name {{ font-size: 13px; font-weight: 700; color: #60bb46; letter-spacing: .5px; }}
  h1 {{ font-size: 17px; font-weight: 700; color: #0d0d12; margin-bottom: 4px; }}
  .sub {{ font-size: 13px; color: #6b6b78; margin-bottom: 18px; }}
  .divider {{ height: 1px; background: #f0f0f5; margin: 14px 0; }}
  .order-row {{ display: flex; justify-content: space-between; align-items: flex-start;
               font-size: 13px; gap: 10px; margin-bottom: 10px; }}
  .order-row:last-child {{ margin-bottom: 0; }}
  .lbl {{ color: #9090a0; font-size: 11px; text-transform: uppercase;
          letter-spacing: .5px; white-space: nowrap; padding-top: 2px; }}
  .val {{ color: #0d0d12; font-weight: 600; text-align: right; word-break: break-word; max-width: 200px; }}
  .amount {{ color: #60bb46; font-size: 16px; }}
  .progress {{ margin-top: 20px; height: 3px; background: #e8e8ef; border-radius: 2px; overflow: hidden; }}
  .bar {{ height: 100%; background: #60bb46; border-radius: 2px;
          animation: fill 2s linear forwards; }}
  @keyframes fill {{ from {{ width: 0 }} to {{ width: 100% }} }}
</style>
</head>
<body>
<div class="card">
  <div class="esewa-logo">
    <div class="esewa-dot"></div>
    <span class="esewa-name">eSewa SANDBOX</span>
  </div>
  <h1>Confirm your order</h1>
  <p class="sub">Redirecting to eSewa in 2 seconds…</p>
  <div class="divider"></div>
  <div class="order-row">
    <span class="lbl">Product</span>
    <span class="val">{product_name} × {qty}</span>
  </div>
  <div class="order-row">
    <span class="lbl">Amount</span>
    <span class="val amount">NPR {total_amount}</span>
  </div>
  <div class="order-row">
    <span class="lbl">Ship to</span>
    <span class="val">{ship_name}<br><span style="font-weight:400;color:#555">{addr_line}</span></span>
  </div>
  {email_row}
  <div class="divider"></div>
  <div class="progress"><div class="bar"></div></div>
</div>
<form id="f" method="POST" action="{ESEWA_FORM_URL}">
  <input type="hidden" name="amount"                  value="{total_amount}">
  <input type="hidden" name="tax_amount"              value="0">
  <input type="hidden" name="total_amount"            value="{total_amount}">
  <input type="hidden" name="transaction_uuid"        value="{transaction_uuid}">
  <input type="hidden" name="product_code"            value="{ESEWA_MERCHANT_CODE}">
  <input type="hidden" name="product_service_charge"  value="0">
  <input type="hidden" name="product_delivery_charge" value="0">
  <input type="hidden" name="success_url"             value="{success_url}">
  <input type="hidden" name="failure_url"             value="{failure_url}">
  <input type="hidden" name="signed_field_names"      value="total_amount,transaction_uuid,product_code">
  <input type="hidden" name="signature"               value="{signature}">
</form>
<script>setTimeout(function(){{ document.getElementById('f').submit(); }}, 2000);</script>
</body>
</html>"""
    return html, 200, {'Content-Type': 'text/html; charset=utf-8'}


@app.route('/payments/esewa/callback', methods=['GET'])
def esewa_callback():
    """eSewa redirects here after the user authorises. We:
        1. Decode the base64 'data' query param into JSON
        2. Verify its HMAC signature locally (response integrity)
        3. Look the transaction up server-to-server with eSewa's status API
        4. Match the amount and transaction_uuid we stored
        5. Atomically mark the payment + order as paid (single-use guarded)
        6. Redirect back into the app via deep link.
    """
    payment_id = request.args.get('paymentId')
    data_b64   = request.args.get('data')

    def fail(reason: str, app_redirect_url: str = None):
        print(f"[eSewa] Payment #{payment_id} FAIL: {reason}")
        return redirect(_build_app_redirect(
            app_redirect_url, paymentId=payment_id, status='failed', reason=reason,
        ))

    # Load payment first so we know the redirect URL even on early failure.
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM payments WHERE id = ?', (payment_id,))
    payment = c.fetchone()
    if not payment:
        conn.close()
        return fail('Payment not found')
    app_redirect_url = payment['app_redirect_url'] or 'amsapp://payment/done'

    if not data_b64:
        conn.close()
        return fail('Missing payload', app_redirect_url)

    if payment['status'] == 'paid':
        # Already processed — bounce back idempotently
        conn.close()
        return redirect(_build_app_redirect(
            app_redirect_url, paymentId=payment_id, status='paid',
            orderId=payment['order_id'],
        ))

    # 1. Decode response payload
    try:
        decoded = jsonlib.loads(base64.b64decode(data_b64).decode('utf-8'))
    except Exception:
        conn.close()
        return fail('Invalid eSewa payload', app_redirect_url)

    if decoded.get('status') != 'COMPLETE':
        conn.close()
        return fail(f"eSewa status: {decoded.get('status')}", app_redirect_url)

    # 2. Verify response signature
    signed = (decoded.get('signed_field_names') or '').split(',')
    sig_string = ','.join(f"{f}={decoded.get(f)}" for f in signed)
    if esewa_signature(sig_string) != decoded.get('signature'):
        conn.close()
        return fail('Signature mismatch', app_redirect_url)

    transaction_uuid = decoded.get('transaction_uuid')
    if transaction_uuid != payment['transaction_uuid']:
        conn.close()
        return fail('Transaction UUID mismatch', app_redirect_url)

    # 3. Server-to-server status check (the only authoritative check)
    try:
        verify = esewa_status_check(
            decoded.get('product_code'),
            decoded.get('total_amount'),
            transaction_uuid,
        )
    except Exception as e:
        conn.close()
        return fail(f"Verify call failed: {type(e).__name__}", app_redirect_url)

    if verify.get('status') != 'COMPLETE':
        conn.close()
        return fail(f"Verify status: {verify.get('status')}", app_redirect_url)

    # 4. Amount must match exactly what we stored
    try:
        verified_amount = int(round(float(verify.get('total_amount', 0))))
    except Exception:
        verified_amount = -1
    if verified_amount != int(payment['amount_npr']):
        conn.close()
        return fail('Amount mismatch', app_redirect_url)

    # 5. ref_id must be unique across all payments (anti-replay)
    ref_id = verify.get('ref_id')
    if ref_id:
        c.execute(
            'SELECT id FROM payments WHERE esewa_ref_id = ? AND id != ?',
            (ref_id, payment['id']),
        )
        if c.fetchone():
            conn.close()
            return fail('Reference id already used', app_redirect_url)

    # 6. Atomic update — guards against double-callbacks
    c.execute('''
        UPDATE payments
        SET    status = 'paid', esewa_ref_id = ?, completed_at = ?
        WHERE  id = ? AND status != 'paid'
    ''', (ref_id, datetime.now().isoformat(), payment['id']))
    if c.rowcount == 0:
        conn.close()
        return fail('Race — already processed', app_redirect_url)

    c.execute("UPDATE orders SET status = 'paid' WHERE id = ?", (payment['order_id'],))
    conn.commit()
    conn.close()

    print(f"[eSewa] Payment #{payment['id']} VERIFIED · ref={ref_id} · "
          f"order #{payment['order_id']} marked paid")

    return redirect(_build_app_redirect(
        app_redirect_url,
        paymentId=payment_id, status='paid',
        orderId=payment['order_id'], refId=ref_id,
    ))


@app.route('/payments/esewa/cancel', methods=['GET', 'POST'])
def esewa_cancel():
    payment_id = request.args.get('paymentId')
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM payments WHERE id = ?', (payment_id,))
    payment = c.fetchone()
    app_redirect_url = (payment['app_redirect_url'] if payment else None) or 'amsapp://payment/done'
    if payment and payment['status'] == 'initiated':
        c.execute(
            "UPDATE payments SET status = 'cancelled', failure_reason = 'User cancelled' WHERE id = ?",
            (payment_id,),
        )
        conn.commit()
    conn.close()
    return redirect(_build_app_redirect(
        app_redirect_url, paymentId=payment_id, status='cancelled',
    ))


# ============================================================================
# RUN SERVER
# ============================================================================
if __name__ == '__main__':
    print("="*60)
    print("AMS PREDICTION API - STARTING SERVER")
    print("="*60)
    print(f"Model   : {MODEL_NAME}")
    print(f"Accuracy: {MODEL_ACCURACY*100:.2f}%")
    print(f"\nEndpoints:")
    print(f"  GET  /               - API info")
    print(f"  GET  /health         - Health check")
    print(f"  POST /predict        - AMS prediction")
    print(f"  GET  /history        - All predictions")
    print(f"  GET  /history/latest - Latest prediction")
    print(f"  DELETE /history      - Clear history")
    print(f"  GET  /products       - Product catalogue")
    print(f"  POST /orders         - Place order (mock payment)")
    print(f"  GET  /orders         - List my orders")
    print(f"\nTo find your IP: run 'ipconfig' in terminal")
    print("="*60 + "\n")

    app.run(host='0.0.0.0', port=5000, debug=True)
