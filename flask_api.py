"""
AMS Prediction Flask API
Real-Time Prediction System for Acute Mountain Sickness

Architecture:
  - Rule-based logic  : runs on Arduino (offline) AND here (comparison baseline)
  - Decision Tree     : runs here (interpretable ML, trained in Jupyter)
  - Agreement check   : response tells the app if both methods agree

Author: [Your Name]
Project: AMS Prediction System - Final Year Project
Institution: The British College, Kathmandu
Date: April 2026
"""

from flask import Flask, request, jsonify
import joblib
import pandas as pd
import traceback
import sqlite3
import os
import hashlib
import secrets
from datetime import datetime

app = Flask(__name__)

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
    # ── Migrations: add columns that may not exist in older databases ──
    c.execute("PRAGMA table_info(predictions)")
    existing_cols = {row[1] for row in c.fetchall()}
    if 'user_id' not in existing_cols:
        c.execute('ALTER TABLE predictions ADD COLUMN user_id INTEGER')
        print("Migration: added user_id column to predictions table")
    if 'rule_based' not in existing_cols:
        c.execute('ALTER TABLE predictions ADD COLUMN rule_based TEXT')
        print("Migration: added rule_based column to predictions table")

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
    print(f"\nTo find your IP: run 'ipconfig' in terminal")
    print("="*60 + "\n")

    app.run(host='0.0.0.0', port=5000, debug=True)
